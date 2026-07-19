# ljg-skills To Lingshu And InkFlow Research Plan

**推荐方向**

不要全量安装 `lijigang/ljg-skills`，也不要把 `ljg-*` 原样变成 InkFlow 内置能力。它最有价值的部分是三类可迁移模式：`伴读/资料理解`、`内容铸卡/视觉表达`、`概念深钻/问答链`。这些模式应该被转译为两条线：一条进入通用 agent skill 体系，帮助 Codex/Claude 更好地研究、规划和表达；另一条进入灵枢/InkFlow 产品设计，强化资料包续写、拆书成 Skill、Skill 地图和故事方案卡的体验。

## 研究依据

| Source | Useful pattern | Adaptation | Risk |
|---|---|---|---|
| `ljg-skills` README | 仓库按单技能 + 工作流组织，支持全量/单个安装，也区分 Org-mode 与 Markdown 分支 | 我们只做研究映射，不全量安装；优先参考 Markdown/通用表达，避免 Org/Denote 绑定 | 个人工作流很强，直接装会污染当前工程协作习惯 |
| `skills/ljg-card` | 把内容转成多种视觉模具：长图、信息图、多卡、视觉笔记、漫画、白板、大字卡 | 映射到 InkFlow：故事方案卡、Skill 卡、资料包摘要卡、拆书证据卡；先借鉴“模具化”，不引入 Playwright 依赖 | 视觉实现重、依赖截图工具；不适合马上进核心功能 |
| `skills/ljg-read` | 伴读不是代读：结构地图、段落角色、逐段推进、深度提问、读后一句话 | 映射到灵枢：资料包理解/续写前审读；映射到 InkFlow：上传资料后先生成“结构地图 + 冲突问题 + 续写缺口” | 原 skill 偏中英伴读和 Org 输出，需要改成产品内结构化 JSON |
| `skills/ljg-learn` | 八维概念解剖：历史、辩证、现象、语言、形式、存在、美感、元反思 | 映射到通用 skill：可和 `eight-knife-thinking` 去重融合；映射到灵枢：作品设定概念的深度解释 | 与现有八刀法重叠高，不应新增重复 skill |
| `skills/ljg-think` | 纵向深钻：只向下追问，不横向铺开，直到不可再分的底层结构 | 映射到灵枢：设定冲突、主题母题、人物动机的“追本”模式 | 风格很强，容易变成表达表演；需要工程化成检查表 |
| `skills/ljg-qa` | 把文本抽成 Q-A 链，Q 切要害，A 包含结论/形式化/步骤/边界 | 映射到 InkFlow：拆书产物不只给摘要，而是生成“作者方法 Q-A 链”和可装备 Skill 的证据链 | 需要防止生成 FAQ；必须有输出质检 |
| `skills/ljg-skill-map` | 扫描已安装技能，按类别生成技能地图 | 映射到 InkFlow Skill 仓库：用户能看见自己的技能能力版图、空缺维度、可融合路径 | 不能只做静态列表，要和现有 Skill 权重/融合/反馈数据联动 |

## 与我们现有系统的映射

| ljg 模式 | 我们已有位置 | 建议落点 |
|---|---|---|
| 伴读/结构地图 | `docs/superpowers/plans/2026-05-15-continuation-pack-writing.md`、`WorldBibleView`、`ContinuationPack` | 资料包解析后新增“结构地图/续写缺口/冲突问题”三个字段 |
| 内容铸卡 | `StoryCardDeck`、`StoryCardPreview`、`SkillsStudioView`、`BookFactoryView` | 统一卡片产物语言：故事方向卡、资料包卡、Skill 卡、证据卡 |
| 概念解剖 | `eight-knife-thinking`、`source-command-think/deep` | 不新建重复 skill；把“纵向深钻”和“八维切面”作为八刀法参考增强 |
| Q-A 链 | `BookFactoryView`、`book-skill-evidence`、`SkillDetailDrawer` | 拆书结果增加“方法问题链”，帮助用户理解这张 Skill 为什么成立 |
| 技能地图 | `SkillsStudioView`、`SkillLoadoutBoard`、`SkillFusionWorkbench` | 新增 Skill Map 视图：能力类别、装配状态、融合建议、偏好反馈 |
| 写作质检 | `prompt-reliability-engineering`、`manualAudit`、`ProductionRunReview` | 借鉴“口语检验/AI 痕迹过滤/边界检验”，转成审计检查项 |

## 实施阶段

### Phase 1: 建立 ljg-skills 研究卡片

**目标**：把外部 skill 从“看起来很酷”变成可评价的模式卡。

**Files**

- Create: `docs/research/ljg-skills-source-cards.md`
- Read: `docs/superpowers/plans/2026-05-15-continuation-pack-writing.md`
- Read: `docs/superpowers/specs/2026-05-13-book-to-skill-deck-design.md`
- Read: `docs/superpowers/specs/2026-05-12-reference-architecture-and-prompt-layering-design.md`

**内容要求**

每个候选 source card 包含：

- 原 skill 名称
- 原始触发场景
- 可借鉴模式
- 不可照搬部分
- 映射到 InkFlow 的文件/功能
- 是否值得变成通用 skill
- 是否值得变成产品功能

**验证**

- 每个 source card 必须有 `Borrow` 和 `Reject`。
- 不得复制外部大段提示词正文。
- 每条映射必须指向 InkFlow 已有模块或计划文档。

### Phase 2: 优化通用 skill 体系

**目标**：只吸收通用方法，不制造重复 skill。

**Files**

- Modify: `/Users/Zhuanz/Documents/codex/.agents/skills/eight-knife-thinking/SKILL.md`
- Modify: `/Users/Zhuanz/Documents/codex/.agents/skills/research-to-plan-workflow/SKILL.md`
- Modify: `/Users/Zhuanz/Documents/codex/.agents/skills/prompt-reliability-engineering/SKILL.md`
- Optional Create: `/Users/Zhuanz/Documents/codex/.agents/skills/content-to-card-pattern/SKILL.md`

**建议**

1. `eight-knife-thinking`
   - 借鉴 `ljg-learn` 的八维结构，但不复制。
   - 增加一条“不要横向堆材料，必须收束成一句可用洞见”。

2. `research-to-plan-workflow`
   - 增加“外部 skill 研究不是安装清单，而是模式迁移清单”。
   - 研究输出必须包含 `Borrow / Reject / Map / Risk`。

3. `prompt-reliability-engineering`
   - 借鉴 `ljg-qa` 的“结论 / 形式化 / 步骤 / 边界”作为 AI 输出质检结构。
   - 用于审计 prompt，不用于所有写作 prompt。

4. `content-to-card-pattern`
   - 只有在我们反复需要“内容转卡片/视觉卡片/摘要卡”时才新建。
   - 先不要创建，等 InkFlow 里至少两个卡片场景稳定后再沉淀。

**验证**

- 不新增和 `eight-knife-thinking` 重复的 `ljg-think` 类 skill。
- 不全量安装 `ljg-skills`。
- 用 `writing-skills` 做一次 RED-GREEN-REFACTOR，验证 agent 是否会从“照搬外部 skill”变成“提炼模式并映射本地系统”。

### Phase 3: 灵枢系统映射

**目标**：把 ljg 的内容理解能力转译为灵枢系统的“资料理解/能力沉淀/技能地图”。

**Concepts**

1. `资料伴读`
   - 来源：`ljg-read`
   - 灵枢作用：用户上传资料后，不只是总结，而是生成结构地图、关键问题、冲突点、续写缺口。

2. `方法问答链`
   - 来源：`ljg-qa`
   - 灵枢作用：拆书后生成“作者为什么这么写”的 Q-A 链，为 Skill 卡提供解释。

3. `技能地图`
   - 来源：`ljg-skill-map`
   - 灵枢作用：显示用户当前写作能力分布、缺失维度、可融合方向。

4. `内容铸卡`
   - 来源：`ljg-card`
   - 灵枢作用：把资料包、故事方向、Skill 证据做成清晰卡片，而不是长报告。

**Product Mapping**

| 灵枢能力 | InkFlow 页面 | 数据产物 |
|---|---|---|
| 资料伴读 | `资料续写 / ContinuationPackView` | `sourceMap`, `readingQuestions`, `continuationGaps` |
| 方法问答链 | `拆书工厂 / BookFactoryView` | `skillQuestionChain`, `evidenceReasoning` |
| 技能地图 | `技能仓库 / SkillsStudioView` | `skillMap`, `missingDimensions`, `fusionPaths` |
| 内容铸卡 | `故事方案卡 / Skill 卡 / 资料包卡` | 统一 card schema + source badge |

**验证**

- 每个灵枢能力必须回到一个用户动作：上传资料、拆书、装配 Skill、继续写。
- 不做独立“灵枢大屏”，避免偏离 InkFlow 主线。

### Phase 4: InkFlow 功能优化计划

**目标**：把研究结果变成 InkFlow 的三个小切口，而不是一口气改全系统。

**Cut 1: 资料包续写增强**

- Modify: `src/types.ts`
- Modify: `src/lib/continuation-pack.ts`
- Modify: `src/components/ContinuationPackView.tsx`
- Add fields:
  - `sourceMap`
  - `readingQuestions`
  - `continuationGaps`

**Borrow**

- `ljg-read` 的结构地图
- `ljg-qa` 的关键问题链

**Reject**

- Org-mode 文件输出
- 长篇伴读对话

**Validation**

- 上传世界观/大纲/人物设定后，用户能看到“该从哪里续写”和“哪些设定不能碰”。

**Cut 2: 拆书 Skill 解释增强**

- Modify: `src/lib/book-skill-evidence.ts`
- Modify: `src/lib/book-skill-aggregation.ts`
- Modify: `src/components/BookFactoryView.tsx`
- Add:
  - `methodQuestionChain`
  - `whyThisSkillWorks`

**Borrow**

- `ljg-qa` 的 Q 链
- `ljg-learn` 的压缩洞见

**Reject**

- 不做长文分析报告
- 不把拆书结果变成泛泛读后感

**Validation**

- 每张 Skill 卡都能回答：它从哪些证据来、解决什么写作问题、不能用于什么场景。

**Cut 3: Skill 地图**

- Modify: `src/components/SkillsStudioView.tsx`
- Create: `src/components/skills/SkillMapPanel.tsx`
- Reuse:
  - `dimensionTags`
  - `usageStats`
  - `feedbackScore`
  - `mountedSkillLoadout`
  - `SkillFusionWorkbench`

**Borrow**

- `ljg-skill-map` 的“分类 + 一屏总览”

**Reject**

- 纯 ASCII 地图
- 只列名字不接使用数据

**Validation**

- 用户能一眼看见：我有什么能力、缺什么能力、哪些 Skill 值得融合。

## Scope Guard

- 不全量安装 `lijigang/ljg-skills`。
- 不复制外部 skill 的长文本、作者口吻、Denote/Org-mode 文件规范。
- 不把 `ljg-think` 和我们已有八刀法重复并列。
- 不引入 Playwright 视觉卡依赖到 InkFlow 主流程。
- 不把灵枢做成独立工具大屏；所有能力必须服务“继续写当前作品”。
- 不把 Skill 仓库变成收藏夹；Skill 必须能装配、评分、融合、反馈。

## 验证方案

1. Research validation
   - `docs/research/ljg-skills-source-cards.md` 至少覆盖 `ljg-card/read/qa/learn/think/skill-map/writes`。
   - 每个 source card 都有 `Borrow / Reject / Map / Risk`。

2. Skill validation
   - 用 `writing-skills` 验证 agent 不会建议“全量安装 ljg-skills”。
   - 验证 agent 能把外部 skill 转成模式映射，而不是照搬。

3. Product validation
   - 资料包续写：上传资料后能输出结构地图、冲突问题、续写缺口。
   - 拆书工厂：Skill 卡能展示 Q-A 式方法解释。
   - 技能仓库：Skill Map 能显示能力维度和融合建议。

4. Engineering validation
   - `npm run lint`
   - `npm run build`
   - 针对新增纯函数补 `node:test`

## 开放问题

1. `ljg-card` 的视觉卡片能力是否只作为设计参考，还是未来要做可导出的图片卡？
2. Skill Map 是放在 `SkillsStudioView` 顶部，还是作为右侧抽屉？
3. 资料包续写的“伴读问题”是否需要用户回答后才进入续写，还是只作为可选审查层？

## Source Notes

- GitHub repository: `https://github.com/lijigang/ljg-skills`
- Inspected directory: `https://github.com/lijigang/ljg-skills/tree/master/skills`
- Inspected raw skill files: `ljg-card`, `ljg-read`, `ljg-learn`, `ljg-think`, `ljg-qa`, `ljg-skill-map`, `ljg-writes`
- Attempted local clone with `git clone --depth 1`; GitHub SSL connection failed in this environment, so this plan uses GitHub HTML/raw file inspection as the source evidence.
