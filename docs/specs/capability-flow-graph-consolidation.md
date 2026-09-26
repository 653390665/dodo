# 规格：卡片 / 链路 / 知识图谱的收敛与联动

Labels: diagnosis, ready-for-planning
Status: 待评审（目标态已定义，迁移分批待排期）
Source: 2026-09-24 会话诊断（能力商店审计 + 链路审计 + 知识图谱审计 + 真实 provider 复测）

## 0. 一句话

**卡片、链路、图谱目前是三套并行系统：各自有模型与入口，但互不引用。** 本文定义三者的目标态与分批迁移，使「素材 → 图谱 → 写作（能力卡）」真正闭环。

## 1. 范围

- 涉及：`shared/lib/capability-manifest-catalog.ts`、`shared/lib/prompt-governance-catalog.ts`、`shared/lib/curated-product-skills.ts`、`shared/lib/public-skill-catalog.ts`、`server/helpers/writing-style-service.ts`、`server/helpers/knowledge-lineage-enrich.ts`、`server/routes/production.ts`、`server/routes/continuation.ts`、`server/helpers/story-context.ts`、`server/vector-store.ts`、`shared/lib/story-state-ledger.ts`。
- 不涉及：数据库 schema 大改（优先用现有字段/新增 JSON 字段）、Provider 接入、UI 视觉改版。

## 2. 现状诊断（全部实测，脚本见 §7）

### 2.1 卡片：四套目录、六种类型、五个装配字段

| 目录 | 数量 | 事实 |
|---|---|---|
| `listCatalogCapabilityManifests()` | 26 | technique 11 / flow 6 / diagnostic 5 / skill-card 4 |
| `PROMPT_GOVERNANCE_CATALOG` | 174 → **179**（2026-09-28） | runtime-ready 128（批次 A 口径）；candidate 46；可解析出 manifest 仅 75 |
| `CURATED_PRODUCT_SKILLS` | 18 | built-in 14 / licensed 3 / plaza 1（多数是 **technique/diagnostic**，不能装备进作品卡组） |
| `PUBLIC_SKILL_GOVERNANCE_CATALOG` / `SANITIZED_SKILL_COPIES` | 127 / 33 | 公开目录与消毒副本 |
| `ENHANCEMENT_PACKAGES` | 9 | 4 免费 + 5 付费 |

装配字段分散：`activeFlowId`、`projectSkillDeck`、`projectTechniqueIds`/`favoriteTechniqueIds`、`guardrailIds`、`sessionCardIds`，另有 legacy `mountedSkillLoadout`。

**实测证据**
- 把精选卡 `de-ai-slop-shield` 放进作品卡组 → `PROJECT_SKILL_CARD_SCOPE_INVALID`（它是 technique，不是 skill-card）。
- 空作品 writer stagePrompt = 541 字符（含 `core-slop-shield`/`core-dialogue-enhancer` 自动护栏）；
- 挂 technique `de-ai-slop-shield` 后 writer 541→634、critic 104→197（**原文命中**）；
- 挂 skill-card `deconstruct-suspense-hook` 后 planner 0→74、writer +12、critic +3（**合同摘要，非原文**）。

### 2.2 链路：57% 步骤是空壳，质量门只是文本

```
6 条链路 / 30 步 / 可运行 16（53.3%）/ 显式「仅引导」14（46.7%）/ 不可用 0 / 静默壳 0（2026-09-28 追补后）
```

| 链路 | 步数 | 可运行 | 仅引导（显式声明） |
|---|---|---|---|
| xiaofeiji-novel-flow 长篇商业连载 | 8 | 6 | 2 |
| generic-novel-flow 通用长篇 | 6 | 6 | 0（4 步复用 `generateOutline`、2 步复用 `core-slop-shield`） |
| tomato-platform-flow 番茄平台 | 5 | 1 | **4** |
| book-deconstruction-flow 拆书转化 | 2 | 1 | **1** |
| fenghua-short-flow 风华短篇 | 5 | 1 | 4 |
| tianma-outline-flow 天马大纲 | 4 | 1 | **3** |

口径：可运行 = 治理面 `isRuntimeReady && runtimeStatus === 'active' && sanitizationStatus === 'runtime-ready'`，
且正文不是引用壳（`isShellTemplatePrompt`）；14 个壳步骤已在目录显式声明 `guidanceOnly: true`（§5.4），
审计脚本断言「声明集合 == 检测到的壳集合」，静默壳 0。
订正（2026-09-25）：本表初版把 xiaofeiji 记为「5 可运行 / 3 壳」，实测为 **6 / 2**（壳总数 17 不变）；
初版按资产 `score` 推断，未按壳正文判定。
订正（2026-09-28）：番茄 / 天马 / 拆书各补 1 张自撰内置卡并改指步骤（§5.4.1）→ 可运行 13→**16**，
仅引导 17→**14**（番茄 4 / 天马 3 / 拆书 1 / 风华 4 / 小飞鸡 2）。

另三个结构问题：
1. **阶段映射偏 writer**：`stageForGovernedAsset`（`writing-style-service.ts:980`）只看资产自身 `stage`，导致"世界观/大纲"步骤也注入 writer 阶段；**已修（§5.3）：步骤显式声明阶段，实测旧口径 25/30 落 writer → 新口径 planner 18 / writer 9 / critic 3**；
2. **质量门不落地**：`step.qualityGate` 只被拼进 prompt（`buildFlowStep`，`:1029-1034`），既不参与门禁也不推进步骤；**已修（§5.2）：`gate{kind,threshold?}` + 推进拦截 + 跳过记录**；
3. **推进靠手写标签**：`PlanningTab.tsx:160-199` 写 `current-step:` / `completed-step:` 标签；只有拆书工厂能推进链路。**已修（§5.2）：标签由 `buildFlowStepAdvanceTags` 单一出口生成**。

### 2.3 知识图谱：摄入通、维护漏、长期记忆断、与链路/卡零联动

**摄入（通）**：`runLineageEnrichment`（`knowledge-lineage-enrich.ts:167`）解析资料包 `source_documents` → `foreshadowings` 台账 + `entity_relationships` 边（持有/关联/居住/公理），幂等。
触发点：CLI、`approve-import`、`sync-to-world`、每章 apply 后（`production.ts:1708`）。

**维护（漏）**
- 只增不删/不更新：边命中即跳过（描述变化不更新、旧边不清理）；
- 章节删除/回退无补偿，台账 `payoff` 状态不回滚（**2026-09-26 已修**：知识行记 `source_version`，章节删除触发
  `stale` 标记（只打标不删除、可查询），见 §5.7）；
- 覆盖度报告 `LineageReport.coverage` 只有 CLI 打印，**UI/埋点零消费**（**2026-09-26 已修**：可由
  `POST /api/novels/:id/knowledge-capabilities/knowledge-extract/run` 取回，并在 World Bible 图谱页九项数值面板展示，见 §5.6）；
- 无“从资料包重跑/补齐”界面入口（**2026-09-26 已修**：`KnowledgeMaintenancePanel` 一键重跑，幂等且失败零写入，见 §5.6）。

**长期记忆（断）**
- `vector_chunks` RAG 只用于搜索路由与编辑器快速通道/审稿（`story-context.ts`），**`runProductionPipeline` 完全不用 RAG**（**2026-09-27 已修**：生产管线按章注入语义检索片段，单源复用与降级语义见 §5.8）；
- 生产管线只靠 `story-state-ledger` 的近期窗口（2–5 章）+ 实体/伏笔上限（4–12）；
- 无跨章摘要/压缩 → 长篇中后段记忆衰减。

**与链路/卡的联动（零）**（**2026-09-25 订正**：卡面已连通，见 §5.5）
- 26 张能力 manifest 中 **0 张**涉及知识/图谱/伏笔/谱系（grep 零命中）→ 现 **28 张，其中 2 张是知识卡**
  （`knowledge-extract` / `foreshadow-settle`，可装配、可解析、可执行；不注入写作提示是设计语义）；
- 30 个链路步骤中 **0 步**是知识抽取或伏笔核对（仍为 0，待批次 C 第 4 条）；
- 图谱更新只由后台 hook 触发，用户无法用卡或链路步骤建图/修图 → 卡与运行 API（§5.5）与 UI 重跑入口（§5.6）已就绪，
  链路步骤待做。

## 3. 根因

> 三套系统各自演进，**没有共享的"能力/步骤"契约**：链路步骤写死治理资产 id，卡片装配字段各自为政，图谱只有后台 hook。结果是"素材→图谱→写作"之间缺少可编排的引用关系。

## 4. 目标态模型

### 4.1 链路（Flow）= 顺序 + 质量门

```ts
interface FlowStep {
  id: string;
  name: string;
  cardRef: { role: CardRole; stages: CapabilityStage[]; cardId?: string }; // 取代写死的 assetId
  input: string;
  output: string;
  gate: { kind: 'mechanical' | 'critic' | 'manual'; threshold?: number };   // 取代纯文本 qualityGate
  nextStepId?: string;
  navigateTo?: string;
}
```

### 4.2 卡（Card）= 原子能力

对外只保留一个"角色"维度，它同时决定作用域、阶段与注入语义：

| role | 注入语义 | 典型作用域 |
|---|---|---|
| `rule`（规则约束） | **原文**注入对应阶段 prompt | project / chapter |
| `transform`（转换预览） | 单次运行，产出候选/预览 | chapter / single-run |
| `diagnostic`（诊断报告） | 单次运行，产出报告 | single-run |
| `guardrail`（自动护栏） | 自动常驻注入 | system / project |

装配字段收敛为三个：`projectCards[]`、`chapterCards[]`、`singleRunCard`。
`technique` / `skill-card` / `utility` 等旧 kind 保留为**读取兼容层**，写入一律走新模型。

已落地的投影（`shared/lib/capability-card-role.ts`，批次 A 小类「统一角色投影」）：

| 旧输入 | 投影 |
|---|---|
| `kind=guardrail` | `guardrail` |
| `kind=diagnostic` | `diagnostic` |
| `kind=utility` | `transform` |
| `kind=technique` + `output=transform-preview` | `transform` |
| `kind=technique`（其余，含 7 张 project 级 `outline-candidate`/`artifact-candidate` 技法） | `rule` |
| `kind=skill-card` / legacy `role-skill` / `overlay` | `rule` |
| `kind=flow` | `null`（链路层不是卡） |
| 治理货架 `primaryCategory`：`quality-guardrail` / `platform-criteria` / `utility-tool` / `author-workflow`+`constellation-pack`+`style-reference` | `guardrail` / `diagnostic` / `transform` / `rule` |
| 未知 kind 或未知分类 | `null`（不静默兜底，由覆盖度断言显式登记） |

保守决策说明：`output=outline-candidate`/`artifact-candidate` 的 project 技法（`bible-world-builder`、
`refine-outline-rebuild`、`opening-gold-three` 等 7 张）当前确实以**原文常驻注入** project 阶段，
批次 A 不改变运行时行为，故投影为 `rule`；其真实产出语义（是否应转 `transform` 单次运行）留待批次 B 卡槽位落地后复审。

实践证明：20 张非 flow manifest + 174 张治理资产 → **0 未映射**（`scratch/card-role-coverage.ts`，2026-09-24；
2026-09-28 治理资产 179 张复测仍 0 未映射）。

#### 4.2.2 装配字段收敛（批次 A 小类「装配字段收敛」）

装配读取此前有**四条**互不知情的路径：作品卡组（`projectSkillDeck`）、随 Novel 的旧
`mountedSkillLoadout` / `mountedSkillIds`、章节态 `chapter.workflowMeta.capabilityState`、请求期
`sessionCardIds`。现新增三字段并单源化读取：

| 新字段 | 作用域 | 缺省读取来源（逐项复刻旧优先级） |
|---|---|---|
| `ProjectCapabilityProfile.projectCards` | 作品 | 卡组（主卡 + 辅卡，去重）→ 挂载槽按 `slot` 升序 → `novel.mountedSkillIds` |
| `ProjectCapabilityProfile.chapterCards` | 章节 | `chapter.workflowMeta.capabilityState.techniqueIds + overlayCardIds` |
| `ProjectCapabilityProfile.singleRunCard` | 单次运行 | `sessionCardIds[0]` |

- 唯一事实源 `shared/lib/capability-assembly.ts`：`resolveProjectCards` / `resolveChapterCards` /
  `resolveSingleRunCard` / `resolveCapabilityAssembly` / `getProjectDeckCardIds`（卡组规则单源，
  `src/lib/skills-studio-governance.ts:getProjectDeckIds` 改为委托）/ `migrateCapabilityAssembly`。
- 语义：**新字段声明即权威**（含显式空数组 0 张，不回退旧字段）；缺省时按上表回退。旧字段保留读取兼容，
  写入一律走新字段。
- 迁移：`migrateCapabilityAssembly` 只补 `projectCards`，且**旧装配为空时不写入**（避免显式空数组
  永久盖住后续旧字段写入）；写入值按新字段语义归一（去空白、去重）→ 重复执行 `changed=false`（幂等）。
  迁移挂在 `server/routes/writing-style.ts` apply 路由事务内（`capabilityProfile: assembledProfile ?? requestedProfile`）。
- 章节态 / `sessionCardIds` **不迁移**：落进作品 profile 会擅自扩大作用域（不捏造）。
- `mountedSkillIds`、`mountedSkillLoadout`（`shared/types/novel.ts`）与
  `SkillLoadoutMigrationInput.mountedSkillLoadout`（`shared/lib/skill-model.ts`）已加 `@deprecated`
  JSDoc，指向 `capability-assembly`。
- 归一化：`normalizeCapabilityProfile` 三段 `...(source.X !== undefined ? {…} : {})`，保留「未声明 vs
  显式空数组」区分；`validateCapabilityProfile` 增 `CAPABILITY_PROJECT_CARDS_INVALID` /
  `CAPABILITY_CHAPTER_CARDS_INVALID` / `CAPABILITY_SINGLE_RUN_CARD_INVALID` 类型校验；
  `src/lib/skills-studio-governance.ts:getProjectCapabilityProfile`（净化投影）同步带出三字段，
  否则声明即权威的读取路径看不到它们。

证据（2026-09-24/25）：`tests/capability-assembly.test.ts` 9/9（迁移等价 fixture×3、空装配不写显式空数组、
重复/空白归一为固定点、新字段权威、chapter/singleRun 合并且不捏造、卡组规则单源、写路径归一化保留声明语义、
deprecated 源码断言）；`src/tests/capability-card-count.test.ts` 5/5；`node --test tests/capability-assembly.test.ts tests/writing-style*.test.ts`
60/60；`src/tests/plan158-frontend-cleanup.test.ts` + `skills-studio-plan158-governance.test.ts` 20/20（含
`getProjectDeckIds(getProjectCapabilityProfile(novel))` 字面量钉子）；`npx tsc --noEmit` 0、`npm run lint` 0；
`npm test` 全量 0（86s）。

#### 4.2.3 装配三字段运行时接线（P0-①，2026-09-28）

批次 A 只落地了「读写单源」，三字段在运行时**无消费点**（`projectCards` / `chapterCards` / `singleRunCard`
仅被校验与 UI 计数读取）——这是审查认定的 P0-①。本轮把声明接到既有三通道，**只增不改**：

| 字段 | 接线点 | 语义 |
|---|---|---|
| `projectCards` | `resolveProjectSkillDeck`（卡组）/ `resolveProjectTechniquePlan`（技法）/ `buildGuardrails`（护栏） | 按 manifest `kind` + 治理 `primaryCategory` 分流；声明项追加在旧字段之后，不替换旧字段 |
| `chapterCards` | `resolveChapterCapabilityState(novelId, chapterId, generation, declaredChapterCards)` | 仅当带 `chapterId` 生效；technique → `techniqueIds`，skill-card/overlay → `overlayCardIds` |
| `singleRunCard` | `resolveWritingStyleRequest` 的 `combinedSessionCardIds` | 请求未显式给 `sessionCardIds` 时作为回退（显式数组含空数组优先） |

- 分流单源 `shared/lib/capability-assembly.ts`：`assemblyChannelForKind` / `assemblyChannelForCard` /
  `projectCardsByChannel(ids, cardOf)`。`assemblyChannelForCard` 先看 `primaryCategory === 'quality-guardrail'`
  再看 `kind`——**货架 quality-guardrail 资产的 manifest kind 是 `technique`**（目录兜底派生），只看 kind
  会把护栏卡误投技法通道（实测 `de-ai-tells-guard`、`private-100` 均如此）。
- 无 manifest 的 id 归卡组面（与旧 `mountedSkillIds` 的可解析语义一致）；`kind` 可归但不在四类内的（如 `flow`）
  忽略。卡组面仍走原有严格校验（无 `kind=skill-card` + project scope 会 400），不在本轮放宽。
- `chapterCards` 采用**宽松语义**：解析不到 / 缺 `chapter` scope / 非 `active` 的 id 一律忽略、不阻断请求，
  且跳过 stored-version 校验（声明项没有落库版本可对照）。理由：该字段此前完全惰性，存量值可能是任意 id，
  严格模式会把「从未生效的休眠字段」变成全量 400 回归。
- 证据（2026-09-28）：`tests/capability-assembly-runtime.test.ts` 8/8（基线三通道逐项不变 / 卡组面成主卡 /
  技法面加长 writer 提示词 / 护栏面与旧 `guardrailIds` 并存 / chapterCards 章节作用域 / 治理货架能力卡经本章
  使用卡解析 / singleRunCard 回退与显式空数组优先 / 无效 id 宽松忽略）；`tests/capability-assembly.test.ts` 11/11
  （新增分流单测：quality-guardrail 分类优先级、无 manifest 归 deck、`flow` 忽略、未声明不分流）；
  定向 4 文件 61/61；`npx tsc --noEmit` 0；`npx eslint … --max-warnings=0` 0；六场景 stagePrompts 快照
  **逐项哈希不变**（`bare e3b0c442/a911161f/af2071af`、`technique 4ee5c756/9a6bf48b`、`deck ad15f102/35a46c6f/f73b1f25`、
  `flow-shield 0e7ffd52`、`flow-outline 697f7556/92`、`flow-square 5dde5c7b/59`）——未声明即零行为变化。
- 残余：三字段仍**无界面写入口**（只能经 profile 写入，UI 计数可读）；`chapterCards` 声明项不写回
  `chapter.workflowMeta.capabilityState`（作用域不放大）；护栏通道的「假控制」问题（core-default 护栏无条件
  注入，配置既有护栏 id 无净增）属 P0-②，未在本轮处理。

#### 4.2.1 目录生成单源与新鲜度（批次 A 小类「目录生成与新鲜度」）

`shared/lib/public-skill-catalog.ts`（7158 行）是生成物；生成规则此前存在**三份拷贝**：生成脚本
`scripts/generate-public-catalog.ts` 内部一套，以及两个守卫测试里手工镜像的 ~300 行纯函数
（脚本文件末尾 `generate()` import 即执行，测试无法直接复用）。镜像漂移会同时造成守卫误报与漏报。
现收敛为单一事实源：

- `scripts/lib/public-catalog-pipeline.ts`：纯管线（准入 Plan 233 / 治理 Plan 258 / 消毒 / 消毒副本 /
  渲染），无 fs、无顶层副作用；Plan 234 的文案改写计数器由模块级可变状态改为显式传入
  （`createSanitizedCopyRewriteCounters()`），管线因此**可重入**（旧版同进程第二次生成会改写文案编号）。
- `scripts/generate-public-catalog.ts`：薄 CLI —— 跑管线 → 打印留痕日志 → 写盘。
- `tests/public-catalog-freshness.test.ts` / `tests/public-catalog-governance.test.ts`：同源 import，
  不再有第二份规则正文；freshness 新增文件级逐字节断言、负向篡改用例（单点改 `"score": 60` → 61
  必须比对失败并给出行号）、确定性用例（同进程两次构建 sha256 必须相同）。

证据（2026-09-24）：重构后重跑生成脚本，产物 sha256 `f01fcc2c37c3d654e464b322ec313b9742dd512c36f1fdf8b44ebeccfc792ef0`
与重构前基线一致，`git diff shared/lib/public-skill-catalog.ts` 为空（逐字节不变）；`tests/` 内重复
管线函数体 0 处；两个守卫测试 19/19 通过；`npx tsc --noEmit` 0 错误、`npm run lint` 0 问题。

### 4.3 图谱（Graph）= 卡片与链路的持久化产物 + 上下文来源

- **写**：由 `knowledge-extract` 卡（transform/rule）与链路步骤显式触发，而不是只靠后台 hook；
- **读**：作为上下文来源进入 planner/writer/critic（现有 `entity_relationships` + `foreshadowings` 通路保留）；
- **维护**：实体/边/台账带 `sourceVersion` 与 `stale` 标记；章节删除/回滚触发 stale 标记；coverage 暴露到 UI；
- **长期记忆**：RAG 检索层接入生产管线，与账本近期窗口互补。

## 5. 分批迁移

### 批次 A：模型统一（不改变运行时行为）

1. 新增 `CardRole` 与统一卡投影（旧 kind → role 的映射表）；
2. 治理货架为唯一事实源；`public-skill-catalog.ts` / `SANITIZED_SKILL_COPIES` 改为生成产物并加"新鲜度"断言；
3. 三个新装配字段读写；旧字段保留双向迁移（写入新字段，读取时合并旧字段）；
4. legacy v2 `mountedSkillLoadout` 标记 deprecated 并写迁移路径。

### 批次 B：链路升级

1. `FlowStep.cardRef` 取代 `assetId`（保留 assetId 作为 cardRef.cardId 的兼容读取）；
2. 质量门落地：`gate.kind` 绑定 `validateCompleteChapterDraftQuality` / critic 分数 / 手动确认；
3. 阶段归属按步骤语义声明，不再继承资产 stage；
4. 空壳链路处置：补正文或标记"仅引导"，`tomato/tianma/book-deconstruction` 优先。

#### 5.1 步骤卡片槽位（批次 B 小类「步骤卡片槽位」）

链路步骤此前只能引用**治理货架资产**（`assetId`）且注入阶段由资产 `stage` 推断（多数资产是
`polish` → 全部落 writer）。现步骤可声明**卡片槽位**：

```ts
SkillSeriesFlowStep.cardRef?: { role: CardRole; stages: readonly CapabilityStage[]; cardId?: string }
```

- 唯一事实源 `shared/lib/flow-step-card-slot.ts`：`CAPABILITY_STAGES`（canonical 顺序）、
  `resolveFlowStepCard(step, deps?)`、`renderFlowStepCardBlock(card, stepContract)`、
  `FLOW_STEP_CARD_WARNINGS`。deps 可注入 `findAsset` / `findManifest` / `isRejectedTemplate`
  （纯函数可测），缺省走治理货架 + 能力清单 + `isShellTemplatePrompt`。
- 优先级：**cardRef 挂卡成功 → 卡片正文进入 `stages` 声明的每个阶段**；未声明 cardRef、空槽
  （`cardId` 缺省/空串）、解析失败 → 一律回退 `assetId` 旧路径（`prompt` 与注入逐字节不变）。
- 槽位诊断（失败即回退，不阻断写作）：`FLOW_STEP_CARD_STAGES_INVALID`（stages 空/未知值/重复）、
  `FLOW_STEP_CARD_UNRESOLVED`（不在治理目录）、`FLOW_STEP_CARD_NOT_RUNTIME_READY`
  （`isRuntimeReady` / `runtimeStatus==='active'` / `sanitizationStatus==='runtime-ready'` 任一不满足）、
  `FLOW_STEP_CARD_SHELL`（壳卡）、`FLOW_STEP_CARD_ROLE_MISMATCH`。**未声明槽位与空槽不产生诊断**。
- 角色：`role` 为声明值，`projectedRole` 由目录投影（有 manifest 走 `cardRoleForManifest`，否则
  `cardRoleForGovernedCategory(asset.primaryCategory)`）；两者不一致时**仍注入**，只记
  `ROLE_MISMATCH` —— 避免「声明字段成死参数」，注入形态与角色的绑定留待「步骤阶段语义化」小类。
- 注入形态：`ExecutionFlowStep.stagePrompts?: Partial<Record<CapabilityStage, string>>`，每项为
  `` `${stepContract}\n【步骤卡：${cardId}（${role}）】\n${template}` ``；三处注入点改走
  `flowStepPromptFor(stage) = flowStep.stagePrompts?.[stage] ?? (flowStep.stage === stage ? flowStep.prompt : undefined)`
  再经 `!isShellTemplatePrompt(...)`。`flowStep.prompt` 语义**保持「资产注入文本」**（未声明阶段回退本字段，
  避免卡片正文经回退路径泄漏到未声明阶段）；`capabilityRefs` 追加卡片 id；
  `flowStep.cardId/cardRole/cardStages/cardWarning` 记录槽位声明（解析失败也保留 id + 诊断）。
- 壳判定迁移：`isShellTemplatePrompt` 由 `server/helpers/writing-style-service.ts` 迁至
  `shared/lib/prompt-shell.ts`（shared 不得反向依赖 server），原模块保留 re-export。

证据（2026-09-25）：`tests/flow-step-card-slot.test.ts` **18/18**（12 纯函数：回退/空槽/stages 非法/未解析/
非 runtime-ready/壳卡/归一化顺序/两种角色投影/不一致仍注入/自定义壳判定；6 集成：planner、writer、critic
**各一条命中用例** + 三阶段全声明进快照元数据与 `capabilityRefs` + 未挂卡 `stagePrompts` 缺省 +
挂壳卡 `square-182` 回退且三阶段 prompt 与挂卡前逐字节相等）；回归 `tests/execution-contract.test.ts` +
`tests/de-ai-tells-guard.test.ts` 0 失败；快照回归 `scratch/stageprompts-snapshot.ts` 6 场景 JSON
**前后 identical**（bare/technique/deck + `flow-shield core-slop-shield@writer(103)` writer `0e7ffd52(655)`、
`flow-outline generateOutline@writer(92)` writer `bc653778(644)`、
`flow-square square-182@writer(59)!FLOW_STEP_ASSET_SHELL` writer `991dad8f(611)`）；`npx tsc --noEmit` 0、
`npx eslint server src shared tests scripts --max-warnings=0` 0。

#### 5.2 质量门判定与推进拦截（批次 B 小类「质量门判定与推进拦截」）

此前 `step.qualityGate` 只是一段中文文案（只渲染、不判定），任何一步都能无条件推进。现步骤可声明
**可判定质量门**：

```ts
SkillSeriesFlowStep.gate?: { kind: 'mechanical' | 'critic' | 'manual'; threshold?: number }
```

- 唯一事实源 `shared/lib/flow-step-gate.ts`（纯函数、无 IO）：`FLOW_STEP_GATE_KINDS`、`FlowStepGate`、
  `FlowStepCriticSignal`、`FlowStepEvidenceCounts`（前端 stepEvidence 单一类型源）、`FlowStepGateInput`、
  `FlowStepGateEvidence`、`FlowStepGateEvaluation`、`FLOW_STEP_GATE_WARNINGS`、`resolveFlowStepGate`、
  `evaluateFlowStepGate`、`FLOW_STEP_SKIP_TAG_PREFIX`、`FLOW_STEP_SKIP_REASON_MAX`、
  `formatFlowStepSkipTag`、`parseFlowStepSkipTag`、`getNovelSkippedSteps`、`buildFlowStepAdvanceTags`。
- 判定语义（**判定源复用**：门模块只接收已分类结果，不重复实现分类）：
  - 未声明 gate → `pass` + `FLOW_STEP_GATE_UNDECLARED`（旧行为逐项不变）；
  - kind 未知 / 阈值非法 → `blocked`（不能确认就不放行）；
  - `mechanical` → 直接调 `shared/lib/draft-quality.ts:490 validateCompleteChapterDraftQuality(draftText, undefined, threshold 时 {minChars:threshold})`；
    无草稿 → `FLOW_STEP_GATE_DRAFT_MISSING` + blocked；未过门 → reasons 取 `violations.slice(0,3)`。
    证据字段口径：`mechanicalRequiredChars` 是**实际生效字符门**（声明 `threshold` 按
    `[MIN_COMPLETE_SCENE_CHARS=800, MIN_COMPLETE_CHAPTER_CHARS=4000]` 夹取，无法突破整章交付合同），
    `mechanicalScoreThreshold` 是**评分放行线 85**（`mechanicalReview.threshold`，与字符门不是一个量）。
  - `critic` → `not_run` / `unknown` / `fail` / 低于阈值 / 声明阈值却拿不到数值分数
    （`FLOW_STEP_GATE_CRITIC_SCORE_MISSING`）一律 blocked；`pass` 且达阈值 → pass。阈值口径与服务端
    `server/helpers/ai-production-pipeline.ts:32 SCORE_THRESHOLD = 80` 同源（分类仍由 server 的
    `classifyCriticFeedback` 负责）。
  - `manual` → 需显式 `confirmed === true`。
- 逃生门（跳过必须留原因、可查询）：`skipReason` 归一 `replace(/\s+/g,' ').trim().slice(0,120)`，
  **空原因不允许跳过**（`formatFlowStepSkipTag` 返回空串）；非空 → `status:'skipped'` +
  `FLOW_STEP_GATE_SKIP_RECORDED`，标签 `skipped-step:{flowId}:{stepId}:{原因}`，读口
  `getNovelSkippedSteps(novel, flowId)`。跳过**仍计入 completed**（流程不被门卡死），原因独立可查；
  不带原因地重新完成该步会清除旧跳过记录。
- 推进唯一出口：`buildFlowStepAdvanceTags(...)`（复刻旧标签语义：保留无关标签 → 追加 `completed-step:`
  → 写 `current-step:` 或 `completed-flow:`）。`src/components/book-factory/PlanningTab.tsx` 推进按钮改走它，
  门 blocked 时 `setStepError('质量门未通过：' + reasons.join('；'))` 且**不写任何标签**；UI 增
  「可判定质量门：kind（阈值 N）」状态块与「记录原因并跳过本步」按钮（`appPrompt` 收原因）。
- 门声明只加在 `generic-novel-flow` step5（output `draft`）`{kind:'mechanical'}` 与 step6
  （output `polished-draft`）`{kind:'critic',threshold:80}`；`xiaofeiji-novel-flow` 全步骤不声明门
  （既有步骤推进测试不变）。`ExecutionFlowStep` 与三阶段 prompt 渲染均未改（`【质量门】` 仍是文案）。
- 判定证据来源：`Chapter.workflowMeta.lastAudit` 增可选 `score?: number`（`shared/types/novel.ts`），
  在 `src/lib/hooks/generation/useAuditPolishActions.ts`（审稿完成）与 `server/routes/production.ts`
  （run 落库）写入；`EditorView` 的 `stepEvidence` 增 `draftText: currentChapter.content` 与
  `critic: { status: lastAudit?.status ?? 'not_run', score: lastAudit?.score }`（`AgentWorkspace` /
  `AgentWorkspaceProductionPanel` 的内联类型收敛为 `FlowStepEvidenceCounts`）。

证据（2026-09-25）：`tests/flow-step-gate.test.ts` **17/17**（未声明 / 未知 kind / 非法阈值；mechanical
无草稿、过短、合规、阈值夹取到 800；critic 全分支含分数缺失；manual；跳过空原因、归一与截断；标签往返
含原因内冒号；`getNovelSkippedSteps` 按链路过滤；旧行为复刻与清除旧记录；目录门声明面）；
`src/tests/planning-tab-step-gate.test.tsx` **7/7**（mechanical blocked 不写标签、无草稿不放行、
critic 62<80 拦下、unknown 不放行、critic 88 推进成功、空原因不跳过 + 记录原因后标签与查询回读、
未声明 gate 无 UI 且行为不变）；回归 `tests/public-catalog-freshness.test.ts` +
`tests/public-catalog-governance.test.ts` + `tests/flow-step-gate.test.ts` 合计 **36/36**、
`src/tests/planning-tab-step-gate + planning-tab-step-progression` **29/29**；公开目录重生成仅 **7 行插入**
（两处 `gate`）；`scratch/stageprompts-snapshot.ts` 三基线场景哈希与门槛改动前逐项一致（bare
`e3b0c442(0)/a911161f(541)/af2071af(104)`、technique `4ee5c756(634)/9a6bf48b(197)`、
deck `ad15f102(74)/35a46c6f(553)/f73b1f25(107)`）；`npx tsc --noEmit` 0、
`npx eslint server src shared tests scripts --max-warnings=0` 0。

#### 5.3 步骤阶段语义化（批次 B 小类「步骤阶段语义化」）

问题（§2.2）：链路步骤此前**没有自己的阶段声明**，注入阶段由关联资产的 `stage` 推断
（`polish`/`drafting` → writer、`planning` → planner、`review` → critic）。六条链路 30 步里
**25 步落 writer、5 步落 planner、0 步落 critic**（`scratch/flow-audit.ts` 旧口径实测）——
「灵感/设定/大纲/分镜」类步骤的契约文本进了写手 prompt，而平台评分卡（动作=评估）也进了 writer。

改法：步骤显式声明目标阶段，**声明优先、不再继承资产 stage**。

- 类型：`SkillSeriesFlowStep.stage?: CapabilityStage`（`shared/types/prompt-assets-governed.ts`）；
  `ExecutionFlowStep` 增 `stageSource?: 'declared'|'asset-fallback'|'none'` 与 `stageWarning?: string`。
- 单一事实源 `shared/lib/flow-step-stage.ts`（纯函数、无 IO）：`FLOW_STEP_STAGES`、
  `FLOW_STEP_STAGE_SOURCES`、`FLOW_STEP_STAGE_WARNINGS`（`…_UNDECLARED` / `…_INVALID`）、
  `FLOW_STEP_STAGE_CLASSES`（planning/drafting/review）、`FLOW_OUTPUT_STAGE_CLASS`（覆盖目录全部
  24 个 `step.output`）、`stageClassForFlowOutput`、`stageForFlowOutput`、`resolveFlowStepStage`
  （声明优先；未声明 → 回退资产 stage + `UNDECLARED`；非法声明 → 阶段 null + `INVALID`，不猜）、
  `stageDistributionOfFlows`（分布 + 语义交叉核对）。
- 语义类与阶段：planning→planner、drafting→writer、review→critic。**输出名不等于动作性质**：
  `chapters-final`（番茄第 5 步精修改稿）→ drafting/writer；`chapters-final-checked`（完读自检）→
  review/critic；`chapters-with-highlights`（爽点显露节奏评估）→ review/critic；
  `polished-draft`（去 AI 腔成稿动作）→ drafting/writer。
- 目录声明：`shared/lib/prompt-governance-catalog.ts` 六条链路 **30/30** 步补 `stage`
  （新增 30 行 + 4 条注释）→ **planner 18 / writer 9 / critic 3**；`generic-novel-flow` step5/step6
  与 `xiaofeiji` step6-8、`tomato` step2/step5、`fenghua` step4/step5 落 writer；`tomato` step1/3/4 落
  critic（诊断/自检/节奏评估，此前因资产是 `polish` 全落 writer）。
- 运行时：`server/helpers/writing-style-service.ts` 的 `buildFlowStep` 改调
  `resolveFlowStepStage(step, { assetStage: asset ? stageForGovernedAsset(asset) : null })`，写
  `stage` + `stageSource`（+ 诊断 `stageWarning`）；`stageForGovernedAsset` 保留为**唯一回退**路径。
  注入面 `flowStepPromptFor(stage)` 不变（`stagePrompts[stage] ?? (stage === 声明阶段 ? prompt : undefined)`），
  因此**步骤契约文本一字未改，只是换了去向**。
- 产物：公开目录重生成 `shared/lib/public-skill-catalog.ts` 仅 **+30 行**（30 个 `stage`，无其他漂移）。

证据（2026-09-25）：

| 验收 | 证据 | 结论 |
| --- | --- | --- |
| 大纲→planner、正文→writer、审稿→critic | `tests/flow-step-stage.test.ts` 集成用例：六条链路 30/30 步逐一 `resolveProjectExecutionContract`，断言 `flowStep.stage === step.stage`、`stageSource === 'declared'`，且步骤标记 `【流程步骤：<name>】` 只出现在声明阶段（另两阶段必须不含） | 通过（30/30） |
| 六条链路无一步因映射变更丢 prompt | 同测试 30/30 覆盖 + 快照：`flow-outline`(generic step1) 步骤 prompt 长度 92→92、`flow-square`(xiaofeiji step1) 59→59、`flow-shield`(generic step5) 103→103；仅**去向**从 writer 迁到声明阶段（flow-outline writer 644→planner 101；flow-square writer 611→planner 68），bare/technique/deck 与 flow-shield 哈希逐项不变 | 通过 |
| flow-audit 分布与声明一致 | `node --import tsx scratch/flow-audit.ts`：30 步 / 6 链路，`declared=30`、`fallback=0`、`invalid=0`，分布 planner 18 / writer 9 / critic 3（与语义类 `{planning:18, drafting:9, review:3}` 一致），自校验「打印直方图 == `stageDistributionOfFlows`」PASS、语义不一致 0、未知输出 0、未声明 0 | 通过 |

回归：`npx tsc --noEmit` **0**；`npx eslint server src shared tests scripts --max-warnings=0` **0**；
定向后端 8 文件 **97/97**（flow-step-stage / execution-contract / flow-step-card-slot / flow-step-gate /
public-catalog-freshness / public-catalog-governance / prompt-assets-governed / book-deconstruction-flow）；
前端 `planning-tab-step-progression + planning-tab-step-gate` **29/29**；全量 `npm test`
**1339/1339（FULL_EXIT=0，120s，较上一小类 1332 增 7 条）**。

残余（不在本小类验收面，登记不静默丢弃）：§5.1 曾把「注入形态与角色的绑定（`cardRef.role` 与
`FlowStepCardRef.stages` 的形态差异）」留给本小类——本小类验收只覆盖**阶段声明**，该绑定尚未落地
（仓内 30 步目前均无 `cardRef`，机制与测试已在 §5.1 就绪，待批次 B 后续挂卡时一并做）；
`FLOW_STEP_STAGE_UNDECLARED` / `…_INVALID` 两条回退/防御分支在仓内 0 触发（为外部/旧目录/生成物保留）。

#### 5.4 空壳链路清账（批次 B 小类「空壳链路清账」）

任务：对 17 个壳卡步骤「能补正文的补，不能补的显式标注为仅引导」；flow-audit 复跑给出占比。

落地：
- 类型：`SkillSeriesFlowStep.guidanceOnly?: boolean`（`shared/types/prompt-assets-governed.ts`）；
  `ExecutionFlowStep` 增 `availability?: 'asset'|'guidance'|'unavailable'`、`guidanceOnly?: boolean`、
  `guidanceWarning?: string`（`shared/types/capability-execution.ts`）。
- 纯函数模块 `shared/lib/flow-step-guidance.ts`：`FLOW_STEP_AVAILABILITIES`、
  `FLOW_STEP_GUIDANCE_WARNINGS = ['FLOW_STEP_GUIDANCE_UNDECLARED_SHELL','FLOW_STEP_GUIDANCE_WITH_RUNNABLE_ASSET']`、
  `GUIDANCE_ONLY_LABEL = '仅引导'`、`GUIDANCE_ONLY_HINT`、
  `resolveFlowStepAvailability({guidanceOnly, assetRunnable, assetIsShell})`（声明→`guidance`；未声明+壳→`unavailable`
  + UNDECLARED_SHELL；声明+真资产→`guidance` + WITH_RUNNABLE_ASSET；未声明+可运行→`asset`）、
  `summarizeFlowStepAvailabilities`、`runnableStepRatio`。
- 目录：`shared/lib/prompt-governance-catalog.ts` 17 处 `guidanceOnly: true`（xiaofeiji step1/step3、
  tomato 全 5 步、book-deconstruction 2 步、fenghua step1/2/3/5、tianma step1–4）；
  生成物 `shared/lib/public-skill-catalog.ts` +54 行（17 条 `"guidanceOnly": true`）。
- 服务端：`buildFlowStep`（`server/helpers/writing-style-service.ts`）写 `availability` / `guidanceOnly` /
  条件 `guidanceWarning`；原 `warning: 'FLOW_STEP_ASSET_SHELL'` 保留（向后兼容）。
- UI：`PlanningTab` 当前步 `role="status"` 提示块（标签 + `GUIDANCE_ONLY_HINT`）；`SkillsStudioView`
  链路详情每步 `role="note"` 徽标（`title={GUIDANCE_ONLY_HINT}`）。文案单源来自 `flow-step-guidance`。
- 审计：`scratch/flow-audit.ts` 改用 `isShellTemplatePrompt` 判定，输出 30 步 / 可运行 13 / 仅引导 17 /
  不可用 0 / 占比 43.3%，并断言静默壳 0。

证据（2026-09-25）：

| 验收 | 证据 | 结论 |
| --- | --- | --- |
| 可运行占比 ≥80% **或** 每条链路显式标注为引导 | 取后者：17/17 壳步骤显式声明，声明集合 == 检测壳集合（静默壳 0），`tests/flow-step-guidance.test.ts` 12/12 断言 13/17/0 与逐链路 2-5-2-4-4；实测占比 43.3% 未达 80%，故明确走「显式标注」分支 | 通过 |
| flow-audit 新数字回写规格 §2.2 | §2.2 已回写（含 xiaofeiji 6/2 订正） | 通过 |
| 标注为引导的链路在 UI 有可见提示 | `src/tests/planning-tab-step-guidance.test.tsx` 5/5：PlanningTab 显示标签+文案 / 可运行步骤不显示；SkillsStudioView 天马 4 徽标、通用 0、小飞鸡 2 | 通过 |

补正文候选清单（同品牌、同意图；本小类**不擅自替换**，交作者裁决——跨提示词替换会把 A 提示词的正文挂到
B 步骤上，等于伪造归属）：

| 壳步骤 | 现状资产 | 候选（仓内可运行、正文 ≥100 字） |
| --- | --- | --- |
| xiaofeiji-novel-flow step1 脑洞灵感闪耀 | `square-182`（引用壳） | `private-181`【小飞鸡】五个长篇脑洞（147 字） |
| xiaofeiji-novel-flow step3 核心角色人设卡 | `square-183`（引用壳） | `private-157`【小飞鸡】长篇角色卡生成（137 字） |
| fenghua-short-flow step1 风华短篇脑洞爆款分析 | `square-88`（引用壳） | `private-124`【风华出品】老福特脑洞生成器（134 字） |
| fenghua-short-flow step2 老福特高美感大纲 | `square-93`（引用壳） | `private-89`【风华出品】短篇专用大纲生成（134 字） |
| fenghua-short-flow step5 高维情感逻辑分析 | `square-122`（引用壳） | `private-101`【风华出品】金牌主编改稿（133 字） |

其余 12 个壳步骤（tomato 5 / book-deconstruction 2 / tianma 4 / fenghua step3）在仓内无同品牌同意图正文
（「评分」「起名」零命中），保持「仅引导」。

#### 5.4.1 追补（2026-09-28）：平台链路各补 1 条可运行步骤

方向（用户裁决）：给三条全壳链路各补 1 条真正可运行的步骤。约束：**不替换、不改写广场转投壳资产** ——
`tomato-scorecard` / `hook-system` / `tomato-opening-validator` / `square-39` / `deconstruct-card-pacing` /
`deconstruct-card-hook` 的正文都是 `[平台能力特化强化体] 导入 …` 占位（来自 `prompt-supplement-fanqie-webnovel.md`
的转投语），改写它们等于伪造来源。做法：**新增 3 张自撰内置卡**（正文即方法论与输出契约），让步骤改指新卡：

| 新卡（registry id） | 名称 | 分类（score） | 服务步骤（原壳资产） |
| --- | --- | --- | --- |
| `tomato-opening-diagnostic` | 番茄开篇诊断器 | platform-criteria / quality-guardrail（82） | tomato-platform-flow step1 番茄开篇诊断（原 `tomato-scorecard`） |
| `tianma-three-act-planner` | 三幕式高潮规划器 | author-workflow / constellation-pack（80） | tianma-outline-flow step3 天马三幕式高潮规划（原 `square-39`） |
| `deconstruction-pacing-dissect` | 爽感节奏拆解器 | style-reference / author-workflow（80） | book-deconstruction-flow step1 神作高爽节奏拆解（原 `deconstruct-card-pacing`） |

三张卡均为 `licenseStatus`/`sourceType: 'built-in'`、`sanitizationStatus: 'runtime-ready'`、
`runtimeStatus: 'active'`、`placementTier: 'agent-guided'`（避开护栏通道 `core-default`，也不触发消毒副本生成）；
对应三步删除 `guidanceOnly: true` 与壳注释，改指新卡后由 `availability` 判定为 `asset`。

实测（2026-09-28）：`scratch/flow-audit.ts` → 30 步 / **可运行 16（53.3%）/ 仅引导 14（46.7%）/ 不可用 0 / 静默壳 0**；
逐链路番茄 1/5、天马 1/4、拆书 1/2（三条原均为 0 可运行）；治理目录 176 → **179**（内置 14 → 17），消毒副本仍 33。
三条集成断言（`tests/flow-step-guidance.test.ts`，共 15/15）：critic 阶段 prompt 含
「【番茄开篇诊断器 · 只诊断不改写】」，planner 阶段 prompt 含「【三幕式高潮规划器 · 只出结构不做正文】」与
「【爽感节奏拆解器 · 只拆结构不抄原文】」，且三者均不含壳转投语「平台能力特化强化体」。

残余：其余 14 步仍显式「仅引导」（番茄 4 / 天马 3 / 拆书 1 / 风华 4 / 小飞鸡 2）；壳资产本身保留在治理目录中
（未删除，供作者自行引用或后续裁决）；`hook-system` / `square-*` 等同品牌转投壳仍在公开目录按原样呈现。

回归（2026-09-25）：`npx tsc --noEmit` **0**；`npx eslint server src shared tests scripts --max-warnings=0` **0**；
后端定向 7 文件（flow-step-guidance / execution-contract / flow-step-stage / flow-step-card-slot /
flow-step-gate / public-catalog-freshness / public-catalog-governance）**EXIT=0**；
前端定向 `planning-tab-step-guidance + planning-tab-step-gate + planning-tab-step-progression` **EXIT=0**；
`scratch/stageprompts-snapshot.ts` 与门槛前逐项哈希一致（bare `e3b0c442/a911161f/af2071af`、
technique `4ee5c756/9a6bf48b`、deck `ad15f102/35a46c6f/f73b1f25`、flow-shield writer `0e7ffd52(655)`、
flow-outline planner `697f7556(101)` 步骤 `generateOutline@planner(92)`、flow-square planner `5dde5c7b(68)`
步骤 `square-182@planner(59)`）——本小类只加可用性标注，不改注入；
全量 `npm test` **1351/1351（FULLBE_EXIT=0，较上一小类 1339 增 12 条）**。

残余（登记不静默）：`FLOW_STEP_GUIDANCE_UNDECLARED_SHELL` / `…_WITH_RUNNABLE_ASSET` 两条警告为防御分支
（仓内 0 触发，前者由测试临时撤销声明触发）；`unavailable` 态仓内 0 步；批次 B 至此收官。

#### 5.5 图谱能力卡（批次 C 小类「图谱能力卡」）

**两张卡（manifest 目录 `shared/lib/capability-manifest-catalog.ts` 的 `CURATED_DEFINITIONS`）**

| id | kind | action | stages | allowedScopes | persistence | usageModes | 货架卡 |
|---|---|---|---|---|---|---|---|
| `knowledge-extract` | `utility` | `run-utility` | `['planner']` | project+chapter+single-run | project | `['single-run']` | 「知识谱系抽取器」stage `planning` / `utility-tool`+`platform-criteria` / 78 分 / B |
| `foreshadow-settle` | `diagnostic` | `run-diagnostic` | `['critic']` | project+chapter+single-run | project | `['single-run']` | 「伏笔回收核对器」stage `review` / `utility-tool`+`quality-guardrail` / 76 分 / B |

两卡货架条目（`GOVERNED_ASSETS_V2_REGISTRY`）均 `licenseStatus:'built-in'`、`sanitizationStatus:'runtime-ready'`、
`runtimeStatus:'active'`、`isWhiteLabeled/isRuntimeReady:true`，且 **`placementTier:'optional-style'`** —— 刻意避开
`core-default`：`buildGuardrails`（`writing-style-service.ts:1152+`）会把**全部** core-default 的 runtime-ready 资产
吸进护栏通道，工具卡若落 core-default 会被当写作规则注入三阶段提示。角色投影（`capability-card-role.ts`）自动给出
`utility→transform`、`diagnostic→diagnostic`，无需新映射分支。

**工具卡的运行时投影（「有卡可装配、但不改写作提示」）**
- `RuntimeSessionAsset.deconstructionCardType` 改为可选，新增 `tool?: { kind:'utility'|'diagnostic';
  action:'run-utility'|'run-diagnostic'; stages: CapabilityStage[] }`；`isSupportedCardType` 谓词返回类型随之收紧为
  `value is NonNullable<RuntimeSessionAsset['deconstructionCardType']>`。
- 新增 `projectToolCapabilityAsset(id, novel, scope)`：`isRunnableToolManifest`（kind+action+active）且 `allowedScopes`
  含目标作用域才投影；模板取货架 `template`、兜底 `resolveCuratedTechniquePrompt`，全无 → 400 `TOOL_CARD_NOT_RUNTIME_READY`；
  付费门 403 `TOOL_CARD_FORBIDDEN`；返回 `tool` + `lineage:{catalogId, capabilityKind}`，**不含 dct**。
- 接线：`resolveProjectSkillDeck` 的 saved-skill 分支之后插入工具卡分支（作品卡组面）；`resolveSessionAssets` 的货架分支内
  优先尝试（本章使用卡面，作用域 chapter），并在 `projectActiveCatalogSkillCard` 后为「不在货架的 id」补兜底。
- 不注入写作提示的机制：`stagesForAsset` 对既无 `deconstructionCardType` 又无 `stage` 的条目返回 `[]`（过滤只按 dct 取值），
  故工具卡天然不进 planner/writer/critic 规则数组；`ExecutionOverlay.type` 是必填 `string`，统一经
  `runtimeAssetType(asset)` 投影为 `dct ?? tool:<kind> ?? 'unknown-card'`（3 处消费点已替换）。
- 校验放宽：`validateCapabilityProfile` 对可运行工具卡（kind utility/diagnostic + active + allowedScopes 含 project）
  跳过 skill-card 类型门 —— 否则工具卡放进作品卡组会被 400 `PROJECT_SKILL_CARD_SCOPE_INVALID` 挡下；
  写作 skill-card 的原有硬门（kind/scope/type）不变。

**执行 API**
`POST /api/novels/:novelId/knowledge-capabilities/:assetId/run`（`server/routes/utilities.ts`，body
`{ databaseGeneration }` 严格校验；内核 `server/helpers/knowledge-capabilities.ts` 的 `runKnowledgeCapability`）：
- `knowledge-extract` → `runLineageEnrichment(novelId)`，返回 `{ capabilityId, kind:'coverage', coverage }`；
  **幂等**：连跑第二次 `ledgerInserted=0`、`ledgerSkipped=N`，`coverage` 与首跑深等。
- `foreshadow-settle` → `db.listForeshadowings` + `latestChapterOrder` → `buildForeshadowSettlementChecklist`
  （`shared/lib/knowledge-capabilities.ts`）返回 `{ capabilityId, kind:'checklist', checklist }`；含
  `entries / arrears / openCount / settledCount / currentChapterOrder / summary`，欠账口径 = `status !== 'payoff'`
  且埋设章序 < 参考章序（`chapterOrderOfId` 认 `Ch\d+`），已回收（payoff）条目被排除。
- 代际：入口与运行后各校验一次 `databaseGeneration`，不一致 → 409；响应附 `resolvedAtGeneration` 与
  `evidence.databaseGeneration`。错误码：400 `KNOWLEDGE_INVALID_INPUT` / `KNOWLEDGE_CAPABILITY_UNSUPPORTED`、
  404 `KNOWLEDGE_NOVEL_NOT_FOUND`、409 `DATABASE_GENERATION_STALE`、500 `KNOWLEDGE_INTERNAL_ERROR`。

**证据（2026-09-25）**：`tests/knowledge-capabilities.test.ts` **7/7**（登记+角色投影、session 解析、卡组解析、
extract 幂等、settle 清单、错误码、路由端到端含 stale 409）；`tests/prompt-assets-governed.test.ts`（内置 12→**14**、
源目录 174→**176**）EXIT=0；freshness + governance EXIT=0；`tests/capability-card-role.test.ts` EXIT=0；
`node --import tsx scripts/generate-public-catalog.ts` → **+194 行**（副本仍 33）；`npx tsc --noEmit` **0**；
`npx eslint server src shared tests scripts --max-warnings=0` **0**；后端定向 5 文件 **67/67**；
`scratch/stageprompts-snapshot.ts` 与门槛前**逐项哈希一致**（工具卡不进提示）；
`scratch/card-role-coverage.ts` 176 张 **0 未映射**（transform 30→32）；全量 `npm test` **1358/1358**（+7）。

**残余（登记不静默）**：步骤引用这两张卡（批次 C 第 4 条）未做；UI 入口已由 §5.6 交付（World Bible 图谱页一键重跑 + 九项数值），
驾驶舱/伏笔面板内入口仍未加；工具卡不进写作提示是设计语义而非缺口；`unknown-card` 兜底分支仓内 0 触发。

#### 5.6 图谱维护入口（批次 C 小类「图谱维护入口」）

**目标**：在 World Bible 图谱页给作者一个「从资料包重跑摄入」入口并展示 coverage；复用既有 `runLineageEnrichment`，
**不新增摄入逻辑**。

**数据 / 契约层（单一事实源收敛）**
- `shared/lib/knowledge-capabilities.ts` 追加：`LineageCoverage`（当时 8 项 `characters/items/locations/factions/powerLevels/
  timelineEvents/foreshadowings/edges`；§5.7 又增 `staleLedger/staleEdges` 两项失效计数）、`LineageCoverageFieldView`、`LINEAGE_NARRATIVE_COVERAGE_FIELDS`（六项叙事元素，
  界面主区）、`LINEAGE_COVERAGE_FIELDS`（8 项带中文标签）、`lineageCoverageFieldsOf(group)`、`LineageEnrichmentReport`
  （server `LineageReport` 的结构镜像）、`KnowledgeExtractResult` / `ForeshadowSettleResult` /
  `KnowledgeCapabilityRunResult`（原 server 内重复定义删掉，两端共用）、`KNOWLEDGE_SOURCE_PACK_MISSING`。
- `server/helpers/knowledge-capabilities.ts`：extract 分支**前置校验**（`packSourceDocuments(handle, novelId).length === 0`
  → 400 `KNOWLEDGE_SOURCE_PACK_MISSING`：明确错误 + 零写入，避免"成功但什么都没发生"）；运行体包进
  `handle.transaction(() => runLineageEnrichment(novelId))()`（单连接事务，中途失败整体回滚，既有台账/边零变化）。
- `src/lib/knowledge-client.ts`（新）：`KnowledgeCapabilityRequestError(status, code, message)` +
  `runKnowledgeExtract(novelId, signal?)`；代际经 `getDatabaseGenerationSnapshot()` 携带，非 2xx 抛结构化错误
  （code 兜底 `KNOWLEDGE_REQUEST_FAILED`）。

**界面**
- `src/components/KnowledgeMaintenancePanel.tsx`（新）：按钮「从资料包重跑摄入」（运行中禁用 + `正在重跑…`）；成功**才**
  替换本地 coverage 并显示「最近一次：细纲条目 N · 台账新增 X / 跳过 Y」；失败 `role="alert"` + toast 且**保留旧值**
  （不做乐观更新）。coverage 有值时 3 列 grid 展示六项叙事元素 + 一行「伏笔 / 关系边」；无值文案「尚未重跑…」。
- 错误文案映射（模块内 `describeKnowledgeRunError`）：`KNOWLEDGE_SOURCE_PACK_MISSING` → "未找到续写资料包：请先导入
  资料包（含逐章细纲）再重跑。"；409 → "数据库已更新，本次结果已失效：请刷新后重试。"；404 → "作品不存在或已被删除。"。
- 挂载点：`src/components/WorldBibleView.tsx` 图谱页（`activeTab === 'graph'` 容器首个区块），`onCompleted={fetchAll}`
  兜底直刷（该视图本身已 `subscribeToChanges(fetchAll)`）。

**证据（2026-09-26）**
- 幂等行数断言（`tests/knowledge-capabilities.test.ts` 新用例「重跑不产生重复行」）：首跑 `foreshadowings` 0→1
  （`ledgerInserted=1`），二跑后行数**不变**且 `ledgerInserted=0 / ledgerSkipped=1`；`entity_relationships` 行数两次重跑均不变
  （夹具内注明 `foreshadowings.novel_id` 与 `entity_relationships.novelId` 列名差异）。
- 失败零写入：无资料包 → 内核 throw 400 `KNOWLEDGE_SOURCE_PACK_MISSING`、路由同码 400（`error` 文案含"未找到续写资料包"），
  两表计数仍 0。
- 界面用例：`src/tests/knowledge-maintenance-panel.test.tsx` **5/5**（初始态 / 六项 + 伏笔·关系边数值 / 重复重跑显示 0 新增 /
  失败保留旧值 + 错误文案 + toast / 409·404 文案）。
- 门禁：`npx tsc --noEmit` **0**；`npx eslint server src shared tests scripts --max-warnings=0` **0**；
  `tests/knowledge-capabilities.test.ts` **9/9**；前端定向（world-bible-helper-drawer / world-bible-sync-return /
  world-bible-assistant-accessibility / knowledge-maintenance-panel）**14/14**；
  `scratch/stageprompts-snapshot.ts` 与门槛前**逐项哈希一致**（本轮零提示改动）。

**残余（登记不静默）**：伏笔面板（`ForeshadowingPanel`）内未加入口（当前只挂 World Bible 图谱页）；重跑为同步动作、
无长任务进度；coverage 只展示"最近一次"，未落库历史快照。

#### 5.7 图谱失效语义（批次 C 小类「图谱失效语义」）

**目标**：知识行（台账 + 边）记录摄入来源版本；来源失效（章节删除）时**只打标、不删除**，失效可查询、计数可读；
重跑 enrich 不删除任何既有边——把「只增不删」从隐患变成显式契约。

**列（additive，`server/lib/db-init.ts:708` 后 ensureColumn）**
- `foreshadowings`：`source_version TEXT` / `stale INTEGER NOT NULL DEFAULT 0` / `stale_reason TEXT`；
- `entity_relationships`：同上三列。
- 语义：`source_version` = 摄入来源指纹，资料包派生 `pack:<packId>@<updatedAt>`（`packSourceVersion`），
  章节作用域派生 `chapter:<chapterId>`（`chapterSourceVersion`）；`stale_reason` 当前唯一原因族
  `chapter-deleted:Ch012`（`chapterTokenForOrder` 零填充三位，与 `chapterOrderOfId` 解析口径一致）。

**单源模块 `server/lib/db/knowledge-staleness.ts`**（`server/lib/db.ts` 转发导出）
- `KG_PACK_VERSION_PREFIX` / `KG_CHAPTER_VERSION_PREFIX` / `KG_STALE_REASON_CHAPTER_DELETED` /
  `chapterTokenForOrder` / `packSourceVersion` / `chapterSourceVersion`；
- `markKnowledgeStaleForDeletedChapter(novelId, { id, order })` → `{ ledgerMarked, edgesMarked }`：台账按
  `planted_chapter_id`/`payoff_chapter_id` 章序命中打标；边按 `source_version === 'chapter:<id>'` 打标；
  已在失效态的行不重复打标（保留首次原因）；
- `countStaleKnowledgeRows(novelId)`（`staleLedger` / `staleEdges`）、`listStaleKnowledgeRows(novelId)`（失效查询面）。

**删除补偿挂点**：`server/lib/db/chapters.ts:125 deleteChapter` —— 与 `scheduleChapterIndexRemoval` 同点，
删除成功后调 `markKnowledgeStaleForDeletedChapter(novelId, { id, order })`；失败不阻塞删除，异常不外溢。

**写入侧**：`server/helpers/knowledge-lineage-enrich.ts` 摄入前取一次 `packSourceVersion(novelId)`，
台账 INSERT 与四处边 INSERT（公理持有 / 遗物持有 / 亲和 / 居住）统一写入 `source_version`；
coverage 组装暴露 `staleLedger` / `staleEdges`（经 `POST /api/novels/:id/knowledge-capabilities/knowledge-extract/run` 返回）。

**界面**：`KnowledgeMaintenancePanel` 图谱行新增「失效台账 / 失效边」两项；失效总数 > 0 时给出
`role="status"` 说明「章节删除等来源失效只打标不删除（重跑摄入不会清除失效标记）」。

**证据（2026-09-26）**：`tests/knowledge-staleness.test.ts` 3/3（删除后台账+边各 1 行 stale 且 `stale_reason='chapter-deleted:Ch002'`、
资料包来源边不受影响、重复补偿 0/0、重跑前后边集合与标记逐项一致且 enrich 源码无 `DELETE FROM`、接口 coverage 读回 1/1）；
前端 `src/tests/knowledge-maintenance-panel.test.tsx` 7/7（`失效台账：2` / `失效边：1` / 「已有 3 行知识失效」说明 / 无失效行时无说明）；
`npx tsc --noEmit` 0；`npx eslint server src shared tests scripts --max-warnings=0` 0；后端定向 24/24；
全量 `npm test` **1363/1363**（FULL_EXIT=0）；`scratch/stageprompts-snapshot.ts` 六场景哈希逐项不变。

**残余（登记不静默）**：章节「回滚」（版本回退）未打标——当前只覆盖删除路径，回退需先定义"回退到哪个来源版本"；
`stale` 标记目前无「恢复/清除」入口（重跑 enrich 不清除，符合"只增不删"，但缺少人工确认恢复的动作）；
章节作用域边的生产写入方仅测试夹具（章节 apply 尚不写边），故边走的是预留的口径匹配路径。

#### 5.12 护栏配置的净增语义（Plan 262 B1）

**问题（2026-09-28 实测）**：`guardrailIds` 里配 core-default 护栏是「假控制」——
`buildGuardrails`（`server/helpers/writing-style-service.ts:1269`）先**无条件**并入全部
`placementTier==='core-default'` 且运行时就绪的资产（当前 12 张质量护栏 + core-default 工具资产），
再并入配置项并按 `id\u0000stage` 去重 ⇒ 配置同一条 Δ 恒为 0，而界面把它算进「增强护栏已开启 N 条」。
第二种无净增形态是**引用壳**：`square-13` / `square-3` 能通过配置校验，却在注入阶段被壳卡过滤
（`isShellTemplatePrompt`）丢弃。

**单源 `shared/lib/guardrail-scope.ts`**（纯函数、无 IO）：
- `isReadyQualityGuardrail`：运行时就绪 && `primaryCategory==='quality-guardrail'`（服务端校验/合并判据，core-default 亦算）；
- `isDefaultOnGuardrail`：再叠 core-default ⇒ 无条件注入，配置无净增；
- `isSelectableGuardrail`：非 core-default、非 `sourceGroup==='test-fixture'` ⇒ 真可选；
- `isShellGuardrail`：可选但模板是 <80 字引用壳 ⇒ 注入被丢，同样无净增；
- `auditGuardrailSelection(ids, catalog)` → `{ selectable, redundant, unusable }`（trim + 去重；`default-guardrail`
  占位 id 归 redundant；不可用条目给 `GUARDRAIL_UNUSABLE_NOTE`）；
- 文案常量 `GUARDRAIL_DEFAULT_ON_LABEL` / `GUARDRAIL_REDUNDANT_NOTE` / `GUARDRAIL_BUILTIN_PLACEHOLDER_NOTE` /
  `GUARDRAIL_SHELL_NOTE` / `GUARDRAIL_UNUSABLE_NOTE`。

**接线**：
- 服务端 `isConfigurableGuardrailAsset`（`server/helpers/writing-style-service.ts:1157-1163`）改为委托
  `isReadyQualityGuardrail`（零行为变更；写路径维持「core-default / 引用壳仍可保存」，避免存量档案重存 400）；
- `src/lib/capability-governance.ts`：`getConfigurableGuardrailAssets` 走 `isSelectableGuardrail`，
  新增 `getGuardrailSelectionAudit(ids)`；
- `GuardrailPolicyPanel` 新增必填 `audit` prop 与「已声明但未产生净增（N）」区块
  （`data-testid="guardrail-audit"` / `guardrail-redundant-entry-<id>` / `guardrail-unusable-entry-<id>`）；
- `SkillsStudioView` 两处计数改用 `audit.selectable.length`，并有滞留项时补「另有 N 条已声明但未产生净增」。

**口径（实测 2026-09-28）**：源目录 25 张 `quality-guardrail` = 12 张默认生效（core-default）+ 9 张可选
（7 张真净增：private-162 / private-130 / private-101 / private-100 / private-86 / private-85 / de-ai-tells-guard；
2 张引用壳：square-13（37 字）/ square-3（39 字））+ 4 张未就绪。

**证据**：
- `tests/guardrail-scope.test.ts` **5/5**：分类计数（25 / 9 / 12，shells = {square-13, square-3}）、审计归类
  （trim 去重、三种 redundant note、unusable）、服务端 Δ 逐字节（baseline = core-slop-shield = square-13：
  planner `e3b0c442(0)` / writer `a911161f(541)` / critic `af2071af(104)`，护栏列表逐项一致；
  de-ai-tells-guard → writer `5e33af46(948)`；private-162 → writer `73451d12(710)`）、写路径兼容
  （core-slop-shield / square-13 / de-ai-tells-guard 通过；core-dialogue-enhancer / ghost-guardrail → 400
  `CAPABILITY_GUARDRAIL_UNAVAILABLE`）。
- 前端 `src/tests/guardrail-policy-panel.test.tsx` **4/4**（回执区块三条 / 无条目不渲染 / 审计与目录同源 /
  开关仍可切换）；前端定向 **75/75**；`npx tsc --noEmit` 0；`npx eslint server src shared tests scripts --max-warnings=0` 0；
  `scratch/stageprompts-snapshot.ts` 六场景逐项哈希不变。
- 既有用例修正：`src/tests/skills-studio-plan158.test.tsx` 的护栏用例原点击面板第一条（square-13 = 引用壳）
  并断言「已开启 1 条」，B1 后改为显式点选 de-ai-tells-guard（引用壳会被回执为无净增，不再计入开启数）。

**残余（登记不静默）**：未把「无净增」升级为写路径拒绝（保持兼容，收紧需先迁移存量档案，见 E4/M2 语境）；
其它装配字段（techniques/deck）暂无同类「净增」审计；4 张未就绪护栏资产的去向归批次 B3 清洗清账。

#### 5.13 评分口径显性化（Plan 262 B2）

问题：`score` 同时承担「质量分」与「准入门槛」，分档（grade）实现散在三处 ——
`shared/lib/prompt-sanitizer.ts` `promoteToRuntimeReady` 的完整 A–F 分档、
`shared/lib/prompt-governance-catalog.ts` 各家族的截断分档（内置/square A–C、private A–D、supplement A/B）、
`scripts/lib/public-catalog-pipeline.ts` 的 `recalibrateGrade`（A/B/C）；门槛常量亦有副本
（`PLACEHOLDER_SCORE_CAP` / `FEATURED_MIN_SCORE`）。实测 179 张卡中 7 张 grade 与分数不符：
`private-197/195/161/106`（56 分标 D）、`opening-templates-library`（78 分标 B）、
`knowledge-extract`（78 分标 B）、`foreshadow-settle`（76 分标 B）。渲染层另有 4 处
`grade: asset.grade || 'B'` 假兜底。

单源 `shared/lib/prompt-score-policy.ts`（纯函数、无 IO）：

- 分档 `SCORE_GRADE_BANDS`：A≥90 / B≥80 / C≥70 / D≥60 / F<60（缺分/非有限 → F）；
- 门槛 `SCORE_ADOPT_MIN = 70`、`SCORE_CANDIDATE_MIN = 60`，`scoreAdmissionOf` → `adopt | candidate | unusable`；
- 文案 `SCORE_GRADE_LABELS`、`SCORE_ADMISSION_LABELS`、`SCORE_POLICY_SUMMARY`、`scoreBadgeLabel`、`describeScorePolicy`；
- 生成管线常量 `PLACEHOLDER_SCORE_CAP = 60`、`FEATURED_MIN_SCORE = 70`（由本模块 re-export）。

接线点（5 处）：

| 位置 | 改动 |
|---|---|
| `shared/lib/prompt-sanitizer.ts` `promoteToRuntimeReady` | 改用 `gradeFromScore` / `isScoreAdoptable`（行为等价） |
| `shared/lib/prompt-governance-catalog.ts` 4 处家族分档 + 出口 | 内联三元式改 `gradeFromScore`；`PROMPT_GOVERNANCE_CATALOG` 出口 `.map(asset => ({ ...asset, grade: gradeFromScore(asset.score) }))` 归一（手写 grade 不再漂移） |
| `scripts/lib/public-catalog-pipeline.ts` | 两个常量改为单源 re-export；`recalibrateGrade` 委托 `gradeFromScore` |
| `src/lib/capability-governance.ts` 4 处 | `grade: asset.grade || 'B'` → `gradeFromScore(asset.score)` |
| `src/components/book-factory/QualityTab.tsx` | 推荐区新增口径说明行（`data-testid="score-policy-note"` = `SCORE_POLICY_SUMMARY`）；卡面徽标改 `scoreBadgeLabel(asset.score)`（如 `C级 (78分) · 可装配`），`title` = 口径原文 |

口径：≥70 可装配（A≥90 / B≥80 / C≥70）；60–69 仅候选（D）；<60 不可用（F）。

证据（2026-09-28）：`scratch/b2-probe.ts` 复跑 → 179 张 0 mismatch，grade 分布 A11 / B42 / C79 / D40 / F7（与分数桶一一对应）；
公开目录重生成 `shared/lib/public-skill-catalog.ts` 51 行变更，逐行核对全部为 `"grade"` 行；
`tests/prompt-score-policy.test.ts` 6/6（边界值、门槛映射、两份目录零漂移并断言唯一 active 低分豁免为 `test-fixture-lowscore`、7 张修正钉住、管线同源、源码扫描无第二处分档实现）；
`src/tests/quality-tab-score-policy.test.tsx` 1/1；`tests/public-catalog-governance.test.ts` 占位封顶断言由 C 改 D；
tsc 0、eslint 0、后端定向 58/58、前端定向 43/43、快照六场景逐项不变。

残余：审稿分 80/60 分档是另一概念（章节审计分），未并入本模块；`shared/lib/curated-product-skills.ts` 的 S/A/B 字母评级为独立模型（登记，未并轨）；`grade` 仍存于资产对象（供展示与 F 拒绝路径），未在类型层分离「分数 / 门槛」。

#### 5.14 目录滞留清账（Plan 262 B3）

问题（2026-09-28 实测 `scratch/capD-sanitize.ts`）：179 张 runtime 目录 → 132 张上架公开目录；
`admitPublicAsset` 拒 6 张；41 张「通过准入但不在公开目录」；`needs-sanitization` 46 张中
33 张产副本、13 张永不产副本。此前只有汇总数字，逐张去向未登记，无法区分「漏做」与「有意为之」。

去向单源 `scripts/lib/catalog-disposition.ts`（纯函数；判定顺序 public → sanitized-copy →
duplicate-absorbed → declared-internal → unclassified），逐张给出一个去向与可读理由：

| 去向 | 张数 | 语义 |
|---|---|---|
| public | 132 | 已上架公开目录（runtime-ready + 白标） |
| sanitized-copy | 33 | 公开以 `sanitized-<id>` 副本形态存在；源卡按设计不上架（保留用于追溯） |
| duplicate-absorbed | 6 | 换皮重投（同 `normalizedTitleKey`）被吸收，保留得分更高/标题更短者，并记录 `coveredBy` 指向保留卡 |
| declared-internal | 8 | 明确不公开：垃圾标题 6（private-198/197/195/167/106 等）+ 渲染剥空标题 1（private-186「fire角色定制」）+ 测试夹具 1（test-fixture-unsafe） |
| unclassified | **0** | 无去向（滞留）——必须为 0 |

41 张「通过准入但不在公开目录」由此拆分清楚：33 张副本 + 6 张重复吸收 + 2 张测试夹具
（`test-fixture-lowscore` 是 runtime-ready 夹具，`test-fixture-unsafe` 是 needs-sanitization 夹具）。
13 张「needs-sanitization 且无副本」的去向：6 张换皮被吸收 + 7 张明确不公开（垃圾标题 6 + 夹具 1）。

可复跑报告 `scripts/report-catalog-hygiene.ts`（`npx tsx scripts/report-catalog-hygiene.ts`）：
打印去向分布 + `declared-internal` / `unclassified` 逐张清单；存在滞留即退出码 1。

证据：`tests/catalog-disposition.test.ts` 6/6（分布钉住 179=132+33+6+8、id 全覆盖无重复、
副本与副本表一一对应、6 张重复的 `coveredBy` 均可查且已上架/有副本、8 张明确不公开 id 清单、
13 张无副本卡全部非滞留）；`scratch/capD-sanitize.ts` 复跑数字与上表一致（179/132/6/46/33/13）；
tsc 0、eslint 0、后端全量 1413/1413（+6）、快照六场景逐项不变（本批次未触运行时与提示词）。

残余：`declared-internal` 理由由生成侧规则复算（垃圾标题 / 渲染空标题 / 夹具），尚无「人工拍板」登记通道；
33 张副本的源卡仍留在 runtime 目录（用于追溯），UI 未标注「仅副本公开」。

#### 5.15 cardRef 挂真实步骤（Plan 262 C1）

问题（批次 B 遗留）：卡槽能力（`shared/lib/flow-step-card-slot.ts` + `server/helpers/writing-style-service.ts`
的 `buildFlowStep`）已完整，但目录里 `cardRef` 实例 0 —— 能力空转；平台链路中 5 条各有 ≥1 步的资产是引用壳
（`hook-system` / `deconstruct-card-hook` / `square-42` / `square-88` / `square-182`），这些步骤此前实际注入的
是「无正文的空壳」。

落地（每条平台链路 ≥1 步挂卡，共 6 步，覆盖 planner / writer / critic 三阶段）：

| 链路 | 步骤（声明阶段） | 挂卡 | role | 卡面长度 |
|---|---|---|---|---|
| 小飞鸡 | `xiaofeiji-novel-flow-step1` 脑洞灵感闪耀（planner） | `private-181` 五个长篇脑洞 | rule | 147 |
| 天马 | `tianma-outline-flow-step4` 天马通用分章大纲（planner） | `private-168` 章纲自适应续写 | rule | 148 |
| 风华 | `fenghua-short-flow-step1` 风华短篇脑洞爆款分析（planner） | `private-89` 短篇专用大纲生成 | rule | 134 |
| 拆书 | `book-deconstruction-flow-step2` 黄金开篇钩子拆解（planner） | `deconstruction-pacing-dissect` 爽感节奏拆解器 | rule | 860 |
| 番茄 | `tomato-platform-flow-step2` 黄金三章钩子强化（writer） | `de-ai-tells-guard` 去AI味痕迹规则卡 | rule | 380 |
| 番茄 | `tomato-platform-flow-step3` 核心爽点黄金排布（critic） | `tomato-opening-diagnostic` 番茄开篇诊断器 | diagnostic | 854 |

语义：`cardRef.stages = [步骤声明阶段]`，卡片正文以 `【步骤卡：<id>（<role>）】` + 模板原文进入该阶段 prompt；
`assetId` 路径保留为回退（`flowStep.prompt` 不变，六步 availability 仍为「仅引导」，因为它们的 assetId 是壳）。

证据（2026-09-28）：
- `tests/flow-step-card-mounts.test.ts` **8/8**：目录声明 6 步 / 5 条链路全覆盖且全部可解析（角色投影一致、
  无诊断、阶段=声明阶段）；六条集成用例逐条断言「声明阶段 prompt 命中标记 + 卡面特征串，另两阶段不命中」，
  且 `flowStep.cardId/cardRole/cardStages` 正确、`cardWarning` 缺省。
- 回归：未挂卡步骤 `generic-novel-flow-step5` 仍 `stagePrompts` 缺省、三阶段无 `【步骤卡：`。
- 快照六场景：**仅 `flow-square`（xiaofeiji step1）planner 变化 `5dde5c7b(68)` → `47eae3c5(240)`**（+172 = 卡片块）；
  其余五场景（bare / technique / deck / flow-shield / flow-outline）逐项哈希不变；`flow-square` 的步骤 prompt 仍
  `square-182@planner(59)!FLOW_STEP_ASSET_SHELL`（assetId 回退未被破坏）。
- `scratch/flow-audit.ts` 新增 `card=<id>@<stage>` 列，六步逐一可见；其余口径不变
  （30 步 / 可运行 16 / 仅引导 14 / 53.3% / 静默壳 0）。
- 生成物 `shared/lib/public-skill-catalog.ts` 重生成 +42 行（仅 cardRef 声明）；新鲜度 / 唯一性 / 治理守卫全绿。
- tsc 0、eslint 0、后端全量 1421/1421（+8）。

残余：`guidanceOnly` 与挂卡并存（步骤仍标「仅引导」，因 assetId 是壳）——「有卡即可运行」的可用性语义留待批次 D；
其余 14 步「仅引导」未挂卡（D1）；选卡为人工拍板，无「按维度自动选卡」机制（C3）。

### 5.16 双门合一：旧 `qualityGate` 收敛（Plan 262 C2）

问题：`SkillSeriesFlowStep.qualityGate`（30 步）同时承担「展示文案」与提示词 `【质量门】` 行，
而判定用的 `gate{kind}` 只有 generic step5/step6 两处 → 文案、判定、UI 三处不同源；且 30 条文案互不重复，
无法机械归并为 kind。方案：新增 `advisory`（文本验收门，只展示不拦截），旧文案整体迁入 `gate.note`，
旧字段删除。

模型（单源 `shared/types/prompt-assets-governed.ts`）：
- `export type FlowStepGateKind = FlowStepGate['kind'];`；
  `FlowStepGate.kind: 'mechanical' | 'critic' | 'manual' | 'advisory'`，新增 `note?: string`
  （提示词行与 UI 的唯一文案源）；`SkillSeriesFlowStep.qualityGate` **已删除**，`gate?: FlowStepGate` 成唯一门槛字段。
- `shared/types/capability-execution.ts` 的 `ExecutionOverlay` 同步为 `readonly gate: FlowStepGate | null;`。

判定与展示（单源 `shared/lib/flow-step-gate.ts`）：
- `FLOW_STEP_GATE_KINDS` 四值；`FLOW_STEP_GATE_KIND_LABELS`（机械门（草稿质量）/ 审稿门（critic 分数）/
  人工确认门 / 文本验收（不拦截））。
- `evaluateFlowStepGate`：advisory → `status:'pass'` + warning `FLOW_STEP_GATE_ADVISORY`；
  若同时声明 `threshold` 再记 `FLOW_STEP_GATE_THRESHOLD_IGNORED`（文本门不参与判定）。
- `flowStepGatePromptText(gate)`：`note` 优先 → 缺省回退 kindLabel+阈值 → null 为「未声明质量门（不判定）」；
  服务端 `writing-style-service.ts` 的 `【质量门】${flowStepGatePromptText(step.gate)}` 与快照字段 `gate: step.gate ?? null`。
- `flowStepGateDisplay(gate)`：`{kind,kindLabel,advisory,intercepting,text}`；PlanningTab / SkillsStudioView 共用，
  advisory 追加「：仅展示，不拦截推进」。

目录迁移：30 步 = **advisory 28**（`note` = 原文案，如 xiaofeiji step1「脑洞概念成型且具备初始爽点」）
+ generic step5 `{kind:'mechanical',note:'第一章正文初稿撰写完成'}` + step6 `{kind:'critic',threshold:80,note:'基础文本去AI腔完成，语流顺畅'}`；
源目录 `qualityGate` 残留 0。

脱敏管线（`scripts/lib/public-catalog-pipeline.ts`）：`TEXT_KEYS_TO_SANITIZE` 去掉 `'qualityGate'`，
新增 `PATH_TEXT_KEYS_TO_SANITIZE = new Set(['gate.note'])` 与 `cloneAndSanitizeAt(obj, path)`
（`cloneAndSanitize` 委托之）——按路径脱敏，避免把任意对象的 `note` 都当可脱敏文本；`gate.note` 仍走 `cleanText`。

证据（2026-09-28）：
- `tests/flow-step-gate-migration.test.ts` **5/5**：30 步全带 `gate.note`、kinds `{advisory:28, mechanical:1, critic:1}`、
  提示词/展示同源、advisory pass+ADVISORY+阈值忽略、kind 常量与标签表一一对应、源码+生成物零旧字段
  （`stripComments()` 剥注释后扫描 8 个文件）。
- 既有测试迁移：`tests/flow-step-gate.test.ts`「目录 30 步都有 gate；可判定门仍只落在 generic-novel-flow 的 step5/step6」
  （step5/step6 deepEqual 含 note；xiaofeiji 全 advisory；会拦截的门 = 仅这两步）、枚举契约改四值；
  前端 `src/tests/planning-tab-step-gate.test.tsx` **7/7**（新增 advisory 用例：文案可见 + 「仅展示，不拦截推进」+ 推进不被拦）。
- 生成物 `shared/lib/public-skill-catalog.ts` 重生成 diff **116 插入 / 32 删除**，逐行核对全为 `qualityGate` → `gate` 相关行
  （另 3 行为 step5/step6 gate 对象重塑）。
- 快照六场景与 C1 基线**逐项一致**（bare `e3b0c442(0)/a911161f(541)/af2071af(104)`；technique `4ee5c756(634)/9a6bf48b(197)`；
  deck `ad15f102(74)/35a46c6f(553)/f73b1f25(107)`；flow-shield writer `0e7ffd52(655)`；flow-outline planner `697f7556(101)`；
  flow-square planner `47eae3c5(240)`）⇒ 迁移后提示词**零变化**。
- tsc 0 / eslint 0 / 后端定向 72/72 / 后端全量 **1426/1426（+5）** / 前端定向 71/71。

残余：advisory 门无强制语义（设计如此，仅文本验收）；`gate.note` 为自由文本无长度约束；
30 步文案仅在「质量检查门栏」区展示，未进回执行。

### 批次 C：图谱可编排 + 维护闭环

1. 新增 `knowledge-extract`（素材→图谱）与 `foreshadow-settle`（伏笔回收核对）能力；✅ 2026-09-25（见 §5.5，含卡/解析/执行 API）
2. 图谱维护入口：从资料包重跑（幂等）+ 覆盖度展示；✅ 2026-09-26（见 §5.6）
3. 边/台账加 `sourceVersion` + `stale`；章节删除/回滚补偿；✅ 2026-09-26（见 §5.7：删除打标 + 不变量 + 接口/界面可读）
4. 链路新增"知识抽取 / 伏笔核对"步骤并引用上述卡。

#### 5.8 生产管线检索注入（批次 D 小类「生产管线检索注入」）

**目标**：把语义检索层（`vector_chunks` + 本地嵌入）接入 `runProductionPipeline` 的上下文组装，按章取回相关过往片段；严格增量、无命中/嵌入不可用时可安全降级为改动前形态，且注入长度受上下文预算约束。

**单源复用（不新造检索层）**：`server/helpers/story-context.ts` 新增
- `SEMANTIC_RECALL_MARKER = '【语义相关的过往章节片段】'`、`MAX_SEMANTIC_RECALL_CHARS = 1_200`、`DEFAULT_SEMANTIC_RECALL_TOP_K = 2`；
- `buildSemanticRecallSection(input: { novelId; queryText; topK?; maxChars? }, deps = SEMANTIC_RECALL_DEPS): Promise<SemanticRecallSection | null>` —— 返回 `{ marker, text, hitCount, injectedChars, truncated }`，命中片段以 `\n---\n` 连接后 `slice(0, maxChars)`；
- `SemanticRecallDeps`（`getChunkCount` / `getEmbeddingStatus` / `embedWithMetadata` / `searchSimilar`）为显式注入缝；
- 既有 `buildServerStoryContextWithSemantic` 改为复用它，输出格式（`${base}\n\n${marker}\n${text}`）逐字节不变 ⇒ `agents.ts:542`、`audit.ts:250/:835` 等既有调用方零变化。

**降级（两条路径都等于「与现状一致」）**：空白 query / `getChunkCount() === 0` / `getEmbeddingStatus().status` 不在 `{ ready, fallback }` / `embedWithMetadata` 抛错 / 无命中（或命中文本全空白）→ 返回 `null`；调用方把它折算成空串，组装输出与改动前逐字节相同。

**预算（双层，验收③）**：语义块自身 1 200 字符上限（`injectedChars`/`truncated` 如实上报）；接入既有 `buildProductionPromptContexts(args, maxChars = DEFAULT_PRODUCTION_CONTEXT_CHAR_LIMIT = 24_000)`（`shared/lib/chapter-production.ts:69-83`），`args.semanticContext?` 追加在 planner/writer/critic 三阶段列表**末位**（canon/账本/资料包在前，检索严格增量），并照旧过 `composeUniqueContext` 的 trim/去重/`slice(0, maxChars)`。

**接线（`server/routes/production.ts`，仅 start-stream）**：`runInSerializedWriteForGeneration` **之外**先 `await buildSemanticRecallSection({ novelId, queryText: [章节标题, sceneBeats, userIntent].filter(Boolean).join('\n') })`（嵌入/检索绝不占写锁）；`initializeProductionRun(...)` 增第 8 参 `semanticContext?: string` 并透传组装 + 返回值带出 `semanticContext`；随后并入 `finalPipelineContext`、`receiptActualText`，并新增诚实收据源 `{ id: 'semantic-recall', label: '语义检索片段', itemCount: hitCount, version: 'semantic-recall-v1' }`。非流式 `POST /api/chapter-production-runs/start` 不传该参数 ⇒ 行为不变。

**证据（2026-09-27）**
- 新增 `tests/production-semantic-recall.test.ts` **6/6**：①marker/片段/`hitCount=2`/`\n---\n` 连接/`truncated=false`；②5 000 字命中 → `injectedChars === MAX_SEMANTIC_RECALL_CHARS`（1 200）、`truncated=true`；③七种降级全 `null`；④逐字节锁：无语义块时三阶段分别为 `'PACK_BASE\n\nPLANNER_BASE'` / `'WRITER_BASE\n\nPACK_BASE'` / `'CRITIC_BASE\n\nPACK_BASE'`，有语义块时三阶段 `endsWith(semanticContext)`；⑤预算：默认 24 000 内且 marker 在、`maxChars=40` 时三阶段 `length <= 40` 且片段哨兵不出现；⑥线层：真实 `runProductionPipeline` + 桩 fetch，planner/writer/critic 三个请求均含 marker 与片段哨兵，planner 请求不含 writer/critic 阶段哨兵。
- 后端定向 6 文件 **27/27**（本类 + `production-prompt-sentinel` / `server-story-context` / `story-context-load-scope` / `chapter-production` / `production-stream-disconnect`）；
- `npx tsc --noEmit` 0；`npx eslint server src shared tests scripts --max-warnings=0` 0；
- `scratch/stageprompts-snapshot.ts` 六场景逐项哈希不变（bare `e3b0c442(0)/a911161f(541)/af2071af(104)`；technique `4ee5c756(634)/9a6bf48b(197)`；deck `ad15f102(74)/35a46c6f(553)/f73b1f25(107)`；flow-shield `0e7ffd52(655)` + `core-slop-shield@writer(103)`；flow-outline `697f7556(101)` + `generateOutline@planner(92)`；flow-square `5dde5c7b(68)` + `square-182@planner(59)!FLOW_STEP_ASSET_SHELL`）⇒ 未接线场景（无语义块）提示零漂移；
- 前端全量 `npm run test:frontend` **154 files / 995 tests 全绿**（`shared/` 契约改动两侧都跑）；
- 全量 `npm test` **1369/1369**（35 suites，FULL_EXIT=0；基线 1 363 + 6 条新用例）。

**测试缝（重要，避免后来者踩坑）**：`server/lib/config.ts:82-88` 的 `defaults` 在**模块加载时**快照 `process.env`，`reloadConfig()` 只在其上重跑。任何静态 import 了 server 模块（间接 import config）的测试文件，必须把 `import './helpers/llm-env.ts'` 放在第一个 import —— 否则 process 永久停在内置 Google 默认（空 key + `generativelanguage.googleapis.com`），桩 fetch 前就抛 `ProviderError: configuration`（`provider: 'google'`, `providerRequestCount: 0`）。本类首跑 5/6 即此原因。

**残余（已登记，不得当既有能力）**
- 检索 query 仅取「目标章标题 + 分镜 + 用户意图」，未用当前草稿正文（属审查侧检索，留待批次 D 后续小类评估）；
- `topK` 固定 2、片段上限 1 200 字符为常量，无按作品/体裁配置；
- 命中的过往片段未进入质量门/critic 逐条核对（只作为写作上下文）；
- 批次 D 第 3 条（长篇基线对比）未做；第 2 条见 §5.9。

#### 5.9 记忆健康度看板（批次 D 小类「记忆健康度看板」）

**目标**：驾驶舱暴露四项长期记忆指标，并在数据缺失时显示「未知」而不是 0（遵循 `docs/specs/llm-status-honesty.md` 的诚实性口径）。

**单源（`shared/lib/memory-health.ts`，纯逻辑无 IO）**
- `MEMORY_HEALTH_METRIC_KEYS = ['openForeshadowings', 'orphanNodes', 'staleKnowledge', 'ragHits']`（顺序即界面顺序）；标签 = 未回收伏笔 / 孤立节点 / 失效知识 / RAG 命中。
- `computeOrphanEntityIds({ entities, relationships })`：既不是任何关系的 `sourceId` 也不是 `targetId` 的实体；实体类型 `MEMORY_HEALTH_ENTITY_TYPES = ['character','location','item','faction']`（与 `entity_relationships.sourceType` 同口径）；输出按类型序 + id 稳定排序。
- `buildMemoryHealthMetrics(input)`：固定四项；`staleKnowledge` 值 = `staleLedger + staleEdges`（detail 写「台账 N · 关系边 M」）；`null` 一律配 `unknownReason`。
- `memoryHealthValueLabel(metric)`：`null → '未知'`（`MEMORY_HEALTH_UNKNOWN_TEXT`）；`memoryHealthUnknownMetrics(reason)` 供整块不可用时回退。

**取数（`server/helpers/memory-health.ts`，只取数不定义语义）**
- `collectMemoryHealth(novelId): Promise<MemoryHealthSnapshot>`；`MemoryHealthSnapshot { novelId, computedAt, metrics, evidence }`。
- 可用性策略（诚实口径）：`graphIngested = packDocuments > 0 || 台账行 > 0 || 边 > 0`；未摄入时图谱三项（未回收伏笔 / 孤立节点 / 失效知识）均为 `null` + 原因「尚未摄入资料包：先导入含逐章细纲的续写资料包」；已摄入但真为 0 时返回 0（与未知可区分）。
- 指标来源全部复用既有单源：未回收伏笔 = `buildForeshadowSettlementChecklist({ foreshadowings, currentChapterOrder: 最新章节 order }).openCount`（与 `foreshadow-settle` 能力同源）；孤立节点 = `computeOrphanEntityIds`（`db.listCharacters/listLocations/listItems/listFactions` + `db.listEntityRelationships`）；失效知识 = `db.countStaleKnowledgeRows(novelId)`；RAG 命中 = `buildSemanticRecallSection`（与生产管线同源，查询 = 最新章节标题 + 分镜），索引为空或嵌入不可用时为 `null`（原因分别「尚未建立向量索引…」「嵌入模型正在初始化/不可用」）。

**接口与界面**
- `GET /api/novels/:novelId/memory-health`（`server/routes/utilities.ts`，只读、不带代际）；作品不存在 404 `MEMORY_HEALTH_NOVEL_NOT_FOUND`，其余 500 `MEMORY_HEALTH_INTERNAL_ERROR`。
- `src/lib/knowledge-client.ts` 的 `fetchMemoryHealth(novelId, signal?)`（只读 GET，非 2xx 抛 `KnowledgeCapabilityRequestError`，code 兜底 `MEMORY_HEALTH_REQUEST_FAILED`）。
- `src/components/MemoryHealthPanel.tsx`：`data-testid="memory-health-panel"` + 每项 `memory-health-metric-<key>`；未知值用琥珀色（`text-amber-800`）；失败保留旧值 + `role="alert"` 错误行；从未成功过则四项「未知」+ 原因「数据未能读取：请刷新重试」。
- 挂载点：`src/components/ProjectCockpitView.tsx` 右栏（`{/* Continuation Packs Detail */}` 之前）`<MemoryHealthPanel novelId={novel.id} />`。

**错误码**：`MEMORY_HEALTH_NOVEL_NOT_FOUND`（404）、`MEMORY_HEALTH_INTERNAL_ERROR`（500）、客户端 `MEMORY_HEALTH_REQUEST_FAILED`。

**证据（2026-09-27）**
- 后端 `tests/memory-health.test.ts` **5/5**（metrics 逐项等于 `buildForeshadowSettlementChecklist` / `countStaleKnowledgeRows` / `computeOrphanEntityIds`，且路由响应与 `collectMemoryHealth` 同源；未摄入 → 图谱三项未知且响应中 0 的个数为 0；已摄入真 0 → 0；索引存在但嵌入不可用 → RAG 未知；作品不存在 → 404）。
- 面板 `src/tests/memory-health-panel.test.tsx` **4/4**；驾驶舱挂载 `src/tests/cockpit-memory-health-mount.test.tsx` **2/2**。
- 定向门禁：eslint 0；后端定向 44/44；前端定向 27/27；六场景阶段快照与批次 C 逐字节一致（本批次不改 prompt）。
- 全量回归：`npm test` **1374/1374**（FULL_BE_EXIT=0）；`npm run test:frontend`（156 files / 1001 tests）。

**残余（已登记）**
- RAG 命中为「按需现算」（打开驾驶舱触发一次检索），未缓存、无历史快照；
- 孤立节点只看 `entity_relationships`，不看章节出场（世界实体无章节溯源列）；
- 只做了驾驶舱形态，未做状态栏形态；四个指标只展示数值，无阈值/告警。

#### 5.10 长篇记忆基线（批次 D 小类「长篇记忆基线」）

**目标**：用固定长书样本量化「中段章节」的实体/伏笔命中率，给出**接入前基线**、**接入后数值**与**可复跑脚本**（口径固化在本文档）。

**样本（脚本内置，确定性合成）**
- 48 章长书；中段观测章 = **Ch025–Ch036**（12 章，距开局 ≥24 章，远超近期 2–5 章台账窗口）。
- 22 个实体（12 角色 + 4 地点 + 3 道具 + 3 势力）、12 条 `entity_relationships`。
- 12 条**长程回声**：token `回响-01..12` + 3 个领域词，埋设在 Ch003–Ch014（= 中段章 − 22），只存在于早期章节正文（向量分片载体）；中段章正文/分镜不含该 token（基线回声必须为 0 的前提）。
- 4 条未回收伏笔（`planted`，埋设 Ch003/Ch007/Ch012/Ch030）+ 1 条已回收；逐章细纲资料包（`### ChNNN · 第N章` + 出场角色/场景/目标）。
- 全程离线：桩 provider 抓三阶段请求；确定性嵌入（汉字 bigram 哈希 → 256 维 L2 归一化 + 余弦）桩检索；`initDb(':memory:')` 隔离库，不碰生产库。

**三态与命中定义**

| 态 | 分镜声明出场 | 图谱面 | 语义召回 |
|---|---|---|---|
| A 接入前 | 否 | 全量注入（等同批次 C 过滤修复前的有效行为） | 无 |
| B 图谱选择性注入 | 是（`**出场人物**：…`） | 按 cast 过滤（`contextEntityFilter`） | 无 |
| C 接入后 | 是 | 按 cast 过滤 | 有（§5.8 `buildSemanticRecallSection`） |

- **实体 recall** = 本章细纲声明实体 ∩ **writer 阶段**请求 system 注入中出现的实体 ÷ 声明实体数；
- **实体精确率** = 声明实体在 writer 注入实体中的占比（1 − 噪声率）；
- **长程回声命中** = 回声 token 是否出现在 writer 阶段请求内容中。

**数值（2026-09-27，`node --import tsx scripts/long-memory-baseline.ts`）**

| 状态 | 实体 recall(writer) | 实体精确率(writer) | 长程回声命中率 | 平均注入实体数(writer) | 规划期实体数 | 审稿期实体数 |
|---|---|---|---|---|---|---|
| A-接入前 | 1.000 | 0.250 | 0.000 | 16.0 | 16.0 | 0.0 |
| B-图谱选择性注入 | 1.000 | 0.428 | 0.000 | 9.5 | 16.0 | 0.0 |
| C-接入后 | 1.000 | 0.428 | 1.000 | 9.5 | 16.0 | 0.0 |

- 方向断言（脚本退出码）：基线回声 = 0 ✅；接入后回声 ≥ 0.9 且高于基线 ✅（12/12 章命中）；精确率提升 ✅（0.250 → 0.428）；recall 不下降 ✅（1.000 → 1.000）。
- 口径说明：planner 阶段保持全量（16）是刻意设计（规划需要全局视野）；critic 阶段不注入图谱（0，与 §5.8 审计路径一致）；三态 recall 都满值的原因是「声明实体本就都在全量图册里」，区分度体现在**精确率**（注入实体 16 → 7–11，均值 9.5）与**长程回声**。
- 复跑：`node --import tsx scripts/long-memory-baseline.ts`（脚本自建 `/tmp/inkflow-lb-config` 隔离配置，不读 `~/.inkflow`；任一方向断言失败退出码 1）；产物 `/tmp/long-memory-baseline.json` / `.md`。

**残余（已登记）**：样本是确定性合成长书，非真实作品；回声口径是「token 是否进入 writer 请求」而非「模型是否实际使用」；planner/critic 两阶段未纳入命中率口径；未接 CI（需手动跑脚本）。

#### 5.11 链路稳定性与确定性（跨链路守卫，2026-09-27）

**目的**：部件级测试（单步各自正确）≠ 链路之间稳定。本节把跨链路不变式钉成测试。

| 不变式 | 断言 | 位置 |
|---|---|---|
| 确定性（同进程） | 6 条链路 30 步各解析两次，`{flowStep, stagePrompts, skillStack}` 的 sha256 指纹逐字节一致；30/30 `stageSource==='declared'` | `tests/flow-chain-determinism.test.ts` 用例 1 |
| 确定性（跨进程） | `scratch/stageprompts-snapshot.ts` 两次独立进程输出 6 场景哈希逐项一致（SNAP_CMP_EXIT=0） | `scratch/snap-compare.py` |
| 链路间零泄漏 | 30×29=870 组对照：任一步骤的 `【流程步骤：<name>】` marker 不出现在另一链路/另一步骤的 planner·writer·critic 提示词 | 用例 2 |
| 顺序无关 | 倒序解析其余 29 条链路后，本链路契约指纹不变（无共享可变状态） | 用例 3 |
| 时钟无关 | `mock.timers` 位移到 1.7e12 / 2e12 两个时刻，取样链路契约指纹不变 | 用例 4 |
| 状态隔离与幂等 | 跳过记录按 `activeSeriesId` 过滤（flow-a 的 `skipped-step:` 对 flow-b 不可见）；`formatFlowStepSkipTag → parseFlowStepSkipTag` 往返保真（原因含冒号）；连续推进两步标签无重复（不膨胀）；不带原因重新完成清除该步旧记录 | 用例 5 |
| 定义源稳定 | 公开目录（链路定义唯一来源）重复构建 + 时钟位移后 `renderPublicCatalogModule` 产物逐字节一致（>100_000 字符） | 用例 6 |

**非确定源审计**：`server/helpers/writing-style-service.ts`（2099 行）与 `shared/lib/flow-step-{card-slot,gate,stage,guidance}.ts`、`shared/lib/chapter-production.ts`、`shared/lib/prompt-governance-catalog.ts` 对 `Date.now` / `Math.random` / `randomUUID` / `new Date` / `performance.now` / `crypto` **0 命中**；仅 `server/helpers/ai-production-pipeline.ts` 有 4 处 `Date.now()`（:564 调试日志、:602/:683/:696 耗时统计），均不进入提示词。

**证据（2026-09-27）**：`tests/flow-chain-determinism.test.ts` → 6/6；定向回归（flow-step-card-slot / flow-step-gate / flow-step-stage / flow-step-guidance / execution-contract / flow-chain-determinism / public-catalog-freshness）**76/76**；全量 `npm test` **1380/1380**（基线 1374 + 6）；`npx tsc --noEmit` 0；`npx eslint … --max-warnings=0` 0。

**口径与残余**：
- 本守卫钉的是**契约层**确定性（图谱过滤、卡槽位、阶段声明、标签推进、目录定义）；**模型输出层**（温度/采样导致的文本差异）不在范围内。
- 跨进程证据当前由 `scratch/` 工具复跑（未纳入自动化测试）。
- 集成缝：`resolveProjectExecutionContract(novelId, input?)`（`server/helpers/writing-style-service.ts:2077` ＝ `resolveWritingStyleRequest(...).executionSnapshot`）。

### 批次 D：长期记忆与可见性

1. 生产管线接入语义检索层（按章取回相关片段）；✅ 2026-09-27（见 §5.8：单源 `buildSemanticRecallSection` + 三阶段末位注入 + 双层预算 + 两条降级零变化）
2. 驾驶舱/状态栏暴露记忆健康度（未回收伏笔、孤立节点、RAG 命中、stale 数）；✅ 2026-09-27（见 §5.9：`shared/lib/memory-health.ts` 单源 + `GET /api/novels/:novelId/memory-health` + 驾驶舱面板；缺数据显示「未知」）
3. 建长篇基线对比（中段章节实体/伏笔命中率）；✅ 2026-09-27（见 §5.10：固定 48 章样本 + 三态对比 + 可复跑脚本 `scripts/long-memory-baseline.ts`；实体精确率 0.250 → 0.428、长程回声命中率 0.000 → 1.000）

## 6. 验收口径

| 批次 | 可测断言 |
|---|---|
| A | ① 新增一张卡只改治理货架一处，商店与运行时同时可见；② 旧装配字段读取兼容（迁移测试）；③ 卡面统计脚本输出 role/scope/stage 三维且旧 kind 映射 100% 覆盖 |
| B | ① 任一步骤挂用户技法/能力卡后，对应阶段 prompt 出现该卡内容（字符命中）；② 质量门未达标时步骤不可推进（或给明确阻塞）；③ 空壳链路可运行步骤占比 ≥80% 或显式标注为引导（2026-09-28 追补：三条全壳链路各补 1 条可运行步骤 → 可运行 16/30=53.3%，仍走「显式标注」分支） |
| C | ① 资料包确认后一键重跑图谱并输出覆盖度（✅ §5.6）；② 至少 1 张图谱卡可装配（✅ §5.5）且进入链路步骤（待第 4 条）；③ 章节删除后相关边/台账被标记 stale 且可查询（✅ §5.7） |
| D | ① 生产管线 prompt 中出现 RAG 片段 marker（✅ §5.8）；② 驾驶舱显示记忆健康度数值（✅ §5.9）；③ 长篇中段命中率相对基线有可量化提升（✅ §5.10） |
| 全批次 | 链路稳定性与确定性：30 步契约重复解析指纹一致 / 30×29 零泄漏 / 顺序与时钟无关 / 目录产物逐字节稳定（§5.11） |

## 7. 证据与复跑脚本

| 脚本 | 用途 |
|---|---|
| `scratch/capability-audit.ts` | 目录/类型/作用域/来源统计 |
| `scratch/card-role-coverage.ts` | 角色投影覆盖度（28 张 manifest〔26 非 flow〕+ 179 张治理资产，0 未映射） |
| `scratch/deck-check2.ts` | 技法通道 vs 能力卡通道的注入实证 |
| `scratch/flow-audit.ts` | 6 条链路 30 步的可运行/仅引导分布、**声明阶段**分布与语义一致性自校验（§5.3/§5.4 口径） |
| `scratch/shell-audit.ts` | 壳卡步骤的资产元数据（引用壳形态/长度/治理标记）与可替代候选（2026-09-28 追补后 14 个） |
| `scratch/shell-backfill-audit.ts` | 仓内可运行真实正文资产清单与关键词命中（补正文可行性取证） |
| `scratch/real-run.ts`（`USE_CPA=1`） | 隔离库真实 provider 章节生产观测 |
| `scratch/gemini-effort-ab.mjs` | thinking 档 A/B |
| `scratch/model-sweep.log` / `critic-screen.log` | 模型可用性 / critic JSON 契约筛选 |
| `scripts/long-memory-baseline.ts`（**随仓库交付**） | 长篇记忆基线：48 章样本三态命中率对比（§5.10 口径）；任一项方向断言失败退出码 1 |

复跑（生产管线检索注入，批次 D 小类）：

```bash
node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/production-semantic-recall.test.ts   # 6/6
NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts \
  tests/production-prompt-sentinel.test.ts tests/server-story-context.test.ts tests/story-context-load-scope.test.ts   # 回归
node --import tsx scratch/stageprompts-snapshot.ts   # 六场景哈希应与上面基线逐项一致
```

复跑（记忆健康度看板，批次 D 小类）：

```bash
NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/memory-health.test.ts   # 5/5
npx vitest -c vitest.config.frontend.ts run src/tests/memory-health-panel.test.tsx src/tests/cockpit-memory-health-mount.test.tsx   # 4/4 + 2/2
npx eslint server src shared tests scripts --max-warnings=0   # 0
```

> 注：`scratch/` 已被 `.gitignore` 忽略；脚本仅本地复跑用，不随仓库交付。

复跑（长篇记忆基线，批次 D 小类）：

```bash
node --import tsx scripts/long-memory-baseline.ts   # 12 章 × 3 态；四项方向断言应全 PASS（退出码 0）
# 产物：/tmp/long-memory-baseline.json、/tmp/long-memory-baseline.md
# 快查（单章 / 单态）：LB_CHAPTERS=25 LB_STATES=A,B node --import tsx scripts/long-memory-baseline.ts
```

> 注：`scripts/long-memory-baseline.ts` 随仓库交付；`scratch/` 内的同名文件是工作副本。


复跑（目录单源与新鲜度）：

```
node --import tsx scripts/generate-public-catalog.ts        # 重跑生成脚本（产物必须无 diff）
node --test --import tsx tests/public-catalog-freshness.test.ts tests/public-catalog-governance.test.ts
```

复跑（步骤阶段语义化）：

```
node --import tsx scratch/flow-audit.ts                     # 30 步声明分布 + 语义一致性（应 PASS）
node --test --import tsx tests/flow-step-stage.test.ts      # 纯函数 + 30/30 集成
```

复跑（空壳链路清账）：

```
node --import tsx scratch/flow-audit.ts                     # 16 可运行 / 14 仅引导 / 静默壳 0（应 PASS）
node --test --import tsx tests/flow-step-guidance.test.ts   # 纯函数 + 目录守门 + 集成（15/15）
npx vitest -c vitest.config.frontend.ts run src/tests/planning-tab-step-guidance.test.tsx
```

复跑（图谱维护入口）：

```
node --test --import tsx tests/knowledge-capabilities.test.ts        # 含重跑不产生重复行 + 无资料包零写入（9/9）
npx vitest -c vitest.config.frontend.ts run src/tests/knowledge-maintenance-panel.test.tsx   # 六项数值/幂等/失败保留旧值（5/5）
```

复跑（图谱失效语义）：

```
node --test --import tsx tests/knowledge-staleness.test.ts       # 删除打标/可查询 + 重跑不删除 + coverage 可读（3/3）
npx vitest -c vitest.config.frontend.ts run src/tests/knowledge-maintenance-panel.test.tsx  # 失效台账/失效边可见 + 说明（7/7）
```

复跑（图谱能力卡）：

```
node --test --import tsx tests/knowledge-capabilities.test.ts   # 登记/解析/幂等/清单/错误码/路由（7/7）
node --test --import tsx tests/prompt-assets-governed.test.ts   # 内置 17 / 源目录 179
node --import tsx scratch/card-role-coverage.ts                 # 179 张 0 未映射（transform 32）
node --import tsx scratch/stageprompts-snapshot.ts              # 工具卡不得进入三阶段提示（哈希逐项不变）
```
复跑（链路稳定性与确定性）：

```
node --test --import tsx tests/flow-chain-determinism.test.ts   # 6/6：指纹一致 / 零泄漏 / 顺序 / 时钟 / 标签隔离 / 目录稳定
node --import tsx scratch/stageprompts-snapshot.ts              # 两次独立进程比对（scratch/snap-compare.py）
```

## 8. 风险与回滚

- **数据模型迁移风险**：`capabilityProfile` 是用户作品数据。迁移必须"只加字段、不删旧字段"，并用双向兼容读取；批次 A 交付前不得改变任何 prompt 内容（可用现有 stagePrompts 快照做回归）。
- **质量门落地风险**：把 `gate` 绑定到真实门禁会改变"步骤能否推进"的行为，需要在批次 B 单独验收，避免把用户卡死；提供"跳过（记录原因）"逃生门。
- **图谱补偿风险**：章节删除触发 stale 标记属于写操作，需幂等且可重跑；不得删除既有边。
- **回滚**：每批次独立开关（env 或 profile 字段），关闭后行为回到当前实现。
