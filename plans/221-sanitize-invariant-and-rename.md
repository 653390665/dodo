# Plan 221: 副本单源化不变式入规范 + 同名目录导出澄清（DOCS-01/02）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat d6c2ed2..HEAD -- AGENTS.md shared/lib/public-skill-catalog.ts shared/lib/prompt-governance-catalog.ts docs/specs/`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P2（防白标泄露的规范性收口；是 backlog「白标清洗单源化」「governance 契约测试」两项的前置澄清）
- **Effort**: S
- **Risk**: LOW-MED（重命名导出触点多但纯机械）
- **Depends on**: none
- **Category**: docs + architecture（单源性）
- **Planned at**: commit `d6c2ed2`, 2026-09-15（发现：improve 四路审计 DOCS-01/DOCS-02）

## Why this matters

210 完成渲染层单源化后，「渲染投影只允许消费 sanitized 副本，候选原貌不得直接渲染」这条规则只存在于 `capability-governance.ts:323-325` 的代码注释里——恰是 AGENTS.md「技术不变式」节设计要防的「跨文件、改此必读」型约束。不入规范的话，下一个改 SkillsStudioView/capability-governance 或新增货架投影面的 agent/人，最容易犯的错就是把候选原貌渲染出去（白标泄露：署名/品牌信息直达用户——185/197 战役要消灭的失效模式）。

雪上加霜的是：仓库存在**两个同名导出** `PROMPT_GOVERNANCE_CATALOG`——`prompt-governance-catalog.ts:2539`（V2 治理注册表构建，211 条，含消毒状态）与 `public-skill-catalog.ts:909`（生成产物，7476 行内联字面量，含 plaza/拆书内容）。消费方按 import 路径分裂（capability-governance 走前者，GuardrailPolicyPanel/SkillsStudioView 等约 10 处走后者）。新增面板导错路径不报错，但拿到的是另一套可能未治理的数据。

## Current state（2026-09-15 亲读核实，锚点基于 `d6c2ed2`）

- `AGENTS.md:25-31` 技术不变式节仅 3 条：SQLite 备份、LLM 状态诚实、驾驶舱路由。
- `src/lib/capability-governance.ts:323-325` 注释：「Plan 210（197 出路 a）：渲染层只消费 sanitized 副本……候选原貌仅保留在『需解锁』投影中」；`:327-328` `RUNTIME_STYLE_CATALOG` 合并副本；`hasGeneratedSanitizedCopy` 排除逻辑。
- 两个同名导出：`shared/lib/prompt-governance-catalog.ts:2539` 与 `shared/lib/public-skill-catalog.ts:909`。
- 守护测试：`src/tests/skills-studio-plan158.test.tsx`（004 副本单源化断言）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 全量 | `npm run test:frontend` + `npm test` | 全绿 |
| typecheck | `npm run typecheck` | 0（重命名漏改即红） |
| 消费点核对 | `grep -rn "PROMPT_GOVERNANCE_CATALOG" src/ server/ shared/ scripts/ --include="*.ts*" | grep -v prompt-governance-catalog.ts` | 每处 import 来源明确 |

## Scope

**In scope**：

- 新建 `docs/specs/capability-sanitize.md`；AGENTS.md 不变式节增补第四条
- `shared/lib/public-skill-catalog.ts` 的 `PROMPT_GOVERNANCE_CATALOG` 重命名为 `PUBLIC_SKILL_GOVERNANCE_CATALOG`（生成脚本 `scripts/generate-public-catalog.ts` 的 emit 同步改）+ 全部消费方 import 同步

**Out of scope**：

- 两份目录的内容合并（plaza-vs-registry 双库可能是有意拆分，留待消毒缺口收口后评估）
- `isPublicRuntimeAsset`/消毒管线单源化（backlog 另立，本计划是它们的前置澄清）

## Steps

### Step 1: 重命名生成文件导出

`public-skill-catalog.ts` 内 `PROMPT_GOVERNANCE_CATALOG` → `PUBLIC_SKILL_GOVERNANCE_CATALOG`（含生成脚本模板）；typecheck 逐个修复消费方 import（预计约 10 处，GuardrailPolicyPanel/SkillsStudioView 等）。

**Verify**: `grep -rn "PROMPT_GOVERNANCE_CATALOG" src/ scripts/ | grep -v prompt-governance-catalog.ts` 零命中；typecheck 0；前后端全量绿

### Step 2: 规范落地

新建 `docs/specs/capability-sanitize.md`：为什么（白标泄露失效模式）、不变式（渲染投影只允许两条路径——`getOptionalStyleAssets` 的 `RUNTIME_STYLE_CATALOG` 与 `getSanitizeRequiredAssets` 白名单；候选原貌禁止直达渲染）、守护测试指针（plan158 004）、已知缺口（sanitize 运行时端点无覆盖，见 213）。AGENTS.md 不变式节增补第四条指向该规范。

**Verify**: 文档落盘；AGENTS.md 四条齐

## Done criteria

- [ ] 同名导出消除；消费方路径明确
- [ ] 不变式入 AGENTS.md + docs/specs；台账落账

## STOP conditions

- 重命名发现两份目录存在真实交叉消费（同一消费方两套都依赖且语义耦合）→ 停止报告依赖图。
