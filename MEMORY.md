# MEMORY.md

InkFlow(dodo-inkflow)项目记忆。**执行状态与账目的唯一权威在 `docs/plans/README.md` 与各计划文档**——本文件只放长期事实与指针,不复制会漂移的状态。

## 工作约定(长期有效)

- 用户全局工作规则(正确优先、先验证后断言、小步修改、结论先行、子代理需报模型/模式/思考强度等)全文存于 `memory/user-working-rules.md`(2026-09-08,跨项目适用)。
- 分支 `codex/plan169-checkpoint`;每完成一个计划提交一次作为漂移检测锚点,勿让成果滞留工作区。
- 验证基线:`npx tsc --noEmit`(0 错误)、`npx eslint <改动文件>`、`npx vitest -c vitest.config.frontend.ts run`、`npm test`;基线数字随用例增长,以 docs/plans/README.md 记载为准。
- 文档口径:010 的验证口径是 vitest 全绿(839→841+);57/57 属于 research 联动块测试(docs/research/2026-09-08-chain-block-testing.md),勿混引。

## 环境事实

- 2026-09-08:本机 node 安装损坏(`/usr/local/lib/node_modules` 仅剩 corepack,npm 缺失、npx 为悬空符号链接)→ npm/npx 命令与 pre-commit 钩子不可用;但 node v22 与 node_modules 工具链完好,验证门可不经 npm 直接用 node 调 tsc/vitest/eslint/`node --test`(见 package.json)运行。修复 npm 后删除本条。
- 2026-09-08:验证门复跑(无源码改动,node 直调):`tsc --noEmit` 0 错误;vitest frontend 841/841 全绿(121 文件,约 618s),与 010 口径一致。

## 待决

- ~~2026-09-08:011 状态同步 + mountedSkillLoadout 措辞修正暂存未提交~~ 已解决:实际已随 `8b6a0e6` 提交,暂存区为空;工作区仅剩未跟踪记忆文件(MEMORY.md/TOOLS.md/memory/),暂不入库(pre-commit 因 npm 缺失不可用,且 agent 记忆不混项目历史)。
- 2026-09-08:`.tdai/`(git 已忽略的外部工具目录,0 文件被跟踪)未加入 eslint ignores,导致全仓 lint 报 936 错(绝大多数在该目录;src 下另有存量 hook-deps 等报错)。基线口径是 eslint 仅查改动文件,当前不受影响;待 npm 修复后建议把 `.tdai/` 加入 eslint.config.mjs ignores 并随正常提交。
