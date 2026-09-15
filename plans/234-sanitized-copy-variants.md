# Plan 234: 消毒副本文案变体（第二诊·病根 C，P1）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 9df11b9..HEAD -- scripts/generate-public-catalog.ts src/lib/skills-studio-governance.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。**必须等 233 合入后开工**（同文件生成器）。

## Status

- **Priority**: P1（约 20 张消毒副本共享 2 句通用文案，货架选项区分度的主要损耗源）
- **Effort**: S-M
- **Risk**: LOW（构建期改写 + 守护测试；运行时替换保留为兜底）
- **Depends on**: 233（同动 `scripts/generate-public-catalog.ts`，串行）
- **Category**: fix（能力商店第二诊 · 供给质量）
- **Planned at**: commit `9df11b9`, 2026-09-16（来源：第二诊 · 消毒管线溯源）

## Why this matters

真页面约 20 张消毒副本卡的功能定位是同一句「广场共享能力，具体效果以实际运行结果为准。」、预期成效是同一句「✨ 长篇节奏感和对白质量有大幅上升。」。溯源：这些副本的源 goal 含商业词，渲染时被 `getCapabilityDisplayText` 一键替换成 3 句固定文案（built-in/licensed/plaza 各一句）——45 张副本里含有商业词的那批全部塌缩成同一句。消毒（隐藏商业承诺）是对的，但塌缩成一一句把货架的选项区分度打掉了：用户看到的是 20 张一模一样的卡，而不是 20 张不同的卡。

## Current state（2026-09-16 亲读核实，锚点基于 `9df11b9`）

1. `src/lib/skills-studio-governance.ts:223-234` `getCapabilityDisplayText`：goal 命中 `/(购买|会员|付费|无限调用|订阅|充值)/` 即整句替换——licensed → 「授权增强能力，具体效果以实际运行结果为准。」；plaza → 「广场共享能力，…」；built-in → 「官方内置能力，…」。
2. `scripts/generate-public-catalog.ts:107-133` `buildSanitizedCopy`：`goal/successSignal` 经 `sanitizeCopyText`（= cleanText，只清空白）**原样保留**商业词 → 运行时替换必触发。
3. 生成产物 grep 证据：`public-skill-catalog.ts` 中 `"goal": "广场共享能力` 计数为 0（通用文案不在文件里，是运行时替换）；`successSignal: "长篇节奏感和对白质量有大幅上升。"` 出现 6+ 次（消毒管线写入的同构信号）。
4. 真页面取证（2026-09-16）：文风与正文货架约 20 张已消毒副本共享上述两句文案。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 重新生成 | `node --import tsx scripts/generate-public-catalog.ts` | 变体改写计数输出 |
| freshness | `NODE_ENV=test node --test --import tsx tests/public-catalog-freshness.test.ts tests/catalog-copy-uniqueness.test.ts` | 全绿 |
| 定向 | `npx vitest run --config vitest.config.frontend.ts src/tests/capability-craft.test.ts` | 全绿 |

## Scope

**In scope**：
- `buildSanitizedCopy` 增**构建期文案改写**：goal/successSignal 命中商业词正则（与 getCapabilityDisplayText 同一正则，抽为 shared 常量单源）时，改写为按资产类别（primaryCategory 或 station 分桶）轮换的**变体池文案**（每桶 ≥3 条 goal 变体 × ≥3 条 signal 变体，池子总量 ≥15 条组合，写明「消毒副本」语境），改写计数输出
- 改写后 goal 不再含商业词 → 运行时 `getCapabilityDisplayText` 替换自然不触发（保留该函数作兜底，不改）
- 守护测试：重生成后 SANITIZED_SKILL_COPIES 中同一句 goal 的出现次数 ≤ 6；消毒副本 goal 无商业词
- 卡面不新增「原文案已替换」声明（证据分 + 签字徽标已承载诚实语义，避免文案再膨胀）

**Out of scope**：
- 消毒管线本身（prompt-sanitizer 黑名单语义，232 已裁定不动）
- 非 sanitize 副本资产（licensed/built-in 卡无此问题）

## Steps

### Step 1: 正则单源化 + 变体池

商业词正则从 skills-studio-governance.ts 抽到 shared（generator 与运行时共用）；变体池常量写入生成器（按 primaryCategory 分桶，桶外兜底通用桶）。

**Verify**: typecheck 0；生成器 dry-run 输出改写计数

### Step 2: buildSanitizedCopy 接入 + 重生成

**Verify**: 生成产物中消毒副本 goal 无商业词；同句 goal ≤ 6 次；freshness 全绿

### Step 3: 守护测试 + 真页面复核 + 台账

**Verify**: catalog-copy-uniqueness 新断言绿；dev 页面已消毒卡文案分化；台账落账

## Done criteria

- [ ] 真页面已消毒卡不再是「同一句话墙」，同句文案 ≤ 6 张
- [ ] 运行时替换不再对消毒副本触发（构建期已改写）
- [ ] 台账落账

## STOP conditions

- 变体改写后 freshness 或既有治理测试出现**语义性失败**（不是断言数字重锚）→ 停止报告，消毒副本的 goal 可能有下游消费方依赖原文案
- 发现消毒副本 goal 被执行链路（非展示）消费 → 停止，改写会改变运行行为，需重新评估改写层级
