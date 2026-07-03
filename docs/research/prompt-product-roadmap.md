# Prompt Asset Product Roadmap

日期：2026-07-03
使用方法：`product-strategy-session`、`roadmap-planning`、`epic-breakdown-advisor`、`context-engineering-advisor`、`customer-journey-map`

## Strategy Context

### Business / Product Outcomes

- **产出质量**：让 InkFlow 生成和精修的章节更像人写，少 AI 腔、少解释感、少模板动作。
- **长篇稳定性**：让章节生产能跨 10 章、几十章保持剧情点、伏笔和节奏不透支。
- **体系进化**：让外部高质量提示词反向优化 InkFlow 的阶段、维度、审稿标准和生成流程。
- **用户体验守恒**：不把产品变成提示词货架，用户仍围绕“当前作品、当前章节、下一步动作”推进。
- **资产商业化准备**：让内置、免费广场、付费定制、私有资产有清晰边界，为后续包装验证打基础。

### Customer Problems

- 作者拿到 AI 正文后，经常需要手工去 AI 味、修对白和动作链。
- 长篇写作容易前期透支设定和真相，后续章节变空。
- 现有提示词架构偏单次调用，难表达“前十章”“十章循环”“剧情点预算”这类跨章节工序。
- 外部提示词有高价值方法，但如果硬塞进现有阶段，会丢失完整创作逻辑。
- 同一作者的提示词往往是连续流程，拆成散卡会破坏风格与工序。
- 用户不知道什么时候该挂载 Skill、什么时候该选题材包、什么时候该听 Agent 建议。
- 用户常常不确定作品适合哪个发布平台，而平台会影响标题、简介、章节节奏、审稿口径和变现路径。

### Constraints / Dependencies

- 用户已确认购买授权；`private` 中原 `has_access=false` 字段不再作为授权阻断，只作为来源系统访问标记。
- 定制提示词进入运行时前必须白标清洗：删除作者名、联系方式、个人协议、外部品牌痕迹和不可产品化的自我保护规则。
- 运行时提示词改动必须小步验证，不能一次替换核心链路。
- 新维度不能增加 UI 负担，复杂度应留在内部路由、审稿和候选挂载。
- 文风规则必须尊重项目特色，不能把某个平台风格设为全局默认。
- 免费/付费包装不能先行，需要先验证资产能稳定带来结果。

## Roadmap

| Stage | Initiative | Outcome | Metric | Notes |
| --- | --- | --- | --- | --- |
| Now | Prompt Candidate Audit | 建立 140 条提示词的质量地图 | 140/140 覆盖；Top 候选均有评分、结论、风险 | 已形成审计、Source Cards、集成路线 |
| Now | Asset Operating Model | 明确 Prompt、Skill、作者流程包、题材包、Agent 的关系 | 用户不需要理解底层 prompt，也能知道增强包作用 | 见 `prompt-asset-operating-model.md` |
| Now | Prompt Skill Taxonomy | 建立主归属+次归属分类，分清风格、功能、通用审稿、题材、流程 | 雷同提示词能归并，作者流程不被拆散 | 见 `prompt-skill-taxonomy.md` |
| Now | Guided Interaction Map | 避免资产库变成选择负担 | 每阶段最多推荐 3 个下一步选项 | 见 `prompt-user-journey-map.md` |
| Now | Platform Selection Dimension | 把发布平台纳入开书决策 | 能解释番茄/起点/晋江/知乎等差异，不强制用户先选 | 影响题材包、流程包、审稿维度 |
| Now | Skill Series Flow Model | 把作者系列提示词编排成流程 | 小飞鸡长篇流能还原为步骤+变体+质检 | 见 `prompt-workflow-product-system.md` |
| Now | Book Card Stacking Model | 明确拆书卡能拆什么、怎么叠加 | 拆书卡不污染 canon，能叠加到章纲/正文/审稿 | 见 `prompt-workflow-product-system.md` |
| Now | Series Flow Candidate Map | 明确哪些作者/平台/工具能成流程 | 小飞鸡、风华、天马、番茄、webnovel-writer 各有处理策略 | 见 `prompt-series-flow-candidates.md` |
| Now | Dimension Normalization | 统一提示词维度和产物口径 | 每条提示词可拆成能力单元，复合产物不误挂载 | 见 `prompt-dimension-normalization.md` |
| Now | Scoring & Placement Model | 建立提示词评分和内置/选配/付费放置规则 | 用户知道哪些更好，系统知道放在哪里 | 见 `prompt-scoring-and-placement.md` |
| Now | Deconstruction Card & Fusion System | 把拆书从单张文风卡升级为报告、卡组、诊断规则 | 拆书卡有证据、评分、推荐放置，能叠加到写作/审稿/精修 | 见 `prompt-deconstruction-fusion-system.md` |
| Now | Style Humanization Pack | 降低 AI 味，提高章节可读性 | `slop-scorer` 命中更准确；改写后剧情不跑偏 | 优先补 `slop-scorer`、`buildRewritePrompt`、`orchestrateWriter` |
| Next | Author Flow Pack MVP | 保留同作者提示词的连续流程 | 至少整理 3 个流程包：小飞鸡长篇、风华短篇、天马大纲 | 不拆散成散卡 |
| Next | Skill Mount Recommendation | 让 Agent 引导用户挂载能力 | 推荐理由清楚；可接受/跳过/撤销 | 用当前项目缺口推荐 |
| Next | Cross-Chapter Planning Pack | 支撑前十章和十章循环规划 | 分镜能声明使用/保留的剧情点；不提前揭示后续真相 | 补 `generateOutline`、`editorAgent`、章节生产流程 |
| Next | Opening Diagnostic Pack | 帮作者判断前十章是否立住 | 输出章节级建议；能识别钩子、角色驱动力、伏笔期待 | 融合拆书器和商业审稿，不默认打断写作流 |
| Later | Free/Paid Packaging Trial | 验证免费广场与付费定制的包装 | 以流程包/增强包为单位测试，不按单条 prompt 售卖 | 需完成白标清洗与价值验证 |
| Later | Adaptive Dimension System | 让 InkFlow 维度随证据演进 | 新维度必须映射到生成/审稿行为 | 候选：`style-humanization`、`cross-chapter-continuity`、`commercial-readability`、`genre-fit` |
| Later | Prompt Candidate Runtime Trials | 验证少数高质量提示词是否可直接沿用 | 每条候选通过 2-3 个样例稳定性测试 | 只针对白标清洗完成、无污染、输出可控的候选 |

## Epic Hypotheses

### Epic 1：Style Humanization Pack

Hypothesis：我们相信，把去 AI 味从“禁词扫描”升级为“扫描 + 改写策略 + 终稿复查”，会显著提升章节精修质量，因为当前问题不是单个词，而是解释感、模板动作、对白无前因和句式机械。

Success signals：

- 改写后保留原剧情顺序和悬念落点。
- 机械套话、弱动词、模板表情命中减少。
- 用户不需要反复要求“更像人写”。

Placement：基础去 AI 味属于 `core-default`，默认内置；高级严审和局部手术可作为 `premium-enhancement`。

### Epic 2：Cross-Chapter Planning Pack

Hypothesis：我们相信，引入剧情点预算、伏笔消耗和十章循环规划，会提升长篇连续性，因为当前单章分镜无法约束后续剧情不被提前消耗。

Success signals：

- 当前章分镜能区分“可揭示剧情点”和“只可埋伏笔”。
- 后续章节仍有明确推进空间。
- 前十章和第 11 章后的规划目标不同。

### Epic 3：Opening Diagnostic Pack

Hypothesis：我们相信，提供主动触发的前十章诊断，会帮助作者更早发现开篇问题，因为长篇成败常由主角驱动力、钩子密度、金手指限制和读者期待决定。

Success signals：

- 诊断输出到章节级，不停留在总体评价。
- 建议能直接转化为重写动作。
- 商业判断可开关，不覆盖非爽文项目。

### Epic 4：Adaptive Dimension System

Hypothesis：我们相信，把维度设计成可学习、可挂载，而非固定六项，会让 InkFlow 更好吸收外部高质量方法，因为不同题材和工序需要不同的评价轴。

Success signals：

- 新维度不会出现在所有项目里，只在相关任务挂载。
- 每个新维度都能影响生成或审稿，不只是标签。
- UI 保持简单，内部能力变强。

### Epic 5：Author Flow Pack

Hypothesis：我们相信，把同一作者的提示词整理成连续流程包，会比拆成散卡更能提升用户成功率，因为作者提示词本身包含从脑洞到正文再到润色的连贯方法论。

Success signals：

- 用户能选择一个流程包后连续推进多个阶段。
- 同一流程包下的输出风格和工序保持一致。
- 用户无需手动理解每条提示词的使用顺序。

### Epic 5.5：Switchable Skill Series

Hypothesis：我们相信，允许用户在步骤边界替换流程节点，会比强制一路到底更适合真实创作，因为架构设定需要连贯，但正文风格、审稿、精修经常需要按问题切换。

Success signals：

- 用户能理解“架构层切换”和“写作层叠加”的区别。
- 切换后不会丢失世界观、角色、大纲等 canon。
- 试驾对比能帮助用户选择正文风格或审稿方式。

### Epic 6：Guided Skill Mounting

Hypothesis：我们相信，由 Agent 在关键节点推荐 Skill/题材包/流程包，会降低用户选择成本，因为多数作者知道自己要写什么，但不知道该挂载什么能力。

Success signals：

- 推荐接受率高于手动浏览资产库。
- 用户能理解“为什么推荐这个增强包”。
- 用户可以随时关闭或替换增强包。

### Epic 6.5：Platform Selection Advisor

Hypothesis：我们相信，在开书前给出目标发布平台建议，会提升后续流程匹配度，因为番茄、起点、晋江、知乎、老福特等平台对篇幅、节奏、标题简介、读者承诺和审稿重点的要求不同。

Success signals：

- 用户能接受、跳过或选择“暂不确定”。
- 平台建议能改变后续推荐，而不是只显示一个标签。
- 商业诊断可关闭，不压过作者表达。

### Epic 6.8：Deconstruction Card & Fusion System

Hypothesis：我们相信，把拆书产物拆成可评分、可叠加、可回滚的 Skill Cards，会比“上传一本书生成一个文风 Skill”更能提升写作质量，因为用户真正需要的是学习可迁移能力，而不是复制原书味道。

Success signals：

- 拆书结果能稳定输出主笔文风卡、节奏卡、钩子卡、反模式卡。
- 每张卡都有证据覆盖、污染风险、推荐放置和适用阶段。
- 用户能选择只看报告、临时叠加、保存卡片、进入融合工坊或做诊断。
- 后置质量链路能默认使用反模式卡和主编审稿卡，不增加用户选择负担。

### Epic 7：Asset Packaging Trial

Hypothesis：我们相信，免费/付费应该按“完成一个创作工作流的增强包”包装，而不是按单条 prompt 包装，因为用户付费购买的是更稳定的结果和更少的试错。

Success signals：

- 免费包能完成基础体验和试用。
- 付费包的价值点是连续流程、题材适配、稳定输出或高级审稿。
- 用户不会因为付费提示打断开书流程。

### Epic 8：Monetized Workflow Packaging

Hypothesis：我们相信，付费价值来自高级流程、平台诊断、长篇稳定性和个人资产编排，而不是提示词文本，因为用户愿意为更稳定的结果和更少返工付费。

Success signals：

- 免费用户能完成第一章闭环。
- 付费入口出现在明确痛点后，如前十章不稳、平台诊断、长篇循环、私有资产导入。
- 付费流程有试驾或对比结果，不靠神秘感转化。

## Sequencing

### Now

- 完成离线评估文档。
- 完成资产产品模型和用户旅程。
- 完成主归属/次归属分类法，解决世界观、角色、命名等雷同提示词的使用边界。
- 完成发布平台维度定义：平台是开书决策和诊断口径，不是题材或文风。
- 完成统一维度模型：原始提示词、能力单元、产物字段、流程步骤分开管理。
- 优先做文风/去 AI 味补强。
- 明确 direct-use 门槛，避免原作者信息、个人协议和外部品牌痕迹进入产品。

### Next

- 做十章循环规划和剧情点预算。
- 做作者流程包 MVP 和 Agent 挂载建议。
- 做前十章诊断，融合拆书和商业审稿。
- 小范围验证已白标清洗的高质量定制候选是否可直接沿用。

### Later

- 基于实证重构 PromptStage 与 Skill 维度。
- 逐步补题材 profile。
- 验证免费/付费包装，不按单条 prompt 售卖。
- 如果候选足够稳定，再考虑内部模板候选库；不做公开提示词市场。

## Risks & Dependencies

- **风险：过度保护旧架构。** 处理方式：把六阶段降级为定位坐标，允许 `system-upgrade` 结论。
- **风险：外部风格污染 InkFlow。** 处理方式：区分通用写作底线和项目风格挂载。
- **风险：去 AI 味变成机械禁词。** 处理方式：同时评估动作化、对白节拍、信息释放和 POV。
- **风险：商业审稿压过作者表达。** 处理方式：商业维度默认作为可选诊断，不做所有项目硬门槛。
- **风险：作者流程被拆散。** 处理方式：新增 Author Flow Pack，Skill 只承载单能力，不承载整套流程。
- **风险：用户被资产库淹没。** 处理方式：交互上只显示当前阶段最多 3 个推荐动作。
- **风险：付费包装过早。** 处理方式：先做免费/内置/私有边界和试驾，再做价格验证。
- **依赖：真实样本文本。** 后续实现必须用 2-3 段现有章节样本验证，不靠提示词自嗨。

## What Is Not On The Roadmap

- 不做用户可见的 140 条提示词市场。
- 不让用户在第一屏手动选作者、题材、Agent、Skill 的复杂组合。
- 不把未白标清洗的原始定制提示词直接沿用。
- 不一次性替换核心运行时提示词。
- 不为了归类而拆碎高质量提示词的完整流程。
- 不把“更多维度”当作成功，只有能改善生成/审稿/决策的维度才保留。
