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
| C3 | 维度补卡 | 链路仅引用 22/179 张；人物 1 步、道具 0、副本 0、创意构思 1/4、审稿 1/3、其他 0/4 | 人物/道具/副本各 ≥1 可运行步骤；`capB-chain.ts` 缺口表更新 |
| C4 | 死字段/半接线清理 | `foreshadowingTasks` 构建无消费（`server/helpers/knowledge-lineage-enrich.ts:90/128`）；`payoffNote` 部分消费（`:446`）；`ExecutionSnapshot.skillStack`/`techniques` 写入无读方，`overlays`/`sessionCards` 只进回执（`server/lib/db/product-events.ts:536-593`） | 逐项接线或删除，处置登记规格 |
| C5 | 步骤引用图谱能力卡 | `knowledge-extract`/`foreshadow-settle` 未被任何链路步骤引用（批次 C 第 4 条） | ≥1 步引用并断言执行面 |

## 批次 D：长尾（已登记残余）

| # | 项 | 现状 |
|---|---|---|
| D1 | 14 步「仅引导」补正文 | 番茄 4 / 天马 3 / 拆书 1 / 风华 4 / 小飞鸡 2；当前 16/30 可运行（53.3%），到 80% 需再补 8 步 |
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
- 残余：`guidanceOnly` 与挂卡并存（可用性语义待批次 D）；其余 14 步「仅引导」未挂卡（D1）；
  选卡为人工拍板，无自动选卡机制（C3）。

### C2 双门合一（旧 `qualityGate` 收敛）— 2026-09-28

- 交付：`FlowStepGate.kind` 增 `advisory` + `note`；删 `SkillSeriesFlowStep.qualityGate`；30 步文案迁入 `gate.note`
  （28 advisory + step5 mechanical + step6 critic/80）；`flowStepGatePromptText` / `flowStepGateDisplay` 单源出口，
  服务端提示词、快照字段、PlanningTab / SkillsStudioView 全部走同一出口。
- 脱敏：`PATH_TEXT_KEYS_TO_SANITIZE = {'gate.note'}` + `cloneAndSanitizeAt`（按路径脱敏，旧 key 已移除）。
- 证据：`tests/flow-step-gate-migration.test.ts` 5/5；既有门测试与前端 7/7 迁移；生成物 diff 116/32 全为 gate 行；
  快照六场景逐项不变（迁移后提示词零变化）；tsc 0 / eslint 0 / 后端定向 72/72 / 后端全量 1426/1426（+5）（规格 §5.16）。
- 残余：advisory 无强制语义（设计如此）；`gate.note` 无长度约束；30 步文案未进回执行。

### 登记

- B1 附带发现（待拍板）：`src/lib/capability-governance.ts:1` 直接 import 源目录 `PROMPT_GOVERNANCE_CATALOG`
  （含模板全文）进渲染层，可能绕过公开目录的模板剥离面；当前无测试钉住，需决定是否纳入批次 C。


- 根账本：`plans/README.md` Round 46（2026-09-28）
