# Plan 204: 195 切片 B——SkillsStudioView 增强包/选择簇下沉 store

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat f39b597..HEAD -- src/components/SkillsStudioView.tsx src/tests/skills-studio-plan158.test.tsx`
> 若有变更，先对照「Current state」摘录核对（行号漂移 ≤ 50 行可接受；若 203 已先行落地，state/effect 行号会整体前移——以标识符定位为准）。

## Status

- **Priority**: P3（架构债）
- **Effort**: M
- **Risk**: LOW-MED（选择簇状态相对独立，但与切片 A 的 session 持久化有耦合点）
- **Depends on**: none（可与 203 并行；若 203 先落地则复用其 store 先例与行号漂移）
- **Category**: refactor
- **Planned at**: commit `f39b597`, 2026-09-12

## Why this matters

Plan 195 三切片之二：增强包（package）选择簇是 SkillsStudioView 内第二块高内聚状态，五个 state + 门控逻辑与配置会话（切片 A）并列。下沉后组件继续减负，且为 205 的 PackageConfigDialog 拆分提供 store 依赖。

## Current state（2026-09-12 勘察，行号为当前实测）

- 五个 state：`SkillsStudioView.tsx:993-1004`
  - `packageSelections`（993）、`pendingPackageSteps`（994）、`packageSelectionDrafts`（995）、`packageComponentResults`（998）、`packageResultLaunchFeedbackAssetId`（1001）
- 门控/派生逻辑：1326（查找）、1468-1493（packageComponentResults 查找）、1503-1520（提交禁用口径）、2414-2425
- 与切片 A 的耦合点：session 恢复/保存含 package 字段（1654、1678、1708、1727）、1824
- JSX 使用区：3144-3177、3512-3520、3579-3652、3720-3778、3808、3868
- 安全网：plan158 38 用例
- store 先例：`src/stores/skills-candidate-store.ts`

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| plan158 安全网 | `node node_modules/vitest/vitest.mjs -c vitest.config.frontend.ts run src/tests/skills-studio-plan158.test.tsx` | 38 用例全绿 |
| 前端全量 | `npm run test:frontend` | 全绿 |
| lint | `node node_modules/eslint/bin/eslint.js src/components/SkillsStudioView.tsx src/stores/skills-package-store.ts --max-warnings=0` | 0 警告 |

## Scope

**In scope**：

- 新建 `src/stores/skills-package-store.ts`（五 state + 提交禁用口径等派生 selector）
- `SkillsStudioView.tsx`：五 state 迁移、门控逻辑改读 store、session 持久化耦合点改造

**Out of scope**：

- PackageConfigDialog 组件拆分（205）
- 增强包的网络动作语义

## Steps

### Step 1: store 骨架 + 五 state 迁移

组件改订阅；门控逻辑（1468-1493/1503-1520）改读 store selector；行为零变化。

**Verify**: plan158 全绿 + 前端全量绿

### Step 2: session 持久化耦合收口

1654/1678/1708/1727 四处 package 字段的恢复/保存改为跨 store 编排（若 203 已落地则调 configuration store 的 session action；否则暂由组件编排并标注 TODO 依赖）。补单测：session 恢复后 package 字段水合正确。

**Verify**: plan158 全绿 + 新增水合单测绿

### Step 3: 提交禁用口径收口

1503-1520 的提交禁用派生移入 store selector，JSX 只消费布尔；2414-2425 同步。

**Verify**: 全量绿 + lint 0 警告

## Test plan

plan158 + 前端全量 + 水合单测；E2E 冒烟同 203。

## Done criteria

- [ ] 五 state 不再存在于 SkillsStudioView
- [ ] session 水合有单测锁定
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- 与切片 A 的 session 字段编排发现共享可变中间态（无法干净切分）→ 停止报告耦合图，评估 A/B 合并落地。

## Maintenance notes

205 的 PackageConfigDialog 依赖本 store；落地后 notes-195-phase3-assessment.md 标记切片 B 完成。
