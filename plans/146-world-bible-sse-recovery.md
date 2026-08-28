# Plan 146：统一设定助手 SSE 完成契约与可恢复失败状态

> **Executor instructions**：严格按范围修改。所有模型响应使用 mock；不得访问真实 API 或生产数据库。
>
> **Drift check（先运行）**：`git diff --stat dff4445..HEAD -- src/components/WorldBibleAssistant.tsx src/lib/sse-client.ts src/tests/world-bible-assistant-request-lifecycle.test.tsx src/tests/world-bible-assistant-batch-sync.test.tsx src/tests/sse-download.test.ts`

## Status

- **State**：DONE（2026-08-08 最终验收）
- **Priority**：P0
- **Effort**：M
- **Risk**：MED（收敛两条现有 SSE 解析路径）
- **Depends on**：`plans/145-assistant-empty-response-diagnostics.md`
- **Category**：bug / tech-debt / tests
- **Planned at**：commit `dff4445`, 2026-08-08

## Why this matters

设定助手同一端点存在三套 SSE 读取逻辑：共享 reader、普通设定提交内联 parser、同步提取专用 parser。同步提取严格要求 `[DONE]`，普通提交却把 EOF 当完成；这会让部分结果、空流和错误状态在不同入口产生不同结论，持续诱发“反复重试但不知道是否成功”。

## Current state

- `src/lib/sse-client.ts:10-90`：共享 reader 已要求合法 JSON，并返回 `done`。
- `src/components/WorldBibleAssistant.tsx:133-176`：同步提取 reader 严格要求 `[DONE]` 和非空内容。
- `src/components/WorldBibleAssistant.tsx:314-352`：普通设定提交的内联 reader忽略 `[DONE]`，EOF 后直接解析累计文本；空文本会被转成“未能生成可确认的设定数据”而不是请求失败。
- `src/components/WorldBibleAssistant.tsx:353-360`：失败追加为聊天中的 system 文本，输入会恢复，但没有显式重试命令或错误类型视图。
- `src/tests/world-bible-assistant-request-lifecycle.test.tsx:117-148`：只覆盖非 2xx 后重发；没有覆盖 SSE error、空流、缺失 `[DONE]` 和部分 token。
- `src/tests/world-bible-assistant-batch-sync.test.tsx:247-271`：同步提取已覆盖 SSE 错误与缺失 `[DONE]`，可作为测试结构样例。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Frontend tests | `npx vitest -c vitest.config.frontend.ts run src/tests/world-bible-assistant-request-lifecycle.test.tsx src/tests/world-bible-assistant-batch-sync.test.tsx src/tests/sse-download.test.ts` | all pass |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npx eslint src/components/WorldBibleAssistant.tsx src/lib/sse-client.ts src/tests/world-bible-assistant-request-lifecycle.test.tsx src/tests/world-bible-assistant-batch-sync.test.tsx src/tests/sse-download.test.ts --max-warnings=0` | exit 0 |

## Scope

**In scope**：
- `src/components/WorldBibleAssistant.tsx`
- `src/lib/sse-client.ts`
- `src/tests/world-bible-assistant-request-lifecycle.test.tsx`
- `src/tests/world-bible-assistant-batch-sync.test.tsx`
- `src/tests/sse-download.test.ts`

**Out of scope**：
- 不改变设定 prompt、实体 schema 或同步事务。
- 不自动写入设定，不修改确认权限。
- 不增加重试次数，不自动重新发送用户输入。
- 不修改抽屉布局之外的产品页面。

## Steps

### Step 1：提取单一 inspiration SSE reader

在 `src/lib/sse-client.ts` 或紧邻的专用 helper 中提供统一读取契约：校验 HTTP 状态、数据库 generation header、token/error 事件、合法 JSON、`[DONE]`、非空最终文本和 AbortSignal。普通提交与同步提取必须共用该契约。

**Verify**：reader 单测覆盖成功、空流、缺 `[DONE]`、坏 JSON、带 code 的 error、abort。

### Step 2：把普通设定提交改为严格状态机

替换 `WorldBibleAssistant.submit` 的内联 parser。只有收到 `[DONE]` 且存在可用文本才更新为成功消息；部分 token、空流或错误事件进入失败状态。失败时删除/替换“正在构思”占位，不得留下可被后续同步误认的 assistant reply。

**Verify**：请求生命周期测试断言失败后 `latestAssistantText` 不可用、同步按钮不出现、输入完整恢复。

### Step 3：提供显式恢复动作

将失败状态渲染为琥珀色可恢复提示，至少提供“重试本次请求”；配置/鉴权/计费类错误提供“打开设置”。按钮调用现有输入与 submit，不自动发起请求。避免继续堆叠相同 system 错误消息。

**Verify**：同一错误连续发生时只有一个当前失败状态；点击重试只增加一次 fetch；成功后失败状态清除。

### Step 4：保持同步提取边界

批量同步继续要求严格 JSON、`[DONE]`、当前 pack/reply/database generation；统一 reader 后不得放宽任何条件。

**Verify**：`world-bible-assistant-batch-sync.test.tsx` 全绿，缺 `[DONE]` 仍不出现同步预览。

## Test plan

- 普通提交：SSE error `[empty_response]`、空流、部分 token 无 DONE、成功重试。
- 错误输入保留：包括换行和长文本，不允许 trim 后覆盖原输入。
- stale/abort：清空、关闭、切作品后错误状态和迟到 token 不回写。
- 同步提取：已有严格完成测试保持通过。

## 2026-08-08 verification audit (historical; superseded below)

- 普通提交和同步提取已共用 `WorldBibleAssistant.readInspirationStream`；该 helper 同时要求完成标记和非空文本，批量同步测试也覆盖缺失 `[DONE]` 不进入预览。
- 该 reader 仍是组件内独立 SSE parser，没有复用 `src/lib/sse-client.ts`；共享 reader 的现有测试也未覆盖计划列出的 error event、空流和 abort 全矩阵。
- 普通请求失败后仍保留“正在构思”assistant 占位，并追加 system 错误消息；重复失败会继续堆叠，未形成单一失败状态。
- 普通失败只恢复输入并依赖再次点击“发送”，没有显式“重试本次请求”；“打开设置”目前只覆盖同步提取错误，不覆盖普通提交的配置/鉴权/计费错误。
- 当前聚焦 Vitest 基线为 **4 files / 30 tests，exit 0**；请求生命周期测试仍只覆盖非 2xx 后再次发送，缺少普通提交 SSE error、空流、部分 token 无 `[DONE]` 和成功清除失败状态。

## Done criteria

- [x] `WorldBibleAssistant` 的普通提交和同步提取复用 `readSseEvents()`。
- [x] 普通提交和同步提取都要求 `[DONE]` 与非空最终文本。
- [x] 失败不留下可同步的 assistant reply，输入可一键重试。
- [x] 错误类型提供匹配的恢复动作，且不自动消耗模型请求（当前失败区提供重试；配置/鉴权/计费错误提供打开设置）。
- [x] 聚焦测试、typecheck、lint 和全量门禁全部 exit 0。
- [x] 计划相关差异已复核；未覆盖或回滚工作区既有改动。

## 2026-08-08 final verification

- 普通提交与同步提取都复用共享 `readSseEvents()`，继续校验 generation header、完成事件和非空正文。
- 失败会删除本次 assistant 占位、恢复输入并写入单一 session failure；旧回复不会被后续同步复用。
- 聚焦设定助手/SSE/store 套件 **31/31**，全量 Vitest **383/383**。

## STOP conditions

- 共享 reader 无法保持数据库 generation 校验。
- 修复要求改变 `/api/inspiration` 成功响应格式。
- 需要自动重试或自动写库才能通过验收。
- 当前文件已被其他工作重构，行号和状态机不再匹配。

## Maintenance notes

后续新增 SSE 消费者必须复用共享 reader；代码审查中禁止再次复制 `reader.read + buffer.split` 状态机。
