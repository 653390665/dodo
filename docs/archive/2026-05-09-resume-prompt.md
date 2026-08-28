# 新对话续接指令

把下面这段话完整复制到其他对话里即可：

```text
请先阅读并总结以下归档文件，再继续协助我开发 InkFlow：

1. /Users/Zhuanz/Documents/dodo-inkflow/docs/archive/2026-05-09-development-archive.md
2. /Users/Zhuanz/Documents/dodo-inkflow/docs/archive/2026-05-09-chat-log.md

要求：
- 先输出你对当前开发状态、已完成工作、未完成工作、关键风险的理解
- 再给出你建议的下一步优先级
- 如果我要继续开发，请直接基于这些归档文件接着做，不要让我重复解释背景
- 代码仓库路径是：/Users/Zhuanz/Documents/dodo-inkflow
```

## 更强一点的版本

如果你希望新对话更像“接手项目”，可以用这段：

```text
你现在接手一个本地项目，请先完整读取以下归档并建立上下文：

- /Users/Zhuanz/Documents/dodo-inkflow/docs/archive/2026-05-09-development-archive.md
- /Users/Zhuanz/Documents/dodo-inkflow/docs/archive/2026-05-09-chat-log.md

工作要求：
- 用中文回复
- 先总结项目现状、技术栈、主链路、已完成功能、当前问题和推荐下一步
- 回答时引用关键文件路径
- 如果后续需要改代码，默认在 /Users/Zhuanz/Documents/dodo-inkflow 内工作
- 不要重新做无关探索，优先基于归档继续推进
```
