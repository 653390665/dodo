# Plan 241: 反馈环第一口数据——章节完成后的轻量能力反馈（处方 5，Round 38 主菜）

> **Executor instructions**: 本计划为 Round 38 占位（用户已拍板方向，待执行窗口）。执行前先按 Drift check 核对锚点。
>
> **Drift check (run first)**: `git log --oneline -5`；确认 240 已 DONE、Round 37 全收口后再开工。

## Status

- **Priority**: P1（能力卡地图显示「有使用反馈 0」：适合度分 20 分反馈权重全库无样本，淘汰与推荐都没有数据地基）
- **Effort**: M
- **Risk**: MED（涉及写作主链路完成时点交互；必须零打扰化设计）
- **Depends on**: 240（策展档位为反馈数据提供先验维度）
- **Category**: feature（数据闭环 · 反馈环）
- **Planned at**: commit `e019218`, 2026-09-16（来源：第二诊缺口 E；用户 2026-09-16 拍板「可以」）

## Why this matters

能力卡的"使用反馈 20 分"权重自上线以来零样本；能力卡地图的「有使用反馈的能力卡：0」是整条供给治理链上唯一没有数据源的环节。没有它：适合度是个半盲打分器、淘汰没有依据（240 只能预置人工先验）、推荐无法自我修正。本计划交付"第一口数据"——最小可用的反馈采集，不做评分系统。

## Current state（2026-09-16 亲读核实）

1. 适合度权重：`computeCardFitness` 使用反馈 20 分，读 `getSkillScoreChannels(skill).observedPerformance`（skill-model，coldStartScore 同源）。
2. 事件基建已就绪：`recordProductEvent` / capability events（224/225 已多处使用）；`product-events.ts` 路由 + 本地落库。
3. 章节完成时点：chapter-completion.ts 路由与 workflowMeta.capabilityState（techniqueIds/overlayCardIds）已存在——"本章用了哪些卡"在写作侧已知。
4. 能力卡地图（SkillMapPanel）统计 observedSkills（observedPerformance 非 null）——消费端现成。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 后端定向 | `NODE_ENV=test node --test --import tsx tests/<新用例>` | 全绿 |
| 前端定向 | `npx vitest run --config vitest.config.frontend.ts src/tests/<新用例>` | 全绿 |
| 全量 | `npm run test:unit` | 全绿 |

## Scope

**In scope**：
- **采集点（唯一）**：章节完成/保存为已完成时，若本章 capabilityState 挂了技法卡，在完成 toast/面板内追加一次性轻量反馈条：「本章用到的 N 张卡帮你了吗？👍 / 😐 / 👎」——单击即提交，不弹窗、不阻断、可忽略（忽略即不再问本章）
- **落库**：product event（eventName `capability_feedback`，payload: cardId/novelId/chapterId/rating）；聚合端把同一卡的反馈权重写入 skill 的 observedPerformance 通道（👍=正、😐=不计、👎=负；阈值与衰减规则先简单：滑动计数即可）
- **消费**：computeCardFitness 使用反馈分从 observedPerformance 有样本时按现有公式自然激活；能力卡地图「有使用反馈」计数随之从 0 增长
- **防刷/防噪**：同一章同一卡只采一次；rating 不可改评（v1）

**Out of scope**：
- 文本评价、多维度评分、跨章聚合报表
- 基于反馈的自动淘汰/排序（那是数据攒够后的下一拍）
- Electron 端特殊处理

## Steps

### Step 1: 事件与聚合（后端）

capability_feedback 事件落库 + observedPerformance 聚合写入（skill-model 通道）。

**Verify**: 后端定向测试——提交反馈 → 事件存在 → observedPerformance 更新 → 同章重复提交幂等

### Step 2: 完成时点反馈条（前端）

章节完成路径挂轻量反馈条；忽略状态持久化（本章不再问）。

**Verify**: 组件测试——有挂卡时反馈条出现；提交后消失；无挂卡不出现

### Step 3: 消费激活 + 回归

computeCardFitness/能力卡地图接样本；全量回归。

**Verify**: 有样本卡在货架显示非零反馈分；全量绿；台账落账

## Done criteria

- [ ] 写完一章用了卡的用户，有一次性、零阻断的反馈入口
- [ ] 反馈数据流入 observedPerformance，能力卡地图计数开始增长
- [ ] 台账落账

## STOP conditions

- 章节完成时点的 UI 挂载点不存在或语义冲突（完成态与 workflow 状态机冲突）→ 停止，改设计为「下次进入编辑器时的回访条」再评审
- observedPerformance 聚合与现有 score channels 语义冲突 → 停止，先出 skill-model 扩展方案
