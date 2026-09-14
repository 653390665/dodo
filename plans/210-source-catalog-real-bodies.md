# Plan 210: 197 出路 a 执行——源目录真实正文重建 + 渲染切副本单源化（197 Step 4）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat ef1335e..HEAD -- shared/lib/prompt-governance-catalog.ts scripts/generate-public-catalog.ts shared/lib/public-skill-catalog.ts src/lib/capability-governance.ts src/components/SkillsStudioView.tsx src/tests/skills-studio-plan158.test.tsx tests/public-catalog-freshness.test.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P1（197/185 唯一硬阻塞；2026-09-14 用户拍板出路 a）
- **Effort**: M（44 张正文撰写为内容工程量）
- **Risk**: MED（渲染消费面切换影响能力卡分组与 plan158 多处断言）
- **Depends on**: 197（Step 1-2 已落地：过滤器单源化 + SANITIZED_SKILL_COPIES 45 张零消费面）
- **Category**: product + architecture
- **Planned at**: commit `ef1335e`, 2026-09-14

## Why this matters

197 Step 3 硬 STOP：44/45 消毒副本主体为占位骨架，根因是源目录 `rawPrivateConfigs` 的 template 在 `buildRealAssets`（prompt-governance-catalog.ts:2322）被统一硬编码为 `[商业定制专属提示词体] 针对长篇小说 <标题> 骨架推进。`——真实提示词正文从未入库。2026-09-14 产品拍板出路 a：**为 44 张候选补真实正文（重新生成源目录），随后完成 197 Step 4 渲染切副本单源化**。落地后 185 的原始目标（渲染层只消费 sanitized 副本）达成，197/185 双双收口。

## Current state（2026-09-14 勘察核实，锚点基于 `ef1335e`）

- **源数据**：`shared/lib/prompt-governance-catalog.ts` `rawPrivateConfigs`（1122-1820，77 条）中 `tier: 'sanitize-required'` 44 条；`buildRealAssets` 对全部 77 条统一回填骨架模板（:2322），无 per-entry 正文承载字段。分布：constellation-pack 18（沐殇克苏鲁系 9 + 宝可梦系 9）、author-workflow 10、style-reference 7、utility-tool 7、quality-guardrail 2、platform-criteria 1；另有 `raw-comp-brand-detector`（GOVERNED_ASSETS_V2_REGISTRY，真实薄弱主体 34 字）不重建。
- **生成侧**：`scripts/generate-public-catalog.ts` `buildSanitizedCopy`（:115-134）镜像运行时先例——`id='sanitized-'+asset.id`、文案字段过 `sanitizeWhiteLabelText`、`runtime-ready + active + placementTier 'optional-style' + isRuntimeReady true`；产物写入生成文件独立导出 `SANITIZED_SKILL_COPIES`（public-skill-catalog.ts:4824，当前**零消费面**）。
- **渲染目标**：`src/lib/capability-governance.ts` 从**源文件**导入 `PROMPT_GOVERNANCE_CATALOG`（:1），`getOptionalStyleAssets`（:321）过滤 `optional-style + active + isRuntimeReady + runtime-ready`——副本满足全部条件但不在该集合内；`getSanitizeRequiredAssets`（:377）投影全部 45 张候选进「需解锁」分组；`isSanitizeRequiredAsset`（:415）决定「消毒并启用」按钮显隐。
- **测试锚点**：`src/tests/skills-studio-plan158.test.tsx:874-876`（`消毒并启用` 按钮 ≥45）、`004 offers sanitize-and-enable`（:1817，按钮 ≥45）、`010 J6 full seam`（:1766，UI 驱动运行时端点全链路）。后端对 `/api/skills/sanitize` 无独立自动化覆盖（010 是唯一覆盖面）。
- **正文形态标准**：`de-ai-tells-guard`（380 字，编号规则指令式）为仓内真实正文质量基准。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 重生成公开目录 | `npx tsx scripts/generate-public-catalog.ts` | exit 0，SANITIZED_SKILL_COPIES 带真实正文 |
| 语义复查 | 一次性 node 脚本（仿 notes-197-semantics 测量口径） | 仅剩骨架 ≤ 1（brand-detector 薄弱项除外） |
| 新鲜度守卫 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/public-catalog-freshness.test.ts` | 全绿 |
| plan158 | `npx vitest run --config vitest.config.frontend.ts src/tests/skills-studio-plan158.test.tsx` | 全绿（按新语义更新后） |
| 前端全量 | `npm run test:frontend` | 900+ 全绿 |

## Scope

**In scope**：

- `shared/lib/prompt-governance-catalog.ts`：新增 `realTemplates` 按 id 映射（44 张真实正文）+ `buildRealAssets` 消费（`realTemplates[p.id] ?? 骨架回退`）
- `shared/lib/public-skill-catalog.ts`：重生成产物（auto-generated）
- `src/lib/capability-governance.ts`：`getOptionalStyleAssets` 合并消费 SANITIZED_SKILL_COPIES；`getSanitizeRequiredAssets`/`isSanitizeRequiredAsset` 排除已有生成侧副本的候选
- `src/tests/skills-studio-plan158.test.tsx`：断言按新交互逐条过渡（见 Step 4 清单）
- `plans/notes-197-semantics.md`：复测统计补记

**Out of scope**：

- score>=70 的 ready 条目（33 张）同样带骨架模板——同病灶但不阻塞本计划，登记 Maintenance notes 另议
- `sanitizeWhiteLabelText` 模式表、/api/skills/sanitize 端点语义（端点保留，供未来用户自产卡）
- 45 张候选的 tier/score 数据本身（sanitize-required 判定不动）

## Steps

### Step 1: 源目录补真实正文

新增 `realTemplates: Record<string, string>`（44 张，key=源 id）。正文按各条 title/分类撰写：编号规则指令式（形态对齐 `de-ai-tells-guard`），每张 120-300 字，含角色定位/任务/硬性要求/输出口径；**不得含**作者署名、联系方式、竞品品牌（消毒管线无需剥内容，白标只发生在标题/goal 的署名剥离）。`buildRealAssets` 改 `template: realTemplates[p.id] ?? \`[商业定制专属提示词体] 针对长篇小说 ${p.title} 骨架推进。\``——显式回退，未来新增无正文条目时诚实降级。

**Verify**: `npx tsx -e` 断言 44 张 sanitize-required 候选 template 长度 ≥ 100 且不含「骨架推进」；typecheck 0

### Step 2: 重生成 + 语义复查（197 Step 3 复测）

重跑生成脚本；仿 notes-197-semantics 测量口径复测 45 张副本（空主体/仅剩骨架/长度损失）。预期失效 0-1（brand-detector 维持薄弱真实）。统计表补记进 notes-197-semantics.md（追加「出路 a 复测」节）。

**Verify**: 失效数 ≤ 15（STOP 门通过）；freshness 守卫全绿；脚本幂等（重跑 diff 为空）

### Step 3: 渲染切副本单源化（197 Step 4）

- `getOptionalStyleAssets`：读取集合改为 `[...PROMPT_GOVERNANCE_CATALOG, ...SANITIZED_SKILL_COPIES]`——45 张副本（`optional-style + active + isRuntimeReady + runtime-ready`）自动入可选文风集
- `getSanitizeRequiredAssets` 与 `isSanitizeRequiredAsset`：排除已有生成侧副本的候选（`SANITIZED_SKILL_COPIES.some(c => c.id === 'sanitized-' + id)`）——「需解锁」分组清空、「消毒并启用」按钮不再渲染（候选全部有副本）
- SkillsStudioView 预计零改动（按钮/分组由上述两函数驱动）；若存在独立判断点，随实际渲染链收口

**Verify**: typecheck 0；`grep -n "getSanitizeRequiredAssets\|isSanitizeRequiredAsset" src/` 消费点逐一核对行为一致

### Step 4: plan158 断言过渡（逐条清单）

1. `:874-876`（`消毒并启用 ≥ 45`）→ 改为可选文风集含 45 张白标副本（`sanitized-` 前缀卡存在）且「消毒并启用」按钮为 0
2. `004 offers sanitize-and-enable for locked candidate cards`（:1817）→ 重写为「候选已内置消毒版本：需解锁分组为空、副本以正式文风卡呈现」
3. `010 J6 sanitize-and-enable full seam`（:1766）→ 删除（UI 驱动的运行时端点链路随单源化收口消失；端点保留供未来用户自产卡，接受无自动化覆盖并在台账注明）；其 sanitizeCalls/apply 链断言由 2 的副本断言承接
4. 其余涉及 45 计数/需解锁文案的断言随 grep 逐一过渡（语义不变，仅数值/口径）

**Verify**: plan158 全绿；前端全量绿

### Step 5: 收尾

台账更新：210 转 DONE；197 转 DONE（Step 3 复测通过 + Step 4 落地，引用 210）；185 转 DONE（渲染只消费副本达成，引用 210）。plan199 行不动。

**Verify**: 台账三行落账

## Test plan

freshness 守卫 + plan158 + 前端全量 + typecheck。后端未触碰（生成脚本为构建期工具，freshness 已覆盖）。

## Done criteria

- [ ] 44 张候选拥有真实正文（≥100 字、非骨架、无署名/联系方式/竞品）
- [ ] 45 张消毒副本语义复查通过（失效 ≤ 15，预期 0-1）
- [ ] 渲染层文风卡消费面 100% 来自 sanitized 副本；「需解锁」分组随单源化清空
- [ ] plan158/前端全量/typecheck 绿；台账 210/197/185 三行落账

## STOP conditions

- plan158 连带红超出上述 4 条清单范围（非 sanitize 断言受牵连）→ 停止报告影响面。
- 重生成后消毒管线对新正文产生非预期命中（hits 显著 > 0）→ 停止核对 sanitizeWhiteLabelText 模式表是否误伤正文语义。
- 渲染切换导致 cockpit/编辑器等非预期消费面行为变化（E2E 或全量牵连）→ 停止报告。

## Maintenance notes

- 33 张 ready 条目的骨架模板为同病灶遗留（runtime-active 却无正文），建议另立小额计划补齐或诚实降级其 runtime 态。
- `/api/skills/sanitize` 运行时端点在单源化后无 UI 入口、无自动化覆盖；保留供用户自产卡场景，若长期不用可评估下线。
