# Plan 258: 散卡层治理修复——占位空壳评分惩罚 + featured 档位复核

> **Executor instructions**: Follow step by step, run every verification, honor STOP
> conditions, do not improvise. SKIP plans/README.md updates (reviewer maintains it).
> Commit per step (`fix(catalog): plan258 <中文一句话>`), do not push. Audit every
> claim in your report against actual tool results. Reply with the report format at
> the end.

## Status

- **Priority**: P2 · **Effort**: M · **Risk**: MED（改评分函数 → 目录再生成级联）
- **Category**: governance/quality
- **Depends on**: plans/257 必须先合并（同动 `shared/lib/public-skill-catalog.ts`，串行）
- **Planned at**: 2026-09-20（基准 = 257 合并后的主干 HEAD，开工前先记录）

## Why this matters

三路审查实证散卡层两个治理漏洞：①**评分与内容脱钩**——46 张占位空壳卡（模板体只有
「广场优秀提示词模版体」占位句）拿到 76-88 高分，而真实内容卡只有 76 分，"88 分的卡
没有正文"直接误导用户挑选；②**featured 档位失守**——`sanitized-raw-comp-brand-detector`
（45 分，正文仅"如有问题联系 。推荐使用。"的残缺句）竟挂 featured 档。本计划让评分
如实反映内容实体，让 featured 只授予有真实正文的卡。

## Current state（审查实证锚点，开工时先复核）

- 生成器：`scripts/generate-public-catalog.ts`——评分计算与 curationTier 赋值逻辑
  在此（executor 先通读，找到 score 与 tier 的赋值点）。
- 占位体特征（Agent B 实证）：模板体含「广场优秀提示词模版体」标记句，形如
  `围绕 X 执行，对标网文审美要求`，无实质方法论；涉及 square-\*、creative-1~16、
  tomato-\* 等约 46 张。
- 残缺空壳例证：`sanitized-raw-comp-brand-detector`（45 分，featured，正文残缺）。
- 级联面：`tests/public-catalog-freshness.test.ts`（镜像对比）、
  `tests/catalog-copy-uniqueness.test.ts`、货架排序与原料库分组数字、
  `src/tests/style-shelf-decks.test.tsx` 等会随再生成变化，需按惯例重锚。
- 仓库约定：中文注释、prettier 单引号、eslint `--max-warnings=0`。

## Commands

| Purpose | Command | Expected |
|---|---|---|
| 目录再生成 | `node --import tsx scripts/generate-public-catalog.ts`（以脚本实际用法为准） | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| 测试 | `npm test` / `npm run test:frontend`（定向先行） | all pass |
| Lint | `npx eslint <改动文件> --max-warnings=0` | exit 0 |

## Scope

**In scope**:
- `scripts/generate-public-catalog.ts`（评分惩罚规则 + featured 授予守卫）
- `shared/lib/public-skill-catalog.ts`（再生成产物）
- `tests/`、`src/tests/` 重锚与新增（评分规则单测）

**Out of scope**（do NOT touch）:
- 下架/删除任何卡（只改分与档，卡片数量守恒）
- licensed/private-\* 付费版块内容的分数与档位（**付费版块不在本计划治理范围**）
- 白标精选 18 张（含 257 刚转内置的 4 张）
- 消毒词表与 PRIVATE_CURATED_TEMPLATES

## Steps

### Step 1: 调查并落占位惩罚规则
通读生成器，找到 score 与 curationTier 赋值点。新增规则（常量+注释说明依据）：
- 模板体命中占位标记「广场优秀提示词模版体」或有效正文长度低于阈值（建议 120 字，
  以最短真实内容卡为参照校准）→ 该卡 score 封顶 60，且**不得授予 featured**
  （已是 featured 的降为 standard）。
- 规则写成可单测的纯函数。
**Verify**: 定向单测（新增）全绿；`npm run typecheck`。

### Step 2: featured 守卫
featured 授予处加守卫：score < 70 或命中占位规则 → 拒绝 featured。复核后
`sanitized-raw-comp-brand-detector` 应回落 standard 以下。
**Verify**: 生成器单测全绿。

### Step 3: 再生成 + 级联重锚
运行生成脚本；预期变化：约 46 张占位卡降分、若干 featured 降档；**卡数量不变、
licensed/private-\* 付费卡不变、白标 18 张不变**。typecheck + 两套全量，
红的按重锚惯例处理（断言数字/排序更新，语义不变）。
**Verify**: 两套全量全绿。连续 5 处无法语义不变重锚 → STOP。

### Step 4: 幂等与守恒验证
再跑一遍生成脚本 diff 应为空（幂等）；核对：总数 127 不变；licensed 与白标层
零变化（`git diff` 中不得出现 built-in/licensed 行变更）；占位卡降分清单打印留档。

## Test plan

- 新增生成器纯函数单测：占位体命中降分、真实内容不受影响、featured 守卫拒绝。
- 重锚：freshness（重新生成即绿）、uniqueness、货架/原料库相关数字断言。

## Done criteria

- [ ] typecheck 0；两套全量全绿
- [ ] 占位卡不再有 ≥70 分；featured 中无占位/残缺卡
- [ ] 卡总数、licensed 层、白标层零变化（diff 可证）
- [ ] 再生成幂等（二遍 diff 为空）
- [ ] 改动文件在 In scope 内

## STOP conditions

- 评分赋值点结构与预期不符（如分数来自配置文件而非生成器内逻辑）。
- 重锚连续 5 处失败。
- 再生成 diff 触及付费版块或白标层（越界，立即回滚报备）。

## 汇报格式

STATUS: COMPLETE | STOPPED
STEPS / STOPPED BECAUSE / FILES CHANGED / NOTES