# Plan 169: 收口审稿 Provider 结构化输出稳定性

> **Executor instructions**: 严格按步骤执行，每步完成后运行对应验证命令。只修改 Scope 中的文件；遇到 STOP 条件立即停止并报告，不要把审稿失败降级为通过，不要读取或写入生产数据库、`.env` 或任何 API Key。

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/162-real-provider-evaluation-metrics.md、plans/164-strict-audit-contract-gate.md、plans/166-anti-ai-literary-structure-loop.md、plans/168-capability-context-rewrite-candidate.md
- **Category**: bug / tests
- **Planned at**: commit `f4eac24`, 2026-08-23

## Why this matters

真实 Provider 三样本目前均为 `LIVE audit_response_unparseable`，没有候选或接受结果。根因不是单纯的按钮或写入链路，而是审稿 JSON 被当成正文进入去 AI 腔质量门、请求没有稳定的 JSON 输出能力、长章只送审前缀、解析错误无法分类。完成本计划后，审稿请求应只接受经过结构化合同验证的结果，整章审阅应覆盖尾段与伏笔，失败应可重试且不展示未经脱敏的 Provider 原文。

## Current state

- `server/routes/audit.ts:322-332` 调用 `generateText` 生成审稿结果，追加 `AUDIT_OUTPUT_CONTRACT`，但没有声明结构化审稿输出模式。
- `server/helpers/prompt-guard.ts:54-64` 将包含 `audit`、`critic`、`章节` 的请求判为创作；`server/helpers/prompt-guard.ts:560-609` 对结果执行正文俗套检测和纯正文纠错。审稿 JSON 引用“他深吸一口气”等问题片段时会被误判为低质量正文。
- `server/lib/server-llm.ts:290-298` 仅当 `responseMimeType === 'application/json'` 时发送 `response_format`。当前审稿调用未传该参数；兼容逻辑在 `server/lib/server-llm.ts:962-970` 已支持参数不兼容后的纯 Prompt 降级，不能因此跳过能力声明。
- `shared/config/prompt-templates.ts:197-225` 的 `manualAudit` 仍包含 `0-10`、`true或false` 这类伪 JSON 示例，并在末尾追加另一套合同。
- `server/routes/audit.ts:208-215` 使用 `truncateForAudit(draftContent, 2600)`，4000 字以上章节的中后段不进入 Provider 审稿。
- `shared/lib/audit-structured.ts:109-116` 采用首个 `{` 和最后一个 `}` 截取候选；`shared/lib/audit-structured.ts:339-351` 解析失败直接返回 `null`。`scripts/run-chapter-llm-acceptance.ts:329-352` 将多种失败汇总成 `audit_response_unparseable`。
- `server/routes/audit.ts:404-412` 将 `rawFeedback` 放入未知结果；`src/lib/hooks/generation/useAuditPolishActions.ts:273-277` 和 `src/components/WritingSurface.tsx:239-243` 会把未经脱敏的模型原文展示给用户。

## Scope

**In scope**

- `server/lib/server-llm.ts`
- `server/routes/audit.ts`
- `server/helpers/ai-production-pipeline.ts`
- `server/helpers/prompt-guard.ts`
- `server/helpers/prompt-helpers.ts`
- `shared/config/prompt-templates.ts`
- `shared/lib/audit-structured.ts`
- `scripts/run-chapter-llm-acceptance.ts`
- `src/lib/hooks/generation/useAuditPolishActions.ts`
- `src/components/WritingSurface.tsx`
- `tests/server-llm.test.ts`
- `tests/audit-structured.test.ts`
- `tests/audit-rewrite.test.ts`
- `tests/audit-evidence-route.test.ts`
- `tests/provider-quality-evaluation.test.ts`
- `tests/fixtures/chapter-llm-acceptance-report.md`
- `tests/fixtures/chapter-llm-acceptance-report.json`
- `plans/README.md`

**Out of scope**

- 数据库 schema、migration、`data.db`、WAL/SHM 文件
- `.env`、配置文件中的密钥、Provider 原始响应持久化
- 任意新依赖
- 正文候选接受/版本写入合同（Plan 165/168 已覆盖）
- 将真实 Provider 失败替换为 fallback 成功

## Steps

### Step 1: 隔离结构化审稿生成模式

为 `GenerateTextOptions` 增加明确的结构化输出模式（命名应与现有风格一致，例如 `outputMode: 'prose' | 'audit-json'`）。`audit-json` 必须：不注入正文专用 `PROMPT_GUARD_RULES`，不运行 `checkOutputGuard` 或正文纠错；仍保留超时、Abort、reasoning 过滤、Provider 错误脱敏和请求计数。审稿路由、生产管线 critic、Provider 评测 audit/re-audit 调用统一使用该模式。普通 writer/rewrite 行为不变。

**Verify**: `NODE_ENV=test node --test --import tsx tests/server-llm.test.ts tests/audit-rewrite.test.ts`；新增用例证明带 AI 腔引用的合法审稿 JSON 原样返回，普通正文仍会触发质量门。

### Step 2: 统一且可协商的 JSON 合同

将 `manualAudit` 改为单一合法 JSON 示例，删除 `0-10`、`true或false` 等伪 JSON；保留 `AUDIT_OUTPUT_CONTRACT` 的字段、分数总和、`fatalIssues` 和 evidence 约束。`audit-json` 请求声明 `responseMimeType: 'application/json'`；复用现有 Provider 兼容回退，只在收到明确的 `response_format` 参数不兼容时重试纯 Prompt 模式，并在诊断元数据中标记 `plain_fallback`。不得把 Provider 返回 Markdown 或纯文本当成功。

**Verify**: `NODE_ENV=test node --test --import tsx tests/server-llm.test.ts tests/audit-five-dimension-contract.test.ts tests/provider-quality-evaluation.test.ts`；检查首个请求带 `response_format`，兼容失败后第二次请求明确不带该字段且状态为 `plain_fallback`。

### Step 3: 覆盖完整章节的审稿窗口

替换单一 2600 字前缀截断。实现无副作用的审稿窗口构造：至少包含开头、中段、结尾，结尾必须覆盖最后一个场景与伏笔/钩子；每个窗口保留正文原文和明确位置标签，保持 `fatalIssues.snippet` 能精确匹配原正文。若章节短于窗口预算，使用完整正文。不得把窗口拼接成误导模型的连续正文，也不得扩大到无限 token。

**Verify**: `NODE_ENV=test node --test --import tsx tests/audit-rewrite.test.ts tests/provider-quality-evaluation.test.ts`；新增测试断言 4000+ 字 fixture 的尾段和章末钩子进入 prompt，短正文仍完整传递。

### Step 4: 提升审稿 JSON 解析和失败分类

使用仓库已有的平衡 JSON 解析能力或等价实现，支持合法 JSON 前后的非结构化文字和代码围栏，但严格拒绝截断、错误根节点和字段合同不完整。解析诊断只输出脱敏元数据，至少区分 `no_candidate`、`truncated`、`invalid_json`、`missing_fatal_issues`、`filtered_fatal_issue`、`plain_text`。`audit_response_unparseable` 只能作为兼容汇总，不得丢失具体原因。

**Verify**: `NODE_ENV=test node --test --import tsx tests/audit-structured.test.ts tests/provider-quality-evaluation.test.ts`；覆盖合法 JSON、Markdown 包裹、前置说明、reasoning 块、截断 JSON、未转义引号、缺失/非法 `fatalIssues`。

### Step 5: 未知结果脱敏与可恢复 UI

未知审稿结果只返回错误类别、合同诊断摘要、重试标志和 trace ID；不要把 `rawFeedback` 返回或渲染到前端。前端显示“审稿结果未确认”的原因映射、重试按钮和保留正文提示。现有结果状态、取消、切章和代次隔离行为必须保持。

**Verify**: `NODE_ENV=test node --test --import tsx tests/audit-evidence-route.test.ts tests/audit-rewrite.test.ts`，并运行 `npm run test:frontend -- --run src/tests/audit-polish-actions.test.ts`；断言响应不含 Provider 原文，UI 仍有明确重试入口。

### Step 6: 真实 Provider 评测与全量门禁

先运行 deterministic 评测确认报告仍标记 `FALLBACK`；再在隔离配置下运行 `--live-only`。真实 Provider 仍失败时必须保留失败状态和具体脱敏原因，不能 fallback 伪通过。最后运行：

```bash
npm run typecheck
npm run lint
npm test
npm run test:frontend
npm run build
npx playwright test
git diff --check
```

## Done criteria

- [ ] 结构化审稿不会进入正文俗套纠错门；普通正文质量门行为不变
- [ ] 审稿首请求使用 JSON 能力协商，兼容降级可观测且不伪装成功
- [ ] 4000+ 字章节审稿 prompt 覆盖开头、中段、结尾和章末伏笔
- [ ] 解析测试覆盖前缀、reasoning、围栏、截断和字段缺失
- [ ] 未知结果不返回或渲染未经脱敏的 Provider 原文
- [ ] 真实 Provider 失败仍为 `LIVE` 失败，deterministic 仍为 `FALLBACK`
- [ ] 全量门禁通过，且没有 Scope 外文件变更

## STOP conditions

- 当前代码与 Current state 不一致且需要扩大 Scope
- Provider 必须读取生产配置、生产数据库或明文密钥才能验证
- JSON 模式兼容性需要新增依赖或修改数据库
- 为了让 live-only 通过而引入 fallback、放宽合同或吞掉 Provider 错误
- 完整章节窗口无法在既有超时/并发约束内实现

## Maintenance notes

- 任何新的结构化 LLM 输出必须选择明确 output mode，不能再依赖关键词猜测是否为正文。
- Provider 或模型变更后，先跑 deterministic，再单独跑 live-only；两者不得合并指标。
- 审稿窗口预算变化时必须重新验证结尾伏笔覆盖和 snippet 精确匹配。
- 原始 Provider 响应只允许在受控本地诊断中短暂使用，不得进入 API、事件、数据库或前端。
