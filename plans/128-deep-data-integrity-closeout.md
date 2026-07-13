# Plan 128：深度数据完整性收口

## 状态

`IN PROGRESS`

## 范围

- 数据库导入推进单调代际号；所有代理调用与替换共享 FIFO，旧异步任务、旧配额退款和向量缓存不得跨库生效。
- 单章生产流严格要求 `done`；坏 JSON、业务错误和 EOF 均失败，fallback 与模型草稿使用独立预览缓冲，真实断连停止发射与后续写入。
- 章节版本加载按请求序号隔离，章节切换立即清空旧列表；新版本主动刷新，跨章节版本禁止恢复。
- 保存失败在编辑器头部和状态栏持续可见；数据库导入前必须 flush 全局编辑器写队列。
- 设定 CRUD 将 `changes === 0` 传递到客户端；快捷设定编辑更新原记录，不再重复创建。
- 设定文档解析采用后台 job 合约，确认写入由单个 SQLite 事务完成。
- 新作品续写资料在确认前仅保存在临时内存区；作品与已批准资料包在同一事务创建，取消不留下孤儿记录。
- 高频 AI 写作入口补齐速率限制。

## 完成条件

`npm run typecheck`、`npm run lint`、`npm test`、`npm run test:frontend`、`npx playwright test`、`git diff --check` 全部通过；Plan 127 与本计划在 Playwright 和打包生命周期门禁完成前保持 `IN PROGRESS`。
