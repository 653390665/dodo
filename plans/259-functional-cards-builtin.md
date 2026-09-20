# Plan 259: 功能类单卡内置扩容——世界观/开篇质检/语流重建三卡翻转（题材类留付费）

> **Executor instructions**: Follow step by step, run every verification, honor STOP
> conditions, do not improvise. SKIP plans/README.md updates (reviewer maintains it).
> Commit per step (`feat(capabilities): plan259 <中文一句话>`), do not push. Audit
> every claim against actual tool results. Reply with the report format at the end.

## Status

- **Priority**: P2 · **Effort**: S-M · **Risk**: LOW-MED（机制与 Plan 257 完全同构，已趟平）
- **Category**: feature/governance
- **Depends on**: plans/257（已合并）
- **Planned at**: 开工前 `git rev-parse --short HEAD` 记录

## Why this matters

产品裁决（用户规则）：**题材/渠道类卡 → 付费；构架/审查/评估/写作质量类单卡 → 内置**。
据此全目录重筛，3 张功能类单卡应转内置：bible-world-builder（96，构架·设定，付费
旗舰按新规则免费化——产品知情决策）、opening-novelty-hook（92，评估·开篇质检，与
内置黄金三章大纲形成"立+检"闭环）、de-ai-rhythm-restorer（92，写作质量·去AI，白标
已私表托管）。题材类（古言 91/克苏鲁 93）与平台类（番茄 94/海外 89）维持付费。

## Current state（已亲核锚点，与 Plan 257 同构）

- **asset 层 source of truth**：`shared/lib/curated-product-skills.ts`——
  `bible-world-builder`（sourceType `'licensed'`）、`opening-novelty-hook`
  （`'licensed'`）、`de-ai-rhythm-restorer`（`'plaza'`）。
- **manifest 层**：`shared/lib/capability-manifest-catalog.ts` 同三张需同步翻转
  （Plan 257 的教训：双层必须一致，否则包流程 apply 匹配分裂）。
- **再生成**：`scripts/generate-public-catalog.ts` → `shared/lib/public-skill-catalog.ts`。
- **官方判定**：`src/lib/capability-governance.ts` `isOfficialSupplyAsset`。
- **存量克隆迁移**：`scripts/migrate-builtin-clone-source.ts` 已存在（Plan 257 建，
  内置 4 张源 id 清单）——需扩展支持本轮 3 张（含 `bible-world-builder-clone-*`
  存量卡，用户本地已有）。
- **级联测试**：`tests/public-catalog-freshness.test.ts`、
  `tests/public-catalog-governance.test.ts`、`tests/catalog-copy-uniqueness.test.ts`、
  `src/tests/plan257-official-supply.test.ts`（官方分区断言 6→9 需重锚）、
  `src/tests/style-shelf-decks.test.tsx`。
- 仓库约定：中文注释、prettier 单引号、eslint `--max-warnings=0`。

## Commands

| Purpose | Command | Expected |
|---|---|---|
| 目录再生成 | `node --import tsx scripts/generate-public-catalog.ts`（以脚本实际用法为准） | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| 测试 | `npm test` / `npm run test:frontend`（定向先行） | all pass |
| Lint | `npx eslint <改动文件> --max-warnings=0` | exit 0 |

## Scope

**In scope**:
- `shared/lib/curated-product-skills.ts`（3 张 sourceType 翻转）
- `shared/lib/capability-manifest-catalog.ts`（同 3 张 manifest 层翻转）
- `scripts/migrate-builtin-clone-source.ts`（源 id 清单扩展 + 运行迁移）
- `shared/lib/public-skill-catalog.ts`（再生成产物）
- `tests/`、`src/tests/` 重锚与新增（官方组 6→9 断言）

**Out of scope**: 古言/克苏鲁/番茄/海外/老福特（维持付费）；链路族与套牌；
PRIVATE_CURATED_TEMPLATES 模板文本；`TOO_MANY_EFFECTIVE_SKILL_CARDS` 总闸；
`private-177`（与转内置的 96 重复，不转）。

## Steps

### Step 1: 双层翻转
`curated-product-skills.ts` 与 `capability-manifest-catalog.ts` 中上述 3 张的
`sourceType` → `'built-in'`（licensed 两张 + plaza 一张；bible-world-builder 的
licenseStatus 字段若有保留原文不动，仅 sourceType 表达供给分区）。
**Verify**: `npm run typecheck`；node 脚本断言 3 张双层均 built-in。

### Step 2: 目录再生成 + 级联重锚
运行生成脚本；预期 diff 仅 3 处 sourceType 及官方组相关数字。typecheck + 两套全量，
红的按重锚惯例处理（官方组 1→6→9 相关数字断言、分区测试）。连续 5 处无法语义
不变重锚 → STOP。
**Verify**: 两套全量全绿。

### Step 3: 存量克隆迁移
扩展 `scripts/migrate-builtin-clone-source.ts`：源 id 清单加入
`bible-world-builder`、`opening-novelty-hook`、`de-ai-rhythm-restorer`
（保持原 4 张不变，变为 7 张清单）；运行一次（主仓 dev server 运行中，
选错峰或提示停服后执行——与 Plan 257 同口径）。验证幂等（二遍 0 行）。
**Verify**: 定向测试全绿；生产库迁移行数打印留档。

### Step 4: 收尾验证
`npm test` + `npm run test:frontend` 全量；改动文件 eslint 0；
官方组呈现 9 张（1 原有 + 4 张 Plan 257 + 3 张本轮 + 去AI味规则卡 = 实际以
`isOfficialSupplyAsset` 过滤计数为准）。

## Test plan

- `plan257-official-supply.test.ts`（或新文件）重锚+新增：官方分区含本轮 3 张
  （按 title）、双层 built-in 断言、题材卡（古言/克苏鲁）与平台卡（番茄/海外）
  双层维持非 built-in。
- 迁移脚本测试扩展：新 3 张源的克隆迁移用例。

## Done criteria

- [ ] typecheck 0；两套全量全绿
- [ ] 3 张卡 asset+manifest 双层 built-in；古言/克苏鲁/番茄/海外维持付费侧
- [ ] 迁移脚本覆盖 7 张源 id 且幂等
- [ ] 改动文件在 In scope 内

## STOP conditions

- manifest 层结构与 257 时不一致（被并行改动）。
- 级联红 >5 处无法语义不变重锚。
- 再生成 diff 触及本计划外卡的 sourceType。

## 汇报格式

STATUS: COMPLETE | STOPPED
STEPS / STOPPED BECAUSE / FILES CHANGED / NOTES