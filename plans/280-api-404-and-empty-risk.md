# Plan 280：未注册 API 路径 404 · 空风险确认不再降级

- Status：✅ 已完成（2026-10-04）——代码 + 测试 + 门禁 + 真机（dev）取证 + vite build 全绿
- 前置：`plans/279-residual-closeout.md`（其残余清单里登记的两条产品面观察）
- 触发：User said (m25847)「下一步 你按推荐来」

## 1. 问题

1. **dev 未注册 /api 路径返回 500**：真机（隔离 3302，dev + vite middleware）实测 `GET /api/nope`、`POST /api/nope`、`GET /api/novels` 均 500，服务器日志是 `[vite] http proxy error: /api/nope` + `AggregateError [ECONNREFUSED]`。根因：vite.config.ts 的 server.proxy 把 /api 写死指向 http://localhost:3000；Express 没匹配到的路径会落到 vite 中间件，被代理到 3000 端口（该端口没有服务）→ ECONNREFUSED → 500。生产态同一条路径则落到 SPA fallback，返回 200 + index.html，同样掩盖路由错误；若 3000 端口恰好跑着另一个 InkFlow 实例，请求会被**静默转发给另一个实例与另一份数据库**。
2. **空风险确认把 pass/ready 改写成 unknown/accepted-risk**：`shared/lib/chapter-completion.ts` 的 `acceptChapterRisk` 纯函数固定返回 `quality: unknown` / `completionGate: accepted-risk`，服务器 helper `server/helpers/chapter-completion.ts:426 acceptChapterRisk` 无条件采用它，并写回 `state.completionResult` 与 `chapter.workflowMeta.completionGate`。UI 侧（`src/components/EditorView.tsx:1397`）提交的是 `completionResult.gate.deterministicIssues` / `unknownChecks` —— 干净章节两者都是空数组 ⇒ 一次「没有东西可担责」的调用就把 `pass/ready` 降级成 `unknown/accepted-risk`。

## 2. 修复

### 2.1 去掉 dev 代理（`vite.config.ts`）
- 删除 `server.proxy`（middlewareMode 下 Vite 跑在 Express 内部，代理无意义），只保留 `hmr`。

### 2.2 未匹配的 API 路径显式 404（`server.ts`）
- 在 `registerChapterCompletionRoutes(app);` 之后、vite/static 中间件之前插入 `app.use('/api', …)`：返回 404 `{"code":"API_ROUTE_NOT_FOUND","error":"未找到该接口"}`（落在 `authMiddleware` 之后 → 未鉴权的未知路径仍是 401，不泄露路由表）。

### 2.3 空风险确认是 no-op（`server/helpers/chapter-completion.ts`）
- 在取到 attempt 后插入守卫 `nothingToWaive = unresolvedIssueIds.length === 0 && unknownChecks.length === 0`；命中且已有 `completionResult` 时直接 `return { ...state.completionResult, riskAccepted: false }` —— 不写库、不改 `workflowMeta`、不降级结论（`riskAccepted: false` 与真接受风险区分开）。有真实条目时语义完全不变。

## 3. 验证

- 门禁：`tsc --noEmit` 0、`eslint server src shared tests scripts --max-warnings=0` 0、定向 2 文件 **20/20**（新增 `unmatched api paths answer 404 instead of reaching the dev proxy`、`an empty risk confirmation keeps the derived ready gate`）、后端全量 **1547/1547**（36 suites，219.8 s）。
- 真机（修复后，隔离 3302 dev 实例）：`GET /api/nope` / `POST /api/nope` / `GET /api/config/nope` 全部 **404** `API_ROUTE_NOT_FOUND`；无 token → 401；真实路由不受影响（`/api/db/generation` 200、`/api/config` 200、`/api/product-events/metrics` 200）；服务器日志不再出现 `[vite] http proxy error`；`GET /` 仍 200 返回 index.html（1346 B，vite 中间件未被影响）。
- `vite build` EXIT=0（15.60 s）——证明配置文件仍合法。

## 4. 残余（登记）

- R-280-1：空风险确认是静默 no-op（不写日志，只能从 `riskAccepted: false` 区分）。
- R-280-2：风险端点的 HTTP 级真机复现未做（单测直接覆盖服务器 helper；路由只是转递参数）。
- R-280-3：/api 404 落在 `authMiddleware` 之后 → 未鉴权请求未知路径仍返回 401（有意，不泄露路由表）。
- 沿用：R-279-1..4、R-278-2 / R-278-4。

## 5. 证据与复现

- 脚本：`/tmp/p280-recon.py`（修前取证）、`/tmp/p280-recon2.py`（修后取证，均用 sqlite backup 拷贝生产库到 `/tmp/p280/data.db` + 隔离 config）、`/tmp/p280-gates.sh`、`/tmp/p280-final.sh`、补丁 `/tmp/p280-patch.py`。
- 日志：`/tmp/p280-server.log`（修前：vite proxy 500）、`/tmp/p280-server2.log`（修后：404 且无 proxy 行）、`/tmp/p280-recon.log` / `/tmp/p280-recon2.log`、`/tmp/p280-tests.log`、`/tmp/p280-be.log`、`/tmp/p280-build.log`。
- 复现：`python3 /tmp/p280-recon2.py`（自建副本、起 3302、探测 8 条路径）。
