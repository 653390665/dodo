# Plan 205: 195 切片 C——技能货架数据 hook + 视图组件拆分

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat f39b597..HEAD -- src/components/SkillsStudioView.tsx src/components/skills/ src/lib/hooks/ src/tests/skills-studio-plan158.test.tsx`
> 若有变更，先对照「Current state」摘录核对（若 203/204 已落地，行号整体前移——以标识符定位为准）。

## Status

- **Priority**: P3（架构债，三切片中最大）
- **Effort**: L
- **Risk**: MED（JSX 拆分面广；候选托盘依赖切片 A 的 store）
- **Depends on**: 203（切片 A——候选托盘子组件引用 configuration store）
- **Category**: refactor
- **Planned at**: commit `f39b597`, 2026-09-12

## Why this matters

Plan 195 三切片之三（评估文档标注 L）：货架数据获取与三个大块 JSX（候选托盘/包配置弹窗/文风货架）仍内联在 SkillsStudioView，是该组件行数的主要构成。拆分后组件回到可审读规模，且 `src/components/skills/` 目录已有 11 个文件的同域先例。

## Current state（2026-09-12 勘察，行号为当前实测）

- 货架数据侧：`savedSkills` state（983 行）；加载 effect 1146-1155（`syncSkillFeedbackScores().then(setSavedSkills)`，`subscribeToChanges` 1154）；`computeCardFitness`/`groupStyleShelf` 导入（76/78 行）；货架分组调用侧 3353-3360。
- savedSkills 渲染消费散布：1170-1171、1265、1348、1369、2069、2324-2329、2554、2882、2924-2956（SkillMapPanel）、4230（`allSkills={savedSkills}`）。
- 三个拆分目标组件（评估文档命名）：`CandidateTray`、`PackageConfigDialog`、`StyleShelf`——当前不存在；目标目录 `src/components/skills/`（已存在，11 文件）；`librarySkills` 标识符**不存在**（评估文档笔误，实际只有 `savedSkills`）。
- SkillsStudioView 现为 4321 行（评估时 3070，A/B 未拆前还会增长——本计划以拆后净减为准）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| plan158 安全网 | `node node_modules/vitest/vitest.mjs -c vitest.config.frontend.ts run src/tests/skills-studio-plan158.test.tsx` | 38 用例全绿 |
| 前端全量 | `npm run test:frontend` | 全绿 |
| 行数口径 | `wc -l src/components/SkillsStudioView.tsx` | 拆后记录净减 |
| lint | `node node_modules/eslint/bin/eslint.js src/components/SkillsStudioView.tsx src/components/skills/ src/lib/hooks/useSkillsShelfData.ts --max-warnings=0` | 0 警告 |

## Scope

**In scope**：

- 新建 `src/lib/hooks/useSkillsShelfData.ts`（savedSkills 获取 + 订阅 + 货架分组派生）
- 新建 `src/components/skills/CandidateTray.tsx`、`StyleShelf.tsx`、`PackageConfigDialog.tsx`（先内联搬迁，props 最小化；候选托盘引用 203 的 configuration store）
- `SkillsStudioView.tsx` 消费点替换

**Out of scope**：

- SkillMapPanel（2924-2956 消费 savedSkills，但属独立面板，不在三组件命名内——仅改数据来源）
- 任何展示语义/交互变化

## Steps

### Step 1: useSkillsShelfData hook

savedSkills state + 加载 effect（1146-1155）+ 分组派生（3353-3360 的 computeCardFitness/groupStyleShelf 调用）迁入 hook；组件消费点替换。行为零变化。

**Verify**: plan158 全绿 + 前端全量绿

### Step 2: StyleShelf 拆分

文风货架 JSX（含分组渲染）迁 `StyleShelf.tsx`，props 收敛为货架分组数据 + 选择回调。

**Verify**: plan158 全绿

### Step 3: CandidateTray 拆分

候选托盘 JSX 迁 `CandidateTray.tsx`，引用 skills-configuration-store（203 产物）与 candidate store。

**Verify**: plan158 全绿

### Step 4: PackageConfigDialog 拆分

包配置弹窗 JSX 迁 `PackageConfigDialog.tsx`，引用 skills-package-store（204 产物）。

**Verify**: 前端全量绿 + lint 0 警告；记录 SkillsStudioView 行数净减与 props 数（口径 62→~50）

## Test plan

plan158 + 前端全量 + E2E 冒烟（`npx playwright test tests/e2e/agent-workspace-journey.spec.ts tests/e2e/book-factory-journey.spec.ts`）。

## Done criteria

- [ ] 三个子组件落地 `src/components/skills/`，SkillsStudioView 行数净减 ≥ 800
- [ ] props 口径达成或记录偏差原因
- [ ] `plans/README.md` 状态行已更新；195 行 Phase 3 标注完成

## STOP conditions

- 任一子组件拆分需要 > 15 个 props 透传 → 停止，报告 state 归属重估（可能需再下沉一个 store）。
- plan158 用例需改语义 → 同 203 的 STOP。

## Maintenance notes

落地后 195 的 Phase 3 三切片全部完成；notes-195-phase3-assessment.md 可归档。
