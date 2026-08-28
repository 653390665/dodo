# Plan 166: 去 AI 腔结构诊断与上下文重写闭环

## Status

- **State**: DONE (2026-08-23; Plan 168 completed the capability-tool consumer handoff)
- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/167-slop-unit-boundary-hotfix.md`, `plans/165-block-draft-context-leak-and-unreviewed-acceptance.md`, `plans/162-real-provider-evaluation-metrics.md`, `plans/161-literary-quality-contract.md`
- **Category**: bug / tests
- **Planned at**: working tree inspected 2026-08-23; source files contain uncommitted changes relative to `f4eac24`

> **Execution gate**: 依赖 Plan 161、162、165 必须先在 `plans/README.md` 标记为 `DONE`。执行代理还必须重新核对 Scope 内所有文件的当前符号；任何与下述摘录不一致的漂移都要先报告，不得直接套用本计划。

## Why this matters

作者反馈的“AI 味很重”并不只表现为“倒吸一口凉气”这类禁词。当前系统可以避开固定词表，却继续生成相同的句法骨架：人物观察、作者解释、抽象总结、悬念收束，段段重复。当前机械评分和确定性重写会让这类文本看起来通过门禁，能力卡也只是做字符串替换，不能恢复人物声音、场景压力和事件后果。

本计划把“去 AI 腔”改成可验证的两阶段闭环：先以段落/句法信号定位证据，再把局部片段连同人物、场景和前后文交给上下文重写，最后重新扫描事实、因果、重复结构和语义审阅状态。它不以绕过 AI 检测器为目标，不伪造错别字、俚语或随机句长，也不允许重写凭空新增剧情事实。

## Current state

### 1. 机械评分只覆盖词表和句长

- `shared/lib/slop-scorer.ts:25-106` 以固定正则检测 AI 套话、网文陈词、情绪标签、解释句和弱动作。
- `shared/lib/slop-scorer.ts:192-217` 只检查连续五句长度是否接近；没有段落首句、段落收尾、抽象解释密度、同一主语动作链或事件后果断裂检查。
- `shared/lib/draft-quality.ts:326-345` 将机械分数附加到完整章节报告，但结构性信号不足时仍可能得到高分；`shared/lib/draft-quality.ts:231-246` 的部分重复模式仍只是 P2。

可复现证据（不写数据库）：

```bash
node --import tsx --input-type=module -e "import { scoreSlop } from './shared/lib/slop-scorer.ts'; const text=Array.from({length:70},(_,i)=>'林舟看向门口，确认脚步声没有停。第'+(i+1)+'次判断让局面出现新的方向。').join('\\n\\n'); const r=scoreSlop(text); console.log(r.score, r.hits.length);"
```

当前输出会命中句长单一，但不会给出“段落结构同构、抽象总结密度过高”的具体证据；这正是用户看到“词不违规但不像小说”的来源。

### 2. 确定性重写是字符串替换

- `shared/lib/slop-rewriter.ts:6-35` 删除“非常/十分/深吸一口气”等词，并把“试图去/做”替为“准备”。
- `shared/lib/slop-rewriter.ts:23-35` 明确不新增动作，这能保护事实，却意味着抽象动作、对白前因和人物语气不会被真正重写。
- `server/routes/utilities.ts:45-59,113-119` 对精修能力卡直接调用 `buildCapabilityPolishPreview`，能力来源只写入哈希收据；剩余结构问题没有交给上下文感知精修，也没有返回“仍需深度精修”的明确状态。

可复现证据：

```bash
node --import tsx --input-type=module -e "import { buildSlopRewritePreview } from './shared/lib/slop-rewriter.ts'; const text='他抬头看向门外，确认局面正在发生变化，因此决定继续等待。'; console.log(buildSlopRewritePreview(text)===text);"
```

该类抽象总结会原样返回；单纯禁词替换不能解决句法模板。

### 3. 写作提示词有负向禁词，缺少可验收的正向场景合同

- `shared/config/prompt-templates.ts:226-292` 已要求按场景推进、避免“主角”和通用收尾，但没有把每段的“铺垫—过程—余波”和角色的“目标—阻碍—选择—代价—后果”变成结构化输出约束。
- `server/helpers/prompt-guard.ts:9-36` 以大段全局禁词和“Show, Don't Tell”要求驱动模型，`server/helpers/prompt-guard.ts:80-95` 的输出门只把四类词汇命中视为违规，忽略 `sentence_monotony`、`action_chain` 和 `hook_ending`。
- `server/routes/audit.ts:134-167` 将能力卡压缩到 900 字、技法正文预算约 600 字；较长的去 AI 卡可能只剩标题和截断片段，注入成功不代表规则完整生效。

最新真实 Provider 探针还发现一个高置信误报：`shared/lib/slop-scorer.ts:74-76` 的 `/十分/` 规则把自然时间短语“十分钟”判为“十分...”，随后 `server/lib/server-llm.ts` 以 `quality_rejected` 拒绝整次响应。所有副词规则必须按词边界/上下文处理，不能破坏数字、时间、比例和专名。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0，无新增 warning |
| Mechanical tests | `node --test --test-timeout=45000 --import tsx --import ./tests/helpers/test-db-preload.ts tests/chapter-polish.test.ts tests/draft-quality.test.ts` | 全部通过 |
| Frontend utility tests | `npm run test:frontend -- --run src/tests/quality-review-journey.test.tsx` | 全部通过 |
| Provider evaluator | `node --import tsx scripts/run-chapter-llm-acceptance.ts --deterministic` | 三个样本有明确终态，FALLBACK 不计为 LIVE 质量 |
| Diff hygiene | `git diff --check` | exit 0 |

所有命令必须使用测试配置和隔离数据库；不得读取或写入运行中的 `data.db`。

## Scope

### In scope（仅允许修改）

- `shared/lib/slop-scorer.ts`：新增可定位的段落/句法结构信号，保持既有词表命中和 `scoreSlop()` 返回兼容。
- `shared/lib/slop-rewriter.ts`：保留高置信、事实无损的机械清理；增加上下文重写所需的结构化诊断/提示构造，不在本模块凭空编造动作。
- `shared/config/prompt-templates.ts`：把场景状态变化、人物选择与代价、对白潜台词、铺垫/过程/余波写入 Writer/Critic 正向合同；保留现有变量名和 JSON 审稿合同。
- `server/helpers/prompt-guard.ts`：把硬阻断限定为内部元信息、乱码和高置信套话；把结构建议交给审稿合同，避免全局禁词挤压人物声口。
- `server/routes/audit.ts`：为去 AI 能力卡保留稳定的规则摘要和版本信息，避免 900 字截断后只剩标题；不得把完整用户正文写入日志。
- `server/routes/utilities.ts`：诊断响应补充结构信号；精修响应明确区分“机械预览”和“需要上下文精修”，并保留 `baselineHash/contextReceipt`。
- `tests/chapter-polish.test.ts`、`tests/draft-quality.test.ts`：补充结构性对抗样本、普通小说和短对白回归。
- `tests/fixtures/`：新增至少一份 4000 字以上、无固定禁词但段落结构同构的样本，以及一份人物声音和事件后果完整的对照样本。

### Out of scope（禁止修改）

- `server/helpers/fallback-draft.ts`、`server/helpers/ai-production-pipeline.ts`、`server/routes/production.ts`：由 Plan 165 负责保底质量门禁和流式泄漏；本计划只能在 Plan 165 完成后接入其公开质量接口。
- `scripts/run-chapter-llm-acceptance.ts`、`scripts/provider-quality-smoke.ts`：由 Plan 162 负责真实 Provider 状态和指标诚实性。
- 数据库 schema、embedding、Provider 解码参数、能力卡存储格式、前端候选接受协议。
- 新增依赖、随机错别字、随机俚语、同义词轮换、为填充 4000 字而重复生成段落。

## Steps

### Step 1: 定义结构信号和误报边界

在 `shared/lib/slop-scorer.ts` 增加纯函数扫描器，输出可定位的结构信号，不删除现有 `SlopHit` 字段。至少覆盖：

1. 相邻段落首句指纹重复（去除标点和常见代词后仍相同）；
2. 段末抽象收束重复（“局面/危险/细节/疑问/方向”一类作者总结连续出现）；
3. 同一主语 + 观察/确认/意识到/决定动作链重复；
4. 抽象解释句密度（存在“因此/从而/这让/这意味着”等连接词，且句中没有具体人物、物件、动作或对话）；
5. 每段没有状态变化、选择或后果的“气氛—解释—悬念”同构。

结构信号必须携带段落或句子范围、证据片段、建议，不能只返回一个总分。短片段（少于完整章节门槛）、自然对白重复、专名/术语重复和有意回环默认不阻断。未经人工样本校准的抽象密度只能标记 P2；只有高置信重复模板才能在完整章节上标记 P1。

同时为词级规则建立误报豁免：`十分钟`、`十分之一`、数字/单位组合、人物或物件专名不得因为包含“十分”而命中副词规则；“十分快”这类真正副词仍应可被识别。

**Verify**: `node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/chapter-polish.test.ts tests/draft-quality.test.ts` → 新增结构对抗样本命中证据；普通对话和现有成熟场景不新增 P1。

### Step 2: 统一完整章节的结构门禁输入

让 `server/routes/utilities.ts` 的诊断响应和现有完整章节质量报告复用同一个结构扫描结果；不再只把四类词汇命中传给输出门。保持旧客户端可读的 `issueCount/score/issues` 字段，同时增加可选的结构信号数组和 `qualityMode`。

在门禁中区分：

- **P0**：内部提示、问答、乱码、结构化标签；
- **P1**：高密度重复完整句、保底固定短语、完整章的同构段落；
- **P2**：单个抽象总结句、少量句式相似、可疑但未校准的节奏建议。

不得把所有 P2 全局升为 P1，也不得让 `scoreSlop` 单一分数替代语义审阅；候选是否可接受仍由 Plan 161/165 的质量合同决定。

**Verify**: 既有 `tests/draft-quality.test.ts`、`tests/chapter-polish.test.ts` 全部通过；对照样本的 `quality.ok` 与现有结果保持一致。

### Step 3: 将能力卡分为机械预览和上下文精修

保留 `buildSlopRewritePreview()` 作为事实无损的即时预览，并在返回类型/响应中明确它只完成词级清理。对结构信号生成局部上下文精修请求，必须携带：

- 原始片段、前后各一段上下文；
- 当前章节、场景目标、人物状态和可用伏笔账本；
- 具体问题证据及只允许修改的窗口；
- “不得新增事实/角色关系/设定、不得重写整章、保持原叙事视角”的硬约束。

复用现有 `buildRewritePrompt`/审稿精修链，不在 `slop-rewriter.ts` 里通过正则生成“退半步”“攥紧拳头”等新动作。模型失败时保留机械预览和原文，返回可重试的结构化错误；模型成功后必须重新执行机械扫描和受影响维度复审，未复审不能标记为已去 AI。

**Verify**: 在 `tests/chapter-polish.test.ts` 增加断言：机械预览不新增动作；上下文请求包含前后文、问题证据和事实保护约束；失败保留原文，成功候选仍需二次质量检查。

### Step 4: 收敛 Writer/Critic 的正向写作合同和能力卡摘要

在 `shared/config/prompt-templates.ts` 和 `server/helpers/prompt-guard.ts` 增加可审计的正向要求：每个场景至少一次目标/阻碍/选择/代价/后果；每个关键事件形成铺垫/过程/余波；环境描写必须改变行动或风险；对白由压力触发，不承担作者说明书；章末钩子必须改变局势判断。

将“禁词”降为高置信提示，不要求模型为了避开词语制造不自然同义词。输出前要求复查人物、时间线、设定、伏笔账本；禁止输出问答、分析、平台参数、写作意图和随机“人味”噪声。

在 `server/routes/audit.ts:134-167` 保留能力卡的去 AI 核心规则摘要和版本/来源标识。若完整卡超出预算，按规则块优先级裁剪，不能把每块都截成无意义半句；响应/日志不得包含原始正文或敏感配置。

**Verify**: `tests/prompt-guard.test.ts`、审稿路由合同测试和 `npm run typecheck` 全部通过；测试断言 Writer/Critic 输入包含正向合同，且长能力卡摘要不以半个规则句结束。

### Step 5: 建立真实 Provider 与人工盲评的质量闭环

在 Plan 162 的评测样本中加入本计划的结构对抗样本，分别记录机械证据、Provider 审稿结果、上下文精修结果和二次审阅结果。报告必须继续区分 `LIVE/FALLBACK/SKIP`，不能以 fallback 分数替代 Provider 质量。

至少由两名评审按同题材标准对以下维度打分：具体性、人物声音、场景因果、节奏变化、伏笔回响、元信息/乱码污染。将 distinct-1/2、重复 3/4-gram、段首/段末重复率、句长 CV 作为辅助指标，不把单一 MAUVE/AI 检测分数当验收真值。

**Verify**: `node --import tsx scripts/run-chapter-llm-acceptance.ts --deterministic` 报告可重算；有 Provider 凭证时单独运行 `--live-only`，失败必须是失败或 SKIP，不得变成通过。

### Step 6: 总体验收

按依赖顺序先确认 Plan 165，再运行本计划定向门禁；最后由主控复核 `git diff`，确认只修改 Scope 文件。

```bash
npm run typecheck
npm run lint
node --test --test-timeout=45000 --import tsx --import ./tests/helpers/test-db-preload.ts tests/chapter-polish.test.ts tests/draft-quality.test.ts
npm run test:frontend -- --run src/tests/quality-review-journey.test.tsx
node --import tsx scripts/run-chapter-llm-acceptance.ts --deterministic
git diff --check
```

## Done criteria

- [ ] 无固定禁词但段落/句法同构的完整章节能够返回结构证据，不能只显示“句长单一”。
- [ ] 普通多段中文小说、自然重复对白、专名重复不被新增 P1 误报。
- [ ] “十分钟”“十分之一”等数字/单位短语不会触发“十分”副词误报；真实副词仍可被检测。
- [ ] 机械预览不新增动作、事实或人物关系；结构问题必须进入上下文精修并在成功后重新审阅。
- [ ] Writer/Critic 的正向场景合同和能力卡规则摘要可在请求测试中验证；长卡不会被截断成半句有效规则。
- [ ] 输出门区分 P0/P1/P2；P2 不被伪装成通过，P0/P1 不被单一高分绕过。
- [ ] deterministic 评测不把 fallback 计为 LIVE；Provider 失败保留稳定失败状态。
- [ ] `npm run typecheck`、`npm run lint`、定向 Node/Vitest 测试和 `git diff --check` 通过。
- [ ] 不新增依赖，不修改数据库 schema，不访问生产 `data.db`。

## STOP conditions

- Plan 165 尚未完成，导致需要同时改动 `fallback-draft.ts`、`ai-production-pipeline.ts` 或 `production.ts`。
- 为降低分数必须引入随机错别字、同义词轮换、随机温度或改变人物事实，且没有同模型人工盲评证据。
- 结构信号只能靠大词表或单一 AI 检测器实现，无法提供段落/句子证据和误报测试。
- 需要新增 Provider、数据库字段、依赖或修改候选接受协议。
- 任何测试需要生产数据库，或 deterministic/fallback 结果被记录为真实 Provider 质量。

## Maintenance notes

- 新增结构规则必须同时新增“对抗样本 + 普通小说 + 短对白”三类测试；不能只添加一个禁词就宣称去 AI 完成。
- 结构阈值应按题材、模型和 tokenizer 的人工样本重新标定；更换 Provider 后先重跑 deterministic 基线，再跑 live-only。
- 能力卡的作用是提供可追踪的写作约束和诊断证据，不等于模型已经完成语义重写；UI 和报告必须保留这个区别。
- 审查重点是事实保护、局部修改范围、人物声口和复审结果，避免“洗掉 AI 味”后变成平淡、断因果或新增设定。
