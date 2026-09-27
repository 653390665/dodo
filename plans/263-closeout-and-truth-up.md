# Plan 263：收口与真实化 —— 262 剩余批次 + 遗留拍板

- 状态：执行中（P0 E6 ✅ `78e77e5`；P1 对账 ✅ `836cf19`；E3/E4/E5 ✅ `86ebb62`；D3 ✅；余 D1、D4、E2、E7、E1（需用户））
- 立项：2026-09-28（Round 46 续；直接承接 Plan 262 批次 D/E 剩余）
- 前置：Plan 262 A/B/C 全部交付（A `9a2c234`、B1 `c839f32`、B2/B3、C1–C5 `d532881`、D2 `3f66f3f`）；E6 工具就绪、未提交
- 规格承载：`docs/specs/capability-flow-graph-consolidation.md`（各节「残余」为验收回写点）、`docs/specs/capability-sanitize.md`、`docs/research/activation-funnel-runbook.md`
- 背景（为什么有这本）：会话诊断出的根因是「账实分离」——文档/账本被当权威却不对账。本计划把「每次交付必须回写账本」从纪律升级为可验收条目（P1 整段）。
- 完成定义（每条统一，沿用 262）：实现落盘 → 定向测试 + `npx tsc --noEmit` + `npx eslint server src shared tests scripts --max-warnings=0` 全绿 → 快照六场景逐项不变（`scratch/stageprompts-snapshot.ts`；有意改提示词须记录前后值）→ 规格/账本回写 → 单独提交 → 本账本状态更新
- 纪律（源自本轮实测教训）：后端全量与前端全量**不得并发**（并发必出 45s 超时假阳：7 文件 `testTimeoutFailure`，单独重跑 70/70）；dsh 只发单行命令，多行逻辑走 staging 工具

## P0 在飞（先收尾）

| # | 项 | 现状 | 完成判据 |
|---|---|---|---|
| 0 | E6 门禁 + 提交 | 工作区 6 项：M `server/lib/db/product-events.ts`、M `plans/262-capability-flow-graph-closeout.md`、M `plans/README.md`、?? `scripts/report-activation-funnel.ts`、?? `tests/activation-funnel-report.test.ts`、?? `docs/research/activation-funnel-runbook.md` | tsc/eslint 0 + `tests/activation-funnel-report.test.ts` 4/4 → 提交 → 工作区 clean | ✅ 已完成（提交 `78e77e5`，4 files / +360；tsc 0 / eslint 0 / 测试 4/4）
| 1 | E1 push | 本地领先 `origin/codex/plan169-checkpoint` 134 提交；`gh auth status` = `X Failed to log in to github.com account 653390665 (default)` / token invalid | **需用户**终端执行 `gh auth login -h github.com` → 我方 `git push` → ahead=0 |

## P1 账本对账（「账实分离」直接处置）

| # | 项 | 现状 | 完成判据 |
|---|---|---|---|
| 2 | 262 批次 A 行回填 | `plans/262-capability-flow-graph-closeout.md:14` A1 原为 `IN PROGRESS`、`:15` A2 原为 `TODO`（实际 A1 = `645c572`，A2 = 规格 `docs/specs/creation-entry-convergence.md:4` 已标已交付） | 两行改 ✅ 并注明提交号/复核日期 | ✅ 已完成（2026-09-28 对账回填） |
| 3 | 「需解锁」契约面结案 | `getSanitizeRequiredAssets()` 实测 **0 条**，原判为「死面」 | 二选一（原需拍板） | ✅ 已结案非缺陷（2026-09-28）：空分组不渲染 `SkillsStudioView.tsx:3231`；契约保留 `src/tests/skills-studio-plan158.test.tsx:1856`；262/README/规格措辞已改为「恒为 0 的契约面」 |
| 4 | 诊断文档时效标注 | `docs/architecture/remediation-plan.md` M1（lint 门）与 M5 第 1 步（竞品词表）描述的缺口已在代码里修掉（`package.json` lint 脚本 + `eslint.config.mjs:16` 忽略 `.tdai`；`shared/lib/prompt-sanitizer.ts:152` 已含词表替换）；`docs/architecture/architecture-review.md` 取证停 2026-09-18 / `84fb175` | 两份文档加复核日期，或把已完成项标 DONE | ✅ 已完成（`remediation-plan.md` 头部已有 2026-09-28 复核表；本次补 `architecture-review.md` 复核块）

## P2 批次 D 长尾

| # | 项 | 现状 | 完成判据 |
|---|---|---|---|
| 5 | D1 仅引导步骤补正文 | 34 步 / 可运行 21（61.8%）/ 仅引导 13：番茄 4（step2/3 已挂 cardRef 但 assetId 仍是壳、step4/5）、风华 4（step1/2/3/5）、天马 3（step1/2/4）、小飞鸡 1（step1）、拆书 1（step2） | 补正文步骤的 assetId 指向 runtime-ready 资产（卡正文可进对应阶段 prompt）；达 80% 需再补 7 步 → 26/34 可运行；`scratch/capB-chain.ts` 缺口表刷新 |
| 6 | D3 章节回滚 stale 打标 | 只覆盖删除路径；回退未定义「回到哪个来源版本」 | ✅ 已完成（2026-09-28）：按拍板不引入 source 枚举 —— `chapter_versions.content_hash`（迁移 `ensureColumn`）+ 两条写入路径补指纹 + `listChapterVersionMetas.matchesCurrentContent`（hash 不等判 stale；存量 NULL → 「来源未知」）+ 时光机卡片徽标；后端 `tests/chapter-version-content-hash.test.ts` 5/5、前端 `src/tests/agent-workspace-versions-panel.test.tsx` 3/3 |
| 7 | D4 记忆健康度补完 | 只做驾驶舱（无状态栏形态）；无阈值/告警；RAG 命中现算不缓存；孤立节点只看 `entity_relationships` | **需拍板阈值口径**后：阈值单源 + 告警形态 + 缓存策略 + 孤立节点并入口径 |
| 8 | D5 长篇记忆基线补完 | 样本为确定性合成长书；回声口径「token 是否进请求」；planner/critic 未纳入；未接 CI | 建议**降级为技术债**登记（不做或并入其它项）——拍板 |
| 9 | D6 三字段 UI 写入口 | `projectCards`/`chapterCards`/`singleRunCard` 只能经 profile 写入（接线已生效，用户点不到） | 建议**标记为内部并从 UI 概念移除**（承接 262 建议②）——拍板 |

## P3 批次 E 拍板（跨会话遗留）

| # | 项 | 选项（需拍板） |
|---|---|---|
| 10 | E2 打包态嵌入模型路径 | ① 随包附权重（包体积 +）② 首启联网下载（离线首启失败）；现状 `server/embedding.ts` 用 transformers.js 默认缓存 |
| 11 | E3 Node/npm 版本 | 升 Node 至 `^22.22.2`（或降 npm 到 11）+ `engines` + `.nvmrc`；现状 npm v12.0.2 不支持 Node 22.22.0  | ✅ 已完成（2026-09-28：`.nvmrc`/`.node-version` = `22.22.3`、`engines` = `>=22.22.3 <23`、CI 四处 `node-version-file: .nvmrc`、守卫测试 `tests/node-version-declaration.test.ts` 2/2）
| 12 | E4 会话隔离 | ① 立规范（worktree 多 Agent 并发）② 维持现状（每单元提交 + 提交前清点）  | ✅ 已完成（2026-09-28：两条硬规则并入 `docs/specs/multi-agent-workflow.md` 并发隔离节 —— 单 checkout 串行写入 / 工作单元边界）
| 13 | E5 双账本 | 冻结 `docs/plans/README.md`（能力卡轮账本，只读）+ 根账本加指针；现状 `MEMORY.md` 指针已改根账本，从属关系未定  | ✅ 已完成（2026-09-28：`docs/plans/README.md` 顶部冻结横幅 + 根账本「唯一权威」指针 + 262 双账本项结案）
| 14 | E7 架构图集漂移 | 补 `knowledge-lineage`（Plan 261）与能力链路（Plan 262）章节；图集取证停 2026-09-18 / `84fb175`，`docs/architecture-map.md` 已刷计数 |

## 拍板清单（需要操作者）

1. ~~「需解锁」死面~~ → 已结案为非缺陷（#3，2026-09-28）
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

## 拍板结论（2026-09-28，操作者「做吧」批准）

| 项 | 决定 | 落地动作 |
|---|---|---|
| #3 需解锁死面 | **非缺陷结案** | 代码零改动（`SkillsStudioView.tsx:3231` 空分组不渲染；`skills-studio-plan158.test.tsx:1856` 已声明契约保留）；把 262/README 的「死面」措辞改为「恒为 0 的契约面」 |
| D3 章节回滚 stale | **不引入 source 枚举** | `chapter_versions` 加 `content_hash` 列；stale = 版本 hash ≠ 当前正文 hash；存量行 hash 空 → 显示「未知」 |
| D4 记忆健康阈值 | **只设 1 条硬阈值** | `arrears > MAX_ARREARS_IN_PROMPT (12)` ⇒ 琥珀；其余指标只显示数值 + `unknown` 降级；整体阈值口径挂 E6 真实数据 |
| D5 长篇记忆基线 | **降级为技术债** | 只登记；触发条件 = 真实长篇样本到手后重跑 |
| D6 三字段 UI 入口 | **标为内部** | 规格标 internal + 从 UI 概念移除（不做写入口） |
| E2 嵌入模型 | **①随包附权重** | 打包态缓存目录指向 app resources；模型 id 与 `dtype: q8` 不得改（`vector_chunks` 按 modelId 匹配） |
| E3 Node/npm 版本 | **升 22.22.x 支线 + 单源** | 已落地（细化：pin 与 floor 同取 22.22.x 支线最新补丁 **22.22.3** —— nodejs.org dist index 2026-09-28 实测 22.22.0/.1/.2/.3 均存在；`engines` = `>=22.22.3 <23`；CI 四处改 `node-version-file: .nvmrc`） |
| E4 会话隔离 | **不新增规范文档** | 两条硬规则并入 `docs/specs/multi-agent-workflow.md`（同文件禁并发改 / 每单元必须提交） |
| E5 双账本 | **冻结旧账本** | `docs/plans/README.md` 标只读存档 + 指向根 `plans/README.md` |
| E7 架构图集 | **补两节 + 复核日期** | `docs/architecture/` 补「知识谱系」「能力链路/能力引用」两节 |
| E1 push | 阻塞在用户 | 终端 `gh auth login -h github.com` → 我方 `git push` |

## 执行记录（2026-09-28）

| 单元 | 提交 | 内容 |
|---|---|---|
| E6 收尾 | `78e77e5` | 激活漏斗离线复测工具（4 files，+360）；tsc/eslint 0、测试 4/4 |
| 对账 #2/#3/#4 | `836cf19` | 262 批次 A 行回填、需解锁契约面结案、`architecture-review.md` 复核块（5 files，+37/−14） |
| E3/E4/E5 | 本次提交 | 版本声明单源（pin `22.22.3` / `engines >=22.22.3 <23` / CI 四处 `node-version-file` / 守卫测试 2 例）、同 checkout 串行写入规则入规格、`docs/plans/README.md` 冻结 + 根账本唯一权威指针 |
| D3 章节版本指纹 | 本次提交 | `chapter_versions.content_hash`（建表 + `ensureColumn` 迁移）、`hashChapterContent`（sha256 原文，不归一化）、两条写入路径（CRUD `insertColumns` + accept 前置快照 raw INSERT）补列、`listChapterVersionMetas` 增 `contentHash`/`matchesCurrentContent`、时光机卡片徽标（＝ 当前正文 / ≠ 不同 / 来源未知）；后端 5/5、前端 3/3、既有夹具补字段；tsc 0 / eslint 0 |
| 纪律修正 | 本次提交 | `AGENTS.md:26` 定向测试命令补 `NODE_ENV=test` + `--import ./tests/helpers/test-db-preload.ts`（漏掉会关掉配额门禁路径 → 假失败，见 D3 收尾取证） |
