# Plan 143：资料包实体提取失败闭环

状态：`DONE`

依赖：Plan 141、142（均已完成）

## 推荐方向

保留现有 React + TypeScript + Vite + Express + SQLite 架构和内存任务模型，不新增依赖、不持久化 LLM 任务。先消除开发态“新前端调用旧后端”的版本漂移，再把 Prompt、无损规范化、Zod Schema、失败诊断、失败批次续跑和前端动作收敛为同一契约。任何失败都不得发布部分预览或写入设定表；真实模型复测必须在用户明确授权后执行。

## 现场证据

| 发现 | 证据 | 结论 |
|---|---|---|
| 前后端运行态漂移 | `npm run dev` 使用 `tsx server.ts`；现场后端 PID 早于路由、Prompt 和前端改动约 20 小时 | 当前页面是新 UI + 旧 API；旧任务不具备真正 resume 能力 |
| 错误来源真实 | 后端 `extractionResultSchema.safeParse()` 连续失败后产生 `EXTRACTION_SCHEMA_MISMATCH` | 不能只修 UI 文案，必须修输出契约和恢复状态机 |
| 诊断信息被掩盖 | 前端把 Schema、非法 JSON、截断统一为同一句摘要，详情不显示 issue message | 用户无法判断错误字段或采取正确动作 |
| 错误卡确定性溢出 | 窄内容栏内使用单行 flex，正文可收缩，详情和动作组不可收缩 | 737×674 视口出现逐字竖排和按钮越界 |
| 当前测试缺口 | 后端定向 62 项、前端定向 29 项均通过，但没有 resume、分半检查点、纵向错误卡专测 | 现有绿灯不能证明失败闭环完成 |
| 数据安全基线 | 生产库为 WAL；现场仅只读确认 23 个文档、443,978 字符、28 批 | 测试必须使用独立 DB；不得物理复制或写生产库 |

## 目标与完成标准

1. 开发态后端改动能自动重载，前端不再调用旧 API。
2. JSON 语法错误、截断、Schema 不匹配、Provider/网络错误保持不同错误码和动作。
3. Schema 修复信息只作用于失败批次或失败半段，成功后不污染后续批次。
4. Resume 恢复代际监听、真实 attempt、固定 traceId 和已成功单元检查点。
5. 轮询对异常 2xx、未知状态、缺失结果和断网有限失败，不静默成功或无限等待。
6. 错误卡在窄嵌套容器中纵向展示，详情可读、动作不溢出、DOM 合法。
7. 所有失败路径不写人物、地点、道具、势力、时间线或关系表；不记录原始模型输出。

## 范围边界

### 包含

- 开发态服务重载、实体提取 Prompt、规范化、分半边界和内存检查点。
- 实体提取 Job 的失败、取消、resume、代际监听、trace、attempt 和安全序列化。
- 前端轮询协议校验、重新查询、错误详情、动作矩阵和窄容器布局。
- 定向、全量、Playwright 确定性协议验证，以及可选的真实 Provider dogfood。

### 不包含

- 不持久化 Job，不保证服务重启后恢复旧内存任务。
- 不增加版本协商端点、通用任务队列、数据库表或迁移。
- 不放宽关系 `sourceType/targetType`；非法关系仍须修复或拒绝。
- 不保存 raw 模型输出、Prompt、API Key 或资料正文到日志。
- 不自动点击“同步到设定”，不在未授权时调用真实付费模型。

## 并行实施边界

| 角色 | 物理文件边界 | 依赖 |
|---|---|---|
| Coordinator | `package.json`、Plan 状态、总装与最终运行态验证 | 全程协调 |
| Implementer A：共享契约 | `shared/lib/sync-extract-prompt.ts`、`shared/lib/sync-extraction-chunks.ts`、对应纯函数测试 | 第一波，可与前端并行 |
| Implementer B：后端状态机 | `server/routes/continuation.ts`、后端集成测试 | 等 A 的函数契约冻结后开始 |
| Implementer C：前端/UI | `src/lib/continuation-client.ts`、`src/components/ContinuationPackView.tsx`、对应前端测试 | 第一波；先约定重新查询接口 |
| Gatekeeper | 只读运行静态、测试、Playwright；真实 Provider dogfood 仅在授权后执行 | 代码冻结后分波执行 |

禁止两个 Implementer 并发修改同一文件。SQLite 测试使用不同的 `/tmp/*.test.db` 和配置目录，Playwright 独占其测试库。

## 实施阶段

### 阶段 0：冻结基线并消除开发态漂移

文件：`package.json`

- 将 `dev` 从 `tsx server.ts` 改为 `tsx watch server.ts`。
- 不增加版本端点；完成代码修改后手动终止一次现场旧进程，再启动新 watch 进程。
- 验证修改 `server/` 或其引用的 `shared/` 文件后，服务能释放端口并完成一次确定性重启。

验收：新启动任务返回 `traceId`，`POST /api/continuation-packs/jobs/:jobId/resume` 路由存在；控制台无端口重复占用。

### 阶段 1：统一 Prompt、enum 与分半契约

文件：

- `shared/lib/sync-extract-prompt.ts`
- `shared/lib/sync-extraction-chunks.ts`
- `server/routes/continuation.ts` 中的 `normalizeExtractionPayload`

规则：

- Prompt 保留完整 JSON 示例、所有顶层键、枚举、空值、整数和数量上限。
- 已知中英文别名映射到标准 enum。
- 缺失、`null` 或未知 `role` 降级为 `supporting` 并记录 warning。
- 缺失、`null` 或未知 item `type` 降级为 `other` 并记录 warning。
- 关系 `sourceType/targetType` 保持严格 enum，不猜测实体类型。
- 分半优先选择中点附近段落换行；没有安全边界才回退字符中点。
- 只支持现有的一层分半，不引入递归通用任务树。

验收：未知人物/道具类型不再制造无意义 Schema 失败；非法关系类型仍返回 `EXTRACTION_SCHEMA_MISMATCH`；Prompt 与 Zod 契约测试一致。

### 阶段 2：修复失败批次 Resume 状态机

文件：`server/routes/continuation.ts`

状态约束：

| 事件 | 必须发生 | 禁止发生 |
|---|---|---|
| 新任务 | 初始化固定 traceId、空完成列表和空恢复上下文 | 继承其他任务的 issues |
| Schema 失败 | 保存失败批次、issues、真实 attempt 和安全检查点 | 发布部分结果、写设定表 |
| Resume | 一次性消费失败上下文；重建 generation watcher | 把旧 issues 带到全部后续批次 |
| 失败批次成功 | 清除该批 issues/checkpoint；标记顶层批完成 | 下一批仍携带修复 Prompt |
| 最终成功 | 统一合并后发布预览并清理 controller/rerunner | 泄露内部 partial/checkpoint |
| 取消/代际变化 | 中止在途调用并安全清理 | 继续发布迟到结果 |

具体任务：

- 将 `generationWatch` 移入每次 `runEntityExtraction()`，每次首跑或 resume 独立创建并在 `finally` 清理。
- Resume 时取出 `failedChunk/schemaIssues` 作为一次性恢复上下文，随后从公开 Job 状态清除。
- `extractChunk` 显式接收当前单元的 repair issues；分半子单元不得重新读取全局 `job.schemaIssues`。
- 顶层批次维护真实模型调用计数；每次 `generateText` 前递增，失败时写入 `failedChunk.attempt`。
- 日志统一包含 `traceId/batch/attempt/finishReason/issues`，继续脱敏且不记录 raw。
- 只做一层内存分半检查点：保存 `{splitAt, leftResults?}`；左半成功、右半失败时 resume 直接继续右半，不重跑父批和左半。
- 顶层批完整成功后才加入 `completedResults/completedChunkIndexes`。
- GET/cancel 使用统一 safe-job 序列化，移除 `completedResults`、分半检查点和其他内部状态。
- cancel 同步清理 controller/rerunner；失败任务仅在 TTL 到期或成功后清理恢复资源。

成本上限：首次顶层批最多 6 次模型调用；resume 失败半段最多再调用 2 次。超出上限必须停止并返回稳定错误码。

### 阶段 3：收紧客户端轮询协议

文件：

- `src/lib/continuation-client.ts`
- `src/tests/pack-sync.test.tsx`

任务：

- 启动接口的 2xx 响应只接受两种形状：非空 `jobId`，或字段完整的 legacy snapshot；空对象和残缺快照立即报协议错误。
- Job GET 只接受 `queued/running/completed/failed`；未知状态、非 JSON、`completed` 无 result 均有限失败。
- 保留连续传输失败阈值，但错误必须携带 `jobId/databaseGeneration`。
- 导出只做 GET 的“重新查询现有任务”入口；轮询暂时不可用时禁止 POST resume 或创建新任务。
- 每轮等待完成或 abort 后都移除 listener；cancel POST 最多一次。
- 校验 resume 的 202 响应和 generation，不对残缺响应继续轮询。

验收：所有异常响应均在测试时限内 reject；不存在静默成功、无限轮询、重复 cancel 或重复新建任务。

### 阶段 4：重做错误详情与动作语义

文件：

- `src/components/ContinuationPackView.tsx`
- `src/tests/continuation-pack-ab-late.test.tsx`

错误动作矩阵：

| 错误 | 主动作 | 次动作 |
|---|---|---|
| `EXTRACTION_SCHEMA_MISMATCH` | 修复并重试本批 | 从头重新提取 |
| JSON 非法、截断、网络/服务失败 | 从失败批次续跑 | 从头重新提取 |
| `EXTRACTION_POLLING_UNAVAILABLE` | 重新查询进度（仅 GET） | 无 |
| 配置、鉴权、额度不足 | 引导检查设置/额度 | 不盲目重提 |
| 代际变化、任务不存在 | 刷新后从头开始 | 无旧任务续跑 |

任务：

- `ViewError` 保留安全的服务端 message；友好摘要不再覆盖真实详情。
- 错误卡改为无条件纵向结构，不依赖 viewport `sm:` 断点；摘要、详情、动作分行。
- 使用 `role="alert"`，详情展示 code、batch/total、attempt、可断行 traceId，以及最多 3 条 `path/code/message`；不显示 raw。
- 操作按钮允许换行且不挤压摘要；同样修复 `existingLoadError` 的窄容器溢出。
- 资料包历史行改为非交互容器；选择和删除为 sibling buttons，二者在同步中都禁用，消除嵌套 `<button>`。

验收：737×674 和常规桌面宽度下，详情关闭/展开均满足 `scrollWidth <= clientWidth`；正文不逐字竖排，按钮完整可见，console 无 nested-button 警告。

## 必补测试

### 后端集成

集中扩展 `tests/pack-sync-integration.test.ts`：

1. 未知 role/item type 降级并产生 warning。
2. 非法关系 enum 仍返回 Schema mismatch。
3. Schema 修复成功后，下一批 Prompt 不含上一批 issues。
4. Resume 期间推进 database generation，可及时中止并返回 `GENERATION_MISMATCH`。
5. 分半右侧失败时保留左侧，resume 不重复父批或左侧。
6. attempt 等于真实请求次数，不再硬编码为 2。
7. Schema/JSON/Provider 错误的 Job 与日志使用同一 traceId。
8. 已完成顶层批在 resume 后不重新调用。
9. GET/cancel 不暴露内部 results/checkpoints。
10. 任意失败路径均不写世界设定实体表，配额退款至多一次。

保留并扩展：

- `tests/model-json.test.ts`：严格 JSON 与截断分类。
- `tests/server-llm.test.ts`、`tests/server-llm-mock.test.ts`：`response_format`、finish reason、Provider 分类与降级。
- `tests/continuation-database-generation.test.ts`：代际切换。

### 前端与客户端

- failed job 完整传播 code、batch、total、traceId、jobId、generation、issues 和 attempt。
- `completed` 无 result、未知 status、200 非 JSON、启动 2xx 空对象均有限 reject。
- 连续轮询失败后可只读重新查询原 job，不触发 resume/extract。
- sleep 中 abort 返回 AbortError，cancel POST 恰好一次且 listener 被移除。
- Schema 修复按钮只调用 resume；“从头”才调用 extract。
- 错误详情显示安全 message 与 issue path/code/message。
- 删除按钮祖先不存在 button；选择和删除只触发自身处理。

### Playwright

- 新增资料包提取失败与续跑路径，不调用真实模型，使用确定性 mock。
- 捕获 `pageerror`、console error、trace 和 screenshot。
- 覆盖 737×674 与常规桌面宽度下的错误卡布局。

## Gatekeeper 验证矩阵

| 波次 | 验证 | 隔离/并发 | 通过条件 |
|---|---|---|---|
| 1 | typecheck、lint、build、diff check；后端定向；前端定向 | 静态/前后端可并行；每个后端命令使用独立 `/tmp` DB | 全部 exit 0、零 warning |
| 2 | 后端全量、前端全量 | 可并行；后端 `--test-concurrency=1`，前端最多 2 workers | 零失败、零非预期跳过 |
| 3 | Playwright | 单独运行，`--workers=1 --retries=0 --timeout=15000` | 全绿、无 pageerror，失败保留 trace |
| 4 | 浏览器协议验收 | Playwright `page.route` 确定性模拟失败 Job；串行 | 错误详情、动作请求和窄屏布局符合契约 |

建议命令：

每次运行先创建唯一目录，禁止两个后端全量 Gatekeeper 并发；对内部仍硬编码测试 DB 的旧测试保持 `--test-concurrency=1`：

```bash
npm run typecheck
npm run lint -- --max-warnings=0
npm run build

plan143_backend_dir="$(mktemp -d /tmp/inkflow-plan143-backend.XXXXXX)"
env NODE_ENV=test INKFLOW_DB_PATH="$plan143_backend_dir/data.test.db" INKFLOW_CONFIG_DIR="$plan143_backend_dir/config" \
  node --test --test-concurrency=1 --test-timeout=15000 --import tsx \
  tests/model-json.test.ts tests/pack-sync-integration.test.ts tests/server-llm.test.ts \
  tests/server-llm-mock.test.ts tests/llm-execution-gate.test.ts tests/continuation-database-generation.test.ts

npx vitest -c vitest.config.frontend.ts run \
  src/tests/pack-sync.test.tsx src/tests/continuation-pack-ab-late.test.tsx \
  --maxWorkers=1 --no-file-parallelism --testTimeout=10000 --hookTimeout=10000

plan143_full_dir="$(mktemp -d /tmp/inkflow-plan143-full.XXXXXX)"
env NODE_ENV=test INKFLOW_DB_PATH="$plan143_full_dir/data.test.db" INKFLOW_CONFIG_DIR="$plan143_full_dir/config" \
  node --test --test-concurrency=1 --test-timeout=20000 --import tsx tests/*.test.ts

npm run test:frontend -- --maxWorkers=2 --testTimeout=10000 --hookTimeout=10000
npx playwright test --workers=1 --retries=0 --timeout=15000 --global-timeout=120000
git diff --check
```

## 执行记录（2026-07-21）

- 自动化 Gatekeeper：后端 609/609、前端 236/236、typecheck、lint、build 均通过；`git diff --check` 通过。
- Playwright 隔离环境下 3 个业务用例断言均通过；整套运行在现有 E2E `server.ts` teardown 阶段超时，非业务断言失败，第三个用例已单独复跑通过。
- 开发服务已切换为 `tsx watch server.ts`，本地首页返回 HTTP 200。
- 真实 DeepSeek `deepseek-v4-flash` 小资料包冒烟使用隔离临时 SQLite 完成；Provider 进入 plain fallback 后仍返回 `EXTRACTION_INVALID_JSON`（`parserStage=no_candidate`、attempt=2），未生成预览。临时资料包和数据库已删除，未执行同步、未写生产库。
- Plan 143 已完成收口；真实成功预览、失败批次恢复和窄视口交互门禁均已由后续复核覆盖。Plan 141、142 已完成并在 `plans/README.md` 标记为 `DONE`。

## 修订版安全证据（2026-07-23）

- 上一轮隔离 DeepSeek 冒烟的失败链已固定：`traceId=extract_caf39017-5d87-4f77-b908-e462d618aba9`、失败批次 1、业务 `attempt=2`、`finishReason=stop`、`responseFormatMode=plain_fallback`、`parserStage=no_candidate`。
- 只记录上述脱敏元数据；不记录 Provider 错误正文、Prompt、模型输出或资料内容。后续代码修改会使现场内存 Job 失效，必须从头重新提取。

## 执行记录（2026-07-23，修订版）

- Provider 链路：DeepSeek 首请求携带 `thinking.disabled + response_format.json_object`；仅在明确参数拒绝后移除 `thinking`，保留 JSON 模式；第二次仍拒绝时返回 `EXTRACTION_PROVIDER_PARAMETER`，不进入 Parser、不提供 resume。
- 安全诊断：补齐 `providerHttpStatus/rejectedParameter/providerErrorCode/compatibilityMode/providerRequestCount`；`attempt` 与真实上游请求数分离；不记录 raw、Prompt、正文或 Provider 错误正文。
- 续跑：保留失败类型并在清空 Job 错误字段前计算 `repairKind`；非法 JSON 使用 `json_syntax` 修复契约，Schema 使用 `schema` 修复契约。
- 自动化：typecheck、lint、build、git diff check 通过；后端全量 `614/614`；前端全量 `236/236`；DeepSeek Provider 单测、路由集成和无写入断言通过。
- Playwright：3 个既有用例中 2 个通过；happy-path 因开发 Vite WebSocket 端口冲突及本地无 API Key/向量回退告警在 45 秒超时，未发现本轮业务断言失败，保持为环境阻塞，不标记全绿。
- 真实合成冒烟：隔离临时 SQLite、少于 2,000 字非敏感资料，`traceId=extract_a7d9019f-5931-47af-97ff-127538f25751`，`status=completed`、`hasResult=true`、真实 Provider 请求数 `2`；未同步、未写生产库，临时文件已清理。
- 原 28 批资料重跑：选用内容哈希一致副本 `cont-pack-208dedbd-d8f2-4b23-85f5-7229055e32cd`；第 1–19 批完成，第 20 批因 DeepSeek 请求超时停止，`traceId=extract_90ef0e65-f9d7-4588-a2ba-9ce9d755db46`、`attempt=1`、`providerRequestCount=1`、`responseFormatMode=json_object`、`compatibilityMode=none`。失败 Job 无结果、无部分预览、未执行同步。
- 状态：Plan 143、141、142 均为 `DONE`。原 28 批失败恢复路径已由隔离任务和 Playwright 协议场景覆盖；不得把旧现场批次或生产资料作为回归依据。

## 验收与上线顺序

1. 代码冻结后先完成 Gatekeeper 波次 1–3。
2. 终止一次现场旧 `tsx server.ts`，启动 watch 服务；确认新 API 契约已加载。
3. 用 Playwright `page.route` 模拟 running → failed → resume → completed，以及 polling unavailable；这只验证前端协议和布局，不冒充后端状态机测试。
4. 后端真实状态机由独立 DB 集成测试覆盖；前后端两层都通过才算确定性闭环。
5. 真实 Provider dogfood 为可选增强门禁：只有用户明确授权后，才允许使用真实模型和真实资料复测；记录 code、batch、attempt、issues、traceId，不记录 raw。
6. 可选真实提取成功后仍停留在预览，不自动点击“同步到设定”。
7. 必需门禁全部通过后，依次将 Plan 141、142、143 和 `plans/README.md` 更新为 `DONE`；不得因用户未授权真实 Provider 调用而阻塞代码收口。

## 最终验收记录（2026-08-05）

- 新增 Playwright 协议场景覆盖 Schema mismatch 后续跑同一 Job，以及轮询不可用后只用 GET 重新查询；独立规格 `2/2`、完整套件 `5/5` 通过，每个业务用例保持 `15s` 超时且不重试。
- typecheck、lint、build 和 `git diff --check` 均通过；build 仅保留既有的 597.41 kB chunk 提示。
- 后端隔离数据库全量 `625/625`、前端全量 `248/248` 通过；自动化未访问生产数据库或真实模型。
- 必需门禁已满足，Plan 141、142、143 状态统一收口为 `DONE`。

## 风险与回滚

- `tsx watch` 重启会丢失内存 Job：这是已接受边界；开发态变更前先明确提示当前任务会失效。
- enum 降级可能隐藏模型质量下降：必须保留 warning，关系类型继续严格。
- 分半检查点增加内存：随 Job TTL 一起清理，不落库。
- 真实 Provider 仍可能返回语义错误：本计划只保证格式、恢复和数据安全，不保证提取内容正确。
- 回滚按阶段独立进行；共享契约、后端状态机、前端/UI 三组 diff 不交叉回退。

## 完成定义

- 上述行为测试、全量测试、Playwright、build、lint、typecheck 和 diff check 全部通过。
- 后端隔离集成测试与 Playwright 协议测试共同证明失败可诊断、可有限恢复、不会重复创建任务或写入生产数据。
- 页面在窄容器下无溢出、无非法 DOM，错误动作与错误码一一对应。
- 生产 `~/.inkflow/data.db` 未参与自动化测试。
- Plan 141–143 与 README 状态和标题一致后才可宣布收口。
