# Plan 271 — 产品读数与首章漏斗（PM 诊断落地）

Status: ✅ 已完成（2026-10-01；W1/W2/W3 + 全量门禁）

来源：PM 视角诊断（m21272 / 答复 m21301）→ 用户 m21302「好的，开始执行。上游这个事，目前是本机用。其他人用可以配置别的大模型，暂不考虑。」

## 非目标

- 不做上游 provider 分发 / 多人可安装（用户明确排除）。
- 不新增知识图谱与能力卡功能（PM 诊断第 3 条：冻结待证据）。

## 工作线

### W1 裁决行为埋点（补上产品最缺的读数）
现状：`draft_accept` 已存在，但**没有拒绝/放弃/裁决耗时**，无法回答「作者是否在裁决、裁决多久」。
- 事件注册表新增：`draft_reject`、`draft_abandon`、`writing_style_defaulted`（`shared/types/product-events.ts`）。
- 记录点：
  - `draft_accept` 增 `durationMs`（候选创建→接受）与 `action`：新草稿=`draft`，改写/润色候选=`polish|rewrite`（后者计入 reviseAccepts）。
  - `draft_reject`：`useEditorGenerationFlow.ts` 的 `discardAiContentCandidate`（`action:'discard'`）。
  - `draft_abandon`：`useChapterProductionFlow.ts` 的 `stopProductionFlow`（运行中取消，`action:'stop-run'`）。
- 指标块：`ProductEventMetrics.decisions`（previews/accepts/reviseAccepts/rejects/abandonments/decided + 三个 rate + decisionLatencyMs p50/p95），在纯函数 `buildProductEventMetrics` 内计算，API 与离线脚本共用。
- 验收：`tests/product-event-decisions.test.ts` 用事件数组复算全部字段；`tsc`/`eslint` 绿。

### W2 cockpit 三读数（DB 真值，不只靠埋点）
现状：`GET /api/product-events/metrics` 只有事件口径，没有「章节是否真的完成/交付稿是不是模型稿/run 有没有被采用」的真值。
- 新模块 `server/lib/db/product-truth.ts`：`getProductTruthMetrics({ novelId?, days? })`，三块读数：
  1. `firstChapter`：有章节的作品数 vs 有 `chapters.workflow_meta.completionGate === 'ready'` 的章节的作品数 → `rate`（首章完成率）。
  2. `delivery`：`chapter_production_run_versions` 按 `source` 统计（model/fallback 版本数、model 占比、有 model 版本行的 run 占比）。
  3. `decision`：`chapter_production_runs.status` 的 `applied` / 完成态（applied+review_required+failed）→ 采纳率；耗时用 run 的 `created_at→updated_at` 中位数。
- 路由：`GET /api/product-truth/metrics?days=&novelId=`（落在 `server/routes/product-events.ts`，返回 `{ global, novel? }`）。
- UI：`src/lib/product-truth-client.ts` + `src/components/ProductTruthPanel.tsx`，挂在 `ProjectCockpitView`（作品页），三项各显示分子/分母与口径注。
- 验收：`tests/product-truth-metrics.test.ts`（种子库断言三块读数）+ `src/tests/product-truth-panel.test.tsx`（渲染三读数）。

### W3 写法确认默认化（首章漏斗的第一道墙）
现状：`writing_style_required` 313 次 vs `writing_style_confirmed` 15 次；生成请求缺指纹即 409 `STYLE_CONFIRMATION_REQUIRED`。
- `src/lib/writing-style-client.ts` 新增 `ensureWritingStyleConfirmed(novelId, ctx)`：resolve → 若 `resolution.confirmed === false` 则以同一上下文 confirm（等同用户点「确认推荐写法」）→ 返回指纹；经 `claimProductEventOnce` 记一次 `writing_style_defaulted`。
- 接线：`src/lib/production-client.ts`（`startChapterProductionRun` / `startChapterProductionRunStream`，缺指纹时先 ensure 再请求，409 再抛旧错）+ `useDraftGeneration.ts`（`/api/orchestrate-draft` 前 ensure）。
- 保留旧行为：ensure 失败或 confirm 后仍 409 → 抛 `ProductionStyleConfirmationRequiredError` / 走 `onStyleConfirmationRequired` 面板。
- 验收：`src/tests/writing-style-default.test.ts`（409 场景：首次生成自动 confirm 并成功；confirm 失败仍抛错且不吞错）。

## 证据与复现

- PM 诊断读数：本机生产库快照 `/tmp/pm-census/data.db`（截至 2026-09-22）；run 88% `review_required`、版本行 68% fallback、`editor_enter 370 → first_content_input 1`、`writing_style_required 313 vs confirmed 15`。
- 真机验证：隔离实例（3301/3302，库副本 `/tmp/inkflow-writetest/data.db`、`INKFLOW_CONFIG_DIR` 隔离），不上生产库。

## 执行结果（2026-10-01）

### W1 裁决行为埋点 —— 已落地

- 事件注册表新增 `draft_reject` / `draft_abandon` / `writing_style_defaulted`；`ProductEventMetrics` 新增 `decisions: DecisionMetrics`（previews/accepts/reviseAccepts/rejects/abandonments/decided + acceptanceRate/rejectionRate/abandonmentRate + decisionLatencyMs p50/p95）。
- 口径：只统计「先预览过」的对象（`scoped()` 交 `previewIds`），与 `rates.previewAcceptance` 同口径；`reviseAccepts` = action ∈ {polish,rewrite} 的 `draft_accept`。
- 记录点：`src/lib/hooks/useEditorGenerationFlow.ts`（接受记 `durationMs = now - candidate.createdAt`；`discardAiContentCandidate` 记 `draft_reject` / `action:'discard'`）、`src/lib/hooks/useChapterProductionFlow.ts`（`stopProductionFlow` 记 `draft_abandon` / `action:'stop-run'` / `objectId: run.id`）。
- 测试：`tests/product-event-decisions.test.ts` 3 例（预览范围裁决拆分 / null 场景 / 注册表），与 `tests/activation-funnel-report.test.ts` 同跑 **7/7 通过**。

### W2 cockpit 三读数 —— 已落地

- `shared/types/product-truth.ts`（`ProductTruthMetrics` / `ProductTruthSnapshot`）+ `server/lib/db/product-truth.ts`（`getProductTruthMetrics({novelId?, days?})`）：`firstChapter`（有章节的作品 vs 有 `workflow_meta.completionGate='ready'` 章节的作品）、`delivery`（`chapter_production_run_versions.source` model/fallback 占比）、`decision`（`chapter_production_runs.status` 采纳率 + created→updated 中位数）。
- `GET /api/product-truth/metrics?days=&novelId=`（`server/routes/product-events.ts`，返回 `{global, novel}`）+ `src/lib/product-truth-client.ts` + `src/components/ProductTruthPanel.tsx`（四行读数、两列「本书｜全局」、缺数显示「未知」），挂在 `src/components/ProjectCockpitView.tsx`。
- 测试：`tests/product-truth-metrics.test.ts` 3/3、`src/tests/product-truth-panel.test.tsx` 3/3、`src/tests/cockpit-memory-health-mount.test.tsx` 2/2（新面板使全局「未知」从 5 变 13，已改为 `within(panel)` 作用域断言）。

### W3 写法确认默认化 —— 已落地

- `src/lib/writing-style-client.ts` 新增 `ensureWritingStyleConfirmed(novelId, payload)`：resolve → 若 `resolution.confirmed === false` 则同上下文 confirm → 返回指纹；自动确认经 `claimProductEventOnce` 每章只记一次 `writing_style_defaulted`。
- 接线：`src/lib/production-client.ts`（`ensureStyleFingerprint` 帮手，`startChapterProductionRun` / `startChapterProductionRunStream` 均在缺指纹时先 ensure；confirm 仍 409 则转 `ProductionStyleConfirmationRequiredError`，其余失败退回无指纹旧路径）+ `src/lib/hooks/generation/useDraftGeneration.ts`（`/api/orchestrate-draft` 前 ensure）。
- 测试：`src/tests/writing-style-default.test.ts` **5/5**（自动确认并记事件 / 已确认不重复 confirm / confirm 409 仍抛错 / production-client 携默认指纹 / 解析不可用时退回确认面板）。

### 真机门级取证（隔离实例 3301，库副本 `/tmp/inkflow-writetest/data.db`）

- 未确认态：`writing-style/resolve` → `confirmed=false` → `confirm` → `confirmed=true`（指纹一致，重复 resolve 仍 true）→ 带该指纹 `start-stream` **200**（SSE `run_created` / `status` / `fallback_beats`）。
- 负对照：指纹改为 `deadbeef×32` 或缺失 → **409 `STYLE_CONFIRMATION_REQUIRED`**（不变量未被削弱）。
- 稳态（已确认）：resolve 直接 `confirmed=true`（不重复 confirm）；驱动整链跑到 `done`（run `a1d581de-b0ad-4afc-921a-5ebccf824ed0`，`review_required`，交付 4183 字）。
- 上游阻塞（非 W3 问题）：本机代理客户端不可用 → 8317 全模型返 500（`proxyconnect tcp: dial tcp 127.0.0.1:7897: connect: connection refused`），planner/writer/critic 均 `ProviderError service_unavailable`；故本轮无「模型稿」真机读数（模型稿链路由 Plan 269/270 历史读数覆盖）。

### 门禁

- `tsc --noEmit` 0；`eslint server src shared tests scripts --max-warnings=0` 0（首轮 1 error：`src/lib/hooks/useChapterProductionFlow.ts:144` `react-hooks/exhaustive-deps` 缺 `novelId` → 已补入依赖数组）。
- 后端全量：**1506 通过 / 0 失败**（68 秒）；前端全量：**164 files / 1038 tests 全绿**（283.98 s）。
- 初跑暴露两例旧断言对「缺指纹时先向写法 resolver 发一次 resolve 请求」敏感：`tests/production-client.test.ts` 与 `src/tests/editor-wiring-contract.test.tsx` 或数 fetch 分别从 1 变 2；已改为按 URL 区分拦截，并断言写作请求的 styleConfirmationFingerprint 真的是 fp-auto。

## 残余（登记）

- R-271-1：`reviseAccepts` 口径 = 接受 polish/rewrite 候选；「接受后再编辑的编辑量」仍需正文 diff 埋点。
- R-271-2：候选预览被「切章/关页」丢弃时还没有 `draft_abandon`（当前只覆盖显式 discard 与 run 取消）。
- R-271-3：首章 60 秒出稿只做了「去掉确认墙」，planner→writer 的耗时仍是既有链路读数（`generationLatencyMs`）。
