# Plan 170: 统一评测端审稿 JSON 解析，消除中文引号误判

> **Executor instructions**: 只执行本计划列出的文件变更。先完成 drift check 和复现，再修改解析路径。不要放宽审稿合同、不要把 Provider 失败转换为成功、不要保存或输出 Provider 原文。工作区已有 Plan 169 相关本地修改，必须保留，不能回滚。

## Status

- **Priority**: P1
- **Effort**: S/M
- **Risk**: LOW/MED
- **Depends on**: `plans/169-audit-provider-structured-output-stability.md`
- **Category**: bug / tests
- **Planned at**: commit `32a6b40`, 2026-08-24

## Why this matters

真实 Provider 返回的审稿 JSON 可能在 `fatalIssues.snippet` 或评分说明中包含中文弯引号。当前评测器的严格解析器已经可以保留这些字符，但 `inspectRawIssueContract()` 仍调用会全局替换中文引号的旧解析器，导致同一响应出现“规范化问题数大于 0、却被判定为 `missing_fatal_issues`”的矛盾结果。这样会污染 live-only 报告，阻碍对 Provider 文学质量的真实判断。

本计划只修复评测端的解析一致性和回归测试，不改变服务端审稿合同、前端状态、数据库、Prompt 质量门或 fallback 策略。

## Current state

- `scripts/run-chapter-llm-acceptance.ts:301-310` 的 `inspectRawIssueContract()` 调用 `extractJsonPayload()`。
- `shared/lib/extract-skill-json.ts:1-10` 会把 `“”` 全局替换成 `"`，会破坏 JSON 字符串中合法的中文对白引号。
- `shared/lib/audit-structured.ts:121-163` 的平衡 JSON 扫描不会做该替换；`parseAuditResponseWithDiagnostics()` 可正确解析同一响应。
- `scripts/run-chapter-llm-acceptance.ts:323-404` 同时维护严格解析、宽松合同视图和旧 raw 合同检查，多个结果可能互相覆盖诊断。
- 已复现：严格解析同一份含 `“你真的要去吗？”` 的五维 JSON 得到 1 个问题；评测器得到 `contractViolation=missing_fatal_issues`、`rawIssueCount=null`、`normalizedIssueCount=1`。

当前工作区在计划基线之后可能仍有 Plan 169 的本地修改，执行前必须检查并保留它们。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Drift check | `git diff --stat 32a6b40..HEAD -- scripts/run-chapter-llm-acceptance.ts shared/lib/audit-structured.ts tests/provider-quality-evaluation.test.ts tests/audit-structured.test.ts` | 只显示已知 Plan 169 变化；若出现未识别变更，停止并报告 |
| Reproduce baseline | `node --import tsx -e "...含中文弯引号的审稿 JSON..."` | 基线复现旧路径 `missing_fatal_issues`，供修复前后对照 |
| Targeted backend tests | `NODE_ENV=test node --test --import tsx tests/audit-structured.test.ts tests/provider-quality-evaluation.test.ts` | 全部通过 |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Diff check | `git diff --check` | 无输出、exit 0 |

## Scope

**In scope (only these files)**

- `scripts/run-chapter-llm-acceptance.ts`
- `shared/lib/audit-structured.ts`（仅在需要共享解析结果时）
- `tests/provider-quality-evaluation.test.ts`
- `tests/audit-structured.test.ts`
- `plans/README.md`

**Out of scope**

- `server/routes/audit.ts`、`server/helpers/prompt-helpers.ts`、`shared/config/prompt-templates.ts`、`server/lib/server-llm.ts`
- `shared/lib/extract-skill-json.ts` 的其他调用方；不要为了本计划修改全局旧解析器
- 前端、数据库 schema、`data.db`、WAL/SHM、`.env`、API Key、依赖和 Provider 配置
- 任何将宽松别名映射为成功合同的改动

## Steps

### Step 1: Confirm drift and reproduce the false diagnostic

运行 drift check，并使用一份完整五维 JSON，令 `fatalIssues[].snippet` 包含中文弯引号。分别调用严格解析和 `parseAuditForEvaluation()`，记录两者的 issue count、diagnostic 和 contract violation。不要保存 Provider 原文或修改 fixture 报告。

**Verify**: 基线能复现 `normalizedIssueCount > 0` 但 `contractViolation=missing_fatal_issues`；若基线已不再复现，停止并报告代码漂移。

### Step 2: Make raw contract inspection use the same balanced JSON path

删除评测器对 `extractJsonPayload()` 的依赖。优先复用 `parseAuditResponseWithDiagnostics()` 已经得到的候选和结构化结果；如需共享原始字段计数，在 `shared/lib/audit-structured.ts` 增加最小的、脱敏的 payload 摘要接口，禁止重新引入全局中文引号替换。

要求：

- 合法 JSON 中的中文引号、中文对白和转义引号必须保留。
- `rawIssueCount` 与严格解析得到的 `fatalIssues` 数量一致；无法确认时保持 `null`，不能猜测为 0。
- `truncated`、`invalid_json`、`missing_fatal_issues`、`filtered_fatal_issue` 仍然失败，不得被宽松解析转换为通过。
- 评测端和服务端不得持久化 Provider 原文。

**Verify**: 目标回归测试显示含中文弯引号的合法响应 `contractViolation === null`，且 `rawIssueCount === normalizedIssueCount`；截断和字段缺失用例仍失败。

### Step 3: Add regression coverage for parser disagreement

在现有测试风格下补充：

- 五维评分说明含中文弯引号，`fatalIssues.snippet` 含中文对白时，评测结果不报 `missing_fatal_issues`。
- 合法 JSON 带前置说明、Markdown 围栏或 reasoning 块时，严格解析与 raw contract 摘要使用同一候选。
- 非法/截断 JSON、缺失 `fatalIssues`、不完整条目仍保留具体失败诊断。
- 确定性模式不触发 Provider，也不因为新摘要逻辑改变 fallback 结果。

不要删除已有的兼容性测试，不要把 `issues`、`problems` 等别名直接视为合法 `fatalIssues`。

**Verify**: `NODE_ENV=test node --test --import tsx tests/audit-structured.test.ts tests/provider-quality-evaluation.test.ts` 全部通过。

### Step 4: Run local gates and inspect scope

运行 typecheck、lint、diff check，检查 `git diff --name-only` 只包含 Scope 文件以及执行前已经存在的 Plan 169 改动。不要运行会写入生产数据库或覆盖 acceptance fixture 的命令。

**Verify**: 三个门禁 exit 0；范围外没有新增修改；Plan 169 的既有本地改动仍在。

## Test plan

- 结构化解析回归：`tests/audit-structured.test.ts`。
- Provider 评测回归：`tests/provider-quality-evaluation.test.ts`。
- 测试重点是中文引号、前缀/围栏/reasoning、截断、缺失字段和不完整条目的诊断一致性。
- 修复后再单独运行 `node --import tsx scripts/run-chapter-llm-acceptance.ts --live-only`；该命令的真实结果必须另行记录，不能用 deterministic 结果代替。

## Done criteria

- [ ] 评测器不再调用会全局替换中文引号的 `extractJsonPayload()`。
- [ ] 合法中文引号审稿 JSON 不再被误判为 `missing_fatal_issues`。
- [ ] `rawIssueCount` 与严格解析结果一致，无法确认时为 `null` 而不是猜测。
- [ ] 截断、非法 JSON、缺字段和不完整条目仍被拒绝并保留具体诊断。
- [ ] deterministic 与 live-only 结果没有 fallback 伪成功。
- [ ] 目标测试、typecheck、lint、diff check 通过。
- [ ] 只修改 Scope 文件，Plan 169 现有修改未被覆盖。

## STOP conditions

- drift check 发现无法归属的变更或当前代码已不匹配上述 Current state。
- 需要修改 Scope 外的服务端、Prompt、数据库或依赖才能完成。
- 为通过测试而放宽 `fatalIssues` 合同、吞掉 Provider 错误或引入 fallback。
- 无法在不保存 Provider 原文的前提下复现和验证诊断。

## Maintenance notes

今后新增审稿诊断字段时，必须从同一个平衡 JSON 候选派生，不能再次引入第二套会修改正文字符的解析器。真实 Provider 评测仍需在本计划完成后独立复测；若复测后仍有合同失败，再根据脱敏 shape 诊断制定 Prompt/Provider 适配计划。
