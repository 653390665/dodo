# Plan 257: 白标四卡转内置 + 新书默认流程（generic-novel-flow）

> **Executor instructions**: Follow step by step, run every verification, honor STOP
> conditions, do not improvise. SKIP plans/README.md updates (reviewer maintains it).
> Commit per step (`feat(capabilities): plan257 <中文一句话>`), do not push. Audit
> every claim in your report against actual tool results. Reply with the report
> format at the end.

## Status

- **Priority**: P2 · **Effort**: M · **Risk**: MED（目录再生成级联）
- **Category**: feature/governance · **Planned at**: commit `2dfa93e`, 2026-09-20

## Why this matters

产品裁决：官方组当前仅 1 张（去AI味痕迹规则卡），官方托底供给空缺。审查确认 4 张
白标卡的模板已在服务端私表托管、内容为官方方法论风格、无题材/平台绑定、无品牌残留，
转 built-in 零版权风险；同时 `generic-novel-flow` 是唯一全内置官方资产的创作流程，
设为新书默认流程可让新用户开箱即得"大纲→正文→去AI护栏"闭环。

## Current state（已亲核锚点）

- **source of truth**：`shared/lib/curated-product-skills.ts` `CURATED_PRODUCT_SKILLS`
  （4 张目标卡：`prose-mouth-flavor` :90 附近、`audit-logical-sanity` :117 附近、
  `deconstruct-golden-climax` :225 附近、`deconstruct-suspense-hook` 同区域，
  当前均 `sourceType: 'plaza'`）。
- **生成目录**：`shared/lib/public-skill-catalog.ts`（7158 行，由
  `scripts/generate-public-catalog.ts` 生成）；`CURATED_PRODUCT_SKILLS` 副本在 :666 起。
- **官方判定**：`src/lib/capability-governance.ts:480` `isOfficialSupplyAsset` =
  `sourceType === 'built-in'`（翻转后商店官方组自动 1→5）。
- **流程**：`SKILL_SERIES_FLOWS` 含 id `generic-novel-flow`（6 步全内置资产）；
  作品配置 `ProjectCapabilityProfile.activeFlowId`（`shared/types/preferences.ts:45`
  区域）。
- **已知级联测试**：`tests/public-catalog-freshness.test.ts`（生成文件 vs 现跑镜像）、
  `tests/catalog-copy-uniqueness.test.ts`、`src/tests/style-shelf-decks.test.tsx`
  （官方区/社区区分区）、`src/tests/plan256-deck-overview.test.tsx`。
- 仓库约定：中文注释、prettier 单引号、eslint `--max-warnings=0`。

## Commands

| Purpose | Command | Expected |
|---|---|---|
| 目录再生成 | `node --import tsx scripts/generate-public-catalog.ts`（以脚本实际用法为准） | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| 后端定向/全量 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/<file>` / `npm test` | all pass |
| 前端定向/全量 | `npm run test:frontend -- src/tests/<file>` / `npm run test:frontend` | all pass |

## Scope

**In scope**:
- `shared/lib/curated-product-skills.ts`（4 张 sourceType plaza→built-in）
- `shared/lib/public-skill-catalog.ts`（再生成产物）
- `scripts/generate-public-catalog.ts`（如生成器内含需要同步的镜像逻辑）
- 新书默认流程：小说创建/配置初始化点（`activeFlowId: 'generic-novel-flow'`，
  仅当配置为空时；实现点由你调查——server 建档路径或
  `normalizeProjectPreferenceProfile` 缺省填充，选最小侵入处）
- `tests/`、`src/tests/` 重锚与新增

**Out of scope**: licensed 卡（bible-world-builder 等待商务确认）；散卡层；
PRIVATE_CURATED_TEMPLATES 模板文本；`TOO_MANY_EFFECTIVE_SKILL_CARDS` 总闸。

## Steps

### Step 1: 4 张白标卡转内置
`curated-product-skills.ts` 中上述 4 张的 `sourceType: 'plaza'` → `'built-in'`
（保持其余字段不动；`accessTier` 若存在则确认 free）。同步检查
`de-ai-rhythm-restorer`（文字灵性）**不转**（用户裁决维持次优先）。
**Verify**: `npm run typecheck`。

### Step 2: 目录再生成 + 级联重锚
运行生成脚本重建 `public-skill-catalog.ts`；随后 typecheck + 全量
`npm test` + `npm run test:frontend`，把红的断言按重锚惯例处理（freshness
重新生成即绿；copy-uniqueness / plan158 / style-shelf-decks / plan256 中按旧
官方数量或 title→sourceType 关系的断言逐个重锚，语义不变）。
**Verify**: 两个全量全绿。连续 5 个测试无法重锚 → STOP。

### Step 3: 新书默认流程
调查小说创建时 `projectPreferenceProfile` 的初始化路径（server 建档代码），在
「新建作品且无配置」时默认 `activeFlowId: 'generic-novel-flow'`；已存在的作品
不迁移（无 activeFlowId 时流程面板按未选择处理，不强行改历史数据）。加后端或
前端测试：新建作品默认 flow 为 generic-novel-flow；显式选择其他 flow 不被覆盖。
**Verify**: 定向测试全绿。

## Test plan

- 官方组呈现：`style-shelf-decks` 增断言——官方区含 4 张新内置卡（按 title）。
- 默认流程：新建/空配置 profile 断言 `activeFlowId === 'generic-novel-flow'`。
- 收尾全量两套。

## Done criteria

- [ ] typecheck 0；两套全量全绿
- [ ] 4 张卡 sourceType=built-in 且商店官方组呈现 5 张
- [ ] 新建作品默认 activeFlowId=generic-novel-flow，且显式选择不被覆盖
- [ ] `de-ai-rhythm-restorer` sourceType 仍为 plaza
- [ ] 改动文件在 In scope 内

## STOP conditions

- 目录再生成后级联红 >5 处无法重锚。
- 生成脚本本身引用了 plan 未见的镜像逻辑导致再生成不可行。
- 新书建档路径不存在独立初始化点（profile 惰性创建）——报备改 UI 缺省方案。

## 汇报格式

STATUS: COMPLETE | STOPPED
STEPS / STOPPED BECAUSE / FILES CHANGED / NOTES