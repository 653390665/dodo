# Plan 254: 已知缺陷特征化测试守护——改两处固化断言 + 补五条 P1 盲区

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update the status row for plan 254 in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 391abf4..HEAD -- src/tests/draft-generation-safety.test.ts src/tests/writing-surface-quality-guard.test.ts src/tests/app-shell-capability-launch.test.tsx src/tests/app-shell-project-assistant.test.tsx tests/production-stream-disconnect.test.ts tests/continuation-extraction-job-recovery.test.ts src/components/EditorView.tsx src/components/AppShell.tsx server/routes/production.ts server/routes/continuation.ts`
> 有变更则对照「Current state」原文，不符即 STOP。

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none（与 253 无文件交集，可并行）
- **Category**: tests
- **Planned at**: commit `391abf4`, 2026-09-20

## Why this matters

2026-09-20 审计确认了两类测试问题：**(a) 有两个测试把已知缺陷行为固化成了期望行为**——`draft-generation-safety.test.ts` 断言"流式失败回滚到 baseline"（实际会丢掉流式期间用户手打的字），`writing-surface-quality-guard.test.ts` 用源码文本断言钉死 `readOnly={false}`。将来修复这些缺陷时这两个测试会红，修复者会被误导。**(b) 五条已知 P1/P2 缺陷路径零测试守护**——重构时无声回归无报警。本计划把上述七处全部转成**特征化测试（characterization tests）**：如实断言当前行为并标注"这是已登记缺陷，修复时翻转本断言"，让缺陷从"无守护"变为"有锁点"。

## Current state

**缺陷行为 (a-1)**：生成失败回滚丢流式期输入。`src/components/WritingSurface.tsx:309` 生成期间 `readOnly={false}`；`src/lib/hooks/useDraftGeneration.ts:278-281` 流开始前捕获 baseline，:380-386 失败时 `setCurrentChapter(state => ({...state, content: baselineContent}))`——流式期间用户键入被覆盖丢弃。
**固化测试 (a-1)**：`src/tests/draft-generation-safety.test.ts:101-128` 用例 `'partial draft EOF restores the baseline and creates no success records'`：SSE mock 只发一个 token 就断流，断言 `setCurrentChapter` 被以函数调用（:117 `expect(props.setCurrentChapter).toHaveBeenCalledWith(expect.any(Function))`）——**全程未模拟流式期间的用户键入**。

**缺陷行为 (a-2)**：`src/tests/writing-surface-quality-guard.test.ts` 是"防假质量组件回归"守护测试（:8-19 的 `not.toContain` 列表是合法目的，保留），但 :22-30 把实现钉死：
```ts
expect(source.match(/void onRunAudit\(\)/g)).toHaveLength(1);
expect(source).toMatch(/workflowState\.primaryAction === 'audit' &&\s*\(isGeneratingCritique \|\| isChapterEmpty\)/);
expect(source).toContain('正文为空，暂不能审计。');
expect(source).toContain('readOnly={false}');
```

**五条盲区**：
1. `server/routes/production.ts:1087` — `.then(async (result) => { if (clientAbortController.signal.aborted || !isResponseWritable(res)) return;` 早退分支：客户端断开时 run 行停留在 `running`，无终态化、无测试断言该分支的 run 终态。`tests/production-stream-disconnect.test.ts` 已有断连用例骨架（测配额退还/fallback），只缺 run 终态断言。
2. `server/routes/continuation.ts:391-406` — `pruneParseDocJobs`：`if (job.createdAt < cutoff)` 即 `abort + delete`，**不区分任务是否运行中**。`tests/continuation-extraction-job-recovery.test.ts` 覆盖了重启恢复（:43）、过期终态清理（:97）、显式 cancel（:174），唯独没有"TTL 命中运行中任务"。
3. `src/components/EditorView.tsx:1679-1682` — `consumedCapabilityLaunchTokenRef.current = null` 的重置 effect 以 `capabilityLaunchState?.launchToken` 为依赖：离开编辑器时 `src/App.tsx:53-57` 只清 continuationLaunchState 不清 capabilityLaunchState → 返回编辑器时 ref 归零、旧 launchState 被重新消费。`src/tests/capability-launch-state.test.ts:33` 只测 store 层"消费即清 token"，无 EditorView 往返场景。
4. `src/components/AppShell.tsx:1337` — `<EditorView key={`${selectedNovel.id}:${continuationLaunchState?.approvedPackId || 'default'}`}`：写作中途换续写包会重挂载整个编辑器（本地 UI 态/undo 栈全丢）。无任何测试渲染 AppShell 的这段 key 逻辑。
5. `src/components/AppShell.tsx:845-849` — 助手正文写入 `updateChapter(target.id, { content, wordCount, updatedAt })` **不带 databaseGeneration**（跨标签页 TOCTOU 盲写窗口）。`src/tests/app-shell-project-assistant.test.tsx` 全文无 databaseGeneration 断言。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 前端定向 | `npm run test:frontend -- src/tests/<file>` | all pass |
| 后端定向 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/<file>` | all pass |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npx eslint <改动文件> --max-warnings=0` | exit 0 |

## Scope

**In scope**（只改测试文件；本计划**不改任何源码行为**）:
- `src/tests/draft-generation-safety.test.ts`
- `src/tests/writing-surface-quality-guard.test.ts`
- `src/tests/app-shell-capability-launch.test.tsx`（或新建 `src/tests/editor-launch-remount.test.tsx`）
- `src/tests/app-shell-project-assistant.test.tsx`
- `tests/production-stream-disconnect.test.ts`
- `tests/continuation-extraction-job-recovery.test.ts`

**Out of scope**: 一切 `src/components/`、`src/lib/`、`server/` 源码修改。发现断言无法在不改源码的情况下写成（即行为与审计描述不符）→ STOP。

## Steps

### Step 1: (a-1) 把丢输入行为转为显式特征化断言

在 `draft-generation-safety.test.ts:101` 用例中：捕获 :117 的 `setCurrentChapter` updater 函数，构造含用户键入的前状态（如 `{ ...chapter, content: baseline + '用户流式期间的手打输入' }`），应用 updater 后断言 `content === baselineContent`（用户输入被丢弃），并在断言上方加注释：
```ts
// 特征化测试：登记已知缺陷「流式期间用户输入在失败回滚时被静默丢弃」。
// 修复该缺陷时，本断言应翻转为「用户输入保留」，勿删除。
```
原 :114-127 其余断言保持。

**Verify**: `npm run test:frontend -- src/tests/draft-generation-safety.test.ts` → 全绿。

### Step 2: (a-2) quality-guard 测试去实现钉死

删除 :22-30 中 `readOnly={false}`、`onRunAudit` 正则、JSX 结构正则三断言；:8-20 的假内容 `not.toContain` 列表与 :32-35 文案断言**保留**。若仓库已有 WritingSurface 渲染测试可仿（`grep -rl "WritingSurface" src/tests/`），补一个行为断言：生成态下渲染组件，`textarea` 的 `readOnly` 为 false（同样加特征化注释）；渲染脚手架超过 50 行则放弃行为断言，只删实现钉死断言。

**Verify**: `npm run test:frontend -- src/tests/writing-surface-quality-guard.test.ts` → 全绿。

### Step 3: 盲区 1——production 早退分支 run 终态

在 `tests/production-stream-disconnect.test.ts` 既有断连用例中追加：断开客户端后等待 pipeline settlement，查询该 run 行（测试内已有 db 访问路径，仿文件内既有查询写法），断言 `run.status === 'running'`（特征化：登记"早退分支不做终态化"缺陷），加特征化注释。

**Verify**: `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/production-stream-disconnect.test.ts` → 全绿。

### Step 4: 盲区 2——TTL 命中运行中 job

在 `continuation-extraction-job-recovery.test.ts` 补用例（仿 :97 的过期时间戳注入写法，但 job 保持 active 状态）：触发 prune，断言该 job 的 abort 被调用且记录被删除（特征化：登记"TTL 不区分运行中"缺陷）。

**Verify**: 后端定向命令（同文件）→ 全绿。

### Step 5: 盲区 3+4——launchState 残留重消费 + 换包重挂载

在 `app-shell-capability-launch.test.tsx`（渲染 AppShell 的既有用例基础上）补两个用例：
1. 置 capabilityLaunchState → 导航进 editor → 消费 → 导航去 library → 再回 editor，经 `onCapabilityLaunchConsumed` 调用计数探针断言消费发生 ≥2 次（特征化：登记"App.tsx 不清 capabilityLaunchState 导致重消费"缺陷）。
2. 同一 novel 下变更 `continuationLaunchState.approvedPackId`，以 useEffect 计数或 `key` 探针断言 EditorView 重挂载（特征化：登记"换包重挂载丢 UI 态/undo 栈"缺陷）。
渲染脚手架完全仿文件内既有用例；若文件不渲染 AppShell 全量结构而只测 EditorView，则新建 `src/tests/editor-launch-remount.test.tsx` 并在 AppShell 渲染测试（`grep -rl "AppShell" src/tests/` 找宿主）中补。

**Verify**: `npm run test:frontend -- src/tests/app-shell-capability-launch.test.tsx`（及新文件）→ 全绿。

### Step 6: 盲区 5——助手写入无代际

在 `app-shell-project-assistant.test.tsx` 的 apply 用例中追加断言：`updateChapter` 调用参数不含 `databaseGeneration` 键（`expect(mock.calls[0][1]).not.toHaveProperty('databaseGeneration')`），加特征化注释（登记 TOCTOU 缺陷）。

**Verify**: `npm run test:frontend -- src/tests/app-shell-project-assistant.test.tsx` → 全绿。

## Test plan

本计划全部产物即测试。收尾跑 `npm run test:frontend`（全量）与 `npm test`（后端全量）确认无连带破坏；前端全量约 10 分钟属正常（MEMORY.md 记录口径约 618s）。

## Done criteria

- [ ] 两个定向后端测试 + 四个定向前端测试全绿
- [ ] `npm run test:frontend` 全量通过；`npm test` 全量通过
- [ ] `grep -n "readOnly={false}" src/tests/writing-surface-quality-guard.test.ts` 无匹配
- [ ] 新增/修改的每个特征化断言旁有「特征化测试 + 登记缺陷 + 修复时翻转」注释
- [ ] `git status` 改动仅在 In scope 六个测试文件内
- [ ] `plans/README.md` 254 行状态更新

## STOP conditions

- 任一"缺陷行为"与实际代码不符（行为已变——说明审计结论过期或已被修复，报备后改登记为回归测试）。
- 渲染 AppShell/EditorView 的脚手架需要 >80 行新 mock（复杂度超预期，需人工决定切入点）。
- Step 3 中断连用例的 pipeline settlement 无法在测试窗口内确定（时序不可控，需人工设计）。

## Maintenance notes

- 本计划产出的特征化断言是后续修复计划的"翻转点"：修复 run 终态化/TTL 宽限/launchState 清理/助手写入带代际/回滚保输入时，先翻转对应断言（红→改期望→绿），再改源码。
- 审查重点：特征化注释是否齐全——没有注释的特征化断言会在半年内被当成"正确行为"守护。
