# Plan 158：完成能力商店、技法与拆书技能卡生命周期治理

> **执行说明**：本计划是 Plan 156/157 之后的能力模型收口计划。按步骤执行，每一步都先补失败测试，再实现，再运行对应验证。若触发“停止条件”，必须停止并报告，不得临时发明第三套能力模型。完成后更新 `plans/README.md` 状态。
>
> **漂移检查**：`git diff --stat dff4445..HEAD -- shared/types shared/lib/capability-manifest-catalog.ts shared/lib/project-preference-profile.ts server/capabilities server/helpers/writing-style-service.ts server/helpers/writing-style-resolver.ts server/validation.ts server/routes/agents.ts server/routes/writing-style.ts server/routes/utilities.ts src/components/SkillsStudioView.tsx src/components/AppShell.tsx src/components/EditorView.tsx src/components/book-factory src/components/skills/SkillFusionWorkbench.tsx src/lib/capability-governance.ts src/lib/skills-studio-governance.ts src/lib/hooks/generation/useDraftGeneration.ts src/lib/skill-fusion.ts`
>
> 当前工作区含大量未提交改动，全部视为用户现状。执行者不得回滚、覆盖或格式化无关文件。

## Status

- **Priority**：P0 产品模型与正确性
- **Effort**：L
- **Risk**：HIGH，涉及能力分类、历史装配兼容、写法指纹与正文生成上下文
- **Depends on**：`plans/156-creative-chain-capability-lifecycle-convergence.md`；本计划已内联 Plan 157 的相关可靠性约束，不依赖未落盘文件
- **Category**：correctness / architecture / product journey / tests
- **Planned at**：commit `dff4445` + 2026-08-10 本地未提交状态；2026-08-10 按实际 diff、产品旅程与三路 Agent 证据四次复核
- **Status**：DONE（2026-08-11 多 Agent 并发定向复核 + 串行最终门禁完成）

## 核心结论

Planner / Writer / Critic 是内部执行角色，不应继续作为用户只能三选三的稀缺装备槽。用户真正需要管理的是：一条作品 Flow、按阶段使用的写作技法、由拆书或作者风格产生的技能卡组、本章临时叠加卡、单次诊断/工具，以及自动质量护栏。

```text
作品长期状态
  ├─ 1 条 active Flow
  ├─ 常用 Techniques（不占卡槽）
  └─ 项目 Skill Deck：1 主卡 + 最多 2 辅卡

章节运行状态
  ├─ 当前 Flow step
  ├─ 本章启用 Techniques
  └─ Chapter Overlays（与项目卡合计最多 6 张）

系统运行状态
  ├─ Planner / Writer / Critic 内部路由
  ├─ Diagnostics / Utilities 按需执行
  └─ Guardrails 自动执行并出示凭证
```

“黄金三章”属于 Planner 阶段技法或 Flow 节点；世界观/人设生成器属于产出 Canon 候选的规划技法；口语化、动作画面属于 Writer 技法。它们不占拆书技能卡组的位置。

拆书能力的差异化是从具体作品证据中提炼可迁移规则，形成可组合、可试用、可融合、可追溯的 Skill Card。项目卡组使用“一张主卡 + 两张辅卡”；显式融合则从一张主卡和一张支持卡生成一个带冻结规则、版本和 lineage 的新卡，不能只保存名称或 `fusionMeta` 标签。

## 当前实现状态与验证证据

以下结论来自 2026-08-11 对实际源码、串行门禁和桌面/移动旅程的重新核验。

### 已落地并完成总装

1. `shared/lib/capability-manifest-catalog.ts` 已把黄金三章、世界观、人设和正文表达能力分为 Technique，把拆书/风格资产分为 Skill Card；Planner/Writer/Critic 已从能力中心主展示移除。
2. `server/helpers/writing-style-service.ts` 已让 v3 Flow 读取 `capabilityProfile.activeFlowId`，恢复章节 `overlayCardIds`，并把版本、来源、位置、维度所有权、冻结规则和 lineage 写入 `ExecutionSnapshot` 与指纹。
3. `/api/orchestrate`、`/api/orchestrate-draft` 和正文生成客户端已贯穿 `chapterId + databaseGeneration`；相关定向测试、全量类型检查和 AI 主入口已统一验收。
4. 能力配置已增加 `preview → apply` 原子契约；`SkillsStudioView.tsx` 使用 `configurationDraft`，保存失败保留草稿，成功后才刷新并通过“应用配置并返回写作”回到原章节。能力中心定向与全量前端测试均通过。
5. `AppShell.tsx` 已透传 `targetChapterId`；只有本章卡、诊断和工具创建 Editor launch，Flow、Technique 收藏和项目 Deck 配置留在能力中心。

最终总装证据（2026-08-11）：`npm test` 866/866（27 suites）、`npm run test:frontend` 583/583（97 files）、Chromium 20/20、Mobile Chromium 5/5、typecheck、lint、build（2099 modules）、`npm audit --omit=dev`（0 vulnerabilities）和 diff check 均退出 0。所有测试使用隔离数据库；未访问运行中的 `data.db`。构建与 E2E 在串行条件下执行，避免构建产物竞态。

### 已关闭的风险

1. 配置候选和替换决策按作品与 generation 恢复；旧作品/旧 generation 不可误应用。
2. 替换层展示名称、来源、版本、卡型、维度冲突和替换影响；未知历史卡只能待整理。
3. 离开脏草稿提供继续配置、放弃变更、应用并返回三种明确动作。
4. 已保存 Skill Card 原地进入候选，不跳 Editor；能力包改为展开、勾选、提交，未加入能力库的外部资产可在弹层内显式“加入并选中”，无需关闭弹层往返货架。
5. 用户可达界面不再挂载旧三角色装配；Technique 不占 Skill Deck。
6. `capabilityMemberships` 保存 source→persisted 映射，刷新后由服务端治理 ID 解析。
7. Skill Card、Deck、迁移、章节 overlay、融合共用持久化门禁和冻结快照。
8. 页面文案统一为能力中心、我的能力库、当前作品配置、本章使用；商店目录评分改为冷启动证据。

## 八刀法收束

1. **历史**：三槽最初用于 Planner/Writer/Critic 阶段路由，后来技法、商店资产和拆书卡都借用了这套 UI，槽位逐渐承担了不相容的职责。
2. **辩证**：装配能让行为可控，但把所有能力都装配会压缩创作能力；正确做法是只让会长期改变写法的技能卡占卡组位置。
3. **现象**：用户想连续挑选多张能力，却每次被送回写作页；系统强迫用户围绕内部 Agent 结构工作。
4. **边界**：Flow 决定步骤，Technique 决定做法，Skill Card 决定可迁移风格/方法，Diagnostic 只读检查，Utility 临时产出，Guardrail 自动守底线。
5. **结构**：有效生成上下文 = Canon + Flow step + Techniques + Skill Stack + Guardrails；内部角色只负责消费这些输入。
6. **前提**：只有来源可信、运行规则完整、版本可追溯的卡才能进入栈；前提不成立时只能收藏或显示不可用。
7. **美感**：能力中心应像配写作工具箱，作者可以一次选完再回正文，而不是每拿一件工具就被送出房间。
8. **元反思**：过去用“装备槽”理解全部能力，遮蔽了生命周期；改用“流程 + 技法 + 卡组 + 临时工具”后，选择规则自然分开。

**内观**：我作为能力中心，不该替作者写，也不该每选一项就把作者赶回正文。我负责让作者看清每项能力从哪里来、何时生效、会改变什么，再把一次完整选择安全地交给运行链。若我把来源、类型和作用域混成一个“装配”按钮，作者就只能靠试错理解系统。

**一句话顿悟**：三槽限制来自错误分类，不来自创作能力本身。

**核心公式**：`执行上下文 = Canon + Flow + Techniques + Skill Stack + Guardrails`

## 产品问题与成功标准

当前问题不是“槽位太少”，而是流程、技法、拆书卡、来源和商店动作共用了一套“技能装配”隐喻：用户看不出什么会长期生效、什么只在本章使用、什么只是收藏，也无法在能力商店连续完成配置。

本计划服务三个用户任务：

1. 作者进入能力商店后，可以一次浏览、比较并选择多项能力，不被每次操作强制送回编辑器。
2. 作者无需理解 Planner / Writer / Critic，也能知道某项能力是流程、技法、拆书卡、诊断、工具还是系统护栏，以及它何时生效。
3. 作者可以把拆书或作者/作品风格提炼卡组成“一主两辅”，必要时增加本章临时卡或显式融合，但不会因为启用黄金三章等技法而耗尽卡组位置。

产品验收不以“按钮出现”为准，而以四个结果为准：连续配置不跳页、运行上下文真实包含所选能力、写法变化正确 stale、失败后配置草稿与正文均可恢复。

## 统一能力契约

`CapabilityManifestEntry.kind` 的新写入只允许六类：

| 类型 | 用户理解 | 作用域 | 用户动作 | 是否占卡组 |
|---|---|---|---|---|
| `flow` | 一整套连续创作流程 | project | 启用/替换 Flow | 否 |
| `technique` | 黄金三章、世界观生成、动作增强等阶段技法 | project 收藏；chapter/single-run 使用 | 收藏、用于本阶段 | 否 |
| `skill-card` | 拆书、作者或作品风格提炼出的可组合规则 | project deck / chapter | 加入主卡、辅卡或本章卡 | 是 |
| `diagnostic` | 逻辑、套话、平台适配等只读检查 | single-run | 运行诊断 | 否 |
| `utility` | 取名、简介、预览改写等临时工具 | single-run | 运行或预览 | 否 |
| `guardrail` | 默认质量底线 | system | 自动运行、查看凭证 | 否 |

- `role-skill`、`overlay` 仅作为 v2 读取兼容类型；新 manifest、新写入和新 UI 不再产生它们。
- `allowedScopes` 是唯一作用域真相；旧 `persistence` 只保留兼容投影。
- Flow 包含多个 step，每个 step 可引用 Techniques；“一整套连续使用”由 Flow 表达，不把整套能力压成一张卡。
- 散装 Technique 可收藏并在适用阶段启用，不改变 active Flow，也不占 Skill Deck。
- 只有真实接入默认执行链且能出示执行凭证的 `core-default` 资产可以标为 Guardrail；“官方内置”本身不等于自动生效。

### 来源与状态必须正交

| 来源 | 含义 | 是否需要选择 |
|---|---|---|
| `built-in` 官方内置 | 官方维护、随版本交付 | Guardrail 自动；Flow/Technique/Skill Card 若会改变创作结果，仍需用户显式启用或加入卡组 |
| `plaza` 广场共享 | 社区或共享资产，保留作者、版本、审核状态 | 首次加入能力库时幂等保存来源；之后按能力类型使用 |
| `licensed` 授权增强 | 有明确授权与适用范围的增强资产 | 按能力类型使用；授权状态只控制可用性，不改变装载方式 |

每张资产同时显示四个独立状态：`来源`、`运行可用性`、`当前作用域`、`是否已加入我的能力`。禁止用“官方”“授权”推断自动装配，也禁止把 Beta 开放写成购买、会员或永久权益。

### 能力包只是分发容器

- “一整套连续使用”的能力包不是第七种运行类型。它是目录中的分发容器，可包含一个 Flow、若干 Techniques、Diagnostics 和可选 Skill Cards。
- 点击能力包先打开组件清单，逐项说明“将启用流程 / 收藏技法 / 加入卡组 / 仅提供工具”；只提交用户勾选的组件，不得整包静默注入 Prompt。
- Flow 决定连续步骤；Technique 决定某一步的做法；Skill Deck 决定可迁移写法。能力包自身不进入 `ExecutionSnapshot`，只展开成这些规范化组件。
- 拆书 Deck 同样保留 `deckGroupId` 和组内关系，但逐卡进入主卡、辅卡或本章卡；“整套 Deck”不额外占一个槽，也不等于融合卡。

### 收藏、启用和装载必须分离

| 类型 | 获得/收藏 | 项目长期配置 | 本章/单次使用 | 是否自动运行 |
|---|---|---|---|---|
| Flow | 加入我的能力 | 显式启用且同一作品唯一 | 按当前 step 运行 | 否 |
| Technique | 可收藏多个 | 仅保存常用清单，不注入 Prompt | 由 Flow step 引用或作者本章启用 | 否 |
| Skill Card | 保存来源与证据 | 显式选择 1 主 + 最多 2 辅 | 可追加本章卡，总有效卡不超过 6 | 否 |
| Diagnostic | 无需装配 | 无 | 显式运行，只读报告 | 否 |
| Utility | 无需装配 | 无 | 显式运行；改写只返回预览 | 否 |
| Guardrail | 随系统提供 | 无用户槽位 | 默认链自动运行并记录凭证 | 是 |

- `built-in` 资产已经存在于“我的能力”，不显示“导入”；但除 Guardrail 外，仍按上表显式启用或使用。
- `plaza` 和 `licensed` 先幂等加入“我的能力”，再按类型配置；授权只控制可用性，不替代用户选择。
- `favoriteTechniqueIds` 只是收藏清单，绝不能直接进入 Prompt 或写法指纹；真实运行只读取 Flow 当前 step 和 `chapter.workflowMeta.capabilityState.techniqueIds`。
- 只有 `kind=skill-card`、runtime-ready、规则可追溯且版本完整的资产能进入 Skill Deck。来源可以是本地拆书、作者/作品风格提炼或已发布的共享卡；Flow 和 Technique 永远不能伪装成卡组成员。

## 数据与运行时模型

不新增依赖，不做 SQLite 列迁移。复用现有 JSON 字段：

```ts
interface ProjectCapabilityProfile {
  version: 3;
  activeFlowId?: string;
  projectSkillDeck: {
    mainCardId?: string;
    supportCardIds: string[]; // 最多 2 张
    updatedAt: number;
  };
  favoriteTechniqueIds: string[];
  capabilityMemberships: Array<{
    sourceId: string;
    sourceVersion: string;
    persistedSkillId?: string;
    sourceType: 'built-in' | 'plaza' | 'licensed' | 'book-extracted';
  }>;
  migrationPendingIds?: string[];
}

interface ChapterCapabilityState {
  novelId: string;
  databaseGeneration: number;
  techniqueIds: string[];
  overlayCardIds: string[];
  updatedAt: number;
}

// 仅用于前端配置会话，不写入作品 profile，也不进入 Prompt。
interface CapabilityConfigurationSession {
  novelId: string;
  databaseGeneration: number;
  baselineToken: string;
  draftProfile: ProjectCapabilityProfile;
  candidateCardIds: string[];
  pendingReplacement?: {
    candidateId: string;
    targetId?: string;
    target: 'main' | 'support';
  };
  view: {
    tab: 'library' | 'store';
    capabilityKind: CapabilityKind;
    stageFilter: string;
    selectedAssetId?: string;
    scrollTop: number;
  };
  dirty: boolean;
  updatedAt: number;
}
```

- 项目状态写入 `projectPreferenceProfile.capabilityModelVersion = 3` 和 `capabilityProfile`。
- 本章状态写入 `chapter.workflowMeta.capabilityState`。
- `capabilityMemberships` 以 `sourceId + sourceVersion` 去重；广场/授权资产加入后必须保存服务端返回的 `persistedSkillId`。项目 Deck、章节卡、融合 lineage 和运行请求只使用 `persistedSkillId`，`sourceId` 只用于来源追踪和幂等导入。
- `CapabilityConfigurationSession` 是客户端配置事务，不是运行时能力。它复用现有 store/session 持久化机制，以 `novelId + databaseGeneration` 绑定；用于恢复候选、替换决策和页面位置，但不得写入作品 profile、产品事件详情或 Prompt。应用成功或用户明确放弃后清除；作品/generation 不匹配时保留为可查看草稿并禁止直接应用。
- 章节能力状态必须验证 `novelId`、当前数据库 generation、章节归属和每个能力的当前版本/授权。删除、撤权或版本失配时保留原 ID 并进入明确的 stale/待整理状态，不静默删除、不继续注入 Prompt。
- 项目卡与本章卡合并、去重后最多 6 张；超限返回稳定错误，不静默截断。
- 主卡拥有整体风格/方法方向；辅卡必须声明接管的维度。冲突维度显示给用户确认，不允许数组后项静默覆盖前项。
- `ExecutionSnapshot` 必须一次冻结 `flowStep`、`techniques`、`skillStack`、`guardrails` 和写法指纹。读取作品、章节、资料包、Flow、能力目录后必须在同一序列化读取边界内完成，或在冻结前后各校验一次相同 generation；任一变化立即拒绝。Planner/Writer/Critic 只消费冻结快照，不再从 DB 二次读取造成 TOCTOU。
- Writer 相关 Technique、项目卡、章节卡、融合卡版本或实际规则变化时写法确认 stale；纯 Planner Technique、只读 Diagnostic、非文风资料包字段变化不得误触发。
- `roleSkills/stageSkills/sessionCards/overlays` 在兼容期只作为 v2 读取/回显投影。v3 新配置不得写入这些字段，它们也不得影响 v3 Prompt；无配置时由治理目录中的阶段默认能力生成显式 `techniques/guardrails` 快照，不回退复活旧三槽。
- 章节型 AI 入口必须携带 `chapterId + databaseGeneration`；非章节型入口使用独立的 `databaseGeneration + session/context id`，不能伪造章节 ID。服务端校验作用域、归属、generation、授权后，从数据库读取治理 ID 对应规则；客户端不得提交卡片正文或融合规则正文。
- `writing-style` mode 增加 `skill-deck`。确认接口只能局部更新 `writingStyleConfirmation`，必须保留 `capabilityModelVersion`、`capabilityProfile`、配额、商业状态和未知扩展字段，禁止重新写回 `skillLoadoutSchemaVersion: 2`。
- Skill Stack 快照至少冻结 `id`、`version`、来源、主/辅/章节位置、`dimensionOwners`、规范化 `resolvedRules` 摘要和 lineage。卡片版本、Writer 规则或维度所有权变化必须生成新指纹。
- 跨作品、旧 generation、未知、撤权、scope 不匹配、超限和维度冲突必须在配额、run/job 与模型调用前返回稳定错误码；任何读取边界不得用 `.slice()` 静默修复非法 Deck。
- Flow 只读取 `capabilityProfile.activeFlowId`；`activeSeriesId` 只能作为 v2 读取投影，v3 新写不得把它作为第二真相源。

### AI 入口与错误契约

| 入口类别 | 代表入口 | 必需上下文 | 副作用前守门 |
|---|---|---|---|
| 章节正文 | orchestrate、orchestrate-draft、production、rewrite | `novelId + chapterId + databaseGeneration` | 章节归属、generation、写法指纹、能力快照 |
| 章节审稿 | audit、章节 editor-agent、capability execute | `novelId + chapterId + databaseGeneration` | 同上；只读诊断不得写正文 |
| 非章节规划 | welcome、inspiration、world-onboarding、立项、全书大纲 | `databaseGeneration + session/context id` | generation 与会话归属；不得读取章节 Deck |
| 资料处理 | 资料包提取、Canon/全局资料工具 | `novelId + databaseGeneration` | 作品归属、generation、输入预算 |

稳定错误码统一为：缺少作用域 `SCOPED_CONTEXT_REQUIRED`（400）、章节/作品不匹配 `CHAPTER_SCOPE_MISMATCH`（403）、generation 过期 `DATABASE_GENERATION_STALE`（409）、能力类型错误 `CAPABILITY_KIND_INVALID`（400）、scope 错误 `CAPABILITY_SCOPE_INVALID`（400）、授权失败 `CAPABILITY_ACCESS_DENIED`（403）、运行未就绪 `CAPABILITY_NOT_RUNTIME_READY`（409）、卡组超限 `SKILL_DECK_LIMIT_EXCEEDED`（409）、维度冲突未确认 `SKILL_DECK_CONFLICT_UNRESOLVED`（409）。客户端只依赖错误码，不解析文案。

“守门失败零副作用”特指：配额预占/扣除、run/job 创建、Provider 调用、正文/作品/章节写入均为 0。安全限流和脱敏失败事件允许发生，但不得记录正文、Prompt、规则正文或完整 profile。

### 融合规则

- 显式融合一期固定为“一张主卡 + 一张支持卡”。整套 Deck 不是融合，Flow 也不是融合。
- 输出新卡必须保存 `components[{ skillId, version }]`、`dimensionOwners`、规范化后的 `resolvedRules`、冲突与风险、来源 lineage 和新版本。
- 融合先作为项目/本章卡试用，不覆盖原卡；正文接受或连续使用只形成推荐，不自动替换。
- 任一源卡变化后旧融合卡仍按冻结规则可复现，同时显示“来源已有新版本”，由用户主动重新融合。

## 能力商店与能力中心修复

先区分两个产品职责：

- **能力商店**回答“有哪些能力可以获得”，负责浏览、来源、授权、证据和能力包展开。
- **作品能力中心**回答“当前作品正在使用什么”，负责 Flow、常用技法、Skill Deck、本章入口和系统护栏凭证。

两者可以继续位于同一页面的不同区域或 Tab，但状态与动作不能混用。“加入我的能力”不等于“立即启用”，“收藏技法”不等于“注入当前章节”。

能力中心改为五个用户可理解的区域：

1. `创作流程`：显示唯一 active Flow、步骤、产物和替换影响。
2. `写作技法`：按规划/正文/审稿阶段筛选，可连续收藏多个，不占卡组。
3. `拆书技能卡`：管理项目主卡、辅卡和来源 Deck；显示证据、维度、冲突与融合入口。
4. `诊断与工具`：只有真实执行时才带章节上下文进入 Editor；诊断永不修改正文，改写只能返回预览。
5. `系统护栏`：只读展示自动项、适用阶段、最近执行凭证；没有装配按钮。

页面信息架构只使用以下四层名称，禁止再用“技能”同时指代资产库与作品配置：

1. `作品能力中心`：页面总称。
2. `当前作品配置`：active Flow、常用技法、项目 Skill Deck 和待应用草稿。
3. `我的能力库`：已经保存或随系统提供的资产，不代表已在当前作品生效。
4. `能力商店`：发现、比较和获得广场/授权资产；官方内置资产直接存在于“我的能力库”。

动作动词固定为：Flow 用“启用/替换流程”，Technique 用“收藏技法/本章使用”，Skill Card 用“加入候选/设为主卡/设为辅卡/本章使用”，Diagnostic/Utility 用“立即运行/预览”，Guardrail 只显示“自动生效/查看凭证”。禁止对 Technique、Flow、Guardrail 使用“装备”，也禁止按钮声称“装备到作品”却只切换 Tab。

商店交互必须满足：

- 激活 Flow、收藏 Technique、加入/替换项目 Skill Deck 都在能力中心完成，不自动跳转 Editor。
- 每次操作后保留当前 tab、筛选、滚动位置和已选资产，支持连续选择。
- 右侧或底部使用一个“本次配置”区汇总待应用变化；一次持久化成功后才显示成功状态。
- 只有 `本章使用`、`运行诊断`、`运行工具/预览` 需要 Editor 的章节上下文，才通过 `CapabilityLaunchState` 跳转。
- 提供明确主动作 `完成配置并返回写作`，返回原作品、原章节；未保存正文必须先经过现有 flush 边界。
- 卡片按钮由 manifest 的 `kind/action/allowedScopes/runtimeStatus` 决定，不再根据名称、后缀、`curatedCategory` 或数组位置推断。
- “我的技能”改为“我的能力”；拆书 Deck 保留组关系，可逐卡加入卡组，Flow/Technique/Guardrail 不克隆成普通 Skill。
- 所有配置操作先写入页面内 `configurationDraft`，在“本次配置”区显示新增、替换、冲突和未保存状态；点击“应用配置”后通过一个服务端原子命令局部合并 v3 profile。失败保留草稿并允许重试，成功后才刷新“已启用/已加入”状态。
- `configurationDraft`、候选卡、替换决策、tab/filter/selectedAsset/scrollTop 必须组合成一个 `CapabilityConfigurationSession`。详情抽屉开关、内部 Tab 切换、保存失败、冲突取消和无副作用返回都不得重建该会话；页面刷新后可以恢复同作品同 generation 的未应用草稿。
- 项目配置动作不得创建 `CapabilityLaunchState`。项目 Deck 使用 manifest 的 `add-to-stack`，本章临时卡统一使用 `use-overlay`；只有 `use-technique`、`use-overlay`、`run-diagnostic`、`run-utility` 需要章节上下文时才创建一次性 launch token。`run-diagnostic` 不得降级或误发为 `run-utility`，禁止新增 `use-chapter-card` 同义动作。
- 主卡和辅卡必须由用户显式选择。替换层显示卡名、来源、版本、负责维度和替换影响，禁止只显示 ID，也禁止默认把“第一张”永久当成主卡。
- 连续点击 Skill Card 先进入 `configurationDraft.candidates`，随后由用户明确指定主卡或辅卡；前三张也不得按点击顺序自动分配。已有一主两辅时加入第四张，必须明确选择替换目标或取消，取消不改变草稿。
- “我的能力库”中的已保存 Skill Card 只能提供“加入当前配置候选”或“查看详情”；点击后必须真实加入当前会话候选并停留在能力中心。若产品只准备跳转到卡组区，按钮必须改名为“去配置卡组”，不得显示已完成式动作。
- 主辅替换层必须用持久化 ID 反查并展示卡名、来源、版本、卡型、负责维度、冲突和替换后失去/新增的规则摘要；无法解析 ID 时显示“待整理卡”并禁止确认，不得把裸 ID 当作用户决策信息。
- 页面从治理 manifest 派生唯一 presentation：来源、可用性、允许作用域、当前配置状态和唯一主动作。UI 不得再次根据 `actionType`、名称或旧分类自行推断。
- 从 Editor 打开能力中心时 `targetChapterId` 必须存在并绑定当前作品；“应用配置并返回写作”使用无生产副作用的 editor-return 动作，不触发 cockpit resume、自动生成或面板首发。章节已删除或作品已切换时保留草稿并返回稳定错误，不跳到默认章节。
- `tab + filter + selectedAssetId + scrollTop` 属于一次配置会话状态；加入卡、打开详情、保存失败和冲突取消后都要恢复，桌面 Playwright 必须断言滚动容器位置未重置。

能力包展开默认是纯预览：取消时不写作品 profile。未入库的外部组件必须由用户在弹层内逐项点击“加入并选中”；该动作只幂等写入“我的能力库”并把 `sourceId -> persistedSkillId` 加入本地配置草稿，不直接应用作品配置。最终“应用配置”通过 preview/apply 原子提交完整 profile；失败时保留草稿，禁止留下半套作品配置或只更新页面内 Set。刷新后的 membership 必须由服务端持久化映射计算。

## v2 → v3 兼容迁移

1. `mountedSkillLoadout`、`mountedSkillIds` 和 `skillLoadoutSchemaVersion: 2` 保持可读，不删除、不改 SQLite schema。
2. 没有 `capabilityModelVersion: 3` 的作品继续按 v2 运行，能力中心显示“旧装配待整理”；手写、保存、切章、导出始终可用。
3. 迁移建议按治理 manifest 和来源生成：
   - Flow 资产 → `activeFlowId` 候选。
   - 黄金三章、世界观、人设、正文表达类 → Technique 收藏候选。
   - `book-extracted` 且有完整 runtime rules 的卡 → Skill Deck 候选。
   - 无 manifest、重复、越界或规则不完整的历史技能 → `migrationPendingIds`。
4. 只生成预览，不静默迁移。用户确认后原子写入 v3 profile；成功后新写只更新 v3，v2 字段冻结为历史兼容数据。
5. v3 显式空 Deck/空 Technique 列表不得回退复活 v2 IDs。
6. 迁移函数必须幂等；重复打开、数据库 generation 变化和失败重试不能重复导入、重复装卡或覆盖新配置。
7. 提供“迁移预览 → 用户确认 → 原子应用”两步服务端契约。唯一写入端点是 `/apply`；`/confirm` 仅保留兼容别名且客户端新代码不得调用。预览返回候选 Flow、Technique、主/辅卡建议、待整理项和冲突，不写数据库；UI 的“确认”只触发一次 `/apply`，请求携带 preview token 与 generation，过期时重新预览，不自动重试。
8. 历史 manifest 在 v3 被重分类后，v2 运行仍按其历史角色投影验证，不能用当前 `kind` 反向判定旧数据非法。
9. malformed v3 数据必须显示稳定错误并进入修复路径；归一化只补缺失默认值，不截断超限辅卡、不删除未知 ID、不静默选主卡。
10. migration preview token 必须绑定 `databaseGeneration + project profile fingerprint`。预览后若能力配置草稿或项目 profile 改变，apply 返回 409、零写入并保留草稿；迁移结果不得覆盖同会话中新配置。

## 范围与约束

**允许修改**：

- 共享能力/执行/profile 类型与纯归一化函数。
- writing-style resolver/service、能力 manifest 校验、Agents/Production/Audit/Writing Style/Utility 路由及对应测试。
- 技能保存路由、`server/lib/db/skills.ts`、skill mapper、商店资产导入映射与对应 HTTP 测试；融合门禁必须位于服务端写入边界。
- 能力中心、AppShell/Editor 一次性 launch、Book Factory、融合 Workbench、生成客户端及对应测试。
- 现有 JSON 字段中的 v3 profile、章节能力状态、迁移 preview token 和产品事件。

**禁止修改**：

- 不新增依赖，不新增 SQLite 列，不改变 WAL 备份策略。
- 不改变手写、保存、切章、导出、版本恢复的可用性。
- 不引入新的付费、会员或永久权益承诺；`built-in/plaza/licensed` 只表达来源和授权边界。
- 不删除 v2 数据，不自动迁移，不把客户端提交的卡片正文或融合规则当作服务端可信运行输入。
- 不为了通过测试而恢复用户可见的 Planner/Writer/Critic 装备槽或放宽 generation/归属/授权校验。

## 执行命令

| 目的 | 命令 | 成功标准 |
|---|---|---|
| 类型检查 | `npm run typecheck` | exit 0，无 TypeScript 错误 |
| 静态检查 | `npm run lint` | exit 0，无新增 lint 错误 |
| 后端定向测试 | `npm test -- tests/execution-contract.test.ts tests/writing-style-service.test.ts tests/writing-style-resolver.test.ts tests/writing-style-gates.test.ts` | 全部通过 |
| 前端定向测试 | `npm run test:frontend -- src/tests/skills-studio-plan158.test.tsx src/tests/plan158-deck-fusion.test.ts src/tests/app-shell-capability-launch.test.tsx` | 全部通过 |
| 全量测试 | `npm test && npm run test:frontend` | exit 0 |
| 构建 | `npm run build` | exit 0 |
| E2E | `npx playwright test --project=chromium && npx playwright test --project=mobile-chromium` | 两个项目核心旅程通过 |

测试数据库必须是 `:memory:` 或独立临时 SQLite；任何命令若解析到运行中的 `data.db`，立即停止。

## 实施阶段

### P0：先完成运行时真相源与副作用守门

1. **统一 Flow 真相源**
   - `server/helpers/writing-style-service.ts` 的 v3 路径只读取 `capabilityProfile.activeFlowId`；`activeSeriesId` 仅在 v2 兼容分支读取。
   - `ExecutionFlowStep` 改为中性 `activeFlowId`，不再把旧字段名传播进新快照。
2. **恢复章节能力状态**
   - 同时读取 `techniqueIds` 与 `overlayCardIds`，与请求中的本次卡合并、去重后校验总数。
   - 章节不存在、跨作品、旧 generation、未知、撤权、scope 错误、非 runtime-ready、有效卡超过 6 张时，在任何配额、run/job 和 Provider 调用前拒绝。
3. **贯穿章节与数据库 generation**
   - 章节型 orchestrate、orchestrate-draft、production、rewrite、audit、editor-agent 与 `useDraftGeneration.ts` 强制 `chapterId + databaseGeneration`；welcome/inspiration/world-onboarding/全书大纲按“AI 入口与错误契约”使用非章节上下文。
   - 不允许章节路由自行 fallback 到“当前 generation”掩盖陈旧请求，也不允许非章节入口伪造章节 ID 通过门禁。
4. **冻结可复现 Skill Stack**
   - `ExecutionOverlay/ExecutionSkillStack` 至少冻结 `id`、版本、来源、项目主卡/辅卡/本章卡位置、卡型、阶段、`dimensionOwners`、规范化 `resolvedRules` 摘要和 lineage。
   - 校验、fingerprint 和 prompt 构造消费同一个内存快照，禁止校验后再次读库。
5. **禁止静默修复非法配置**
   - 移除 resolver、profile helper 和运行 helper 中对 Deck/overlay 的 `.slice()`；超限或 malformed 返回稳定错误并保留原数据供整理。
   - 统一错误码：作品/章节不匹配、generation 过期、能力类型错误、scope 错误、授权失败、运行未就绪、卡组超限、维度冲突。
6. **隔离 v2 投影**
   - v3 `ExecutionSnapshot` 可以保留旧字段用于日志/兼容回显，但 prompt builder 必须用 sentinel 测试证明 `roleSkills/stageSkills` 的内容不会进入 v3 Prompt。
   - v3 无配置使用治理目录的显式默认 Technique/Guardrail；不得从旧 mounted slots 取 Planner/Writer/Critic 补位。
7. **建立唯一 Skill Card 服务端守门**
   - 抽取 `validateSkillCardForScope`（名称可按现有目录规范调整），由技能 create/update、Deck preview/apply、migration apply、章节 overlay 和融合来源校验共同调用。
   - 新写入必须同时满足：治理 manifest 明确 `kind=skill-card`、允许目标 scope、`deconstructionCardType` 有效、`sourceType` 在允许集合、版本与运行规则完整、runtime/sanitization 状态通过、授权有效；Flow、Technique、Diagnostic、Utility、Guardrail 均不得转成卡或 overlay。
   - manifest 缺失或只有旧 `sourceBadge` 的历史数据保留在 v2 读取/迁移待整理区，但不得进入 v3 新写入和执行快照。
   - skill mapper 必须在现有 JSON/列契约内完整 round-trip 上述治理字段；跨请求读取后的校验结果必须与刚创建时一致。

**验证**：`npm test -- tests/execution-contract.test.ts tests/writing-style-service.test.ts tests/writing-style-resolver.test.ts tests/writing-style-gates.test.ts tests/agents-context.test.ts` 全部通过；门禁失败用例中 quota、run/job 和 Provider 调用计数均为 0。

### P1：修复能力商店连续配置与原子保存

1. **建立原子能力配置命令**
   - 新增项目能力配置 preview/apply 服务端契约，只局部合并 `capabilityModelVersion/capabilityProfile`，保留配额、商业状态、写法确认和未知扩展字段。
   - apply 请求携带 `databaseGeneration`、配置基线 token 和完整草稿；服务端重新校验 Flow、Technique、Deck、授权、作用域与冲突后在一次序列化写入中提交。
   - generation 变化、超限、冲突或持久化失败时零半写入，返回稳定 409/400；客户端保留草稿与冲突决策。
2. **连续选择不跳页**
   - 激活/替换 Flow、收藏多个 Technique、加入/替换项目 Skill Card 只更新 `configurationDraft`，`currentView` 始终为 `skills`。
   - 只有 `本章使用`、`运行诊断`、`运行工具/预览` 创建一次性 `CapabilityLaunchState` 并携带 `targetChapterId`；`run-diagnostic` 不得降级成 Utility。
   - 广场/授权资产必须先完成幂等导入并拿到 `persistedSkillId`，再把该 ID 加入 `configurationDraft.candidates`；禁止 fire-and-forget 导入后立即保存 catalog `asset.id`。
   - 把 `configurationDraft`、`candidateCardIds`、`pendingReplacement` 与 tab/filter/selectedAsset/scrollTop 收敛为一个 `CapabilityConfigurationSession`；禁止继续用互不关联的局部 state 表示同一配置事务。
   - 会话恢复必须校验 `novelId + databaseGeneration + baselineToken`。详情返回、保存失败和页面刷新可恢复；切换作品或 generation 变化时只能查看和重新预览，不能直接套用旧草稿。
3. **一次完成并返回**
   - 主动作统一为“应用配置并返回写作”。先原子保存配置，再经过现有正文 flush 边界，回到原作品、原章节；任一步失败都停留在能力中心并保留草稿。
   - 切 tab、筛选、滚动、对比、待替换卡和冲突选择在单次配置期间不丢失；离开页面前提示未应用变更。
   - 脏草稿离开弹层提供“继续配置 / 放弃变更 / 应用并返回”三个互斥动作；只有“放弃变更”可清空草稿，取消弹层不改变任何状态。
   - editor-return 是纯导航动作，不复用 `cockpit-resume` 或任何会自动打开生产面板、触发生成/审稿/精修的启动源。
4. **来源与动作正交**
   - 唯一 presentation 从 manifest 派生 `kind/action/allowedScopes/runtimeStatus/sourceType/membership`；删除基于名称、后缀、`primaryCategory`、`actionType` 和数组位置的运行推断。
   - 官方内置资产免“导入”，但 Flow/Technique/Skill Card 仍需显式启用/收藏/加入；Guardrail 只有真实自动运行时才显示凭证。
   - 广场共享和授权增强按来源 ID + 版本幂等加入“我的能力”；刷新后 membership 仍准确。授权只控制可用性，不改变使用动作。
   - 导入接口返回并持久化 `sourceId -> persistedSkillId` 映射；配置、刷新和运行只使用 persisted ID。删除 `importedAssetIds` 等页面内 Set 作为权威来源的路径。
   - 统一页面名词为“作品能力中心 / 当前作品配置 / 我的能力库 / 能力商店”。来源说明固定为：官方内置“无需导入，但影响创作结果的能力仍需显式启用”；广场共享“先加入能力库，再按类型配置”；授权增强“授权决定可用，不决定自动生效”。
   - 已保存 Skill Card 的按钮改为“加入当前配置候选”并真实加入会话候选；若只导航到卡组区域则使用“去配置卡组”。测试必须证明点击后不跳 Editor、不伪报已装配。
5. **能力包只做分发**
   - 展开组件清单，分别说明 Flow、Technique、Skill Card、Diagnostic、Utility；只提交用户勾选项，包本身不进入运行时。取消零写入，任一组件失败整包零写入。

**验证**：能力中心组件测试覆盖连续配置 1 个 Flow、2 个 Technique、3 张不同来源 Skill Card，期间 `currentView === 'skills'`；候选会话在切 Tab、详情返回、保存失败和同 generation 刷新后恢复；配置 apply 成功、generation 冲突、保存失败、取消和返回原章节均有断言。组合测试必须通过 `afterEach` 清理订阅、DOM、store 与 mock，单测通过但套件 8/9 的状态不得作为完成证据。

### P2：完成拆书 Deck、显式主辅与真实融合

1. **显式选择主卡与辅卡**
   - Book Factory 输出卡组预览时按卡 ID 维护 `mainCardId/supportCardIds/rejectedIds/conflicts`，禁止按数组第一项默认主卡。
   - 用户未选择主卡时不能提交；第四张项目卡必须明确替换目标，不能静默覆盖。
   - 删除 `BookFactoryOutput.tsx` 中 `index === 0` 即“主笔卡”的标签逻辑；未选择时显示“待选择主卡”。
2. **先校验再保存**
   - 只有 `kind=skill-card`、有 `deconstructionCardType`、runtime-ready、版本/规则/来源完整且授权可用的卡可进入项目 Deck。
   - rejected 卡保留在能力仓库或 `migrationPendingIds`，不得用 accepted 数量截取原数组 ID，避免待整理卡错占主卡。
   - 单卡和整套 Deck 使用同一个服务端校验器；`updateProjectSkillDeck` 只 validate-or-reject，不 `.slice(0, 2)`。
   - `shared/lib/book-skill-aggregation.ts`、`useBookFactory.ts` 和迁移 helper 中删除对候选/辅卡的静默 `.slice()`；批量保存必须返回 `sourceCardId -> persistedSkillId`，accepted/rejected/conflict 全部按稳定 ID 关联，不按数组 index 或 accepted 数量映射。
   - 拆书提取输出先成为 candidate；服务端治理函数补齐并验证 `kind=skill-card`、`deconstructionCardType`、规则、版本、来源、sanitization/runtime 状态。只有治理通过后标为 runtime-ready，未通过卡保留拒绝原因。
3. **融合必须可运行、可复现**
   - 一期只允许 1 主 + 1 支持；保存前必须存在 `components/version/dimensionOwners/resolvedRules/lineage`。
   - 无实际运行规则、同源、授权失效或冲突未确认时返回 rejected，Workbench 禁止调用 metadata-only legacy fallback 保存。
   - 源卡升级不改变旧融合卡；只提示可重新融合，新融合产生新版本且不覆盖旧卡。
   - 技能 create/update HTTP 写入边界必须调用同一融合校验器，验证来源卡存在且有权限、components/version/dimensionOwners/resolvedRules/lineage 完整、冲突已确认；禁止客户端绕过 Workbench 直接保存 metadata-only 融合卡。
4. **明确旧三槽边界**
   - `buildDeckMountPlan` 仅作为 v2 读取兼容或删除生产引用；新 Book Factory、能力中心和生成请求不得产生 Planner/Writer/Critic 装配写入。
   - `AgentWorkspaceKnowledgePanel` 不再挂载可操作的 `SkillLoadoutBoard`，改为本章写法/能力只读摘要与进入能力中心动作；`SkillLoadoutBoard` 只允许迁移预览或 v2 read-only adapter 使用。
   - 用户可达生产界面不得再出现“Writer（写作）当前为空”、三角色选择弹层、按角色拖拽或“装备到 Planner/Writer/Critic”。历史数据只在“旧装配待整理”中只读回显，唯一动作是打开迁移预览。
   - “黄金三章”、世界观、人设、动作增强、口语化等 Technique 即使适用于 planner/writer/critic 阶段，也只能收藏、由 Flow 引用或本章启用；阶段归属不是卡槽归属。
5. **修复卡片交互语义**
   - Book Factory 卡片使用普通容器；“查看详情、加入主卡、加入辅卡、本章使用”等动作分别使用独立原生按钮，禁止 `role="button"` 容器包裹子按钮。
   - 键盘焦点顺序、Enter/Space、焦点可见性和屏幕阅读器名称必须与鼠标路径等价，窄屏下动作区不得重叠。

**验证**：Book Factory/融合测试覆盖“乱序三卡显式选第 2 张为主”“待整理卡在首位不入 Deck”“第三张辅卡被拒绝且不丢数据”“Technique 不能进入 Deck”“无规则融合不可保存”“冲突未确认不可保存”“旧融合卡在源卡升级后仍可复现”“卡片容器无嵌套交互且键盘动作可达”。

### P3：完成 v2→v3 显式迁移

1. `preview` 读取旧 `mountedSkillLoadout/mountedSkillIds/skillLoadoutSchemaVersion`，返回 Flow、Technique、Skill Card 主/辅建议、待整理项、冲突和 preview token，不写数据库。
   - 只有恰好一个合法显式主卡位置时才给出主卡建议；没有主卡、多个主卡、仅有旧 ID 顺序或超过两张辅卡时全部保留为候选/待整理并返回冲突，禁止 `cards[0]` 和 `.slice()` 推断。
   - 迁移分类优先使用治理 manifest；无 manifest 的历史数据只能进入 `migrationPendingIds`，不得仅凭名称、`sourceBadge` 或存在 `deconstructionCardType` 自动升级为 v3 Skill Card。
2. UI 确认后只调用 canonical `/apply`，携带 token + `databaseGeneration`；服务端重新验证后原子写入 v3，token 过期、generation 或 profile fingerprint 变化时要求重新预览。`/confirm` 仅为旧客户端兼容别名。
3. 迁移必须幂等：重复打开、失败重试和重复确认不能重复导入、重复装卡或覆盖迁移后新配置。
4. v3 显式空 Flow/Technique/Deck 永不回退复活 v2；无 manifest、重复、越界或规则不完整资产保留在 `migrationPendingIds`。
5. 手写、保存、切章、导出和版本恢复始终不受迁移状态阻断。

**验证**：新增 migration route 与 UI 测试覆盖预览零写入、确认一次写入、重复确认幂等、过期 token、旧 generation、v3 空配置不回退和待整理项不丢失。

### P4：评分、事件与发布验收

- 评分拆为四层：治理门禁、冷启动证据、当前场景适配、真实使用反馈。来源不参与质量分；Flow 只显示步骤完成率/质量门/最近产物，Technique 显示适用阶段与使用反馈，Skill Card 才显示证据分、适配分、采纳/修改/拒绝及样本量。无样本时明确“冷启动评分”，不得展示统一 SCORE/GRADE。
- 事件只记录 ID、阶段、来源类型、动作、结果、耗时和计数，不记录 prompt、正文、资料包原文或融合规则正文。
- 真实调用点固定为：卡片/详情曝光 `capability_viewed`，技法草稿加入 `technique_favorited`，Skill Card 草稿加入 `skill_card_added`，原子配置成功 `skill_deck_applied`，放弃脏草稿 `capability_config_cancelled`，融合预览/保存 `fusion_previewed/fusion_saved`，章节卡实际进入快照 `chapter_overlay_used`，诊断 job 真正启动 `diagnostic_run`，无副作用回到原章节 `capability_returned_to_editor`。旧 `capability_return/capability_preview/capability_cancel` 仅保留历史读取，不再由新链写入。
- 事件使用 `schemaVersion + eventId + sessionId + novelId + chapterId? + capabilityId? + sourceType? + result + durationMs + occurredAt` envelope；同一次用户动作使用稳定 eventId 幂等，取消/失败事件不得计为成功。
- 代理指标按本地滚动 30 天、同一 `sessionId/novelId` 关联：配置完成率=`skill_deck_applied 成功会话 / capability_viewed 后产生配置草稿的会话`；配置期间跳转数=配置会话内 view change 总数；冲突取消率=`带冲突的 capability_config_cancelled / 发生冲突的配置会话`；商店到正文回流率=`capability_returned_to_editor / 成功 skill_deck_applied`；卡后正文采纳率=`带 skillStack receipt 的正文接受 / 带 skillStack receipt 的正文完成`；诊断预览应用率=`诊断产生的预览被应用 / diagnostic_run 成功`。分母为 0 时返回 unavailable，不伪造 0%。
- 更新旧测试，不得继续断言 `role-skill`、`overlay`、Planner/Writer/Critic 可装备槽、即时完整 `updateNovel` 或单一“收藏技法”按钮；每个删除的旧断言都要有等价新行为测试。

## 多 Agent 编排

### 第一波：契约与 P0 正确性

- **Coordinator / Sol**：独占 `shared/types/capability-manifest.ts`、`shared/types/capability-execution.ts`、`shared/types/preferences.ts`、`shared/lib/project-preference-profile.ts`、`AppShell.tsx`、`EditorView.tsx`，先冻结跨端字段、错误码和一次性 launch 契约。
- **Backend Luna Implementer**：独占 `server/helpers/writing-style-service.ts`、`server/helpers/writing-style-resolver.ts`、`server/validation.ts`、`server/routes/agents.ts`、`server/routes/writing-style.ts` 及对应后端测试；完成 Flow、overlay、generation、快照和副作用前守门。
- **Client Generation Luna Implementer**：独占 `src/lib/hooks/generation/useDraftGeneration.ts`、相关 client 与前端请求测试；贯穿 `chapterId/databaseGeneration`，不得修改共享类型或路由。
- 第一波合并前，Coordinator 逐 hunk 核验 `ExecutionSnapshot`、错误码和请求 schema 一致；任何一端不得自行新增同义字段。

### 第二波：能力中心、Deck 与迁移

- **Ability Center Luna Implementer**：独占 `src/components/SkillsStudioView.tsx`、`src/lib/capability-governance.ts`、`src/lib/skills-studio-governance.ts` 和对应组件测试；负责连续配置、manifest presentation、来源 membership、迁移入口接线与返回写作。
- **Deck/Fusion Luna Implementer**：独占 `src/components/book-factory/**`、`src/components/skills/SkillFusionWorkbench.tsx`、`src/lib/skill-fusion.ts` 和对应测试；负责显式主辅、先校验后保存与融合 UI 拒绝路径，不修改服务端技能持久化。
- **Skill Persistence Luna Implementer**：独占技能保存/导入路由、`server/lib/db/skills.ts`、skill mapper、服务端融合/asset mapping validator 和对应 HTTP 测试；负责 candidate→runtime-ready、source→persisted ID 映射与融合保存门禁。
- **Migration Luna Implementer**：独占 migration route/service/client、新的 `CapabilityMigrationPreviewPanel.tsx` 和对应测试；不得修改 `SkillsStudioView.tsx`，由 Ability Center Agent 通过稳定 props 接入该面板。
- **Coordinator / Sol**：独占 `AgentWorkspaceKnowledgePanel.tsx`、`SkillLoadoutBoard.tsx` 的生产挂载调整，以及 `AppShell.tsx`/`EditorView.tsx` 的无副作用 editor-return 契约；处理所有交叉文件总装。
- 禁止两个 Implementer 同时修改同一文件；所有 Agent 不得回滚、覆盖或格式化他人及用户未提交改动。

### 第三波：Gatekeeper 并发

- **Static Gatekeeper**：typecheck、lint、`git diff --check`。
- **Unit Gatekeeper**：后端与前端单测，使用 `:memory:` 或独立临时 SQLite。
- **E2E Gatekeeper**：桌面与移动端，使用独立端口和数据库，单例超时 10–15 秒。
- Coordinator 必须核验实际 diff、退出码、测试数量和数据库路径；子 Agent 自报成功不等于验收通过。

## Test Plan

### 契约与迁移

- 六类能力的 kind、action、scope、stage、side effect 完整且一致。
- 官方内置 Guardrail 无装配按钮；官方内置 Flow/Technique/Skill Card 仍需显式选择。
- v3 `activeFlowId` 真实进入 Flow step 快照；修改旧 `activeSeriesId` 不改变 v3 当前 Flow。
- 章节持久化 `overlayCardIds` 在刷新、切章返回后自动恢复；不会仅依赖客户端本次请求的 `sessionCardIds`。
- v2 作品继续运行；迁移预览不写库；确认后只写一次 v3；v3 空配置不回退 v2。
- 无 manifest、重复、越界、规则不完整资产进入待整理，不静默丢失。
- 缺少 `sourceType`、runtime/sanitization 状态或授权证据的 Skill Card 在 create/update、Deck apply、migration apply、chapter overlay 和 fusion source 五条路径得到同一稳定拒绝结果。
- “黄金三章”及任意 Technique/Flow/Diagnostic/Utility/Guardrail 写入 `projectSkillDeck` 或 `overlayCardIds` 均在业务副作用前被拒绝。
- 迁移包含无显式主卡、多个主卡和三张以上辅卡时保留全部 ID 与冲突，不用数组顺序选主卡、不截断候选。
- v2 manifest 被重分类后旧作品仍可运行；v3 超限或 malformed Deck 返回错误而非被截断。
- `skill-deck` resolve/confirm 保留 v3 profile、配额、商业状态和未知扩展字段，不写回 v2 schema version。
- 章节型与非章节型 AI 使用入口矩阵规定的不同上下文；welcome/立项/全书大纲不被错误要求 chapterId，正文/改写/审稿/生产缺章节时业务副作用计数均为 0。
- v3 快照中的 legacy `roleSkills/stageSkills` sentinel 不进入 Prompt；无配置只使用显式默认 Technique/Guardrail。
- `AgentWorkspaceKnowledgePanel` 真实挂载路径不再渲染 Planner/Writer/Critic 可操作槽，v2 read-only 迁移预览仍可读取旧数据。

### 商店旅程

- 连续选择 Flow、多个 Technique 和三张不同来源 Skill Card 不离开能力中心。
- “我的能力库”点击已保存 Skill Card 后，该卡真实进入当前配置候选；若按钮仅导航，则文案为“去配置卡组”，不得显示“装备到作品”。
- 第四张项目卡触发主/辅替换选择，不静默覆盖。
- 第四张替换层显示候选与目标卡的名称、来源、版本、卡型、负责维度、冲突及替换影响；无法解析的历史 ID 不可直接确认。
- 切换 tab、筛选和滚动位置在每次加入后保留。
- 同作品、同 generation 刷新能力中心后恢复候选卡、替换决策和页面位置；切换作品或 generation 后旧草稿不可直接应用。
- 点击“完成配置并返回写作”回到原作品、原章节，未保存正文不丢失。
- Diagnostic/Utility 才跳 Editor；诊断只读，预览未经应用不写正文。
- 内置 Flow/Technique/Skill Card 无“导入”动作，但分别需要启用、使用或加入卡组；Guardrail 自动且没有装配按钮。
- 广场/授权资产按来源 ID + 版本幂等加入；刷新能力中心后“已加入”状态不依赖页面内 Set。
- 加入商店资产后，服务端返回的 `sourceId -> persistedSkillId` 经刷新仍可解析；保存 Deck、确认写法和生成正文均使用 persisted ID。
- 广场/授权导入失败时候选区、项目 Deck 和 membership 均不出现原始 catalog ID；重试成功只产生一个持久化技能和一条 membership。
- 前三张 Skill Card 均先进入候选区，用户可任意指定其中一张为主卡；点击顺序不会改变最终角色。
- 脏草稿离开时，“继续配置”保留全部页面状态，“放弃变更”才清空，“应用并返回”成功后才导航；三者都不得触发生产请求。
- 能力包只提交勾选组件；取消、保存失败、刷新重试后不产生半套配置。
- 配置草稿应用成功前不改变运行时；原子保存失败后保留筛选、滚动、选择和冲突决策。
- generation 变化时原子 apply 返回 409，作品 profile 零变化，用户可重新预览并应用同一草稿。
- 从 Editor 打开能力中心必须携带当前 chapterId；返回动作不触发 cockpit resume/生产请求，章节失效时保留配置草稿并显示稳定错误。
- 卡片加入、详情返回、保存失败与冲突取消后恢复相同 tab/filter/selectedAsset/scrollTop。
- 迁移 preview 后改变配置草稿会使旧 token `/apply` 返回 409；迁移不得覆盖新草稿。
- 页面固定区分“作品能力中心 / 当前作品配置 / 我的能力库 / 能力商店”；不存在把收藏、启用、装载、立即运行都写成“装备”的卡片。
- 用户可达链路不出现“Writer（写作）当前为空”或 Planner/Writer/Critic 装配弹层；旧数据只在迁移预览中只读出现。

### 卡组、写法与融合

- 一主两辅按维度合成稳定运行规则；同维度冲突必须显式解决。
- 三张卡乱序时可显式选择任意一张为主；未选择主卡不能提交。
- 待整理卡排在数组首位时不会被写入主卡，accepted/rejected 必须按卡 ID 而非数量映射。
- `BookFactoryOutput` 不再使用数组 index 标记主卡；未选择时显示“待选择主卡”。
- Technique、Flow、无卡型或非 runtime-ready 资产只能收藏/保留，不能进入项目 Deck。
- 项目卡 + 本章卡去重后最多 6；超限、未知、越权、不可运行卡被服务端拒绝。
- Writer Technique、Skill Deck、Writer 章节卡或融合卡版本变化使写法 stale；Planner-only Technique 不误触发。
- 融合卡包含冻结规则、components、dimensionOwners 和 lineage；源卡升级不改变旧融合卡运行结果。
- 任一融合源缺少实际规则时预览为 rejected，不能通过 legacy fallback 保存 metadata-only 融合卡。
- 融合规则冲突必须展示负责维度、来源卡和拟采用规则；用户未确认前保存按钮不可用。
- 直接调用技能保存 HTTP 也必须拒绝 metadata-only、来源缺失、授权失效或冲突未确认的融合卡，不能绕过 Workbench。
- Book Factory 卡片容器不承担按钮角色，内部动作均有独立可访问名称；键盘可完成查看、主辅选择和取消。
- 409 不扣额度、不创建 run/job、不调用 Provider，重新确认后只恢复一次。
- 收藏 Technique 不改变 Prompt 或指纹；本章 Writer Technique 才使写法 stale，Planner-only Technique 不误触发。
- 每条正文、改写、审稿和生产链都从同一 `chapterId + databaseGeneration` 快照读取；跨作品与旧 generation 在副作用前拒绝。
- 融合卡真实使用冻结 `resolvedRules`；源卡升级后旧融合卡仍可复现，重新融合才产生新版本。

### 完整 E2E

```text
进入作品能力中心
→ 查看官方/广场/授权来源说明
→ 启用一个 Flow
→ 连续收藏黄金三章与动作增强技法
→ 从拆书 Deck 选择 1 主卡 + 2 辅卡
→ 保存配置且不跳页
→ 返回原章节
→ 本章再加临时卡
→ 确认本次写法
→ 生成正文
→ 运行只读诊断
→ 返回能力中心后配置仍完整
```

另覆盖移动端、半残历史 profile、模型空响应、数据库 generation 变化和配置保存失败恢复。

产品事件测试必须对上述十个真实调用点逐一触发，断言一次动作只写一个成功事件、取消/失败不计成功，并验证事件 payload 不包含正文、Prompt、资料包原文、完整 profile 或融合规则正文。指标测试使用固定 30 天时间窗和 `sessionId/novelId` fixture，覆盖分母为 0 返回 unavailable。

## 最终门禁

```bash
npm run typecheck
npm run lint
npm test
npm run test:frontend
npm run build
npx playwright test --project=chromium
npx playwright test --project=mobile-chromium
npm audit --omit=dev
git diff --check
```

所有后端、前端与 Playwright 测试必须使用 `:memory:` 或独立临时 SQLite，禁止读取或写入运行中的 `data.db`。

## Done Criteria

- [x] 用户界面不再出现 Planner/Writer/Critic 三个可装备槽。
- [x] “黄金三章”等技法不占 Skill Deck，拆书卡组明确为一主两辅。
- [x] 能力商店可连续配置，项目配置动作不会自动跳转 Editor。
- [x] 配置候选、替换决策和 tab/filter/scroll 组成可恢复会话；同作品同 generation 刷新可恢复，跨作品或旧 generation 不可误应用。
- [x] 来源、可用性、作用域和加入状态分别显示，内置能力不再被误解为全部自动生效。
- [x] 页面固定区分“当前作品配置 / 我的能力库 / 能力商店”；“加入作品卡组”不会只切 Tab 或伪报已装配。
- [x] 能力商店与作品能力中心职责分离；能力包只展开组件，收藏、启用、装载和本章使用不会互相冒充。
- [x] 商店导入持久化 source→persisted ID 映射，刷新、保存 Deck 和运行解析均不依赖页面内 Set 或原始 asset ID。
- [x] 项目 Skill Deck 的前三张卡也经过候选与显式主辅选择，点击顺序不再决定主卡；脏草稿只有显式放弃才会被清空。
- [x] 第四张卡替换层不显示裸 ID，必须提供来源、版本、维度、冲突与替换影响；未知历史卡进入待整理。
- [x] Skill Card 的 create/update、Deck、迁移、章节 overlay 和融合来源共用唯一服务端门禁，刷新后治理字段不丢失。
- [x] 项目能力通过 generation 守门的原子命令一次应用；失败无半写入并保留配置草稿。
- [x] Book Factory 和能力中心都要求显式主卡；非 runtime-ready、非 Skill Card 和 metadata-only 融合卡不能进入 Deck。
- [x] Deck、章节卡和融合卡真实进入同一冻结 ExecutionSnapshot 与写法指纹。
- [x] 刷新或切章返回后，本章持久化卡自动恢复；v3 Flow 只由 `activeFlowId` 决定。
- [x] v2 数据可读、可运行、可显式迁移；v3 新写不产生旧三槽数据。
- [x] 章节型 AI 使用 `chapterId + databaseGeneration` 冻结快照，非章节型 AI 使用 session/context generation；任一作用域守门失败时配额、run/job、Provider 和内容写入均为 0。
- [x] 十个能力生命周期事件均来自真实调用点且可幂等聚合，六个 30 天代理指标按定义可计算，分母为 0 时显示 unavailable。
- [x] 所有最终门禁 exit 0，新增桌面/移动旅程通过，测试数据库物理隔离。

## STOP Conditions

- 现有未提交源码与本计划列出的 v3 契约草稿发生冲突，且继续会覆盖用户改动。
- 发现生产运行仍依赖 `mountedSkillLoadout` 中不可重建的私有语义；必须先补 characterization test，再决定迁移。
- 某类拆书卡只有展示元数据、没有可验证 runtime rules；不得伪装成可装载卡。
- 需要新增 SQLite 列、依赖、付费策略或授权策略才能继续；这些均超出本计划授权。
- 任一验证连续两次失败且原因涉及本计划范围外文件；停止并报告，不扩大重构。

## 明确不做

- 不增加第四个、第五个角色槽。
- 不把每个 Flow step 克隆为普通 Skill Card。
- 不让官方内置资产全部自动生效。
- 不把 Deck、能力包和融合卡混成同一个概念。
- 不依据卡名、后缀或页面分类推断运行语义。
- 不以“按钮可见”代替真实请求、副作用、返回和恢复验收。
