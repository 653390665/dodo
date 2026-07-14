# Plan 131：Electron Recovery & Release Trust

## 状态

`DONE`

## 范围

- 编辑器保存失败或超时后禁止自动退出，提供重试、导出未保存内容和明确放弃退出。
- 只有保存成功或用户明确放弃后，主进程才允许窗口关闭。
- 后端 Watchdog 重启采用单飞锁，等待旧进程退出后再启动。
- Watchdog 重启固定复用原端口并禁止自动换端口；同 origin 恢复时保留现有 renderer 与内存中的 pending write，不执行不安全的 `loadURL`。
- 续写 ZIP 在独立 Worker 中按条目数、单文件、总解压量和压缩比预算解压；DOCX 在 Mammoth 解析前执行同类中央目录预检。

## 完成条件

- 保存失败、超时均保持窗口存活；重试成功可关闭；明确放弃可关闭。
- 并发健康检查只触发一次重启，旧进程退出前不启动新进程。
- 重启必须复用原端口；端口意外变化时拒绝直接重载 renderer，避免绕过 pending-write 保存边界。
- ZIP bomb、异常压缩比和超预算 DOCX 在解压/解析前被拒绝，渲染器主线程不承担 ZIP 解压工作。
- 全量门禁和 macOS/Windows 打包生命周期测试通过。
