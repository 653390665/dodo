# Plan 285：模型 × 思考档位写作效果矩阵（Gemini 3.8 / 3.7 / 3.6 flash × low/high）

Status：✅ 已完成（2026-10-06；18 跑真机矩阵，隔离实例，未改动生产库）

前置：Plan 283/284 已落地 run 墙钟预算与兜底交付；本轮回到主线第四项（模型最优配置）。

## 1 触发

User said (m27712)：「检查上游，测试Gemini3。8和3.7以及3.6flash不同思考程度，的写作效果」。

### 1.1 上游先失效（已修）

- 现象：8317 `/v1/models` 返回 200（25 模型），但任意模型 `POST /v1/chat/completions` 都是 **503 `auth_unavailable: no auth available (providers=antigravity … Post "https://oauth2.googleapis.com/token")`**。
- 根因：`~/.cli-proxy-api/logs/main.log` 显示 antigravity 的 OAuth auto-refresh 自 08:34 起每 ~90 分钟失败一次，报 `dial tcp 127.0.0.1:7897: connect: connection refused` —— CLIProxyAPI 出网要经本机代理客户端（7897），该客户端此前挂过；**与账号额度无关**。
- 修复动作：`brew services restart cliproxyapi`（launchd 服务名 `homebrew.mxcl.cliproxyapi`）→ 日志出现 `refreshed antigravity, antigravity-skateboardingshoes.1207@gmail.com.json, <nil>` → 探针 gemini-3.8 / 3.7 / 3.6 flash 全部 200（4045 / 2736 / 1685 ms，均回「可用」）。
- 教训：8317 的 `/v1/models` 健康不代表上游可用；OAuth 失效时它仍返回模型列表，只有真实调用才 503。判断上游要打一次 `chat/completions`。

## 2 方法

- harness `/tmp/p285-write-matrix.py`（由 Plan 270 的 `/tmp/p278-pro-matrix.py` 派生）：`CELLS = 38-low / 38-high / 37-low / 37-high / 36-low / 36-high`（模型 `gemini-3.8-flash-high`、`gemini-3.7-flash-high`、`gemini-3.6-flash-high`），`REPS = 3`。
- 每格：kill 端口 → 用生产库 `~/.inkflow/data.db` 的 sqlite backup 重播隔离库 `/tmp/inkflow-writetest/data.db` → 起隔离实例（`INKFLOW_CONFIG_DIR=/tmp/inkflow-writetest/inkflow-config`、`INKFLOW_ENABLE_DEV_AUTH_TOKEN=true`、`INKFLOW_REASONING_EFFORT=<low|high>`、`PORT=3301`）→ `POST /api/config {apiKey: /tmp/cliproxy.key, baseUrl: http://127.0.0.1:8317/v1, model}`。
- 每次跑（rep）走真实链路：`GET /api/dev-auth-token` → `GET /api/db/generation` → `POST /api/novels/:id/writing-style/resolve` → `confirm` → `POST /api/chapter-production-runs/start-stream`（SSE 逐事件采集）。作品 `d23eef68-ae47-4ca5-9e5d-cf6ab23bb1df`、章节 `99b28a6e-0404-4197-ad63-e43d0be69b37`、同一 userIntent。
- 评分来自链路自带的 critic 五维（可读性 / 分镜执行度 / 冲突推进度 / 风格契合度 / 网文章节感，各 0–10，`totalScore` ×2 = 界面 100 分制）；另对 18 篇交付稿做普查（套话率、档案泄漏、重复段落、人物接地）。

## 3 读数（n=3/格，均值）

| 模型 | 档位 | 耗时 | critic 总分 | 过评审 | 交付字数 | 首字延迟 | 套话/千字 |
|---|---|---|---|---|---|---|---|
| gemini-3.7-flash-high | low | **61.1 s** | **45.3/50（90.7）** | **3/3** | 5116 | 15.2 s | 0.9 |
| gemini-3.7-flash-high | high | 111.1 s | 45.0/50（90.0） | 3/3 | 4796 | 30.3 s | 0.8 |
| gemini-3.6-flash-high | high | 195.7 s | 43.7/50（87.3） | 3/3 | 5484 | 48.2 s | 1.1 |
| gemini-3.8-flash-high | low | 178.8 s | 42.0/50（84.0） | 3/3 | 5997 | 25.5 s | 0.9 |
| gemini-3.6-flash-high | low | 352.8 s | 30.5/50（61.0） | **0/3** | 5066 | 36.4 s | **1.7** |
| gemini-3.8-flash-high | high | **902.3 s（撞 900 s 预算）** | 29.3/50（58.7） | **0/3** | 6899 | 99.5 s | 0.9 |

五维明细（可读性 / 分镜 / 冲突 / 风格 / 网文感）：3.7-low 9.0/9.33/9.0/9.0/9.0；3.7-high 9.0/9.33/8.67/9.0/9.0；36-high 8.67/9.0/8.67/9.0/8.33；38-low 8.0/9.0/8.0/8.67/8.33；36-low 6.0/5.5/6.0/8.0/5.0；38-high 6.33/5.67/6.0/6.0/5.33。

单跑明细（分数 / 耗时 / 字数）：38-low 86·126.3·6735、84·285.1·5256、82·124.9·5999；38-high 56·901.8·4836、54·902.0·4532、66·903.0·11329；37-low 90·52.6·4602、90·61.3·5847、92·69.3·4900；37-high 88·103.3·4279、92·129.3·5002、90·100.6·5107；36-low 62·428.5·4850、未定分·309.6·4928、60·320.4·5421；36-high 84·177.3·4511、90·215.4·5416、88·194.3·6525。

## 4 机制（门禁 / 库级取证）

- **3.8 + high 不可用**：三跑都跑满 3 次重写后撞 900 s run 预算，`budget_exhausted_at='writer-error'`，交付的是被 `trimDanglingTail` 裁过的兜底稿（54/56/66 分）；首字延迟 77–117 s。门禁首稿命中 `literary-slop`。
- **3.6 低档最差**：首稿命中「重复段落（短转场句）+ Markdown 残留 + 套话」，三次整章重写仍不过门 → 0/3、耗时反而最长（310–429 s）。同模型换 high 后首稿只是篇幅不足（`chapter-below-contract`），走长度续写一次过门（177–215 s，84/90/88）。即「多思考」在 3.6 上同时降耗时、提分。
- **3.7 两档都一次过门**：low 与 high 分差 <1 分，耗时差 1.8 倍（61 s vs 111 s）；仅 37-low rep2 因篇幅不足触发过一次续写。
- **AI 味**：18 篇交付稿的档案泄漏（关键人物/设定档案/分镜字段）**全部为 0**；套话率最低 0.8/千字（37-high）、最高 1.7/千字（36-low，且重复段落均值 2.0 处）；人物接地 2.7–4.0 个/跑。

## 5 结论与建议

1. **默认组合取 `gemini-3.7-flash-high` + low**：唯一又快又稳（61 s / 91 分 / 3-0 过评审）。
2. **3.8 只保留 low**；38-high 在当前 900 s 预算下不可用，要用必须放宽 `INKFLOW_RUN_BUDGET_MS`（代价是作者等 15 分钟以上）。
3. **3.6 不要用 low**（连续失败且最慢）；若必须用 3.6，选 high。
4. 已按用户批准把本机 `~/.inkflow/config.json` 指到本机反代 + `gemini-3.7-flash-high`（备份 `~/.inkflow/config.json.bak-20261006-193520`，回退即恢复该文件）。

## 6 残余

- R-285-1：n=3/格、单章单 intent，只支持方向性结论，不做显著性断言。
- R-285-2：critic 与被测模型同族（默认 3.8-flash-high），存在同源偏好；分数绝对值不宜跨族比较。
- R-285-3：36-low rep2 的 critic 未定分（audit unknown），该格均分按 2 跑计。
- R-285-4：只有 38-high 触发 run 预算，其余格从未触发；预算对高档位的挤压尚无第二组样本。

## 7 证据与复现

- 矩阵：`/tmp/p285-write-matrix.py`（结果 `/tmp/p285-write-matrix.json`、进度 `/tmp/p285-write-matrix.log`、服务日志 `/tmp/p285-server-<cell>.log`）。
- 普查：`/tmp/p285-census2.py`（→ `/tmp/p285-census.json`）、五维：`/tmp/p285-dims.py`（→ `/tmp/p285-dims.json`）、汇总：`/tmp/p285-report.py`（→ `/tmp/p285-report.json`）、交付稿全文：`/tmp/p285-drafts/by-run.json`。
- 上游探针：`/tmp/p285-probe.py`（→ `/tmp/p285-probe.log`）。
- 复现命令：`python3 /tmp/p285-write-matrix.py`（需 8317 + 7897 可用、`/tmp/cliproxy.key`、node 22.22.3）。
