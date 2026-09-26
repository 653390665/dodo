# Plan 262：能力卡 / 链路 / 图谱收口（P0 剩余 + 链路真实化 + 长尾）

- 状态：IN PROGRESS
- 立项：2026-09-28（Round 46）
- 前置：Plan 261 知识谱系；四批次收敛（commit `7e0efc7`）；P0-① 装配三字段运行时接线（本轮首提交）
- 规格承载：`docs/specs/capability-flow-graph-consolidation.md`（§4.2.3 已落地；§5.4.1/§5.5/§5.6/§5.9/§5.10/§5.11 的「残余」为各批次验收回写点）
- 复跑脚本（`scratch/`，gitignored）：`g2-guard-probe.ts`（护栏通道 Δ）、`capB-chain.ts`（链路引用面）、`capD-sanitize.ts`（清洗层）、`flow-audit.ts`（30 步可运行/仅引导）、`stageprompts-snapshot.ts`（六场景哈希）、`card-role-coverage.ts`（角色投影覆盖）
- 完成定义（每条统一）：实现落盘 → 定向测试 + `npx tsc --noEmit` + `npx eslint server src shared tests scripts --max-warnings=0` 全绿 → `scratch/stageprompts-snapshot.ts` 六场景哈希逐项不变（若本项有意改提示词，记录变更前后数值）→ 规格文档回写证据与残余 → 单独提交 → 本账本状态更新

## 批次 A：在制品收口（本轮先做）

| # | 项 | 现状 | 完成判据 | 状态 |
|---|---|---|---|---|
| A1 | 提交 P0-① 单元 | 5 改 + 1 新；tsc/lint 0、后端 1396/1396、前端定向 20/20、快照逐项不变；工作区含 `nohup.out` 垃圾 | 提交且工作区 clean | IN PROGRESS |
| A2 | 规格状态回填 | `docs/specs/creation-entry-convergence.md` Status 仍「待确认（test seams 需实现者复核）」，实现已随 `9a2c234` 交付 | Status 改为已交付并注明复核日期 | TODO |

## 批次 B：P0 剩余（用户已批准）

| # | 项 | 现状证据（2026-09-28） | 完成判据 |
|---|---|---|---|
| B1 | 护栏语义（假控制） ✅ 已完成 | 12 张 core-default 护栏无条件注入；`guardrailIds=[core-slop-shield]` Δ0（加/删皆无变化），`[private-162]` 才 writer +169；唯一 `stage=review` 护栏是壳卡被过滤 → critic 永无护栏。判定 `isConfigurableGuardrailAsset` = `isRuntimeReadyAsset && primaryCategory==='quality-guardrail'`（`server/helpers/writing-style-service.ts:1151-1155`），`buildGuardrails:1260-1290` 先并全部 core-default 再并配置项 | 配置任一 core-default id 有可解释行为（去重/显式覆盖/UI 标明「已默认启用」）；新增用例钉住；`scratch/g2-guard-probe.ts` Δ 数值写入规格 §5.7 |
| B2 | 评分口径显性化 ✅ 已完成 | score 同时是质量分与准入门槛（≥70 采用、<60 不可用、60–69 必 candidate）；UI 仅 `src/components/book-factory/QualityTab.tsx:536` 一行「{grade}级 ({score}分)」 | 卡面/详情解释评分与门槛口径，文案与分档逻辑单源（shared/lib），有测试钉住 |
| B3 | 清洗滞留清账 ✅ 已完成 | 179→132 公开；`admitPublicAsset` 拒 6 张；41 张通过准入却不在公开目录；46 张 needs-sanitization 中 33 张产副本、13 张永不产副本；`sanitizationHits` 仅 2 张非零 | 每张滞留资产有明确去向（补副本 / 标注不可公开 / 移出候选），`capD-sanitize.ts` 报告数字回写规格 |

## 批次 C：链路真实化

| # | 项 | 现状证据 | 完成判据 |
|---|---|---|---|
| C1 | `cardRef` 挂真实步骤 ✅ 已完成 | 槽位代码已实现（`shared/lib/flow-step-card-slot.ts`、`server/helpers/writing-style-service.ts`），目录中 cardRef 实例 **0**、cardId **0** | 至少番茄/天马/拆书/风华/小飞鸡各 1 步挂 `cardRef`，断言对应阶段 prompt 含卡面特征串；未声明步骤快照逐项不变 |
| C2 | 旧 `qualityGate` 收敛 ✅ 已完成 | 旧字段 30 处仍进提示词（`writing-style-service.ts:1159/1202` + `SkillsStudioView.tsx:3361/3369`、`PlanningTab.tsx:340`），新 `gate{kind}` 仅 generic step5/step6 | 双门合一（迁移或删除旧字段），提示词与 UI 同源；快照差异记录 |
| C3 | 维度补卡 ✅ 已完成 | 链路仅引用 22/179 张；人物 1 步、道具 0、副本 0、创意构思 1/4、审稿 1/3、其他 0/4 | 人物/道具/副本各 ≥1 可运行步骤；`capB-chain.ts` 缺口表更新 |
| C4 | 死字段/半接线清理 ✅ 已完成（2026-09-28） | `foreshadowingTasks` 构建无消费（`server/helpers/knowledge-lineage-enrich.ts:90/128`）；`payoffNote` 部分消费（`:446`）；`ExecutionSnapshot.skillStack`/`techniques` 写入无读方，`overlays`/`sessionCards` 只进回执（`server/lib/db/product-events.ts:536-593`） | 逐项接线或删除，处置登记规格 |
| C5 | 步骤引用图谱能力卡 ✅ 已完成（2026-09-28） | `knowledge-extract`/`foreshadow-settle` 未被任何链路步骤引用（批次 C 第 4 条） | ≥1 步引用并断言执行面 |

## 批次 D：长尾（已登记残余）

| # | 项 | 现状 |
|---|---|---|
| D1 | 13 步「仅引导」补正文 | 按链（C3 后实测 `scratch/c4-perchain.ts`）：番茄 4（step2/3/4/5，其中 step2/3 已挂 cardRef 但 assetId 仍为壳）/ 风华 4（step1/2/3/5）/ 天马 3（step1/2/4）/ 小飞鸡 1（step1）/ 拆书 1（step2）/ 通用 0；当前 19/32 可运行（59.4%），到 80% 需再补 7 步（32×0.8=25.6→ 26 可运行） |
| D2 | 伏笔面板加图谱维护入口 | 现只挂 World Bible 图谱页（`src/components/ForeshadowingPanel.tsx` 内无入口） |
| D3 | 章节回滚 stale 打标 | 只覆盖删除路径；回退需先定义「回到哪个来源版本」 |
| D4 | 记忆健康度补完 | 只做驾驶舱（无状态栏形态）；无阈值/告警；RAG 命中现算不缓存；孤立节点只看 `entity_relationships` |
| D5 | 长篇记忆基线补完 | 样本为确定性合成长书；回声口径为「token 是否进请求」；planner/critic 未纳入；未接 CI |
| D6 | 三字段 UI 写入口 | `projectCards`/`chapterCards`/`singleRunCard` 只能经 profile 写入（接线已生效，用户点不到） |

## 批次 E：需拍板 / 跨会话遗留

| # | 项 | 现状 |
|---|---|---|
| E1 | push 被 gh 凭证阻塞 | 本地领先 `origin/codex/plan169-checkpoint` 115 提交；需用户在终端 `gh auth login -h github.com` |
| E2 | M6 ❌ 打包态嵌入模型路径 | `server/embedding.ts` 仍用 transformers.js 默认缓存 → 决定随包附权重或首启联网 |
| E3 | M7 ◐ npm/Node 版本告警 | npm v12.0.2 不支持 Node 22.22.0（需 ^22.22.2 / ^24 / ≥26） |
| E4 | M2 ◐ 会话隔离 | 未用 worktree，现以「每单元提交 + 提交前清点」替代 → 决定是否立规范 |
| E5 | 双账本（plan 191 DOCS-3） | 根 `plans/README.md` 主账 vs `docs/plans/README.md` 能力卡轮账本；`MEMORY.md` 指针已改根账本，从属关系未定 |
| E6 | 真实数据缺口 | 现有漏斗（1016 事件/8 作品）是操作者狗粮，不足以定 P0；埋点口径三处已修，待真实用户数据复测 |
| E7 | 架构图集漂移 | 取证停 2026-09-18（`84fb175`），未覆盖 Plan 261 + 四批次新链路（`docs/architecture-map.md` 只刷新计数） |

## 执行顺序

1. A1 提交（现状全绿，先固化）→ A2 状态回填
2. B1 护栏语义 → B2 评分口径 → B3 清洗清账（P0 收尾）
3. C1 → C2 → C3 → C4/C5（链路真有应用效果）
4. D1–D6 长尾
5. E1 需用户操作；E2/E3/E5 需用户拍板

## 完成记录

### B1 护栏语义（假控制）— 2026-09-28

- 交付：`shared/lib/guardrail-scope.ts`（判据 + 审计单源）；服务端 `isConfigurableGuardrailAsset` 委托
  `isReadyQualityGuardrail`（零行为变更）；`getGuardrailSelectionAudit` + 面板「已声明但未产生净增（N）」回执区块；
  `SkillsStudioView` 计数改为 `selectable.length`。
- 口径：25 张质量护栏 = 12 默认生效 + 9 可选（7 真净增 + 2 引用壳）；实测 core-slop-shield / square-13 配置后
  stagePrompts 逐字节不变，de-ai-tells-guard writer 541→948，private-162 writer 541→710。
- 证据：`tests/guardrail-scope.test.ts` 5/5、`src/tests/guardrail-policy-panel.test.tsx` 4/4、前端定向 75/75、
  tsc 0、eslint 0、快照六场景逐项不变。
- 残余：写路径仍接受无净增配置（存量兼容）；4 张未就绪护栏去向归 B3。

### B2 评分口径显性化 — 2026-09-28

- 单源：`shared/lib/prompt-score-policy.ts`（分档 A≥90/B≥80/C≥70/D≥60/F<60、门槛 70/60、
  `scoreAdmissionOf`、`scoreBadgeLabel`、`SCORE_POLICY_SUMMARY`、封顶分常量）。
- 接线 5 处：`prompt-sanitizer.promoteToRuntimeReady`、`prompt-governance-catalog` 4 处家族分档 + 出口归一、
  `public-catalog-pipeline.recalibrateGrade` 与常量、`src/lib/capability-governance.ts` 4 处假兜底、
  `QualityTab` 口径说明行 + 卡面徽标。
- 漂移修正：7 张（56 分 4 张 D→F；78/76 分 3 张 B→C）；公开目录重生成 51 行全部为 grade 行。
- 证据：`tests/prompt-score-policy.test.ts` 6/6、`src/tests/quality-tab-score-policy.test.tsx` 1/1、
  探针 0 mismatch、tsc 0、eslint 0、快照六场景逐项不变（规格 §5.13）。
- 残余：审稿分档与 curated S/A/B 评级未并轨（登记）。

### B3 目录滞留清账 — 2026-09-28

- 单源：`scripts/lib/catalog-disposition.ts`（去向判定 public / sanitized-copy / duplicate-absorbed /
  declared-internal / unclassified，后者必须为 0），可复跑报告 `scripts/report-catalog-hygiene.ts`。
- 清账结果：179 张 = public 132 + sanitized-copy 33 + duplicate-absorbed 6 + declared-internal 8 + unclassified 0；
  41 张「通过准入但不在公开目录」= 33 副本 + 6 换皮 + 2 测试夹具；13 张「needs-sanitization 且无副本」
  = 6 换皮被吸收 + 7 明确不公开（垃圾标题 6 + 夹具 1）。
- 证据：`tests/catalog-disposition.test.ts` 6/6、`scratch/capD-sanitize.ts` 复跑数字一致、
  tsc 0、eslint 0、后端全量 1413/1413（+6）、快照六场景逐项不变（规格 §5.14）。
- 残余：明确不公开的理由由生成侧规则复算，无人工拍板通道；副本源卡仍在 runtime 目录且 UI 未标注「仅副本公开」。

### C1 cardRef 挂真实步骤 — 2026-09-28

- 交付：5 条平台链路各 ≥1 步挂 `cardRef`，共 6 步（planner 4 / writer 1 / critic 1）——
  小飞鸡 step1←`private-181`、天马 step4←`private-168`、风华 step1←`private-89`、
  拆书 step2←`deconstruction-pacing-dissect`、番茄 step2←`de-ai-tells-guard`、番茄 step3←`tomato-opening-diagnostic`。
- 语义：卡片正文以 `【步骤卡：<id>（role）】` + 模板原文进声明阶段 prompt；assetId 回退保留。
- 证据：`tests/flow-step-card-mounts.test.ts` 8/8（声明覆盖 + 六条集成命中 + 未挂卡回归）；
  快照**仅** `flow-square` planner `5dde5c7b(68)` → `47eae3c5(240)`，其余五场景逐项不变；
  flow-audit 新增 `card=` 列；生成物 +42 行；tsc 0 / eslint 0 / 后端全量 1421/1421（+8）（规格 §5.15）。
- 残余：`guidanceOnly` 与挂卡并存（可用性语义待批次 D）；其余 13 步「仅引导」未挂卡（D1）；
  选卡为人工拍板，无自动选卡机制（C3）。

### C2 双门合一（旧 `qualityGate` 收敛）— 2026-09-28

- 交付：`FlowStepGate.kind` 增 `advisory` + `note`；删 `SkillSeriesFlowStep.qualityGate`；30 步文案迁入 `gate.note`
  （28 advisory + step5 mechanical + step6 critic/80）；`flowStepGatePromptText` / `flowStepGateDisplay` 单源出口，
  服务端提示词、快照字段、PlanningTab / SkillsStudioView 全部走同一出口。
- 脱敏：`PATH_TEXT_KEYS_TO_SANITIZE = {'gate.note'}` + `cloneAndSanitizeAt`（按路径脱敏，旧 key 已移除）。
- 证据：`tests/flow-step-gate-migration.test.ts` 5/5；既有门测试与前端 7/7 迁移；生成物 diff 116/32 全为 gate 行；
  快照六场景逐项不变（迁移后提示词零变化）；tsc 0 / eslint 0 / 后端定向 72/72 / 后端全量 1426/1426（+5）（规格 §5.16）。
- 残余：advisory 无强制语义（设计如此）；`gate.note` 无长度约束；30 步文案未进回执行。

### C3 维度补卡（人物 / 道具 / 副本）— 2026-09-28

- 交付：三张自撰内置卡 —— `character-arc-dossier`（人物弧光档案，84）、`relic-system-designer`（道具与遗物体系设计器，82）、
  `arc-instance-designer`（副本（事件单元）设计器，80）；人物维度改用小飞鸡 step3 换资产（`square-183` → `character-arc-dossier`，
  同时删 `guidanceOnly`）；道具/副本维度以**追加**步骤落在天马链 step5/step6（不改既有编号与 id）。
- 读数（`scratch/capB-chain.ts`）：步骤 32 · 可运行 19（59.4%）· 仅引导 13；人物/道具/副本各 1 步且均可运行；
  被引用资产 24 / 目录 182；新输出 `artifact-list` / `arc-units` 登记为 planning 类。
- 证据：后端定向 7 文件 **92/92**；前端定向 4 文件（guidance/gate/progression/plan158）**71/71**；
  生成物 135 资产（+246/−3）；快照六场景不变；tsc 0 / eslint 0（规格 §5.17）。
- 残余：三卡无外部来源（score 人工给定）；道具/副本仅天马一条链；未闭合维度 创意构思 1/4、审稿 1/3、其他 0/4（批次 D）。

### C4 死字段与半接线清理 — 2026-09-28

- 交付：① `foreshadowingTasks` / `payoffNote` 接线进 critic `checklistText`（逐条编号伏笔任务 + 回收安排）；
  ② 删 `ExecutionSnapshot.sessionCards`（类型 + `writing-style-service.ts:1107/2079` 两处写入 + 测试 key）；
  ③ `techniques` / `skillStack` 接线：`ProductionExecutionReceipt` 增可选两字段，`ProductionRunReview` 新增「卡组装配」「技法」两行，
  `production.ts` 阶段收据 `itemCount` 补 `techniqueCount`（此前少报技法）。
- 证据：`tests/plan262-c4-deadwiring.test.ts` 4/4；`src/tests/production-run-review.test.tsx` 17/17（+1）；
  后端定向 16 文件 158/158；tsc 0 / eslint 0；后端全量 **1430/1430**（+4）、前端全量 **158 files / 1009 tests**（+1）、快照六场景逐项不变（规格 §5.18）。
- 残余：快照 `techniques`/`skillStack` 字段仍无运行时读方（消费的是局部变量，本次只补证据面）；伏笔任务为文本清单、无结构化判定；
  `payoffNote` 取台账首行（多条伏笔时拼接文本）。

### C5 步骤引用图谱能力卡 — 2026-09-28

- 交付：① 新增能力引用解析面 `shared/lib/flow-step-capability-ref.ts`（六类诊断码；判定与执行内核同源：运行白名单 → 运行类工具卡 → `runtimeStatus` → `allowedScopes` 含 `project` → 货架 runtime-ready → 非壳）；
  ② 类型与快照接线：`SkillSeriesFlowStep.capabilityRef`、`ExecutionFlowStep.capabilityRef/capabilityWarning`，`buildFlowStep` 暴露只读元数据；
  ③ 目录落两步：拆书 `book-deconstruction-flow-step3` 知识谱系抽取（`knowledge-extract`，planner）、小飞鸡 `xiaofeiji-novel-flow-step9` 伏笔回收诊断（`foreshadow-settle`，critic），均 advisory 门 + `navigateTo: bible`，原 step2/step8 的 `nextStepId` 改接新尾步；
  ④ 关键不变式：能力步骤的 `assetPrompt` 只剩步骤合同，工具卡正文不进任何提示词层级；
  ⑤ 运行入口：`PlanningTab` 「可执行能力」区块 + `runKnowledgeCapability` 客户端 + `summarizeKnowledgeCapabilityResult` 单源摘要（失败显 `code：message`）。
- 证据：`tests/flow-step-capability-ref.test.ts` 6/6（解析器诊断码 / 目录面 / 集成快照与提示隔离 / 执行面幂等与摘要）；`src/tests/planning-tab-step-capability.test.tsx` 4/4；`src/tests/planning-tab-step-progression.test.tsx` 23/23（尾步 8→9）；后端定向 8 文件 89/89；tsc 0 / eslint 0；生成物重跑 diff +42/−2；
  后端全量 **1436/1436（+6）**、前端全量 **159 files / 1014 tests（+1 文件 / +5 用例）**、快照六场景逐项不变（规格 §5.19）。
- 读数：34 步 / 可运行 21（61.8%）/ 仅引导 13；gate kinds advisory 32 + mechanical 1 + critic 1；byStage planner 21 / writer 9 / critic 4；串台对照 34×33=1122；引用资产 26/182。
- 残余：只支持作品级同步动作（服务端 run 路由仅两张卡，`_NO_KERNEL` 为硬边界）；运行结果不落库；`capabilityRef` 尚无生产回执 / 审计消费方。

### 消毒缺口收口：渲染层目录边界 — 2026-09-28

规格：`docs/specs/capability-sanitize.md` 不变式 3「渲染层目录边界」。

**缺口**：`src/lib/capability-governance.ts:1` 直接 import 源治理目录 `prompt-governance-catalog.ts`
（携带 182 条 `template` 全文），该模块被 15+ 渲染层文件间接消费、`RUNTIME_STYLE_CATALOG` 亦源此，
未消毒正文进渲染包的通道一直开着。

**处置**：

1. 生成管线新增全量壳目录：`scripts/lib/public-catalog-pipeline.ts` 的 `shellCatalog`
   = `cloneAndSanitize(dedupeById([...PROMPT_GOVERNANCE_CATALOG, ...GOVERNED_ASSETS_V2_REGISTRY]))`，
   出参 `PUBLIC_SHELL_CATALOG`（`shared/lib/public-skill-catalog.ts`，生成物，`template` 物理清空）。
   去重顺序 = **源目录优先**；注册表优先会让 `tomato-opening-validator` 的 placementTier / licenseStatus /
   sourceType / inputs 四项漂移。
2. 渲染层切生成物：`capability-governance.ts` 删源目录 import，8 处引用改 `PUBLIC_SHELL_CATALOG`，
   `RUNTIME_STYLE_CATALOG = [...PUBLIC_SHELL_CATALOG, ...SANITIZED_SKILL_COPIES]`。
3. **模板派生语义固化**：`GovernedPromptAsset` 新增 `isShellBody?: boolean`（生成期写入
   `isShellTemplatePrompt(asset.template)`）；`shared/lib/guardrail-scope.ts` 的 `isShellGuardrail`
   优先读该标记、缺省回退模板判定。不固化则 `template` 清空令「引用壳」分类全体反转，
   前端 `src/tests/guardrail-policy-panel.test.tsx` 立即红（实测发生过）。
4. 守护测试 `tests/renderer-catalog-shell.test.ts`（7 例）：静态边界（`src/**` 非测试不得 import
   源治理目录）、壳目录无正文、id 覆盖、治理字段零漂移、壳标记与「引用壳」分类两侧一致、
   渲染层治理函数可用。

**验证**：生成物重跑 `node --import tsx scripts/generate-public-catalog.ts`（GEN_EXIT=0，+6527 行）；
守卫组 24/24（含 freshness / governance）；前端定向 `guardrail-policy-panel` + `style-shelf-decks` 12/12。

**附带发现（待拍板）**：`getSanitizeRequiredAssets()` 实测 0 条——「需解锁」白名单当前为空
（源目录口径同为 0：13 张候选或已有副本、或标题判为垃圾/重复），该投影面为死面。

### 登记

- 消毒缺口（原「B1 附带发现」，待拍板）→ **已处置（2026-09-28）**：见下「消毒缺口收口：渲染层目录边界」。
  附带发现 `getSanitizeRequiredAssets()` 实测 0 条（「需解锁」投影是死面）仍待拍板处置。


- 根账本：`plans/README.md` Round 46（2026-09-28）
