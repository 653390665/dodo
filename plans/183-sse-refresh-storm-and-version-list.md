# Plan 183: SSE 变更广播节流 + chapter_versions 投影——终结外部写触发的全量刷新风暴

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 0dfbbcf..HEAD -- src/lib/db-transport.ts server/routes/continuation.ts server/lib/db/chapters.ts src/lib/hooks/useChapterVersions.ts src/lib/hooks/useEditorData.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED（去抖会延迟外部变更感知；需保留自身写入的即时刷新路径）
- **Depends on**: none（建议在 Plan 182 之后执行，共享测试面）
- **Category**: perf
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

服务端任意一次写操作都经 `notify()` → `/api/db/events` SSE → 前端逐条回调全部订阅者，无去抖无合并。实体抽取每个 batch 至少两次写（`touchEntityExtractionJob` 的 batch-start/batch-completed），100 chunks 的资料包解析期间，打开的编辑器会发起约 200 × 13 个 HTTP 请求并整体重渲染；versions/伏笔/节奏面板每次事件还重拉全量数据。已有 `databaseGeneration` 快照机制却未用于抑制无关刷新。

## Current state

相关文件与角色：

- `src/lib/db-transport.ts:132-145` — SSE onmessage 逐条分发 `globalListeners`
- `server/lib/db-instance.ts:199-205` — `notify()` 每次写同步触发
- `server/routes/continuation.ts:1717,1722,1724` — 每 batch 两次 `touchEntityExtractionJob`
- `server/lib/db/continuation-jobs.ts:15` — job 更新走 crud → `notify`
- `src/lib/hooks/useEditorData.ts:270` — `subscribeToChanges(fetchAll)`（fetchAll = 12 个请求）
- `src/lib/hooks/useChapterVersions.ts:42` — 每次事件全量重拉版本
- `server/lib/db/chapters.ts:56-68` — `listChapterVersions` 全量 `SELECT *`（含整章 content）无 LIMIT

现状摘录：

```ts
// src/lib/db-transport.ts:132-144
es.onmessage = (event) => {
  reconnectDelay = 3000;
  if (event.data) { try {
    const eventPayload = JSON.parse(event.data);
    if (eventPayload.initiator === CLIENT_ID) return;   // 自身写入已过滤
  } catch { /* Fall back to notifying if parsing fails */ } }
  globalListeners.forEach((fn) => {
    try { fn(); } catch (e) { console.warn('SSE listener error:', e); }
  });
};
```

```ts
// server/routes/continuation.ts:1717-1724 — 每 chunk 两次 checkpoint 落盘（每次都 notify）
await touchEntityExtractionJob(job, 'batch-start');
...
job.completedChunkIndexes = [...(job.completedChunkIndexes || []), chunk.index];
await touchEntityExtractionJob(job, 'batch-completed');
```

```ts
// server/lib/db/chapters.ts:56-59
export function listChapterVersions(chapterId: string): ChapterVersion[] {
  return chapterVersionCrud.list(chapterId);
}
// crud list = SELECT * ORDER BY created_at DESC（含 content 大列，无 LIMIT）
```

自身写入过滤已存在：`eventPayload.initiator === CLIENT_ID` 时跳过——本计划只节流**外部**写触发的刷新。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck`（或 `node node_modules/typescript/bin/tsc --noEmit`） | exit 0 |
| 前端全量 | `npm run test:frontend` | 全绿 |
| 后端全量 | `npm test` | 全绿 |
| 定向 | `node node_modules/vitest/vitest.mjs -c vitest.config.frontend.ts run src/tests/editor-persistence.test.ts` | 全过 |

## Scope

**In scope**：

- `src/lib/db-transport.ts`（分发去抖）
- `server/lib/db/chapters.ts`（版本列表投影 + 按需取正文）
- `server/routes/db.ts`（如需暴露 version-content 单条端点——先核对 `/api/db` 白名单是否已有 `get-chapter-version`）
- `src/lib/hooks/useChapterVersions.ts`（列表投影消费 + 正文按需）
- `src/lib/hooks/useEditorData.ts` / `useEditorContinuationPacks.ts` / `ForeshadowingPanel` / `PacingDashboard`（如需声明式跳过无关刷新，见 Step 3 可选项）
- 新增测试

**Out of scope**：

- 服务端 `notify()` 机制与 batch-start/batch-completed 落盘频率（断点恢复语义由 143 计划锁定，不动）
- SSE 重连/断连治理（121 计划 DONE）
- Plan 184 的渲染层 memo

## Git workflow

两步各一次提交；消息如 `perf(transport): coalesce external db-change notifications`；完成即提交，不 push。

## Steps

### Step 1: db-transport 分发去抖

`db-transport.ts` 的 `es.onmessage` 分发段改为 trailing 合并：

```ts
let notifyFlushTimer: ReturnType<typeof setTimeout> | null = null;
const scheduleListenerFlush = () => {
  if (notifyFlushTimer) return;              // trailing：窗口内只排一次
  notifyFlushTimer = setTimeout(() => {
    notifyFlushTimer = null;
    globalListeners.forEach((fn) => {
      Promise.resolve(fn()).catch((e) => console.warn('SSE listener error:', e));
    });
  }, 500);
};
```

`es.onmessage` 中原来的 forEach 分发替换为 `scheduleListenerFlush()`。同时：

1. 导出 `flushPendingNotifications(): void`（清 timer 并立即分发）——供测试与「需要立即刷新」的调用点用。
2. 保持 `initiator === CLIENT_ID` 过滤在前（自身写入仍即时路径：各 hook 自己的写入回调不变）。
3. `es.onerror`/重连时清空 `notifyFlushTimer` 防泄漏。

**Verify**: typecheck 0 错误；`grep -n "scheduleListenerFlush" src/lib/db-transport.ts` ≥2 命中

### Step 2: chapter_versions 投影

1. `server/lib/db/chapters.ts` 新增：

```ts
export interface ChapterVersionMeta { id: string; wordCount: number; author: string; createdAt: number; }
export function listChapterVersionMetas(chapterId: string): ChapterVersionMeta[] {
  const rows = getDb().prepare(
    `SELECT id, word_count, author, created_at FROM chapter_versions WHERE chapter_id = ? ORDER BY created_at DESC`
  ).all(chapterId) as Array<{ id: string; word_count: number; author: string; created_at: number }>;
  return rows.map((r) => ({ id: r.id, wordCount: r.word_count, author: r.author, createdAt: r.created_at }));
}
```

2. 核对 `/api/db` 白名单：`grep -n "getChapterVersion\|chapter-version" server/routes/db.ts`。已有单条查询端点则前端列表改用 `list-chapter-version-metas`（按 Step 1 同法注册白名单+schema）、点击/回滚时按 id 取单条（`getChapterVersion`）；没有则在本步一并新增单条端点。
3. `useChapterVersions.ts`：`refreshVersions` 改用 metas 列表；消费正文的地方（版本预览/回滚面板，`grep -rn "listChapterVersions" src/`）改「选中时按 id 拉单条」。
4. 版本数据结构变化会波及类型 `ChapterVersion` 的消费面——仅 hooks/面板层改动，不动 shared 类型。

**Verify**: `grep -n "SELECT \\*" server/lib/db/chapters.ts` 的 versions 段无全列列表查询（人工核对）；`npm test` 全绿（版本相关既有测试若有结构断言，更新之）

### Step 3: 无关刷新抑制（声明式，可选加强）

利用事件负载：`server/routes/db.ts:976` 广播体目前只有 `{ initiator }`；为广播追加 `databaseGeneration`（`notify` 回调处可读 `getDatabaseGeneration()`，改动限 db.ts 一行）。前端 `useEditorData.fetchAll` 前比对：事件携带的 generation 与本地 `databaseGeneration` state 相同且事件非自身写入时，跳过 `fetchAll`（仍然调度一次轻量 `getNovel` 更新 updatedAt？——**不**，直接跳过，updatedAt 非关键 UI）。伏笔/节奏面板的订阅同样先比对 generation。若评估后认为 Step 1 的 500ms 合并已足够（请求量从 200×13 降至 ~40×13），本步可标记为后续观察项，不强制实施——在执行报告中给出取舍与依据。

**Verify**: 若实施：typecheck 0 错误 + 面板测试通过；若不实施：报告说明理由

### Step 4: 回归测试

1. `src/tests/db-transport-coalesce.test.ts`（新建，仿 `src/tests/` 既有 EventSource mock 方式，`grep -rln "EventSource" src/tests/` 找先例）：模拟 5 条 SSE 消息在 100ms 内到达 → 用 fake timers advance 500ms → 断言 listener 只被调用 1 次；再触发 `flushPendingNotifications()` → 立即再调用 1 次。
2. `initiator === CLIENT_ID` 的消息仍即时跳过（不进 timer）。
3. `src/tests/editor-persistence.test.ts` 等既有套件全绿（保存边界 122 计划的语义不受影响）。

**Verify**: `npm run test:frontend` 全绿

## Test plan

见 Step 4。后端侧跑 `ls tests | grep version` 相关文件 + `export-route.test.ts`（db.ts 白名单改动回归）。

## Done criteria

- [ ] typecheck 0 错误；`npm run test:frontend`、`npm test` 全绿
- [ ] `grep -n "forEach((fn)" src/lib/db-transport.ts` 的分发已走合并路径（`scheduleListenerFlush`）
- [ ] `grep -n "listChapterVersions" src/` 消费方已改 metas + 按需单条（或保留处有报告说明）
- [ ] 新增 coalesce 测试通过
- [ ] `git status` 无 in-scope 之外的改动
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- 存在依赖「每条事件即时回调」语义的消费方（如打字机效果、竞态倒计时）——grep `subscribeToChanges` 全清单核对后报告。
- `/api/db` 白名单新增被 `tests/architecture-boundaries.test.ts` 或 api-surface 测试拦截——按其断言意图更新契约测试，改不动则 STOP。
- Step 2 发现版本回滚流程依赖列表内即时可用的 `content`（非选中加载）——改为选中加载会影响回滚延迟，报告权衡。

## Maintenance notes

- 评审关注点：500ms 是体验与请求量的折中；若用户反馈「外部变更感知变慢」，优先缩窗至 250ms 而非回退。
- Plan 184 的助手消息 memo 与本计划正交；Plan 182 的 badges 投影会降低每次刷新的单请求成本。
- 抽取 checkpoint 的 batch 频率（O(n²) 序列化）在 Plan 184 处理；本计划只治广播放大。
