# Plan 239: 社区配方分层呈现——原料库默认折叠（第三轮审查，P2）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 95111f4..HEAD -- src/components/SkillsStudioView.tsx src/components/skills/StyleShelf.tsx`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P2（三档供给的呈现层收尾：官方/套牌/症候动线已立，唯社区散卡仍与正货等权重平铺）
- **Effort**: M
- **Risk**: MED（货架主渲染面改动，plan158 系断言密布；必须 additive + 重锚留痕）
- **Depends on**: 无（232 白名单套牌已收敛套牌区；237 若同期执行注意两者都动 StyleShelf，**建议 237 先、239 后**）
- **Category**: feature（供给分层 · 呈现）
- **Planned at**: commit `6451c43`, 2026-09-16（来源：第三轮深度审查 · 第一/二轮评估共同结论）

## Why this matters

供给边界裁决（第二轮评估）定了三档：内置默认、处方挑选、原料库。225 的官方规范/社区配方分区与 232 的套牌收敛解决了"哪张卡是谁的"，但呈现层仍把 114 张社区散卡与官方卡等密度平铺——第三档（无保修、无成套、无验证的原料）占据第一屏主要面积，正货（官方规范、真套牌、症候命中）被稀释。落法：社区配方区非套牌的散卡归入「原料库」默认折叠，套牌区与官方区保持展开。

## Current state（2026-09-16 亲读核实，锚点基于 `6451c43`）

1. `src/components/SkillsStudioView.tsx:2745-2798`（约）：optional-style 双区渲染——`region.note` 官方规范/社区配方两区，官方区 1-4 张，社区区 114 张；社区区内含套牌区（239 后仍保持展开）。
2. `src/components/skills/StyleShelf.tsx`：套牌区（232 白名单后仅克苏鲁/宝可梦）默认折叠为 `<details>`；功能分组（正文润色/题材模板/大纲与设定/故事生成/拆书仿写）全部展开渲染。
3. 症候导航（226）：「这章要解决什么」chips 切 optional-style 并 filterBySymptom——过滤后的结果集用户是带着意图来的，不应被折叠。
4. plan158 断言：作者向标签用例直接断言货架分组与卡面文本（密集）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 定向 | `npx vitest run --config vitest.config.frontend.ts src/tests/style-shelf-decks.test.tsx src/tests/skills-studio-plan158.test.tsx src/tests/cold-start-guidance.test.tsx` | 全绿 |
| 全量 | `npm run test:frontend` | 全绿 |

## Scope

**In scope**：
- StyleShelf 功能分组渲染拆两态：**症候/搜索过滤激活时**（filterBySymptom 命中或用户显式筛选）全部展开；**默认浏览态**下社区配方的功能组归入「原料库（N 张）」单个默认折叠 `<details>`（组内保留分组小标题），官方区与套牌区不受影响
- 原料库折叠头显示组内计数与一句定位说明（"社区散卡：无保修不成套，搜索或按症候筛选使用"）
- 判定口径：组内全部卡 `getCraftSignature(asset).seriesId === null` 且 supplyPartition 为社区 → 该组入原料库；官方区/套牌区/症候命中不折叠
- plan158 系断言受影响处逐条重锚并注明

**Out of scope**：
- 搜索/筛选功能本体（226 症候已覆盖）
- 官方区/套牌区的排序与内容
- 任何数据层改动（纯呈现）

## Steps

### Step 1: 分层渲染

StyleShelf 增加浏览态/过滤态判定与原料库折叠容器；SkillsStudioView 把「过滤是否激活」传下（prop，默认浏览态）。

**Verify**: 新组件测试——浏览态下社区散卡组收进原料库（details 未展开也计数可见）、套牌/官方不受影响；症候过滤态下全部展开

### Step 2: plan158 重锚 + 回归

**Verify**: 重锚处注明；全量绿；typecheck 0

### Step 3: 真页面复核 + 台账

**Verify**: 真页面第一屏只见官方+套牌+原料库折叠头；台账落账

## Done criteria

- [ ] 默认浏览态第一屏由正货（官方/套牌）主导，原料库一键展开
- [ ] 症候/过滤动线不受影响
- [ ] 台账落账

## STOP conditions

- 折叠后社区区仍 >90 张进原料库（第一屏改善有限但翻转成本高）→ 不停止，但报告中必须给出折叠前后第一屏卡数对比
- plan158 系重锚 >10 处 → 停止，说明渲染契约演进冲突
