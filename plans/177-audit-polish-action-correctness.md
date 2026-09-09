# Plan 177: 审稿/润色链路三处正确性修复——409 单次消费、重试保留范围、改写选区防漂移

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 0dfbbcf..HEAD -- src/lib/hooks/generation/useAuditPolishActions.ts src/lib/hooks/generation/useDraftGeneration.ts src/lib/hooks/useEditorGenerationFlow.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW-MED（都在生成动作热路径上，需逐条回归）
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

三个独立缺陷都发生在审稿/润色/改写链路上：

1. **409 响应体被读两次**：数据库代际冲突（409 但非 style 确认）本应提示「请刷新后重试」，实际表现为 fetch 内部 `TypeError: Body is unusable`，用户看到无意义的「Rewrite failed.」类文案。
2. **润色重试丢失范围**：单条 issue 的「生成修正预览」（previewOnly）失败后点重试，静默升级为整章润色，产生与用户意图不符的候选。
3. **改写选区偏移漂移**：选区 offset 在异步 flush 之前捕获，窗口期打字会让 AI 结果拼接错位——直接改错正文，且质量门禁拦不住语义正确的错位文本。

## Current state

相关文件与角色：

- `src/lib/hooks/generation/useAuditPolishActions.ts` — 审计/润色/改写动作 hook（917 行，本计划三个修复点所在）
- `src/lib/hooks/generation/useDraftGeneration.ts:252-274` — 正文生成的 409 处理
- `src/lib/hooks/useEditorGenerationFlow.ts:405-410` — 统一重试分发

现状摘录：

```ts
// useAuditPolishActions.ts:133-139 — 对任何 409 都先消费 body；code 不符返回 false
const handleStyleConfirmationResponse = async (response: Response, retry?: ...): Promise<boolean> => {
  if (response.status !== 409) return false;
  const data = await response.json().catch(() => null);
  if (data?.code !== 'STYLE_CONFIRMATION_REQUIRED') return false;
  onStyleConfirmationRequired?.({ ...data, retry });
  return true;
};
```

```ts
// useAuditPolishActions.ts:232-233 — handleRunAudit 内：body 已被上一步消费，这里再次 json() 抛 TypeError
if (await handleStyleConfirmationResponse(response, ...)) { ...; return; }
const initData = await response.json();
```

```ts
// useDraftGeneration.ts:253-258, 274 — 同模式：409 先 .json().catch(()=>null) 消费，非 style 时落到 .text() 再次消费
if (response.status === 409) {
  const styleData = await response.json().catch(() => null);
  if (styleData?.code === 'STYLE_CONFIRMATION_REQUIRED') { ...; return; }
}
...
const errText = await response.text();
throw new Error(errText || `HTTP ${response.status}`);
```

```ts
// useAuditPolishActions.ts:462-464, 492-494, 543, 551-554 — 选区 offset 先取、baseline 后读
const start = retryInput?.start ?? contentRef.current.selectionStart;
const end = retryInput?.end ?? contentRef.current.selectionEnd;
...
let baselineContent = currentChapter.content;
try {
  await flushPendingEditorWrites();
  baselineContent = contentRef.current?.value ?? currentChapter.content;   // offset 与 baseline 之间可被输入改变
...
const newText = baselineContent.substring(0, start) + rewritten + baselineContent.substring(end);
...
const latestContentBeforeCandidate = contentRef.current?.value ?? currentChapter.content;
if (latestContentBeforeCandidate !== baselineContent) {           // 只盖 493 之后，盖不住 462→493
  throw new Error('REWRITE_CONTENT_STALE');
}
```

```ts
// useAuditPolishActions.ts:651 — polish 的 retryContext 丢弃了 reviewOptions
setRetryContext?.({ operation: 'polish', fingerprint: fingerprintOverride });

// useEditorGenerationFlow.ts:408 — 重试只带 fingerprint
else if (aiActionState.operation === 'polish') await handlePolishChapterFromAudit(retryContextRef.current?.fingerprint);
```

对照组（正确先例）：rewrite 的 retryContext 保存了完整 `{ start, end, instruction }`（useAuditPolishActions.ts:479）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck`（或 `node node_modules/typescript/bin/tsc --noEmit`） | exit 0 |
| 前端定向测试 | `node node_modules/vitest/vitest.mjs -c vitest.config.frontend.ts run src/tests/audit-polish-actions.test.ts`（文件名以 `ls src/tests | grep -E "audit|polish|generation"` 为准） | 全过 |
| 前端全量 | `npm run test:frontend` | 全绿 |

## Scope

**In scope**：

- `src/lib/hooks/generation/useAuditPolishActions.ts`
- `src/lib/hooks/generation/useDraftGeneration.ts`（仅 409/错误体读取段）
- `src/lib/hooks/useEditorGenerationFlow.ts`（仅 retry 分发一行）
- 新增/扩展测试文件

**Out of scope**：

- 服务端 409 的产生逻辑（`server/routes/audit.ts:604,641` 等）——响应语义正确，是前端消费错误
- `handleRunAudit` 的 job 轮询段（Plan 176 已覆盖）
- 生成互斥/旗标问题（Plan 178 覆盖）

## Git workflow

小步提交（三个修复各一次提交），消息如 `fix(editor): read 409 body once in audit/draft actions`；完成即提交，不 push。

## Steps

### Step 1: 409 响应体单次消费

1. 新增共享助手（放在 `useAuditPolishActions.ts` 顶部模块级，export 供 useDraftGeneration 复用；或放 `src/lib/hooks/generation/` 下的新小文件 `response-helpers.ts`）：

```ts
/** Read a non-2xx body exactly once and parse it leniently. */
export async function readErrorBodyOnce(response: Response): Promise<Record<string, unknown> | null> {
  const raw = await response.text().catch(() => '');
  if (!raw) return null;
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
}
```

2. `handleStyleConfirmationResponse` 改为先 `readErrorBodyOnce`，命中 style code 时把解析结果用于 `onStyleConfirmationRequired`，未命中时**把已解析的 data 一并返回**（改签名为 `Promise<{ handled: boolean; data: Record<string, unknown> | null }>`），调用方用返回的 data 继续判断 quotaExceeded 等，**不得**再对同一个 response 调 `.json()`/`.text()`。
3. `useAuditPolishActions.ts:233` 的 `const initData = await response.json();` 改为使用 Step 1.2 返回的 data。
4. `useDraftGeneration.ts:253-274`：409/403/其他错误分支统一走 `readErrorBodyOnce`；`const errText = await response.text()` 删除，改用已解析 data 的 `error` 字段或 `HTTP <status>` 兜底。

**Verify**: `node node_modules/typescript/bin/tsc --noEmit` → 0 错误；`grep -n "await response.json()" src/lib/hooks/generation/useAuditPolishActions.ts | wc -l` → 输出结果中不Remaining任何「同一 response 的第二次读取」（人工核对每个命中点属于不同 response）

### Step 2: 润色重试保留 reviewOptions

1. `useAuditPolishActions.ts:651` 改为 `setRetryContext?.({ operation: 'polish', fingerprint: fingerprintOverride, reviewOptions });`
2. 找到 retryContext 的类型定义（`grep -n "retryContext" src/lib/hooks/useEditorGenerationFlow.ts src/lib/hooks/generation/useAuditPolishActions.ts`），给 polish 分支补可选字段 `reviewOptions?: { issueIds?: string[]; recheck?: boolean; previewOnly?: boolean }`。
3. `useEditorGenerationFlow.ts:408` 改为 `await handlePolishChapterFromAudit(retryContextRef.current?.fingerprint, retryContextRef.current?.reviewOptions);`

**Verify**: typecheck 0 错误

### Step 3: 改写选区防漂移

`handleRewriteSelectedText`（useAuditPolishActions.ts:457 起）：

1. 捕获 offset 的同时快照选区文本：

```ts
const start = retryInput?.start ?? contentRef.current.selectionStart;
const end = retryInput?.end ?? contentRef.current.selectionEnd;
const selectedTextAtCapture = (contentRef.current?.value ?? '').substring(start, end);
```

2. 在 `await flushPendingEditorWrites(); baselineContent = contentRef.current?.value ?? currentChapter.content;`（约 492-494 行）之后立即加：

```ts
if (baselineContent.substring(start, end) !== selectedTextAtCapture) {
  setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionError(state, '选区内容已变化，请重新选择后再改写。'));
  setIsGeneratingContent(false);
  return;
}
```

3. 保留既有 `REWRITE_CONTENT_STALE` 守卫不变（它守 493 之后的窗口）。

**Verify**: typecheck 0 错误

### Step 4: 回归测试

扩展既有 audit/polish 测试文件（`ls src/tests | grep -E "audit|polish"`），仿照其中现有的 mock transport/fetch 模式新增：

1. **409 非 style**：mock fetch 返回 409 + `{"error":"数据库已切换"}` → 断言错误文案包含「数据库」（而非 TypeError/`Rewrite failed.`）。
2. **409 style 确认**：mock 409 + STYLE_CONFIRMATION_REQUIRED → 断言 `onStyleConfirmationRequired` 被调用且后续无二次读体异常。
3. **polish 重试保留范围**：以 `reviewOptions: { previewOnly: true, issueIds: ['i1'] }` 触发 polish 失败 → 调用统一重试入口 → 断言 `handlePolishChapterFromAudit` 第二参原样透传。
4. **选区漂移**：mock `flushPendingEditorWrites` 在其间改变 contentRef 值使选区文本失配 → 断言结果为「选区内容已变化」且未发起 `/api/rewrite` fetch。

**Verify**: `node node_modules/vitest/vitest.mjs -c vitest.config.frontend.ts run src/tests/audit-polish-actions.test.ts` → 含 4 个新用例全过

## Test plan

见 Step 4。全量回归 `npm run test:frontend`（生成链路相关用例集中在 audit-polish/draft-generation/editor-generation-flow 文件，必须全绿）。

## Done criteria

- [ ] typecheck 0 错误；`npm run test:frontend` 全绿（含 4 个新用例）
- [ ] `grep -rn "await response.json()" src/lib/hooks/generation/` 输出经人工核对不存在同一 Response 的二次读取
- [ ] `grep -n "reviewOptions" src/lib/hooks/useEditorGenerationFlow.ts` ≥1 命中（透传存在）
- [ ] `git status` 无 in-scope 之外的改动
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- `handleStyleConfirmationResponse` 的调用点多于 3 处（audit/rewrite/draft 之外）——先报告清单再统一改。
- retryContext 类型是跨 store 共享的 discriminated union 且无法无损扩展 polish 分支。
- Step 4 用例 4 无法稳定构造（flush mock 难以注入）——改测纯函数化后的比较逻辑，仍失败则 STOP。

## Maintenance notes

- 评审关注点：`readErrorBodyOnce` 的 lenient 解析不得吞掉非 JSON 错误体（返回 null 时调用方必须回落 `HTTP <status>` 文案）。
- 未来新增生成类动作时，409 消费一律走 `readErrorBodyOnce`，review 加 lint 规则或 code owner 注释提醒。
- Plan 178 会重构生成旗标互斥，两计划都触碰 useDraftGeneration 时按依赖顺序执行（Plan 178 在后）。
