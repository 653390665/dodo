# Plan 150：InkFlow 创作能力统一治理

## 目标

统一能力商店、流程包、作品技能、拆书卡、资料包和大纲层级，保证每次 AI 动作都能回答五个问题：使用什么事实、处于哪个流程步骤、哪个角色负责、叠加了哪些临时能力、哪些质量护栏不可关闭。

```text
实际执行 = Canon + Flow Step + Role Skill + Overlays + Guardrails
```

手写、保存、切章不受能力治理阻断；AI 动作只在已装配技能的阶段归属不明、资产未授权或执行合同失效时阻断。没有选择 Flow 是合法状态，服务端使用通用流程能力，不得返回 409。

## 产品分类

### 能力商店

能力商店是分发与管理入口，不直接等于运行时。

| 产品类型 | 作用 | 激活方式 | 生命周期 |
| --- | --- | --- | --- |
| 流程包 Flow | 串联设定、大纲、章纲、正文、审稿的闭环步骤 | 作品选择一套主流程 | 作品级 |
| 角色技能 Role Skill | 提升 Planner、Writer 或 Critic 的稳定能力 | 每角色最多装配一个 | 作品级 |
| 临时增强 Overlay | 针对本章或本次请求补充世界观、人物、钩子、冲突、节奏、平台或文风 | 推荐后显式勾选 | 章节/请求级 |
| 工具 Utility | 改写、取名、检查等一次性操作 | 用户直接执行 | 单次请求 |
| 护栏 Guardrail | 去 AI 腔、安全、结构和一致性底线 | 系统按阶段自动启用 | 系统级 |

完整套装以 Flow 形式运行；散装能力按 Role Skill、Overlay 或 Utility 使用。禁止把一个流程包压成一张 Writer 风格卡，也禁止把一次性工具长期占据作品槽位。

### 拆书能力

拆书不是另一个能力商店。它从用户提供的作品证据中提炼可迁移方法，默认产出 Overlay Deck：

- `worldview / character / hook / conflict`：Planner Overlay。
- 拆书维度 `world / power` 均投影为 `worldview-card`，进入 Planner。
- `style`：Writer Overlay。
- `pacing / platform`：Planner 与 Writer 均可用；持久装配时必须由用户选择一个角色，本次临时使用可同时路由到两阶段。
- 卡片通过试用和反馈后，可由用户明确提升为作品 Role Skill；不得自动替换已有角色技能。

三种动作必须分开：`保存到技能库`、`装配到作品角色`、`本章临时试用`。保存不产生挂载写入，临时试用不改变作品配置，装配覆盖已有槽位前必须确认。

持久装配继续兼容现有数字槽，但语义固定为 `slot 0 = Planner`、`slot 1 = Writer`、`slot 2 = Critic`。每槽最多一个 Skill；`mountedSkillIds` 必须由最终 loadout 按槽位派生。`pacing/platform` 持久装配时只能选择一个槽，临时 Overlay 才可同时进入 Planner 与 Writer。

## 大纲与资料

```text
唯一主大纲（Canon）
  -> 多个卷/故事细纲（带作用范围）
  -> 当前章章纲
  -> 场景分镜
  -> 正文
```

- 同一作品只能有一个主大纲；用户在候选大纲中单选，不允许“全部作为主大纲”。
- 细纲可以有多个，但必须绑定卷、章节范围或主题，并声明与主大纲的关系。
- 技能卡是生成或检查大纲的方法，不是大纲内容；其输出先成为待确认补丁，确认后才能更新 Canon。
- 审稿、审计、评分、兼容性报告和问题清单不得成为主大纲候选。
- 资料包事实可以进入 Canon 上下文；资料包文风只进入 Writer 写法合同，避免重复注入。

## 运行时合同

服务端是唯一可信路由器。每次 AI 动作在额度预占、任务创建和模型调用前生成不可变 `ExecutionSnapshot`：

```ts
interface ExecutionSnapshot {
  novelId: string;
  canon: ExecutionCanon;
  flowStep: ExecutionFlowStep | null;
  roleSkills: ExecutionRoleSkills;
  overlays: readonly ExecutionOverlay[];
  guardrails: readonly ExecutionGuardrail[];
  stagePrompts: Readonly<{
    planner: string;
    writer: string;
    critic: string;
  }>;
  writingStyleSummary: string;
  writingStyleFingerprint: string;
}
```

`RoleSkillSnapshot` 只保留 stage、version 和允许的规则字段；`ExecutionOverlay` 只保留 ID、类型、阶段和运行规则。合同不得序列化 Skill 的名称、描述、使用统计、评价文本或完整对象。兼容字段 `stageSkills/sessionCards` 也只能使用相同受限投影，后续消费者迁移完成后删除。

- 同一请求的校验、Prompt 构建、Context Receipt 和模型执行只消费同一个值快照，禁止校验后重读数据库。
- Planner 只接收 Canon、当前 Flow Step、slot 0、Planner Overlay 和规划护栏。
- Writer 只接收 Canon、slot 1、已确认写法合同、Writer Overlay 和写作护栏。
- Critic 接收 Canon、slot 2、已解析写法标准和审稿护栏；不得获得 slot 1 Skill 对象。
- 未知卡、未清洗、未授权、跨作品资料或超过六张 Overlay 返回稳定 400/403/409；不得创建空任务或扣费。

## 评分治理

旧评分保留，但只作为冷启动先验，不再冒充综合质量分。

1. 治理门禁：授权、清洗、运行状态。任一失败即不可运行，不参与分数补偿。
2. 冷启动分：证据覆盖 30、可迁移性 35、安全性 35；显示证据范围和风险，不显示虚假精确度。
3. 在线表现：采纳、修改后采纳、拒绝、适配度和样本量；有真实使用后逐步替代冷启动排序。
4. 场景适配：按当前作品、阶段和目标给出推荐，不写回资产的全局质量分。

推荐最多展示三张临时卡，服务端硬上限六张。没有样本时显示“冷启动评分”；有样本时同时显示样本量，禁止把两类分数直接相加。

现状迁移要求：`stabilityScore` 目前仍参与拆书过滤和推荐，`feedbackScore` 也参与装配推荐。P1 必须将其拆成 `coldStartScore` 与 `observedPerformance` 两个展示和排序通道；在迁移完成前，UI 只能标注“证据稳定度/使用反馈”，不得显示成统一质量分。

## 前端工作流

```text
选主流程（可用通用流程）
  -> 确认主大纲与设定 Canon
  -> 装配 Planner / Writer / Critic
  -> 生成或完善细纲、章纲与分镜
  -> 选择本章临时卡
  -> 确认本次写法
  -> 生成正文
  -> Critic 审稿与版本接受
```

- “写法与技能”展示当前 Flow、三个角色槽、本章 Overlay 和系统护栏，但不把五层混成一组卡片。
- 每个 AI 按钮旁显示本次实际合同摘要；用户可查看来源，不展示或上传原始正文。
- 能力商店按钮使用明确动词：`启用流程`、`装配角色`、`本次使用`、`运行工具`。
- 拆书结果默认显示“本次分析”；保存后显示“已入技能库”；作品实际引用后显示“已装配”。

## 分阶段实施

### P0：执行正确性

- 建立五层 `ExecutionSnapshot`、统一卡片阶段映射和深值冻结。
- 大纲生成接入 Planner/Flow/Guardrail，且不要求 Writer 文风确认。
- Critic 与 Writer 隔离；Critic 使用解析后的写法标准。
- Deck 装配保留无关槽位，双阶段卡要求显式选择，主大纲过滤报告。
- 将 `generate-outline` 作为首个落地入口；`orchestrate`、editor-agent、production、rewrite、audit 逐入口迁移到同一快照。任何入口在迁移完成前不得宣称“统一合同已全链路完成”。

### P1：拆书卡与评分闭环

- 已保存的用户拆书 Skill 通过服务端可信投影成为 session card；只接受服务端 ID。
- 若支持“未保存即试用”，新增服务端签发、短期有效的会话引用；不得接收客户端卡片正文。
- 冷启动分与真实使用反馈分层展示；增加卡片试用、采纳、修改和恢复事件。
- 临时选择按作品和章节恢复，失效资产显式移除并说明原因。
- 统一废弃客户端提交完整 `skills` 对象的兼容入口；过渡期字段可接收但服务端忽略，只信任作品 loadout 和服务端 ID。
- 用户拆书 Skill 到 session card 的可信投影是 P1 的前置合同；在该投影完成前，产品只提供“保存后装配”，不得显示“本章临时试用”。

### P2：大纲层级与流程执行

- 主大纲唯一化，新增带范围的细纲/章纲引用；不改变正文保存语义。
- Flow Step 的资产、输入、输出和质量门真正进入运行合同。
- Overlay 只能生成待确认 Canon 补丁，不得直接改设定或主大纲。

P2 需要显式迁移批准后增加两个附加实体，不能继续把所有内容塞进 `Novel.globalOutline`：

```ts
interface OutlineArtifact {
  id: string;
  novelId: string;
  level: 'master' | 'volume' | 'chapter';
  scope: { volumeName?: string; chapterStart?: number; chapterEnd?: number };
  content: string;
  source: 'user' | 'continuation-pack' | 'ai-proposal';
  status: 'candidate' | 'active' | 'archived';
  baseFingerprint?: string;
}

interface CanonPatch {
  id: string;
  novelId: string;
  baseFingerprint: string;
  sourceAbilityId?: string;
  operations: readonly CanonPatchOperation[];
  status: 'pending' | 'accepted' | 'rejected' | 'stale';
}
```

主大纲通过“同一作品最多一个 active master”保证唯一；细纲必须有 scope。Patch 接受时校验 `baseFingerprint`，重复接受幂等，基线变化后标记 stale，绝不直接覆盖正文或设定。

### P3：产品收敛与迁移

- 能力商店按五类重排，历史资产重新分类；歧义项进入待确认，不静默迁移。
- 历史 1-based、重复槽位和旧 `mountedSkillIds` 继续走 v2 待放置机制。
- Context Receipt、事件指标和恢复路径覆盖所有 AI 入口。
- 建立 catalog 到运行时五类的显式映射：`author-workflow + SkillSeriesFlow -> Flow`，可装配写作资产 -> Role Skill，`agent-guided/optional-style/platform-criteria -> Overlay 或 Utility`，`quality-guardrail + core-default -> Guardrail`。Flow 激活源为 `activeSeriesId`，步骤与完成状态继续读取现有 tags，迁移前不得再发明第二套状态。

## 降级与恢复

- 无 Flow：使用通用流程，不阻断 AI。
- 有 Flow 但当前 step 资产不可运行：显示步骤仍可见，忽略该资产并使用阶段默认能力，同时记录 warning。
- Skill 槽位歧义：只阻断相关 AI 阶段，提供“写法与技能”修复入口；手写和保存继续可用。
- Overlay 失效：从本次请求移除并保留用户输入，不自动换卡、不扣费。
- 写法确认失效：返回 409 和新摘要；确认后只恢复原请求一次。
- Provider/网络失败：保留正文、分镜、意图和临时选择，允许重试或继续本地写作。

## 当前完成边界（2026-08-09 复核）

- 已完成：七类卡片阶段映射、受限五层快照、可信拆书 session card 投影、评分双通道、Critic 规则投影、主/卷/章纲实体与 Canon Patch、主线生产版本归属校验、资料包单读、Deck 槽位保护、报告过滤、active 细纲注入 Planner、World 工具阶段合同包装、商店治理类型与动作文案、桌面/窄屏核心 E2E。
- 已验证：主线生成、生产、审稿、改写、World 工具和大纲入口均不直接读取客户端技能正文；跨作品版本补丁在事务内 409 且零写入；三阶段 Context Receipt 只保存摘要哈希，不保存 Prompt 正文。
- 已收口：能力商店已提供 Flow / Role Skill / Overlay / Utility / Guardrail 五类主视图，历史四个生命周期航道降为阶段次筛选；Overlay 只使用服务端 runtime-ready governed ID 或已验证的拆书 Skill，保存、装配和本次试用动作分离；`production-reflexion` 与主生产管线均消费同一冻结快照，阶段 Context 在实际 Provider 入参中隔离。
- 本轮已收口产品入口：大纲治理默认隐藏报告候选，显式展开后只读展示；Canon 基线变化显示 stale 提示并提供刷新、拒绝失效补丁；写法来源变化触发 409 后保留原请求与正文/分镜，确认后只恢复一次。Plan150 Chromium 5/5、Pixel 5 mobile 4/4 已覆盖这些旅程。

## 验收门禁

- 七种拆书卡阶段映射全部有测试；未知、越权、未清洗和超限均有稳定错误。
- Planner、Writer、Critic 的 Prompt 隔离测试验证实际模型入参，不只测试纯函数。
- 校验失败时 quota、job、run 和模型调用均为零；快照生成后不再读取同一资料。
- 主大纲单选、报告过滤、细纲作用范围和 Canon 补丁确认有桌面/窄屏 E2E。
- 所有测试使用 `:memory:` 或独立临时 SQLite，禁止访问运行中的 `data.db`。
- 最终执行 `typecheck`、`lint`、后端测试、前端测试、build、Chromium 核心旅程与 `git diff --check`。

## 非目标

- 不新增依赖，不在 P0/P1 新增 SQLite 列，不改变现有 WAL 备份规范。
- 不让客户端成为技能、授权或 Prompt 的可信来源。
- 不用会员等级替代能力分类；商业边界在能力可用性之后单独治理。
