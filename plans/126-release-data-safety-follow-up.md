# Plan 126：发布数据安全复核收口

## 状态

`IN PROGRESS`

## 范围

- 章节元数据与完整章节状态分离；选择章节必须读取完整正文，迟到请求不得覆盖新选择。
- 章节加载期间禁用正文编辑；删除、导入或外部刷新后不得保留幽灵章节。
- Draft、Rewrite、Polish、Audit 与全局助手写回前统一等待编辑器写队列。
- 数据库导入使用完整性、外键、schema、应用标识与关键查询预检，并以同盘 rename 替换、保留时间戳备份。
- 后端致命异常停止接单、drain 写队列、关闭数据库并非零退出。
- 收紧 Fetch 同源鉴权、SSE 无订阅重连和数据库代理参数 schema。
- macOS/Windows 打包作业启动真实打包应用，验证“最后输入后立即退出→重启→正文仍存在”。

## 完成条件

`npm run typecheck`、`npm run lint`、`npm test`、`npm run test:frontend`、`npx playwright test`、`git diff --check` 全部通过，且 macOS/Windows 的 packaged editor lifecycle smoke 均通过后标记 `DONE`。
