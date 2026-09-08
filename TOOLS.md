# TOOLS.md

InkFlow 项目工具约定。机器级事项(node/npm、网关配置、搜索回退)见全局层 TOOLS.md,此处不重复。

- 验证门(`npx tsc --noEmit` / eslint / vitest)依赖 npm,当前不可用——见全局 TOOLS.md「node/npm」。
- 提交纪律:每完成一个计划即提交(docs/plans/README.md 执行者须知);pre-commit 会跑 typecheck,npm 修复前纯文档改动需 `--no-verify` 授权或等待修复。
- 仓库内执行状态的权威在 `docs/plans/README.md`;长期事实与指针在 `MEMORY.md`,不复制会漂移的账目数字。
