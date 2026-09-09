# Plan 182: 消灭 O(全量正文) 路径——故事上下文、生产 runs、面板与 AppShell 的按需加载

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 0dfbbcf..HEAD -- server/helpers/story-context.ts server/helpers/chapter-completion.ts server/lib/db/production.ts server/routes/audit.ts server/routes/agents.ts server/routes/production.ts src/components/EditorView.tsx src/components/ForeshadowingPanel.tsx src/components/PacingDashboard.tsx src/components/AppShell.tsx`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW-MED（改查询投影，语义由既有测试护航）
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

长篇场景（100+ 章 × 数千字）下多条高频路径按「整本书正文」量级工作，实际消费只有 KB 级：

1. 审计/代理/生产上下文每次全量 `SELECT *` 章节（150 章 ≈ 0.5-1MB），账本只用最后 5 章 ≤2KB；`production.ts:1161` 还在全局写队列内全量加载，拉长串行写。
2. 编辑器徽标只为取 `status/target_chapter_id` 两列，却拉全部生产 runs（含整章草稿）；完成流比对还在 JS 里全文比对。
3. 伏笔面板/节奏仪表盘拉全量章节正文；节奏分析把 ≤50 章完整正文 POST 上去，服务端只用前 500 字符（单次 body 可达 ~1MB）。
4. AppShell 四处为定位单章整本 `listChapters`。

metadata 懒加载（历史计划 099/115/118/153）在编辑器与书库已落地，本计划把剩余四类消费方迁完。

## Current state

相关文件与角色：

- `server/helpers/story-context.ts:51-61` — `buildServerStoryContext` 传 `db.listChapters(novel.id)` 给账本
- `shared/lib/story-state-ledger.ts:110-121` — 账本只取 `recentChapterLimit ?? 5` 的最后 N 章
- `server/lib/db-crud.ts:38-45` — crud `list` 为 `SELECT *`
- `server/routes/audit.ts:214,691`、`server/routes/agents.ts:421` — 语义上下文调用点
- `server/routes/production.ts:222,1161` — 生产初始化与 apply 的全量加载
- `server/lib/db/production.ts:5-17` — runs crud（`SELECT *`，含 `draft_content` 等大列）
- `server/helpers/chapter-completion.ts:168` — 全 runs 全文比对找 source run
- `src/components/EditorView.tsx:606-623` — 徽标全量拉 runs
- `src/components/ForeshadowingPanel.tsx:41-46`、`src/components/PacingDashboard.tsx:20-41` — 面板全量拉正文/整章上传
- `src/components/AppShell.tsx:630,657,687,927` — 四处 `listChapters` 定位单章
- `server/lib/db/chapters.ts:37-39` — `getChapter(id)` 单行查询已存在

现状摘录：

```ts
// story-context.ts:51-56 — 全量章节进账本
const ledger = buildStoryStateLedger({
  novel,
  chapters: db.listChapters(novel.id),
  ...
  recentChapterLimit: 5,
  currentChapterOrder: chapter.order,
```

```ts
// story-state-ledger.ts:110-115 — 账本只用最后 N 章的 title/beats/summary
const recentChapters = orderedChapters.slice(-recentChapterLimit).map((chapter) => ({
  id: chapter.id,
  title: chapter.title || `第 ${chapter.order} 章`,
  order: chapter.order,
  sceneBeats: compact(chapter.sceneBeats, 500),
  summary: chapterSummary(chapter),
}));
```

```ts
// production.ts:1159-1161 — 全局写队列内全量加载
const guarded = await runInSerializedWriteForGeneration(databaseGeneration, () => {
  const chapters = db.listChapters(run.novelId);
```

```ts
// db/production.ts:14-16 — 无投影无 LIMIT
export function listChapterProductionRuns(novelId: string): ChapterProductionRun[] {
  return chapterProductionRunCrud.list(novelId);
}
```

```ts
// chapter-completion.ts:168 — 全 runs 全文比对
const sourceRun = db.listChapterProductionRuns(input.novelId).find((run) =>
  run.targetChapterId === chapter.id && run.status === 'applied' && ... && run.draftContent === chapter.content && ...);
```

```tsx
// EditorView.tsx:606-623 — 徽标全量拉 runs（含整章草稿）
const runs = await listChapterProductionRuns(novel.id);
setPreviewRunChapterIds(new Set(
  runs.filter((run) => run.status === 'review_required' && run.targetChapterId)
      .map((run) => run.targetChapterId as string),
));
```

```tsx
// ForeshadowingPanel.tsx:41-45 — 渲染只需标题/顺序，却拉全正文
const refresh = useCallback(async () => {
  setItems(await listForeshadowings(novelId));
  setChapters(await listChapters(novelId));
}, [novelId]);
```

```tsx
// PacingDashboard.tsx:41-44 — 整章对象 POST 上去
const slice = withContent.slice(-MAX_CHAPTERS);
const { result } = await startWorldJob<{ chapters: Partial<PacingData>[] }>(
  '/api/analyze-pacing', { novelId, chapters: slice }, ...);
// world.ts:984 — 服务端只用 (c.content || '').substring(0, 500)
```

既有 metadata 设施：`listChaptersMetadata`（前端 client 与 `server/lib/db/library.ts` 已有，编辑器 `useEditorData.ts:181` 在用）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck`（或 `node node_modules/typescript/bin/tsc --noEmit`） | exit 0 |
| 后端全量 | `npm test` | 全绿 |
| 前端全量 | `npm run test:frontend` | 全绿 |
| 定向 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/chapter-completion.test.ts tests/audit-five-dimension-contract.test.ts` | 全过 |

## Scope

**In scope**：

- `server/lib/db/production.ts`（新增投影查询）
- `server/lib/db/chapters.ts`（如需新增「最近 N 章投影」查询）
- `server/helpers/story-context.ts`、`server/helpers/chapter-completion.ts`
- `server/routes/production.ts`、`server/routes/audit.ts`、`server/routes/agents.ts`（仅换取数函数）
- `server/routes/world.ts`（analyze-pacing 的请求 schema 放行精简结构，如需）
- `src/components/EditorView.tsx`（徽标换投影端点）
- `src/components/ForeshadowingPanel.tsx`、`src/components/PacingDashboard.tsx`
- `src/components/AppShell.tsx`（四处 getChapter/metadata 替换）
- 相关 client（`src/lib/` 下 production client 增加投影方法）

**Out of scope**：

- `shared/lib/story-state-ledger.ts` 的账本结构（输入不变，只换取数路径）
- 向量检索内部（Plan 184 的调查项）
- `db-crud.ts` 通用机制（投影查询单独写，不动 crud 工厂）

## Git workflow

每类一次提交；消息如 `perf(context): load only recent chapter contents for story ledger`；完成即提交，不 push。

## Steps

### Step 1: 故事上下文只加载最近 N 章正文

1. `server/lib/db/chapters.ts` 新增：

```ts
export function listRecentChapterContents(novelId: string, limit: number): Chapter[] {
  const rows = getDb().prepare(
    `SELECT * FROM chapters WHERE novel_id = ? ORDER BY "order" DESC LIMIT ?`
  ).all(novelId, limit) as ChapterRow[];
  return rows.map(rowToChapter).reverse();
}
```

（`getDb`/`rowToChapter`/行类型名以该文件现状为准。）
2. `story-context.ts:51` 改为 `chapters: listRecentChapterContents(novel.id, 5)`——账本 `orderedChapters.slice(-recentChapterLimit)` 语义不变；注意 `currentChapterOrder` 由调用方显式传入（现状即是），且当前章可能不在最近 5 章内（账本本来也不含它的正文，仅用 order）。
3. `production.ts:222`（初始化）：核对 `chapters` 的实际用途（`getNextChapterOrder(chapters)` 与实体过滤），改为 `listChaptersMetadata`（服务端等价函数，`grep -n "listChaptersMetadata" server/lib/db/*.ts` 定位；若无，则本处保持全量并在报告注明原因——实体名过滤需要 name 列，metadata 投影需含 name）。
4. `production.ts:1161`（apply，写队列内）：核对块内 `chapters` 用途（`chapters.at(-1)?.volumeName`、`getNextChapterOrder`）——同样换 metadata 投影；若该块还需要 `db.getChapter(chapterId)`（已有单行调用），保持不变。

**Verify**: `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/chapter-completion.test.ts` 全过；`npm test` 全绿

### Step 2: 生产 runs 投影端点

1. `server/lib/db/production.ts` 新增：

```ts
export interface ChapterProductionRunBadge { id: string; status: string; targetChapterId: string | null; }
export function listChapterProductionRunBadges(novelId: string): ChapterProductionRunBadge[] {
  const rows = getDb().prepare(
    `SELECT id, status, target_chapter_id FROM chapter_production_runs WHERE novel_id = ? AND status = 'review_required' ORDER BY created_at DESC`
  ).all(novelId) as Array<{ id: string; status: string; target_chapter_id: string | null }>;
  return rows.map((r) => ({ id: r.id, status: r.status, targetChapterId: r.target_chapter_id }));
}
```

2. 暴露到 `/api/db` 白名单：仿照 `listChapterProductionRuns` 的注册方式（`grep -n "listChapterProductionRuns" server/routes/db.ts` 找白名单行与 zod schema 行，成对新增 `chapter-production-run-badges`）。
3. 前端 client（`grep -rn "listChapterProductionRuns" src/lib/`）新增 `listChapterProductionRunBadges`；`EditorView.tsx:611` 改用它。
4. `chapter-completion.ts:168` 改为先按章过滤再全文比对：`db.listChapterProductionRuns` 前先 `db.getChapter(chapter.id)` 拿 `novelId`，用新查询 `listChapterProductionRunBadges` 拿候选 id，再对候选 `getChapterProductionRun(id)` 做全文比对。

**Verify**: `grep -n "chapter-production-run-badges" server/routes/db.ts` ≥2 命中（白名单+schema）；`npm test` 全绿

### Step 3: 面板迁 metadata + 节奏请求瘦身

1. `ForeshadowingPanel.tsx:42` 改 `setChapters(await listChaptersMetadata(novelId));`（import 同源；核对组件对 chapters 的消费只有下拉/标题——`grep -n "chapters" src/components/ForeshadowingPanel.tsx` 核对无 `.content` 访问，有则保留 getChapter 按需）。
2. `PacingDashboard.tsx:20` 同改；`:41-44` 上传体瘦身：`const slice = withContent.slice(-MAX_CHAPTERS).map((c) => ({ id: c.id, order: c.order, title: c.title, wordCount: c.wordCount, content: (c.content || '').slice(0, 500) }));`
3. `server/routes/world.ts` 的 analyze-pacing 请求 schema（`grep -n "analyze-pacing" server/routes/world.ts server/validation.ts`）放行该精简结构（字段皆现有子集，通常无需改；若 schema 强制完整 Chapter 再放宽）。

**Verify**: typecheck 0 错误；`grep -n "listChapters(" src/components/ForeshadowingPanel.tsx src/components/PacingDashboard.tsx` 无命中

### Step 4: AppShell 四处定位单章

`AppShell.tsx:630/657/687` 三处 `const chapters = await listChapters(context.novelId); ... find(c => c.id === context.chapterId)` 改为 `const target = await getChapter(context.chapterId);` 并保留原有的 `selectedNovel?.id !== context.novelId` 复查与 `target.novelId !== context.novelId` 属主校验（getChapter 无属主过滤，必须补 `if (!target || target.novelId !== context.novelId) return;`）。`:927` 取第一章改为 `const metadata = await listChaptersMetadata(selectedNovel.id);` 取首项。

**Verify**: `grep -n "listChapters(" src/components/AppShell.tsx` 仅剩合法残留（人工核对）；typecheck 0 错误

### Step 5: 回归与守卫测试

1. `tests/` 新增 `tests/story-context-load-scope.test.ts`：建 30 章的书，spy/包装 `getDb().prepare` 或以 `SELECT *` 计数断言 `buildServerStoryContext` 不再触发 chapters 全表读取（可用 better-sqlite3 的 `sqlite_db.prepare` 包装计数，或简单断言返回的 ledger 中 chapters 数 ≤5）。
2. 既有 `audit-*`、`chapter-production`、`chapter-completion` 测试全绿即为行为守卫。

**Verify**: `npm test` 全绿；`npm run test:frontend` 全绿

## Test plan

见 Step 5。重点既有守卫：`chapter-completion.test.ts`（source run 比对语义）、`audit-five-dimension-contract.test.ts`、`chapter-production.test.ts`、前端 `components.test.tsx`。

## Done criteria

- [ ] typecheck 0 错误；`npm test`、`npm run test:frontend` 全绿
- [ ] `grep -n "db.listChapters(novel.id)" server/helpers/story-context.ts` 无命中
- [ ] `grep -n "listChapterProductionRuns" src/components/EditorView.tsx` 无命中（徽标走 badges）
- [ ] 新增 `tests/story-context-load-scope.test.ts` 通过
- [ ] `git status` 无 in-scope 之外的改动
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- `story-state-ledger.ts` 除最后 N 章外还消费了输入 chapters 的其他字段（`grep -n "input.chapters\|orderedChapters" shared/lib/story-state-ledger.ts` 核对）——投影需按实际字段扩列后再换。
- `production.ts:222` 的实体过滤依赖正文 content（不只是 name）——保持全量并在报告标注，只做 1161 处替换。
- 徽标投影端点加入 `/api/db` 白名单时发现该表无 novel_id 索引（`grep -n "idx_chapter_production_runs" server/lib/db-init.ts`）——先确认索引存在（审计记载 `idx_chapter_production_runs_novel` 已建，若实际缺失则 STOP 报告）。

## Maintenance notes

- 评审关注点：投影查询的 ORDER BY 列名（`"order"` 是保留字需引号）；badges 端点只读、无属主问题（novelId 过滤）。
- Plan 183 的 SSE 节流会降低这些路径的触发频率，两计划叠加后建议用 Plan 187 的 E2E 再验一次编辑器体验。
- 后续给 runs 加分页时，`chapter-completion` 的比对查询需一并 revisit。
