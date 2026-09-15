# Plan 227: 工序签名——卡目录补全「输入料/产出物/方向/工位/套牌」数据模型（228/229 的地基）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat b3a5bcc..HEAD -- shared/lib/public-skill-catalog.ts shared/lib/prompt-governance-catalog.ts scripts/generate-public-catalog.ts src/lib/capability-shelf.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P0（地基：重构模式与系列套牌共同缺的就是这张签名表）
- **Effort**: M-L
- **Risk**: MED（动生成目录 schema，触点多但可程序化推导 + 显式覆盖）
- **Depends on**: none（228/229 依赖本计划）
- **Category**: data-model（能力商店诊断 · 工序化）
- **Planned at**: commit `b3a5bcc`, 2026-09-15（来源：四轮思考 · 工序轮「卡 := (输入料, 产出物, 方向, 工位, 套牌)」）

## Why this matters

卡的真身是工序算子，但目录里没有算子签名：单品卡 `inputs` 只有一枚 `"content"` 占位，产出类型缺失，方向（生成/重构/润色/检验）与工位（正文配方/审稿…）无字段，套牌（克苏鲁系列）靠标题前缀在渲染层临时归组。没有签名：228 的重构模式不知道卡吃什么料，229 的互斥不知道卡占哪个工位，用户分类（按料与方向）无从建索引。流程步骤里其实已有完整先例——`SKILL_SERIES_FLOWS` 每步都声明 `input`/`output` 产物类型。

## Current state（2026-09-15 亲读核实，锚点基于 `b3a5bcc`）

1. `shared/lib/public-skill-catalog.ts:239+` — 流程步骤已带类型化 IO：`idea→hook-idea→world-setting→characters→chapters-outline→detailed-outline`，含 `qualityGate`/`nextStepId`/`switchAllowed`。
2. 同文件单品卡：`"inputs": ["content"]` 占位；`"outputShape": "plain-text"` 等；`"stage"`（planning/drafting/polish/review）、`"primaryCategory"`、`"deconstructionCardType"` 已存在。
3. `src/lib/capability-shelf.ts:170-175` — 系列分组按标题前缀 `bySeries` 临时推导，纯视觉。
4. 生成链路：`scripts/generate-public-catalog.ts` emit 模板（Plan 221 已改名 `PUBLIC_SKILL_GOVERNANCE_CATALOG`）；源注册表在 `prompt-governance-catalog.ts`。消费面：`capability-governance.ts` 投影、`getCatalogCapabilityManifest`。
5. 产物类型词表已有实例可复用（flow 的 output 值域）；`isOutlineCandidateOutput`/`isWorldCandidateArtifact`（`src/lib/skills-studio-governance`）说明非正文产物已有候选类型概念。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 生成目录 | `node --import tsx scripts/generate-public-catalog.ts`（后跑 freshness） | `tests/public-catalog-freshness.test.ts` 3/3 |
| 定向 | `npx vitest run --config vitest.config.frontend.ts src/tests/<签名相关新用例>` | 全绿 |
| 全量 | `npm run test:frontend` + `npm test` | 全绿 |

## Scope

**In scope**：
- 目录 schema 扩展：每卡新增 `craft` 签名块 `{ inputs: ProductType[], output: ProductType, mode: 'generate'|'refine'|'polish'|'inspect', station: string, seriesId?: string, seriesOrder?: number }`
- 产物类型词表（复用 flow output 值域扩展：`idea/world-setting/characters/chapters-outline/detailed-outline/draft/manuscript/audit-report`）
- 推导器：由 `stage`+`primaryCategory`+`deconstructionCardType` 程序化推导 mode/station（critic→inspect、polish+content→polish、其余→generate；工位 = `${stage}:${primaryCategory}` 类方案），**显式覆盖表**处理推导歧义；seriesId 沿用标题前缀规则固化为数据
- 生成脚本 emit 同步 + freshness 守护 + 签名完备性测试（256 卡全部有完整签名）

**Out of scope**：
- 重构模式执行链路（228）、套牌互斥 UI（229）
- 源注册表（prompt-governance-catalog.ts）的内容改动——签名属生成侧派生元数据，落在 emit 模板/推导器
- 任何渲染层变化

## Steps

### Step 1: schema 与推导器

类型定义 + 推导器 + 显式覆盖表（`scripts/` 内，输入为源注册表数据）；生成脚本 emit `craft` 块。

**Verify**: freshness 3/3；签名完备性测试（0 卡缺签名）；typecheck 0

### Step 2: 消费侧导出与回归

`capability-governance.ts`（或 capability-shelf）导出 `getCraftSignature(assetId)`；抽查人工核对三类代表卡（去AI味规则卡=polish/检验系、克苏鲁正文=generate/正文工位/克苏鲁套牌、人设拆书卡=characters 料）。前端全量 + 后端全量回归。

**Verify**: 抽查清单全对；双全量绿；台账落账

## Done criteria

- [ ] 256 卡每张携带完整 craft 签名，freshness 与完备性测试钉死
- [ ] 228/229 可直接消费签名，无需再动目录
- [ ] 台账落账

## STOP conditions

- 推导歧义超过 15% 卡片需显式覆盖 → 停止，报告歧义分布，改为人工逐卡标注的方案再评估。
