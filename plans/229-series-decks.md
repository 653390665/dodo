# Plan 229: 系列套牌——系列实体化与同工位互斥（A1 部分/P1，依赖 227，可与 228 并行）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat b3a5bcc..HEAD -- src/lib/capability-shelf.ts src/components/SkillsStudioView.tsx src/components/skills/StyleShelf.tsx shared/lib/public-skill-catalog.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P1（系列卡的序性与互斥从未被系统表达，用户只能靠直觉）
- **Effort**: M
- **Risk**: LOW-MED（展示与选择约束，不改执行管线）
- **Depends on**: 227（craft.seriesId/seriesOrder/station）
- **Category**: feature（能力商店诊断 · 套牌）
- **Planned at**: commit `b3a5bcc`, 2026-09-15（来源：四轮思考 · 系列三律「套内有序、同工位互斥、跨工位自由」）

## Why this matters

克苏鲁（标题→配角信息卡→主角信息卡→正文）与宝可梦系列是「一剂完整的方子」：卡间共享题材契约，应当按序连用；而货架上它们是散卡——与异系列同工位卡（宝可梦正文 vs 克苏鲁正文）自由混选，混用产出必然题材错乱。用户对「哪些是一家子、该连着用」的直觉完全正确，系统却不懂。227 交付签名后，套牌实体化只剩渲染与选择约束。

## Current state（2026-09-15 亲读核实，锚点基于 `b3a5bcc`）

1. `src/lib/capability-shelf.ts:170-175` — `groupStyleShelf` 按标题前缀 `bySeries` 归组，`kind: 'series'`，StyleShelf 以 `<details>`「系列 …」折叠渲染——纯视觉，无顺序、无互斥。
2. 227 后：`craft.seriesId/seriesOrder/station` 可程序化读取（克苏鲁套牌 4 张、宝可梦套牌 5 张等）。
3. 应用语义现状：每卡独立「作品默认/本章使用」，无套牌级入口。
4. 先例：`SKILL_SERIES_FLOWS` 步骤的 `nextStepId`/`switchAllowed` 与能力包 `dependsOn`——套牌的顺序表达有现成范式可循。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 定向 | `npx vitest run --config vitest.config.frontend.ts src/tests/<套牌新用例>` | 全绿 |
| 前端全量 | `npm run test:frontend` | 全绿 |
| typecheck | `npm run typecheck` | 0 |

## Scope

**In scope**：
- 套牌视图：系列分组升级为套牌卡面（名称、卡数、序号 1→N、占据工位说明），展开看有序卡列
- 两个入口：**整剂启用**（按序全部加入本次配置）/ **从第 N 张继续**（已有部分配置时）
- 同工位互斥：配置中已含套牌 A 的某工位卡，再选套牌 B 同工位卡时阻断并说明（「已选克苏鲁正文（正文工位），与宝可梦正文互斥；如需更换请先移除」）；跨工位不受限
- 套牌内单卡仍可单独使用（尊重高级用户），但卡面提示「本卡属克苏鲁套牌，建议按序连用」

**Out of scope**：
- 套牌级定价/授权打包（E1 决策后另议）
- 跨套牌冲突的自动仲裁（只阻断 + 说明，不自动替换）
- 执行管线改动（套牌按序调用走既有配置应用，不建新执行时序）

## Steps

### Step 1: 套牌聚合与视图

基于 craft 签名聚合 `getSeriesDecks()`（id/名称/有序卡列/工位集合）；StyleShelf series 分组改读套牌实体；套牌展开视图含序号与工位标注。

**Verify**: 组件测试——套牌卡面/序号/展开渲染；克苏鲁、宝可梦套牌完整呈现

### Step 2: 整剂启用 + 互斥约束 + 回归

「整剂启用」按序批量加入配置草稿；选择时跑同工位冲突检测（纯函数 `detectStationConflict(draft, incoming)` + 单测），冲突阻断并文案说明。plan158 回归（系列分组断言若受影响，重锚注明）。

**Verify**: 冲突检测单测全绿；组件测试（阻断文案/整剂启用/继续入口）；前端全量绿；typecheck 0；台账落账

## Done criteria

- [ ] 系列以套牌呈现：有序、可见工位、可整剂启用
- [ ] 同工位跨套牌混选被阻断且有解释
- [ ] 台账落账

## STOP conditions

- 同工位判定与用户直觉冲突（如两张用户认为可共存的卡被互斥）→ 停止，报告工位判定规则，调整 station 语义后再上。
