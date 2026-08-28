# Plan 164: 阻断不可信结构化审稿结果

> **Executor instructions**: 先完成漂移检查，再按步骤执行。保留现有宽松解析器的兼容行为；严格校验只能作为新增诊断层使用。不得读取、写入或修改生产 `data.db`、WAL 文件、`.env`、API Key 或 Provider 配置。

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plan 162
- **Category**: bug
- **Planned at**: commit `f4eac24`, 2026-08-20

## Why this matters

审稿解析器为兼容旧 Provider，会把缺少 `snippet`、`explanation` 或 `patchHint` 的问题项过滤掉，并继续返回看似有效的结构化结果。当前 `/api/audit` 在五维和结构化分支都可能据此生成 `pass/fail` 结果；因此“模型返回了坏契约”会被误显示成“没有问题”或可接受审稿。完成后，宽松解析仍服务旧数据，但当前审稿结果只要存在结构化契约损坏就进入 `unknown`，不提交可接受的通过/失败结论。

## Current state

- `shared/lib/audit-structured.ts:261-318` 的 `normalizeStructuredAuditIssue()` 和数组过滤会静默丢弃非法问题项；`parseStructuredAuditResponse()` 与 `parseAuditFiveDim()` 仍需保持此兼容行为。
- `server/routes/audit.ts:310-350` 先调用 `parseAuditFiveDim()`、`evaluateAuditGate()`，再转换结构化结果并提交配额；`server/routes/audit.ts:353-375` 对结构化结果只按分数和 critical 问题判定。
- `scripts/run-chapter-llm-acceptance.ts:263-326` 已有评测层的原始问题数和规范化问题数记录，但生产路由没有同等严格诊断。
- 已有兼容测试 `tests/audit-structured.test.ts:265-354` 要求缺失数组和非法项仍可宽松解析；新测试必须把严格诊断与宽松 API 分开。

## Scope

**In scope**

- `shared/lib/audit-structured.ts`
- `server/routes/audit.ts`
- `tests/audit-structured.test.ts`
- `tests/audit-rewrite.test.ts`
- `tests/audit-unknown-contract.test.ts`
- `plans/README.md`

**Out of scope**

- 不改变 `parseStructuredAuditResponse()`、`parseAuditFiveDim()` 的既有返回兼容语义。
- 不修改数据库 Schema、配额事务、Provider Prompt、前端审稿组件或生产配置。
- 不把原始审稿正文、Prompt、Provider 响应写入日志或测试报告。

## Steps

### Step 1: 增加脱敏严格契约诊断

在 `shared/lib/audit-structured.ts` 增加纯函数诊断 API，返回 `valid`、稳定 `violation`、原始问题数和规范化问题数。覆盖：`fatalIssues` 缺失/非数组、原始数组非空但有条目被过滤、低分或任一维度 `<4` 却没有完整问题单、五维 `pass` 与评分门禁矛盾、结构化分数低于 60 且无问题。不要改宽松解析器的输出。

**Verify**: `NODE_ENV=test node --test --import tsx tests/audit-structured.test.ts` → 既有兼容测试及新增严格诊断测试全部通过。

### Step 2: 在审稿路由提交前执行严格诊断

在 `server/routes/audit.ts` 的五维和结构化分支，在 `commitQuotaReservation()` 前运行严格诊断。契约不可信时不返回 `pass/fail`，更新 job 为已完成但结果 `status: 'unknown'`，只保留稳定错误码和脱敏诊断字段；保留现有正常空问题结果可通过的行为。不得重复扣配额，也不得把未知结果持久化为章节审稿结论。

**Verify**: `NODE_ENV=test node --test --import tsx tests/audit-rewrite.test.ts tests/audit-unknown-contract.test.ts` → 路由契约失败为 `unknown`，配额只结算一次，既有正常审稿测试通过。

### Step 3: 追加回归契约矩阵

新增测试覆盖：五维低分空问题、五维低分 `pass:true`、五维高分 `pass:false`、五维部分非法问题、结构化高分非法问题、结构化缺失/非数组问题、合法高分空问题仍可通过。保留宽松 parser 的非法项过滤 characterization 测试，证明严格层没有破坏兼容 API。

**Verify**: `node --test --import tsx tests/audit-structured.test.ts tests/audit-rewrite.test.ts tests/provider-quality-evaluation.test.ts` → 全部通过。

### Step 4: 总体验收

```bash
npm run typecheck
npm run lint
node --test --import tsx tests/audit-structured.test.ts tests/audit-rewrite.test.ts tests/audit-unknown-contract.test.ts tests/provider-quality-evaluation.test.ts
git diff --check
```

## Done criteria

- [ ] 宽松 parser 兼容测试不变且通过。
- [ ] 任何原始问题项被静默丢弃、必需问题单缺失或评分/pass 矛盾时，审稿 job 结果为 `unknown`。
- [ ] 合法的高分空问题结果仍可返回 `pass`；正常低分完整问题结果仍返回 `fail`。
- [ ] 严格诊断不记录正文、Prompt、Provider 原文或密钥。
- [ ] typecheck、lint、定向 Node 测试和 diff check 全部通过。

## STOP conditions

- 需要修改数据库 Schema、配额表、生产配置或前端 API 响应之外的字段。
- 现有宽松 parser characterization 测试必须改变才能通过。
- 无法在不暴露原始 Provider 内容的情况下提供诊断。

## Maintenance notes

严格诊断是生产结果门禁；宽松解析仍用于读取历史审稿和兼容旧 Provider。以后新增审稿字段时，先更新严格契约测试，再决定是否允许该字段成为可接受结果的一部分。
