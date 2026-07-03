# Prompt Dimension Normalization

日期：2026-07-03
使用技能：`product-strategy-session`、`roadmap-planning`、`customer-journey-map`

## 核心结论

提示词必须先被统一维度，才能进入产品管理。否则会出现三个问题：

- 同名不同物：都叫“脑洞”，有的是纯灵感，有的是脑洞+背景+主角+金手指。
- 同物不同名：章纲、章节梗概、分镜、剧情点列表，其实都在做章节规划。
- 复合产物误挂载：一条短篇提示词同时生成书名、简介、导语、正文，不能直接当作单张 Skill。

统一策略：

`Raw Prompt Asset -> Capability Unit -> Output Artifact -> Flow Step -> Step Variant`

原始提示词保留完整，不破坏来源；产品内部拆成可管理的能力单元和产物字段。

## 自动扫描发现

已读取 140 条提示词原文，做关键词维度扫描。高频维度为：

| 维度 | 命中数量 | 产品含义 |
| --- | ---: | --- |
| `character` | 128 | 角色相关内容几乎贯穿所有阶段 |
| `drafting` | 125 | 很多提示词最终都服务正文产出 |
| `world` | 114 | 世界观/背景/设定常与其他能力混合 |
| `hook` | 90 | 钩子、爽点、反转是网文流程核心 |
| `length` | 87 | 长短篇、黄金三章、十章循环影响流程 |
| `style` | 84 | 文风常混在正文、审稿、润色中 |
| `review` | 83 | 审稿规则常被塞进生成提示词 |
| `power` | 82 | 金手指/力量体系常与主角、世界观绑定 |

判断：这些提示词不是线性分类，而是多维混合。必须用统一维度管理，不然用户会被大量雷同提示词淹没。

## 统一维度模型

### 1. 上下文维度

决定“这本书适合什么路径”。

| 维度 | 例子 | 用途 |
| --- | --- | --- |
| `platform` | 番茄、起点、晋江、知乎、老福特、七猫、飞卢 | 决定平台诊断和章节节奏 |
| `lengthMode` | 短篇、中篇、长篇、未知 | 决定流程跨度和产物结构 |
| `genre` | 玄幻、言情、克苏鲁、宝可梦、悬疑 | 决定题材包和世界规则 |
| `commercialMode` | off/light/strict | 决定商业审稿强度 |
| `authorSeries` | 小飞鸡、风华、天马、锅盖、lwl | 决定流程连贯性 |

### 2. 产物维度

决定“这一步产出什么”。

| 产物 | 标准名 | 例子 |
| --- | --- | --- |
| 灵感种子 | `ideaSeed` | 脑洞、词条、核心概念 |
| 书名简介 | `titleSynopsis` | 书名、标签、简介、导语 |
| 世界观 | `worldBible` | 背景、规则、势力、社会结构 |
| 角色卡 | `characterCard` | 主角、配角、反派、主角团 |
| 金手指/力量体系 | `powerSystem` | 系统、境界、技能、外挂 |
| 总纲 | `plotOutline` | 大纲、三幕式、起承转合 |
| 细纲 | `detailedOutline` | 十章细纲、卷纲、阶段规划 |
| 章纲/分镜 | `chapterPlan` | 场景、剧情点、章节梗概 |
| 写前 brief | `writingBrief` | 本章任务、人物状态、结尾点 |
| 正文 | `draft` | 章节正文、续写、扩写 |
| 审稿报告 | `reviewReport` | blocking、问题、证据、建议 |
| 精修补丁 | `polishPatch` | 去 AI 味、局部改写、替换句式 |
| 拆书卡 | `skillCard` | 文风卡、节奏卡、钩子卡 |

### 3. 能力维度

决定“这条资产会改变什么能力”。

| 能力 | 标准名 | 作用 |
| --- | --- | --- |
| 文风 | `styleVoice` | 句式、口吻、叙述密度 |
| 节奏 | `pacing` | 快慢、段落、信息释放 |
| 钩子 | `hook` | 章首、章末、付费点 |
| 对白 | `dialogue` | 意图冲突、信息隐藏、关系推进 |
| 动作链 | `actionChain` | 场景动作、转场、身体反应 |
| 情绪拉扯 | `emotionTension` | 误会、压抑、爆发、缓冲 |
| 爽点循环 | `payoffLoop` | 铺垫、释放、反应、承接 |
| 去 AI 味 | `antiAI` | 解释感、模板词、机械句式 |
| 连续性 | `continuity` | 时间线、设定、人物状态 |
| 商业可读性 | `commercialReadability` | 完读、追读、付费、转化 |

### 4. 控制层维度

决定“能不能随便叠加或切换”。

| 层级 | 标准名 | 切换规则 |
| --- | --- | --- |
| Canon | `canon` | 世界观、角色、大纲，切换成本高 |
| Flow | `flow` | 作者系列流程，步骤边界可切 |
| Overlay | `overlay` | 文风、节奏、钩子，可按章叠加 |
| Diagnostic | `diagnostic` | 审稿、平台诊断，可并行 |
| Utility | `utility` | 脑洞、取名、简介，临时调用 |

## 拆分规则

### 规则 1：原始提示词不拆，产品能力要拆

原始提示词作为 `Raw Prompt Asset` 保留完整，便于内部追溯、授权记录、白标清洗和评分。

内部拆成：

- `Capability Unit`：能完成一个独立任务的能力。
- `Output Artifact`：这一步真正写入项目的产物。
- `Step Variant`：同一步内部的模式选择。

### 规则 2：跨生命周期产物必须拆

如果一条提示词同时生成多个生命周期不同的产物，要拆成多个能力单元。

例子：

- 脑洞 + 世界观：拆成 `ideaSeed` 和 `worldBibleSeed`。
- 书名 + 简介 + 正文：拆成 `titleSynopsis` 和 `draft`，放进短篇流程。
- 角色 + 大纲：拆成 `characterCard` 和 `plotOutline`。
- 正文 + 去 AI 味：拆成 `draft` 和 `polishPatch`，允许分步执行。

### 规则 3：同一步多方向不一定拆成 Skill

如果只是同一步内部的选择，做成 `Step Variant`。

例子：

- 小飞鸡五个脑洞：不是五张 Skill，而是 `ideation` 步骤输出 5 个候选。
- 小飞鸡角色卡：主角/重要配角/次要配角是角色步骤变体。
- 小飞鸡细纲：开书模式/循环模式是细纲步骤变体。
- 小飞鸡正文风格 A-F：是正文步骤变体，不是六张主流程卡。
- 男频/女频书名公式：是书名步骤变体。

### 规则 4：能独立复用才拆成 Skill Card

只有满足以下条件才做成独立 Skill：

- 用户能单独理解它的用途。
- 它能在多个流程中复用。
- 它有稳定输入输出。
- 它不会破坏当前 canon。

适合拆成 Skill：

- 去 AI 味精修。
- 章末钩子增强。
- 对话情绪拉扯。
- 世界观生成工具。
- 角色卡生成工具。
- 黄金三章诊断。

不适合拆成独立 Skill：

- 某流程第三步里专属的正文直出。
- 强依赖前一步输出的私有化节点。
- 只在作者流程内部成立的过渡提示词。

### 规则 5：混合提示词先归主产物，再标副能力

一条提示词可能包含很多维度，但必须有主产物。

例子：

| 提示词类型 | 主产物 | 副能力 |
| --- | --- | --- |
| 长篇正文 | `draft` | styleVoice、hook、continuity、antiAI |
| 长篇细纲 | `detailedOutline` | pacing、hook、payoffLoop |
| 世界观 | `worldBible` | genre、powerSystem、continuity |
| 角色卡 | `characterCard` | emotionTension、dialogue、plot |
| 短篇第三步 | `draft` | titleSynopsis、hook、platform |

产品展示只显示主产物，内部路由使用副能力。

## 管理流程

### Step 1：资产入库

记录原始资产：

- 来源：built-in / square / private / creative / user。
- 授权与白标：free / paid-candidate / authorized-custom-needs-sanitization / runtime-ready。
- 作者系列。
- 原始分类。
- 原文路径。

### Step 2：能力切片

把每条提示词拆成 1-N 个 Capability Unit：

- `unitId`
- `primaryArtifact`
- `capabilityTags`
- `controlLayer`
- `inputRequired`
- `outputShape`
- `qualityGate`

### Step 3：产物归一

把不同叫法统一到标准产物。

例如：

- 章节梗概、分镜、章纲 -> `chapterPlan`
- 背景、设定、世界规则 -> `worldBible`
- 润色、改稿、去 AI 味 -> `polishPatch`
- 拆文、拆书、破解爆款 -> `skillCard` 或 `reviewReport`

### Step 4：主版本选择

同类能力按以下顺序选主版本：

1. 已授权并完成必要白标清洗。
2. 质量高。
3. 与当前 Skill Series Flow 连贯。
4. 与目标平台/题材/篇幅匹配。
5. 输出稳定可验证。

可用定制质量高于广场时，定制做主版本；广场做免费入口或降级方案。

### Step 5：流程编排

把能力单元挂进：

- 内置 Agent 对话：脑洞、取名、简介。
- Skill Series Flow：作者连续流程。
- Genre Pack：题材规则。
- Platform Dimension：发布平台诊断。
- Skill Stack：正文/审稿/精修叠加能力。

## 对现有流程的重构建议

### 1. 开书 Agent

统一管理：

- `platform`
- `lengthMode`
- `genre`
- `ideaSeed`
- `titleSynopsis`
- `authorSeries`

脑洞、灵感、取名默认内置在对话里，不暴露为复杂菜单。

### 2. 架构设定

统一管理：

- `worldBible`
- `characterCard`
- `powerSystem`
- `plotOutline`
- `detailedOutline`

这些进入 canon，切换需要一致性检查。

### 3. 章节规划

统一管理：

- `chapterPlan`
- `writingBrief`
- `hook`
- `payoffLoop`
- `pacing`

章纲、分镜、章节梗概都收敛到同一个板块，只是不同输出密度。

### 4. 正文与精修

统一管理：

- `draft`
- `styleVoice`
- `dialogue`
- `actionChain`
- `antiAI`
- `polishPatch`

正文阶段允许叠加拆书卡，但不允许改 canon。

### 5. 审稿与发布

统一管理：

- `reviewReport`
- `continuity`
- `commercialReadability`
- `platformFit`
- `blocking`

审稿是诊断层，可并行调用不同维度，不应变成作者风格。

## 数据模型建议

```ts
type PromptControlLayer = 'canon' | 'flow' | 'overlay' | 'diagnostic' | 'utility';

type PromptOutputArtifact =
  | 'ideaSeed'
  | 'titleSynopsis'
  | 'worldBible'
  | 'characterCard'
  | 'powerSystem'
  | 'plotOutline'
  | 'detailedOutline'
  | 'chapterPlan'
  | 'writingBrief'
  | 'draft'
  | 'reviewReport'
  | 'polishPatch'
  | 'skillCard';

interface PromptCapabilityUnit {
  id: string;
  sourceAssetId: string;
  name: string;
  primaryArtifact: PromptOutputArtifact;
  capabilityTags: string[];
  controlLayer: PromptControlLayer;
  inputRequired: string[];
  outputShape: 'json' | 'markdown' | 'plain-text' | 'mixed';
  qualityGate: string;
  accessTier: 'free' | 'paid-candidate' | 'authorized-custom' | 'built-in';
  sanitizationStatus: 'raw' | 'needs-sanitization' | 'sanitized' | 'runtime-ready';
  status: 'research' | 'candidate' | 'active' | 'deprecated';
}
```

## 验收标准

- 每条原始提示词都能映射到至少一个 `Capability Unit`。
- 每个 `Capability Unit` 必须有唯一主产物。
- 复合提示词能拆出子能力，但原始资产不丢失。
- 多分支提示词优先成为 `Step Variant`，不制造大量用户可见 Skill。
- 用户在产品里看到的是“下一步动作”和“当前产物”，不是维度矩阵。
