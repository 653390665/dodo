# Plan 231: 占位文案治理——47 张广场卡真实定位补写或退稿（A2/P1，依赖 225）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat b3a5bcc..HEAD -- shared/lib/prompt-governance-catalog.ts shared/lib/public-skill-catalog.ts scripts/generate-public-catalog.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P1（货架同质化的最大单点：47 张卡共用同一句功能定位，用户无从区分）
- **Effort**: M（含内容批处理，可 LLM 辅助 + 人工校对）
- **Risk**: LOW（纯目录文案数据；不动执行语义）
- **Depends on**: 225（分区后社区配方区是治理对象；四问分类器的「可验证性」裁决）
- **Category**: content-governance（能力商店诊断 · 供给治理）
- **Planned at**: commit `b3a5bcc`, 2026-09-15（来源：四轮思考 · 全面诊断 A2 + 供给边界「无签字不下架」）

## Why this matters

`发挥广场精品提示词` 这句占位文案在目录中出现 **47 次**——47 张卡的功能定位、预期成效高度雷同（「长篇节奏感和对白质量有大幅上升」批量出现），冷启动证据清一色 63 分。用户视角：33 张同类卡里挑不出差别，信任崩塌。四问分类器裁决：这些卡目前「效果不可验证 → 不该以完整卡面上架」，治理出路只有两条——补出真实定位，或退稿下架。

## Current state（2026-09-15 亲读核实，锚点基于 `b3a5bcc`）

1. `shared/lib/public-skill-catalog.ts` — `发挥广场精品提示词` ×47；`successSignal`「长篇节奏感和对白质量有大幅上升。」同句批量复用；对应卡 score 集中 63。
2. 占位卡实例：正文提示词 / 克苏鲁标题 / 克苏鲁配角信息卡 / 克苏鲁主角及主角团核心成员信息卡 / 克苏鲁正文 / 宝可梦配角信息卡 / 宝可梦正文 / 宝可梦系统信息卡 / 宝可梦信息卡 / 宝可梦主角信息卡 等（系列集群）。
3. 文案生成链路：占位文案写在源注册表（`prompt-governance-catalog.ts` 的 goal/successSignal）或生成器缺省回退——需亲核确认来源后改对应层；`sanitizeWhiteLabelText` 与生成脚本不涉及该文案。
4. 每卡都有真实 `template` 正文可提取要点（克苏鲁正文模板实证：四条编号规则清晰可总结）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 生成目录 | `node --import tsx scripts/generate-public-catalog.ts` + freshness 测试 | 3/3 |
| 唯一性守护 | 新增目录文案测试 | 全绿 |
| 全量 | `npm run test:unit` | 全绿 |

## Scope

**In scope**：
- 治理脚本：扫描全部卡，列出「功能定位为占位/重复」清单（机器判定：goal 与占位串相同或跨卡重复）
- 批处理补写：从每张卡 `template` 提炼一句话真实定位（LLM 辅助生成 + 逐条人工校对入库源注册表；文案约束：≤40 字、说明这张卡对正文做什么、不得承诺量化效果）
- 不可补写者退稿：`sourceGroup` 标记隔离（对齐既有 `test-fixture` 排除机制，投影层过滤），台账记退稿清单与理由
- 唯一性守护测试：全目录 `goal` 不得出现跨卡重复（占位串专项断言）

**Out of scope**：
- 227 的签名数据（本计划只动 goal/successSignal 文案）
- 卡的增删（退稿=隔离不删除，保留数据可回滚）
- 消毒管线（白标问题另线）

## Steps

### Step 1: 治理清单与守护测试（先红后绿）

脚本产出占位/重复清单（预期 ~47 张）；先写唯一性守护测试（当前应红），确认清单数与断言一致。

**Verify**: 守护测试红且清单数 = 实际占位/重复卡数

### Step 2: 批量补写与退稿

逐卡补写（LLM 辅助提炼 + 人工校对，按系列批量处理：克苏鲁 5、宝可梦 5 等）；无法给出真实定位的卡走隔离退稿。重新生成目录。

**Verify**: 守护测试转绿；freshness 3/3；被退稿卡不再出现在任何货架投影

### Step 3: 回归与台账

双全量回归；台账记录：补写 N 张、退稿 M 张（含清单）、226 症候映射如引用了被退稿卡需同步修正。

**Verify**: `npm run test:unit` 全绿；台账落账

## Done criteria

- [ ] 全目录功能定位零占位、跨卡零重复（守护测试钉死）
- [ ] 退稿卡隔离可追溯（台账清单）
- [ ] 台账落账

## STOP conditions

- 补写过程中发现占位卡的真实 template 大面积无法支撑任何有意义的定位（如模板本身空洞）→ 停止，报告「空卡」占比，升级为供给质量专项再评估。
