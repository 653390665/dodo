# 番茄与 Webnovel Writer 补充资料评估

日期：2026-07-03

## 资料来源

本次补充纳入两份本地资料：

- `番茄小说写作提示词合集(1).md`
- `webnovel-writer-master.zip`

处理原则：先评估产品形态和接入位置，不直接改运行时提示词。可确认授权和稳定性的内容再进入 `direct-use-test`；其余只做结构参考、流程参考或 Agent 强化。

## 核心结论

这批资料不应该被当成“新提示词货架”。它更像三类能力：

1. **番茄平台包**：钩子、爽点密度、开篇诊断、平台评分卡、短段落快节奏。
2. **长篇写作流程包**：雪花六步法、章节蓝图、章节摘要、角色状态、章节正文续写。
3. **Agent / 记忆系统强化**：写前上下文组装、拆书抽象、审稿 JSON schema、题材 profile、Data Agent 提交事实。

它对 InkFlow 的启发是：流程要从“阶段线性推进”升级为“项目级约束 + 当前任务 brief + 章节后 commit + 审稿回路”。这比单纯融合提示词更重要。

## 新资产分级

| 资产 | 主归属 | 次归属 | 评分 | 处理结论 | 优先接入 |
| --- | --- | --- | --- | --- | --- |
| 番茄评分卡 | 题材/平台格式包 | 主编审稿 Agent | 92 | fuse | `manualAudit`、`orchestrateCritic`、题材 profile |
| 章末钩子 13 式 + 章首 7 式 | 番茄平台包 | 章节规划工具 | 90 | fuse | `editorAgent`、`generateOutline`、章节末审稿 |
| 拆书 6 阶段 SOP | 拆书/诊断工具 | 开书策划 Agent | 90 | fuse | `extractSkill`、Opening Diagnostic Pack |
| 黄金三章诊断 | 通用主编 Agent | 番茄平台包 | 88 | fuse | 前三章/前十章诊断 |
| 雪花六步法 | 长篇流程包 | 结构规划工具 | 87 | extract-structure | `storyCards`、`generateOutline` |
| 章节正文写作 prompt | 正文流程节点 | 文风 Skill 参考 | 84 | style-reference | `orchestrateWriter` |
| 角色状态文档 | 记忆/上下文系统 | Data Agent | 86 | fuse | 章节后 commit、角色状态同步 |
| 去 AI 味指南 | 文风精修 Skill | `slop-scorer` 规则 | 88 | fuse | `buildRewritePrompt`、`slop-scorer` |
| 开头模板库 | 题材/格式包 | 灵感工具 | 78 | style-reference | 开书阶段推荐，不全局默认 |
| 八节点结构 | 结构规划工具 | 章节/卷规划 | 82 | extract-structure | `generateOutline` |
| 情绪拉扯五折线 | 文风/情绪节奏 Skill | 审稿维度 | 83 | fuse | 对话、冲突、情绪审稿 |
| 爽点核心公式 | 番茄平台包 | 章节规划工具 | 85 | fuse | 爽点密度、微兑现检查 |
| `context-agent.md` | Agent 设定/职责强化 | Context Engineering | 94 | fuse | 新增“写前 brief Agent” |
| `reviewer.md` + `review-schema.md` | 通用主编 Agent | 质量门禁 | 94 | fuse | 审稿 schema v2 |
| `genre-profiles.md` | 题材/格式包 | 项目级约束 | 88 | fuse | 题材 profile 扩展 |
| `deconstruction-agent.md` | 拆书 Agent | 参考书初始化 | 91 | fuse | 拆书工厂、开书对标 |
| `data-agent.md` | 记忆提交 Agent | 长篇稳定性 | 86 | extract-structure | 章节后事实提取/状态提交 |
| `core-constraints.md` | 写作硬约束 | 审稿门禁 | 89 | fuse | 章节硬约束与去 AI 味 |

## 对产品模型的影响

### 1. 新增“写前 Brief Agent”

webnovel-writer 的 `context-agent` 很重要。它不是正文 prompt，而是写正文前把上下文收窄成 5 段 brief：

- 本章开场委托
- 本章要发生的事
- 本章人物状态
- 写得更顺的规则
- 结尾停在哪里

这能解决 InkFlow 现在容易“把所有上下文都塞给 Writer”的问题。后续应让 `orchestrateWriter` 接收 brief，而不是直接吃全量世界观。

### 2. 审稿从“打分”升级为“可验证问题清单”

`reviewer.md` 和 `review-schema.md` 的价值在于：不输出泛泛评分，只输出可验证问题、证据、修复建议、是否阻断。

建议后续把 `manualAudit` 和 `orchestrateCritic` 分成两层：

- **问题层**：一致性、时间线、角色状态、AI 味、逻辑断点。
- **决策层**：是否需要重写、局部手术、继续发布。

### 3. 题材包要成为项目级约束

`genre-profiles.md` 说明题材 profile 不应覆盖故事设定，只作为 fallback 和约束增强。InkFlow 也应如此：

- 用户项目设定 > 作者流程包 > 题材包 > 通用写作规则。
- 题材包不决定所有句子，只决定读者预期、爽点密度、禁区、节奏红线。

### 4. 拆书要服务“抽象转化”，不能污染 canon

`deconstruction-agent` 的边界非常适合 InkFlow：拆参考书时只保留条件框架、情绪链、爽点循环、差异化要求，不把原作角色、地名、能力名写入新书设定。

这应该成为 `extractSkill` 的升级方向。

### 5. 番茄不是全局默认，而是平台格式包

番茄评分卡、钩子、爽点密度非常有用，但不能盖到全部项目上。它应该作为：

- 免费可试用的 **番茄长篇平台包**
- 开篇诊断时的可选商业维度
- 作者流程包里的一个平台适配层

## 建议接入顺序

1. **先做审稿 schema v2**：把“可验证问题清单 + blocking”接入 `manualAudit` / `orchestrateCritic`。
2. **再做写前 Brief Agent**：生成正文前先组装本章 brief，减少上下文污染。
3. **补番茄平台包 MVP**：钩子、爽点、短段落、完读风险，只在用户选择番茄/爽文时启用。
4. **升级拆书工厂**：增加“参考书抽象转化”模式，禁止污染 canon。
5. **最后做题材 profile 扩展**：玄幻、言情、悬疑、知乎短篇、追妻火葬场等。

## 交互建议

不要让用户看到“选择 18 条 prompt”。用户只看到当前动作：

- 开书时：推荐“番茄长篇平台包”或“小飞鸡长篇流”。
- 写章前：显示“已为本章生成写作 brief，可编辑”。
- 写完后：显示“发现 3 个阻断问题 / 2 个可选优化”。
- 卡文时：推荐“拆书对标”“情绪拉扯”“章末钩子”。
- 开篇不稳时：推荐“黄金三章诊断”。

## 风险

- 番茄规则会牺牲慢热、文学感、晋江式人物关系，需要项目级开关。
- 去 AI 味不能只变成禁词表，否则会让文字更机械。
- webnovel-writer 的文件结构成熟，但不能照搬其项目目录；先吸收 Agent 职责和 schema。
- GitHub 来源的 prompt 需要确认许可证；未确认前只做结构参考和内部研究。
