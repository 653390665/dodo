# MEMORY.md

InkFlow(dodo-inkflow)项目记忆。**执行状态与账目的唯一权威在根 `plans/README.md`(主账:历史轮次 + 计划 001 起)与各计划文档**;`docs/plans/README.md` 只是「能力卡整合轮 001–014」的专题账本(双账本问题登记为 plan 191 的 DOCS-3)。——2026-09-28 更正指针,本文件只放长期事实与指针,不复制会漂移的状态。

## 工作约定(长期有效)

- 用户全局工作规则(正确优先、先验证后断言、小步修改、结论先行、子代理需报模型/模式/思考强度等)全文存于 `memory/user-working-rules.md`(2026-09-08,跨项目适用)。
- 分支 `codex/plan169-checkpoint`;每完成一个计划提交一次作为漂移检测锚点,勿让成果滞留工作区。
- 验证基线:`npx tsc --noEmit`(0 错误)、`npx eslint <改动文件>`、`npx vitest -c vitest.config.frontend.ts run`、`npm test`;基线数字随用例增长,以 docs/plans/README.md 记载为准。
- 文档口径:010 的验证口径是 vitest 全绿(839→841+);57/57 属于 research 联动块测试(docs/research/2026-09-08-chain-block-testing.md),勿混引。

## 环境事实

- 2026-09-20 / **2026-09-28 销账**：npm 已恢复可用（v12.0.2，对 Node 22.22.0 有版本支持告警，功能正常）；**「vitest 链 3 条 moderate dev 漏洞待 --force 升级」已不存在** —— 2026-09-28 实测 `npm audit --json` = **0 漏洞**（info/low/moderate/high/critical 全 0；964 依赖：prod 366 / dev 463 / optional 166 / peer 23 / peerOptional 0），`AUDIT_EXIT=0`（日志 `/tmp/audit-full.json`、`/tmp/audit-exit.txt`）。CI 的 audit 门（`.github/workflows/build.yml:25-60`，只审 `npm audit --omit=dev --json`，exemptions 为空）不阻断。→ 本项无待办残留。
- 2026-09-08:验证门复跑(无源码改动,node 直调):`tsc --noEmit` 0 错误;vitest frontend 841/841 全绿(121 文件,约 618s),与 010 口径一致。
- 2026-09-28 环境变更：**仓库路径 = `/Users/Zhuanz/workspace/dodo-inkflow`**（旧 `~/Documents-local/dodo-inkflow` 因 macOS TCC 无法读，已迁走；旧路径留 `REPO_MOVED_README.md` 路牌，冷存档勿动）；**本机 Node**：默认 fnm 目录写不进去，改 `FNM_DIR=$HOME/.inkflow/fnm` 后 `fnm install 22.22.3` 成功（`fnm exec --using=22.22.3 -- node -v` = v22.22.3）；**gh 凭据**：Desktop 宿主读不到登录钥匙串 → `gh auth status` 报 invalid，但 `git ls-remote` 可用；如需宿主侧 push，用 `gh auth login --insecure-storage -h github.com`。

## 待决

- ~~2026-09-08:011 状态同步 + mountedSkillLoadout 措辞修正暂存未提交~~ 已解决:实际已随 `8b6a0e6` 提交,暂存区为空;工作区仅剩未跟踪记忆文件(MEMORY.md/TOOLS.md/memory/),暂不入库(pre-commit 因 npm 缺失不可用,且 agent 记忆不混项目历史)。（2026-09-28 拍板 A 后：此处「暂不入库」立场作废——见下方已决项）
- 2026-09-28 **已决（拍板 A：承认入库）**：`git ls-files memory MEMORY.md TOOLS.md` = `MEMORY.md` / `TOOLS.md` / `memory/2026-09-08.md` / `memory/user-working-rules.md`，四个均已被 git 追踪；本文件与 `TOOLS.md` 不再声明「不入库」——agent 记忆与工作规则（`memory/user-working-rules.md` 为跨项目来源）随仓库留存。
  - 未采用 B（`git rm --cached`）：2026-09-28 复核发现 B 只能把文件从 HEAD 移出，blob 仍在历史里（4 个本地提交 `1160fc6` / `eff459d` / `99612e6` / `824981b` 携带）；要真正不公开须在首次 push 前重写历史（代价：156 个提交哈希全变），故不采用。
