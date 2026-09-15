# Plan 233: 目录准入规则 + 源头文案修复（第二诊·病根 B，P0）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 9df11b9..HEAD -- shared/lib/prompt-governance-catalog.ts scripts/generate-public-catalog.ts tests/catalog-copy-uniqueness.test.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P0（垃圾标题卡直接上架 + 中英混排文案，损伤目录供给的可信度）
- **Effort**: S
- **Risk**: LOW（生成器侧过滤 + 文案改写，可全量重新生成并测试守护）
- **Depends on**: 无（与 234 同动 generate-public-catalog，**执行顺序 233 先、234 后**，避免同文件并行）
- **Category**: fix（能力商店第二诊 · 供给质量）
- **Planned at**: commit `9df11b9`, 2026-09-16（来源：第二诊 · 真页面取证 + 源码溯源）

## Why this matters

真页面货架出现「测试审稿」「测试」「番茄正文过保底2」「番茄正文过保底」「私密内测」等卡片——plaza 源提交的垃圾标题直接入册上架（消毒管线只剥联系方式，不拦垃圾标题，`collectSanitizeCandidates` 的 `sourceGroup !== 'test-fixture'` 过滤拦不住真实提交里的测试卡）。另有 16 张题材大类卡的功能定位硬编码中英混排「…题材背景支撑 and fallback profile。」。这两类问题都在源头（prompt-governance-catalog + 生成器），不在展示层——展示层修不完源头持续产出。

## Current state（2026-09-16 亲读核实，锚点基于 `9df11b9`）

1. `shared/lib/prompt-governance-catalog.ts:2479`：题材大类（creative-*）资产的 goal 模板为
   `` goal: `题材风格包提供 ${c.title} 相关的题材背景支撑 and fallback profile。` ``
   —— 中英混排，且 16 张卡除题材名外完全同构。
2. `scripts/generate-public-catalog.ts:88-107` `collectSanitizeCandidates`：合并 GOVERNED_ASSETS_V2_REGISTRY + PROMPT_GOVERNANCE_CATALOG，过滤 `placementTier==='sanitize-required' && sanitizationStatus==='needs-sanitization' && runtimeStatus==='candidate' && sourceGroup!=='test-fixture'`；**无标题质量准入**。
3. `scripts/generate-public-catalog.ts:97-99`：`sanitizeCopyText = cleanText`（只清洗空白），标题原样透传。
4. 真页面取证（2026-09-16）：「测试」「测试审稿」「番茄正文过保底」「番茄正文过保底2」「私密内测」「新版过朱雀」等卡在文风与正文货架展示（已消毒徽标）。
5. 守护测试：`tests/catalog-copy-uniqueness.test.ts`（231 交付：squareGoals 零占位 + 跨卡唯一）、`tests/public-catalog-freshness.test.ts`（3/3）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 重新生成 | `node --import tsx scripts/generate-public-catalog.ts` | 输出排除清单计数 |
| freshness | `NODE_ENV=test node --test --import tsx tests/public-catalog-freshness.test.ts tests/catalog-copy-uniqueness.test.ts` | 全绿 |
| 前端定向 | `npx vitest run --config vitest.config.frontend.ts src/tests/capability-craft.test.ts` | 全绿 |

## Scope

**In scope**：
- creative-* goal 模板改纯中文：`题材风格包提供${c.title}题材的背景支撑与配置基线。`（16 张同构保留——题材大类本就是参数化模板族，231 已裁决模板族非占位缺陷）
- 生成器准入规则（`collectSanitizeCandidates` 内）：标题消毒后命中以下任一则排除——① 精确/边界匹配 `测试|内测|test`（不误伤含"测试"但语义完整的正规标题时用边界判定，规则与误伤样例写入注释）；② 消毒后标题长度 < 2；③ 标准化标题（去空白/全半角归一）重复的组只保留冷启动分最高的一张（治「番茄正文过保底」vs「…2」）
- 排除动作**计数留痕**：生成器输出 `Excluded N junk-title candidates: [id…]`，不静默删除
- 守护测试扩展：catalog-copy-uniqueness 增「goal 无 ASCII 英文混排（` and ` / ` fallback ` 等模式）」+「无垃圾标题」断言

**Out of scope**：
- 消毒副本文案变体（234）
- 上架卡的内容质量评分（无机制支撑，不做）
- 已导入用户本地库的历史垃圾卡清理（本地数据，另行决策）

## Steps

### Step 1: 文案模板修复

改 prompt-governance-catalog.ts:2479 一行 + 重生成。

**Verify**: grep 生成产物无 `fallback profile`；freshness 3/3

### Step 2: 准入规则 + 排除留痕

collectSanitizeCandidates 增过滤与计数输出；重生成，核对排除清单与真页面残留。

**Verify**: 重生成后 PUBLIC 目录无「测试」「番茄正文过保底2」等排除目标；排除计数输出合理

### Step 3: 守护测试 + 回归

**Verify**: catalog-copy-uniqueness 新断言绿；前端定向 + typecheck 0；台账落账

## Done criteria

- [ ] 真页面货架无垃圾标题卡、无中英混排定位语
- [ ] 排除动作可审计（生成器输出清单）
- [ ] 守护测试防回归；台账落账

## STOP conditions

- 准入规则排除的候选 > sanitize 候选总数的 15% → 停止报告清单（供给体量是资产，宁可人工过一遍）
- 边界匹配无法做到不误伤语义完整标题 → 降级为精确匹配 + 留痕，不得扩大匹配
