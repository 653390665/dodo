# Plan 195 Phase 3 — SkillsStudioView 进一步分解评估（2026-09-11）

> 只评估不实施。前置：Phase 1（62 条抑制清账，见 notes-195-phase1-classification.md）、
> Phase 2（候选卡簇 → `src/stores/skills-candidate-store.ts`，1/≤3 块）已完成。
> 模式先例：011 计划对 EditorView 的同规模分解（props 97→62）。

## 现状

- `SkillsStudioView.tsx` 约 3070 行、30 个 useState（Phase 2 后 28 个）、15 条 lint 抑制已清账至 12 条（全为行级带理由）。
- 行为安全网：`src/tests/skills-studio-plan158.test.tsx` 38 用例（含持久化失败/代际过期/脏配置等失败路径）。

## 建议切片（三个可独立合并的 PR，按依赖排序）

| # | 切片 | 内容 | 迁移目标 | 预估 |
|---|---|---|---|---|
| A | 会话配置簇 | `configurationDraft` + 三段同步 effect（工作切换重置/代际快照清空/会话恢复水合，Phase 1 清单中的 1189/1280/1336 消化候选）+ `configurationDirty/staleConfigurationSession` | 新 `src/stores/skills-configuration-store.ts`（含 session 编排 action） | M |
| B | 增强包/选择簇 | `pendingPackageSteps`、`packageSelections`、`packageSelectionDrafts`、`packageComponentResults`、`packageResultLaunchFeedbackAssetId` | 新 `src/stores/skills-package-store.ts` | M |
| C | 货架数据 + 视图拆分 | `savedSkills/librarySkills` 获取与货架分组（`computeCardFitness/groupStyleShelf` 调用侧）抽 `useSkillsShelfData` hook；JSX 拆出 `CandidateTray`、`PackageConfigDialog`、`StyleShelf` 三个子组件（`skills/` 子目录已有先例） | `src/lib/hooks/useSkillsShelfData.ts` + `src/components/skills/` | L |

依赖关系：A、B 互相独立可并行；C 依赖 A（候选托盘子组件引用候选 store）。

## 风险与护栏

- 三段同步 effect（A）是行为敏感区：迁移时保留「自应用豁免窗口」（`selfAppliedContextRef` + 5s flagAge）语义，plan158 的脏配置/代际过期用例锁定。
- 每切片一个提交、先跑 plan158 定向再全量；props 预期 62 → ~50（与 014 Phase 5b 的 EditorView 口径一致）。

## 未纳入本轮的抑制

剩余 12 条行级抑制（purity ×8、set-state-in-effect ×2、refs ×1、exhaustive-deps ×1）均为带理由的有意抑制，随切片 A/C 的迁移自然消化其中 3 条；其余为规则局限误报的长期豁免。
