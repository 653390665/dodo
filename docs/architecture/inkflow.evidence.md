# InkFlow 架构证据索引

配套：`inkflow.structurizr.dsl`、`module-map.dot`、`candidate-store-model.dot`、
`lifecycle-states.dot`、`flow-chapter-candidate.dot`、`runtime-topology.dot`

取证日期：**2026-09-18**（`git` HEAD `84fb175`，分支 `codex/plan169-checkpoint`）

## 置信度标尺

| 标记 | 含义 |
|---|---|
| **H** | 直读代码/配置/schema/测试确认 |
| **M** | 多个间接信号一致，但无直接来源确认该关系 |
| **L** | 仅由命名、目录结构或约定推断 |
| **U** | 明确未知，列为待验证任务 |
| ✔ | 本次由主控 agent 亲自读源确认（非转述） |
| ⌁ | 来自定向勘察 agent 的报告，含 file:line 但未二次复核 |

结构证据 ≠ 行为证据。表/字段/枚举存在，只证明模型**容得下**这个概念，不证明有代码去**执行**它。下文分列。

---

## §A 分层与模块边界（module-map.dot）

| 断言 | 级别 | 证据 |
|---|---|---|
| 依赖只允许单向：`shared → ∅`、`server → shared`、`src → shared`；四方向矩阵由测试断言违规集为空 | **H** ✔ | `tests/architecture-boundaries.test.ts:59-111` |
| `src/** → server/**` 唯一例外 `src/tests/p0-ai-trust.test.ts`，注释明示「勿新增」 | **H** ✔ | 同上 `:78-93` |
| 生产代码不得 import `tests/` | **H** ✔ | 同上 `:104-111` |
| `src/components/**` 禁裸 `fetch()`，REST 须走 `src/lib` 客户端；3 个白名单例外均为流式/二进制语义 | **H** ✔ | 同上 `:113-160` |
| `shared/types.ts` 是纯 barrel，17 个再导出，本体不在其中 | **H** ⌁ | `shared/types.ts:1-18` |
| `shared/lib/` 52 个纯领域函数模块，被 server 与 src 同时消费（如 `prompt-sanitizer` 用于消毒端点） | **H** ⌁ | `server/routes/skills.ts:11`、`shared/lib/*` |
| 前端无路由库，靠 `VIEW_TYPES` 枚举 + `workspaceFocus` 手工切换 | **H** ⌁ | `shared/types/core.ts:142-154`、`src/lib/workspace-nav.ts:9-42`、`src/components/AppShell.tsx:1251-1258` |
| `main.tsx` 在 React 挂载**之前**全局改写 `window.fetch` 注入 Bearer | **H** ⌁ | `src/main.tsx:10-17`、`src/lib/authenticated-fetch.ts:8-51` |
| `POST /api/db` 是 75 方法白名单 RPC 分派面，未登记方法 400 | **H** ✔ | `server/routes/db.ts:118`（白名单）、`:241-245`（分派与拒绝） |
| 23 个 `register*Routes` 模块 + `chapter-completion` 单独挂载 | **H** ✔ | `server/routes/index.ts:32-56`、`server.ts:113-116` |
| Zustand 全仓无 `persist` 中间件，仅 2 个 store 自管 localStorage | **M** ⌁ | `grep persist( src/stores/` 零命中；`src/stores/app-store.ts:12,65`、`novel-store.ts:13` |
| `src/workers/` 仅 1 个文件（zip 解压），30s 硬超时后 terminate | **H** ⌁ | `src/workers/continuation-zip.worker.ts:5-12`、`src/lib/continuation-zip-client.ts:13,32-35` |
| 规模：server 32.7k / shared 23.5k / src 89.8k 行，共 535 个 ts/tsx | **H** ✔ | 本次 `wc -l` 统计 |
| `shared/config/` 名为 config 实为随包提示词资产，非运行时配置 | **H** ⌁ | `server/lib/config.ts:6-10` 引用 `prompt-templates` |

**最大单文件**：`shared/lib/public-skill-catalog.ts` 7158 行，且它是**生成产物**（模板与生成逻辑在 `scripts/generate-public-catalog.ts`）。内核膨胀风险集中点。⌁

---

## §B 生命周期与状态机（lifecycle-states.dot）

### B1 迁移已被行为证据确认（实线）

| 状态机 | 迁移 | 级别 | 证据 |
|---|---|---|---|
| `canon_patches` | `pending → accepted` | **H** ⌁ | `server/lib/db/canon-patches.ts:409`；`:381-392` 重复 accept 幂等 |
| | `pending → rejected` | **H** ⌁ | 同上 `:444`；`:439` 幂等；`:430-451` |
| | `pending → stale`（基线指纹 CAS 不符） | **H** ⌁ | 同上 `:396-403`（比对 `getCanonFingerprint`）、`:399` |
| | 终态再裁决 → `CANON_PATCH_TERMINAL` | **H** ⌁ | 同上 `:393-394` |
| `creative_artifact_candidates` | `pending → accepted/rejected/stale`，SQL 带 `AND status='pending'` | **H** ⌁ | `server/db/creative-artifacts.ts:694-696`、`:666` 白名单、`:582` 插入 |
| `outline_artifacts` | `candidate → active` | **H** ⌁ | `canon-patches.ts:321` `activateOutlineArtifactInTransaction` |
| | `active → archived` | **H** ⌁ | `server/routes/outlines.ts:508` |
| `chapter_production_runs` | `running → review_required → applied` | **H** ⌁ | `production.ts:338` / `:537,611,873,1133` / `:1639` |
| | `→ failed` | **H** ⌁ | `production.ts:560,853,1166,1210,1292` |
| `creation_flow_sessions` | `active → completed`（`WHERE ... status='active'`） | **H** ⌁ | `server/lib/db/creation-flows.ts:563-572`、`:422-445` |
| `continuation_packs` | `draft → approved`（需 `canonFacts>0` 且高危冲突=0；重复 → 409） | **H** ⌁ | `server/routes/continuation.ts:1590-1640`、`:1611`、`:1623-1628` |
| `continuation_packs.syncState` | `not_started → partial → synced`；哈希漂移自动 `→ stale` | **H** ⌁ | `server/lib/db/continuation.ts:73-90`、`shared/types/continuation.ts:114` |
| `continuation_extraction_jobs` | `queued → running → completed/failed/cancelled` | **H** ⌁ | `routes/continuation.ts:1264/1278/1290/1294` |
| | `running\|queued → interrupted`（启动清扫） | **H** ⌁ | `server/lib/db/continuation-jobs.ts:63` `markRunningInterrupted` |
| | `interrupted → running`（resume，靠 `batch_cursor`+`checkpoint_json`） | **H** ⌁ | `routes/continuation.ts:1782` |
| `chapter_completion_attempts.phase` | 5 阶段有序推进；倒退抛 `CHAPTER_COMPLETION_PHASE_REGRESSION` | **H** ⌁ | `server/lib/db/chapter-completion-attempts.ts:112-116`、`shared/lib/chapter-completion.ts:5-6,25-31` |
| `idea_fragments` | `raw → expanded` | **H** ⌁（仅前端） | `IdeaFragmentBoard.tsx:84,135,144` |

### B2 状态值存在、迁移代码未找到（dotted，**不得当作已实现环节**）

| 断言 | 级别 | 证据 |
|---|---|---|
| `chapter_production_runs` 的 `'rejected'` 无任何写入点（死字面量） | **H(负)** ⌁ | 全 `server/` grep `status: 'rejected'` 仅命中 `canon-patches.ts:444`；类型声明 `shared/types/novel.ts:214-215` |
| `SetupTaskStatus.'confirmed'` 无写入方 | **M(负)** ⌁ | `shared/types/core.ts:23` 声明；`server/`+`src/lib`+`src/stores`+`src/components` 未寻获 |
| `IdeaFragment.status.'converted'` 无写入方 | **M(负)** ⌁ | `shared/types/skills.ts:168` 声明 |
| `foreshadowings.status` `planted/hinted/payoff` 无直接赋字面量，仅派生 | **M(负)** ⌁ | `shared/types/world.ts:79`；派生点 `chapter-fact-candidates.ts:~443`、`db/ideas.ts:165` |
| `ReviewIssue.status` 7 个字面量**只在客户端置位**，无服务端路由改写 | **H(负)** ⌁ | `shared/types/novel.ts:52-53`；`useAuditPolishActions.ts:1101`、`useEditorGenerationFlow.ts:319,330`、`useChapterProductionFlow.ts:444` |
| `novels.status` 仅 CRUD 透传，无状态机代码 | **M(负)** ⌁ | `shared/types/novel.ts:17`、`db-init.ts:254` |

### B3 结构证据（存在，但无迁移断言）

| 断言 | 级别 | 证据 |
|---|---|---|
| `Scene` 类型存在但**无 `scenes` 表**、未寻获 CRUD | **U** ⌁ | `shared/types/novel.ts:279-292` vs `db-init.ts` 表清单 |
| `artifact_review_requirements` 仅观测到 `'review-required'` 一个取值 | **U** ⌁ | `creation-flows.ts:270,303`；完整枚举未定位 |
| DB 层 CHECK 约束（罕见用法）：`quality IN ('pass','needs-action','unknown')`、`phase IN (…5 值)` | **H** ⌁ | `server/lib/db-init.ts:357-377` |

---

## §C 四类候选与裁决门（candidate-store-model.dot、flow-chapter-candidate.dot）

### C1 四条路径的存储形态（关键差异）

| 内容 | 候选是否入库 | 级别 | 证据 |
|---|---|---|---|
| A 大纲 Canon | 入库 `canon_patches(status='pending')` | **H** ⌁ | `db/canon-patches.ts:196-242`、插入 `:220-237`；operations 三选一根式由 `operationValid():108-132` 校验 |
| B 设定结构化核 | 入库 `creative_artifact_candidates` | **H** ⌁ | `db/creative-artifacts.ts:545,582` |
| C 章节正文 | **不入库**，前端预览 + `baselineHash` | **H** ⌁ | `server/lib/db/chapters.ts:190-264` |
| D 连续性事实 | **不入库**，由 run 的 `continuityReport.proposedPatch` 读时派生，`status` 恒 `'pending'` | **H** ⌁ | `server/helpers/chapter-fact-candidates.ts:122,309`、`shared/types/chapter-facts.ts:33` |
| 「Canon」不是表，而是 `(novel.worldRules, active outline_artifacts)` 的指纹集 | **H** ⌁ | `db/canon-patches.ts:188-194` `getCanonFingerprint()` |

### C2 确认端点

| 内容 | 端点 | 级别 | 证据 |
|---|---|---|---|
| 大纲变更 | `POST /api/novels/:nid/canon-patches/:pid/accept` \| `/reject` | **H** ✔ | `server/routes/canon-patches.ts:155,165-173,178-207` |
| 设定核 | `POST /api/novels/:nid/artifacts/candidates/:cid/accept` \| `/reject` | **H** ⌁ | `routes/creative-artifacts.ts:164,170,181` |
| 章节正文 | RPC `acceptChapterContentCandidate`（经 `/api/db` 白名单） | **H** ⌁ | `routes/db.ts:138`、守卫 `:272-276`、schema `server/validation.ts:270` |
| 生产运行正文 | `POST /api/chapter-production-runs/:runId/apply` | **H** ⌁ | `routes/production.ts:1397-1398` |
| 生产运行事实 | `POST /api/chapter-production-runs/:runId/fact-candidate/apply` | **H** ⌁ | `routes/production.ts:1353` |
| 流程步骤 | `POST .../creation-flows/:sid/outputs/accept` | **H** ⌁ | `routes/creation-flows.ts:140` |
| 资料包 | `approve-import` 然后 `sync-to-world` | **H** ⌁ | `routes/continuation.ts:1590,2462` |
| 文风 | `POST /api/novels/:nid/writing-style/confirm` | **H** ⌁ | `routes/writing-style.ts:326` |
| 章节完成门 | `POST /api/chapters/:cid/complete`、`/complete/risk` | **H** ⌁ | `routes/chapter-completion.ts:5,29` |

### C3 落库效果与事务边界（行为证据，含测试）

| 断言 | 级别 | 证据 |
|---|---|---|
| accept 正文在**同一事务**内：归属校验 → `baselineHash` CAS → 落库边界质量门 → 旧文本入 `chapter_versions` → UPDATE 正文 | **H** ⌁ | `db/chapters.ts:206-265`（`:208-213`/`:214-215`/`:216-224`/`:237-247`/`:249-259`） |
| ↑ 由测试证明「只有**旧**文本进版本表」「stale/scope 不符时正文与版本表都零变化」 | **H** ⌁ | `tests/chapter-candidate-acceptance.test.ts:27-42`、`:44-61`、`:63-73`、`:75-87` |
| accept 大纲：`replace-outline` 会**镜像** `novels.global_outline` | **H** ⌁ | `db/canon-patches.ts:265-336`；断言 `tests/canon-patches.test.ts:18` |
| ↑ 回滚已证：2 操作补丁第 2 条失败 → 补丁仍 `pending` 且 active 卷数=0 | **H** ⌁ | `tests/canon-patches.test.ts:38-39` |
| ↑ 幂等已证：连 accept 两次 `deepEqual` 且通知数不变 | **H** ⌁ | `tests/canon-patches.test.ts:29` |
| ↑ 跨作品隔离已证 | **H** ⌁ | `tests/canon-patches.test.ts:31-32` `CANON_PATCH_CONFLICT` |
| accept 设定核：CAS 不符会**先把候选标 `stale` 再抛错** | **H** ⌁ | `server/helpers/creative-artifact-candidates.ts:162-174,214-219` |
| ↑ 写 `versions` + upsert `cores` 并钉 provenance | **H** ⌁ | 同上 `:176-190`、`db/creative-artifacts.ts:488,510,520` |
| ↑ 级联：`impactReport.reviewRequired` 每条 → `artifact_review_requirements='review-required'` | **H** ⌁ | 同上 `:196-203` → `db/creative-artifacts.ts:706` |
| **顺序门**：正文未 `applied` → 事实拒绝 `CHAPTER_FACT_MANUSCRIPT_NOT_ACCEPTED` | **H** ⌁ | `helpers/chapter-fact-candidates.ts:476-481` |
| 事实逐条 `evidenceSpan` 仍须**逐字命中当前正文**，否则 `CHAPTER_FACT_EVIDENCE_STALE` | **H** ⌁ | 同上 `:503-513` |
| 仅 `accepted` 事实写权威表；未提及者留 `pending` | **H** ⌁ | 同上 `:533-541`、`applyFact :364-443` |
| 预览是只读的 | **H** ⌁ | `tests/chapter-fact-candidates.test.ts:127` |
| 生产接受只写正文、把连续性补丁留 pending | **H** ⌁ | 同上 `:86` |
| 大纲/正文适配器各守权威存储，**从不写章节正文** | **H** ⌁ | `tests/creative-artifact-candidates.test.ts:259`（测试名即不变式） |
| 流程 accept **不写内容**，只验证「作者已在别处确认过」+ 冻结版本匹配 | **H** ⌁ | `db/creation-flows.ts:452-511`（`:457` kind 匹配、`:496-510` 版本匹配 → `CREATION_FLOW_OUTPUT_CAPABILITY_MISMATCH`） |
| 四条路径共用 `runInSerializedWriteForGeneration(generation, fn)` + `runInTransaction`，不符 → 409 `*_GENERATION_STALE` | **H** ✔ | `db-instance.ts:141-146`、`db/transaction.ts:3-5`、`routes/canon-patches.ts:165-172` |
| `acceptCanonPatch` 自带世代守卫，外层再包会死锁 FIFO | **H** ✔ | 注释 `routes/canon-patches.ts:194` |
| 仅在实际变更时 `notify()` | **H** ⌁ | `db/canon-patches.ts:419` |
| **无 undo**：`acceptCanonPatch` 无逆操作，唯一补救是再发一条 `replace-outline` | **H(负)** ⌁ | `db/canon-patches.ts:381-392` |
| **C 的版本回退已实现，但在客户端**（与上一行 A 大纲的「无 undo」是两回事，别混）：作者点「恢复此版本」→ 按 id 单条取全文 → 走既有编辑保存链路落库，并推入前端 undo 栈。README 的承诺成立 | **H** ✔ | `src/components/EditorView.tsx:692-705`（`getChapterVersion(meta.id)` → `handleRestoreVersion(fullVersion)`，注释「183：版本列表只含投影，回滚时按 id 单条取全文再走原有恢复流程」）、`src/lib/hooks/useEditorPersistence.ts:393-399`（校验 `version.chapterId === currentChapter.id` → `handleUpdateContent(content, true)`）、`:301-321`（`enqueueContentWrite` + `pushToUndoHistory`） |
| **无服务端 restore 端点，回退是「前端组装的一次普通保存」**：`DB_WHITELIST` 只有版本表的读写四个方法（`listChapterVersions` / `listChapterVersionMetas` / `getChapterVersion` / `createChapterVersion`），没有 `restore`/`revert`/`rollback` 语义；服务端只看到一次常规 `updateChapter` | **H(负)** ✔ | `server/routes/db.ts:118-240` 白名单逐条核对、`:267` `updateChapter` 的额外校验分支；`server/routes/` 全文检索无恢复路由 |
| 但这条常规保存**仍带世代守卫**：`updateChapterForEditor` 在 `databaseGeneration` 可用时随请求携带，为 `null`（世代不可用）时直接拒绝写盘 | **H** ✔ | `src/lib/hooks/useEditorPersistence.ts:89-97`（三态分支 `undefined` / `null` / 数值）、`src/lib/chapter-client.ts:24-32`（`call` vs `callForGeneration`）、`server/routes/db.ts:299-305`（有世代 → `runInSerializedWriteForGeneration`，不符 → 409 冲突） |

### C4 消毒不变式（capability-sanitize）

| 断言 | 级别 | 证据 |
|---|---|---|
| 渲染投影**只允许两条路径**，未消毒候选正文禁止直达渲染 | **H** ✔ | `docs/specs/capability-sanitize.md:16-27`、`AGENTS.md` 不变式四 |
| 路径①文风可选集：过滤条件强制 `runtimeStatus==='active' && isRuntimeReady && sanitizationStatus==='runtime-ready'` | **H** ⌁ | `src/lib/capability-governance.ts:381-437`（过滤 `:398-407`，Plan 232 标题消毒守卫 `:405-406`）；源 `RUNTIME_STYLE_CATALOG:328` |
| 路径②需解锁白名单：**只投影壳字段**（title/goal/successSignal…），强制 `runtimeStatus:'unavailable'` | **H** ⌁ | 同上 `:441-470`（预计算 `:356-365`，正文字段不出现在投影 `:465`） |
| 正文解锁必经服务端消毒端点，产出 `sanitized-` 副本落库供前端消费 | **H** ⌁ | `routes/skills.ts:259-317`（`:282-284` 拒绝非候选 `ASSET_NOT_SANITIZABLE`）；`sanitizeWhiteLabelText` 自 `shared/lib/prompt-sanitizer.js`（`:11`） |
| 服务端执行门镜像同一判据 | **H** ⌁ | `server/capabilities/manifest.ts:190-197,164-220` |
| 前端乐观追加的 `buildSanitizedSkillStub` 写 `style:''`，**不注入原文** | **H** ⌁ | `SkillsStudioView.tsx:151-174` |
| 消毒副本渲染位点 | **H** ⌁ | `skills/SkillDetailDrawer.tsx:227 → :392,460-463`，数据源为服务端已消毒的 `savedSkills` |
| 守护测试 | **H** ✔ | `docs/specs/capability-sanitize.md:39-44`；`skills-studio-plan158.test.tsx` 004、`public-catalog-freshness.test.ts`、`de-ai-tells-guard.test.ts` |
| **旁路嫌疑**：`useEditorIntelligenceContext.ts:107-119` 直接 `PUBLIC_SKILL_GOVERNANCE_CATALOG.find(id)` 拷 `asset.template`，**无 `sanitizationStatus`/`placementTier` 过滤** | **M** ⌁ | 当下生成产物含 0 条 `needs-sanitization`（167 条 `runtime-ready`），治理源含 4 条 `needs-sanitization`/2 条 `sanitize-required`。即**目前无原文外泄，但安全性依赖生成器而非调用点**；且该对象供 agent 上下文、非渲染路径 |
| 文档自陈缺口：`/sanitize` 端点无自动化 E2E；`PROMPT_GOVERNANCE_CATALOG` 与 `PUBLIC_SKILL_GOVERNANCE_CATALOG` 为**双库** | **H** ✔ | `docs/specs/capability-sanitize.md:46-53` |
| U：`/api/db` 的 `listSkills`/get 是否对 `parentSkillId` 克隆行返回未消毒 `style` | **U** ⌁ | 未追到该 RPC 路径的消毒覆盖 |

---

## §D 运行时与发布（runtime-topology.dot）

| 断言 | 级别 | 证据 |
|---|---|---|
| Express 只 bind `127.0.0.1` | **H** ✔ | `server.ts:144` |
| 打包态 Express 在 `child_process.spawn` 的**子进程**，非主进程、非 `utilityProcess` | **H** ⌁ | `electron.cjs:411-422`、`:396`（入口 `app.asar.unpacked/dist-electron/server.cjs`）、`:399,416` |
| 端口经 stdout 单行 JSON 握手；访问日志刻意走 stderr 以保持 stdout 可解析 | **H** ✔ | `server.ts:57-79,146-149`；解析 `electron.cjs:427-443`、`electron-startup-utils.cjs:5-21` |
| 加载前须过身份探活：`/api/identity` + `x-inkflow-identity`，50×200ms；不匹配返回 404 因而**不泄露任何信息** | **H** ✔ | `server.ts:105-110`、`middleware/auth.ts:55-90`、`electron.cjs:361-389` |
| 重启 pin 端口：换端口即抛「refusing unsafe renderer reload」，以保护渲染层内存中的待写队列 | **H** ⌁ | `electron.cjs:534-540` |
| 重启单飞；旧子进程未死则**拒绝起替代** | **H** ⌁ | `electron.cjs:518-522,554`、`electron-server-restart.cjs:3-14,75-93` |
| 关闭握手 `idle→awaiting-renderer→complete\|blocked`(5s)，`attemptId` 校验丢弃迟到回复；blocked → 四按钮恢复对话框 | **H** ⌁ | `electron-close-handshake.cjs:7,25-54`、`electron.cjs:313-321,621-663,721-730,812-822` |
| `nodeIntegration:false` / `contextIsolation:true` / `sandbox:true` / `webSecurity:true` | **H** ⌁ | `electron.cjs:710-716` |
| preload 桥固定 8 方法，无 `require`/`fs`/通用 IPC 透传 | **H** ⌁ | `electron-preload.cjs:3-16` |
| 每个 IPC handler 过 `rejectUntrustedIpc`（身份已验 + sender===mainWindow.webContents + frame origin 相符且无内嵌凭据） | **H** ⌁ | `electron.cjs:287-297`、`electron-security.cjs:8-16,23,32-38` |
| CSP 由 **Express 侧 helmet** 提供而非 Electron header；生产才启用，dev 关闭 | **H** ✔ | `server.ts:25-43` |
| Bearer 令牌 64hex、`~/.inkflow/.auth-token` 0600、`timingSafeEqual` 比对 | **H** ✔ | `middleware/auth.ts:7-8,13-46,139-151` |
| SSE 因 EventSource 不能带 header，改用进程内铸造的短期 token（TTL 5min、上限 64、仅 `/db/events` 路径生效） | **H** ✔ | `middleware/auth.ts:9-11,98-137`、`src/lib/db-transport.ts:179` |
| dev 令牌端点三重门：`NODE_ENV!=='production'` && `INKFLOW_ENABLE_DEV_AUTH_TOKEN==='true'` && loopback，否则 404 | **H** ✔ | `server.ts:89-100` |
| API Key：打包态**从不写进 config.json**；`safeStorage → secure-key.bin` 0600，只经 env 注入子进程 | **H** ⌁ | `electron.cjs:858-886`、`server/lib/config.ts:192-210,206-245` |
| config.json 内密钥 AES-256-GCM，派生自 `hostname:username:inkflow-v1`，前缀 `enc:` | **H** ⌁ | `server/lib/config.ts:27-54` |
| `data.db` 三态同路径 `~/.inkflow/data.db`，`INKFLOW_DB_PATH` 可覆盖，**永不进 bundle** | **H** ⌁ | `server/lib/db-init.ts:152-156`；Electron userData 仅存 `startup.log`/`window-state.json`（`electron.cjs:151,180`） |
| WAL + `foreign_keys=ON` + `busy_timeout=5000` + 启动 `optimize`；文件权限修复为 0600 | **H** ⌁ | `db-init.ts:219-240,124-148,172-217` |
| 启动快照：`db.backup()` → 只读连接验 `application_id`(0x494e4b46)+必需表/索引 → 0600 → 原子改名 `.bak` | **H** ⌁ | `db-init.ts:85-117,57-83,802-805` |
| 导出：`db.backup()` 生成 `.temp-export` → `res.download` → 回调中 unlink；单例未初始化时**返回 404 而非裸传文件** | **H** ⌁ | `routes/db.ts:383-406` |
| 导入：`wx` flag 0600 落临时 → 表/索引/FK 白名单校验 → 串行写内 `advanceDatabaseGeneration()` 作废在途写入 → `wal_checkpoint(TRUNCATE)` + 备份旧库 → 换文件 → 重初始化 → 清嵌入缓存 → 保留 5 份导入备份 | **H** ⌁ | `server/lib/db-import.ts:1083-1157`、`:291,323,473,638`、`db-instance.ts:118-128` |
| 无版本化迁移系统：幂等 `CREATE TABLE IF NOT EXISTS` + `ensureColumn()` ALTER + `CREATE INDEX IF NOT EXISTS`；确认无 `user_version`/`schema_version` | **H** ⌁ | `db-init.ts:253-669,159-165,672-708,713-754` |
| 28 张表 | **H** ✔ | 本次 grep `CREATE TABLE IF NOT EXISTS` 枚举 |
| 本地推理：`Xenova/bge-small-zh-v1.5`，`dtype:'q8'`，512 维；模型 id 冻结因 `vector_chunks` 按它匹配 | **H** ⌁ | `server/embedding.ts:1-9,121-128,178` |
| 嵌入降级链：本地 pipeline → LLM 嵌入 → 无 Key 抛 `EmbeddingUnavailableError`（不伪造） | **H** ⌁ | `embedding.ts:165-217,184-190` |
| 向量检索为**按 novel 全表线性余弦扫描**；≥1000 块时记日志为将来 sqlite-vec 决策供数 | **H** ⌁ | `server/vector-store.ts:100-148,116` |
| LLM Provider 由 `config.baseUrl` 探测：google / deepseek / minimax / openai-compatible；Google 走 `@google/genai` SDK，其余裸 `fetch` | **H** ⌁ | `server/lib/server-llm.ts:13,151-190,769-788,965-975` |
| `ProviderError` 11 类码 + `retriable` + 参数兼容降级（`omit_thinking`/`plain_fallback`），3 次尝试、75s 超时 | **H** ⌁ | `server-llm.ts:14,30,58-124,148-149,490-545` |
| 生成前提示门 → 生成 → 输出门 → 自我纠错重试 1 次 → 仍失败则抛 `quality_rejected`（**不返回低质草稿**） | **H** ⌁ | `server-llm.ts:635-725` |
| CI 单闸：`check`（typecheck/lint/prettier/`npm audit` 零豁免/后端覆盖 90-80-85/前端覆盖/生产构建 E2E/runtime-smoke）→ mac·win·linux `needs:[check]`，各自 `smoke:packaged-editor` 打真二进制 | **H** ⌁ | `.github/workflows/build.yml:10-13,25-61,71,73,81-86,103-123,147-152,203-210,283-293` |
| **仅 `upload-artifact`，无 GitHub Release 发布步骤** | **H(负)** ⌁ | `build.yml` |
| 提交门：`pre-commit.sh` 先对**暂存** ts 跑 ESLint `--max-warnings=0`，再全量 `tsc --noEmit`；经 `node` 直调本地二进制，防全局 npm 损坏使门失效 | **H** ⌁ | `scripts/pre-commit.sh:6-25`、`package.json:34` |
| better-sqlite3 需要 shim：`.node` 无法从 asar 内 dlopen，且单文件 bundle 破坏 `bindings` 相对解析 | **H** ⌁ | `server/lib/better-sqlite3-shim.cjs:4-10`、`db-init.ts:33-37,47,231`、`package.json:185-189`、CI 断言 `build.yml:232-235` |
| **U**：打包态模型权重 cacheDir 落点。仓库未设 `env.cacheDir`；transformers 默认落 `dirname/__dirname/.cache/`，而它被**打进** `server.cjs`，故推断落在 bundle 的 unpacked 树；若 `.app` 卷只读或被 Gatekeeper 管控，首启下载可能失败。**从未在运行时度量** | **U** ⌁ | `server/embedding.ts:30-33`（仅 test 关远程）、`node_modules/@huggingface/transformers/src/env.js:94-97,153` |
| **U**：`/api/audit` 与 world 作业存于**进程内 `Map`**，重启即失，与已落库的 continuation 作业不同；是否有意为之未证 | **U** ⌁ | `server/routes/world.ts:509` |

---

## §E 领域词汇与文档权威性

| 断言 | 级别 | 证据 |
|---|---|---|
| README 是当前定位的唯一权威；`PRD.md` 自标「历史愿景（非当前交付承诺）」，`PRD_V2.md` 自标「历史架构草案」 | **H** ✔ | `README.md:19`、`PRD.md:1`、`PRD_V2.md:1` |
| PRD 的 Agent Souls 与 Cortex 上下文矩阵**无代码对应物** | **M(负)** ⌁ | `PRD.md:56`、`PRD_V2.md:14` 对比 `shared/`、`server/` 符号 |
| `DESIGN.md` 纯视觉设计系统（色/字/布局/动效/无障碍），无领域内容 | **H** ⌁ | `DESIGN.md` |
| 能力清单（逐字，验证日 2026-09-15）：本地作品/设定/章节编辑；受治理的设定/大纲/正文候选（消毒候选以副本单源供给，原貌不直达渲染）；SQLite/WAL 原生 `backup()` 一致性快照；AI 失败恢复与本地降级写作；全失败场景模型草稿以待改进预览交付；Beta 默认开放增强能力 | **H** ✔ | `README.md:25` |
| 当前限制：AI 依赖外部 Key 与网络；**无真实支付/订单/订阅系统** | **H** ✔ | `README.md:25` |
| 商业化双闸：`INKFLOW_ENABLE_MONETIZATION`（服务端，非 test 环境须显式 true）与 `VITE_INKFLOW_ENABLE_MONETIZATION`（前端，须字面 `'true'`，默认全免费） | **H** ⌁ | `server/helpers/quota-guard.ts:99-104`、`src/lib/entitlements.ts:22-36` |
| 「拆书」不是领域实体，只是能力流 id `'book-deconstruction-flow'`（2 步）；步骤进度以标签串 `completed-step:<flow>:<step>` 存进 `novels.projectPreferenceProfile.tags`，**不入 `creation_flow_sessions`** | **H** ⌁ | `shared/lib/prompt-governance-catalog.ts:479,485,497`、`tests/book-deconstruction-flow.test.ts:18-23,126-191` |
| README 描述开书向导为 **4 步**（题材→平台→篇幅→风格），代码实为 **3 个手风琴步**（末步合并篇幅+风格） | **M** ⌁ | `README.md:147` vs `src/components/WelcomeView.tsx:638,649,663,819,922` |
| 能力 6 种 kind + 2 种 legacy | **H** ⌁ | `shared/types/capability-manifest.ts:5-13` |
| 3 个手写内建 manifest（`text-diagnostics`、`text-normalize-preview` 标 `sideEffect:'preview-only'`、`default-guardrail`），与目录、运行时叠加三源合并 | **H** ⌁ | `server/capabilities/manifest.ts:21-64,66-84,90-109` |
| 「货架投影面」= 客户端读模型，决定哪些受治理资产渲染为可用 | **H** ⌁ | `src/lib/capability-governance.ts:205,229,381,441,475,484,488`；消费 `skills/StyleShelf.tsx:131`、`PlazaAssetCard.tsx:61,65,78,82,280-285` |
| `product_events` 有 60 个精确事件名（含 `draft_accept`、`capability_artifact_accept`、`first_chapter_accepted`、`continuation_confirm`、`writing_style_confirmed`） | **H** ⌁ | `shared/types/product-events.ts:1-63`、`db-init.ts:656-668` |
| 防「人设崩塌」**没有自动阻断门**；实为三件套：stale 检测 CAS、review-required 级联、建议式审计报告；作者可显式接受风险（`accepted-risk`） | **H** ⌁ | `shared/lib/story-memory-projection.ts:66`、`helpers/chapter-fact-candidates.ts:496`、`shared/types/novel.ts:54-55`、`shared/lib/chapter-completion.ts:97,109` |
| `CharacterCore.immutableFacts` 是反漂移契约的结构支点 | **H** ⌁ | `shared/types/creative-artifacts.ts:43-59`（`:58`） |
| 故事记忆是**纯投影，无表** | **H** ⌁ | `shared/types/story-memory.ts:32-49`；`db-init.ts` 无 `story_memory*` |
| 唯一持久化的图边表是 `entity_relationships` | **H** ⌁ | `db-init.ts:643` |
| cockpit→editor 的 `launchState` 静默首发执行 | **H** ⌁ | `docs/specs/cockpit-routing.md:8-13`；`shared/types/continuation.ts:4-26`；生产方 `AppShell.tsx:481-559`；消费方 `EditorView.tsx:2008-2082`（`:2050-2053` 审计、`:2054-2063` 精修）；令牌自消费 `:2074-2076` |
| 每次导航前先 `flushBeforeNavigation()`，落盘失败则**中止导航** | **H** ⌁ | `AppShell.tsx:451-460` |
| LLM 三态诚实：`'connected'\|'missing'\|'unknown'`，异常一律 `'unknown'`，琥珀渲染，禁止内部状态名直出 | **H** ⌁ | `src/lib/llm-availability.ts:1-25`、`docs/specs/llm-status-honesty.md:9-16`；服务端镜像 `'connected'\|'unknown'\|'disconnected'` 默认 `'unknown'`（`config.ts:295-303`） |
| 请求超时默认 120s，continuation parse 例外 200s | **H** ⌁ | `server/lib/request-timeout.ts:5-10` |
| 日志脱敏字段集（content/bio/summary/text…）+ >200 字符截断 | **H** ⌁ | `server/logger.ts:7-55` |

---

## §F 未知与待验证（按优先级）

| # | 问题 | 为何要紧 | 最小验证动作 |
|---|---|---|---|
| F1 | ~~回退能力是否存在~~ **已解决**：回退在客户端组装（见 §C3），README 承诺成立。残留问题：**回退不给「被覆盖的当前文本」留版本快照** —— 常规 `updateChapter` 不写 `chapter_versions`，快照只在 `handleSaveVersion` 与 accept 候选路径产生，会话外只能靠版本表往返 | 影响「连续试几个版本」这一操作的丢文风险判断 | 确认是否为有意取舍；若否，回退前补一次 `createChapterVersion` |
| F2 | 打包态嵌入模型权重 cacheDir 实际落点 | 若落在 `.app` 卷内且卷只读，**首启语义检索可能整体失败** | 在打包二进制内跑一次 embedding 并打印 transformers `env.cacheDir`；或加集成断言 |
| F3 | `useEditorIntelligenceContext.ts:107-119` 无消毒过滤地读目录 `template` | 安全属性当前依赖生成器而非调用点 | 该处补 `sanitizationStatus` 过滤，并加断言测试 |
| F4 | `/api/audit`·world 作业存进程内 `Map`，重启即失 | 与 continuation 作业 durability 不一致，可能是长任务丢进度源 | 确认是否有意；否则迁表或加恢复路径 |
| F5 | `legacy-artifact-structuring/confirm`、`capability-migration/apply\|confirm` 是否构成第五/六类裁决门 | 影响「候选→确认」路径清单的完备性 | 读三个 handler，判定其是否写权威存储 |
| F6 | `/api/db` 的 get/list 是否对克隆行返回未消毒 `style` | 白标泄露的残留面 | 定向追一次 `listSkills` 的消毒覆盖 |
| F7 | `Scene` 类型无表无 CRUD | 判断是否为可清理的死模型 | 全仓引用检索后定性 |
| F8 | `chapter_production_runs` 的 `'rejected'` 死字面量；`'converted'`/`'confirmed'` 无写入方 | 读代码者易把它们当既有业务环节 | 要么接线，要么删除并在类型注释说明 |
| F9 | `vector_chunks` 无 FK、按 novel 全表线性扫描 | 章节规模增长后的检索延迟天花板 | 已有 ≥1000 块日志埋点（`vector-store.ts:116`），取真实分布再决策 |

---

## 取证方法

四路定向只读勘察（后端 / 前端 / 领域与业务流程 / 运行时与发布）并行，各自返回带 file:line 的事实报告；
主控另就**分层矩阵、`/api/db` 白名单、表清单、canon-patch 裁决路由、世代守卫、SSE 与 auth 中间件、
版本回退链路、五份 `docs/specs/*` 不变式**亲自读源复核（标 ✔）。
其中「版本回退」最初由子 Agent 报为「未寻获端点、疑似文档超前于实现」，主控读 `EditorView.tsx` 与
`useEditorPersistence.ts` 后**推翻该结论**：能力存在，只是实现在客户端。此为 ⌁ 级证据不可直接采信的一个实例。

未做任何写入式验证：`typecheck`、`npm test`、E2E 均未运行，因此**「测试通过」不在本次断言范围内**。
