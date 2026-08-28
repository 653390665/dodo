# SQLite WAL 一致性快照备份规范

> 触发分支：改动数据库备份、导出、导入功能（`server/routes/db.ts`、`server/lib/db-init.ts`）之前先读本文。

## 为什么
数据库启用 WAL 模式（`journal_mode = WAL`）后，最新写入滞留在 `data.db-wal` 临时日志中。对运行中的 `data.db` 做物理拷贝、打包或 HTTP 直传，会缺失用户最新写作与设定内容，还可能在还原时引发一致性错误或主库损坏。

## 规范
1. **强制快照导出**：统一通过 `better-sqlite3` 原生的事务快照接口 `db.backup(destination)` 生成一致性快照文件（如 `DB_PATH + '.temp-export'`），再导出至 HTTP 响应或暂存。
2. **零残留清理**：文件流传输完毕、中途异常终止或下载失败的回调钩子中，立即同步 `fs.unlinkSync` 抹除临时文件，宿主机不残留任何 `.temp` 后缀垃圾。
3. **降级容灾**：仅当数据库单例尚未初始化、无法调用 `db.backup` 时，才允许降级为直接物理传输。

## 现有实现与守护测试
- `server/routes/db.ts`：导出路由基于 `db.backup(backupPath)` 生成快照后流式返回。
- `server/lib/db-init.ts`：数据库单例初始化。
- `tests/export-route.test.ts`：覆盖 `.temp-export` 快照导出与临时文件清理。
