# Plan 237: 无上下文适合度分数诚实化收尾（第三轮审查，P2 转正）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 95111f4..HEAD -- src/components/skills/StyleShelf.tsx src/components/skills/PlazaAssetCard.tsx src/lib/capability-shelf.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P2（第二轮评估遗留：无作品上下文时适合度分是噪声——全货架 23-37 的装饰性数字）
- **Effort**: S
- **Risk**: LOW（纯展示条件渲染；证据分不动）
- **Depends on**: 无
- **Category**: fix（分数诚实）
- **Planned at**: commit `6451c43`, 2026-09-16（来源：第三轮深度审查）

## Why this matters

适合度分（computeCardFitness）的五个权重里"使用反馈 20 分"全库无样本、题材/平台匹配需要作品上下文。无作品时（novelGenreTokens 空、无平台信号）每个卡仍显示「适合度 47/37/33/…」——分数在分（治理分 15 + 基础分），对用户是随机装饰。冷启动证据分已有诚实定义（title 提示"仅代表提示词本身的质量"），适合度分在同场景下反而成了不诚实的那一个。231 立过的原则：分数要么有含义，要么不显示。

## Current state（2026-09-16 亲读核实，锚点基于 `6451c43`）

1. `src/lib/capability-shelf.ts` `computeCardFitness`：题材命中(30)+平台匹配(20)+阶段匹配(15)+使用反馈(20)+治理分(15)；无作品输入时题材/平台/反馈自然为 0，但治理分与阶段分仍产出 23-47 的总分。
2. `src/components/skills/StyleShelf.tsx:91`：`hasFitnessContext = novelGenreTokens.length > 0 || Boolean(novelPlatform)` 仅控制**排序**（226 交付），不控制**展示**——`fitnessChip` 无条件传给每张卡。
3. `src/components/skills/PlazaAssetCard.tsx`：`fitnessChip && (...)` 有 chip 即渲染。
4. 真页面取证（2026-09-16，无作品态）：全部卡显示适合度（47/37/33/30/27/23 分档）。
5. 商店其余入口（SkillsStudioView 2805 起 availableCuratedSkills 网格）同样无条件下传 fitnessChip（若有）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 定向 | `npx vitest run --config vitest.config.frontend.ts src/tests/style-shelf-decks.test.tsx src/tests/capability-craft.test.ts` | 全绿 |
| 全量 | `npm run test:frontend` | 全绿 |

## Scope

**In scope**：
- StyleShelf：`hasFitnessContext === false` 时不传 fitnessChip（芯片消失，排序维持现状——有上下文按适合度降序、无上下文按目录序，均不变）
- SkillsStudioView 直渲染 PlazaAssetCard 的两处（available/locked 网格）：同样仅在能算出有意义的上下文时传 chip；若该处本就无 chip 传参则不动并注记
- 226 的冷启动证据分定义 title 不动

**Out of scope**：
- 适合度权重重设计（反馈 20 分空转属缺口 E 反馈环，待拍板）
- 适合度理由（reasons）的展示增强

## Steps

### Step 1: 条件渲染

StyleShelf 按 hasFitnessContext 决定是否传 chip；核对 SkillsStudioView 网格两处的现状并对齐。

**Verify**: 新组件测试——无作品渲染货架无「适合度」字样、有作品（给 novel genre 文本）时 chip 出现且排序降序不变

### Step 2: 回归 + 台账

**Verify**: style-shelf-decks/craft/plaza 全绿；全量绿；台账落账

## Done criteria

- [ ] 无作品货架零噪声分数；有作品个性化分数照常
- [ ] 台账落账

## STOP conditions

- 发现依赖无上下文分数的既有断言 >5 处需重锚 → 停止报告（可能该分数另有消费语义）
