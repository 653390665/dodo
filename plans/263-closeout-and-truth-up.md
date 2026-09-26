# Plan 263：收口与真实化 —— 262 剩余批次 + 遗留拍板

- 状态：TODO（首项 E6 在飞）
- 立项：2026-09-28（Round 46 续；直接承接 Plan 262 批次 D/E 剩余）
- 前置：Plan 262 A/B/C 全部交付（A `9a2c234`、B1 `c839f32`、B2/B3、C1–C5 `d532881`、D2 `3f66f3f`）；E6 工具就绪、未提交
- 规格承载：`docs/specs/capability-flow-graph-consolidation.md`（各节「残余」为验收回写点）、`docs/specs/capability-sanitize.md`、`docs/research/activation-funnel-runbook.md`
- 背景（为什么有这本）：会话诊断出的根因是「账实分离」——文档/账本被当权威却不对账。本计划把「每次交付必须回写账本」从纪律升级为可验收条目（P1 整段）。
- 完成定义（每条统一，沿用 262）：实现落盘 → 定向测试 + `npx tsc --noEmit` + `npx eslint server src shared tests scripts --max-warnings=0` 全绿 → 快照六场景逐项不变（`scratch/stageprompts-snapshot.ts`；有意改提示词须记录前后值）→ 规格/账本回写 → 单独提交 → 本账本状态更新
- 纪律（源自本轮实测教训）：后端全量与前端全量**不得并发**（并发必出 45s 超时假阳：7 文件 `testTimeoutFailure`，单独重跑 70/70）；dsh 只发单行命令，多行逻辑走 staging 工具

## P0 在飞（先收尾）

| # | 项 | 现状 | 完成判据 |
|---|---|---|---|
| 0 | E6 门禁 + 提交 | 工作区 6 项：M `server/lib/db/product-events.ts`、M `plans/262-capability-flow-graph-closeout.md`、M `plans/README.md`、?? `scripts/report-activation-funnel.ts`、?? `tests/activation-funnel-report.test.ts`、?? `docs/research/activation-funnel-runbook.md` | tsc/eslint 0 + `tests/activation-funnel-report.test.ts` 4/4 → 提交 → 工作区 clean |
| 1 | E1 push | 本地领先 `origin/codex/plan169-checkpoint` 134 提交；`gh auth status` = `X Failed to log in to github.com account 653390665 (default)` / token invalid | **需用户**终端执行 `gh auth login -h github.com` → 我方 `git push` → ahead=0 |

## P1 账本对账（「账实分离」直接处置）

| # | 项 | 现状 | 完成判据 |
|---|---|---|---|
| 2 | 262 批次 A 行回填 | `plans/262-capability-flow-graph-closeout.md:14` A1 仍 `IN PROGRESS`、`:15` A2 仍 `TODO`；实际 A1 已提交 `9a2c234`、A2 规格 `docs/specs/creation-entry-convergence.md:4` 已改「已交付（2026-09-28 复核…）」 | 两行改 ✅ 并注明提交号/复核日期 |
| 3 | 「需解锁」死面处置 | `getSanitizeRequiredAssets()` 实测 **0 条**（源目录口径同 0：13 张候选或已有副本、或标题判垃圾/重复）→ 货架「需解锁」投影面为死面 | 二选一（**需拍板**）：修准入谓词让候选可见 / 下线该投影面并在规格登记 |
| 4 | 诊断文档时效标注 | `docs/architecture/remediation-plan.md` M1（lint 门）与 M5 第 1 步（竞品词表）描述的缺口已在代码里修掉（`package.json` lint 脚本 + `eslint.config.mjs:16` 忽略 `.tdai`；`shared/lib/prompt-sanitizer.ts:152` 已含词表替换）；`docs/architecture/architecture-review.md` 取证停 2026-09-18 / `84fb175` | 两份文档加复核日期，或把已完成项标 DONE |

## P2 批次 D 长尾

| # | 项 | 现状 | 完成判据 |
|---|---|---|---|
| 5 | D1 仅引导步骤补正文 | 34 步 / 可运行 21（61.8%）/ 仅引导 13：番茄 4（step2/3 已挂 cardRef 但 assetId 仍是壳、step4/5）、风华 4（step1/2/3/5）、天马 3（step1/2/4）、小飞鸡 1（step1）、拆书 1（step2） | 补正文步骤的 assetId 指向 runtime-ready 资产（卡正文可进对应阶段 prompt）；达 80% 需再补 7 步 → 26/34 可运行；`scratch/capB-chain.ts` 缺口表刷新 |
| 6 | D3 章节回滚 stale 打标 | 只覆盖删除路径；回退未定义「回到哪个来源版本」 | **需拍板语义**后实现：回退目标来源明确 + stale 打标 + 测试 |
| 7 | D4 记忆健康度补完 | 只做驾驶舱（无状态栏形态）；无阈值/告警；RAG 命中现算不缓存；孤立节点只看 `entity_relationships` | **需拍板阈值口径**后：阈值单源 + 告警形态 + 缓存策略 + 孤立节点并入口径 |
| 8 | D5 长篇记忆基线补完 | 样本为确定性合成长书；回声口径「token 是否进请求」；planner/critic 未纳入；未接 CI | 建议**降级为技术债**登记（不做或并入其它项）——拍板 |
| 9 | D6 三字段 UI 写入口 | `projectCards`/`chapterCards`/`singleRunCard` 只能经 profile 写入（接线已生效，用户点不到） | 建议**标记为内部并从 UI 概念移除**（承接 262 建议②）——拍板 |

## P3 批次 E 拍板（跨会话遗留）

| # | 项 | 选项（需拍板） |
|---|---|---|
| 10 | E2 打包态嵌入模型路径 | ① 随包附权重（包体积 +）② 首启联网下载（离线首启失败）；现状 `server/embedding.ts` 用 transformers.js 默认缓存 |
| 11 | E3 Node/npm 版本 | 升 Node 至 `^22.22.2`（或降 npm 到 11）+ `engines` + `.nvmrc`；现状 npm v12.0.2 不支持 Node 22.22.0 |
| 12 | E4 会话隔离 | ① 立规范（worktree 多 Agent 并发）② 维持现状（每单元提交 + 提交前清点） |
| 13 | E5 双账本 | 冻结 `docs/plans/README.md`（能力卡轮账本，只读）+ 根账本加指针；现状 `MEMORY.md` 指针已改根账本，从属关系未定 |
| 14 | E7 架构图集漂移 | 补 `knowledge-lineage`（Plan 261）与能力链路（Plan 262）章节；图集取证停 2026-09-18 / `84fb175`，`docs/architecture-map.md` 已刷计数 |

## 拍板清单（需要操作者）

1. 「需解锁」死面：修谓词 or 下线投影？（#3）
2. D3 回滚语义：回到哪个来源版本？（#6）
3. D4 阈值口径：低于多少算「记忆不健康」？（#7）
4. D5 / D6：接受「降级为技术债 / 标为内部」？（#8、#9）
5. E2 / E3 / E4 / E5 / E7 各自选项（#10–#14）
6. E1：终端 `gh auth login -h github.com`（唯一阻塞在用户的操作动作）

## 验收门禁（统一）

- 改 `server/`、`shared/` → `npm test`（定向 `node --test --import tsx tests/<file>`）
- 改 `src/` → `npm run test:frontend -- src/tests/<file>`（全量 `npm run test:frontend`）
- 改 `shared/` 共享契约 → 两端都跑
- 提交前：`npx tsc --noEmit` + `npx eslint server src shared tests scripts --max-warnings=0`
- UI 主链路 → `npx playwright test`；快照 → `npx tsx scratch/stageprompts-snapshot.ts`（六场景）
