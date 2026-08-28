# Plan 145：把助手空响应拆成可诊断、可恢复的模型错误

> **Executor instructions**：按步骤执行；每步都运行对应验证。不要读取、记录或输出任何 API Key、提示词正文、模型输出正文。遇到 STOP 条件立即停止，不要扩大范围。
>
> **Drift check（先运行）**：`git diff --stat dff4445..HEAD -- server/lib/server-llm.ts server/routes/agents.ts tests/server-llm.test.ts tests/server-llm-mock.test.ts tests/orchestrate-disconnect.test.ts`
> 若范围内文件已变化，先逐条核对本计划的行号与契约。

## Status

- **State**：DONE（2026-08-08 最终验收）
- **Priority**：P0
- **Effort**：M
- **Risk**：MED（改变模型错误分类与重试策略）
- **Depends on**：none
- **Category**：bug / dx / tests
- **Planned at**：commit `dff4445`, 2026-08-08

## Why this matters

当前 `empty_response` 同时表示“上游真的没有内容”“只有 reasoning/thinking”“内容被清洗为空”等不同故障。截图中的用户只能反复重试，系统也无法判断应当重试、增加输出预算、关闭推理还是更换模型。必须先建立诚实的错误契约，再调整 UI。

## Current state

- `server/lib/server-llm.ts:725-746`：非流式 OpenAI 兼容响应只读取 `message.content`。代码虽在诊断中识别 `reasoning_content`，但 `content` 为空时仍统一抛成 `empty_response`。
- `server/lib/server-llm.ts:643-722`：流式响应只累积 `choices[0].delta.content`；空流在重试耗尽后统一返回 `empty_response`。
- `server/lib/server-llm.ts:249-261`：`ProviderError` 的用户安全文案只有单一“模型服务返回空结果”。
- `server/routes/agents.ts:300-315`：SSE 错误事件只返回 `{ error, code }`，未携带安全的诊断分类或 trace id。
- `tests/server-llm.test.ts:112-131`：只断言空流被分类为 `empty_response`，没有覆盖 reasoning-only、`finish_reason=length`、清洗后为空及两次重试耗尽。

约束：reasoning/thinking 内容不得作为最终答案展示；诊断中不得记录模型正文。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| LLM tests | `node --test --test-concurrency=1 --test-timeout=45000 --import tsx tests/server-llm.test.ts tests/server-llm-mock.test.ts` | all pass |
| Route tests | `node --test --test-concurrency=1 --test-timeout=45000 --import tsx tests/orchestrate-disconnect.test.ts` | all pass |
| Lint | `npx eslint server/lib/server-llm.ts server/routes/agents.ts tests/server-llm.test.ts tests/server-llm-mock.test.ts tests/orchestrate-disconnect.test.ts --max-warnings=0` | exit 0 |

## Scope

**In scope**：
- `server/lib/server-llm.ts`
- `server/routes/agents.ts`
- `tests/server-llm.test.ts`
- `tests/server-llm-mock.test.ts`
- `tests/orchestrate-disconnect.test.ts`

**Out of scope**：
- 不更换用户模型或 Base URL。
- 不增加依赖，不修改数据库、配额或 prompt 内容。
- 不把 reasoning/thinking 暴露给前端。
- 不执行真实模型请求。

## Steps

### Step 1：建立空响应原因分类

在 `ProviderError` 契约中区分至少三类安全原因：真正无内容、仅 reasoning/thinking、输出达到长度上限但没有最终答案。保留供应商、attempt、finish reason、是否存在 reasoning、trace id 等元数据，但禁止包含原始响应正文。

**Verify**：新增单测分别构造三类响应，断言错误码/原因不同且错误对象不包含 mock 正文。

### Step 2：让流式与非流式解析产生一致诊断

统一最终答案抽取与诊断逻辑。流式分支继续只交付最终 `content`，但要记录是否收到 reasoning 字段和 finish reason；非流式分支同样处理。reasoning-only 不得作为成功响应。

**Verify**：`node --test --test-concurrency=1 --test-timeout=45000 --import tsx tests/server-llm.test.ts tests/server-llm-mock.test.ts` → 新旧用例全部通过。

### Step 3：按原因收敛重试策略

仅对可能瞬态恢复的真空响应/网络错误执行有限重试；reasoning-only 且已到长度上限时不重复发送同一个请求。保持 `maxAttempts` 总上限，不增加供应商请求次数。

**Verify**：测试断言瞬态空流最多按配置重试，确定性 reasoning-only/length 场景只调用供应商一次。

### Step 4：向 `/api/inspiration` 返回安全诊断

HTTP JSON 和 SSE error event 使用相同错误码，并附安全的 `traceId` 与 `reason`；不得附 prompt、模型原文、API Key 或完整上游错误体。保持现有 HTTP 状态映射兼容。

**Verify**：`tests/orchestrate-disconnect.test.ts` 覆盖 headers sent 前后两种路径；响应无敏感内容且无 `[DONE]`。

## Test plan

- 空 SSE + `[DONE]`：瞬态空响应分类与受限重试。
- reasoning 字段存在、最终 `content` 为空：不展示 reasoning，返回 reasoning-only 原因。
- `finish_reason=length` 且无最终答案：不盲重试。
- `<think>...</think>` 清洗后为空：与 reasoning-only 契约一致。
- 成功响应：现有 token、`[DONE]`、数据库 generation 契约不变。

## 2026-08-08 verification audit (historical; superseded below)

- `ProviderErrorCode` 目前仍只有统一的 `empty_response`；reasoning-only、真正空响应、`finish_reason=length` 后无最终答案没有独立安全原因。
- 流式分支只读取 `delta.content`，非流式虽记录 `reasoningContentPresent`，两条路径的空结果最终仍抛 `empty_response`；`toProviderErrorEnvelope` 也没有计划要求的 `reason` 字段。
- 重试判定将全部 `empty_response` 视为可重试，尚无 reasoning-only/length 确定性失败只请求一次的实现和测试。
- `/api/inspiration` 已返回安全 `traceId`，但现有路由测试只覆盖 headers sent 前的配置错误；缺少 SSE headers sent 后同码、同 reason、无 `[DONE]` 的验收。
- 当前聚焦 Node 基线（含 LLM、inspiration 路由和 product-event 测试）为 **43/43，exit 0**；通过的是现有行为，不足以证明上述缺失契约。

## Done criteria

- [x] 三类空响应原因可由测试稳定区分。
- [x] reasoning/thinking 永不作为最终答案返回。
- [x] 确定性 reasoning-only / length 失败不会重复消耗同一请求。
- [x] `/api/inspiration` 的 JSON 与 SSE 错误契约使用同一安全 envelope，含 trace id，失败不发送 `[DONE]`。
- [x] typecheck、lint、聚焦测试及全量门禁全部 exit 0。
- [x] 计划相关差异已复核；未覆盖或回滚工作区既有改动。

## 2026-08-08 final verification

- OpenAI 兼容与 Google 流式/非流式空输出都通过 `emptyOutputReason()` 生成安全原因；reasoning 文本不进入答案或错误正文。
- 三分类与重试次数测试通过：`no_content` 可有限重试，`reasoning_only`、`length_exhausted` 单次失败。
- `/api/inspiration` 成功有明确 complete + `[DONE]`；结构化失败使用安全 envelope，EOF/失败不伪装成功。
- 最终全量门禁：Node **712/712**、Vitest **383/383**、Playwright **10/10**。

## STOP conditions

- 上游供应商 SDK/API 没有可用于判断 reasoning 或 finish reason 的字段。
- 修复必须保存或输出模型正文才能诊断。
- 需要增加依赖、改变配额或放宽安全边界。
- 聚焦测试连续两次无法稳定复现分类。

## Maintenance notes

新增供应商适配时必须先写 payload 形状测试，再接入错误分类。评审重点是“不泄露 reasoning”与“不重复计费”。
