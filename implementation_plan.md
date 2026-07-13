# 发布阻塞项二次修复实施计划

## 目标

在不新增依赖或数据库迁移的前提下，关闭 Audit / Rewrite 时序与持久化问题、Electron 与下载安全缺口、配额退款幂等缺口、数据库导入关闭竞态，并修复计划索引。

## 第一波并行边界

- Agent A（T1）：Audit / Rewrite 后端与前端生成流、对应测试。避免修改配额 helper 的公共契约。
- Agent B（T2）：Electron 来源/协议/IPC 校验、下载 helper 与对应测试。
- Agent C（T4、T5）：数据库实例/导入串行化、数据库竞态测试、计划索引。避免修改 Audit 路由。

## 第二波协调

- Coordinator（T3）：在第一波完成后统一修改 quota guard 及所有 reserve/refund 调用方，处理与 Audit 路由的契约交集。

## 验收门禁

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`
4. `npm run test:frontend`
5. `npx playwright test`

Plan 110 仅在上述门禁和独立 Gatekeeper 复核全部通过后保留为 DONE。

## Plan 121：全仓流式断连治理

- Coordinator：扩展 `stream-disconnect`，提供幂等绑定与 dispose。
- Agent A：迁移 `world.ts`、`simple-llm.ts` 普通 SSE。
- Agent B：统一迁移 `agents.ts` 三处 SSE，保留交付前退款、交付后提交语义。
- Agent C：迁移数据库事件流，补测试和计划台账。
- Gatekeeper：全仓搜索、门禁和断连/配额语义独立复核。

Plan 121 的全部命令与独立 Gatekeeper 复核已通过，状态收口为 `DONE`。
