# Plan 272 — 首章即时可见（writer 真流式 + 分镜即达）

Status: ✅ 已完成（2026-10-01；W1/W2 落地 + 真机复测 + 全量门禁）

来源：Plan 271 交付后的首章等待体验读数（timeline 探针 `/tmp/p272-timeline.py`）；用户 m20845 主线「保证项目的链路通顺」。

## 问题（真机读数）

隔离实例 3301、gemini-3.8-flash-high、干净过门一次跑（run `2c615260-3e3c-42f4-a4d0-97311d5ddd97`，总 **55.3 s**，critic `{score:82, attempts:1, status:pass}`，交付 model 版本 5035 字 + fallback 版本 4141 字）：

| 阶段 | 相对起点 | 说明 |
| --- | --- | --- |
| `正在准备保底草稿` | +1.1 s | 确定性保底稿构建 |
| `草稿已就绪，可以先审阅或接受写入。` | +3.2 s | 保底稿已可见（但作者要的是 AI 稿） |
| `AI writer 进行中...` | +12.2 s | planner 用了 ~9 s |
| **首个正文 token** | **+49.0 s** | 210 个 `model_draft_token` 在 **3 ms** 内全部到达（服务端攒完整章才回放） |
| critic | +49.0 → +55.3 s | 审稿 |

- 根因：writer 的 `onToken` 只累加（`streamedWriterText += token`）不透传；`model_beats` 只在 pipeline resolve 后的 `.then()` 里发。
- 客户端其实**已具备**渐进渲染能力（`useChapterProductionFlow.ts` 的 `model_draft_token` 会累加并更新 `activeProductionRun.draftContent`），缺的只是服务端透传。

## 目标 / 非目标

- 目标：已生成的内容即时给作者看——正文在 writer 产出时即显（实测首个正文块 **19.0 / 26.7 s**，原 49.0 s），分镜在 planner 完成即达（实测 **9.0 / 17.9 s**，原 ~55 s）。
- 非目标：不改门禁判定、不改落库契约（model/fallback 版本行语义不变）、不做真流式输出重排（定点修复/保底稿替换仍按最终稿回放）。

## 设计

### W1 writer 真流式透传 + 替换时重置

- `PipelineProgress` 新增 `onBeats(beats)`（planner 产出即发）与 `onWriterReset()`（替换正文前重置客户端缓冲）。
- writer 的 `onToken` 改为「累加 + `liveStreamed = true` + `progress.onWriterToken?.(token)`」。
- 三处回放点（Plan 269 定点修复过门 / 干净过门 / catch 保底稿）统一走 `emitFinalDraft(finalText)`：**若最终稿与已透传文本在压缩空白后相同则不重放**；否则先 `onWriterReset()` 再按 24 字符回放（继续受 `throwIfAborted` 保护）。这样干净路径不重复投递，替换路径也不闪烁。

### W2 分镜即达

- planner 完成即 `progress.onBeats?.(sceneBeats)`；路由侧 `beatsSent` 幂等，`.then()` 里的原 `model_beats` 只在未发过时补发。`:931` 的保底分镜（pipeline 之前）不受影响。

### W3（登记，未做）延迟读数

- 首个 token / 首屏 / 成稿时间进指标（`generationLatencyMs` 已覆盖部分；本次先用 `/tmp/p272-timeline.py` 做真机读数）。

## 实施

- 管线：`server/helpers/ai-production-pipeline.ts` — `PipelineProgress` 增两个回调；planner 后 `progress.onBeats?.(sceneBeats);`；三处 writer `onToken` 透传（含场景截断续写调用，原本没有 onToken）；attempt 循环作用域声明 `streamedWriterText` / `liveStreamed` / `compactForCompare` / `emitFinalDraft`（**必须在 `try` 之外**，catch 的保底分支也要用）；三处回放改调 `emitFinalDraft(currentDraft)`。
- 路由：`server/routes/production.ts` — `let beatsSent = false;`；progress 增 `onBeats`（写 `model_beats`）与 `onWriterReset`（写 `model_draft_reset`，都受 `isResponseWritable(res)` 保护）；`.then()` 内原 `model_beats` 包 `if (!beatsSent)`。
- 客户端：`src/lib/production-client.ts` SSE 联合类型与 `allowedTypes` 都加 `model_draft_reset`；`src/lib/hooks/useChapterProductionFlow.ts` 新增 `case 'model_draft_reset':`（清缓冲 + 重置为 model 稿态）。
- 测试：新增 `tests/writer-live-stream.test.ts`（契约：beats 早于首个 token / 干净过门 `resets === 0` 且透传稿 == 交付稿 / 保底替换 `resets === 1` 且 reset 后才回放）；`tests/production-stream-disconnect.test.ts` 因 `model_beats` 提前而失去同步点，改为 `preModelWriteHook` + `markModelWriteReached` 同步。

## 证据与复现

- 仪器：`/tmp/p272-timeline.py`（SSE 逐事件打点）、`/tmp/p272-launch.py`（宿主侧起隔离实例 3301 + 驱动）、日志 `/tmp/p272-timeline.log`、`/tmp/p272-server.log`。
- 隔离实例：库副本 `/tmp/inkflow-writetest/data.db`、`INKFLOW_CONFIG_DIR` 隔离、`INKFLOW_ENABLE_DEV_AUTH_TOKEN=true`、`PORT=3301`；作品 `d23eef68-ae47-4ca5-9e5d-cf6ab23bb1df` / 章节 `99b28a6e-0404-4197-ad63-e43d0be69b37`。
- 门禁：`/tmp/p272-gates.sh`（tsc + eslint + 定向 5 文件）。

## 残余（登记）

- R-272-1：writer 的 `onToken` 在 split-scene 下每场景一次调用，场景之间的衔接段仍可能突兀（本章不做）。
- R-272-2：critic 阶段（~6 s）仍无实时反馈，UI 只有状态文案。
- R-272-3：`model_draft_reset` 只在「文本真的被替换」时发；若定点修复只改标点，客户端会直接显示修复后文本（无重置）。
- R-272-4：透传粒度受上游限制（每场景一个大块，4 块/章）——若要逐句感，需在服务端对每块再切细并控制节奏（本章不做：会引入人为延迟）。

## 执行结果（2026-10-01）

### 门禁

- `tsc --noEmit` 0；`eslint server src shared tests scripts --max-warnings=0` 0；定向 5 文件 **34/34 通过**（`/tmp/p272-gates.sh` → `/tmp/p272-gates2.log` = `TSC_EXIT=0` / `LINT_EXIT=0` / `TEST_EXIT=0`）。
- 首跑暴露一例作用域错误：`server/helpers/ai-production-pipeline.ts(1255,7): error TS2304: Cannot find name 'emitFinalDraft'`（catch 块是独立作用域）→ 已把 `streamedWriterText` / `liveStreamed` / `compactForCompare` / `emitFinalDraft` 提到 `try` 之外。

### 真机复测（隔离实例 3301，gemini-3.8-flash-high，库副本 `/tmp/inkflow-writetest/data.db`）

| 读数 | 修复前（Plan 271 基线） | 跑 1 `05541c0c` | 跑 2 `83bff6c8` |
| --- | --- | --- | --- |
| 保底稿可见 | 1.1 s | 0.2 s | 0.1 s |
| 分镜 `model_beats` | ~55 s（pipeline 结束） | **9.0 s** | **17.9 s** |
| 首个正文块 | 49.0 s | **19.0 s** | **26.7 s** |
| 正文块数（`model_draft_token`） | 210（全部在 3 ms 内回放） | 4 | 4 |
| `model_draft_reset` | — | 0 | **0** |
| 成稿 `draft_done` | 49.0 s | 51.1 s | 69.7 s |
| 整链 | 55.3 s | 57.6 s | 76.4 s |
| critic | 82/1/pass | 88/1/pass | 88/1/pass |

- 跑 2 各块到达时刻：`TOKEN ms=26666 size=1063` / `ms=36216 size=1316` / `ms=52949 size=1033` / `ms=69654 size=1813`；`RESETS 0`。即：正文按**场景**滚动出现，而非一次性到齐。
- 落库（跑 2，只读校验）：model 版本 `2cb53d5c-6c6e-456c-87f8-24eef9ff339f` **5231 字**（hash `a7106546…`）+ fallback 版本 `bec56e1e…` 4141 字；透传总量 5225 字，差值 **+6 = 3 个场景间分隔符 `

`**——`emitFinalDraft` 的压缩空白比较对这种差异不敏感，故不重放（避免双次推送）。
- 结论：① 分镜从「整链结束」提前到 planner 完成（约 6×）；② 首个正文块从 49.0 s 提前到 19–27 s（约 1.8–2.6×）；③ 剩余瓶颈在**上游粒度**：代理把每个场景的正文作为一个大块下发（1.0–1.8 K 字），服务端已无缓冲（不再攒整章），但 UI 只能「逐场景」而非逐句。

### 证据文件

- `/tmp/p272-timeline.py` + `/tmp/p272-timeline.log`（跑 1）；`/tmp/p272-timeline2.py` + `/tmp/p272-timeline2.log`（跑 2，逐块打点）；启动器 `/tmp/p272-launch.py` / `/tmp/p272-launch2.py`；服务日志 `/tmp/p272-server.log` / `/tmp/p272-server2.log`；落库校验 `/tmp/p272-verify2.py`。
