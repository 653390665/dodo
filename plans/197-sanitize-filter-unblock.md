# Plan 197: 技能卡消毒边界解锁——生成侧为 45 张候选产消毒副本（Plan 185 拍板出路 b）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat f39b597..HEAD -- scripts/generate-public-catalog.ts shared/lib/prompt-governance-catalog.ts src/lib/capability-governance.ts tests/public-catalog-freshness.test.ts server/routes/skills.ts src/tests/skills-studio-plan158.test.tsx`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P1（185 自 2026-09-11 起 BLOCKED 等产品拍板；2026-09-12 拍板「扩过滤器保特性」）
- **Effort**: M
- **Risk**: MED（消毒管线对 45 张候选的输出语义质量未知；渲染消费面切换影响能力卡分组）
- **Depends on**: none（185 的部分落地已在库：GuardrailPolicyPanel/增强包已切副本 + 新鲜度守卫）
- **Category**: architecture + product
- **Planned at**: commit `f39b597`, 2026-09-12

## Why this matters

Plan 185 的目标——渲染层只消费 sanitized 副本——在最后一步 STOP：`src/lib/capability-governance.ts` 的 `getOptionalStyleAssets` 若切换为只消费 runtime-ready 副本，45 张 sanitize-required 候选（「消毒并启用」特性的数据源）会从可选文风卡中消失。产品拍板：**保留特性，扩生成侧**——让生成脚本为这 45 张产出自产消毒副本，特性（按需消毒）与架构单源化（渲染只消费副本）兼得。

## Current state（2026-09-12 勘察核实）

- **生成脚本**：`scripts/generate-public-catalog.ts` 产出 `shared/lib/public-skill-catalog.ts`（auto-generated，禁止手改）。过滤器 `isPublicRuntimeAsset`（53-62 行）**刻意剔除** `placementTier === 'sanitize-required'` / `sanitizationStatus === 'needs-sanitization'` 等条件。
- **源数据**：`shared/lib/prompt-governance-catalog.ts` 的 `rawPrivateConfigs`（1122-1820 行，77 条）中 `tier: 'sanitize-required'` 共 **44 条**（score<70 判定在 buildRealAssets 2315 行 `isReady = p.score >= 70 && p.tier !== 'sanitize-required'`），另加静态候选 `raw-comp-brand-detector`（GOVERNED_ASSETS_V2_REGISTRY 内）= **45 张**。分布：constellation-pack 18、author-workflow 10、style-reference 7、utility-tool 7、quality-guardrail 2、platform-criteria 1。
- **运行时消毒先例**：`POST /api/skills/sanitize/:assetId`（server/routes/skills.ts:259，候选筛选 263-269 行要求 `runtimeStatus==='candidate' && sanitizationStatus==='needs-sanitization'`），落库 `skillId = 'sanitized-' + asset.id`、`sanitizationStatus: 'runtime-ready'`、`runtimeStatus: 'active'`（297-298 行）。前端入口 `SkillsStudioView.tsx:2264-2296` `handleSanitizeAndEnable`。
- **切换目标**：`src/lib/capability-governance.ts`（前端，422 行）——`getOptionalStyleAssets`（321 行起）343/341 行要求 `runtime-ready` + `active`，45 张被排除；`getSanitizeRequiredAssets`（377-412 行）把它们投影进「需解锁」分组（`curatedCategory` 硬编码 `'style'` 于 387 行）。
- **安全网**：`src/tests/skills-studio-plan158.test.tsx:874-876` 锚定 45 张（`getAllByText('消毒并启用').length >= 45`）；`tests/public-catalog-freshness.test.ts:56` 有一份 `isPublicRuntimeAsset` 的**本地复制**（双份维护，本次收口）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 重生成公开目录 | `npx tsx scripts/generate-public-catalog.ts` | exit 0，public-skill-catalog.ts 更新 |
| 新鲜度守卫 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/public-catalog-freshness.test.ts` | 全绿 |
| plan158 安全网 | `node node_modules/vitest/vitest.mjs -c vitest.config.frontend.ts run src/tests/skills-studio-plan158.test.tsx` | 38 用例全绿（按新语义更新后） |
| 前端全量 | `npm run test:frontend` | 884+ 全绿 |

## Scope

**In scope**：

- `scripts/generate-public-catalog.ts`（过滤器 + 生成消毒副本条目）
- `shared/lib/public-skill-catalog.ts`（生成产物）
- `tests/public-catalog-freshness.test.ts`（共享过滤器单源化 + 新断言）
- `src/lib/capability-governance.ts`（getOptionalStyleAssets 消费消毒副本；getSanitizeRequiredAssets 投影语义调整）
- `src/components/SkillsStudioView.tsx` + `src/tests/skills-studio-plan158.test.tsx`（「需解锁」分组与「消毒并启用」按钮的达尔文式过渡：已有消毒副本的候选显示已解锁态）

**Out of scope**：

- 删除「消毒并启用」特性（出路 a，已否决）
- sanitize 白名单内容本身的扩充（`sanitizeWhiteLabelText` 的模式表不动）
- server/routes/skills.ts 的 /api/skills/sanitize 端点语义

## Steps

### Step 1: 过滤器单源化

把 `isPublicRuntimeAsset` 从 tests/public-catalog-freshness.test.ts:56 的本地复制与 scripts/generate-public-catalog.ts:53 的定义抽到单一导出（放 `shared/lib/prompt-governance-catalog.ts` 或新 `shared/lib/public-catalog-filter.ts`），两处改 import。先只做搬运不改行为。

**Verify**: 生成脚本重跑后 `git diff shared/lib/public-skill-catalog.ts` 为空（幂等）；freshness 测试全绿

### Step 2: 生成侧为 45 张候选产消毒副本

生成脚本为每张 sanitize-required 资产额外产出一条 `id: 'sanitized-' + asset.id` 的副本条目：全字符串字段过 `sanitizeWhiteLabelText`（与 /api/skills/sanitize 同源管线），`sanitizationStatus: 'runtime-ready'`、`runtimeStatus: 'active'`、`placementTier` 提升为公开档、`sourceType` 用授权枚举（与运行时先例一致）。原候选条目保留（「需解锁」分组仍需感知原貌）。freshness 测试补断言：45 张副本存在、副本 id 集合与候选一一对应、副本过 `isPublicRuntimeAsset`。

**Verify**: freshness 测试绿（含新断言）；重跑脚本幂等

### Step 3: 语义质量抽查（STOP 门槛测量）

对 45 张副本逐条检查消毒输出：标题/描述/prompt 主体是否为空或被剥光（关键内容损失）。写一次性脚本输出统计表进 plans/notes。

**Verify**: 语义失效（空主体或仅剩骨架）比例 ≤ 1/3（15 张）
**STOP**: 失效比例 > 1/3 → 停下报告清单与样例，重新评估「砍特性」分支——不要硬切。

### Step 4: 渲染切换 + 特性过渡

`getOptionalStyleAssets` 改为：候选若存在对应消毒副本，则把副本纳入可选集；`getSanitizeRequiredAssets` 的「需解锁」分组只投影**尚无副本语义冲突**的候选项（或按产品语义保留全量但标记已解锁态）。SkillsStudioView 的「消毒并启用」按钮对已有生成侧副本的候选改为「已内置消毒版本」态或直接移除入口（以 plan158 语义为准）。plan158 断言按新交互更新——更新幅度在计划评审时逐条列出。

**Verify**: plan158 全绿；前端全量绿；`grep -n "getOptionalStyleAssets\|getSanitizeRequiredAssets" src/` 消费点逐一核对

## Test plan

freshness 守卫扩展 + plan158 更新 + 前端全量 + 后端全量（skills.ts 未动则为定向）。

## Done criteria

- [ ] 渲染层文风卡消费面 100% 来自 sanitized 副本（185 原始目标达成）
- [ ] 「消毒并启用」特性保留且语义自洽（已解锁/需解锁分组正确）
- [ ] 过滤器单源（无本地复制）
- [ ] `plans/README.md` 状态行已更新（185 行同步改写结局）

## STOP conditions

- Step 3 语义失效比例 > 1/3 → 报告再议。
- plan158 更新幅度超出「断言数值/文案」级别（需要重写交互流程）→ 先报告方案再动手。

## Maintenance notes

落地后 185 行从 BLOCKED 改 DONE 并引用本计划；`/api/skills/sanitize` 运行时端点保留（对用户自产卡仍有意义），但候选投影可与生成侧副本去重。
