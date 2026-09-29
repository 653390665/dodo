# Plan 265：OpenAI 兼容端点的思考控制 —— 审稿结构化输出修复（Gemini 反代链路实测触发）

- 状态：✅ 已完成（2026-09-30；代码 + 测试 + 真机复跑已交付）
- 立项：2026-09-30（会话指令「开始」= 批准 Plan 263 诊断报告的建议 a + c）
- 前置：`plans/264-residual-closeout.md` 收口（仅 P5 待真实数据）；E1 push 已完成（`origin/codex/plan169-checkpoint` == 本地）
- 触发场景：用户指令「用 gemini3.8-flash 接入，开始测试写作链路」→ 本机反代 CLIProxyAPI（`http://127.0.0.1:8317/v1`，上游 OAuth provider `antigravity`，模型 `gemini-3.8-flash-high`）；测试跑在隔离配置目录（`INKFLOW_CONFIG_DIR=/tmp/inkflow-writetest/inkflow-config`）与生产库副本（`INKFLOW_DB_PATH=/tmp/inkflow-writetest/data.db`）上，未动用户 `~/.inkflow/config.json`（DeepSeek）与生产库。
- 非目标：不改 DeepSeek / MiniMax / SiliconFlow 既有行为；不改审稿合同本身；不动打包链。

## 根因（取证）

1. `server/lib/server-llm.ts:359-418 buildOpenAICompatibleChatRequest` 只对 DeepSeek（`thinking: { type: 'disabled' }`）与 MiniMax（`reasoning_split: true`）下发思考控制；**未知 OpenAI 兼容端点什么也不发** → 反代按自身默认思考档（`level=high`）执行。
2. 实测（审稿形状探针，真实 4589 字草稿 + 五维 JSON 合同，`max_tokens: 6000`）：默认档下思考 token 挤爆输出预算，content 在 **1610 字符处截断**（`JSONDecodeError: Expecting ',' delimiter: line 1 column 1611`，completion 3275 / reasoning 2160）；`reasoning_effort: 'minimal'` → 1381 字符完整可解析（6.8 s，completion 922）；`thinking:{type:'disabled'}` 亦可解析（1631 字符）。
3. 反代日志：`thinking: original config from request | provider=antigravity model=gemini-3.8-flash-high mode=level budget=0 level=high`。
4. 应用侧表现：审稿 JSON 截断/证据不全 → `classifyCriticFeedback`（`server/helpers/ai-production-pipeline.ts:48-83`）走 unknown → 覆写为 `UNKNOWN_CRITIC_FEEDBACK` → 连续 3 attempt 后 `model_score {score:8, attempts:3, status:'fail'}` → run 终态 `review_required`（诚实降级，未静默接受）。
5. 归因盲区：该 unknown 路径**完全静默**（无日志），无法区分「解析失败」与「证据不全」。

## 改动

### a. 未知端点的思考控制（`server/lib/server-llm.ts`）

- `getParameterRejection`：字段族判据由 `/thinking/i` 扩为 `/thinking|reasoning/i`（仍归类为 `rejectedParameter: 'thinking'`）。
- `buildOpenAICompatibleChatRequest`：`isSiliconFlow` 上提为局部单源（`response_format` 分支复用）；新增
  `if (disableThinking && !isDeepSeekProvider(config.baseUrl) && !isSiliconFlow) { request.reasoning_effort = 'minimal'; }`
- 兼容重试新增通用分支（置于既有 json 块之前）：非 DeepSeek + `parameter_incompatible` + `rejectedParameter === 'thinking'` + `disableThinking` → `omitThinking = true; compatibilityMode = 'omit_thinking'; continue`（不受 `responseMimeType === 'application/json'` 限制）；DeepSeek 原分支与其 `thinking` 字段语义不变。

### c. unknown 归因诊断（`server/helpers/ai-production-pipeline.ts`）

- 抽出 `missingCriticEvidence(audit): string[]`；`hasCompleteCriticEvidence` 改为 `missingCriticEvidence(audit).length === 0`。
- 三条静默 unknown 路径补 `logger.warn`：`Critic audit unknown: incomplete evidence (five-dim)` / `unusable structured score` / `incomplete evidence (structured)`，附 `path` / `score` / `missingEvidence`（只报证据类别名，不落 Provider 原文）。

## 验证

- 定向：`tests/server-llm.test.ts` + `tests/critic-status-contract.test.ts` → **38/38**（新增 2 例：未知端点收到 `reasoning_effort:'minimal'` 且 DeepSeek/MiniMax/SiliconFlow 不受影响；端点 400 拒绝该字段后去字段重发且 `compatibilityMode='omit_thinking'`）。
- 全量：后端 **1469/1469（+2）**、`npx tsc --noEmit` 0、`npx eslint server src shared tests scripts --max-warnings=0` 0。
- 真机（反代 + `gemini-3.8-flash-high`，run `46109ca3-8d26-4430-8d1b-748b0a815b73`）：反代日志全量转为 `level=minimal`；审稿由「不可验证」变为**结构化五维 JSON**（3 次 attempt 均解析成功，其中 1 次瞬时 `truncated` 由既有重试恢复）；`Critic audit unknown` 日志 **0** 条（未触发新增诊断，属预期）。
- 复跑命令：`/tmp/launch-server3301-dbg.sh`（端口 3301，隔离 config + 库副本）→ `python3 /tmp/chain-drive-3301.py`。

## 残余（本轮新发现，未处置）

- Gemini 链路上 writer 输出被本地正文质量门拦下：`[WARN] Writer output failed the prose quality gate; using fallback draft`（evidence `code: 'literary-slop'`，violation「正文包含高置信 AI 套话或结构化叙述缺陷」）；回退后的保底稿被 critic 判 12/100（attempts 3）→ `review_required`。
- 保底稿本身也变形：实测 `chapter_production_runs.draft_content`（4077 字）把 planner beats 的字段值直接拼贴进正文（如「核心冲突…。关键动作链…」），且出现连续句号「。。」——属**分镜 beats → 保底稿/写作提示的注入形态**问题。
- 与本次 provider 修复无关（同链路 DeepSeek run `8c0340be-…` 审稿 score 70 且 apply 成功）；需单独诊断（writer 提示词是否把带字段标签的分镜整段喂给模型 + 保底稿拼接模板是否缺结构剥离）。

## 证据文件（本机，非仓库）

- 反代形状探针 `/tmp/proxy-structured-probe.py`；审稿形状探针 `/tmp/critic-shape-probe.py`
- 链路驱动 `/tmp/chain-drive-3301.py`（SSE 落 `/tmp/chain-gemini.log`）
- 服务日志 `/tmp/inkflow-server-3301-dbg2.log`；落盘草稿 `/tmp/run-draft.txt`
