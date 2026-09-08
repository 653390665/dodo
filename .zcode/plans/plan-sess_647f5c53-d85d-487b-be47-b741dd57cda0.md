执行 014 全量收尾计划，按序推进：

Phase B — PM 诊断修复（能力包去勾选化 + 写法失效透明化）
Phase A — props 收尾（generationStatus/outlineError/userIntent 入 store，props 68→≤60）
Phase C — 交互体验（动作词收敛、状态条阶段推荐）
Phase E — 渐进项
Phase F — 文档收尾

每阶段独立提交 + 全量验证（tsc 0 / eslint 0 / vitest 全绿 / npm test 全绿）。完成后推送远端。