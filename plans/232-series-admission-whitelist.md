# Plan 232: 套牌准入白名单 + 品牌双政策统一（第二诊·病根 A，P0）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 9df11b9..HEAD -- src/lib/capability-craft.ts src/lib/capability-shelf.ts src/components/skills/StyleShelf.tsx shared/lib/prompt-sanitizer.ts src/lib/capability-governance.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P0（一次修掉四个用户可见症状：空标题卡、套牌名括号破损、套牌名与卡名对不上、假套牌冒充方子）
- **Effort**: S-M
- **Risk**: MED（动套牌判定核心 + 与白标消毒器协同；有 930 例前端回归兜底）
- **Depends on**: 无（建立在 227/229 已交付的 craft 签名上）
- **Category**: fix（能力商店第二诊 · 供给质量）
- **Planned at**: commit `9df11b9`, 2026-09-16（来源：第二诊 · pm-router×八刀法全页签取证 + 管线溯源）

## Why this matters

同一个品牌词在系统里有两套相反的政策：套牌分组层把它当系列身份展示（"套牌 【风华出品（25 张）"），白标消毒器把它当水印从卡面标题抹除（prompt-sanitizer 黑名单）。产出四种用户可见损伤——空标题卡（整名只有品牌词的卡消毒后无标题仍上架）、套牌名括号破损（`【风华出品` 无闭括号）、套牌头与套牌内卡名对不上、lwl（13 张）/【风华出品（25 张）等上传者前缀被自动冠以"按序连用"承诺（假方子稀释真套牌的信任）。

## Current state（2026-09-16 亲读核实，锚点基于 `9df11b9`）

1. `src/lib/capability-craft.ts` `extractSeriesId`：`【brand】→`【${branded[1]}`（**无闭括号**）；`[A-Za-z]+-`、`[一-龥]{2,6}-` 两条 dash 规则**对任意前缀自动成组**（lwl 即由此而来）；`BRAND_SERIES_PREFIXES = ['克苏鲁','宝可梦','锅盖','猫头鹰','一次一章']` 只补无连字符品牌。
2. `shared/lib/prompt-sanitizer.ts:136-139`：`【(?:风华出品|小飞鸡|天马|私有化|自用)】` 与 `(?:风华出品|小飞鸡出品|风华出品的|沐殇专用|乐乐乐专用|牧殇角色|fire定制)` 黑名单剥品牌 → 消毒后整名只有品牌词的卡标题为空。
3. 真页面取证（2026-09-16，localhost:3000 文风与正文货架）：套牌 【风华出品（25 张）/lwl（13 张）/克苏鲁（10 张）/宝可梦（9 张）/【小飞鸡（6 张）；克苏鲁/宝可梦展开后工序序正确；存在无标题卡（heading 只有「已消毒」徽标）；工位行裸漏 `misc:constellation-pack`。
4. `src/lib/capability-shelf.ts` `groupStyleShelf`（229 起）改读 `getCraftSignature(asset).seriesId`，`≥3` 张成组。
5. `src/components/skills/StyleShelf.tsx` `STATION_LABELS`：fallback `stationLabel()` 原样返回 `misc:*`。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 定向 | `npx vitest run --config vitest.config.frontend.ts src/tests/capability-craft.test.ts src/tests/style-shelf-decks.test.tsx` | 全绿 |
| 回归 | `npm run test:frontend` | 全绿（930+） |
| typecheck | `npm run typecheck` | 0 |

## Scope

**In scope**：
- `extractSeriesId` 改**白名单准入**：新增 `CONFIRMED_SERIES` 常量（id/匹配前缀/人类可读名），只有命中的前缀返回 seriesId；`【brand】` 返回值补全闭括号；非白名单前缀（含 lwl、风华出品、小飞鸡等上传者品牌）一律 null（散卡）
- 白名单初版 = 现有 BRAND_SERIES_PREFIXES 五项 + 执行时全库枚举核对（见 Step 1）；每项 seriesId 用人类可读名（如 `克苏鲁`），括号完整
- 消毒后标题为空的资产不入货架投影：`getOptionalStyleAssets`（capability-governance.ts:355）过滤 `sanitizeWhiteLabelText(title).trim() === ''`
- `STATION_LABELS` fallback：`misc:*` 显示为 `其他`（套牌工位行不再裸漏枚举）

**Out of scope**：
- 白名单品牌的消毒豁免（当前五个白名单品牌都不在消毒黑名单里，无实际冲突；黑名单里的小飞鸡/风华出品/天马不进白名单，维持剥除）
- 套牌排序、互斥语义（229 已交付，不动）
- plaza 源头的垃圾标题治理（233）

## Steps

### Step 1: 白名单核对与常量落地

全库枚举前缀 ≥3 的组（`node --import tsx` 跑 getOptionalStyleAssets + 按前缀分组打印），逐组判断"是否一剂按序连用的方子"；确认清单写入 `CONFIRMED_SERIES`（含 label）。克苏鲁/宝可梦为已验证锚点；锅盖/猫头鹰/一次一章/天马等按卡面语义逐个判断，判断依据写入常量注释。

**Verify**: 枚举输出留档（贴入 commit message 或 plans 备注）；真页面套牌区只剩白名单套牌

### Step 2: 代码改造 + 空标题过滤 + misc 标签

`extractSeriesId` 重写；`getOptionalStyleAssets` 空标题过滤；`stationLabel` fallback。

**Verify**: 定向测试全绿；新增用例——lwl/风华出品 不再成套、克苏鲁套牌名含闭括号、空标题资产被过滤、misc 工位显示「其他」

### Step 3: 回归 + 台账

**Verify**: plan158 系列分组断言若受影响重锚注明；`npm run test:frontend` 全绿；typecheck 0；台账落账

## Done criteria

- [ ] 真页面：套牌区只有确认方子；无空标题卡；无 `misc:*` 裸漏；套牌名括号完整
- [ ] 全量回归绿
- [ ] 台账落账

## STOP conditions

- 白名单核对发现 ≥2 个"判不准是否成套"的边界组 → 停止并列出清单等拍板，不猜测
- 空标题过滤导致货架减少 >10 张（供给体量骤降）→ 停止报告
