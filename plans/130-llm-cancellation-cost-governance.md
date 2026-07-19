# Plan 130：LLM Cancellation & Cost Governance

## 状态

`DONE`

## 范围

- Google 与 OpenAI-compatible 请求统一支持真实 AbortSignal、超时终止和监听器清理。
- 客户端断连后停止底层网络、token 回调和后续写入。
- 商业模型调用必须绑定存在的计费主体；缺失或伪造 novelId 不得绕过额度。
- Editor Agent 的 chain 长度、模块和重复调用受严格约束，并纳入 reservation 结算。
- 建立可逐路由迁移的最小 LLM execution gate，统一并发、trace、取消和额度生命周期。
- 外层 HTTP/job execution 按 operation 统一限速；同一工作流内部的 Writer/Critic 多轮调用复用外层请求预算，不自我触发 429。
- 路由与生产管线禁止直接导入 provider 入口；手工结算流同样必须进入 governed execution context。
- 欢迎页免配额调用使用服务端签发、短时、按操作限次的 onboarding session，不能依赖客户端 surface 自证。
- World、Audit、拆书、设定提取和文档解析后台任务持有 AbortController，并提供客户端可调用的取消端点。
- Embedding fallback 纳入 gate 与真取消，持久化模型、维度和内容哈希元数据，拒绝不兼容向量。

## 完成条件

- Abort/timeout 测试证明供应商 fetch 被取消且不再发射 token。
- 无效 novelId、超长或重复 chain 在模型调用前失败。
- reservation 成功提交、失败退款且重复结算幂等。
- 后台任务取消会中止 provider 请求并退款；前端 job 协议必须轮询结果而非把 jobId 当成模型正文。
- 付费模式和非配额连接测试同样受请求速率限制，第六个独立突发请求返回 429。
- 全量门禁和打包生命周期测试通过。
