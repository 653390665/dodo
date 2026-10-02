# Plan 270：链路通顺 · 配置完整 · 模型最优 · 过门禁与 AI 味受控

- 状态：◐ 进行中（2026-10-02）
- 提出：用户指令（2026-10-02）
- 前提：Plan 269 已交付并推送（`9f2c84a` / `a787a55` / `fed288f`）；实例 = 隔离副本 `/tmp/inkflow-writetest/data.db` + 独立 config（provider = 本机 CLIProxyAPI `http://127.0.0.1:8317/v1`，上游出网经用户端代理 `127.0.0.1:7897`）。

## 目标（用户原话四件事）

1. **链路通顺**：从开书到成章的每一段（分镜 → 正文 → 审稿 → 应用 → 事实裁决 → 成章门）能在当前配置下一路走通，不靠手工补数据。
2. **功能配置完整**：运行所需的每个配置面都有值、有默认、有降级说明；缺失项列清单与补齐路径。
3. **模型最优配置**：在真实链路里对候选模型/思考档位做矩阵测量，给出可复现的默认配置建议。
4. **过评审与门禁 + AI 味受控**：内容能过质量门与审稿，且不产出 AI 味过足的正文；用可复核的读数说话。

## 工作流与判据

### ① 链路通顺
- 链路段：`start-stream`（写入确认/限流/代际/文风/配额四道门）→ planner 分镜 → writer 正文（含质量门与定点修复）→ critic 结构化审稿 → `POST /runs/:id/apply`（版本选择 + 章节版本落库）→ `fact-candidate` preview/apply → `/complete` 成章门。
- 判据：每段在隔离实例上真实跑通；每段的成功证据 = SSE 事件 + 库表行 + HTTP 码；任何失败必须能在服务端日志里指到一行归因。
- 已知摩擦待逐条复核：`hook-card` 只映射 planner（对 writer 零影响）；卡组+本章卡 ≤6 的总闸；`assetId`/`cardRef` 可用性语义口径债。

### ② 功能配置完整
- 配置面清单：provider（baseUrl/model/key）、embedding（本地权重初始化 / 降级）、writing style 确认态、capabilityProfile（projectCards / projectTechniqueIds / guardrailIds）、flow 与步骤可用性（可运行 vs 仅引导）、promptGuardLevel、配额与商业化门禁、备份/导出链路。
- 判据：每面给出「当前值 + 是否完整 + 缺失时的补齐动作」；不完整项进残余清单，不在本轮静默略过。

### ③ 模型最优配置
- 矩阵（真实链路，同一作品/章节，n=3/格）：`gemini-3.8-flash-high` @low/@high、`claude-sonnet-4-6` @low/@high；控制变量 = `INKFLOW_REASONING_EFFORT` 环境变量 + `POST /api/config` 切模型。
- 每跑读数：耗时、SSE 事件序列、门禁 dump（codes/evidence）、修复日志（targets/applied/skipped）、critic `model_score`、版本行（source/字数/hash）、交付稿是否 == model 版本。
- 判据：给出默认 `model + effort` 建议，附「为什么不是别的组合」的反证（例如 pro 系低于字数合同、codex 系配额耗尽）。

### ④ 过评审/门禁 + AI 味受控
- 指标：硬缺陷命中率、软命中（`literary-slop` 等）条数/千字、定点修复成功率、交付稿 == model 稿比例、critic 通过率与平均分、离线套话普查（副词弱化 / 重复段 / Markdown 残留）。
- 判据：n≥12 跑后给出阈值结论（当前实测：3/3 软命中均就地修复，6/6 交付稿 == model 稿）；不达标项给根因与后续项。

## 运行方式与证据

- 实例：`/tmp/launch-3301-gatedbg.sh`（隔离库 + 独立 config + DEBUG_* 开关）宿主侧启动；驱动 `/tmp/chain-drive-3301.py`（token → generation → writing-style resolve/confirm → start-stream SSE → 只读 sqlite 取证）。
- 矩阵 harness：`/tmp/p270-matrix.py`（4 格 × 3 跑，逐格重启服务并注入档位），日志 `/tmp/p270-matrix.log`，产物 `/tmp/p270/<cell>.rep<N>.{log,sse.log,gate.jsonl}` 与 `/tmp/p270/<cell>.server.log`。
- 复跑：矩阵结束后逐格跑 `/tmp/chain-drive-3301.py`，读数由 `/tmp/p270-recollect.py`（时间窗归因，避开文件轮转 off-by-one）+ `/tmp/p270-census4.py`（字数/套话普查）汇总。

## 约束

- 不触碰生产库与用户配置：实例只用 `/tmp/inkflow-writetest/data.db`（副本）与 `/tmp/inkflow-writetest/inkflow-config`。
- 不新增依赖；改动只落在既有门禁与配置面之内。
- 提交前必须跑：定向测试 + `tsc --noEmit` + `eslint server src shared tests scripts --max-warnings=0`；汇报时区分「本轮读数」与「历史读数」。

## 执行结果（2026-10-01，隔离实例 3301/3302）

> 口径：隔离库 `/tmp/inkflow-writetest/`（生产库副本）+ 独立 config 目录；不碰生产库与用户配置。
> 控制变量：`INKFLOW_REASONING_EFFORT`（档位）、`POST /api/config`（模型）；每格 3 次。

### ① 链路通顺（start-stream → planner → writer → critic → apply → fact-candidate → /complete）

- 生产段（SSE）：`run_created → fallback_draft_token×N → fallback_audit → fallback_continuity → fallback_beats → status → model_beats → model_draft_start/token/done → model_audit → model_score → done`，终态 `review_required`（产品契约：不自动落库）。
- 接受段（run `a9985131`，版本 `26d56908`）：`apply` 200（回 `factCandidateId`，正文 4620 字落库，`chapter_versions` +1）→ `fact-candidate/preview` 200（`facts: []`，本章无新事实提案）→ `fact-candidate/apply` 按规跳过 → `/complete` 200。
- 成章门：首次 `/complete` 返回 `quality: unknown` + `unknownChecks: ["ai-review"]`（命中原 attempt 缓存，0.1 ms 提前返回）；带 `retryUnavailable: true` 重试后 → `quality: pass` / `completionGate: ready`；章节 `workflow_meta` 落 `completionGate=ready`、`reviewState.gate=pass`、`completionContentHash`、`completionDecisionAt`。
- 向量索引：`apply` 后本作品 1 章 = 1 chunk（4620 字，与正文一致）；`npx tsx server/cli/vector-init.ts <novelId>` 幂等（重跑「新索引 0 章，跳过已索引 1 章」）；章节保存/接受自动排期回填（`server/lib/db/chapters.ts:19`）。
- 未演练：`/complete/risk`（needs-action 风险接受路径）本次未覆盖。

### ② 功能配置完整度

| 面 | 当前值（隔离实例） | 判定 | 备注 |
|---|---|---|---|
| LLM provider | baseUrl `http://127.0.0.1:8317/v1`、model `gemini-3.8-flash-high`、`hasApiKey=true`、`livenessStatus=connected`、test-connection 200（26 模型） | 完整 | 反代（CLIProxyAPI）可用 |
| 嵌入 | `status=ready`、provider `local`、modelId `local:Xenova/bge-small-zh-v1.5` | 完整 | 权重在 `build/embedding-model/` 与 transformers 缓存各 4 文件齐备；3301 早期 `not_initialized` 属实例未初始化态，`POST /api/config/embedding/retry` 可触发 |
| 向量索引 | 本作品 1/1 章已索引（chunk 4620 字） | 完整 | CLI 幂等回填可用 |
| 写法确认 | resolve/confirm 正常，fingerprint `489b42a4…` | 完整 | confirm 与 resolve 同载荷（`server/validation.ts:540`） |
| 能力画像 | `capabilityModelVersion=3`、`activeFlowId=xiaofeiji-novel-flow`、deck 1 主 + 2 支持、techniques 9、guardrails 9 | 完整 | 画像存于 `novels.project_preference_profile` |
| 流程可用性 | 34 步 / 可运行 28（82.4%）/ 仅引导 6 | 完整 | 引卡面残余（hook-card 仅 planner、6 卡总闸、卡效为 P2）另行登记 |
| 护栏档位 | `promptGuardLevel=strict` | 完整 | — |
| 配额/商业化 | 默认关闭，门禁放行 | 完整 | — |

登记在册、不阻塞本链路的已知缺口：hook-card 只映射 planner（`CARD_STAGE_MAP`）、6 卡总闸语义、适合度「使用反馈」消费侧未接线（Plan 237）。

### ③ 模型最优配置（矩阵 n=3/格）

| 格 | 模型 @ 档位 | 3 跑耗时 | 均耗时 | 审计分 | 交付字数（均值） | 硬缺陷 | 备注 |
|---|---|---|---|---|---|---|---|
| `gemini38-low` | gemini-3.8-flash-high @ low | 70.5s / 70.3s / 70.7s | 70.5s | 88/88/90 | 5876 | md=0 | 结构化审稿通过 |
| `gemini38-high` | gemini-3.8-flash-high @ high | 351.8s / 139.3s / 308.2s | 266.4s | 82/82/84 | 5126 | md=0 | 结构化审稿通过 |
| `sonnet46-low` | claude-sonnet-4-6 @ low | 394.8s / 407.4s / 444.0s | 415.4s | —/—/— | 4186 | md=0 | 无结构化审稿（回退） |
| `sonnet46-high` | claude-sonnet-4-6 @ high | 首跑 >18 min 未收敛（矩阵终止） | — | — | — | md=1（首跑命中） | 与 low 档同因；高档位更慢 |

逐跑明细：

- `gemini38-low` a9d0884e · 23:10:29 · 70.5s · 分 88 · 6392 字 · 套话 {"极其": 1, "骤然": 1}
- `gemini38-low` 8a18a7fd · 23:11:41 · 70.3s · 分 88 · 6314 字 · 套话 {"极其": 1, "仿佛": 1, "一丝": 1}
- `gemini38-low` b964a73c · 23:12:52 · 70.7s · 分 90 · 4921 字 · 套话 {"极其": 2, "似乎": 1}
- `gemini38-high` b8523333 · 23:14:28 · 351.8s · 分 82 · 5706 字 · 套话 {"一丝": 1, "如同": 1, "骤然": 5}
- `gemini38-high` d853aff1 · 23:20:21 · 139.3s · 分 82 · 5052 字 · 套话 {"极其": 1, "一丝": 1, "骤然": 1}
- `gemini38-high` a9985131 · 23:22:42 · 308.2s · 分 84 · 4620 字 · 套话 {"仿佛": 1, "一丝": 1, "骤然": 2}
- `sonnet46-low` 20d60d1a · 23:28:03 · 394.8s · 分 None · 4186 字 · 套话 {}
- `sonnet46-low` 137939f4 · 23:34:38 · 407.4s · 分 None · 4186 字 · 套话 {}
- `sonnet46-low` c6567b1f · 23:41:27 · 444.0s · 分 None · 4186 字 · 套话 {}

门禁命中（dump）：

- `sonnet46-low` 23:43:57 len=4322 codes=['markdown-residue']
- `sonnet46-low` 23:47:41 len=4216 codes=['markdown-residue', 'duplicate-paragraph']
- `sonnet46-low` 23:30:30 len=4204 codes=['markdown-residue', 'duplicate-paragraph']
- `sonnet46-low` 23:33:26 len=4247 codes=['markdown-residue']
- `sonnet46-low` 23:37:24 len=4310 codes=['markdown-residue', 'duplicate-paragraph']
- `sonnet46-low` 23:40:14 len=4212 codes=['markdown-residue']
- `sonnet46-high` 23:51:31 len=4239 codes=['markdown-residue', 'duplicate-paragraph']

结论：

1. **推荐 gemini-3.8-flash-high + `reasoning_effort=low`**（即当前 App 默认路径）：均 70.5 s、审计分 88/88/90、交付 5876 字、0 硬缺陷。
2. `high` 档在同模型上**更慢 3.8×**（266.4 s）且分数更低（82/82/84）、字数更少（5126）——高档位不带来质量收益。
3. claude-sonnet-4-6 在**当前产品链路**上不合格：3 场景、每场景首段带独立 `---` 分隔线 → `markdown-residue/P1` 硬缺陷 → 弃稿回退保底稿；planner 亦回退（`Planner fell back to deterministic beats`）。属**格式兼容问题**（可修），非纯质量结论。
4. `sonnet46-high` 只完成首跑即终止：run `ece13b2f`（23:49:03）同样命中 `markdown-residue/P1`（len=4239，另含重复段落），planner/critic 双回退，critic 重试（210 s 超时）后 SSE 挂起 >18 min——高档位不改变结论，只放大延时。
### ④ 过评审/门禁与 AI 味

| 指标 | gemini38-low | gemini38-high | sonnet46-low |
|---|---|---|---|
| 交付字数（均值） | 5876 | 5126 | 4186 |
| 套话/千字（词表法） | 0.45 | 0.91 | 0.00 |
| Markdown 残留（均） | 0.0 | 0.0 | 0.0 |
| 重复段（均） | 0.0 | 0.0 | 0.0 |
| 对白标记/千字 | 0.079 | 0.063 | 0.000 |

- 产品门禁复扫（`validateCompleteChapterDraftQuality(text, undefined, { minChars: 3000 })`）：low **3/3 ok**（仅 `literary-polish/P2`，机械分 95.31/97.62/93.90）；high **3/3 ok**（2 次无 finding，1 次 `literary-polish/P2`，机械分 100/94.06/100）；sonnet 交付的是保底稿（模板散文，天然 ok/机械分 100）。
- 词表法只作横向比较（非产品检测器）；产品侧口径以门禁 findings 为准。
- 结论：推荐配置下交付稿**全部过门**，软残留仅 P2 打磨项；本轮出现的 P1 硬缺陷全部来自 sonnet 的 Markdown 分隔线。

### 残余与建议

- R-270-1：`/complete/risk`（needs-action 风险接受）未演练——补一条端到端用例。
- R-270-2：`/complete` 重试在同一内容上 4.9 ms 返回 `pass`（疑似反代对同一请求命中缓存），机制未证实——需在真机上复核成章审稿是否真的调用了 LLM。
- R-270-3：claude-sonnet-4-6 的 `---` 分隔线兼容性可修（剥除独立 `---` 行或强化提示约束）——修完才能公平比较该模型的写作能力。
- R-270-4：`low` 档为默认，`high` 档需先解决 writer 的 reasoning-only/超时与 critic 超时（Plan 267 已记）。

### 证据与复现

- 矩阵 harness：`/tmp/p270-matrix.py`（宿主侧，PID 见 `/tmp/p270-matrix.log`）；每格 = kill 3301 → 以 `INKFLOW_REASONING_EFFORT` 启动 `/tmp/launch-3301-gatedbg.sh` → `POST /api/config` → 跑 `/tmp/chain-drive-3301.py`。
- 读数归因：`/tmp/p270-recollect.py`（按时间窗归因，避开文件名轮转 off-by-one）→ `/tmp/p270-recollect.json`；普查 `/tmp/p270-census4.py` → `/tmp/p270-census4.json`。
- 尾链：`/tmp/p270-tail-launch.py`（3302 隔离实例）+ `/tmp/p270-tail2.py`（apply→fact→complete）；库内证据 `/tmp/p270-attempt-inspect.py`。
- 复跑命令：`NODE_ENV=test node --test ... tests/*.test.ts`（后端全量）、`npx vitest -c vitest.config.frontend.ts run`（前端全量）。
