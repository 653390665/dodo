# Plan 147：补齐助手失败恢复体验与本地漏斗指标

> **Executor instructions**：本计划只记录错误码、时长和阶段，不记录用户输入、模型输出、API Key 或完整上游错误。
>
> **Drift check（先运行）**：`git diff --stat dff4445..HEAD -- src/components/AIAssistant.tsx src/components/WorldBibleAssistant.tsx src/stores/assistant-session-store.ts shared/types/product-events.ts server/routes/product-events.ts src/lib/product-events-client.ts src/tests/ai-assistant-session.test.tsx src/tests/world-bible-assistant-request-lifecycle.test.tsx tests/product-events.test.ts`

## Status

- **State**：DONE（2026-08-08 最终验收）
- **Priority**：P1
- **Effort**：M
- **Risk**：LOW（本地状态、文案和匿名事件）
- **Depends on**：`plans/145-assistant-empty-response-diagnostics.md`, `plans/146-world-bible-sse-recovery.md`
- **Category**：direction / dx / tests
- **Planned at**：commit `dff4445`, 2026-08-08

## Why this matters

产品主线是“卡住时唤起助手，然后回到继续写作”。当前 general 助手失败时清空输入、只显示短暂 toast；bible 助手虽保留输入，却把错误当聊天文本堆积。没有本地指标能回答失败率、重试成功率或恢复耗时，团队只能靠截图判断。

## Current state

- `src/components/AIAssistant.tsx:123-136`：发送后立即清空输入；catch 只 toast，不恢复输入、不保存错误码、不提供重试。
- `src/components/WorldBibleAssistant.tsx:353-360`：恢复输入但把错误追加到消息列表。
- `src/stores/assistant-session-store.ts:10-16`：session 只有 messages/input/draft/loading/requestId，没有错误与最近失败请求状态。
- `shared/types/product-events.ts:1-21`：本地事件系统已有 result、durationMs、errorCode 和 novelId，但没有 assistant 事件。
- `src/tests/ai-assistant-session.test.tsx:40-123`：覆盖会话隔离和取消，没有失败输入恢复或重试成功。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Frontend tests | `npx vitest -c vitest.config.frontend.ts run src/tests/ai-assistant-session.test.tsx src/tests/world-bible-assistant-request-lifecycle.test.tsx` | all pass |
| Product event tests | `node --test --test-concurrency=1 --test-timeout=45000 --import tsx tests/product-events.test.ts tests/product-event-instrumentation.test.ts` | all pass |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npx eslint src/components/AIAssistant.tsx src/components/WorldBibleAssistant.tsx src/stores/assistant-session-store.ts shared/types/product-events.ts server/routes/product-events.ts src/lib/product-events-client.ts --max-warnings=0` | exit 0 |

## Scope

**In scope**：
- `src/components/AIAssistant.tsx`
- `src/components/WorldBibleAssistant.tsx`
- `src/stores/assistant-session-store.ts`
- `shared/types/product-events.ts`
- `server/routes/product-events.ts`
- `src/lib/product-events-client.ts`
- 对应聚焦测试

**Out of scope**：
- 不上传遥测；事件继续只在本地 SQLite。
- 不记录 prompt、回复、API Key、Base URL 或作品正文。
- 不增加自动重试、营销弹窗或 Premium 引导。
- 不重做助手抽屉和导航。

## Steps

### Step 1：为 session 增加可恢复失败状态

定义可序列化的最近失败状态：错误码、安全文案、原请求是否仍在 input、开始/结束时间、可用动作。切作品、清空会话和新请求成功时按现有生命周期清理。

**Verify**：store 测试覆盖按作品/模式隔离、清空、成功覆盖和 stale request 不回写。

### Step 2：对齐 general 与 bible 的恢复体验

两种模式都保留失败输入，显示一个当前错误区并提供“重试”；配置类错误提供“打开设置”。历史聊天只保留用户与有效助手结果，不把重复技术错误当内容消息。

**Verify**：前端测试断言输入不丢、错误可访问、重试一次只发一次请求、成功后恢复为正常状态。

### Step 3：增加最小本地事件

扩展现有本地 product event 契约，记录 assistant request 的 mode、结果、错误码、耗时和 novelId。若现有 schema 不允许 mode，用有限事件名区分 general/bible；禁止写入任何内容字段。

**Verify**：路由 schema 拒绝未知字段；导出事件中无 prompt/output/key/baseUrl 字段；事件写入失败不得影响助手主请求。

### Step 4：建立产品验收指标

在现有本地指标中增加：助手请求成功率、空响应率、失败后 5 分钟内重试率、重试成功率、p50/p95 恢复耗时。样本量不足时显示 unknown，不伪造 0%。

**Verify**：聚焦 metrics 测试覆盖 0 样本、单次失败、失败后成功、重复事件去重。

## Test plan

- general 失败：输入恢复、单一错误、重试成功。
- bible 失败：不污染聊天历史、配置错误动作正确。
- 切作品/关闭/清空：失败状态隔离且迟到响应无效。
- 事件隐私：只含枚举、时长、错误码和 ID，不含内容。

## 2026-08-08 verification audit (historical; superseded below)

- general 与 bible 助手失败后都会把原输入恢复到输入框，用户无需重新输入即可再次发送。
- general 仍只有 toast；bible 把失败追加为 system 聊天消息。session store 没有可序列化失败状态、恢复动作或 stale failure 写回保护，重复失败仍会污染历史。
- 共享事件类型和数据库 metrics 已出现 assistant 事件、空响应率、失败率、5 分钟重试率和恢复时长；但 `server/routes/product-events.ts` 的严格枚举仍不接受任何 assistant event/stage，客户端又静默吞掉 400，因此真实助手事件当前不会落库。
- 指标还缺计划要求的显式成功率和重试成功率；现有 product-event 测试直接调用数据库层，未覆盖 HTTP 路由接收 assistant 事件。
- 隐私静态测试的文件清单不包含 `AIAssistant.tsx` 或 `WorldBibleAssistant.tsx`，尚不能作为两类助手调用点不携带内容的完整证明。
- 当前聚焦 Node 基线（组合套件）为 **43/43，exit 0**，聚焦 Vitest 为 **4 files / 30 tests，exit 0**；现有测试通过，但上述缺口仍未被覆盖。

## 2026-08-08 final verification

- general 与 bible 使用隔离 session failure；失败输入可重试，配置/鉴权/计费错误提供设置入口，技术错误不写入聊天历史。
- assistant 事件/阶段由严格共享枚举约束，未知字段拒绝；事件不包含 prompt、输出、Key 或 Base URL。
- 本地指标包含成功率、空响应率、5 分钟重试率、重试成功率和恢复 p50/p95；零样本保持 `null`。
- 产品事件、助手会话与全量门禁均通过。

## Done criteria

- [x] 两种助手失败后都可不重输内容完成重试。
- [x] 重复失败不堆叠聊天错误消息。
- [x] 本地指标可回答成功率、空响应率和重试恢复率。
- [x] 事件不包含用户内容、模型内容或凭证。
- [x] 聚焦测试、typecheck、lint 和全量门禁全部 exit 0。
- [x] 计划相关差异已复核；未覆盖或回滚工作区既有改动。

## STOP conditions

- 指标实现需要数据库迁移或新增依赖；先回报并拆成独立计划。
- 现有产品事件无法安全表达 assistant 事件而不记录内容。
- UI 改动需要重构整个抽屉或导航。
- 任何测试尝试调用真实模型或生产数据库。

## Maintenance notes

产品评审应以“失败后能否继续写”作为第一指标，不以错误 toast 展示率代替恢复率。事件字段变更需同时审查本地导出隐私。
