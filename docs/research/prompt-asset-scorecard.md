# Prompt Asset Scorecard

日期：2026-07-03

## 覆盖范围

- 原始导出总数：140 条。
- 来源覆盖：广场 47、定制 77、创作工具 16。
- 内置 InkFlow prompt：9 条。
- 新增补充资料：番茄合集 14 节、webnovel-writer 核心 agent / reference 资料。

## 分级规则

| 分数 | 等级 | 产品含义 |
| --- | --- | --- |
| 90-100 | S | 高价值候选，可进入小样本直用测试或核心融合 |
| 85-89 | A | 高价值，优先融合或作为流程包节点 |
| 75-84 | B | 可用，但需要清洗、重组或依赖上下文 |
| 65-74 | C | 窄场景参考，通常只抽结构 |
| <65 | D | 淘汰或仅研究，不进入产品候选 |

处理结论：

- `direct-use-test`：权限确认且结构稳定，可用 2-3 个样例测试直用。
- `sanitize-productize`：已授权，但需删除作者信息、个人协议、联系方式和外部品牌痕迹后再测试产品化。
- `fuse`：融合到现有 Agent、Skill、题材包或审稿维度。
- `extract-structure`：只取流程、变量、质量门槛。
- `style-reference`：只作文风、句式、对白、动作链参考。
- `research-only`：质量不可控、污染高、不可验证，或授权仍未知的外部资料；不再用于这批已购买授权的定制提示词。

## 评分维度

总分不是主观喜好，而是 8 个维度加权：

| 维度 | 权重 |
| --- | ---: |
| 任务边界 | 15 |
| 输入变量 | 10 |
| 输出结构 | 15 |
| 流程稳定性 | 15 |
| 写作有效性 | 15 |
| 去 AI / 质量护栏 | 10 |
| 可集成性 | 10 |
| 风险控制 | 10 |

评分之后再决定产品放置：`core-default`、`agent-guided`、`optional-style`、`flow-default`、`premium-enhancement`、`sanitize-required`、`research-only`。

详细规则见：`docs/research/prompt-scoring-and-placement.md`。
授权与白标规则见：`docs/research/prompt-authorization-and-sanitization-policy.md`。

## 汇总判断

| 类型 | 数量 | 产品处理 |
| --- | ---: | --- |
| 内置基础 prompt | 9 | 免费基础引擎，不替换，外部资产只增强 |
| 广场提示词 | 47 | 免费广场候选，优先做功能工具、题材包、流程入口 |
| 定制提示词 | 77 | 已确认购买授权；全部进入白标清洗和质量复评，按质量决定内置/选配/付费/淘汰 |
| 创作工具提示词 | 16 | 免费题材包雏形，先做 fallback profile |
| 番茄补充资料 | 14 节 | 形成番茄平台包、拆书诊断、去 AI 味增强 |
| webnovel-writer | 核心 agent / references | 强化写前 brief、审稿 schema、题材 profile、章节 commit |

## Top 候选

| 候选 | 等级 | 处理 | 理由 |
| --- | --- | --- | --- |
| 小飞鸡长篇流 | S | direct-use-test | 脑洞、世界观、角色、大纲、细纲、章纲、正文、润色连续完整 |
| webnovel `context-agent` | S | fuse | 写前 brief 能解决上下文污染和正文漂移 |
| webnovel `reviewer` + schema | S | fuse | 审稿输出可验证问题，不靠泛泛评分 |
| 番茄评分卡 + 钩子体系 | S/A | fuse | 直接补平台完读、爽点密度、章首章末钩子 |
| 小飞鸡去 AI 润色 | S | direct-use-test | 可作为付费精修节点，但要防止禁词机械化 |
| 风华逻辑检测 / 审稿类 | A/B | sanitize-productize / fuse | 审稿思路有价值，需去作者信息和个人协议后进入审稿链路评测 |
| 雪花六步法 | A | extract-structure | 适合升级开书到长篇规划，不宜全局照搬 |
| 创作工具 16 类题材 | C/B | fuse | 可做免费题材 profile 起点，深度不足 |

## 同类资产替代原则

定制提示词在多个维度上质量更高，尤其是长篇细纲、世界观、角色卡、正文、去 AI 味。用户已确认购买授权，因此不再按 `has_access=false` 阻断使用，改为按“白标清洗 + 质量复评”决定放置：

- 高质量定制资产：可优先替代广场同类资产，进入 `direct-use-test` 或付费流程包。
- 含作者名、联系方式、个人协议、私有身份话术的资产：先进入 `sanitize-productize`，清洗后再测。
- 广场资产：优先做免费入口、试驾节点、基础 Skill。
- 同一作者流程内：优先保持原流程连贯，不随意混搭。

小飞鸡长篇流是当前最明确的“定制优先”样本：8 条高质量定制节点构成主流程，广场小飞鸡节点作为免费入口和补充。其他风华、沐殇、fire 等定制资产也应进入第二轮白标复评，而不是因授权字段停留在研究层。

注意：`sanitize-productize` 不等于必然上架。它只表示“授权阻断解除，进入白标清洗和产品化评测”。D/C 级资产清洗后仍可能被 `reject`、只做结构融合，或合并进更强的同类流程。

## 内置 / 选配 / 付费判断

| 类型 | 放置 | 例子 |
| --- | --- | --- |
| 后置质量护栏 | `core-default` | 审稿、去 AI、连续性、blocking |
| 基础创作质量工具 | `agent-guided` | 脑洞、取名、世界观、角色、金手指 |
| 个性化正文体验 | `optional-style` | 作者正文风格、口语推进、平台强风格 |
| 作者/平台流程 | `flow-default` | 小飞鸡长篇流、天马大纲流、番茄平台流 |
| 高级稳定性 | `premium-enhancement` | 十章循环、前十章诊断、高级拆书卡 |
| 已授权但未清洗定制资产 | `sanitize-required` | 含作者名、私有协议、个人化包装的定制提示词 |

## 内置 Prompt 评分

| ID | 名称 | 来源 | 主归属 | 包装 | 分数 | 等级 | 处理 | 风险 |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| inspirationSystem | 灵感助手 | built-in | 内置基础引擎 | free-base | 84 | B | fuse | 基础引擎，需外部增强但不替换 |
| storyCards | 故事方案卡 | built-in | 内置基础引擎 | free-base | 83 | B | fuse | 基础引擎，需外部增强但不替换 |
| setupTaskRefine | 设定项细化 | built-in | 功能工具 Skill | free-base | 78 | B | fuse | 基础引擎，需外部增强但不替换 |
| editorAgent | 分镜生成 | built-in | 结构规划 Agent | free-base | 82 | B | fuse | 基础引擎，需外部增强但不替换 |
| manualAudit | AI 审计 | built-in | 通用主编 Agent | free-base | 80 | B | fuse | 基础引擎，需外部增强但不替换 |
| orchestrateWriter | 正文生成 | built-in | 正文基础引擎 | free-base | 82 | B | fuse | 基础引擎，需外部增强但不替换 |
| orchestrateCritic | 正文生成内审 | built-in | 通用主编 Agent | free-base | 79 | B | fuse | 基础引擎，需外部增强但不替换 |
| extractSkill | 拆书萃取 | built-in | 功能工具 Skill | free-base | 81 | B | fuse | 基础引擎，需外部增强但不替换 |
| generateOutline | 全局大纲 | built-in | 结构规划 Agent | free-base | 80 | B | fuse | 基础引擎，需外部增强但不替换 |

## 广场提示词评分（47/47）

| ID | 名称 | 来源 | 主归属 | 包装 | 分数 | 等级 | 处理 | 风险 |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| square-183 | 【小飞鸡】长篇拆书器<十章版> | square | 拆书/诊断工具 | free-square | 88 | A | fuse | 需保持流程连贯 |
| square-182 | 【小飞鸡】爆款书名简介策划引擎！ | square | 作者流程包节点 | free-square | 82 | B | direct-use-test | 需保持流程连贯 |
| square-176 | 【小飞鸡】长篇正文~超强口语化推进剧情 | square | 作者流程包节点 | free-square | 86 | A | direct-use-test | 需保持流程连贯 |
| square-174 | 【小飞鸡】番茄长篇正文通用 | square | 作者流程包节点 | free-square | 86 | A | direct-use-test | 需保持流程连贯 |
| square-122 | 【风华出品】短篇文章逻辑检测分析器 | square | 通用主编/文风精修 | free-square | 87 | A | fuse | 流程依赖 |
| square-114 | 【风华出品】小说起名器（短篇为主） | square | 作者流程包节点 | free-square | 79 | B | fuse | 流程依赖 |
| square-109 | 【小飞鸡】爆款短篇第三步 | square | 作者流程包节点 | free-square | 82 | B | direct-use-test | 需保持流程连贯 |
| square-108 | 【小飞鸡】爆款短篇第二步 | square | 作者流程包节点 | free-square | 86 | A | direct-use-test | 需保持流程连贯 |
| square-107 | 【小飞鸡】爆款短篇第一步 | square | 作者流程包节点 | free-square | 82 | B | direct-use-test | 需保持流程连贯 |
| square-104 | lwl-网络流行语和热门梗润色 | square | 通用主编/文风精修 | free-square | 74 | C | fuse | 风格时效性强 |
| square-103 | 【风华出品】一键生成章节梗概 | square | 作者流程包节点 | free-square | 79 | B | fuse | 流程依赖 |
| square-94 | 【风华出品】长篇一键破解爆款小说并生成脑洞 | square | 拆书/诊断工具 | free-square | 83 | B | fuse | 流程依赖 |
| square-93 | 【风华出品】短篇破解爆款备用版 | square | 拆书/诊断工具 | free-square | 79 | B | fuse | 流程依赖 |
| square-88 | 【风华出品】短篇破解爆款第一步 | square | 拆书/诊断工具 | free-square | 79 | B | fuse | 流程依赖 |
| square-87 | 锅盖拆书《灵光版》 | square | 拆书/诊断工具 | free-square | 82 | B | fuse | 需防原作污染 |
| square-82 | 【风华出品】根据卷纲生成15章大纲 | square | 作者流程包节点 | free-square | 83 | B | fuse | 流程依赖 |
| square-81 | 【风华出品】生成卷纲并确定总章节数 | square | 作者流程包节点 | free-square | 79 | B | fuse | 流程依赖 |
| square-80 | 【风华出品】世界观生成器 | square | 作者流程包节点 | free-square | 83 | B | fuse | 第二步依赖 |
| square-79 | 【风华出品】一键破解爆款并生成脑洞 | square | 拆书/诊断工具 | free-square | 79 | B | fuse | 流程依赖 |
| square-78 | 【风华出品】一键润色降ai 1.0 | square | 通用主编/文风精修 | free-square | 86 | A | fuse | 需反向检查套路词 |
| square-76 | 天马-脑洞生成-番茄爆款 | square | 功能工具 Skill | free-square | 74 | C | fuse | 平台口味强 |
| square-74 | 【风华出品】长短篇通用正文 | square | 作者流程包节点 | free-square | 79 | B | fuse | 流程依赖 |
| square-61 | lwl-事件生成 | square | 功能工具 Skill | free-square | 74 | C | fuse | 单点工具 |
| square-60 | lwl-爆款短篇仿写与黄金开篇 | square | 写作风格 Skill | free-square | 74 | C | style-reference | 仿写风险 |
| square-56 | lwl-简介生成 | square | 功能工具 Skill | free-square | 74 | C | fuse | 单点工具 |
| square-55 | lwl-生成角色 | square | 功能工具 Skill | free-square | 74 | C | fuse | 单点工具 |
| square-54 | lwl-世界观生成专家 | square | 功能工具 Skill | free-square | 78 | B | fuse | 可抽通用结构 |
| square-53 | lwl-世界观生成 | square | 功能工具 Skill | free-square | 78 | B | fuse | 可抽通用结构 |
| square-43 | 天马-番茄短篇-清澈版 | square | 写作风格 Skill | free-square | 74 | C | style-reference | 题材/平台口味强 |
| square-42 | 天马-通用章节大纲 | square | 结构规划工具 | free-square | 78 | B | fuse | 可并入章纲工具 |
| square-41 | 天马-大纲生成-设定强化+节奏 | square | 结构规划工具 | free-square | 78 | B | fuse | 可并入大纲工具 |
| square-39 | 天马-大纲生成-三幕式 | square | 结构规划工具 | free-square | 78 | B | fuse | 可并入大纲工具 |
| square-38 | 天马-大纲生成-基础版 | square | 结构规划工具 | free-square | 78 | B | fuse | 可并入大纲工具 |
| square-27 | 爆款-番茄风【金手指】 | square | 功能工具 Skill | free-square | 74 | C | fuse | 番茄强绑定 |
| square-26 | 一次一章-【续写】 | square | 写作风格 Skill | free-square | 74 | C | style-reference | 单章续写 |
| square-22 | lwl-章节列表生成 | square | 结构规划工具 | free-square | 74 | C | fuse | 单点工具 |
| square-21 | 猫头鹰-短篇故事脑洞生成 | square | 功能工具 Skill | free-square | 74 | C | fuse | 人机互动要求高 |
| square-20 | 猫头鹰-短篇拆书 | square | 拆书/诊断工具 | free-square | 82 | B | fuse | 可补拆书工厂 |
| square-19 | lwl-知乎短文 | square | 题材/格式包 | free-square | 74 | C | fuse | 平台格式 |
| square-18 | lwl-生成新角色 | square | 功能工具 Skill | free-square | 74 | C | fuse | 单点工具 |
| square-13 | lwl-文本润色 | square | 通用主编/文风精修 | free-square | 74 | C | fuse | 需去模板化 |
| square-12 | lwl-顶级提示0.01 | square | 写作风格 Skill | free-square | 74 | C | style-reference | 命名不清 |
| square-11 | 锅盖第一人称短片写作 | square | 写作风格 Skill | free-square | 74 | C | style-reference | 强文风 |
| square-10 | 锅盖男频正文直出 | square | 写作风格 Skill | free-square | 74 | C | style-reference | 强文风 |
| square-9 | 锅盖润色扩写，去AI味 | square | 通用主编/文风精修 | free-square | 81 | B | fuse | 可补去 AI 味 |
| square-7 | lwl-爆款续写 | square | 写作风格 Skill | free-square | 74 | C | style-reference | 单点续写 |
| square-3 | lwl-AI润色指令 | square | 通用主编/文风精修 | free-square | 74 | C | fuse | 需反向检查 |

## 定制提示词评分（77/77）

| ID | 名称 | 来源 | 主归属 | 包装 | 分数 | 等级 | 处理 | 风险 |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| private-193 | 【小飞鸡】正文去AI高频词+润色 | private | 文风精修 Skill | paid/custom-candidate | 92 | S | direct-use-test | 需保持流程连贯 |
| private-181 | 【小飞鸡】五个长篇脑洞 | private | 作者流程包节点 | paid/custom-candidate | 88 | A | direct-use-test | 需保持流程连贯 |
| private-180 | 【小飞鸡】长篇正文<配套使用> | private | 作者流程包节点 | paid/custom-candidate | 90 | S | direct-use-test | 需保持流程连贯 |
| private-179 | 【小飞鸡】长篇通用章纲 | private | 作者流程包节点 | paid/custom-candidate | 89 | A | direct-use-test | 需保持流程连贯 |
| private-178 | 【小飞鸡】长篇细纲 | private | 作者流程包节点 | paid/custom-candidate | 91 | S | direct-use-test | 需保持流程连贯 |
| private-177 | 【小飞鸡】长篇超宏大世界观 | private | 作者流程包节点 | paid/custom-candidate | 89 | A | direct-use-test | 世界观可抽通用版 |
| private-175 | 【小飞鸡】长篇通用大纲-万字版 | private | 作者流程包节点 | paid/custom-candidate | 88 | A | direct-use-test | 需保持流程连贯 |
| private-157 | 【小飞鸡】长篇角色卡生成 | private | 作者流程包节点 | paid/custom-candidate | 86 | A | direct-use-test | 需保持流程连贯 |
| private-222 | 乐乐乐专用正文提示词 | private | 写作风格 Skill | authorized-custom-needs-sanitization | 63 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-221 | 沐殇专用克苏鲁标题 | private | 题材/格式包 | authorized-custom-needs-sanitization | 63 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-220 | 沐殇专用克苏鲁简介与书名 | private | 题材/格式包 | authorized-custom-needs-sanitization | 63 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-219 | 沐殇专用克苏鲁配角信息卡 | private | 题材/格式包 | authorized-custom-needs-sanitization | 63 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-218 | 沐殇专用克苏鲁主角及主角团核心成员信息卡 | private | 题材/格式包 | authorized-custom-needs-sanitization | 63 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-217 | 沐殇专用克苏鲁正文 | private | 题材/格式包 | authorized-custom-needs-sanitization | 63 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-216 | 沐殇专用克苏鲁章纲 | private | 题材/格式包 | authorized-custom-needs-sanitization | 67 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-215 | 沐殇专用克苏鲁细纲 | private | 题材/格式包 | authorized-custom-needs-sanitization | 67 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-214 | 沐殇专用克苏鲁大纲 | private | 题材/格式包 | authorized-custom-needs-sanitization | 67 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-213 | 沐殇专用克苏鲁世界观 | private | 题材/格式包 | authorized-custom-needs-sanitization | 67 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-212 | 沐殇专用宝可梦简介 | private | 题材/格式包 | authorized-custom-needs-sanitization | 63 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-211 | 沐殇专用宝可梦书名与简介 | private | 题材/格式包 | authorized-custom-needs-sanitization | 63 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-210 | 沐殇专用宝可梦配角信息卡 | private | 题材/格式包 | authorized-custom-needs-sanitization | 63 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-209 | 沐殇专用宝可梦正文 | private | 题材/格式包 | authorized-custom-needs-sanitization | 63 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-208 | 沐殇专用宝可梦细纲 | private | 题材/格式包 | authorized-custom-needs-sanitization | 67 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-207 | 沐殇专用宝可梦章纲 | private | 题材/格式包 | authorized-custom-needs-sanitization | 67 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-206 | 沐殇专用宝可梦系统信息卡 | private | 题材/格式包 | authorized-custom-needs-sanitization | 63 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-205 | 沐殇专用宝可梦信息卡 | private | 题材/格式包 | authorized-custom-needs-sanitization | 63 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-204 | 沐殇专用宝可梦主角信息卡 | private | 题材/格式包 | authorized-custom-needs-sanitization | 63 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-203 | 牧殇角色提示词 | private | 功能工具 Skill | authorized-custom-needs-sanitization | 68 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-202 | 沐殇定制细纲 | private | 题材/格式包 | authorized-custom-needs-sanitization | 67 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-201 | 沐殇定制大纲 | private | 题材/格式包 | authorized-custom-needs-sanitization | 67 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-200 | 沐殇定制章纲 | private | 题材/格式包 | authorized-custom-needs-sanitization | 67 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-199 | 沐殇定制正文提示词 | private | 题材/格式包 | authorized-custom-needs-sanitization | 63 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-198 | 测试审稿 | private | 通用主编/文风精修 | authorized-custom-needs-sanitization | 64 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-197 | 测试黄金一章 | private | 功能工具 Skill | authorized-custom-needs-sanitization | 56 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-195 | 测试 | private | 功能工具 Skill | authorized-custom-needs-sanitization | 56 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-192 | fire定制正文 | private | 题材/格式包 | authorized-custom-needs-sanitization | 63 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-191 | fire定制章纲 | private | 题材/格式包 | authorized-custom-needs-sanitization | 67 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-190 | fire定制细纲 | private | 题材/格式包 | authorized-custom-needs-sanitization | 67 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-189 | fire定制书名+简介 | private | 题材/格式包 | authorized-custom-needs-sanitization | 63 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-188 | fire定制世界观 | private | 题材/格式包 | authorized-custom-needs-sanitization | 67 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-187 | fire定制脑洞 | private | 题材/格式包 | authorized-custom-needs-sanitization | 63 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-186 | fire角色定制 | private | 题材/格式包 | authorized-custom-needs-sanitization | 63 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-185 | fire定制大纲 | private | 题材/格式包 | authorized-custom-needs-sanitization | 67 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-170 | 番茄正文过保底2 | private | 番茄平台包 | authorized-custom-needs-sanitization | 68 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-169 | 番茄正文过保底 | private | 写作风格 Skill | authorized-custom-needs-sanitization | 68 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-168 | 章纲自适应续写 | private | 写作风格 Skill | authorized-custom-needs-sanitization | 72 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-167 | 风华长篇大纲测试 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 65 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-163 | 【风华出品】短篇拆文仿写 | private | 拆书/诊断工具 | authorized-custom-needs-sanitization | 76 | B | sanitize-productize | 需白标清洗+质量复评 |
| private-162 | 【风华出品】老福特编辑审稿 | private | 通用主编/文风精修 | authorized-custom-needs-sanitization | 76 | B | sanitize-productize | 需白标清洗+质量复评 |
| private-161 | 新版过朱雀 | private | 写作风格 Skill | authorized-custom-needs-sanitization | 56 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-158 | 短篇直出 | private | 写作风格 Skill | authorized-custom-needs-sanitization | 68 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-144 | 【风华出品】私有化流程6 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 73 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-143 | 【风华出品】私有化流程5 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 73 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-142 | 【风华出品】私有化流程4 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 73 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-141 | 【风华出品】私有化流程3 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 73 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-140 | 【风华出品】私有化流程2 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 73 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-139 | 【风华出品】私有化流程1 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 73 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-132 | 【风华出品】女频过七猫保底 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 73 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-131 | 【风华出品】自用长篇正文 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 76 | B | sanitize-productize | 需白标清洗+质量复评 |
| private-130 | 【风华出品】黄金手术刀 | private | 通用主编/文风精修 | authorized-custom-needs-sanitization | 76 | B | sanitize-productize | 需白标清洗+质量复评 |
| private-129 | 【风华出品】老福特通用正文 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 73 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-128 | 【风华出品】老福特乙女大纲 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 76 | B | sanitize-productize | 需白标清洗+质量复评 |
| private-127 | 【风华出品】老福特观影大纲 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 76 | B | sanitize-productize | 需白标清洗+质量复评 |
| private-126 | 【风华出品】老福特耽美大纲 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 76 | B | sanitize-productize | 需白标清洗+质量复评 |
| private-125 | 【风华出品】老福特爽文大纲 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 76 | B | sanitize-productize | 需白标清洗+质量复评 |
| private-124 | 【风华出品】老福特脑洞生成器 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 73 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-123 | 【风华出品】一键融梗换心 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 73 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-106 | 私密内测 | private | 写作风格 Skill | authorized-custom-needs-sanitization | 56 | D | sanitize-productize | 需白标清洗+质量复评 |
| private-101 | 【风华出品】金牌主编改稿 | private | 通用主编/文风精修 | authorized-custom-needs-sanitization | 73 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-100 | 【风华出品】金牌主编审稿 | private | 通用主编/文风精修 | authorized-custom-needs-sanitization | 76 | B | sanitize-productize | 需白标清洗+质量复评 |
| private-92 | 【风华出品】短篇专用导语仿写 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 68 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-91 | 【风华出品】短篇专用导语生成 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 68 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-90 | 【风华出品】短篇专用正文 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 68 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-89 | 【风华出品】短篇专用大纲生成 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 72 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-86 | 【风华出品】一键润色降ai 2.0 | private | 通用主编/文风精修 | authorized-custom-needs-sanitization | 76 | B | sanitize-productize | 需白标清洗+质量复评 |
| private-85 | 【风华出品】对话情绪拉扯增幅器 | private | 通用主编/文风精修 | authorized-custom-needs-sanitization | 73 | C | sanitize-productize | 需白标清洗+质量复评 |
| private-84 | 【风华出品】超强文风自适应续写 | private | 作者流程包节点 | authorized-custom-needs-sanitization | 73 | C | sanitize-productize | 需白标清洗+质量复评 |

## 创作工具提示词评分（16/16）

| ID | 名称 | 来源 | 主归属 | 包装 | 分数 | 等级 | 处理 | 风险 |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| creative-1 | 玄幻 | creative | 题材/格式包 | free-genre | 72 | C | fuse | 深度不足，先做 fallback |
| creative-2 | 修真 | creative | 题材/格式包 | free-genre | 72 | C | fuse | 深度不足，先做 fallback |
| creative-3 | 都市异能 | creative | 题材/格式包 | free-genre | 72 | C | fuse | 深度不足，先做 fallback |
| creative-4 | 重生 | creative | 题材/格式包 | free-genre | 72 | C | fuse | 深度不足，先做 fallback |
| creative-5 | 穿越 | creative | 题材/格式包 | free-genre | 72 | C | fuse | 深度不足，先做 fallback |
| creative-6 | 快穿 | creative | 题材/格式包 | free-genre | 72 | C | fuse | 深度不足，先做 fallback |
| creative-7 | 末世 | creative | 题材/格式包 | free-genre | 72 | C | fuse | 深度不足，先做 fallback |
| creative-8 | 科幻 | creative | 题材/格式包 | free-genre | 72 | C | fuse | 深度不足，先做 fallback |
| creative-9 | 悬疑推理 | creative | 题材/格式包 | free-genre | 72 | C | fuse | 深度不足，先做 fallback |
| creative-10 | 言情 | creative | 题材/格式包 | free-genre | 72 | C | fuse | 深度不足，先做 fallback |
| creative-11 | 宫斗宅斗 | creative | 题材/格式包 | free-genre | 72 | C | fuse | 深度不足，先做 fallback |
| creative-12 | 群像剧 | creative | 题材/格式包 | free-genre | 72 | C | fuse | 深度不足，先做 fallback |
| creative-13 | 权谋历史 | creative | 题材/格式包 | free-genre | 72 | C | fuse | 深度不足，先做 fallback |
| creative-14 | 电竞游戏 | creative | 题材/格式包 | free-genre | 72 | C | fuse | 深度不足，先做 fallback |
| creative-15 | 轻小说风格 | creative | 题材/格式包 | free-genre | 72 | C | fuse | 深度不足，先做 fallback |
| creative-16 | 追妻火葬场 | creative | 题材/格式包 | free-genre | 72 | C | fuse | 深度不足，先做 fallback |

## 新增补充资料评分

详见 `docs/research/prompt-supplement-fanqie-webnovel.md`。结论：

- 番茄合集优先做 **番茄平台包 + 开篇诊断 + 去 AI 味精修**。
- webnovel-writer 优先吸收 **写前 brief Agent + 审稿 schema + 章节 commit 思路**。
- 新资料不进入“作者流派”默认包，除非其来源本身是一套连续风格流程。
