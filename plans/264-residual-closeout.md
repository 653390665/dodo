# Plan 264：残余项收口 —— 外部依赖项的取证、可执行化与决策规则（不含打包）

- 状态：✅ 已完成（2026-09-28 终态：P1/P2/P3/P4/P6/P7 已交付并复核；**仅 P5（E6 激活漏斗复测）待真实用户数据**）。P7 远端复核：`git ls-remote origin` 返回 `f9b2065f8a1a0e1901738af8d3be85613b02f2cc` 同时命中 `refs/heads/main` 与 `refs/heads/codex/plan169-checkpoint`，与本地 tip 一致 → **推送已成功**，`origin/…..HEAD` = 0。
- 立项：2026-09-28（Round 46 续；直接承接 `plans/263-closeout-and-truth-up.md` 的「未关闭」清单与 `docs/architecture/remediation-plan.md` 的 F9 行）
- 前置：Plan 263 全部可解项已交付（`plans/263-closeout-and-truth-up.md:3` 状态行）；HEAD 立项时 `9d0650c`，本地领先 `origin/codex/plan169-checkpoint` 164 提交（补：2026-09-28 仓库已迁移至 `~/workspace/dodo-inkflow`；旧路径 `~/Documents-local/dodo-inkflow` 留有 `REPO_MOVED_README.md` 路牌，为冷存档勿动）
- 非目标（本轮明确不做）：打包/发布链相关 —— M6 打包态真机验证、Hub 权重拉取链路。用户指令：2026-09-28「M6 打包态真机验证：需联网拉 Electron 头，先不做。目前不考虑打包的事」
- 背景（为什么有这本）：263 收尾后，剩余项全部是「外部依赖」或「待数据」——不是没人做，而是**没人能现在做**。本计划的职责是把它们从「待办一句话」变成**可机械判定的触发条件 + 可直接复跑的证据入口**，并把其中已可取证的两项（D8、E1 前置）当场做完。
- 完成定义（每条统一）：证据可复跑（命令 + 读数落账本）→ `npx tsc --noEmit` 0 + `npx eslint server src shared tests scripts --max-warnings=0` 0 → 账本回写 → 单独提交
- 纪律（沿用 263 实测教训）：后端全量与前端全量**不得并发**（并发必出 45s 超时假阳）；一个单元一提交；dsh 只发单行 ASCII 命令（多行/非 ASCII 会静默挂 300s）

## 执行表

| # | 项 | 现状（证据） | 本轮动作 | 完成判据 | 状态 |
|---|---|---|---|---|---|
| P1 | D8 vitest dev 漏洞复核 | 06:26 实测 `npm audit --json`（964 依：prod 366 / dev 463 / optional 166 / peer 23）= **0 漏洞**（info/low/moderate/high/critical 全 0），`AUDIT_EXIT=0`；→ MEMORY.md:14 与 `plans/README.md:579`（Plan 255 行）登记的「3 条 moderate dev 漏洞待 --force 升级」已不再存在 | 销账：MEMORY.md:14 + `plans/README.md:579` + 本计划登记 | 三处声明一致且附读数 | ✅ 已完成（2026-09-28） |
| P2 | E1 push 前置（密钥体检） | 待推 164 提交 / 70916 diff 行；`gh auth status` = `X Failed to log in …` / token invalid | 模式扫描（sk-/ghp_/AKIA/xoxb-/Bearer/apiKey/API_KEY/secret/password/token）+ 文件名扫描（.env/.pem/.key/secure-key/credential）逐条定性 | 结论：「无真实凭证」或列出需处置项 | ✅ 已完成（2026-09-28） |
| P3 | F9 `vector_chunks` 扫描决策 | `server/vector-store.ts:100-148` 单作品 `WHERE novel_id = ?` 取全量后逐行 `JSON.parse` + `cosineSimilarity`；`:116-118` ≥1000 块记一次日志（Plan 184 调查埋点）；真实分布未得（本机 8 部作品为狗粮） | 合成成本基线（512 维 × {1000, 5000, 20000} 块，分解 parse / 余弦）；给出「何时必须上 ANN」的机械阈值 | 读数 + 阈值写入 `remediation-plan.md:167` | ✅ 已完成（2026-09-28） |
| P4 | D5 长篇记忆基线 | 技术债（合成长书样本、回声口径=token 是否进请求、planner/critic 未纳入、未接 CI）；脚本 `scripts/long-memory-baseline.ts` 随仓库 | 触发条件可判定化（章节数/字数阈值）并登记 | 触发线写入账本 | ✅ 已完成（2026-09-28） ；**触发线（可判定）**：任一作品 ≥ 30 万字（含）或 ≥ 100 章（含）时复跑 `scripts/long-memory-baseline.ts` 并把读数回写本表 |
| P5 | E6 激活漏斗复测 | 工具就绪（`scripts/report-activation-funnel.ts` + `docs/research/activation-funnel-runbook.md`）；实测端口 3000 无 server → 无新数据可读 | 待真实数据；触发即跑 runbook 三步命令 | 触发条件 + 命令在 runbook | 待触发（外部） |
| P6 | D2 本机 Node 升 22.22.3 | ✅ **已解决（FNM_DIR 旁路，2026-09-28）**：沙箱不能写 fnm 默认目录 → `FNM_DIR=$HOME/.inkflow/fnm fnm install 22.22.3` 安装成功；`fnm exec --using=22.22.3 -- node -v` = v22.22.3；`tests/node-version-declaration.test.ts` 在 22.22.3 下 2/2 全绿。运维入口：`export FNM_DIR=$HOME/.inkflow/fnm` 后正常使用 fnm | — | 完成判据已达成 | ✅ 已完成 |
| P7 | E1 push 本体 | ✅ **已完成并远端复核（2026-09-28）**：分支推送 `44e5f07..053d1b4`（另一会话终端执行）；本轮 `GIT_TERMINAL_PROMPT=0 git ls-remote origin main codex/plan169-checkpoint` = `f9b2065f8a1a0e1901738af8d3be85613b02f2cc` 两 ref 均命中（`LSR_EXIT=0`），与本地 `HEAD`/`origin/main`/`origin/codex/plan169-checkpoint` 同为 `f9b2065` → `git rev-list --count origin/codex/plan169-checkpoint..HEAD` = **0** | 远端核验（ls-remote） | 完成判据已达成 | ✅ 已完成 |

## 登记（不需动作，仅口径）

- M6 打包态真机验证：**本轮排除**（用户 2026-09-28 指令）；`docs/architecture/remediation-plan.md` 的 M6 状态块保留，不新增动作。
- 发布链 Hub 依赖（E2 残余①）：随打包一并搁置；权重已仓内随包（`ff23ab9`），但 CI 冷启动仍会命中 `huggingface.co` 之外的路径 —— 关闭条件=恢复打包工作时一并验证。
- P3 的读数性质：**合成基线**（随机向量），只给量级与阈值，不替代真实分布；真实分布到手后用 `server/vector-store.ts:116` 日志（`chunks` 字段）统计分位数。


### 路径与合并（2026-09-28）

- **仓库迁移**：`~/Documents-local/dodo-inkflow` → `~/workspace/dodo-inkflow`（`~/Documents*` 被 macOS TCC 拦，`~/workspace` 可读可写）；旧路径仅留 `REPO_MOVED_README.md` 路牌 + 712 个 dataless 占位符，**冷存档勿动**。
- **历史谱系合并**：`f9b2065`（merge：整合 `origin/main` 历史谱系 Plans 129-132）——`git diff --stat 32cfc9a..f9b2065` 为空，即 **零内容差异、仅并历史**（合并前分支 tip `32cfc9a` = `053d1b4` + P6/P7 文档行）。
- **Node 22.22.3 旁路**：`FNM_DIR=$HOME/.inkflow/fnm fnm install 22.22.3` → `FNM_DIR=$HOME/.inkflow/fnm fnm exec --using=22.22.3 -- node -v` = `v22.22.3`（本轮独立复核）；`~/.inkflow/fnm/node-versions` 下可见 `v22.22.3`。
- **凭据诊断**：`gh auth status` 在 Desktop 宿主内报 token invalid（宿主进程读不到登录钥匙串），但仓库可正常 `git ls-remote`；如需 DSH 侧主动 push，用 `gh auth login --insecure-storage -h github.com`（明文 `~/.config/gh/hosts.yml`）绕开钥匙串。
## 执行记录

| 项 | 动作 | 证据 |
|---|---|---|
| P1 | `npm audit --json` → 0 漏洞（964 依赖） | `/tmp/audit-dev.json`（首次读数 JSON 内含 npm 告警首行，解析失败→重跑）；`/tmp/audit-full.json` + `/tmp/audit-exit.txt`（`AUDIT_EXIT=0`） |
| P2 | diff 模式扫描 + 文件名扫描 | 脚本两枚（模式上下文 / 文件名）；结论：26 条模式命中全部为文档用词与测试夹具，0 真实凭证（详见下方「P2 结论」） |

### P2 结论（密钥体检，逐条定性）

命中并按类定性的 26 条（RISKY 12 + CTX 14）全部为假阳：

- `Bearer`：`docs/architecture-map.md`（mermaid 图注「helmet / Bearer 认证」）、`docs/research/activation-funnel-runbook.md` 与 `scripts/report-activation-funnel.ts`（`-H "Authorization: Bearer $TOKEN"` **占位符**）
- `sk-`：`plans/255-log-repo-hygiene.md`（脱敏正则 `/(sk-[A-Za-z0-9_-]{8,}|…)/g` **模式本身**）、`plans/README.md`（中文词「风险」被 `-` 后接中文的行内子串命中）、`src/tests/accepted-skill-loadout.test.tsx`（夹具 id `'sk-1'`）
- `ghp_`：`plans/263-closeout-and-truth-up.md`（密钥扫描结论句内列举模式名 `sk-*/ghp_*`）
- `apiKey`/`API_KEY`/`secret`/`token`：测试夹具与配置常量（`'lb-key'` / `'test-key'` / `'semantic-recall-key'` / `'disconnect-stuck-running-key'`）、`build/embedding-model/…/tokenizer.json` 的 token 词条 `"secret": 11634`、`electron.cjs` 的 env 键名 `INKFLOW_SECURE_API_KEY`（键名非值）
- 文件名扫描（`.env` / `.pem` / `.key` / `secure-key` / `credential` / `id_rsa` / `.p12`）：**0 命中**


### P3 读数（2026-09-28 合成基线，median of 3）

口径：`darwin/arm64` / `node v22.22.0` / 512 维 / `:memory:` SQLite（`better-sqlite3`）/ 每档 3 轮取中位数；脚本 `/tmp/plan264-vector-db-bench2.mjs`（一次性，未入库）。拆成三段：`select`（行物化）→ `JSON.parse`（反序列化）→ 余弦。

| 单作品 chunks | select | JSON.parse | 冷路径合计 | 暖路径（缓存命中） |
|---|---|---|---|---|
| 1000 | 22.0 ms | 220.4 ms | 250.4 ms | 30.0 ms |
| 5000 | 195.9 ms | 1089.9 ms | 1325.2 ms | 219.6 ms |
| 20000 | 1085.3 ms | 5454.3 ms | 7533.2 ms | 1160.9 ms |

- 余弦本身不是瓶颈（1000→20000 块仅 7–58 ms）；瓶颈是 **JSON 文本反序列化**（冷路径 ~88%）与 **行物化**（每次全量 `SELECT … WHERE novel_id = ?`，暖路径主项）。
- **机械阈值**：≥ 5000 块时暖路径 ~0.22 s（每次检索都付，已影响交互）→ 优先改存储格式（`embedding` 由 JSON TEXT 改 BLOB/float32，2 KB vs ~10 KB，零拷贝），而非直接上 ANN；≥ 20000 块（冷 7.5 s / 暖 1.2 s）为必须动工线。
- 真实分布仍缺：用 `server/vector-store.ts:116-118` 的 `chunks` 字段（≥1000 块每作品记一次）统计分位数后定行期；本基线是量级与拆项结论，不得当生产读数引用。

### P2 复核补充（2026-09-28）

- 文件名扫描另含 `id_rsa` / `.p12`：0 命中（已并入 P2 结论）。
- 待推提交数：164（`git rev-list --count origin/codex/plan169-checkpoint..HEAD`），diff 70916 行。

### Round 47 登记

- 本计划已登记入 `plans/README.md` Round 47；残余项（E1 push / D2 Node / E6 真实数据）保持本表口径。