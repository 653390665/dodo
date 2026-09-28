# Plan 262：能力卡 / 链路 / 图谱收口（P0 剩余 + 链路真实化 + 长尾）

- 状态：✅ 已完成（2026-09-28；E1 push 需用户、E6 复测待真实样本）
- 立项：2026-09-28（Round 46）
- 前置：Plan 261 知识谱系；四批次收敛（commit `7e0efc7`）；P0-① 装配三字段运行时接线（本轮首提交）
- 规格承载：`docs/specs/capability-flow-graph-consolidation.md`（§4.2.3 已落地；§5.4.1/§5.5/§5.6/§5.9/§5.10/§5.11 的「残余」为各批次验收回写点）
- 复跑脚本：核心五个已随仓库交付 —— `scripts/report-flow-chain-coverage.ts`（链路引用面）、`scripts/report-catalog-sanitize.ts`（清洗层）、`scripts/report-flow-step-audit.ts`（步骤可运行/仅引导）、`scripts/report-stageprompt-snapshot.ts`（六场景哈希）、`scripts/report-card-role-coverage.ts`（角色投影覆盖）；`scratch/`（gitignored）仅存一次性侦察脚本（如 `g2-guard-probe.ts` 护栏通道 Δ）
- 完成定义（每条统一）：实现落盘 → 定向测试 + `npx tsc --noEmit` + `npx eslint server src shared tests scripts --max-warnings=0` 全绿 → `scripts/report-stageprompt-snapshot.ts` 六场景哈希逐项不变（若本项有意改提示词，记录变更前后数值）→ 规格文档回写证据与残余 → 单独提交 → 本账本状态更新

## 批次 A：在制品收口（本轮先做）

| # | 项 | 现状 | 完成判据 | 状态 |
|---|---|---|---|---|
| A1 | 提交 P0-① 单元 | 已提交 `645c572`（装配三字段接入运行时三通道）；台账提交 `4f2ffa2`；tsc/lint 0、后端 1396/1396、前端定向 20/20、快照逐项不变；工作区 clean | 提交且工作区 clean | ✅ 已完成（2026-09-28 对账回填） |
| A2 | 规格状态回填 | `docs/specs/creation-entry-convergence.md:4` Status = 「已交付（2026-09-28 复核：实现随 `9a2c234` 落库，定向测试 `creation-entry-convergence` 7/7 + `app-shell-capability-launch` 20/20 全绿）」 | Status 改为已交付并注明复核日期 | ✅ 已完成（2026-09-28 对账回填） |

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
| D1 | 13 步「仅引导」补正文 ✅ 已交付（2026-09-28，Plan 263） | 7 步改指自撰内置卡（番茄 step4/step5、风华 step2/step3/step5、天马 step1/step2）→ 可运行 **28/34（82.4%）** / 仅引导 **6**；余 6 步 = 已挂 cardRef 的步骤（卡正文已由卡片通道注入，assetId 仍为壳——见「### D1 …」残余） |
| D2 | 伏笔面板加图谱维护入口 ✅ 已完成（2026-09-28） | 现只挂 World Bible 图谱页（`src/components/ForeshadowingPanel.tsx` 内无入口） |
| D3 | 章节回滚 stale 打标 | ✅ 已交付（2026-09-28，Plan 263）：`chapter_versions.content_hash` + stale 判定 + 时光机徽标 |
| D4 | 记忆健康度补完 | ✅ 已交付（2026-09-28，Plan 263）：新增「伏笔欠账」指标 + 一条硬阈值告警（阈值单源 `MAX_ARREARS_IN_PROMPT`，越线琥珀 + 阈值说明）；其余指标仍只显示数值 + 未知降级；整体阈值口径挂 E6 真实数据（RAG 缓存 / 孤立节点并入口径未做） |
| D5 | 长篇记忆基线补完 ◐ 技术债（2026-09-28 登记） | 样本为确定性合成长书；回声口径「token 是否进请求」；planner/critic 未纳入；未接 CI —— 按 Plan 263 D5 拍板**降级为技术债**（不排期；触发条件 = 真实长篇样本到手后重跑） | **触发线（2026-09-28 Plan 264 登记）**：任一作品 ≥ 30 万字或 ≥ 100 章时复跑 `scripts/long-memory-baseline.ts`（含 planner/critic 与「token 是否进请求」回声口径），读数回写 `plans/264-residual-closeout.md`。
| D6 | 三字段 UI 写入口 ✅ 已结案（2026-09-28，Plan 263） | 三字段**标为内部**（只经 profile 写入，不做 UI 写入口）；UI 的固定额度文案移除：`src/components/Library.tsx:265` `能力卡 ${capabilityCardCount}/3` → `能力卡 ${capabilityCardCount}` |

## 批次 E：需拍板 / 跨会话遗留

| # | 项 | 现状 |
|---|---|---|
| E1 | push 被 gh 凭证阻塞 | 本地领先 `origin/codex/plan169-checkpoint` 147 提交（2026-09-28 核对）；需用户在终端 `gh auth login -h github.com` |
| E2 | ✅ 已交付（2026-09-28，Plan 263 E2） | 拍板①**随包附权重**：取权重脚本 → `build/embedding-model/`（4 文件 23.3 MB，gitignored）→ `extraResources` 落 `resources/embedding-model/`；`server/embedding.ts` `resolveEmbeddingAssetPaths` 齐备时本地解析并关远程；`electron.cjs` 打包态注入 `INKFLOW_EMBEDDING_MODEL_DIR` + `INKFLOW_MODEL_CACHE_DIR`（userData/models-cache）；`check-package-artifacts.mjs` 增 ≥20 MB 权重断言；`tests/embedding-model-assets.test.ts` 11/11（含 sha256 pin 3 例）、tsc/lint 0（详见「### E2 打包态嵌入模型路径」） |
| E3 | ✅ 已交付（2026-09-28，Plan 263 E3）：M7 npm/Node 版本告警 | 现状 npm v12.0.2 不支持 Node 22.22.0（需 ^22.22.2 / ^24 / ≥26）—— 已落地：`.nvmrc`/`.node-version` = `22.22.3`、`engines` = `>=22.22.3 <23`、CI 四处 `node-version-file: .nvmrc`、守卫 `tests/node-version-declaration.test.ts` 2/2 |
| E4 | ✅ 已交付（2026-09-28，Plan 263 E4）：M2 会话隔离 | 未用 worktree，现以「每单元提交 + 提交前清点」替代 —— 决定：不新增规范文件，两条硬规则并入 `docs/specs/multi-agent-workflow.md`（单 checkout 串行写入 / 工作单元边界） |
| E5 | ✅ 已结案（2026-09-28，Plan 263 E5）：双账本（plan 191 DOCS-3） | 根 `plans/README.md` 主账 vs `docs/plans/README.md` 能力卡轮账本 —— 处置：`docs/plans/README.md` 冻结为只读存档，根 `plans/README.md` 为唯一权威账本，`MEMORY.md` 指针已指向根账本 |
| E6 | 真实数据缺口 ◐ 复测工具已就绪（2026-09-28），样本待真实用户 | 现有漏斗（1016 事件/8 作品）是操作者狗粮，不足以定 P0；埋点口径三处已修，离线复测脚本 + runbook 已落盘（见下「E6 复测工具」） |
| E7 | 架构图集漂移 ✅ 已交付（2026-09-28，Plan 263 E7） | 取证停 2026-09-18（`84fb175`），未覆盖 Plan 261 + 四批次新链路 —— 已在 `docs/architecture/inkflow.architecture-understanding.md` 补「十一、知识谱系」「十二、能力链路」两节 + 顶部复核行（2026-09-28 / `4b68c24`），`docs/architecture/README.md` 加复核声明 |

### E7 架构图集补章：知识谱系 + 能力链路 — 2026-09-28（Plan 263 执行）

- 补写位置：`docs/architecture/inkflow.architecture-understanding.md`（业务语言优先的 as-is 模型）新增两节：
  - **十一、知识谱系**：续写资料包 → `foreshadowings` / `entity_relationships`（幂等、提案制）→ 两条消费路径（`server/helpers/knowledge-lineage-enrich.ts:242 loadForeshadowingContext` 接 planner/writer/critic；`server/routes/production.ts:295` → `shared/lib/story-state-ledger.ts:110` 接章节合同）→ 可执行能力端点（`server/routes/utilities.ts:53`）→ 观察面（记忆健康度五项、欠账阈值 12）。
  - **十二、能力链路**：6 条技能序列流 / 34 步 → 步骤三通道（资产正文 / `cardRef` 卡片引用 / `capabilityRef` 能力引用）→ 装配与注入（`server/helpers/writing-style-service.ts:1164`、`:2026-2031`）→ 质量门三类 → 读数 28/34（82.4%）/ 仅引导 6（= 已挂 cardRef 的 6 步）。
- 复核日期：两节明标「取证日期 2026-09-28（HEAD `4b68c24`）」，文件顶部加复核行；`docs/architecture/README.md` 顶部加复核声明（2026-09-28 / `4b68c24`）。
- 顺手修正：文件末尾「本仓库未安装 Graphviz，故未产出 SVG」与实际不符（本机已装、6 张 `.dot` 已验证可渲染，`candidate-store-model.dot`/`flow-chapter-candidate.dot` 依赖 `newrank=true`）。
- 残余（未纳入本节）：`docs/architecture/architecture-review.md` 的 R1–R11 仍是 2026-09-18 基线（已有 2026-09-28 复核块声明，见 P1 对账）；`inkflow.evidence.md` 未逐条刷新；`docs/architecture-map.md` 只刷了计数（复核 2026-09-23 / `51954f2`）。

### E2 打包态嵌入模型路径：随包附权重 — 2026-09-28（Plan 263 执行）

- 拍板（`plans/263-closeout-and-truth-up.md:72`）：① 随包附权重；打包态缓存目录指向 app resources；模型 id `Xenova/bge-small-zh-v1.5` 与 `dtype: 'q8'` 不得改（`vector_chunks` 按 modelId 匹配）。
- 问题（R6 / M6）：全仓无任何 `cacheDir` / `localModelPath` 设置 → transformers.js 默认把缓存指向 `dirname(dirname(import.meta.url))/.cache`，而 `scripts/build-server.mjs` 的 banner 把 `import.meta.url` 钉成 `dist-electron/server.cjs`（`asarUnpack` 首位）→ 实际落 `…/Resources/app.asar.unpacked/.cache|models`：可写但不该写（签名包体 / Gatekeeper translocation / 自动更新重建 .app 会清空缓存）；且 `files`/`extraResources` 从未随包权重 → 打包首启必然联网拉 HF Hub。
- 交付：`scripts/lib/embedding-weights.mjs`（`EMBEDDING_MODEL_ID` / `EMBEDDING_MODEL_FILES` / `MIN_QUANTIZED_MODEL_BYTES = 20 MB` / `PACKAGED_EMBEDDING_MODEL_REL` / `isCompleteModelDir` / `embeddingWeightsVerdict`）+ `scripts/fetch-embedding-model.mjs`（来源顺序 `INKFLOW_MODEL_SOURCE_DIR` → `node_modules/@huggingface/transformers/.cache` → `huggingface.co`；`SKIP_EMBEDDING_MODEL_FETCH=true` 跳过；缺文件 exit 1）；`package.json` `model:fetch` + `package` 链插取权重 + `build.extraResources`；`server/embedding.ts` `LOCAL_EMBEDDING_MODEL_FILES` / `resolveEmbeddingAssetPaths` / 模块级 env 应用 / 就绪日志带三个 env；`electron.cjs` 打包态两个 env（dev 不注入）；`scripts/check-package-artifacts.mjs` 权重断言。
- 读数：取权重 exit 0 → `build/embedding-model/Xenova/bge-small-zh-v1.5/` 4 文件 23.3 MB（`onnx/model_quantized.onnx` = 24010842 B，全部来自本地缓存）；`npx tsc --noEmit` 0 / `npx eslint server src shared tests scripts --max-warnings=0` 0；`tests/embedding-model-assets.test.ts` 9/9；受影响面 4 文件 23/23。
- 残余：打包态真机验证未做（`npm run package` 需联网拉 Electron 头，本机 `huggingface.co` 不可达）→ 验收的「打包件内无 `.cache`/`models`」「打包态打印 cacheDir」「断网首启 unavailable + 指引」三条仍待联网环境复跑。
- 残余（审计 2026-09-28 追加，三项）：① **发布链依赖 `huggingface.co`** —— `@huggingface/transformers@3.8.1` 的 npm `files` = `[src, dist, types, README.md, LICENSE]`，权重目录不由包携带（本机 `.cache` mtime 2026-09-10 = 运行期下载）；CI 三个打包作业（`.github/workflows/build.yml:139/:200/:280`）均 `npm ci` 后 `npm run package` → 冷启动无缓存，只能走 Hub 下载，不可达即 `exit 1`（发布硬失败）；② **冒烟逃生舱**：`SKIP_EMBEDDING_MODEL_FETCH=true` 时 `embeddingWeightsVerdict` 返回 ok（`scripts/fetch-embedding-model.mjs:9` 已声明「冒烟检查同步跳过权重断言」）→ 该模式下可产出无权重发布件且通过 `smoke:package-artifacts`；③ **判据只有尺寸下限**（`MIN_QUANTIZED_MODEL_BYTES = 20 MB`），无 sha256 / revision pin → 上游文件漂移或损坏可通过。处置待拍板：① pin revision + 发布机预置权重或接受 Hub 依赖；② 产物断言不再随 SKIP 跳过（或仅允许显式 `--allow-missing-weights`）；③ 补 sha256 清单。
- 加固（2026-09-28，Plan 263 R3，**销账第③项**）：权重 sha256 pin —— `scripts/lib/embedding-weights.mjs` 新增 `EMBEDDING_MODEL_SHA256`（4 文件实测哈希）、`hashFileSha256`、`verifyModelDirHashes`，`embeddingWeightsVerdict` 在尺寸判据之后增 hash 校验（`hashOf` 可注入）；`scripts/fetch-embedding-model.mjs` 取完权重即校验，不符抛错 `权重 sha256 不匹配：…`（exit 1）；`tests/embedding-model-assets.test.ts` 补 3 例（映射键 == 文件清单 / 篡改与不可读 / 冒烟判定 hash mismatch），11/11；实测 `node scripts/fetch-embedding-model.mjs` = 4 文件 cached + 退出 0。残余①（发布链 Hub 依赖）已由 D5 关闭（见下条）；第②项见下条。
- 加固（2026-09-28，Plan 263 D6，**销账第②项**）：冒烟逃生舱改为显式命令行开关 —— `scripts/check-package-artifacts.mjs` 不再读 `SKIP_EMBEDDING_MODEL_FETCH`，改为 `--allow-missing-weights`（命中时向 stderr 打 warn 行）；`SKIP_EMBEDDING_MODEL_FETCH` 只保留在「取权重」步骤（离线开发用）。`tests/embedding-model-assets.test.ts` 11/11。残余①（发布链 Hub 依赖）已由 D5 关闭（见下条）。
- 加固（2026-09-28，Plan 263 D5，**销账第①项**）：权重「仓内随包」—— `.gitignore:2` 由 `build/` 拆为 `build/*` + `!build/embedding-model` + `!build/embedding-model/**`，`build/embedding-model/Xenova/bge-small-zh-v1.5/` 4 文件（23.3 MB，sha256 已由 R3 pin）纳入版本控制；CI 冷启动 `npm ci` 后取权重步骤命中「目标已可用 → cached」，不再访问 `huggingface.co`（三个打包作业无需加缓存步骤）。`build/entitlements.mac.plist` / `build/entitlements.mac.inherit.plist` 内容读不出（系统保护）→ 不纳入版本控制，保持忽略（`package.json:154-155` 引用不变）。读数：`git ls-files build/embedding-model` = 4 文件；`rm -rf build/embedding-model` 后 `git checkout -- build/embedding-model` 可离线恢复且 4 文件 sha256 全等于 pin；`node scripts/fetch-embedding-model.mjs` = 4 文件 cached + 退出 0；`tests/embedding-model-assets.test.ts` 11/11。
- 证据：`tests/embedding-model-assets.test.ts`（清单与模型 id 双源一致 / `resolveEmbeddingAssetPaths` 三态 / package.json 接线 / electron.cjs 注入 / 冒烟判定四态 / SKIP 模式 / 真实产物 ≥20 MB）。

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
- 证据：`tests/catalog-disposition.test.ts` 6/6、`scripts/report-catalog-sanitize.ts` 复跑数字一致、
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
- 读数（`scripts/report-flow-chain-coverage.ts`）：步骤 32 · 可运行 19（59.4%）· 仅引导 13；人物/道具/副本各 1 步且均可运行；
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
（源目录口径同为 0：13 张候选或已有副本、或标题判为垃圾/重复），该投影面恒为 0 = **非缺陷**（Plan 263 #3 结案：空分组不渲染/契约保留，见 `src/tests/skills-studio-plan158.test.tsx:1856`）。

### D2 伏笔面板图谱维护入口 — 2026-09-28

**现状**：图谱维护只有 World Bible 图谱页一个入口（`WorldBibleView.tsx` 的 `activeTab === 'graph'` 容器），
用户在伏笔管理现场（`ForeshadowingPanel`，挂 `AgentWorkspace`）看不到维护入口。

**处置**：`ForeshadowingPanel` 新增折叠条「图谱维护：资料包知识谱系」（`aria-expanded` / `aria-controls`），
展开后按需挂载 `KnowledgeMaintenancePanel`（未展开不挂载 → 零请求），`onCompleted={refresh}` 让重跑成功后
伏笔列表立即刷新。**不做跨视图跳转**：World Bible 图谱页路由面（`AppShell` launchState）本轮不动，
且内嵌保持维护逻辑单源（不复制重跑实现）。

**证据**：`src/tests/foreshadowing-graph-entry.test.tsx` 4/4；受影响面回归 3 文件 9/9；tsc 0 / eslint 0。

### D3 章节版本指纹（stale 打标）— 2026-09-28（Plan 263 执行）

- 拍板：**不引入 source 枚举**（`chapter_versions` 无来源列，回退语义原为未定义）；改为回答「这份快照与当前正文是否一致」。
- 落地：`server/lib/db-init.ts:379-387` 建表加 `content_hash TEXT` + `ensureColumn('chapter_versions', 'content_hash', 'TEXT')` 迁移；`server/lib/db-mappers.ts` 新增 `hashChapterContent()`（sha256 原文 utf8，**不做空白归一化**）、`rowToChapterVersion` 读、`chapterVersionToRow` 写（`cv.contentHash ?? hashChapterContent(cv.content)`）；`server/lib/db/chapters.ts:139-149` `insertColumns` 与 `:242` accept 前置快照 raw INSERT 均补列（漏列会被静默丢弃）；`listChapterVersionMetas` 返回 `contentHash` + `matchesCurrentContent`（NULL → null = 旧快照）；`src/components/AgentWorkspaceVersionsPanel.tsx` 卡片徽标「＝ 当前正文 / ≠ 与当前正文不同 / 来源未知（旧快照）」。
- 证据：`tests/chapter-version-content-hash.test.ts` 5/5（手动快照指纹 / 正文更新后不同 / 旧行 NULL → 未知 / accept 前置快照带指纹 / 不归一化）、`src/tests/agent-workspace-versions-panel.test.tsx` 3/3、`src/tests/chapter-versions.test.ts` 夹具补两字段 1/1；tsc 0 / eslint 0。
- 取证副产品：`tests/db-import-serialization.test.ts` 的 1 例失败经 worktree 基线（HEAD `86ebb62`）复核为**调用方式缺陷**（漏 `NODE_ENV=test` → `isMonetizationEnabled()` 假 → `reserveQuota` 返回 `{allowed:true}` 无 `reservationId`），非回归；`AGENTS.md:26` 的定向命令已据此修正。
### D4 记忆健康度告警阈值 — 2026-09-28（Plan 263 执行）

- 拍板：**只设一条有代码依据的硬阈值**，其余指标维持「只显示数值 + 未知降级」；整体阈值口径挂 E6 的真实数据（`docs/research/activation-funnel-runbook.md`）。
- 阈值单源：`shared/lib/knowledge-capabilities.ts` 新增 `export const MAX_ARREARS_IN_PROMPT = 12;`（注释点名两个消费者）；`server/helpers/knowledge-lineage-enrich.ts` 删除本地同名常量（原 `:175`）改 import —— 该值原本只是 critic 核对清单的注入预算（欠账截断），现在同时作为面板告警线（同一业务含义：超过预算就漏看）。
- 指标扩为五项：`MEMORY_HEALTH_METRIC_KEYS` = `openForeshadowings` / **`foreshadowArrears`（新增，标签「伏笔欠账」）** / `orphanNodes` / `staleKnowledge` / `ragHits`；`foreshadowArrears` 值与 `buildForeshadowSettlementChecklist(...).arrears` 同源；取数侧 `hasLedger ? (checklist?.arrears ?? 0) : graphIngested ? 0 : null`（未摄入 → 未知，不按 0 计，沿用 §5.9 口径）。
- 告警形态：`MemoryHealthMetric` 增 `severity?: 'warn'` 与 `thresholdNote?: string`；`isForeshadowArrearsWarning(arrears)` = `arrears !== null && arrears > MAX_ARREARS_IN_PROMPT`；越线时 `severity:'warn'` + `thresholdNote: 超过核对清单注入预算（> 12 条）`；`src/components/MemoryHealthPanel.tsx` 新增 `WARNING_VALUE_CLASS = 'text-amber-700'`（与「未知」的 `text-amber-800` 区分：一个是数据缺失，一个是数据越线）并展示阈值说明。
- 证据：`tests/memory-health.test.ts` **6/6**（五项同源 / 未摄入五项未知 / 越界 warn + thresholdNote / 边界 12 不告警）、`src/tests/memory-health-panel.test.tsx` **5/5**（越线琥珀 + 阈值说明，且未越线指标不出现阈值说明）、`src/tests/cockpit-memory-health-mount.test.tsx` **2/2**；tsc 0 / eslint 0。
- 未做（诚实登记）：① 只定了一条阈值（伏笔欠账），RAG 命中 / 孤立节点 / 失效知识的阈值需真实数据才能定（不拍脑袋）；② 告警只在驾驶舱面板出现，未进状态栏 / 通知；③ 欠账口径依赖「当前章 order」，无章节时无法判定（沿用未知降级）。
### D1 仅引导步骤补正文 — 2026-09-28（Plan 263 执行）

- 判据：`plans/263-closeout-and-truth-up.md:30`「补正文步骤的 assetId 指向 runtime-ready 资产（卡正文可进对应阶段 prompt）；达 80%」（34 步下 80% = ≥28 可运行）。
- 做法：沿用 §5.4.1 先例（自撰内置卡），为 7 个「无 cardRef 的仅引导步骤」新增 7 张内置卡并把步骤 `assetId` 改指新卡、删除 `guidanceOnly`：番茄 `step4`/`step5`、风华 `step2`/`step3`/`step5`、天马 `step1`/`step2`。不替换、不改写任何转投壳（§5.4 纪律），壳资产原样保留在目录中。
- 卡清单：`tomato-readthrough-audit`（80·B）/ `tomato-prose-polisher`（82·B）/ `lofter-aesthetic-outliner`（82·B）/ `viral-shortform-titler`（78·C）/ `emotional-logic-auditor`（80·B）/ `viral-idea-refiner`（82·B）/ `setting-rhythm-outliner`（80·B）；均 `sourceType`/`licenseStatus: 'built-in'`、`sanitizationStatus: 'runtime-ready'`、`runtimeStatus: 'active'`、`placementTier: 'agent-guided'`，正文 = 方法论 + 输出契约。
- 为何自撰：① 池内语义相近卡多为品牌私卡或系统/阶段模板（后者已被会话/阶段通道注入，复用会重复注入）；② 跨提示词替换违反 §5.4（= 伪造归属）；③ 新卡 `primaryCategory` 避开 `quality-guardrail`（否则会被 `shared/lib/guardrail-scope.ts:61-64` 并入系统护栏通道二次注入）。
- 读数（`scripts/report-flow-chain-coverage.ts` 复跑）：34 步 / 可运行 **28（82.4%）** / 仅引导 **6**（番茄 2 / 天马 1 / 风华 1 / 小飞鸡 1 / 拆书 1 / 通用 0）；目录 189（built-in 27）；引用资产 28/189；`cardRef` 6 步不变；公开目录再生 = 142 公开 + 33 副本。
- 残余：剩余 6 个「仅引导」步骤恰为已挂 `cardRef` 的 6 步 —— 卡正文已由卡片通道进入提示词，但 `assetId` 仍是平台壳（`availability` 读作 `guidance`）；把辅助卡改标为主资产属于「冒充主资产」，本批不做，登记为「`assetId` 与 `cardRef` 的可用性语义未收口」。
- 证据：`tests/flow-step-guidance.test.ts` **76/76**（含新增「D1 七张自撰内置卡 → asset + 声明阶段 prompt 含卡正文」集成用例）、`tests/catalog-disposition.test.ts`、`tests/prompt-assets-governed.test.ts`、`src/tests/planning-tab-step-guidance.test.tsx`、`src/tests/capability-shelf.test.ts`；快照六场景逐项不变；tsc 0 / eslint 0；后端全量 **1456/1456**、前端全量 **161 files / 1022 tests**；规格 §5.21。

### D5/D6 长尾登记：记忆基线技术债 + 三字段内部化 — 2026-09-28（Plan 263 执行）

- **D5**：按拍板降级为技术债（只登记，不补完）。登记内容 = §5.10 的四项残余（确定性合成长书样本 / 回声口径「token 是否进请求」/ planner·critic 未纳入 / 未接 CI）；触发条件 = 真实长篇样本到手后重跑 `node --import tsx scripts/long-memory-baseline.ts` 并复核口径。
- **D6**：三字段标为内部（`projectCards` / `chapterCards` / `singleRunCard`，只经 profile 写入），移除 UI 的固定额度暗示 —— `src/components/Library.tsx:265` 的 `能力卡 N/3` → `能力卡 N`（该 `/3` 不对应任何强制上限：`resolveProjectCards` 不截断，`shared/lib/capability-assembly.ts:162-169`）。为何不做写入口：写入需 channel 分流 + scope 校验 + 卡组面版本对照，等于新增一套装配编辑器；且 `chapterCards` 本就不写回章节状态（§4.2.3），做面会造出更大的「假控制」。
- 证据：`src/tests/library-refresh.test.tsx`（文案 `能力卡 3/3` → `能力卡 3`）；编辑器侧 `能力卡 3`（`src/tests/components.test.tsx:652`）未受影响；`npx tsc --noEmit` 0 / `npx eslint server src shared tests scripts --max-warnings=0` 0；前端定向 `library-refresh` + `components` 全绿；规格 §4.2.4 + §5.10 拍板行 + §5.22。

### E6 复测工具：激活漏斗离线报告 — 2026-09-28

**问题**：2026-09-22 复测暴露的读数（1016 事件 / 442 会话 / 8 作品；旧账本 152→0→1 与事实不符）来自一次性
scratch 脚本 + 一个临时起的 dev server：口径无法复核、动作无法复跑（scratch/ 被 .gitignore）。这正是「账实分离」
在度量面的一个实例。（2026-09-28 后续：核心读数脚本已入库 `scripts/`，见规格 §7；E6 即按此范式交付）

**处置**：

1. **口径单源**：`server/lib/db/product-events.ts` 抽出纯函数
   `buildProductEventMetrics(events: ProductEvent[], days = 30): ProductEventMetrics`，
   `getProductEventMetrics(days)` 转调它 → 离线报告与 `/api/product-events/metrics` 不可能漂移。
2. **离线 CLI**：`scripts/report-activation-funnel.ts` —— 读导出 JSON（`-` 支持 stdin），输出采样 / 北星 /
   激活漏斗（作品口径 + 会话口径）/ 能力链路 / 逐事件（事件·作品·会话）/ 判读纪律；标注「修复前口径事件」条数
   （断点 `2026-09-24`）。不连数据库：只消费 `GET /api/product-events/export` 的产物。
3. **runbook**：`docs/research/activation-funnel-runbook.md` —— 取令牌 / 导出 / 出报告三步命令、六项口径陷阱表、
   历史读数（标注修复前口径 + 狗粮样本）、重跑触发条件与「何时才能关闭 E6」。

**证据**：`tests/activation-funnel-report.test.ts` 4/4（纯函数与 DB 路径 `deepEqual` 零漂移 / 去重口径 /
报告读数行 / CLI 参数解析）；CLI 冒烟 `npx tsx scripts/report-activation-funnel.ts /tmp/e6-fixture.json` EXIT=0，
读数与手算一致（作品 2 / 会话 2、首次输入 1/1、转化 50.0%、`distinctObjectIds`=1）。

**未关闭原因（诚实登记）**：样本仍是操作者狗粮，无真实用户数据 → E6 只能标「工具就绪、待真实数据」，
不得据狗粮数据下产品 P0 结论。

### 登记

- 消毒缺口（原「B1 附带发现」，待拍板）→ **已处置（2026-09-28）**：见下「消毒缺口收口：渲染层目录边界」。
  附带发现 `getSanitizeRequiredAssets()` 实测 0 条（「需解锁」投影恒为 0 = **已结案为非缺陷**，Plan 263 #3）。


- 根账本：`plans/README.md` Round 46（2026-09-28）
