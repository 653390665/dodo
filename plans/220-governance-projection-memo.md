# Plan 220: 治理目录投影 memo 化——打字/配置路径的广谱重渲源（PERF-02/03）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat d6c2ed2..HEAD -- src/components/SkillsStudioView.tsx src/components/skills/StyleShelf.tsx src/lib/capability-governance.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P2
- **Effort**: S-M
- **Risk**: LOW（纯投影缓存，无行为变化）
- **Depends on**: none
- **Category**: performance
- **Planned at**: commit `d6c2ed2`, 2026-09-15（发现：improve 四路审计 PERF-02/03）

## Why this matters

治理目录投影在 SkillsStudioView 里以**每渲染重跑**的方式散落：包配置弹窗内每次按键（configurationDraft/packageSelectionDrafts 是 store 订阅）都触发整组件重渲并重跑全部投影，每渲染数千次目录比较 + 上千个 manifest 对象分配；货架 73 张卡每卡渲染又各自做 O(211+45) 扫描且 StyleShelf 无 memo。叠加起来是能力商店交互的持续卡顿源。修法全部是纯缓存，无行为变化。

## Current state（2026-09-15 亲读/亲核，锚点基于 `d6c2ed2`）

基准：`PROMPT_GOVERNANCE_CATALOG` 211 条、`SANITIZED_SKILL_COPIES` 45 条、`RUNTIME_STYLE_CATALOG` 256 条、CURATED 143 条。

- `SkillsStudioView.tsx:650` — `getSanitizeRequiredAssets()` 在 useMemo 之外每渲染全量 filter；其内部对每个候选项再调 `hasGeneratedSanitizedCopy` 扫 45 条副本（capability-governance.ts）。
- `SkillsStudioView.tsx:652-681` — `capabilityTabCount(id)` 每次调用 1-3 趟 `filterGovernedAssets`（143 条）+ manifest 分配；`:2276` 的 tab map 里约 8 次/渲染。
- `SkillsStudioView.tsx:1962、:2709` — JSX 内联 `getCoreDefaultGuardrailCount()` / `getConfigurableGuardrailAssets()`。
- `SkillsStudioView.tsx:641-651` — `sanitizedCloneIds` Set、`availableCuratedSkills`/`lockedCuratedSkills` 每渲染重建。
- `src/components/skills/StyleShelf.tsx:51` — 每卡渲染调 `isSanitizeRequiredAsset(asset.id)`（实现 = `PROMPT_GOVERNANCE_CATALOG.find` 线性 211 + 副本扫描 45）；`:89-98` groupStyleShelf/computeCardFitness/isAssetPersisted（`savedSkills.some`）每渲染全跑；组件无 memo。
- 现成修法模板：`SkillsStudioView.tsx:597` 的 `filteredCuratedSkills` 已是 useMemo，同款照抄。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| plan158 | `npx vitest run --config vitest.config.frontend.ts src/tests/skills-studio-plan158.test.tsx src/tests/plan158-skills-studio-candidates.test.tsx` | 全绿 |
| 前端全量 | `npm run test:frontend` | 全绿 |
| typecheck | `npm run typecheck` | 0 |

## Scope

**In scope**：

- `SkillsStudioView.tsx`：散点投影收进 useMemo；`capabilityTabCount` 结果按 tab memo 化
- `src/lib/capability-governance.ts`：`isSanitizeRequiredAsset`/`hasGeneratedSanitizedCopy` 改用模块级预计算 `Set`（sanitize-required id 集合与副本 id 集合，模块加载时构建一次）
- `StyleShelf.tsx`：`React.memo` 化 + 卡级 fitness/持久化判定的依赖收窄

**Out of scope**：

- 投影函数的语义变化（strict 单源化见 221；谓词收敛见 backlog ARCH-01）
- ProjectCockpitView/WorldBibleOnboarding 的同族散点（量小，记录 Maintenance notes）

## Steps

### Step 1: capability-governance 模块级 Set

`hasGeneratedSanitizedCopy` 改查模块级 `Set`（由 `SANITIZED_SKILL_COPIES` 构建一次）；新增导出 `isSanitizeRequiredAssetIdSet`（或内部化）供 220 消费。行为等价。

**Verify**: typecheck 0；plan158 两套件绿

### Step 2: SkillsStudioView 投影 memo 化

`:650` 投影、`:641-651` 集合与分组、`capabilityTabCount` 结果收进 useMemo（依赖数组纳入 `savedSkills`/`selectedCategory` 等真实依赖）；JSX 内联两处改为 memo 值。

**Verify**: plan158 绿；React DevTools 或临时计数器确认按键时投影不再全量重跑（可人工冒烟：包配置弹窗输入时 Performance 面板无目录 filter 热点）

### Step 3: StyleShelf memo 化 + 台账

StyleShelf 组件 React.memo（handlers 引用稳定性核对，必要时在父级 useCallback）；台账落账。

**Verify**: 前端全量绿；台账落账

## Done criteria

- [ ] 投影调用从每渲染 O(目录×次数) 降为 O(依赖变化)；isSanitizeRequiredAsset O(1)
- [ ] plan158 + 前端全量绿；台账落账

## STOP conditions

- memo 化后出现行为差异（分组顺序/计数漂移）→ 停止核对依赖数组，不硬调。
