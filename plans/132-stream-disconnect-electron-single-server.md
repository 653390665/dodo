# Plan 132：生产流断连与 Electron 单服务收口

## 状态

`PLANNING`

## 优先级

`P1 / RELEASE BLOCKER`

## 目标

- 客户端在等待数据库写队列期间断连后，生产结果不得继续写库或错误结算配额。
- macOS 关闭最后窗口再从 Dock 激活时，必须复用现有后端，禁止产生失联的第二个服务进程。

## T1：生产流断连后的写入与计费边界

- 在 `server/routes/production.ts` 的 fallback 与 model 两个序列化写回回调内部，再次检查请求 AbortSignal 和响应可写状态；检查必须发生在任何读取、更新和配额提交之前。
- 若 fallback 尚未完成持久化就断连：零内容写入，不设置 `contentDelivered`，由现有结算路径退款。
- 若 fallback 已持久化、model 在排队期间断连：保留 fallback，不写 model 结果；已交付 fallback 的配额保持提交，禁止重复结算。
- 使用现有中止错误与清理路径，不新增依赖或新的队列抽象。

### 回归测试

- 阻塞写队列 → 开始 fallback → 客户端断连 → 释放队列：ProductionRun 不写生成内容，reservation 退款一次。
- fallback 已持久化 → 阻塞 model 写回 → 客户端断连 → 释放队列：只保留 fallback，model 不覆盖，配额只提交一次。
- 数据库 generation 在排队期间变化时，仍按旧任务丢弃语义执行。

## T2：macOS Dock 重开复用单一后端

- `electron.cjs` 创建窗口前先判断 packaged server 是否仍存活；存活时复用现有 `serverProcess`、`serverPort` 和 origin，不再次调用 `startServer()`。
- 仅在旧进程已确认退出或健康检查失败时，执行现有安全重启流程；禁止覆盖仍存活的进程引用。
- macOS 最后窗口关闭可保留后端；应用真正退出时仍必须停止 watchdog 并等待后端退出。
- Watchdog 初始化保持幂等，复用窗口不得创建重复定时器。

### 回归测试

- packaged macOS：关闭最后窗口 → `activate` → 新窗口复用同一 child、端口和 origin，spawn 次数仍为 1。
- 旧 child 已退出后 `activate`：只启动一个新 child，旧引用被清理。
- 最终退出：唯一 child 被停止，watchdog 无残留。

## 执行顺序

- Agent A：T1，仅修改 Production 路由及其测试。
- Agent B：T2，仅修改 Electron 生命周期及其测试。
- Gatekeeper：合并后独立复核断连计费、单进程生命周期和全量门禁；测试数据库必须隔离。

## 验收门槛

```bash
npm run typecheck
npm run lint
npm test
npm run test:frontend
npx playwright test
git diff --check
```

- GitHub `check`、`mac`、`win` 必须基于同一最终 SHA 全绿。
- Plan 129–132 在上述门槛完成前保持 `IN PROGRESS` / `PLANNING`，不得提前标记 `DONE`。
