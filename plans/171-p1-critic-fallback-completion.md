# Plan 171: 收口 Critic 严格合同、fallback 接受边界与章节完成审阅

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report. Do not modify files outside Scope.
> This plan is dispatched by an advisor; do not update `plans/README.md`.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plan 170 (DONE)
- **Category**: bug
- **Planned at**: commit `32a6b40`, 2026-08-24

## Why this matters

正文生产的 Critic 仍能把纯文本 `PASS` 当成通过，协作 Critic 也没有声明 JSON 能力；这会让未经结构化审阅的草稿进入“通过”分支。生产 fallback 草稿目前能复用普通“接受并写入”，造成“保底内容已审阅”的错误信号。章节完成审阅只发送长章前缀，也未校验分数边界，尾段伏笔和越界结果可能被错误接受。本计划只收口这三条 P1 正确性边界，不重做 Plan 161/165/166/168 的候选和去 AI 腔逻辑。

## Current state

- `server/helpers/ai-production-pipeline.ts:21-45` 的 `classifyCriticFeedback` 先调用结构化解析，失败后用正则识别 `PASS`/`FAIL`；`server/helpers/ai-production-pipeline.ts:287-297` 对 `audit-json` 结果仍调用该宽松分类，`unknown` 还会结束生产重试。
- `server/routes/agents.ts:689-701` 的协作 Critic 请求只传 prompt 和通用选项，没有 `outputMode: 'audit-json'` 或 `responseMimeType: 'application/json'`；`server/routes/agents.ts:722` 对 `pass || unknown` 都结束循环。
- `src/components/ProductionRunReview.tsx:70-80` 的 `canApply` 只检查 `review_required`、质量门和当前 run，没有拒绝 `auditMeta.source === 'fallback'`。
- `server/routes/production.ts:400-414` 给 fallback run 写入 `status: 'review_required'`、`auditMeta: { status: 'not_run', source: 'fallback' }` 并创建 fallback version；`server/routes/production.ts:1023-1071` 允许 `review_required` 或带草稿的 `failed` run，且 `acceptUnreviewed` 可绕过未审阅检查。
- `server/routes/production.ts:1040-1052` 允许显式选择 `version.source === 'fallback'`；`server/routes/production.ts:1102-1107` 将非 model 来源落为 fallback。
- `server/helpers/chapter-completion.ts:52-70` 的 `defaultReview` 没有 `outputMode`/`responseMimeType`，正文使用 `content.slice(0, 12000)`，只覆盖前缀；`audit.score >= 60` 没有确认 0–100 数字范围。解析失败返回 unknown，但没有严格诊断和尾段窗口合同。
- 现有测试刻画了需要改掉的旧信任边界：`tests/critic-status-contract.test.ts:9-11` 和 `src/tests/p0-ai-trust.test.ts:19-23` 允许纯文本 PASS；`tests/production-versions.test.ts:78-87` 明确允许应用 fallback 版本；`src/tests/production-run-review.test.tsx` 尚未覆盖 fallback 禁用；`tests/chapter-completion.test.ts` 覆盖完成状态但没有长章窗口、越界分数和 Provider transport 断言。

Plan 170 的解析器改动可能仍以未提交工作区形式存在，但本计划 Scope 不修改 `shared/lib/audit-structured.ts`；若执行分支缺少其 API，必须按 STOP 条件报告，不能复制或重写 Plan 170。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Critic/fallback/completion tests | `NODE_ENV=test node --test --import tsx tests/critic-status-contract.test.ts tests/production-versions.test.ts tests/chapter-completion.test.ts` | All tests pass, including new strict/fallback/window cases |
| Frontend review gate | `npm run test:frontend -- --run src/tests/production-run-review.test.tsx src/tests/p0-ai-trust.test.ts` | All selected Vitest tests pass |
| Typecheck | `npm run typecheck` | Exit 0 |
| Lint | `npm run lint` | Exit 0 |
| Diff check | `git diff --check` | No output, exit 0 |

## Scope

**In scope (only these files):**

- `server/helpers/ai-production-pipeline.ts`
- `server/routes/agents.ts`
- `server/routes/production.ts`
- `server/helpers/chapter-completion.ts`
- `src/components/ProductionRunReview.tsx`
- `tests/critic-status-contract.test.ts`
- `src/tests/p0-ai-trust.test.ts`
- `tests/production-versions.test.ts`
- `src/tests/production-run-review.test.tsx`
- `tests/chapter-completion.test.ts`
- `tests/production-prompt-sentinel.test.ts`

**Out of scope:**

- `shared/lib/audit-structured.ts`, `server/lib/server-llm.ts`, prompt templates, database schema/migrations, `data.db`/WAL/SHM, `.env`, dependencies, Plan 170 files, and unrelated UI or production routes.
- Do not add a second parser, loosen the structured contract, or turn Provider failure into fallback success.

## Steps

### Step 1: Make Critic classification strict at the Provider boundary

Add a strict critic classification path that consumes the existing
`parseAuditResponseWithDiagnostics` contract. `pass` is allowed only for a
complete structured audit with valid required fields, valid score range and a
passing result. Plain `PASS`, ordinary prose, malformed JSON, truncated JSON,
and unavailable responses must be `unknown` (or an explicit `fail` only when a
valid structured audit says fail). Keep the existing exported function only if
legacy callers need it, but production and collaboration paths must use strict
classification. Send `outputMode: 'audit-json'` and
`responseMimeType: 'application/json'` in `server/routes/agents.ts`; preserve
the existing Provider compatibility retry behavior. Unknown Critic status must
not be treated as a successful completion; it may stop a retry loop only while
the resulting run remains unaccepted and visibly unreviewed.

**Verify**: the Critic tests below prove plain PASS/prose/invalid JSON are not
pass and a valid structured pass is pass:

`NODE_ENV=test node --test --import tsx tests/critic-status-contract.test.ts`

### Step 2: Block ordinary fallback acceptance

At the server apply boundary reject any selected run/version whose audit source
is `fallback`, with a stable error code and retriable message. The rejection
must happen before chapter writes, version-history mutation, or fact-candidate
creation, and must apply to both implicit current drafts and explicit fallback
version selection. Do not let `acceptUnreviewed` bypass this source check.
Update `ProductionRunReview` so fallback results show a clear “保底草稿未经过模型审稿” state and the ordinary “接受并写入” button is disabled. Preserve an explicit retry/regenerate path; do not create a new artificial success state.

Update tests to assert: model source still applies; fallback source returns the
stable rejection and leaves chapter/version state unchanged; frontend disables
the action and does not invoke `onApply`.

**Verify**:

`NODE_ENV=test node --test --import tsx tests/production-versions.test.ts`

`npm run test:frontend -- --run src/tests/production-run-review.test.tsx`

### Step 3: Make chapter completion review structured and complete

Use the existing strict parser from `shared/lib/audit-structured.ts`; do not
reimplement it. The `defaultReview` request must set
`outputMode: 'audit-json'` and `responseMimeType: 'application/json'` while
retaining timeout, abort, and governed request behavior. Replace the single
`content.slice(0, 12000)` prefix with a bounded labeled window containing the
full short chapter and beginning/middle/end excerpts for long chapters. The
window must include the final scene/hook and remain within a finite budget.
Keep scene beats bounded and labeled separately.

Reject parse results with invalid root/fields, missing fatalIssues, truncated
JSON, or score outside the inclusive 0–100 range. A rejected/unknown review
must never produce a pass or accepted completion result. Preserve existing
retry and stale-generation behavior.

Add tests with a >12,000-character fixture asserting the Provider prompt
contains beginning, middle, and ending markers; assert request options include
the JSON transport contract; assert scores -1 and 101 are unknown/failure and
cannot mark completion ready; assert malformed/truncated responses remain
unknown.

**Verify**:

`NODE_ENV=test node --test --import tsx tests/chapter-completion.test.ts`

### Step 4: Run scoped gates and audit scope

Run all commands in the table. Inspect the complete diff and confirm every
hunk maps to Steps 1–3. Do not update or commit the user's `plans/README.md`
from the executor worktree; report the branch and commit for advisor review.

## Test plan

- Extend `tests/critic-status-contract.test.ts` and `src/tests/p0-ai-trust.test.ts` with strict structured pass/fail, plain PASS, prose, truncated JSON, and score-boundary cases.
- Change `tests/production-versions.test.ts` fallback expectation from success to stable rejection and state immutability; retain model apply coverage.
- Add `ProductionRunReview` fallback rendering/disabled-action coverage to `src/tests/production-run-review.test.tsx`.
- Add chapter completion Provider mock assertions for transport options, long-window labels, malformed JSON, and out-of-range score; update the production prompt sentinel fixture to return a valid structured Critic JSON response instead of legacy plain `PASS`.
- Keep fixtures isolated and do not use production `data.db`.

## Done criteria

- [ ] Plain-text `PASS`, prose, malformed or truncated Critic output never yields `pass`.
- [ ] Valid structured Critic pass is the only path that can mark a production Critic pass; collaboration requests negotiate JSON.
- [ ] Any fallback-source run/version is rejected by ordinary apply before writes, with a stable error code and retriable UI state.
- [ ] Chapter completion reviews use JSON transport, bounded beginning/middle/end windows, strict parser and 0–100 score validation.
- [ ] Unknown/failed review does not create an accepted completion result.
- [ ] Scoped tests, typecheck, lint and diff check pass.
- [ ] `git diff --name-only` contains only Scope files (plus the executor's commit metadata).

## STOP conditions

- Any Scope file differs from the Current state in a way that requires Plan 170 files or a new parser; stop and report drift.
- Strict Critic behavior requires changing the public SSE event shape or database schema; stop and report instead of widening Scope.
- Fallback rejection would break an existing explicitly documented human-confirmation product flow; stop and report the conflict rather than silently replacing it.
- A test needs `data.db`, WAL/SHM, `.env`, a real API key, a new dependency, or a live Provider; stop immediately.
- Any verification command fails twice, or a fix would touch an out-of-scope file.

## Maintenance notes

- Future Critic schema changes must update the strict parser contract and these
  tests together; never restore marker-based PASS detection at a Provider
  boundary.
- If a deliberate manual fallback acceptance flow is product-approved later,
  add a separate, explicitly named endpoint and audit event; do not reuse the
  ordinary model-reviewed apply path.
- If chapter window budgets change, retain labeled end coverage and add a
  regression test for the final hook.
