# Plan 274：待决项收口（Node / Scene / proxy / memory）

- 状态：✅ 已完成（2026-10-01）
- 触发：用户拍板四条待决项 —— 「仓库 http.proxy 不入库，本机 Node 升 22.22.3、memory/ 入库 A/B、Scene 死模型删。」
- 范围：只做这四条；不改链路、不改提示词、不动上游 provider。

## 决定与落地

| # | 项 | 拍板 | 落地 |
|---|---|---|---|
| D1 | 仓库 git `http.proxy` | **不入库** | 不写任何 git 配置（`git config --local` 保持空）；推送继续用一次性 `git -c http.proxy=http://127.0.0.1:7897 push`——Plan 269 已实测：GitHub 直连 `curl: (28) Operation timed out`，经本机代理 200 且推送成功 |
| D2 | 本机 Node | **升 22.22.3** | ✅ 宿主侧 `fnm install 22.22.3` + `fnm default 22.22.3`（默认目录 `~/.local/share/fnm`）→ `fnm list` = `* v22.22.3 default`、`fnm exec --using=default node -v` = v22.22.3、`npm -v` = 10.9.8、`aliases/default` 已建立 |
| D3 | `Scene` 死模型 | **删** | ✅ `shared/types/novel.ts` 的 `Scene` 接口 + 「未接线声明」JSDoc 一并移除（原 :309-326）；全仓零引用 |
| D4 | `memory/` 入库 | A/B | **A 已生效**（`ea50b45`，2026-09-28 拍板 A：承认入库并改正声明）；B 被否（blob 已在历史，彻底移除需重写 156 个提交哈希）→ 本轮仅复核确认，仓内无改动 |

## D2 取证（本机 Node 22.22.3）

- 升级前：`fnm list` = v20.19.0 / v20.20.2 / v22.22.0(default) / v22.22.1 / system；`~/.local/share/fnm/node-versions` 无 v22.22.3；`which node` 命中 harness 的 v24.17.0（本会话工具环境，与自声明无关）。
- 命令与读数（宿主侧）：`fnm install 22.22.3` → `Installing Node v22.22.3 (arm64)`，exit 0；`~/.local/share/fnm/node-versions/v22.22.3/installation/bin/node -v` = v22.22.3；`fnm default 22.22.3` → `fnm list` 标 `* v22.22.3 default`；`fnm exec --using=default node -v` = v22.22.3；`fnm exec --using=default npm -v` = 10.9.8。
- 与自声明对齐：`.nvmrc` / `.node-version` = `22.22.3`、`engines` = `>=22.22.3 <23` → 本机默认 node 首次满足自声明；「npm v12.0.2 does not support Node.js v22.22.0（每条命令第一行）」告警随之消失。
- 与既有登记的关系：Plan 263 D2 / Plan 264 P6 记的「沙箱写 `~/.local/share/fnm` 被 EPERM」只在沙箱会话成立——宿主侧可直接写默认 fnm 目录，故不再需要 `FNM_DIR=$HOME/.inkflow/fnm` 旁路（旁路仍可用，未被删除）。

## D3 取证（Scene 删除）

- 删除前全仓 word-boundary 正则 `(?<![A-Za-z_$])Scene(?![A-Za-z_$])` 命中：声明本身 1 处（`shared/types/novel.ts:313 export interface Scene {`）+ 文案 7 处（`server/lib/config.ts:140`「Scene Beats」、`server/helpers/prompt-guard.ts:39`「Scene Contract」、`shared/config/souls.ts:13`、`src/lib/agents.ts:205`、`tests/user-flows-integration.test.ts:191`、`tests/orchestrate-writer-contract.test.ts:21,74`）→ 无 import、无 `: Scene` / `Scene[]` 使用，无 `scenes` 表（`CREATE TABLE IF NOT EXISTS scenes` 0 命中）。
- 删除内容：`/** 未接线声明… */` 三行 JSDoc + `export interface Scene { … }`（13 个字段）共 18 行。
- 账本同步（同一提交）：`docs/architecture/remediation-plan.md`（F7 行：~~已定性~~ → **已删除**）、`docs/architecture/architecture-review.md`（F7 行 + 九项账 F6/F9 措辞）、`docs/architecture/inkflow.evidence.md`（F7 行）、`plans/263-closeout-and-truth-up.md:118`（D7 行：原「已拍板（留）」→「已拍板（删）」）、`plans/270-link-config-model-tuning.md`（已知缺口列表去掉该条）。

## D1 / D4 取证

- D1：仓库级 `git config --local --get http.proxy` 为空（保持）；现有 git 配置仅 `url.https://github.com/.insteadof git://github.com/`、`http.postbuffer`、`http.lowspeedlimit/time`、`http.version`（均与代理无关）。
- D4：`plans/README.md:670`（Round 46 收尾行）已记「**D3-A** `memory/` 入库声明改正（拍板 A，`ea50b45`）」；`MEMORY.md:20-22` 记「已决（拍板 A：承认入库）」+ B 被否的理由；`git ls-files memory MEMORY.md TOOLS.md` = 4 个文件均已被追踪 → 与声明一致，无残留矛盾。

## 门禁

- 命令：`fnm` 直调的 node 22.22.3 下跑 `node_modules/typescript/bin/tsc --noEmit` → `node_modules/eslint/bin/eslint.js server src shared tests scripts --max-warnings=0` → 定向 `node --test`（`tests/node-version-declaration.test.ts` + `tests/llm-stream-holdback.test.ts` + `tests/draft-quality.test.ts`）。脚本 `/tmp/p274-gates.sh`，日志 `/tmp/p274-gates.log` / `/tmp/p274-tsc.log` / `/tmp/p274-lint.log` / `/tmp/p274-tests.log`。
- 读数：tsc 0（`TSC_EXIT=0`）/ eslint 0（`LINT_EXIT=0`）/ 定向 3 文件 **48 tests / 48 pass / 0 fail**（`TEST_EXIT=0`，1177 ms）——`tests/node-version-declaration.test.ts` + `tests/llm-stream-holdback.test.ts` + `tests/draft-quality.test.ts`（含 Plan 266 fix 3 回归与 Plan 273 holdback 5 例）

## 残余

- R-274-1：`Scene` 删除不可从仓内回捞，需要时从 git 历史取（删除提交的前一版）。
- R-274-2：`memory/` 若将来改主意走 B，唯一彻底做法仍是重写历史（代价同 D4 记录）。
- R-274-3：`FNM_DIR=$HOME/.inkflow/fnm` 旁路仍保留（仓库脚本与 runbook 里仍以它固定 22.22.3），未切换到默认目录——两者都指向 v22.22.3，无行为差异。
