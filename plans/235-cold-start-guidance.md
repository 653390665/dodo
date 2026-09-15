# Plan 235: 导购前置——保底可见性与能力卡地图前置（第二诊·缺口 D，P1）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 9df11b9..HEAD -- src/components/SkillsStudioView.tsx src/components/skills/SkillMapPanel.tsx`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P1（两个最好的导购工具——保底配置、能力卡地图——恰好对最需要它们的人不可见）
- **Effort**: S-M
- **Risk**: LOW-MED（概览区 DOM 变更，plan158 系列测试锚定概览；新增节点保持 additive + testid）
- **Depends on**: 无（230 已交付保底配置本体，本计划只解决"可见性"）
- **Category**: feature（能力商店第二诊 · 导购）
- **Planned at**: commit `9df11b9`, 2026-09-16（来源：第二诊 · 零作品态取证）

## Why this matters

「我的能力卡」视图里有一个做得很完整的能力卡地图（SkillMapPanel：收藏数/有反馈数/冷启动均分/维度分布/缺失维度提示/可融合路径），但它藏在零收藏的新用户看不到的入口后面。保底配置（230）的触发条件 `isStarterEligible` 要求 `Boolean(selectedNovel)`——而真正"零配置"的新用户恰恰还没有作品，进店看到的是 118 张卡和「先在书库选择作品」。第二诊结论：导购要对最需要它们的人可见。

## Current state（2026-09-16 亲读核实，锚点基于 `9df11b9`）

1. `src/components/SkillsStudioView.tsx:882-888`：
   ```ts
   const isStarterEligible =
     Boolean(selectedNovel) &&        // ← 无作品时整个导购不可见
     !configurationDirty && !staleConfigurationSession &&
     (capabilityProfile?.favoriteTechniqueIds?.length ?? 0) === 0 &&
     !capabilityProfile?.activeFlowId && !capabilityProfile?.projectSkillDeck?.mainCardId;
   ```
2. `src/components/SkillsStudioView.tsx:2220`：starter-config-card 仅在 `isStarterEligible` 时渲染于「当前作品」卡内。
3. `src/components/skills/SkillMapPanel.tsx`：能力卡地图（props: `skills`），当前唯一挂载点 SkillsStudioView.tsx:2375（「我的能力卡」视图内）；零收藏时该面板不可达。
4. 真页面取证（2026-09-16，无作品态）：概览「当前作品」卡只显示「先在书库选择作品，再管理能力。」+「去书库选择作品」按钮；starter 卡缺席。
5. 概览区另有能力卡地图摘要字段（能力卡总数/有使用反馈/冷启动均分/维度分布/缺失维度/可融合路径）在「我的能力卡」视图——注意与 SkillMapPanel 的关系在执行时核对（可能是同一数据的两处渲染）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 定向 | `npx vitest run --config vitest.config.frontend.ts src/tests/skills-studio-plan158.test.tsx src/tests/<新用例>` | 全绿 |
| 回归 | `npm run test:frontend` | 全绿 |
| typecheck | `npm run typecheck` | 0 |

## Scope

**In scope**：
- **无作品态导购卡**：`selectedNovel` 为空且无任何配置时，概览「当前作品」卡显示导购内容——保底配置预览（静态展示 STARTER_PROFILE_PRESET 的两件套：小飞机流程 + 去AI味护栏）+「去书库选作品，回来一键套用」按钮（复用现有 去书库选择作品 导航，不新增路径）。不改变"应用必须先有作品"的语义（applyConfiguration 依赖 selectedNovel，不硬改）
- **零收藏地图前置**：商店首屏（概览 TAB 区上方或概览卡内）对零收藏用户展示 SkillMapPanel（或其空状态精简形态：维度缺失提示 + 「这章要解决什么」症候入口指引）；有收藏 ≥1 时保持现状（地图留在我的能力卡）
- 新节点全部带 `data-testid`（如 `cold-start-guide` / `starter-preview-no-novel`），不动既有概览 DOM 结构

**Out of scope**：
- 无作品时允许应用配置（applyConfiguration 依赖作品，不硬改）
- 反馈环入口（第二诊处方 5，单独拍板后再立项）
- SkillMapPanel 本体的功能扩展

## Steps

### Step 1: 无作品态导购卡

SkillsStudioView 概览「当前作品」卡：无作品 + 零配置分支渲染导购内容（保底预览 + 去书库按钮）。

**Verify**: 新组件测试——无作品时导购卡可见且含保底两件套文案与去书库按钮；有作品时不渲染（isStarterEligible 语义不变）

### Step 2: 零收藏地图前置

零收藏时商店首屏挂 SkillMapPanel（先读其空态渲染成本，若依赖作品数据则抽空态精简形态）。

**Verify**: 组件测试——零收藏时首屏可见地图/缺失维度提示；收藏后不出现在首屏（去重）

### Step 3: 回归 + 台账

**Verify**: plan158 全绿（概览断言若受影响重锚注明）；`npm run test:frontend` 全绿；typecheck 0；台账落账

## Done criteria

- [ ] 无作品新用户进店即见：保底配置预览 + 去书库路径 + 维度缺失指引
- [ ] 有作品老用户视图无变化
- [ ] 台账落账

## STOP conditions

- SkillMapPanel 空态渲染强依赖作品/后端数据且抽离成本超 S → 停止，报告后降级为纯静态指引卡
- plan158 概览断言需要大面积重锚（>10 处）→ 停止，说明概览 DOM 演进冲突
