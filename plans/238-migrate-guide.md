# Plan 238: 迁移者入口前置——重构卡发现性（第三轮审查，P1）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 95111f4..HEAD -- src/components/SkillsStudioView.tsx`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P1（迁移者是 228 立项时认定的 P0 人群，但重构卡至今藏在「写作技法」页签+阶段过滤两层深处）
- **Effort**: S-M
- **Risk**: LOW-MED（概览 additive 节点 + 页签联动；复用 235 的 additive 模式）
- **Depends on**: 无（228 已交付两张重构卡与其候选链）
- **Category**: feature（导购 · 迁移者）
- **Planned at**: commit `6451c43`, 2026-09-16（来源：第三轮深度审查 · 第二诊遗留的发现性缺口）

## Why this matters

第二诊确认：带大纲/人设家底的迁移者是重构卡的目标人群，但入口现状是「能力商店 → 写作技法页签 → ①立设定与大纲阶段 → 翻到卡列表尾部」。235 给了新手（cold-start-guide）和零收藏用户（skill-map-preview）概览指引，唯独迁移者没有入口——他们进店第一眼看到的仍是"从灵感开始"的流程叙事，不知道系统已经支持"带资料重构"。

## Current state（2026-09-16 亲读核实，锚点基于 `6451c43`）

1. 重构卡：`refine-character-rebuild`（人设重构器）/`refine-outline-rebuild`（大纲重构器），manifest stages=['planner']（displayStages creative-setup），curatedCategory 分别为 bible/opening。
2. 真实路径：能力商店 → 写作技法 tab → ①立设定与大纲阶段按钮 → 卡列表尾部两张卡（真页面取证，2026-09-16：双卡带「官方保修+来料加工」徽标与绑定提示，渲染正确）。
3. 235 已交付概览 additive 指引模式：cold-start-guide（无作品）、skill-map-preview（零收藏），均 data-testid 且条件渲染。
4. 概览的指引卡与商店 tab 联动的现成先例：`setActiveTab('mySkills')`（TAB Switcher）与 `selectedCapability` 分类状态均在 SkillsStudioView 内。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 定向 | `npx vitest run --config vitest.config.frontend.ts src/tests/cold-start-guidance.test.tsx src/tests/skills-studio-plan158.test.tsx` | 全绿 |
| 全量 | `npm run test:frontend` | 全绿 |

## Scope

**In scope**：
- 概览新增迁移者指引卡（testid `migrate-guide`，与 skill-map-preview 同容器渲染）：文案「已有大纲、人设资料？不必从灵感开始——用重构卡在既有事实上做结构性重组，产物先出候选确认后再写入。」+ 按钮「查看重构卡」（联动：切到商店 selectedCategory=写作技法 + 阶段=①，或至少 setActiveTab 到商店并让用户落在写作技法页签；联动实现按现有状态机最小改动）
- 显示条件：`!selectedNovel || （该作品未配置任一重构卡）`——已用重构卡的用户不再被打扰；实现口径用 capabilityMemberships/projectTechniqueIds 查两张卡的 persistedSkillId（对齐 235 isDeckCardConfigured 的解析方式）
- 联动落点若发现商店分类状态跨视图传递复杂，允许降级为「仅切到商店 tab」并在卡内文案写明位置（写作技法 → ①立设定与大纲），降级决策记入台账

**Out of scope**：
- 重构卡本身与候选链（228 已交付）
- 创建流程页签的"带资料进入"新流程叙事（流程目录改动，另议）

## Steps

### Step 1: 指引卡 + 显示条件

**Verify**: 组件测试——未用重构卡时卡片可见且含按钮；点击后落在写作技法页签（或降级形态）；已配置重构卡（store 里塞 membership）时不显示

### Step 2: 回归 + 台账

**Verify**: plan158/cold-start-guidance 全绿；全量绿；台账落账

## Done criteria

- [ ] 带资料的迁移者进店第一屏即可发现重构路径
- [ ] 已采用用户不被重复打扰
- [ ] 台账落账

## STOP conditions

- 商店分类/阶段状态机无法从概览安全联动（会出现半选中态）且降级方案文案无法准确描述路径 → 停止报告
