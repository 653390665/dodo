# 实施计划: 引入类型安全且并发安全的事务管理器 (069)

本计划旨在解决由于 HTTP 代理的无状态性与 SQLite 手动事务的连接状态性冲突，导致潜在的“跨请求事务污染”隐患。

## 发现的缺陷
在 `/api/chapter-production-runs/:runId/apply` 中，原先使用手动调用 `beginTransaction()` (即执行 `BEGIN`) 与 `commitTransaction()`。
如果在高并发或用户误操作双击时，两个并发请求会共享同一个 SQLite 连接：
1. 请求 B 试图执行 `BEGIN`，会触发 SQLite 报错（不能在事务中嵌套事务）。
2. 请求 B 的 `catch` 块中调用了 `rollbackTransaction()`。
3. 这会意外回滚**请求 A** 正在进行的合法事务！

## 解决方案
1. 废除手动 `beginTransaction`、`commitTransaction` 和 `rollbackTransaction`。
2. 引入 `better-sqlite3` 内置的 `db.transaction(fn)` 包装器，支持自动提交、自动回滚以及基于 `Savepoint` 的安全嵌套。
3. 清理数据库代理路由 `DB_WHITELIST`，防止外部恶意请求锁定数据库。

## 变更文件

### [server/lib/db.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/server/lib/db.ts)
- 移除了 `beginTransaction`, `commitTransaction`, `rollbackTransaction`。
- 新增 `runInTransaction<T>(fn: () => T): T`。

### [server/routes/db.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/server/routes/db.ts)
- 从 `DB_WHITELIST` 中移除了事务方法，防止越权锁库风险。

### [server/routes/production.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/server/routes/production.ts)
- 将 `/apply` 接口中的所有写操作用 `db.runInTransaction` 包裹。

## 验证计划
- 运行 `npx tsc --noEmit` 确保没有类型悬空。
- 运行 `npm run test` 确保所有数据库测试用例正常通过。
