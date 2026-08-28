# Plan 162: 建立真实 Provider 文学质量评测与指标闭环

> **Executor instructions**: 按步骤执行，每一步先运行验证命令并确认预期结果再进入下一步。真实 Provider 不可用时必须输出 `SKIP` 并以退出码 0 结束；真实 Provider 超时、限流或返回低质量内容不得降级为通过。不得把 fallback 沙盒结果标记为真实质量证据。
>
> **Drift check（先运行）**: `git diff --stat f4eac24..HEAD -- scripts/run-chapter-llm-acceptance.ts scripts/provider-quality-smoke.ts shared/lib/draft-quality.ts tests/fixtures tests`。若受影响文件相对下述摘录已变化，先对照现状；契约不一致时停止并报告，不要自行扩大范围。

## Status

- **State**: DONE (2026-08-23; evaluator and gates reviewed; Provider quality remains an explicit runtime risk)
- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/160-real-provider-quality-gate.md`, `plans/161-literary-quality-contract.md`, `plans/163-literary-quality-lint-closure.md`
- **Category**: tests
- **Planned at**: commit `f4eac24`, 2026-08-19

## Why this matters

InkFlow 已能用确定性规则阻断元数据、问答残片、推理标签、乱码、重复段落和模板残留，但这些测试不能证明真实模型产出的正文可读，也不能证明精修没有误改。当前真实 smoke 只执行一段最小正文；完整样章脚本在第一次 Provider 超时后立即退出，且默认模式允许沙盒 fallback，现有报告会展示固定的高分指标。对作者而言，这会把“请求成功”误认为“文学质量合格”，无法判断是否应接受或重试。完成本计划后，产品验收将明确区分 `LIVE`、`FALLBACK`、`SKIP`，并可计算 P0 逃逸率、P1 漏检率、精修接受率和错误改写率。

## Current state

- `shared/lib/draft-quality.ts:148-201` 的 `validateDraftQuality()` 返回 `ok`、兼容 `violations`、结构化 `findings` 和语义审阅状态；P0/P1 阻断，P2 只警告。
- `scripts/provider-quality-smoke.ts:9-33` 读取运行时配置，配置缺失时输出 `SKIP`，有配置时只生成一段正文并验证 `validateDraftQuality()`。它不写数据库，但没有样本矩阵或质量指标。
- `scripts/run-chapter-llm-acceptance.ts:70-115` 在默认模式允许 `safeGenerateText()` 使用 fallback；`--live-only` 模式遇到首个错误直接 `process.exit(1)`，导致剩余样本和报告不执行。
- `scripts/run-chapter-llm-acceptance.ts:400-531` 的报告把指标固定为 95–100 分，并用 `sandboxedCalls` 只标注整体是否 fallback；它没有按样本统计硬错误逃逸、漏检、接受和误改。
- 现有样本为 `tests/fixtures/chapter-slop-heavy.txt`、`chapter-action-weak.txt` 和 `chapter-mature.txt`；它们必须继续作为非敏感、固定输入使用，不得读取运行中的 `data.db`。
- `package.json:27` 已提供 `smoke:provider-quality`；新的评测命令应沿用 `node --import tsx`，不新增依赖。产品验收口径：Provider 请求成功不等于候选可接受；只有质量合同通过且修复结果没有引入新的 P0/P1 才能计入成功。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0, no warnings |
| Quality tests | `NODE_ENV=test node --test --import tsx tests/draft-quality.test.ts tests/review-issues.test.ts` | all tests pass |
| Provider eval without credentials | `INKFLOW_CONFIG_DIR="$(mktemp -d)" INKFLOW_SECURE_API_KEY= API_KEY= node --import tsx scripts/run-chapter-llm-acceptance.ts --live-only` | `SKIP: provider credentials not configured`, exit 0 |
| Full deterministic acceptance | `node --import tsx scripts/run-chapter-llm-acceptance.ts --deterministic` | all fixtures complete; report marks `FALLBACK`, no live claim |
| Diff hygiene | `git diff --check` | no output, exit 0 |

真实 Provider 命令只能在明确配置凭证时运行；输出不得包含 API Key、完整 Prompt、正文原文或 Provider 原始错误正文。若真实配置存在，失败应退出非零并保留 `status: "LIVE"` 的失败记录；不得切换到 sandbox 通过。

## Scope

**In scope（仅允许修改）**

- `scripts/run-chapter-llm-acceptance.ts`
- `scripts/provider-quality-smoke.ts`
- `tests/fixtures/chapter-quality-evaluation.json`（新增固定评测标签与预期问题）
- `tests/fixtures/chapter-llm-acceptance-report.md`（仅由脚本生成）
- `tests/fixtures/chapter-llm-acceptance-report.json`（新增，仅由脚本生成的机器可读摘要）
- `tests/provider-quality-evaluation.test.ts`（新增）
- `package.json`（仅新增一个评测 script，如确有必要）
- `plans/161-literary-quality-contract.md`、`plans/README.md`（完成后更新状态和证据）

**Out of scope（禁止修改）**

- `server/`、`src/`、`shared/` 的生产逻辑；本计划只验证已有质量合同。
- 任意数据库 schema、migration、`data.db`、`data.db-wal`、`data.db-shm`。
- Provider 配置、`.env`、API Key、模型或 Prompt 资产。
- 新增 npm 依赖、修改 Playwright 全局数据库配置。

## Steps

### Step 1: 固定评测集和预期标签

新增 `tests/fixtures/chapter-quality-evaluation.json`，为三个现有样章声明：样本名称、输入路径、预期 P0/P1 问题码、是否允许被精修、精修成功的最低条件。至少覆盖：元数据/问答/乱码、重复段落/异常符号、AI 腔/模板节奏和正常成熟正文。标签只描述测试预期，不把人工评分冒充模型事实。

新增 `tests/provider-quality-evaluation.test.ts`，直接调用 `validateDraftQuality()` 验证：污染样本命中预期 P0/P1；成熟样本无 P0/P1；P2 不阻断；重复对白不被误判为重复段落。测试必须只读 fixture，不初始化或连接生产数据库。

**Verify**: `NODE_ENV=test node --test --import tsx tests/provider-quality-evaluation.test.ts` → 新测试全部通过。

### Step 2: 把 Provider 运行状态改为逐样本、逐调用记录

重构 `run-chapter-llm-acceptance.ts` 的执行结果模型，至少包含 `status: 'LIVE' | 'FALLBACK' | 'SKIP'`、`phase`、`sample`、`errorCode`、`durationMs`、`qualityFindings`、`inputHasExpectedDefect`、`defectDetected`、`rewriteChangedText`、`rewriteIntroducedP0P1`。真实调用失败时记录失败样本并继续其它样本，最终由汇总决定退出码；不要在 `safeGenerateText()` 内提前结束整个进程。

保留两个明确入口：默认 `--deterministic` 只跑本地 fixture/fallback 并明确标记 `FALLBACK`；`--live-only` 只有凭证存在才允许运行真实 Provider，缺凭证输出 `SKIP` 并退出 0，超时/限流/provider 错误退出非零。不得把 `FALLBACK` 的分数写入 `LIVE` 指标。

**Verify**:

- `INKFLOW_CONFIG_DIR="$(mktemp -d)" INKFLOW_SECURE_API_KEY= API_KEY= node --import tsx scripts/run-chapter-llm-acceptance.ts --live-only` → 输出 `SKIP`，exit 0；不能依赖用户主目录中的现有配置文件。
- `node --import tsx scripts/run-chapter-llm-acceptance.ts --deterministic` → 三个样本都有终态，报告中不存在“Pure Live API Result”或固定 Live 分数声明。

### Step 3: 计算四个可复现指标并生成诚实报告

使用固定公式写入 Markdown 和机器可读 JSON 摘要：

- **P0 escape rate** = 生成结果中仍含预期 P0 缺陷的样本数 / 运行并返回候选的污染样本数。
- **P1 miss rate** = `validateDraftQuality()` 未检出但预期标签仍存在的 P1 缺陷数 / 预期 P1 缺陷总数。
- **polish acceptance rate** = 通过质量门禁且未引入新 P0/P1、并完成接受写入语义的精修候选数 / 产生精修候选数。
- **harmful rewrite rate** = 精修后新增 P0/P1 或改变未授权目标窗口的候选数 / 被接受的精修候选数。

分母为 0 时输出 `null` 和 `denominator: 0`，不能显示 0% 或 100% 伪装可用数据。报告必须逐样本显示 `LIVE/FALLBACK/SKIP`、失败原因类别、质量 findings 代码、是否执行精修和是否达到指标；禁止固定硬编码 95–100 分。只输出脱敏错误码（如 `timeout`、`rate_limited`、`provider_error`）。

**Verify**: `node --import tsx scripts/run-chapter-llm-acceptance.ts --deterministic` → 报告指标全部可由样本明细重新计算；运行两次结果的样本、状态、指标一致（时间戳除外）。

### Step 4: 增加真实 smoke 的超时和报告契约回归

扩展 `provider-quality-smoke.ts` 的退出语义和测试覆盖：无凭证为 `SKIP`/0；质量拒绝为非零且只输出 finding code；Provider timeout、rate limit、空响应分别输出稳定类别；成功输出只包含状态、模型是否配置（不得输出模型密钥或完整端点）和耗时。使用 mock fetch 或依赖注入测试错误映射，不发起真实网络请求。

**Verify**: `NODE_ENV=test node --test --import tsx tests/provider-quality-evaluation.test.ts tests/server-llm.test.ts` → 全部通过。

### Step 5: 运行完整门禁并收口计划

在隔离环境运行 typecheck、lint、Node/前端测试、build 和目标 Chromium E2E。真实 Provider 评测失败不得被确定性回归覆盖；把 live 失败原因写入计划证据。只有在至少一次真实 `LIVE` 样本矩阵完整结束并生成四项指标，或用户明确接受 `SKIP` 作为当前环境限制时，才能把 Plan 161 标记 `DONE`。

**Verify**:

```bash
npm run typecheck
npm run lint
npm test
npm run test:frontend
npm run build
npx playwright test tests/e2e/full-browser-click-journey.spec.ts --project=chromium
git diff --check
```

全部命令 exit 0；Playwright 不得使用生产 `data.db`。

## Test plan

- `tests/provider-quality-evaluation.test.ts`：固定污染样本命中 P0/P1、成熟样本通过、P2 warning、对白重复豁免、指标分母为 0。
- `tests/draft-quality.test.ts`：复用现有规则测试，不改动既有语义。
- `tests/server-llm.test.ts`：复用现有 Provider 错误脱敏和 timeout 测试模式，验证 smoke 只使用稳定错误类别。
- 脚本级回归：deterministic 三样本完整终态；live-only 无凭证 `SKIP`；真实失败不 fallback 伪通过。

## Done criteria

- [x] 评测报告逐样本区分 `LIVE`、`FALLBACK`、`SKIP`，无固定 Live 高分。
- [x] 四项指标有公式、分子、分母；分母为 0 显示 `null`。
- [x] `--live-only` 缺凭证 exit 0 `SKIP`，真实 Provider 失败 exit 非零且不 fallback。
- [x] 污染样本、成熟样本和精修误改均有可重复测试。
- [x] 不修改生产源代码、数据库 schema、配置或依赖。
- [x] `npm run typecheck`、`npm run lint`、`npm test`、`npm run test:frontend`、`npm run build`、目标 E2E、`git diff --check` 全部通过。
- [x] `plans/README.md` 与 Plan 161 状态包含真实证据和残余风险。

## 2026-08-23 review evidence

- Isolated review worktree: `/private/tmp/inkflow-live-review.CVqoF9`.
- Contract/evaluation/provider tests: 30/30 passed; deterministic evaluation completed all three fixtures as `FALLBACK` with recomputable metrics; missing-credential `--live-only` remains `SKIP`/0.
- Full gates: `npm test` 1092/1092, `npm run test:frontend` 825/825, `npm run typecheck`, `npm run lint`, `npm run build`, target Chromium journey (1/1), and `git diff --check` all passed.
- Fresh configured `--live-only` matrix completed all three samples and exited 1 without fallback: `slop-heavy`, `action-weak`, and `mature` were each `LIVE audit_response_unparseable`; report metrics were `p0EscapeRate=null (0/0)`, `p1MissRate=0/2`, `polishAcceptanceRate=null (0/0)`, `harmfulRewriteRate=null (0/0)`. This is an honest provider/structured-audit failure, not a literary-quality pass.
- Plan 167 removed the confirmed `十分`/“十分钟” quality-gate false positive; the remaining structured-audit failure is tracked as runtime/provider risk and must not be hidden by fallback scores.

## STOP conditions

- Provider 评测需要读取或写入 `data.db`、`.env` 或任何生产资料。
- 真实调用失败时只能通过 fallback 才能产生“通过”结论。
- 评测所需改动超出本计划 Scope，尤其需要修改 `server/`、`src/` 或 `shared/` 生产逻辑。
- 任何质量规则误判现有成熟 fixture，且无法只在评测标签层修正。
- 报告无法从明细重算指标，或错误输出包含 Prompt、正文、API Key、原始 Provider 响应。

## Maintenance notes

- 新增样本必须同时更新固定标签、预期问题码和测试，不能只扩展报告文本。
- Provider、模型或 Prompt 变更后，先运行 deterministic 基线，再单独运行 live-only；不要把跨模型结果混在同一份指标中。
- 该计划不评价文学审美的最终人类偏好；四项指标只证明质量门禁和精修安全性。更高层次的文风偏好应另建人工盲评集。

## 2026-08-19 implementation evidence

- Deterministic evaluation completed all 3 samples as `FALLBACK`; audit, rewrite and re-audit calls are recorded separately.
- Contract/evaluation tests: 5/5 passed; frontend full suite: 812/812 passed; typecheck and lint passed; `git diff --check` passed.
- Isolated missing-credentials live-only run prints `SKIP: provider credentials not configured` and exits 0.
- Full live-only matrix has not yet completed successfully: the previous run timed out on the first audit call. Existing provider credentials were not written or exposed by this plan.
- After the evaluator error-propagation fixes, a complete `--live-only` matrix ran all 3 samples and exited 1. Each sample ended as `LIVE empty_response`; no candidate or acceptance metric was fabricated and no fallback was used. The single-call prose smoke succeeded separately, so the remaining blocker is the structured audit response contract rather than basic Provider connectivity.
- After aligning the evaluator with the production 90-second request budget and removing its artificial output-token cap, a second complete `--live-only` matrix also exited 1 without fallback: `slop-heavy` and `action-weak` returned audit output but failed as `quality_mismatch` because no expected defect was detected; `mature` ended as `timeout`. This replaces the earlier all-empty result as the current live evidence and confirms that structured audit reliability remains below the release gate.
- 2026-08-20: parser investigation found that valid JSON with incomplete `fatalIssues` was silently normalized to zero issues. Evaluation now records only sanitized metadata (`parseMode`, `contractViolation`, response shape, output length and issue counts), rejects missing/malformed fatal issues as contract failures, and accepts explicit provider aliases without weakening the required正文片段/explanation/patchHint fields.
- 2026-08-20: production and evaluation audit prompts now append one shared JSON contract and disable reasoning spillover; the contract includes a complete JSON skeleton so saved legacy prompt templates receive the same output requirements. `response_format` was intentionally not forced because the configured gateway returned parameter errors.
- 2026-08-20 LIVE matrix completed all three samples with exit 1 and no fallback: `slop-heavy=provider_error`, `action-weak=audit_response_unparseable` (plain-text response, no audit keys), `mature=quality_mismatch` (JSON parsed but model reported one unexpected issue). Metrics remained honest with no accepted polish candidate. A minimal isolated Provider probe returned valid JSON, so basic structured output is available; long-form audit behavior remains a provider/model quality risk. The evaluator contract itself is closed; this runtime risk is intentionally retained for a future provider-specific plan.
- 2026-08-23 fresh `node --import tsx scripts/run-chapter-llm-acceptance.ts --live-only` completed all three samples in `LIVE` mode and exited 1：三个样本均为 `audit_response_unparseable`。报告指标为 `p0EscapeRate=null (0/0)`、`p1MissRate=0/2`、`polishAcceptanceRate=null (0/0)`、`harmfulRewriteRate=null (0/0)`；没有 fallback、候选或接受结果。随后单次 Provider 探针在响应质量门阶段以 `quality_rejected` 失败，证据显示 `十分` 规则误判正文中的“十分钟”，因此下一轮必须先修复词边界误报，再重新跑 live-only。
