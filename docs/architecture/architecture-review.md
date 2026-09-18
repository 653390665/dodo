# InkFlow 架构与质量诊断（2026-09-18）

- 生产者：`architecture-visualization:risk-quality-reviewer`
- 取证时点：2026-09-18，评审开始于 `84fb175`；**评审期间 HEAD 被另一会话移动过一次**（`20f914c`，19:53:59），详见 R10。结构类断言以 `84fb175` 为准，R4 的断言以 `20f914c` 为准。
- 上游底图：同目录 `inkflow.structurizr.dsl` / `module-map.dot` / `lifecycle-states.dot` / `runtime-topology.dot` / `flow-chapter-candidate.dot` / `candidate-store-model.dot`
- 证据台账：`inkflow.evidence.md`（本文沿用其 H/M/L/U 置信与 ✔ 亲读 / ⌁ 子代理上报 两档溯源）
- 风险网络图源：`risk-map.dot`
- 处置排序：`remediation-plan.md`

## 评审目标与容差

| 项 | 取值 |
|---|---|
| 干系人 | 作者（唯一终端用户）＋ 在仓库上并发改动的 agent 会话 |
| 评审目的 | 判定当前架构是否仍能安全承载「AI 提议、作者裁决」这一核心承诺，以及下一步该修什么 |
| 风险容差 | 对**作品数据丢失**与**未消毒原文触达作者**零容差；对性能与外观瑕疵高容差 |
| 首要质量属性 | 完整性 › 诚实性（所见即所做） › 可维护性 › 可重现校验 › 可靠性 |

本轮**不评估**：依赖版本升级收益、E1 商业化、产品交互收敛（245-A/B）——它们属于 `evolution-planner` 与产品拍板，不是架构缺陷。

---

## 一、本轮真实校验基线（补齐上一轮明确缺口）

上一轮图集刻意声明「未做写入式验证」。本轮补齐：

| 门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npm run typecheck` | **exit 0** |
| 后端行为 | `npm test` | **1213 passed / 0 failed**（32 suites，168s） |
| 前端行为 | `npm run test:frontend` | **2 failed / 840 passed（99.76%）+ 10 unhandled errors**，失败项未定位（见文末补录） |
| 静态门 | `npm run lint`（`eslint . --max-warnings=0`） | **945 problems / 927 errors —— 红** |
| 提交门 | `.git/hooks/pre-commit` | 已安装；只跑 typecheck + 暂存文件 lint，**不跑测试** |

关键判读：**静态门是红的，但红 100% 来自一个外来目录，产品代码零 error（见 R1）；类型门干净；行为层接近绿但不是绿——后端 1213/1213，前端 2 个失败未定位。**
这个组合决定了本轮其它发现的可信通道：唯一**当前失效**的是静态门（信息量为负），唯一**存在但被削弱**的是行为门（一次不可归因的失败 + 8 倍耗时）。

---

## 二、确认的风险（按处置优先级）

严重度记法：`P0` 本轮必修 / `P1` 有触发条件、尽快 / `P2` 清账 / `P3` 观察。

### R1 · 4.1 GB 外来项目残留在工作树内，把 lint 门彻底打死 —— **P0**，置信 H ✔

```
.tdai/                4.1 GB，含 MemoryCore/ MemoryKnowledge/ MemoryPanel/ MemoryProxy/
                      agents/ deploy/ colima-home/ .pnpm-store/、python 脚本
                      文件时间戳 2026-09-02 ~ 09-03，与 InkFlow 无任何引用关系
.gitignore:49         .tdai/            ← git 忽略，因此永远不会出现在 git status
eslint.config.mjs:8   ignores: [dist, dist-electron, release, node_modules, .agents, docs, …]
                                        ← 没有 .tdai/
```

后果链，逐环可验：

1. `.tdai/` 下有 **733 个**可 lint 的非 node_modules 源文件，仓库其余部分 **802 个**——即 eslint 每次运行有约 **48% 的输入是外来代码**（完整 `--format json` 实测，见文末补录）。
2. `npm run lint` 因此报出 **927 error / 18 warning，全部落在 `.tdai/` 的 172 个文件里；产品侧 0 error 0 warning**。抽样可见的全是 `.tdai/*.mjs` 的 `no-undef ('console'/'Buffer' is not defined)`——**外来文件根本没进过 eslint 的 env 配置**，报错是必然的，与 InkFlow 代码质量无关。反向确认：`npx eslint server src shared tests scripts` → 784 文件，exit 0。
3. 单次 `eslint .` 在本机耗时 **>15 分钟**（本轮实测），而 `--max-warnings=0` 使这道门**永远不可能通过**。
4. 一次永远红的门等于没有门，且**信息量为负**：看到红之后无法区分「我引入的问题」与「那 4.1 GB」，于是任何 agent 或人都会开始忽略它，或者转向 `--no-verify`，或者去修不该修的东西。

受影响质量属性：可重现校验、agent 可信反馈回路。

**这不是产品缺陷，是仓库卫生缺陷，但它污染了本项目唯一的静态门——而门后是干净的。**

**R1 的放大项（本轮新查）：`npm run lint:fix` 会改写那个外来项目，且无法用 git 回滚。**
`package.json` 里 `lint:fix => eslint . --fix` 与 `lint` 同扫全仓。对完整 JSON 结果做可修复性分析：

```
.tdai/ 内 945 处问题中 34 处可被 --fix 自动改写，涉及 21 个文件（其余 911 处不可自动修复）
   prefer-const ×16、移除「unused eslint-disable directive」×18
   样例被改文件：.tdai/MemoryCore/src/core/store/sqlite.ts、
                .tdai/MemoryCore/scripts/migrate-sqlite-to-tcvdb/sqlite-to-tcvdb.ts
```

一个看到红门、按直觉跑 `lint:fix` 的 agent（或人），会**静默修改 21 个不属于本项目的文件**。
而 `.tdai/` 是 gitignored ⇒ 未跟踪 ⇒ **git 里没有这些文件的任何副本，改完无从恢复**。
这条把 R1 从「体验/效率问题」抬到「一次常见误操作可造成不可逆越界写入」，是 M1 必须优先的真实理由；
M1 因此在 remediation-plan 里追加验收项：修完 ignore 后 `lint:fix` 的作用域也必须收敛。

修法与验收见 `remediation-plan.md` M1：把 `.tdai/` 加入 `eslint.config.mjs` 的 `ignores`（一行），并对 `.tdai/` 的归属做**由用户决定的**处置（保留／迁出／删除）——本轮**不擅自删除**，理由见「四、我刻意没做的事」。

### R2 · 运行时只用轻量消毒器，含竞品词通配剥除的那一版只在构建期用 —— **P0**，置信 H ✔

白标不变式（`docs/specs/capability-sanitize.md`、AGENTS.md 不变式四）要求未消毒原文不得触达作者。本轮实测两把刀并不等价：

| 函数 | 位置 | 竞品词 `墨流`/`moliu` | 品牌映射（小飞鸡→名家、天马→结构工坊、墨流→外部工具） | 商业承诺词改写（一键…） |
|---|---|---|---|---|
| `analyzeAndSanitize` | `shared/lib/prompt-sanitizer.ts:65` | **剥** | 否 | 否 |
| `sanitizeWhiteLabelText` | 同上 `:133-149` | **不剥** | 否 | 否 |
| `cleanText`（构建期） | `scripts/generate-public-catalog.ts:31-49` | 经 1 间接剥 | **是** | **是** |

而服务端**全部**运行时消毒调用都指向轻量版：
`server/routes/skills.ts:11,29,34,282,283,284`、`server/helpers/curated-skill-runtime.ts:2,50,67,68,69` —— 11 处 `sanitizeWhiteLabelText`，**0 处** `analyzeAndSanitize`。

即：**生成期用三把刀叠加，运行期只用其中一把**。对已在构建期消毒过的公开目录无影响；对**导入的第三方能力包**（`/api/…/import`、continuation pack 等运行期入口）则意味着裸文本里的 `墨流` 会原样穿过消毒端点。

注意这条与台账的关系：`plans/README.md:358` 的 `CORR-02` 记的是「运行时消毒端点不剥竞品词」。`prompt-sanitizer.ts:144-146` 的注释显示 Plan 236 已把**括号通配剥除**并入了正典并宣称修好了这条——但**竞品词正则并未随之并入**。所以 CORR-02 处于「被记为已处理、实际修了一半」的状态，这是比原始缺陷更需要登记的事实。

受影响质量属性：白标合规（零容差项）。

### R3 · 工作树里 16 MB 未忽略的 agent 截图产物 —— **P0**，置信 H ✔

```
gui-test-screenshots/   85 个 PNG、16 MB
git check-ignore        → NOT ignored（未跟踪，但也没被忽略）
```

一次 `git add -A` 就会把它写进历史，且**二进制进历史后不可逆**（只能重写历史）。它和 R1 是同一类病的两个症状：多轮 agent 把仓库根目录当临时空间，而 `.gitignore` 只覆盖了其中一部分。

但两者后果**不对称**（补录实测）：`.tdai/` 已在 `.gitignore:49`，只污染校验门与磁盘；`gui-test-screenshots/` 未命中任何 ignore 规则，是**真会进提交历史**的那一类。因此 M3 的必要性高于「和 R1 顺手一起做」——它防的是不可逆的一侧。

修法 M3（补 `.gitignore` 一行），可与 M1 同批做；同样**不擅自删除**已有产物。

### R4 · Plan 246「降级徽标诚实性」只落地了一半 —— **P1**，置信 H ✔

本轮开始还是一处**未提交**的工作树改动，**19:53:59 被另一会话提交为 `20f914c`**（`server/routes/production.ts` +4、`src/components/ProductionRunReview.tsx` +5/-2）。对照其自述计划 `plans/246-249-round42.md:5-14`（同一 commit 里入库）：

| 计划条目 | 状态 |
|---|---|
| 后端 `fallbackContinuity` 补 `degradation:{beatsSource:'fallback',draftSource:'fallback'}`（`production.ts:528-532`、`:824-828`） | 已完成 ✔ |
| 前端 `ProductionRunReview.tsx:350` 分镜徽标改读 DB 字段 | 已完成 ✔ |
| **历史存量纯保底 run 前端兜底：`auditMeta.source==='fallback'` 时也标降级** | **未实现** |
| Verify「历史列表一致」 | **不成立** |

第三条是关键：`?? beatsSource` 兜到的是内存 store 的 prop（刷新后为 null），而不是计划里写的 `auditMeta.source`。所以**升级前落库、没有 `degradation` 字段的旧保底 run，刷新后仍然不标降级**——正是这条改动想修的那个失真。

同时暴露一处新的一致性缺口：`ProductionRunReview.tsx:378`、`:383` 的**正文**降级徽标仍只读 prop，未随分镜一起改读 `degradation.draftSource`——后端已经把这个字段写进去了。`:365` 的分镜告警条同病。历史列表 `:652` 则要求 `degradation` 为真值才显示「含降级」，旧数据同样不亮。

`ProductionRunReview` 相关测试我无竞争单跑过 3 个文件（21/21 绿），typecheck 也在含同一 diff 的工作树上 exit 0——**所以这道缺口不会被任何现有门拦下**，而它现在已经在 HEAD 里了，只会被后续轮次当成「246 已修完」。
（注：上表的第三条与一致性缺口，是在 commit 之后用无 scope 的 `grep -rn auditMeta` 复核的，非沿用 commit 前的读取。）

受影响质量属性：诚实性（`docs/specs/llm-status-honesty.md` 同一价值观）。

### R5 · `sanitizationStatus === 'runtime-ready'` 判据被手抄成 13 份，跨前后端 —— **P1**，置信 H ✔

白标不变式的实际准入谓词，`grep` 实测分布于 7 个文件 13 处：

```
src/lib/capability-governance.ts   :167 :185 :210 :235 :403   (5)
src/lib/capability-stage-cards.ts  :237                        (1)
src/components/SkillsStudioView.tsx:804                        (1)   ← 台账写作 skills/ 下，路径已漂移
src/components/book-factory/useBookFactory.ts:157              (1)   ← 台账写作 lib/hooks/，路径已漂移
src/lib/skill-fusion.ts            :66 :67 :68                 (3)   ← 用 as Skill & {…} 读不在类型上的字段
server/helpers/writing-style-service.ts :987 :1010 :1107       (3)
```

`docs/specs/capability-sanitize.md` 声称渲染只有两条合法路径，但**判定「什么算这两条路径」的谓词有 13 个副本**，且前端与执行门各抄一份、互不引用。收紧或放宽准入时必须人肉改 13 处，而编译期不会报错——只有测试会（且 `skill-fusion.ts` 那三处靠类型断言绕过了检查，字段改名后静默 fail-closed）。

台账把它记为「ARCH-01：4 处重复」。实测是 13 处，且两个文件路径已失效 → 见 R9。

受影响质量属性：可维护性、白标合规（防线依赖复制粘贴保持一致）。

### R6 · 打包态嵌入模型的缓存与权重路径从未钉住，落在 app 包体内 —— **P1**，置信 M（机制 H ✔，结果需打包件实测）

`server/embedding.ts` 只设了 `env.allowRemoteModels/allowLocalModels`（且仅在 `NODE_ENV==='test'` 分支），**从未设 `env.cacheDir` 或 `env.localModelPath`**；全仓 `grep cacheDir|localModelPath|TRANSFORMERS_CACHE|HF_HOME` 在 `server/ scripts/ shared/` 命中 0。

于是取 transformers.js 默认值（`node_modules/@huggingface/transformers/src/env.js:96-104`）：

```
cacheDir        = dirname__ + '/.cache/'
localModelPath  = dirname__ + '/models/'
dirname__       = dirname(dirname(url))  ← ESM 分支
```

而 `scripts/build-server.mjs:25-29` 用 banner 把 `import.meta.url` 钉成了**打包产物自身的文件名**，产物是 `dist-electron/server.cjs`，且它在 `asarUnpack` 白名单里（`package.json` build.asarUnpack[0]）。逐层算下来：

```
import.meta.url = …/Resources/app.asar.unpacked/dist-electron/server.cjs
dirname ①       = …/Resources/app.asar.unpacked/dist-electron
dirname ②       = …/Resources/app.asar.unpacked        ← dirname__
cacheDir        = …/Resources/app.asar.unpacked/.cache/
localModelPath  = …/Resources/app.asar.unpacked/models/
```

两个结论：

1. **我上一轮 §F2 的猜测方向对、机制错**。当时写「若落在 `.app` 卷内且卷只读，首启语义检索可能整体失败」。实际因 `server.cjs` 被 asarUnpack，落点在**真实可写文件系统**上，不是 asar 内部——所以不是「必然失败」。
2. 但把运行期缓存在**已签名 app 包体的 Resources 里**仍然是错的：macOS 下经其他管理员装到 `/Applications` 时该目录非当前用户可写；Gatekeeper App Translocation 会随机化并只读化包路径；每次自动更新重建 `.app` 即**清空权重缓存**，用户被反复重下权重；Windows NSIS `perMachine:false` 下侥幸可写。

另外 `files`/`extraResources` 均未随包任何权重、也没有任何构建脚本产出 `models/`（`grep models scripts/` 命中 0）——所以**打包首启必然联网向 HF Hub 拉 `Xenova/bge-small-zh-v1.5`**（`server/embedding.ts:125-127`）。对一款主打「作品记忆不出机」的本机优先产品，这是一条应当显式写进产品文档的对外网络依赖，而不是散落在实现里的事实。

失败模式本身是**安全**的：`ensurePipeline` 有 try/catch（`:132-141`），降级为 `unavailable` 并转 LLM 回退，状态展示按不变式诚实呈现。所以风险是「本地能力静默退化 + 每次更新重下 + 权限相关的首启失败」，不是崩溃。

修法：显式设 `env.cacheDir = path.join(app.getPath('userData'), 'models-cache')`，并考虑随包附带权重或首启明示需联网。

### R7 · 长生命周期作业的持久化语义有三种，且提交门不跑测试 —— **P2**，置信 H ✔

```
server/routes/audit.ts:69          auditJobs     = new Map   （:75-79 有 sweep 清理）
server/routes/continuation.ts:99   parseDocJobs  = new Map   （:396-406 有 prune + cutoff）
server/routes/continuation.ts:401  extractionJobs            （落库，:571 可从持久层恢复）
```

上一轮 §F4 记的是「audit·world 作业进程内 Map，重启即失」——本轮复核**成立**，并补两点：① 内存泄漏这一支**不成立**（两处都有 prune，不得计入风险）；② 同样在 `continuation.ts` 里的 `parseDocJobs` 也是 Map，所以「不一致」发生在**同一文件内部**，不只是跨模块。

叠加背景：`.git/hooks/pre-commit` 只做 typecheck + 暂存文件 lint，**不跑任何测试**；`npm run test:unit` 是手动一键。因此行为回归全靠 CI 与人肉，本地提交没有拦截。

### R8 · Node 运行时版本没有任何声明 —— **P2**，置信 H ✔

```
package.json         无 engines 字段
仓库根               无 .nvmrc
.github/workflows/build.yml:18,136,180,273   node-version: 22（4 个 job 一致）
scripts/build-server.mjs:21                  target: 'node20'
本机实际             node v22.22.0（fnm 管理），npm 12.0.2
npm 自己报           "npm v12.0.2 does not support Node.js v22.22.0"（每条命令第一行）
本会话工具环境       Node v24.18.0
```

CI 与本机恰好都是 22，所以问题今天不显形。但仓库里没有任何地方**声明**这一点：换机器、换 agent 会话（本轮工具环境就是 24）、或 fnm 默认版本漂移，`better-sqlite3` 与 `onnxruntime-node` 的原生 ABI 就会和已编译产物不匹配，表现为「测试装不上／原生模块加载失败」，而排查成本极高。npm 版本超出官方支持范围也是同一类隐患，且已经在每条命令的输出里刷屏。

### R9 · 项目自己的风险台账指针失实 —— **P2**，置信 H ✔

`plans/README.md`（545 行）是本项目真正的问题登记处，本轮抽查其中三条：

| 台账条目 | 台账原述 | 本轮实测 |
|---|---|---|
| ARCH-01 | 「runtime-ready 判定谓词 **4 处**重复」，锚点含 `SkillsStudioView:731`、`useBookFactory:131` | **13 处**；两文件实际在 `src/components/`、`src/components/book-factory/`，行号 804 / 157 |
| CORR-02 | 「运行时消毒端点不剥竞品词」 | 部分已修（Plan 236 并入括号通配），**竞品词正则仍未并入正典** → 见 R2 |
| ARCH-04 | 「**331KB** 静态治理目录随编辑器 chunk，`EditorView.tsx:77` 唯一用途是一次标题查找」 | 结构问题成立；体积现测 `public-skill-catalog.ts` = **221KB**（数字漂移，可能指打包后） |

三条里两条锚点失效、一条定量失准、一条状态记歪。台账的**机制描述全部仍然成立**——坏的是指针和数字。对一个「按台账排下一轮工」的项目，这会让工单派到不存在的文件上。

同类先例并非没有：`plans/README.md:248` 自己就记过「本行此前误留 TODO」。

### R10 · 同一检出被至少 3 个 agent 会话并发使用 —— **P1（流程风险，非代码缺陷）**，置信 H ✔

诊断期间实测到的进程树：

```
npm run typecheck  × 3   父进程分别来自
   ├─ /Applications/Qoder.app/Contents/MacOS/Qoder      （另一个 Qoder 会话）
   ├─ zcode-cli → zcode-host-local-1 → ZCode            （一个 ZCode 会话）
   └─ 本会话
其中两个 tsc 单次运行 16-18 分钟未结束（8 GB 内存 M1，另有常驻 dev server）
```

工作树在本会话期间发生了漂移，见下面第三条实例。

**补录到的第二个量化实例**：本轮 `npm run test:frontend` 墙钟 2416 s（约 40 分钟）才出终局，而该套件在 `vitest.config.frontend.ts` 里自述的无竞争基线是 **329/338/306 s**——**约 8 倍**；`maxWorkers: 1` 没变，唯一变量是并发会话（期间确实检测到另一会话启动了第二条同配置 vitest，且收尾时系统可用内存页仅约 17 MB）。

**补录到的第三个实例——HEAD 在本轮评审期间被移动。** 会话开始快照为 `M server/routes/production.ts` + `M src/components/ProductionRunReview.tsx`（即 R4 那半截改动）；我读完并登记 R4 之后，**19:53:59 另一会话把它提交为 `20f914c`**，工作树随即换成另外三个我在评审时没见过的修改文件（`server/helpers/ai-production-pipeline.ts`、`src/components/AgentWorkspace.tsx`、`src/components/book-factory/PlanningTab.tsx`）。
这次**结果是良性的**（提交而非回滚，没丢工作），但它意味着：① 本轮所有「工作树状态」类结论都有时效，本文已按 commit 复核过 R4；② 图集取证锚点 `84fb175` 已过期，本文与 `docs/architecture/README.md` 的 HEAD 需按 §三 的说明重锚。

这直接违背本项目 AGENTS.md 的硬性隔离第三条「并发子任务不得修改同一源文件」——虽然这三个不是父子关系而是**平级会话共用一个检出**。后果：① 任何一方便利式 `git checkout -- <file>` / `git stash` 都会吃掉别处的在途工作（`plans/README.md:330` 已记录过一次同类事故：「215 突变验证误用 checkout 回滚未提交正文」）；② 校验信号被拖成长到 15 分钟的假红/假慢，本轮所有耗时数字都不可用作性能基线；③ 严重时校验通道直接不可用（②的极限形态就是本轮的前端套件）。

修法不是禁止并发（那是工作方式），而是**每个会话一个 worktree**——见 remediation-plan M2。

### R11 · 声明了但没有写入方的状态字面量仍在 —— **P3**，置信 H ✔

`shared/types/novel.ts:215` 的 `ProductionRunStatus` 含 `'rejected'`；服务端对 `chapter_production_runs` 的写入只出现 `running` / `review_required` / `applied` / `failed`（`server/routes/production.ts:539,613,877,1137`、`server/lib/db/production.ts:59`）。即上一轮 §F8 成立：**「拒绝一次生产」在数据层没有对应状态**。

同类：`'converted'` / `'confirmed'` 亦无写入方（沿上一轮结论，本轮未重测）。

`creative-artifacts` 那边的 `'rejected'` **是有写入方的**（`server/lib/db/creative-artifacts.ts:129,662`、`db/canon-patches.ts:444-447`），所以这不是全局死枚举，只有 `chapter_production_runs` 这一处。

---

## 三、上一轮未知的销账情况（§F 复核）

| # | 上一轮 | 本轮结论 |
|---|---|---|
| F1 | 回退能力存疑，疑似文档超前于实现 | **推翻**。能力存在，实现在客户端（`EditorView.tsx:692-705` → `useEditorPersistence.ts:393-399` → 常规保存链路，且带世代守卫）。已改为正向事实写入 `inkflow.evidence.md §C3` |
| F2 | 打包态权重 cacheDir 若落只读卷则首启失败 | **机制猜错、方向部分对**。见 R6：落在 `app.asar.unpacked/`，可写但不该写；首启确实需要联网 |
| F3 | 消毒目录旁路，安全性依赖生成器 | **降级为 L**。`tests/prompt-assets-governed.test.ts:398-406` 断言公开目录中 `sanitize-required / research-only / 非白标 / 非 runtime-ready / test-fixture` 五类**数量恒为 0**，`tests/public-catalog-freshness.test.ts:273` 断言产物与源同步。所以调用点少一层过滤仍被**两道测试硬门**兜住；风险从「可能泄露」降为「防线层次单薄」。真正没兜住的是运行期导入面 → 归入 R2 |
| F4 | audit·world 作业进程内 Map | **成立并细化**：audit + continuation-parse 两处 Map，均有 prune（无泄漏）；不一致发生在同文件内。归入 R7 |
| F5 | 是否还有第五、六类裁决门 | **半销**：三个端点**确认存在**（`server/routes/index.ts:19,23` 注册 `capability-migration` / `legacy-artifact-structuring`；`server/routes/production.ts:1357` `POST /api/chapter-production-runs/:runId/fact-candidate/apply`），因此 `candidate-store-model.dot` 的 `gap2`「路由存在、语义未读」为真，无需改图。**是否写权威存储仍未判定**，语义未读 |
| F6 | get/list 是否返回未消毒 `style` | 本轮未判定，仍为未知 |
| F7 | `Scene` 无表无 CRUD | 本轮未判定，仍为未知 |
| F8 | `'rejected'` 死字面量 | **成立**，并界定作用域。归入 R11 |
| F9 | `vector_chunks` 线性扫描 | 本轮未测性能（机器被并发占满，测了也不可信），仍为未知 |

九项账：F1 **推翻**、F2/F3/F4 **定性并调整严重度**、F5 **半销（存在性确认，语义未读）**、F8 **成立**；F6 / F7 / F9 **仍开放**。
**上一轮 ⌁ 级证据的错误率不低**——F1 完全错、F2 机制错、F3 夸大。这三条都是子代理上报、未经主控读源的方向。取证方法一节（§四b）已把这段过程记进台账，作为「⌁ 不可直接采信」的实例。

---

## 四、我刻意没做的事

诊断是只读的。以下动作有不可逆或越权风险，**留给用户拍板**：

1. **不删除 `.tdai/`（4.1 GB）与 `gui-test-screenshots/`（16 MB）**。前者时间戳属另一个项目，后者是历史验证产物；删除后无法恢复，也可能不是我能判定归属的东西。本轮只登记 + 给出迁移/忽略方案。
2. **不改 `.gitignore` / `eslint.config.mjs`**。两行改动即可让 lint 门恢复可用，属于最小改动，但用户要求的是「诊断」；已把它们列入 remediation-plan 的 M1/M3，等一句「改」。
3. **不碰那半截 Plan 246 的未提交改动**。它可能正在被另一个会话写。本轮只报告状态差。
4. **不跑 `npx playwright test`**。它会 `npm run build` 并起服务，与另两个会话和常驻 dev server 抢资源，产出不可信信号。
5. **本轮所有耗时数字不作性能结论**（typecheck 18 分钟、lint 15 分钟皆因 3 会话并发），R6/R9 需要重跑基线才能定量。

---

## 四b、取证方法警告：负向结论必须换工具复核

本轮出现一次**险些写错的结论**，值得进台账，因为它对「agent 能否安全改这个仓库」是直接证据：

- 用 Grep 工具（ripgrep 封装，带 `glob:"server/**/*.ts"` 与 `head_limit` 收敛）搜 `legacy-artifact-structuring`、`capability-migration`、`fact-candidate/apply`，三次都返回 **No matches found**。
- 若采信，就得把 §F5 从「语义未读」改写成「上一轮架构图集引用了不存在的路由」——一条会连带推翻 `candidate-store-model.dot` 与两份文档的结论。
- 直接用 `grep -rn`（无 glob、无 limit）复核，三者**全部存在**：
  - `server/routes/index.ts:19` / `:23` 注册 `capability-migration` 与 `legacy-artifact-structuring`
  - `server/routes/production.ts:1357` `app.post('/api/chapter-production-runs/:runId/fact-candidate/apply', …)`

**规则（本轮之后对自己和其他会话）**：正向命中可以直接引用；**「搜不到」类的负向断言在写进任何工件之前，必须用一次无 scope 的 Bash `grep -rn` 复核**。同一轮里 F1 的判断被推翻两次，也都是「先读到局部证据就下结论」的同一病灶。

同理，`docs/architecture/*.dot` 与本文档里的行号锚点会漂移；**优先按函数名与文件定位，行号只当路标**。

---

## 五、Business Application Fitness 复核（写作工具属业务应用）

| 维度 | 结论 |
|---|---|
| 业务模型清晰度 | **强**。四类候选／四道裁决门在代码里可一一对应（见 `candidate-store-model.dot`），「AI 提议、作者裁决」不是一句口号而是有 CAS + 单事务 + 409 的实现 |
| 数据/状态理解 | **强**。世代守卫、指纹、审计留档、SSE 回显抑制均有测试；本轮补测：**后端**行为面 1213/1213 绿，前端 840/842（2 项未定位） |
| 端到端路径落地 | **中**。主链路成立，但 R4 表明「降级→徽标→作者取舍」这条**诚实性反馈回路**在新旧数据交界处断裂，而它正是裁决质量的依据 |
| agent 指令覆盖 | **强但有 staleness**。AGENTS.md 四条不变式各有对应 spec 与代码锚点；风险在 R9：项目自有台账的锚点/数字/状态三类失实。另见 §四b——本轮两次负向误判都源自「scoped 搜索的 No matches 被当成证据」，这是给 agent 的指令里目前**没有**的一条约束 |
| 校验就绪度 | **中偏弱**。后端测试量大且全绿，但：静态门当前信息量为负（R1，且 `lint:fix` 会越界改写外来文件）、提交门不含测试（R7）、并发会话无隔离导致前端套件 8 倍耗时且有 2 项不可归因失败（R10）——三道防线里一道失效、一道缺位、一道被削弱 |

---

## 校验补录

### 静态门：927 个 error **100% 来自 `.tdai/`**，产品代码零 error

用 `--format json` 跑完整 `eslint .` 后按目录拆分（`/tmp/inkflow-lint.json`）：

| 侧 | 被 lint 文件数 | errors | warnings | 有问题的文件数 |
|---|---|---|---|---|
| `.tdai/` | 733 | **927** | 18 | 172 |
| 其余（`server` `src` `shared` `tests` `scripts` …） | 802 | **0** | **0** | 0 |
| 合计 | 1535 | 927 | 18 | 172 |

反向对照：单独跑 `npx eslint server src shared tests scripts` → **784 文件，0 error 0 warning，exit 0**。

所以 R1 的定性可以从「红的原因与产品代码基本无关」收紧为**「产品代码在静态门上是干净的，这个门当前 100% 是误报」**。
这意味着 `npm run lint` 目前提供的信息量为**负**——它每次都以红结束，任何人（和任何 agent）看到红之后都无法区分
「我引入的问题」与「那 4.1 GB」，于是要么忽略它，要么去修不该修的东西。M1（加两行 ignore）的优先级因此不变。

`.tdai/` 的构成（`du -sh`）：`MemoryCore` 1.5G + `MemoryKnowledge` 597M + `MemoryPanel` 349M + `data` 81M +
`colima-home` 12M + 若干 7M 级 `*.log`，共 4.1G。**已 gitignore**（`.gitignore:49:.tdai/`），
所以它是 lint/磁盘/备份风险，**不是**提交泄漏风险；里面有 `deploy/` 与容器运行时 home，属另一个项目的现场，
更强化了「本轮不删、只登记」的判断（§四 第 1 条）。

### `gui-test-screenshots/` 与 `.tdai/` 的处置差别（修正 R3 的对称表述）

`git check-ignore -v` 实测：`.tdai/` 命中 `.gitignore:49`；**`gui-test-screenshots/` 未命中任何规则**。
即 R3 的 16 MB 截图是**真的会进 `git add .`** 的那一类，而 R1 的 4.1 GB 不会。
两条都是「agent 产物未归置」，但后果不同：一个污染仓库历史，一个污染校验门与磁盘。修 M1 时顺手把截图目录也收进 ignore。

### 前端行为套件：2 failed / 840 passed（**失败项未定位**，原因见下）

`npm run test:frontend` 终局（后台作业缓冲输出，`Start at 19:57:39`，`Duration 2416.00s`）：

```
Tests    2 failed | 840 passed (842)
Errors   10 errors
Duration 2416.00s  (transform 85s, setup 132s, import 342s, tests 356s, environment 756s)
```

**99.76% 通过，但不是绿。** 两项：

1. **失败用例名未取到**——该作业的输出是以 `tail` 截断方式收集的，只留下上面这份汇总。
   我没有重跑全套来定位：跑完时另一会话的第二条 `npm run test:frontend` 仍在运行，
   且系统可用内存页只剩约 17 MB。再叠一遍 40 分钟的重负跑，等于亲手加入 R10 描述的抢占，
   且很可能取到第三个不可信信号。**这是一个刻意选择不补数据，不是遗漏。**
   旁证：`ProductionRunReview` 相关的 3 个测试文件在无竞争下单跑 **21/21 绿（19.25s）**，
   所以失败大概率不在 R4 那条改动上，但这只是旁证，不是结论。
   → remediation-plan「仍开放」表首行就是它：M2 落地后一次无竞争全量跑，交出两个失败用例名。
2. **`Errors 10 errors` 是独立于用例失败的未处理错误**（vitest 单独计数）。
   定向复跑时可见大量 `An update to ProductionRunReview inside a test was not wrapped in act(...)`，
   这类告警在 vitest 里以 unhandled error 计数但不判失败——即**当前有一层测试正确性问题是静默的**。

耗时对比是本轮最干净的 R10 量化：套件自述基线（`vitest.config.frontend.ts` Plan 214 注释）三连 **329/338/306 s**；
本轮 **2416 s ≈ 8 倍**。同轮 `maxWorkers: 1` 未变，唯一变量是并发会话。

`.tdai` 与产品侧的 lint 拆分见上文「静态门」小节。

