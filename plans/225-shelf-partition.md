# Plan 225: 货架分区——官方规范 / 社区配方两层供给 + 签字语义标（A1/P0 供给边界）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat b3a5bcc..HEAD -- src/lib/capability-governance.ts src/components/SkillsStudioView.tsx src/components/skills/StyleShelf.tsx src/components/skills/PlazaAssetCard.tsx`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P0（供给边界落地：内置与开放的边界从未被表达，货架视觉权重倒挂）
- **Effort**: M
- **Risk**: LOW-MED（纯展示层分区，不改任何应用/管线行为）
- **Depends on**: none（226/230/231 的前置）
- **Category**: feature（能力商店诊断 · 供给边界）
- **Planned at**: commit `b3a5bcc`, 2026-09-15（来源：四轮思考 · 供给边界轮「动词内置、名词开放、签字定责」）

## Why this matters

货架上官方内置（20 张）与广场/授权（175 张）以完全相同的卡面呈现，用户无从知道「哪些是产品保修的、哪些是社区自担的」。供给边界的产品语义——内置 = 产品签字（随版本升级、效果保修），社区 = 自带（已消毒、效果自验）——从未被渲染。数据层的户口本（`sourceType`、`placementTier`）现成，缺的只是表达。

## Current state（2026-09-15 亲读核实，锚点基于 `b3a5bcc`）

1. `shared/lib/public-skill-catalog.ts` — `sourceType` 分布：`built-in` ×20、`licensed` ×41、`plaza` ×134。
2. `src/lib/capability-governance.ts` — `placementTier`：`core-default`（12 条护栏自动生效）/ `optional-style` / `sanitize-required`，是现成分区键的候选；消毒副本另有 `sanitized-*` id 前缀与 `riskNotes`（「生成侧消毒副本：白标清洗完成…」）。
3. `src/components/skills/PlazaAssetCard.tsx:110` 附近 — 卡面已渲染来源行（「冷启动证据 74 · 广场共享」），但来源仅是装饰字段，不构成分区。
4. 货架渲染：`SkillsStudioView` 文风与正文页签 → `StyleShelf`（functional + series 两组分组，`capability-shelf.ts:groupStyleShelf`）。
5. 226（症候入口）与 230（保底配置）都假定「官方规范区」存在——本计划是它们的前置。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| plan158 | `npx vitest run --config vitest.config.frontend.ts src/tests/skills-studio-plan158.test.tsx src/tests/plan158-skills-studio-candidates.test.tsx` | 全绿 |
| 前端全量 | `npm run test:frontend` | 全绿 |
| typecheck | `npm run typecheck` | 0 |

## Scope

**In scope**：
- 能力商店页签内先分区再列卡：**官方规范**（built-in；含 core-default 护栏说明与官方流程引用）与**社区配方**（plaza + licensed，含消毒副本标记）
- 卡面签字语义标：内置卡「随版本升级 · 效果由 InkFlow 保修」；社区卡「社区供给 · 已消毒 · 效果自验」（消毒副本标「已消毒可用」）
- 分区计数（官方 N / 社区 M）替代单一页签计数

**Out of scope**：
- 卡的下架/退稿（231）
- 症候入口（226）、保底配置（230）
- 应用链路、管线行为

## Steps

### Step 1: 分区数据与组件

在 `capability-governance.ts` 增加纯投影 `partitionShelfBySupply(assets): { official, community }`（键：`sourceType === 'built-in'`；消毒副本归社区并打 `sanitizedCopy: true` 标）。StyleShelf/页签内容区按两区渲染，区内保留既有 functional/series 分组。

**Verify**: 组件测试——两区渲染、计数正确、副本落社区区带「已消毒可用」标

### Step 2: 签字语义标与回归

卡面加语义标（built-in → 保修文案；community → 自验文案）；既有来源行保留。跑 plan158 两套件（004 断言涉及货架分组，若断言定位器受分区影响需同步重锚并注明）。

**Verify**: plan158 绿（或重锚后绿并注明）；前端全量；typecheck 0；台账落账

## Done criteria

- [ ] 货架先分区后列卡，内置/社区边界可见
- [ ] 每张卡可读出「谁为效果签字」
- [ ] 台账落账

## STOP conditions

- 分区后发现 built-in 判定与用户直觉严重冲突（如高分别的分区内大量占位卡）→ 停止，先走 231 文案治理再分区。
