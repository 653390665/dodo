# Plan 263：收口与真实化 —— 262 剩余批次 + 遗留拍板

- 状态：执行中（P0 E6 ✅ `78e77e5`；P1 对账 ✅ `836cf19`；E3/E4/E5 ✅ `86ebb62`；D1 ✅ `4b68c24` / D3 ✅ `d342d4a` / D4 ✅ `8a65c49` / D5 ✅（降级技术债，只登记，`e8324d9`）/ D6 ✅（`e8324d9`）/ E7 ✅；E2 ✅（随包附权重）；余 E1（需用户））；R 轮可解决项已收尾：R1 F6 结案 / R2 读数脚本入库 `3214ddf` / R3 权重 sha256 pin（`afbc1ad`）/ F7 `Scene` 标未接线（`e1845ce`）；余下均为需拍板或待真实数据项（见下「需拍板（2026-09-28 R 轮）「）
- 立项：2026-09-28（Round 46 续；直接承接 Plan 262 批次 D/E 剩余）
- 前置：Plan 262 A/B/C 全部交付（A1 `645c572` / A2 `9a2c234`、B1 `acd8dfb`（附带 `c839f32` 消毒缺口收口）、B2/B3、C1–C5 `d532881`、D2 `3f66f3f`）；E6 工具就绪、未提交
- 规格承载：`docs/specs/capability-flow-graph-consolidation.md`（各节「残余」为验收回写点）、`docs/specs/capability-sanitize.md`、`docs/research/activation-funnel-runbook.md`
- 背景（为什么有这本）：会话诊断出的根因是「账实分离」——文档/账本被当权威却不对账。本计划把「每次交付必须回写账本」从纪律升级为可验收条目（P1 整段）。
- 完成定义（每条统一，沿用 262）：实现落盘 → 定向测试 + `npx tsc --noEmit` + `npx eslint server src shared tests scripts --max-warnings=0` 全绿 → 快照六场景逐项不变（`scripts/report-stageprompt-snapshot.ts`；有意改提示词须记录前后值）→ 规格/账本回写 → 单独提交 → 本账本状态更新
- 纪律（源自本轮实测教训）：后端全量与前端全量**不得并发**（并发必出 45s 超时假阳：7 文件 `testTimeoutFailure`，单独重跑 70/70）；dsh 只发单行命令，多行逻辑走 staging 工具

## P0 在飞（先收尾）

| # | 项 | 现状 | 完成判据 |
|---|---|---|---|
| 0 | E6 门禁 + 提交 | 工作区 6 项：M `server/lib/db/product-events.ts`、M `plans/262-capability-flow-graph-closeout.md`、M `plans/README.md`、?? `scripts/report-activation-funnel.ts`、?? `tests/activation-funnel-report.test.ts`、?? `docs/research/activation-funnel-runbook.md` | tsc/eslint 0 + `tests/activation-funnel-report.test.ts` 4/4 → 提交 → 工作区 clean | ✅ 已完成（提交 `78e77e5`，4 files / +360；tsc 0 / eslint 0 / 测试 4/4）
| 1 | E1 push | 本地领先 `origin/codex/plan169-checkpoint` 147 提交（2026-09-28 核对）；`gh auth status` = `X Failed to log in to github.com account 653390665 (default)` / token invalid | **需用户**终端执行 `gh auth login -h github.com` → 我方 `git push` → ahead=0 |

## P1 账本对账（「账实分离」直接处置）

| # | 项 | 现状 | 完成判据 |
|---|---|---|---|
| 2 | 262 批次 A 行回填 | `plans/262-capability-flow-graph-closeout.md:14` A1 原为 `IN PROGRESS`、`:15` A2 原为 `TODO`（实际 A1 = `645c572`，A2 = 规格 `docs/specs/creation-entry-convergence.md:4` 已标已交付） | 两行改 ✅ 并注明提交号/复核日期 | ✅ 已完成（2026-09-28 对账回填） |
| 3 | 「需解锁」契约面结案 | `getSanitizeRequiredAssets()` 实测 **0 条**，原判为「死面」 | 二选一（原需拍板） | ✅ 已结案非缺陷（2026-09-28）：空分组不渲染 `SkillsStudioView.tsx:3231`；契约保留 `src/tests/skills-studio-plan158.test.tsx:1856`；262/README/规格措辞已改为「恒为 0 的契约面」 |
| 4 | 诊断文档时效标注 | `docs/architecture/remediation-plan.md` M1（lint 门）与 M5 第 1 步（竞品词表）描述的缺口已在代码里修掉（`package.json` lint 脚本 + `eslint.config.mjs:16` 忽略 `.tdai`；`shared/lib/prompt-sanitizer.ts:152` 已含词表替换）；`docs/architecture/architecture-review.md` 取证停 2026-09-18 / `84fb175` | 两份文档加复核日期，或把已完成项标 DONE | ✅ 已完成（`remediation-plan.md` 头部已有 2026-09-28 复核表；本次补 `architecture-review.md` 复核块）

## P2 批次 D 长尾

| # | 项 | 现状 | 完成判据 |
|---|---|---|---|
| 5 | D1 仅引导步骤补正文 | 34 步 / 可运行 21（61.8%）/ 仅引导 13：番茄 4（step2/3 已挂 cardRef 但 assetId 仍是壳、step4/5）、风华 4（step1/2/3/5）、天马 3（step1/2/4）、小飞鸡 1（step1）、拆书 1（step2） | 补正文步骤的 assetId 指向 runtime-ready 资产（卡正文可进对应阶段 prompt）；✅ 已完成（2026-09-28）：7 个「无 cardRef 的仅引导步骤」自撰内置卡并改指（番茄 step4/5、风华 step2/3/5、天马 step1/2）→ **可运行 28/34（82.4%）/ 仅引导 6**；余 6 步为已挂 cardRef 的步骤（卡正文经卡片通道注入，assetId 仍为壳，登记为残余）；`scripts/report-flow-chain-coverage.ts` 已复跑；目录 189 / built-in 27 |
| 6 | D3 章节回滚 stale 打标 | 只覆盖删除路径；回退未定义「回到哪个来源版本」 | ✅ 已完成（2026-09-28）：按拍板不引入 source 枚举 —— `chapter_versions.content_hash`（迁移 `ensureColumn`）+ 两条写入路径补指纹 + `listChapterVersionMetas.matchesCurrentContent`（hash 不等判 stale；存量 NULL → 「来源未知」）+ 时光机卡片徽标；后端 `tests/chapter-version-content-hash.test.ts` 5/5、前端 `src/tests/agent-workspace-versions-panel.test.tsx` 3/3 |
| 7 | D4 记忆健康度补完 | 只做驾驶舱（无状态栏形态）；无阈值/告警；RAG 命中现算不缓存；孤立节点只看 `entity_relationships` | ✅ 已完成（2026-09-28）：按拍板只设一条硬阈值 —— 阈值单源 `MAX_ARREARS_IN_PROMPT`（`shared/lib/knowledge-capabilities.ts`，原为 `server/helpers/knowledge-lineage-enrich.ts:175` 本地常量）+ 新增「伏笔欠账」指标 + 越线 `severity:'warn'`／面板琥珀（`text-amber-700`，与未知 `text-amber-800` 可区分）+ 阈值说明；其余指标只显示数值 + 未知降级；RAG 缓存与孤立节点并入口径未做（挂 E6 真实数据）；后端 6/6、前端 5/5 + 2/2 |
| 8 | D5 长篇记忆基线补完 | 样本为确定性合成长书；回声口径「token 是否进请求」；planner/critic 未纳入；未接 CI | ✅ 已完成（2026-09-28）：按拍板**降级为技术债**，只登记、不补完（真实样本 / planner·critic 口径 / CI 接线均不做）；触发条件 = 真实长篇样本到手后重跑 `scripts/long-memory-baseline.ts` 并复核口径（规格 §5.22 + §5.10 拍板行） |
| 9 | D6 三字段 UI 写入口 | `projectCards`/`chapterCards`/`singleRunCard` 只能经 profile 写入（接线已生效，用户点不到） | ✅ 已完成（2026-09-28）：三字段**标为内部**（只经 profile 写入，不做 UI 写入口）；移除 UI 固定额度文案 —— `src/components/Library.tsx:265` `能力卡 N/3` → `能力卡 N`（规格 §4.2.4 + §5.22）；`src/tests/library-refresh.test.tsx` 同步改断言 |

## P3 批次 E 拍板（跨会话遗留）

| # | 项 | 选项（需拍板） | 结论（2026-09-28） |
|---|---|---|---|
| 10 | E2 打包态嵌入模型路径 | ① 随包附权重（包体积 +）② 首启联网下载（离线首启失败）；现状 `server/embedding.ts` 用 transformers.js 默认缓存 | ✅ 已完成（2026-09-28，`24b14f6`）：拍板①随包附权重落地 —— 取权重脚本 → `build/embedding-model/`（4 文件 23.3 MB）→ `extraResources`；`resolveEmbeddingAssetPaths` 齐备时本地解析并关远程；打包态 `INKFLOW_EMBEDDING_MODEL_DIR` + `INKFLOW_MODEL_CACHE_DIR`（userData/models-cache）；冒烟增 ≥20 MB 权重断言；新测试 9/9、tsc/lint 0；残余 = 打包态真机验证（需联网） |
| 11 | E3 Node/npm 版本 | 升 Node 至 `^22.22.2`（或降 npm 到 11）+ `engines` + `.nvmrc`；现状 npm v12.0.2 不支持 Node 22.22.0  | ✅ 已完成（2026-09-28：`.nvmrc`/`.node-version` = `22.22.3`、`engines` = `>=22.22.3 <23`、CI 四处 `node-version-file: .nvmrc`、守卫测试 `tests/node-version-declaration.test.ts` 2/2）
| 12 | E4 会话隔离 | ① 立规范（worktree 多 Agent 并发）② 维持现状（每单元提交 + 提交前清点）  | ✅ 已完成（2026-09-28：两条硬规则并入 `docs/specs/multi-agent-workflow.md` 并发隔离节 —— 单 checkout 串行写入 / 工作单元边界）
| 13 | E5 双账本 | 冻结 `docs/plans/README.md`（能力卡轮账本，只读）+ 根账本加指针；现状 `MEMORY.md` 指针已改根账本，从属关系未定  | ✅ 已完成（2026-09-28：`docs/plans/README.md` 顶部冻结横幅 + 根账本「唯一权威」指针 + 262 双账本项结案）
| 14 | E7 架构图集漂移 | 补 `knowledge-lineage`（Plan 261）与能力链路（Plan 262）章节； | ✅ 已完成（2026-09-28）：`docs/architecture/inkflow.architecture-understanding.md` 补「十一、知识谱系」「十二、能力链路」两节 + 顶部复核行（2026-09-28 / `4b68c24`）；`docs/architecture/README.md` 加复核声明；顺手修正「未安装 Graphviz」旧述（实际已装、6 张 `.dot` 可渲染）；规格无新增（只动 `docs/architecture/`） |

## 拍板清单（需要操作者）

1. ~~「需解锁」死面~~ → 已结案为非缺陷（#3，2026-09-28）
2. ~~D3 回滚语义：回到哪个来源版本？（#6）~~ → 已拍板并落地：**不引入 source 枚举**，改用「版本 hash ≠ 当前正文 hash」判 stale（`d342d4a`）
3. ~~D4 阈值口径：低于多少算「记忆不健康」？（#7）~~ → 已拍板并落地：**只设 1 条硬阈值**（`arrears > MAX_ARREARS_IN_PROMPT = 12` ⇒ 琥珀），其余指标只显示数值 + 未知降级（`8a65c49`）
4. ~~D5 / D6：接受「降级为技术债 / 标为内部」？（#8、#9）~~ → 已拍板并落地（`e8324d9`）
5. ~~E2 / E3 / E4 / E5 / E7 各自选项（#10–#14）~~ → 均已拍板并落地（E2 ①随包附权重；E3 pin `22.22.3`；E4 两条硬规则入规格；E5 冻结旧账本；E7 架构图集补两节）
6. E1：终端 `gh auth login -h github.com`（唯一阻塞在用户的操作动作）

## 验收门禁（统一）

- 改 `server/`、`shared/` → `npm test`（定向 `node --test --import tsx tests/<file>`）
- 改 `src/` → `npm run test:frontend -- src/tests/<file>`（全量 `npm run test:frontend`）
- 改 `shared/` 共享契约 → 两端都跑
- 提交前：`npx tsc --noEmit` + `npx eslint server src shared tests scripts --max-warnings=0`
- UI 主链路 → `npx playwright test`；快照 → `npx tsx scripts/report-stageprompt-snapshot.ts`（六场景）

## 拍板结论（2026-09-28，操作者「做吧」批准）

| 项 | 决定 | 落地动作 |
|---|---|---|
| #3 需解锁死面 | **非缺陷结案** | 代码零改动（`SkillsStudioView.tsx:3231` 空分组不渲染；`skills-studio-plan158.test.tsx:1856` 已声明契约保留）；把 262/README 的「死面」措辞改为「恒为 0 的契约面」 |
| D3 章节回滚 stale | **不引入 source 枚举** | `chapter_versions` 加 `content_hash` 列；stale = 版本 hash ≠ 当前正文 hash；存量行 hash 空 → 显示「未知」 |
| D4 记忆健康阈值 | **只设 1 条硬阈值** | `arrears > MAX_ARREARS_IN_PROMPT (12)` ⇒ 琥珀；其余指标只显示数值 + `unknown` 降级；整体阈值口径挂 E6 真实数据 |
| D5 长篇记忆基线 | **降级为技术债** | 只登记；触发条件 = 真实长篇样本到手后重跑 |
| D6 三字段 UI 入口 | **标为内部** | 规格标 internal + 从 UI 概念移除（不做写入口） |
| E2 嵌入模型 | **①随包附权重** | **已落地（2026-09-28）**：打包态缓存目录指向 app resources（`INKFLOW_MODEL_CACHE_DIR` = userData/models-cache；权重随包落 `resources/embedding-model/`）；模型 id 与 `dtype: q8` 不得改（`vector_chunks` 按 modelId 匹配） |
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
| E3/E4/E5 | `86ebb62` | 版本声明单源（pin `22.22.3` / `engines >=22.22.3 <23` / CI 四处 `node-version-file` / 守卫测试 2 例）、同 checkout 串行写入规则入规格、`docs/plans/README.md` 冻结 + 根账本唯一权威指针 |
| D3 章节版本指纹 | `d342d4a` | `chapter_versions.content_hash`（建表 + `ensureColumn` 迁移）、`hashChapterContent`（sha256 原文，不归一化）、两条写入路径（CRUD `insertColumns` + accept 前置快照 raw INSERT）补列、`listChapterVersionMetas` 增 `contentHash`/`matchesCurrentContent`、时光机卡片徽标（＝ 当前正文 / ≠ 不同 / 来源未知）；后端 5/5、前端 3/3、既有夹具补字段；tsc 0 / eslint 0 |
| D1 仅引导步骤补正文 | `4b68c24` | 新增 7 张自撰内置卡（`tomato-readthrough-audit` / `tomato-prose-polisher` / `lofter-aesthetic-outliner` / `viral-shortform-titler` / `emotional-logic-auditor` / `viral-idea-refiner` / `setting-rhythm-outliner`），步骤改指 + 删 `guidanceOnly`（不改壳）；读数 34 步 / **可运行 28（82.4%）** / 仅引导 6；目录 189（built-in 20→27）、引用资产 28/189、公开目录 142 + 33；计数断言刷新（flow-step-guidance / catalog-disposition / prompt-assets-governed / planning-tab-step-guidance / capability-shelf）；后端全量 1456/1456、前端全量 161 files·1022 tests、快照六场景不变；tsc 0 / eslint 0 |
| D4 记忆健康度告警阈值 | `8a65c49` | 阈值单源 `MAX_ARREARS_IN_PROMPT = 12`（迁到 `shared/lib/knowledge-capabilities.ts`）；五项指标（新增 `foreshadowArrears`「伏笔欠账」，与 `buildForeshadowSettlementChecklist().arrears` 同源）；`severity:'warn'` + `thresholdNote`，面板 `text-amber-700` + 阈值说明；未摄入仍未知不按 0 计；后端 6/6、前端 5/5 + 2/2、命名对齐「四项→五项」14 处；tsc 0 / eslint 0 |
| E7 架构图集补章 | `d36aaeb` | `docs/architecture/inkflow.architecture-understanding.md` 新增「十一、知识谱系」（资料包 → 伏笔台账/图谱边 → 两条消费路径 → 知识能力端点 → 记忆健康度）与「十二、能力链路」（6 链 34 步 → 三通道 → 装配注入 → 门三类 → 读数 28/34）；两节明标取证日 2026-09-28 / `4b68c24`；文件顶部与 `docs/architecture/README.md` 加复核行；修正「未安装 Graphviz」旧述（本机已装、6 张 `.dot` 已验证可渲染，两张需 `newrank=true`） |
| D5/D6 长尾登记 | `e8324d9` | D5 长篇记忆基线降级为技术债（只登记，触发条件 = 真实长篇样本到手重跑）；D6 三字段标为内部 + 移除 UI 固定额度文案（`src/components/Library.tsx:265` `能力卡 N/3` → `能力卡 N`）；规格 §4.2.4/§5.22 + §5.10 拍板行；`plans/262` D5/D6 行与交付节；`src/tests/library-refresh.test.tsx` 断言同步 |
| E2 打包态嵌入模型路径 | `24b14f6` | 随包附权重：`scripts/lib/embedding-weights.mjs`（模型 id / 4 文件清单 / ≥20 MB 判据 / 校验单源）+ `scripts/fetch-embedding-model.mjs`（来源顺序 `INKFLOW_MODEL_SOURCE_DIR` → 本地 HF 缓存 → Hub；`SKIP_EMBEDDING_MODEL_FETCH=true` 跳过）；`package.json`（`model:fetch` / `package` 链插取权重 / `build.extraResources`）；`server/embedding.ts` `LOCAL_EMBEDDING_MODEL_FILES` + `resolveEmbeddingAssetPaths` + 模块级 env 应用 + 就绪日志三 env；`electron.cjs` 打包态注入两个 env（dev 不注入）；`scripts/check-package-artifacts.mjs` 权重断言；`tests/embedding-model-assets.test.ts` 9/9；取权重 4 文件 23.3 MB（本地缓存）；tsc/lint 0；受影响面 23/23；残余 = 打包态真机验证（需联网） |
| 收尾账本 | `434fb8a` | 拍板清单结案 + 残余登记（xenova 豁免销账 / 适合度『使用反馈』通道未接线 / `plans/237-fitness-honesty.md` 复核）（3 files，+6/−5） |
| 规格账实回填 | `2571783` | `docs/specs/capability-flow-graph-consolidation.md` Status → 「已交付」+ 三处残余补销账指针（4 insertions / 4 deletions） |
| MEMORY 复核证据 | `824981b` | memory/ 入库矛盾补证据（4 文件均被 git 追踪）+ vitest dev 漏洞项标「有网时复核」 |
| 纪律修正 | `d342d4a`（随 D3 提交） | `AGENTS.md:26` 定向测试命令补 `NODE_ENV=test` + `--import ./tests/helpers/test-db-preload.ts`（漏掉会关掉配额门禁路径 → 假失败，见 D3 收尾取证） |
| 审计修正 | `a8e5956` | 账本计数 115/134→147、执行记录 8 行补 hash、表格列数修正、A1/A2 重复 ✅ 、E2 三项残余登记（发布链依赖 Hub / `SKIP_EMBEDDING_MODEL_FETCH` 静默跳过产物断言 / 判据仅尺寸 ≥20 MB 无 sha256）（4 files，+28/−23） |
| 审计修正（二） | `d20093f` | `architecture-review.md` / `remediation-plan.md` 状态块刷新（M2/M6/M7）+ `plans/README.md` 新增「审计基准的可解析性」（第 1–29 轮基准属 2026-08-29 存档重根前历史线，根提交 `68c9004`，见 `docs/recovery/RECOVERY.md`）（3 files，+7/−4） |
| 审计（回答用户「审查已完成/未完成任务清单」） | `695fddb` | 全量后端 `1465/1465` + 全量前端 `161 files / 1022 tests` 全绿；关闭 4 项（前端 2 失败用例 / 性能结论 / F5 三 handler 均为权威写入 / F7 `Scene` 死模型），F6 与 F9 维持开放（前者已定性读层无内容级消毒） |
| 读数脚本入库 | `3214ddf` | 5 个核心读数脚本从 `scratch/`（gitignored）移入 `scripts/`：链路引用面 / 步骤审计 / 角色投影 / 清洗层 / 六场景快照；规格 §7 表格与账本引用同步改名 |
| F6 结案 + E2 加固（R3） | `afbc1ad` | F6 定向追证：`/api/db` 读路径唯一生产消费者 `src/components/AppShell.tsx:1085` 只取 `skillId`/`name`，`Skill.style` 3 处生产命中均为谓词/融合门控而非渲染 → 结案；E2 权重 sha256 pin（`EMBEDDING_MODEL_SHA256` + `hashFileSha256` + `verifyModelDirHashes` + 取权重脚本强校验 + 3 例测试，11/11） |
| R 轮 D3-A `memory/` 入库声明改正 | `ea50b45` | 拍板 A 落地：承认入库并改 `MEMORY.md` 声明（B 案局限见验证节：blob 仍在历史里）；4 文件均被 git 追踪的证据入账 |
| R 轮 D6 冒烟逃生舱改显式开关 | `db474a1` | `scripts/check-package-artifacts.mjs` 不再读 `SKIP_EMBEDDING_MODEL_FETCH`，逃生舱仅认显式 `--allow-missing-weights`（`package.json` 冒烟链路同步）；`tests/embedding-model-assets.test.ts` 11/11、tsc 0 / eslint 0 |
| R 轮 D4 适合度「使用反馈」通道接线 | `e8a7d38` | `observedUsageFeedback`（`shared/lib/skill-model.ts:258-273`，样本量 = `mountedCount`）接进文风货架：`src/lib/capability-shelf.ts` 反馈分支 + `feedbackSampleSize`、`src/components/skills/StyleShelf.tsx` 条件展开 `{ feedbackScore, feedbackSampleSize }`、`src/components/SkillsStudioView.tsx` `feedbackByAssetId`（键 `skill.parentSkillId || skill.id`）；有样本按反馈计分并标注样本量、无样本保持原静态重分配（Plan 150 两通道分开展示约束）；前端定向 3 文件 27 用例（新增 2 例）全绿、tsc 0 / eslint 0 |
| R 轮 D5 离线权重「仓内随包」 | `ff23ab9` | `.gitignore:2` 由 `build/` 拆为 `build/*` + `!build/embedding-model` + `!build/embedding-model/**`；权重 4 文件（23.3 MB，sha256 与 R3 pin 全等）入库 → CI 冷启动取权重命中 cached、不再访问 `huggingface.co`（销账 E2 残余①）；entitlements plist 保持忽略；`rm -rf build/embedding-model` 后 `git checkout -- build/embedding-model` 离线恢复 + 4 文件 sha256 复核 + 取权重 4/4 cached EXIT=0 |
| R 轮 D7 `Scene` 声明收口 | `1d69429` | 核对：全仓 175 条 `Scene` 命中均为文案 / 局部变量 / 邻接类型，无 `: Scene` / `Scene>` / `Scene[]` / import 用法；`scenes` 仅 2 条注释 + JSDoc 自身 → 无表；决策表 D7 行补标「**已拍板（留）**」+ 证据入账 |
| R 轮 R2 读数脚本单源回归修复 | `b009bce` | 全量后端套件（独立复核）抓出 `scripts/report-flow-step-audit.ts:48` 手抄 `sanitizationStatus === 'runtime-ready'` 三元判据（R2 入库 `3214ddf` 后该脚本才进入 `tests/capability-runtime-readiness.test.ts` 的单源守卫扫描面，当时定向测试未覆盖）→ 改引 `isRuntimeReadyAsset(asset)`；守卫 3/3、tsc 0 / eslint 0、`npx tsx scripts/report-flow-step-audit.ts` EXIT=0（阶段分布 planner 21 / writer 9 / critic 4，声明 vs 直方图一致 PASS） |

## 需拍板（2026-09-28 R 轮，已逐项核实「是否真需要拍板」）

| # | 项 | 现状（证据） | 选项 / 我的建议 |
|---|---|---|---|
| D1 | E1 push | `gh auth status` = `X Failed to log in to github.com account 653390665 (default)`；本地领先 origin **154** 提交 | 需用户在终端 `gh auth login -h github.com` → 我 push 至 ahead=0。**真需拍板**（唯一阻塞项） |
| D2 | 本机 Node 升到 22.22.3 | 本机 `node -v` = v22.22.0，低于自声明 floor `>=22.22.3`（`.nvmrc`/`.node-version`/`engines`）；npm v12.0.2 每条命令告警。实测 22.22.3 可用（`FNM_DIR=/tmp/fnm-home fnm install` 后：`TSC_EXIT=0`、`tests/node-version-declaration.test.ts` `TEST_EXIT=0`）；写 `~/.local/share/fnm` 被沙箱 EPERM 拦下 | 需用户在自己终端执行 `fnm install 22.22.3 && fnm default 22.22.3`。低风险，建议做 |
| D3 | `memory/` 入库声明矛盾 | `git ls-files memory MEMORY.md TOOLS.md` = 4 个文件均被追踪，但 `MEMORY.md:19-20` 声明「不入库」+「待操作者拍板」；`plans/255-log-repo-hygiene.md:89` 写明「不动 git，属操作者决策」 | **已拍板 A（2026-09-28 R 轮落地）**：承认入库并改 `MEMORY.md` 声明；B 的局限见下方「验证」节（blob 仍在历史里） |
| D4 | 适合度「使用反馈」通道接线 | **已拍板（接）（2026-09-28 收尾落地 `e8a7d38`）**：反馈侧已通（`server/lib/db/skills.ts:251 calculateFeedbackScore` + `src/components/ChapterCapabilityFeedbackBar.tsx:66`）；消费侧未接：唯一生产调用点 `src/components/skills/StyleShelf.tsx:172` 只传 `{ novelGenreTokens, novelPlatform }`，`src/lib/capability-shelf.ts:263-271` 在无样本时静态重分配 +12/+8 | 接（需满足 Plan 150 两通道分开展示约束）/ 不接（登记为残余）。建议接（工作量小、直接影响排序质量） |
| D5 | E2 残余① 发布链依赖 `huggingface.co` | **已拍板 b-full（权重入库随包）（2026-09-28 收尾落地 `ff23ab9`）**：npm 包不带权重；CI 三个打包作业 `npm ci` 后只能走 Hub，不可达即 `exit 1`（发布硬失败） | a 接受 / b pin revision + 发布机或 CI 缓存预置权重 / c 权重作 release 资产托管。建议 b（最小改动：加 cache 步骤 + 文档；本机 `huggingface.co` 当前不可达，只能先改接线不能验证） |
| D6 | E2 残余② `SKIP_EMBEDDING_MODEL_FETCH=true` 逃生舱 | **已拍板 b（默认严格 + 显式放行）（2026-09-28 收尾落地 `db474a1`）**：该模式下 `embeddingWeightsVerdict` 直接返回 ok（声明见 `scripts/fetch-embedding-model.mjs:9`）→ 可产无权重发布件且过 `smoke:package-artifacts` | a 保持（离线开发必需）/ b 冒烟不再随 SKIP 跳过，仅显式 `--allow-missing-weights` 放行。建议 b（默认严格 + 显式放行） |
| D7 | F7 `Scene` 删除还是保留 | **已拍板（留）（2026-09-28 D7 收口）**：已零引用（全仓 175 条 `Scene` 命中均为文案/局部变量/邻接类型；无 `: Scene` / `Scene>` / `Scene[]` / import 用法）+ 无 `scenes` 表（仅 2 条注释 + JSDoc 自身）；本轮已按选项③标「未接线声明」（`shared/types/novel.ts:308-311` JSDoc + 本表登记） | 保留（零成本，作历史契约快照）/ 删除（需单独拍板） |
| D8 | vitest 3 条 moderate dev 漏洞 | `MEMORY.md:14` 记载待批准 `--force` 升级；CI audit 门只审 `--omit=dev`；`plans/README.md:576` 自相矛盾（同句写着 `0fb8561` 已升级归零 / 仅剩 3 moderate） | 有网时 `npm audit` 复核后决定 `--force`。本机当前无网，**暂无法复核** |

登记（不需拍板、已如实入账）：D5 长篇记忆基线（技术债，触发=真实长篇样本）、F9 `vector_chunks` 扫描（待真实分布）、E6 复测（工具就绪，触发=真实用户数据）。

### 验证（2026-09-28 R 轮，逐项实测；用户要求「需要拍板的先验证」）

- **D1**：`gh auth status` = `X Failed to log in to github.com account 653390665 (default)` / `The token in default is invalid.`；`git rev-list --count origin/codex/plan169-checkpoint..HEAD` = **155**；remote = `https://github.com/653390665/dodo.git`。→ 仅能在用户终端解。
- **D2**：`node -v` = `v22.22.0`；`fnm list` = v20.19.0 / v20.20.2 / v22.22.0(default) / v22.22.1 / system；`~/.local/share/fnm/node-versions` 无 v22.22.3。已验证 22.22.3 可用（上轮：`FNM_DIR=/tmp/fnm-home` 装好后 `tsc` EXIT=0、`tests/node-version-declaration.test.ts` EXIT=0）；沙箱对 `~/.local/share/fnm` 写操作 EPERM。→ 需用户终端。
- **D3**：`git ls-files` 四文件已追踪（`MEMORY.md` 2884 B / `TOOLS.md` 787 B / `memory/2026-09-08.md` 1126 B / `memory/user-working-rules.md` 5229 B）；`git log origin/main -- MEMORY.md memory/ TOOLS.md` **空**（未上远端）；但 **4 个本地提交**携带它们（`1160fc6` feat(shelf) 013 / `eff459d` / `99612e6` / `824981b`）→ **pending push 会把它们公开**。密钥模式扫描（sk-*/ghp_*）= 0 命中。**新事实：选项 B（`git rm --cached`）只能从 HEAD 移出，blob 仍在历史里；要真正不公开必须在首次 push 前重写历史**（或接受）。
- **D4（可接，且比预想小）**：数据已在视图上 —— `src/lib/hooks/useSkillsShelfData.ts:20` 调 `syncSkillFeedbackScores()` 把 Skill[]（含 `feedbackScore`）存进 `useSkillsShelfStore`，`src/components/SkillsStudioView.tsx:45` 已用该 hook；缺口仅 `src/components/skills/StyleShelf.tsx:171-173 computeCardFitness(asset, { novelGenreTokens, novelPlatform })` 未传 `feedbackScore`（资产类型 `CuratedProductSkill`（`shared/types/prompt-assets-governed.ts:335-352`）本身无反馈字段）→ 需按 `asset.id` / `sanitized-${asset.id}` 查 `savedSkills` 后传入。计分现状 `src/lib/capability-shelf.ts:262-271`（反馈 20 分 + 理由「✓ 有真实使用反馈」；无样本时是 +12/+8 空转重分配，今天永远走空转）。聚合键：`server/lib/db/skills.ts:243-292`（`record.mountedSkillIds.includes(skill.id)`）；导入副本 id = `sanitized-${asset.id}`（`src/components/SkillsStudioView.tsx:160/:1880`、`server/routes/skills.ts:320`、`shared/lib/capability-manifest-catalog.ts:444-445`）。**硬约束**：`plans/150-capability-governance.md:98-100` —— 冷启动分与在线表现必须**分开展示/排序**，禁止两类分数直接相加；UI 只能标注「证据稳定度/使用反馈」。展示通道已存在：`src/components/skills/StyleShelf.tsx:114 fitnessChip={score, reasons}`（`reasons` 已含「✓ 有真实使用反馈」）。Plan 241 原意即 `computeCardFitness` 读 `observedPerformance`（`plans/241-feedback-loop.md:22/40`）。
- **D5**：`package.json:37 package` = `build:electron → fetch-embedding-model.mjs → package-electron.mjs → smoke:package-artifacts`；`scripts/fetch-embedding-model.mjs:65` 顺序 = `INKFLOW_MODEL_SOURCE_DIR` → node_modules 缓存 → `huggingface.co`（不可达报 `权重不完整…请设 INKFLOW_MODEL_SOURCE_DIR`）。CI 打包作业（`.github/workflows/build.yml:125-298` mac/win/linux）只有 `npm ci` + `npm run package`，**无权重缓存步骤、无模型环变量** → 每次冷启动必须连 Hub。权重目录 `build/` 被 `.gitignore:2` 忽略（本机 23 MB），打包走 `package.json:140-145 extraResources from build/embedding-model → embedding-model`。**修正：`actions/cache` 类方案仍需一次联网冷跑**（缓存由 workflow 生成）；真正去 Hub 依赖 = 仓内随包（23 MB，需解除 ignore）或自托位置 + `INKFLOW_MODEL_SOURCE_DIR`。
- **D6**：`scripts/check-package-artifacts.mjs:73-75` 传 `skip: SKIP_EMBEDDING_MODEL_FETCH === 'true'`，而 skip 在 R3 的 sha256 校验**之前**短路 → 仍可产出「无权重且过冒烟」的发布件。全仓 grep：`SKIP_EMBEDDING_MODEL_FETCH` 仅出现在 `scripts/fetch-embedding-model.mjs`、`tests/embedding-model-assets.test.ts` 与计划/文档 —— **CI 未设、也无已记载的用户工作流依赖它** → 选项 b（显式 `--allow-missing-weights` 才放行）风险很低。
- **D7**：`Scene`/`scenes` 全仓 23 命中，逐条看过：均为文案（「Scene Beats」/「Scene Contract」）或局部变量（`tests/scene-split.test.ts:16-21` 的 `const scenes = splitSceneBeats(beats)`）→ `shared/types/novel.ts:313` 的接口零引用，维持「未接线声明」。**（2026-09-28 D7 收口：已拍板「留」，见上表 D7 行）**
- **D8**：`curl registry.npmjs.org` = 000、`huggingface.co` = 000 → 本机无法 `npm audit` 取证，维持「有网时复核」。

## 终态（2026-09-28 R 轮收尾）

- HEAD = `b009bce`（分支 `codex/plan169-checkpoint`；`ef92434` 为新会话交付终态，`b009bce` 为随后的 R2 单源守卫回归修复；本地领先 origin 至少 162 提交——计数随每次提交递增，精确值查 `git rev-list --count origin/codex/plan169-checkpoint..HEAD`；push 待用户 `gh auth login -h github.com`）。
- 门禁基线：后端全量 `1465/1465`、前端全量 `161 files / 1022 tests`、六场景快照逐项不变（沿用 D1/E7 读数；D6/D4/D5/D7 各单元另跑定向：D6 `tests/embedding-model-assets.test.ts` 11/11 + tsc 0 + eslint 0；D4 前端定向 3 文件 27 用例 + tsc 0 + eslint 0；D5 权重 4 文件 sha256 复核 + 取权重 4/4 cached EXIT=0；D7 零引用核对）。
- 已关闭：R 轮 D3 拍板 A（`ea50b45`）、D4 接（`e8a7d38`）、D5 b-full（`ff23ab9`）、D6 b（`db474a1`）、D7 留（`1d69429`）、E2 残余①发布链 Hub 依赖（D5）、E2 残余②冒烟逃生舱（D6）、R2 读数脚本单源守卫回归（`b009bce`）。
- 未关闭（非本会话可解）：E1 push（需用户 `gh auth login`）、E6 激活漏斗复测（待真实用户数据）、F9 `vector_chunks` 全表扫描（待真实分布）、D5 长篇记忆基线（技术债，触发 = 真实长篇样本）、D8 vitest 3 条 moderate dev 漏洞（需有网复核）、M6 打包态真机验证（需联网拉 Electron 头）。
- 残余项移交（2026-09-28）：Plan 264 `plans/264-residual-closeout.md` —— D8 vitest dev 漏洞**已销账**（`npm audit` = 0 漏洞）、E1 push 前置密钥体检已做（164 提交 / 0 真实凭证）、F9 出合成基线与机械阈值、D5 触发线可判定化；M6 打包真机验证按用户指令本轮排除（无动作）；余 E1 push / D2 Node / E6 真实数据（详见该计划执行表）。
- 独立复核（2026-09-28，本会话）：后端全量 `1467/1467`（修复 R2 守卫回归 `b009bce` 后复跑）、前端全量 `161 files / 1025 tests`；仓内 4 个权重文件 sha256 与 `scripts/lib/embedding-weights.mjs` 的 `EMBEDDING_MODEL_SHA256` 全等，新 `git worktree` 复核 `onnx/model_quantized.onnx` = 24010842 B；`node scripts/fetch-embedding-model.mjs` 离线 `4 files cached`（EXIT=0）；守卫 `tests/capability-runtime-readiness.test.ts` 3/3。
