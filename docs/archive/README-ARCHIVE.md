# 归档说明

这个目录用于保存项目在某个时间点的开发归档，方便：

- 中断后继续开发
- 在新的 Codex 对话中快速恢复上下文
- 给其他协作者做交接

## 推荐文件结构

每次正式归档，建议至少包含三类文件：

1. `YYYY-MM-DD-development-archive.md`
   - 项目当前状态
   - 已完成工作
   - 当前风险
   - 下一步建议
   - 关键文件索引

2. `YYYY-MM-DD-chat-log.md`
   - 结构化对话归档
   - 重点记录问题、决策、修复与结论
   - 默认不要求逐字原始导出

3. `YYYY-MM-DD-resume-prompt.md`
   - 可直接复制到新对话里的读取指令
   - 让新会话先读归档再继续工作

## 建议使用方式

如果你要在新对话里继续这个项目，优先把最新的 `resume-prompt` 内容复制过去。
如果没有 `resume-prompt`，就至少让新对话读取：

- 最新的 `development-archive`
- 最新的 `chat-log`

## 编写原则

- 以“继续开发可用”为目标，不追求逐字聊天备份
- 优先写清楚：
  - 当前做到哪里
  - 哪些功能已验证
  - 哪些风险还在
  - 下一步最该做什么
- 尽量附关键文件路径，方便后续会话快速定位

## 当前项目已存在归档

- [2026-05-09-development-archive.md](/Users/Zhuanz/Documents/dodo-inkflow/docs/archive/2026-05-09-development-archive.md)
- [2026-05-09-chat-log.md](/Users/Zhuanz/Documents/dodo-inkflow/docs/archive/2026-05-09-chat-log.md)
- [2026-05-09-resume-prompt.md](/Users/Zhuanz/Documents/dodo-inkflow/docs/archive/2026-05-09-resume-prompt.md)
