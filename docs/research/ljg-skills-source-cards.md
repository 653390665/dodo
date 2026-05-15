# ljg-skills Source Cards

研究日期：2026-05-15
来源仓库：https://github.com/lijigang/ljg-skills

---

## Source Card: ljg-read

**原 skill 名称**: `ljg-read`
**原始触发场景**: 用户上传文本后要求伴读、理解、审读，而非代读

**Borrow**
- 结构地图：把文本拆成段落角色、逻辑骨架、关键转折
- 逐段推进 + 深度提问：每段读完提一个问题，逼读者自己思考
- 读后一句话：强迫收束成可用的最小洞见
- 审读不是代读：不替用户读，而是帮用户看清楚文本里有什么

**Reject**
- Org-mode 文件输出（我们的产物是产品内结构化 JSON）
- 长篇伴读对话（InkFlow 需要可操作的字段，不是聊天记录）
- Denote 文件命名规范（不接入本地笔记系统）

**Map**
- 灵枢：ContinuationPackView — 上传资料后生成 sourceMap / readingQuestions / continuationGaps
- InkFlow：WorldBibleView — 世界观设定一致性检查
- 通用 skill：若稳定可沉淀为 `reading-companion` 通用 skill，但不急

**是否值得变成通用 skill**: 等资料包续写稳定后再评估，目前优先级低
**是否值得变成产品功能**: 是，Cut 1 核心参考

**Risk**
- 原 skill 偏中英伴读和个人笔记习惯，需要转译为产品内的结构化字段
- 如果"伴读问题"变成必填，可能堵塞用户续写流程

---

## Source Card: ljg-card

**原 skill 名称**: `ljg-card`
**原始触发场景**: 把内容转成视觉卡片——长图、信息图、多卡、视觉笔记、漫画、白板、大字卡

**Borrow**
- 模具化思维：每种内容有一个清晰的卡片模具（不是自由格式）
- 统一 card schema：故事方向卡、Skill 卡、资料包卡、证据卡共享基底字段
- source badge：卡片上标注内容来源，增加可信度
- 视觉分层：标题、核心洞见、支撑证据、来源——四层信息架构

**Reject**
- Playwright 截图依赖（太重，不适合核心流程）
- 漫画/白板/大字卡等视觉变体（超出 InkFlow 当前范围）
- 图片导出优先（InkFlow 优先产品内渲染）

**Map**
- InkFlow：StoryCardDeck、StoryCardPreview、SkillDetailDrawer
- 数据层：统一 card schema 类型定义
- 视觉层：卡片组件复用 source badge、evidence list、dimension tags

**是否值得变成通用 skill**: 是，但等至少两个卡片场景稳定后
**是否值得变成产品功能**: 是，卡片语言统一的核心参考

**Risk**
- 视觉实现很重，容易过度工程化
- Playwright 依赖会引入 CI/CD 复杂度
- 模具太多会变成选择负担

---

## Source Card: ljg-qa

**原 skill 名称**: `ljg-qa`
**原始触发场景**: 把文本抽成 Q-A 链，Q 切要害，A 包含结论/形式化/步骤/边界

**Borrow**
- Q-A 链结构：不是 FAQ，而是层层递进的方法问题
- A 的四要素：结论 / 形式化 / 步骤 / 边界
- 每个 A 都标注"不适用于什么场景"（与我们的 Skill 边界标注对齐）
- 问题驱动理解：好问题比好回答更值钱

**Reject**
- 不生成 FAQ 式列表
- 不做长文分析报告
- 不让拆书结果变成泛泛读后感

**Map**
- InkFlow：BookFactoryView — 拆书结果增加 methodQuestionChain
- 数据层：skillQuestionChain、evidenceReasoning 字段
- 通用 skill：prompt-reliability-engineering 借鉴其输出质检结构

**是否值得变成通用 skill**: 不单独建 skill，融合到 prompt-reliability-engineering 的输出质检
**是否值得变成产品功能**: 是，Cut 2 核心参考

**Risk**
- 如果 AI 生成的 Q-A 太泛，会变成无用的填充内容
- 需要有输出质检：Q 是否切中要害？A 是否有边界？

---

## Source Card: ljg-learn

**原 skill 名称**: `ljg-learn`
**原始触发场景**: 用户要求解剖/解释一个概念

**Borrow**
- 八维切面思维：历史/辩证/现象/语言/形式/存在/美感/元反思
- 压缩洞见：分析完后必须收束成一句话和一条公式
- 隐喻觉察：要求识别并挑战支配性隐喻
- "内观"技巧：以第一人称扮演概念本身

**Reject**
- 完整的八维解剖流程（与八刀法重叠，不应新建重复 skill）
- Org-mode 输出
- 固定文件写入（我们不需要本地文件产物）
- 每个维度展开 2-3 句的刚性约束（八刀法有自己的节奏）

**Map**
- 通用 skill：增强 eight-knife-thinking，吸收"纵向深钻 + 收束洞见"
- 灵枢：设定概念解释——人物动机、主题母题的深度解剖
- 不新建独立 skill

**是否值得变成通用 skill**: 不新建，融合到 eight-knife-thinking
**是否值得变成产品功能**: 作为八刀法增强参考，不独立产品化

**Risk**
- 与 eight-knife-thinking 重叠度极高，新建会造成 confusion
- 八维结构是强个人方法论，直接产品化会让用户困惑

---

## Source Card: ljg-think

**原 skill 名称**: `ljg-think`
**原始触发场景**: 用户要求纵向深钻——只向下追问，不横向铺开

**Borrow**
- 纵向不横向：每步回答"为什么是这样"，不是"还有什么"
- 层层命名：每层 2-3 字精准标签
- 触底标准：再追问只能得出同义反复或击中四个基础范畴
- 层间裂缝：每一层的结论暴露一个问题，形成进入下一层的裂缝

**Reject**
- "失重感"写作风格——强个人表达，不适合工具化
- 层层惊叹的效果要求——这是文学标准，不是工程标准
- Org-mode 文件写入
- 作为一种独立 skill 并列于八刀法

**Map**
- 通用 skill：作为 eight-knife-thinking 的"纵深模式"参考增强
- 灵枢：设定冲突、主题母题、人物动机的"追本"分析
- 不新建独立 skill

**是否值得变成通用 skill**: 不新建，融入 eight-knife-thinking 作为纵深维度
**是否值得变成产品功能**: 作为八刀法增强参考，不独立产品化

**Risk**
- 风格太强，容易变成表达表演而非分析工具
- 需要工程化成检查表，否则 AI 会产出空洞的"层层惊叹"

---

## Source Card: ljg-skill-map

**原 skill 名称**: `ljg-skill-map`
**原始触发场景**: 用户问"我有哪些技能"时，扫描已安装 skill 并生成分类地图

**Borrow**
- 分类+一屏总览：用户一眼看清能力分布
- 五类分类法：认知原子/输出铸造/联网触达/系统运维/环境部署
- user_invocable 标记：区分可调用 skill 和内部 skill
- 纯只读操作：不改文件、不写磁盘

**Reject**
- ASCII 纯文本渲染（InkFlow 有 React 组件）
- scripts/scan.sh 的 JSON 中间层（InkFlow 有自己的 skill registry）
- 仅按名字前缀分类的规则（InkFlow 有 dimensionTags 和 usageStats）
- 不接使用数据的静态列表

**Map**
- InkFlow：SkillsStudioView — 新增 SkillMapPanel 组件
- 数据层：复用 dimensionTags、usageStats、feedbackScore、mountedSkillLoadout
- 融合层：SkillFusionWorkbench — 融合建议基于使用数据而非静态分类

**是否值得变成通用 skill**: 不新建，这是产品功能而非通用 skill
**是否值得变成产品功能**: 是，Cut 3 核心参考

**Risk**
- 如果只是静态列表，会变成"漂亮但空的展示页"
- 必须和 Skill 权重/融合/反馈数据联动才有价值

---

## Source Card: ljg-writes

**原 skill 名称**: `ljg-writes`
**原始触发场景**: 对观点进行逐层解剖，输出 1000-1500 字批判性散文

**Borrow**
- 口语检验：每段读出声，想象对聪明朋友说这话是否自然
- AI 痕迹过滤：删除 crutch words、宣传腔、宏大象征
- 禁止自封深度：不能写"再深入一层"，让内容本身让人感觉"原来不止这样"
- 边界检验：表达不确定性时直接说"大概 70%"
- 一个句子结构不出现两次

**Reject**
- 完整的写作工作流（是个人写作方法论，不是产品功能）
- Org-mode / Denote 文件输出
- 中文改写步骤（是作者的个人习惯）
- 手术刀+朋友口的姿态描述（太个人化）

**Map**
- 通用 skill：prompt-reliability-engineering — 借鉴口语检验/AI 痕迹过滤/边界检验作为审计检查项
- InkFlow：ProductionRunReview — 写作产出质检
- manualAudit：手工检查项增强

**是否值得变成通用 skill**: 不新建，融合到 prompt-reliability-engineering 的审计维度
**是否值得变成产品功能**: 写作质检参考，不独立产品化

**Risk**
- 是高度个人化的写作方法论，直接产品化会让用户觉得被强加风格
- 1000-1500 字的约束不适用于所有场景
