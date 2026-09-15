# Plan 226: 症候入口与分数诚实——「这章要解决什么」任务导航 + 适合度理由上架（A3/B1/F1 部分/P0-B）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat b3a5bcc..HEAD -- src/components/SkillsStudioView.tsx src/components/skills/PlazaAssetCard.tsx src/lib/capability-shelf.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P0（选择困难的直接解：货架按进货源码陈列，用户按症状找药）
- **Effort**: M
- **Risk**: LOW-MED（新导航层 + 排序默认值变化，不动数据）
- **Depends on**: 225（分区先立，症候入口在区内的 drawers 上开）
- **Category**: feature（能力商店诊断 · 处方化入口）
- **Planned at**: commit `b3a5bcc`, 2026-09-15（来源：四轮思考 · 选择困难轮 + 全面诊断 A3/B1）

## Why this matters

用户带着症状进店（文不像人写的 / 开篇不钩人 / 口吻生硬 / 过签没底），现在的界面却要求他先学会五类页签、两个神秘分数和三个相似按钮。同时已有的诊断资产被埋没：适合度按作品上下文算出（题材 30 + 平台 20 + 阶段 15 加权），理由都生成好了（「✓ 命中题材」），却只渲染成一枚裸分数，理由仅存在于 hover title。处方化的全部数据都在，缺一层任务导航。

## Current state（2026-09-15 亲读核实，锚点基于 `b3a5bcc`）

1. `src/lib/capability-shelf.ts:computeCardFitness` — 适合度 = 题材(30) + 平台(20) + 阶段(15) 加权，`reasons[]` 逐条生成（「✓ 命中题材：都市」「✓ 适配平台」）。
2. `src/components/skills/PlazaAssetCard.tsx:127-135` — 卡面只渲染 `适合度 {score}`，reasons 仅作为原生 `title` tooltip（移动端/触屏不可见）。
3. `src/components/skills/PlazaAssetCard.tsx:122` — 「冷启动证据 {score}」无任何定义/基准说明；全目录 195/256 张带分（45-98），无一处理解释。
4. 页签结构：`SkillsStudioView` plaza tablist（创作流程/写作技法/拆书卡/审稿与精修/文风与正文）+ 全部阶段二级过滤。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 定向 | `npx vitest run --config vitest.config.frontend.ts src/tests/skills-studio-plan158.test.tsx src/tests/<新用例>` | 全绿 |
| 前端全量 | `npm run test:frontend` | 全绿 |
| typecheck | `npm run typecheck` | 0 |

## Scope

**In scope**：
- 页签上方「这章要解决什么」症候导航层：**去 AI 味 / 开篇与钩子 / 口吻腔调 / 节奏推进 / 过签检查** 五个固定症候（首版硬编码映射：症候 → 现有卡集合过滤条件，基于 primaryCategory/title 关键词/goal 关键词，不新增目录字段）
- 适合度理由上架：卡面 chips 渲染 reasons（hover title 保留）；文风与正文区默认按适合度降序（无作品上下文时保持现状）
- 分数诚实：「冷启动证据」加悬浮定义（它是什么：官方基准评测对卡面提示词的冷启动质量评分；45-98 分；仅代表提示词本身非生成效果）

**Out of scope**：
- 自由文本症状输入（后续按需）
- 新目录字段、后端改动
- 症候的动态推荐（依赖回执数据积累，另行立项）

## Steps

### Step 1: 症候映射与导航层

新增 `src/lib/capability-symptoms.ts`：五个症候常量 + `filterBySymptom(assets, symptom)` 纯函数（关键词/分类映射，附单测）；SkillsStudioView 页签上方渲染症候 chips，选中即过滤当前货架并可清除。

**Verify**: 映射单测（每症候至少命中 1 张卡，去AI味必须命中去AI味规则卡 95）；组件测试（选中/清除/计数联动）

### Step 2: 适合度理由上架 + 分数定义 + 回归

PlazaAssetCard 适合度 chips 渲染 reasons（≤3 条，溢出收进 hover）；文风与正文区默认适合度降序；「冷启动证据」加 title 定义悬浮。跑 plan158 回归（排序/文案变化若影响既有断言，重锚并注明）。

**Verify**: plan158 + 前端全量绿；typecheck 0；台账落账

## Done criteria

- [ ] 用户可按症状一步到达候选卡集合
- [ ] 适合度带理由可见；证据分有定义
- [ ] 台账落账

## STOP conditions

- 症候映射出现大面积误命中（某症候 >30 张卡或 0 张卡）→ 停止调整映射策略，不得硬上线。
