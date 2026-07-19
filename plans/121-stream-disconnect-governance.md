# Plan 121：全仓流式断连治理

## 状态

`DONE`

> Typecheck、lint、后端与前端测试、官方 Playwright、diff 检查及全仓静态搜索均已通过。

## 目标

清除服务端路由对 `req.on('close')` 的依赖，避免把正常请求体结束误判为客户端断连，同时保持 SSE、中断、配额退款和数据库订阅清理语义。

## 实施范围

1. 统一使用 `bindClientDisconnect(req, res, onDisconnect)`：仅响应 `req.aborted` 或未完成响应的 `res.close`，回调和 dispose 均幂等。
2. 迁移人物简介、片段扩写和灵感生成 SSE，正常流必须收到 `[DONE]`。
3. 迁移 orchestrate 与 orchestrate-draft：正文交付前失败才退款，正文或 fallback 交付后提交 reservation。
4. 迁移 `/api/db/events`：真实断连后统一停止心跳并取消数据库订阅。
5. 增加断连、SSE 完成、配额交付边界、数据库事件流和静态搜索测试。

## 验收门禁

```bash
npm run typecheck
npm run lint
npm test
npm run test:frontend
npx playwright test
git diff --check
rg "req\\.on\\(['\"]close['\"]" server/routes
```

最后一条必须无结果，其余命令必须以退出码 0 完成。
