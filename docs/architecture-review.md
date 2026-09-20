# InkFlow 多维度架构与代码评审报告

> 生成于 2026-09-20。输入：`docs/architecture-map.md` 架构图谱 + 三个只读评审代理（后端链路 / 前端结构与竞态 / 共享契约层）+ 主代理对头号发现的亲自复核。
> 评审框架：code-quality-evaluator 五维加权评分 + improve-codebase-architecture 深模块候选 + code-review Fowler 坏味道基线。
> 本报告为**抽样静态评审**，未运行时复现全部问题；评分不代表发布就绪结论。

## User-confirmed facts

- 用户要求：对图谱做多维度评审（代码简化、架构优化、链路审查、代码审查等）。
- 项目：InkFlow，本地优先 AI 协作小说写作工具（Electron + Express + SQLite + React）。

## Assessment scope

- **规模**：Large repo（src + server + shared 非测试代码约 11.4 万行；测试 205 后端 + 143 前端文件）。
- **Files sampled**（三代理通读/精读）：server.ts、electron.cjs、routes/{db,production,skills,audit,agents,chapter-completion,simple-llm,search,export,index}、helpers/{governed-llm,llm-execution-gate,quota-guard,ai-production-pipeline,sse}、lib/{db-instance,server-llm,config,request-timeout,chapter-index}、embedding/vector-store、shared/lib 54 文件 import 图全量 + quality-gates/prompt-sanitizer/quality-contract/slop-scorer 精读、src 的 App/AppShell/EditorView(目标区段)/useDraftGeneration/db-transport/sse-client/draft-stream/WritingSurface(关键段)/12 个 store、tests/architecture-boundaries.test.ts。
- **Files not inspected**：routes/{world,continuation,agents,onboarding} 执行体、lib/db CRUD 实现、capabilities/ 目录、SkillsStudioView(3314 行)/WorldBibleView/AgentWorkspace/Library/Cockpit 全文、server-llm 请求构造细节、e2e 测试。

## Composite score

| 维度 | 权重 | 得分 | 等级 |
|---|---:|---:|---|
| 可读性与风格 | 25% | 7.5 | B+ |
| 架构设计 | 25% | 7.5 | B+ |
| 重构健康度 | 20% | 6.5 | B- |
| 工程实践 | 15% | 8.5 | A- |
| 坏味道 | 15% | 6.0 | B- |
| **加权总分** | 100% | **7.2 / 10** | **B（良好）** |

**最重要的结论：三个域均未发现 P0**（无数据损坏路径、无安全洞）。已存章节数据有质量门、候选 baselineHash、代际头、flushBeforeNavigation 四层防护。问题集中在：治理护栏的概率性、结算路径的分支不对称、job 样板重复、以及若干竞态窗口。

## Repository evidence（扣分项均带锚点）

### P1 findings（8 条，均已验证）

1. **[治理] 消毒晋升门生产路径被绕过**（主代理已复核）：`promoteToRuntimeReady`（score≥70 门，prompt-sanitizer.ts:208-233）全仓仅测试调用；真实端点 `/api/skills/sanitize/:assetId`（skills.ts:259-299）对 template 只走轻量 `sanitizeWhiteLabelText` 正则替换，无命中统计、无评分门，即落 `runtime-ready + active`。缓解：runtime 侧过滤（capabilities/manifest.ts:193-198）+ 前端投影白名单（capability-governance.ts:381,441）兜底；且 Plan 236/CORR-02 已修过一次双正则分裂——护栏存在但非保证。
2. **[治理] URL 剥除的 `m.includes('api')` 放行**（主代理已复核，比初报更宽）：prompt-sanitizer.ts:137-139 保留一切含 "api" 子串的域名——`rapid…`、`captcha…` 均穿透，不止 `/api/` 路径。另 ：148 宽正则会误删正常文案（如"长篇专用"）。
3. **[后端链路] run 永久卡 running 的漏网点**：pipeline 成功但客户端已断开、且保底稿未落库时，`.then` 首行早退（production.ts:1087），run 永久 `running`、配额不 commit 不 refund；无 reaper 清理 running 态 run，apply 只接受 review_required/failed（:1444-1448）→ 该 run 永不可用。配额兜底仅靠下次 reserve 触发的 1h sweeper（quota-guard.ts:70-78）。
4. **[后端链路] 同章并发 start-stream 无互斥**：initializeProductionRun 不检查活跃 run（production.ts:251-368）→ 双配额预占；apply 端 baselineHash 挡住第二个（:1543-1553），但该 run 永久卡 review_required 且报因误导。
5. **[前端竞态] 流式期间用户输入可被静默丢弃**：生成时正文框不锁定（WritingSurface.tsx:309），失败回滚到流开始前捕获的 baseline（useDraftGeneration.ts:278-281,380-386），prop 渲染期覆盖本地态（WritingSurface.tsx:90-95）→ 用户手打未存字在失败时丢失。仅丢未保存输入，故 P1 非 P0。
6. **[前端竞态] sse-client 无任何超时**：连接挂起（不断开不吐数据）时 isGeneratingContent 永久 true，只能手动停止（grep timeout 零命中；IncompleteDraftStreamError 只覆盖提前断开，draft-stream.ts:42-44）。
7. **[质量门] 三层门是中文正则/统计启发式**：字多样性<0.2 拒、虚词占比、GENERIC_STYLE_PATTERNS 打分（quality-gates.ts:107-127,184,203-222）——对话密集/悬念短句天然压低指标，好文可被误杀；语义类 P0 默认 'unknown' 不在此层把关。
8. **[契约] zod 与 shared TS 双轨维护**：zod 仅在 server 做请求校验（validation.ts 约 157 处），不 import shared/types、不用 z.infer 回填；NovelRow 与 Novel 手工镜像（db-mappers.ts:61-75）——任一侧改字段即静默漂移，仅运行时暴露。

### P2 findings（择要）

**后端**：apply 与编辑器 autosave 单向防护，FIFO 顺序可把新稿覆盖回旧文（db.ts:241-307 无内容级 CAS，推断，前端 apply 后行为未验证）；SSE 长请求无整体超时（headersSent 后全局超时变 no-op，request-timeout.ts:14-18）；配额结算 7 处散点自管而非统一出口（settleQuotaReservation 已存在，production.ts:553-1306）；代际守卫可省略字段绕过（db.ts:299-306，本机单用户下非安全洞）；TTL 清理会 abort **运行中**的 job 且前端拿到 404 而非 failed（world.ts:517、audit.ts:76-82、agents.ts:240-243）；monetization 开启时 crash 丢 reservation Map 无法 refund（quota-guard.ts:67）。

**前端**：App.tsx:53-57 离开编辑器不清 capabilityLaunchState，残留可被重新消费，project 级技法动作无章校验（推断）；EditorView key 含 approvedPackId（AppShell.tsx:1337），换续写包重挂载整个编辑器丢 undo 栈；db-transport 合并不分实体类型，任何变更唤醒全部订阅者全量刷新；助手正文写入 updateChapter 不带代际，跨标签页 TOCTOU 盲覆盖窗口（AppShell.tsx:845-849）。

**共享层**：shared/lib import 图无循环依赖、无上帝模块（架构边界有测试兜底，architecture-boundaries.test.ts:10）；约 9 个 lib 实际单端消费属伪共享（prompt-runtime 仅 server 等）；sha256、capability-composition 属准私有可下沉。

### 代码简化（可直接执行）

- **死代码（零引用已验证）**：SplitWorkspace.tsx（146 行）、lib/glossary.ts、lib/prompt-quality.ts——可直接删。
- **job 样板 ≥5 份手写复制**：audit/agents/world/continuation/onboarding 各自实现 Map+AbortController+TTL+poll+cancel，skills.ts:78 已示范抽 helper。
- **production.ts start 与 start-stream 约 120 行序幕复制**且语义分叉（非流式版只产保底稿不跑管线，:511-555）无注释说明。
- **provider 识别 Shotgun Surgery**：isGoogle/isMiniMax/isDeepSeek URL 子串特判（server-llm.ts:151-192），google 判定在 model-discovery.ts:42-63 又写一份。
- **重复实现**：两套 LLM JSON 抽取（model-json.ts vs extract-skill-json.ts）、两份消毒词表（prompt-sanitizer.ts:65 vs :152，CORR-02 已部分合并）。
- **巨型组件拆分点（均有现成测试兜底）**：先拆 AppShell 助手编排（:689-929，风险低）→ EditorView capability launch 消费块（:1660-1870，风险中）。
- **Speculative Generality**：quota 机制在 monetization 默认关闭时（quota-guard.ts:87-89）维护成本与启用面不匹配；validateAssetV2 生产未调用。

## 链路审查结论（四链）

| 链路 | 判定 | 主要缺口 |
|---|---|---|
| 章节生产链 | 数据保护扎实，**结算不对称** | P1 #3 #4；配额 7 处散点；SSE 无整体超时 |
| 数据读写链 | 健壮（写队列异常不断链、SSE 指数退避重连、回声忽略、500ms 合并） | 代际可省略绕过（低危）；合并窗口全量刷新 |
| 长任务 job 链 | 可用但粗糙 | TTL 杀运行中 job；重启丢 job；5 份样板 |
| 能力治理链 | 概率性护栏 + 投影白名单兜底 | P1 #1 #2；评分门旁路；双正则历史分裂 |

## 架构优化候选（深模块视角，按推荐强度）

1. **【Strong】统一 JobRunner**：5 份 job 样板 → 1 个深模块（含"过期置 failed 而非 abort"语义，顺带修 P2 #8 类问题）。删除测试通过：删 5 份复制、集中复杂度于一处。precedent 已存在（skills.ts:78）。
2. **【Strong】消毒单轨化**：merge `sanitizeWhiteLabelText` 进 `analyzeAndSanitize`（唯一词表+命中统计），消毒端点接入评分门或显式注释豁免理由。位于当前开发热区（近 40 提交最密集域），爆炸半径小，测试现成。
3. **【Strong，先决策】配额机制去留**：先做 ADR——monetization 是否真会启用？启用 → 统一 settleQuotaReservation 出口（修 P1 #3 的漏网点）；不启用 → 整体删除这层 Speculative Generality。
4. **【Worth exploring】契约单轨化**：zod schema 为源、z.infer 回填 shared 类型，先从 Novel/Chapter 等核心 5 类渐进开始（面大，风险中）。
5. **【Worth exploring】AppShell/EditorView 外科拆分**：按上述拆分点顺序做，遵守 AGENTS.md 小改原则，每步有对应测试。
6. **【Worth exploring】provider 识别归一**：isXProvider 收拢为单一 provider-profiles 模块。
7. **【Speculative 不建议动】** db-transport 按实体类型过滤广播：需改后端事件负载，风险中高，当前单机规模收益不足。

**Top recommendation：#2 消毒单轨化。** 理由：它是唯一同时满足"P1 治理完整性问题 + 位于开发热区（改动频率最高意味着最容易再踩）+ 小爆炸半径 + 有测试兜底"四条件的事项；#1 JobRunner 其次（机械、面广但低风险）。

## Inferences（推断，未完全验证）

- apply 与 autosave 的 FIFO 覆盖窗口（后端 #3，前端 apply 后在途 autosave 行为未读）。
- capabilityLaunchState 残留的实际触发频率（窗口小）。
- WritingSurface 300ms 防抖与 prop 重置的输入丢失（同根未复现）。
- quota 在实际发行配置中的开关状态。

## Unknowns / limits

- 未运行测试套件验证 findings（静态评审）；348 个测试文件的存在是工程实践得分的依据，非本次正确性证据。
- world/continuation/agents/onboarding 路由执行体、capabilities/ 目录未逐行审。
- 所有评分基于抽样；"误杀率"类结论是机制推断，无量化数据。

## Top improvements（按优先级）

1. 修消毒端点：接入评分门或统一消毒函数（P1 #1 #2，热区，小改）。
2. 提取统一 JobRunner，过期语义改为 failed 而非静默 abort（消 5 份样板 + 修 job 链缺口）。
3. 补齐生产 run 生命周期兜底：running 态 reaper + 配额结算统一出口（P1 #3 #4）。
4. sse-client 加 idle/整体超时；生成期间正文框 readOnly 或失败回滚前提示未保存输入（P1 #5 #6）。
5. 删除三个零引用文件 + 下沉两个准私有库（10 分钟级收益）。

## Highlights（值得保持的优点）

1. **分层纪律真实生效**：shared/lib 无循环依赖、无上帝模块，且有 architecture-boundaries 测试兜底——多数仓库的"分层"只存在于口头。
2. **数据保护多层纵深**：代际守卫、baselineHash、apply 事务内复验、FIFO 写队列异常不断链、候选-接受两阶段——三域评审均未发现丢已存数据的 P0 路径。
3. **工程自动化完备**：348 个测试文件、覆盖率门槛、lint 零警告、pre-commit 门、E2E、测试库按 PID 隔离；全库 TODO/FIXME 为 0。
4. **注释解释 why**：CORR-02 / Plan 236 等注释记录了缺陷演化史和修复动机，是少见的自我审计痕迹。
