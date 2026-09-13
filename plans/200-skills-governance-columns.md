# Plan 200: 技能卡治理字段落库——schema 缺口修复（Deck Pack 实施前置）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat f39b597..HEAD -- server/lib/db/skills.ts server/db-migrations* shared/types/skills.ts scripts/deck-pack-prototype.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P2（deck pack 实施的硬前置；当前是持久化层与类型层的静默缺口）
- **Effort**: M
- **Risk**: MED（涉及 schema additive 变更——见 STOP 前的显式审批注记）
- **Depends on**: none（192 的 deck pack 实施依赖本计划）
- **Category**: persistence
- **Planned at**: commit `f39b597`, 2026-09-12

## Why this matters

Plan 192 原型实测发现：`Skill` 共享类型与运行时校验里的治理/分组字段**不落库**——`server/lib/db/skills.ts:88` 的 `insertColumns`（192 PRD 勘察时的 58 行为 format 前旧址） 不含 `deck_group_id`、`deconstruction_card_type`、`sanitization_status`、`runtime_status`、`source_type`、`access_tier`、`is_runtime_ready`。后果：①「消毒并启用」产出的副本重启后丢失分组/治理态（除非运行时重新判定）；②deck 分组（`deckGroupId`）跨会话断裂；③Deck Pack 导出/导入（192）无法以落库数据为准。这是持久化层对共享类型的静默降级，无论 deck pack 是否实施都应修复。

## Current state

- `server/lib/db/skills.ts:58` `insertColumns`（列清单）+ 同文件 mapper（row→Skill）——缺上述 7 字段。
- `shared/types/skills.ts:44` `Skill`：`deckGroupId`、`deconstructionCardType`、`sanitizationStatus`、`runtimeStatus`、`sourceType`、`accessTier`、`isRuntimeReady` 全部在类型中。
- 落库门禁：`server/capabilities/manifest.ts:100` `validateSkillCardForScope`（含 deconstructionCardType 的卡要求 runtime-ready/active + sourceType 授权枚举）；`validateSkillPersistence` 拒绝非法 sourceType。
- additive schema 惯例：E2E 注释「A fresh isolated SQLite database runs additive schema setup before the HTTP listener is ready」——建表/补列走启动期 additive setup（grep `ALTER TABLE ... ADD COLUMN` 或 schema setup 模块定位现行模式）。
- 原型：`scripts/deck-pack-prototype.ts`（14 断言）已实证「DB mapper 读回运行时默认值 → zip 层断言只能断运行时态」；本计划落地后其持久化断言可转真。
- 审批注记：仓库规则「不改 migrations 无显式审批」——本计划即为该 schema additive 变更的显式审批载体；执行仅允许 additive（ADD COLUMN / 新建表），禁止改列/删列/改既有行语义。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| skills 持久层测试 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/skills-db*.test.ts tests/skills*.test.ts`（按 ls 实际文件） | 全绿 |
| 原型 | `npx tsx scripts/deck-pack-prototype.ts` | 14 断言全过（持久化断言转真） |
| 后端全量 | `npm run test:coverage:backend` | 门槛通过 |
| E2E 冒烟 | `npx playwright test tests/e2e/agent-workspace-journey.spec.ts tests/e2e/book-factory-journey.spec.ts` | 全绿（技能卡创建/消毒链路不受扰） |

## Scope

**In scope**：

- `server/lib/db/skills.ts`（insertColumns + mapper + additive 列 setup）
- schema setup 模块（additive ADD COLUMN，带存在性守卫）
- `scripts/deck-pack-prototype.ts`（持久化断言从「运行时默认值」改为「真值」）
- 相关单测（create/list roundtrip 新断言）

**Out of scope**：

- Deck Pack 导出/导入完整实施（192 另立，依赖本计划）
- 旧数据回填（存量行新增列走 NULL/默认值即可，治理态由运行时按 manifest 重判定——不写迁移脚本）

## Steps

### Step 1: 现行 additive 模式勘察 + 列定义

定位 schema setup 的现行 additive 补列写法与守卫（PRAGMA table_info 或等价），按同模式为 7 字段设计列（类型/默认值对齐 mapper 语义：is_runtime_ready INTEGER、其余 TEXT/NULL）。

**Verify**: 勘察结论写入本文件 Maintenance notes；新旧库（空库 + 既有 test fixture 库）启动均不报错

### Step 2: insertColumns + mapper + roundtrip 测试

create/read 双向补 7 字段；新增单测：createSkill（带全部治理字段）→ listSkills/getSkill 读回逐字段相等；不带治理字段的旧路径读回默认值与运行时判定一致。

**Verify**: 新单测绿 + skills 持久层既有测试绿

### Step 3: 门禁与原型对齐

`validateSkillPersistence`/`validateSkillCardForScope` 的判定数据源改读落库值（不再是运行时入参独有）；deck-pack 原型的 DB mapper 断言改真值。

**Verify**: 原型 14 断言全过；后端全量绿

### Step 4: E2E 冒烟 + 台账

跑 Scope 中的 E2E 冒烟；`plans/README.md` 更新本行 + 192 行标注「前置已就绪」。

**Verify**: 同上

## Test plan

roundtrip 新单测 + 原型断言 + 后端全量 + E2E 冒烟。

## Done criteria

- [ ] 7 个治理字段全链路（create → persist → read → 门禁判定）以落库值为准
- [ ] 原型持久化断言转真
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- 现行 schema setup 不支持安全 additive 补列（如启动期无补列机制）→ 停下报告现有机制，勿自行引入新迁移框架。
- 任一既有测试因列语义变化需改产品语义（非断言适配）→ 停下报告。

## Maintenance notes

**已完成（2026-09-12）**。Step 1 勘察结论：现行 additive 机制为 `server/lib/db-init.ts` 的 `ensureColumn`（PRAGMA table_info 守卫 + ALTER TABLE ADD COLUMN，:159-165），启动期对空库与既有库统一执行，无需新迁移框架。7 列已在该文件 skills additive 区块登记（全部可空、无默认值，存量行走 NULL）：

- `deck_group_id` TEXT、`deconstruction_card_type` TEXT、`sanitization_status` TEXT、`runtime_status` TEXT、`source_type` TEXT、`access_tier` TEXT、`is_runtime_ready` INTEGER（1/0/NULL ↔ true/false/unknown）

mapper 读取采用「列优先、fusion_meta envelope 兜底」：新写入以落库列为准，存量行（列 NULL）沿用 envelope 读值，不改既有行语义；`deck_group_id` 无 envelope 历史，直接读列。落库门禁 `validateSkillCardForScope` 无需改码——`getSkill`/`listSkills`/`updateSkill` 合并基座经 mapper 读到的即是落库列值，拒绝码语义不变。

192 行的「schema 缺口」备注已解除；deck pack 实施计划（192）可直接引用落库字段。验证：skills 相关 14 文件 64 用例绿（含新增 `tests/skills-governance-columns.test.ts` 5 例 roundtrip/门禁语义）、原型 14 断言全过（P10/P14 改断 DB 原始列真值）、E2E 冒烟 2 spec 绿、tsc 0 错误、eslint --max-warnings=0 通过。
