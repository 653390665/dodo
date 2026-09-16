# Plan 240: 散卡人工策展打标——为数据驱动淘汰预置判断（第三轮审查·供给路径第 4 步）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat e019218..HEAD -- shared/lib/prompt-governance-catalog.ts shared/lib/curated-product-skills.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P2（第二轮评估确认的路径：筛选靠数据不靠眼缘；在反馈环（241）数据到来前，先用人工判断给淘汰预置依据）
- **Effort**: S-M
- **Risk**: LOW（纯元数据新增，不改任何执行行为；不删卡）
- **Depends on**: 无（239 原料库折叠是它的展示载体，但打标本身独立）
- **Category**: chore（供给治理 · 策展）
- **Planned at**: commit `e019218`, 2026-09-16（来源：用户批准的供给路径——折叠已做（239），打标先行，淘汰等 241 数据）

## Why this matters

货架散卡约 90 张，其中真正平庸的和有特色的混在一起。淘汰的两个前提：反馈数据（241，未建）与人工判断（本计划）。人工打标是可逆的元数据动作：三档（有特色 featured / 平庸 standard / 疑似重复 suspect-duplicate），不删卡、不改排序，只为将来的数据驱动淘汰提供先验——当 241 的采纳数据显示某卡零使用时，策展档位决定它是"下架候选"还是"被埋没"。

## Current state（2026-09-16 亲读核实，锚点基于 `e019218`）

1. 源目录 `prompt-governance-catalog.ts` 的 asset 构造无策展字段；生成器 `cloneAndSanitize` 按白名单键透传。
2. 散卡构成（232-234 治理后）：题材模板 16（参数化模板族）、generic 消毒副本（细纲/大纲/章纲类）、真特色散卡（天马清澈版、锅盖第一人称、爆款金手指、猫头鹰脑洞、老福特系列）、lwl 工具杂集。
3. 239 已交付原料库折叠容器（前端展示位）。
4. 淘汰决策依赖：`getSkillScoreChannels().observedPerformance`（241 将喂入）+ 本计划的策展档位。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 前端定向 | `npx vitest run --config vitest.config.frontend.ts src/tests/style-shelf-decks.test.tsx` | 全绿 |
| freshness | `NODE_ENV=test node --test --import tsx tests/public-catalog-freshness.test.ts` | 全绿 |

## Scope

**In scope**：
- 源目录 asset 增可选字段 `curationTier?: 'featured' | 'standard' | 'suspect-duplicate'`（类型 + 生成器白名单键透传 + 生成文件携带）
- 逐卡打标（仅散卡，套牌卡/官方内置不打）：featured 给真特色散卡（天马/锅盖/猫头鹰/一次一章/老福特系列/爆款金手指等，卡面有独立方法论的）；suspect-duplicate 给与在架卡功能同质或换皮残留（generic 大纲/细纲/章纲类中已有同质正卡的）；其余 standard
- 打标清单以注释或独立 JSON 留档（id → tier → 一句话理由），可审计
- 前端暂不渲染 tier（淘汰消费方是 241 之后的下架决策，非卡面信息）；原料库折叠头可显示「含策展标记 N 张」与否——不做，保持 239 现状

**Out of scope**：
- 删除任何卡（淘汰动作等 241 数据 + 拍板）
- tier 影响排序/展示（避免自我实现）
- 套牌卡与官方内置卡打标（已有供给语义）

## Steps

### Step 1: 类型 + 透传 + 生成

shared 类型加可选字段；生成器 TEXT_KEYS/透传白名单补键；重生成验证字段存活。

**Verify**: freshness 全绿；生成文件抽样含 curationTier

### Step 2: 逐卡打标 + 清单留档

按上述三档给散卡标 tier（依据：卡面 goal/successSignal 独立方法论 = featured；与同工位正卡同质 = suspect-duplicate）；清单写入 `plans/240-curation-tags.md` 或源内注释。

**Verify**: 打标覆盖率 = 全部散卡；featured+suspect 清单人工可复核

### Step 3: 回归 + 台账

**Verify**: 定向 + freshness 绿；typecheck 0；台账落账

## Done criteria

- [ ] 全部散卡有策展档位，清单可审计
- [ ] 零行为变化（排序/展示/执行均不变）
- [ ] 台账落账

## STOP conditions

- 打标过程中发现 ≥15 张卡无法给出可信档位判断 → 停止，列清单交人工复核（宁可欠打标不可错打标）
