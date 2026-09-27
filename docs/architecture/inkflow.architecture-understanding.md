# InkFlow 墨影 — 架构理解

**这是什么**：一份当前状态（as-is）的架构模型，回答「这个系统是什么、边界在哪、作品数据怎么被改动、改哪里会牵连到什么」。
**不是**：架构图集、评审打分、或改造建议。风险与技术债评估请走 `risk-quality-reviewer`，迁移路线走 `evolution-planner`。
**取证日期**：2026-09-18（HEAD `84fb175`）。逐条证据与置信度见 `inkflow.evidence.md`。
**复核于**：2026-09-28（HEAD `4b68c24`，Plan 263 E7）：补「十一、知识谱系」「十二、能力链路」两节（Plan 261 / Plan 262 新增链路，均不在 2026-09-18 取证范围内）；计数面复核见 `docs/architecture-map.md` 的复核行（2026-09-23 / `51954f2`，后端 212 / 前端 149 测试文件）。

**生产方式**：`system-modeler` + `c4model`（结构与边界）叠加 `flow-visualizer` + `graphviz`（业务流与生命周期），并按 `business-application-fitness` 要求以业务语言优先。

---

## 一、系统边界：一句话版本

一个跑在作者自己电脑上的小说写作工具。它的全部架构特殊性，来自一句产品承诺：

> **AI 提议，作者裁决。**

这句话不是口号，而是被实现成了一组相当硬的机制：**AI 永远不许直接改作品**。任何模型产出都必须先成为「候选」，经过指纹比对、质量门、顺序门，才在**一个事务里**由作者的明确确认动作写入权威存储。理解了这个系统，就理解了 80% 的代码为什么长成那样。

```
作者 ──► 渲染层 ──► Express（唯一写入者）──► ~/.inkflow/data.db
                        │
                        ├──► 外部大模型（唯一出网点，BYOK + 需网络）
                        └──► 本地向量引擎（离线）
```

三条边界事实（全部 H 级证据）：

1. **只有后端能出网。** 渲染层不直连任何模型服务；`server.ts:144` 把 Express 绑死在 `127.0.0.1`。
2. **只有后端能写库。** 前端拿不到 SQLite，靠 75 方法白名单 RPC + 领域 REST 间接操作。
3. **本机数据永不出机。** `data.db` 固定在 `~/.inkflow/`，开发与打包同路径，不进 bundle。README 的「本地优先」在这里是可验证的，不是营销词。

---

## 二、最该先纠正的直觉：候选**不是一张表**

新人最容易犯的错，是假设存在一个统一的「AI 候选」概念、一张候选表、一个 accept 端点。**实际是四套互不相同的机制**，而且其中两套**根本不入库**：

| 内容形态 | 候选存哪 | 确认端点 | 落库效果 |
|---|---|---|---|
| **A 大纲 Canon** | 入库 `canon_patches(status='pending')` | `POST .../canon-patches/:id/accept` | 新建 `outline_artifact(source='ai-proposal')` + 激活；`replace` 时镜像 `novels.global_outline` |
| **B 设定结构化核** | 入库 `creative_artifact_candidates` | `POST .../artifacts/candidates/:id/accept` | 写版本 + upsert 权威核 + 钉 provenance + **级联把下游依赖标为待复核** |
| **C 章节正文** | **不入库** —— 前端预览态 + `baselineHash` | RPC `acceptChapterContentCandidate` | 旧文本先入 `chapter_versions`，再 UPDATE 正文（同一事务） |
| **D 连续性事实** | **不入库** —— 由 run 的连续性报告**读时派生** | `POST .../fact-candidate/apply` | 仅 `accepted` 事实写道具/地点/境界/时间线/伏笔核 |

由此推出两条容易被忽略的强约束：

- **「Canon」不是一张表**，而是 `(novel.worldRules, 当前激活的 outline_artifacts)` 算出的**指纹集**（`getCanonFingerprint`）。所以「写入 Canon」语义上等于「激活一个大纲工件」，不是「往 canon 表插一行」。
- **C 是 D 的前置**。正文没落库就不许裁决事实，硬拒 `CHAPTER_FACT_MANUSCRIPT_NOT_ACCEPTED`。这不是 UI 引导，是服务端事务内的顺序门。

> 图示：`candidate-store-model.dot`（四路下钻）、`flow-chapter-candidate.dot`（业务泳道）。

### 四条路径同构的安全契约

四套机制共享同一套并发与原子性约定，这是本仓库最值得信任的架构纪律：

```
FIFO 串行写队列
  └─ databaseGeneration 乐观并发比对 ──不符→ 丢弃在途写入 → 409 *_GENERATION_STALE
       └─ 单事务：状态翻转 + 权威写入 + 审计留档 ──失败→ 整体回滚
            └─ 仅在实际变更时 notify() → SSE 广播 → 前端 500ms 合并刷新
```

而且这些**不是只看代码得出的结论** —— 回滚、幂等、跨作品隔离都有测试直接钉住：

- 2 操作补丁第 2 条失败 → 补丁仍 `pending`，active 卷数 = 0（`tests/canon-patches.test.ts:38-39`）
- 连 accept 两次 → 结果 `deepEqual` 且通知计数不变（`:29`）
- 跨作品 accept → `CANON_PATCH_CONFLICT`，他作内容零变化（`:31-32`）
- stale / 越界 → 正文与版本表**双双零变化**（`tests/chapter-candidate-acceptance.test.ts:44-61`）

---

## 三、治理门：两道，不是一道

系统里有两类门禁，职责完全不同，混为一谈会导致改错地方。

**① 生成侧质量门**（`server-llm.ts:635-725`）
提示门 → 生成 → 输出门 → 自我纠错重试 1 次 → 仍不合格则**抛 `quality_rejected`，不返回低质草稿**。
这条很反直觉但极重要：失败路径宁可报错，也不用「凑合能看的文本」冒充成功。

**② 落库边界门**（`db/chapters.ts:216-224`）
质量复检放在**写的边界**，不在读的路径上 —— 意味着绕过 UI 直接打 RPC 也拦不住。

**③ 白标消毒门**（独立于上述两者，安全语义）
`sanitize-required` 候选来自广场共享与第三方去构造，正文可能带原作者署名、联系方式、竞品品牌词。
不变式：**渲染投影只允许两条路径** —— `getOptionalStyleAssets()`（只放 `sanitizationStatus==='runtime-ready'` 的条目）与 `getSanitizeRequiredAssets()`（**只投影壳字段，绝不投影正文**）。正文解锁必须走服务端 `/api/skills/sanitize`，产出 `sanitized-` 副本落库后由前端消费副本。

> 这条不变式有 `AGENTS.md` 背书、有守护测试、有独立规范文档，是改 `capability-governance.ts` 或任何货架投影面前的必读项。

---

## 四、分层：不是「目录看起来像」，而是测试钉住的

`tests/architecture-boundaries.test.ts` 用断言把依赖方向锁成单向，违规集必须为空：

```
        shared/   ← 无依赖领域内核（types 17 + lib 52 + config 资产）
        ↗     ↖
   server/     src/      （二者互不得 import）
```

- `server/ ↛ src/`，`src/ ↛ server/`，`shared/ ↛ 两侧`，生产代码 `↛ tests/`
- `src/components/**` 禁裸 `fetch()`，REST 必须走 `src/lib` 客户端；3 个白名单例外全是流式/二进制语义
- **唯一例外登记在册**：`src/tests/p0-ai-trust.test.ts` 直连服务端分类器，注释明写「新增须先做明确决策」

**`shared/lib` 是这套架构的脊柱**：同一份消毒逻辑、质量门、状态账本、故事记忆投影，被服务端和前端同时 import。治理语义前后端一致，靠的就是这里。

代价也在这里：`shared/lib/public-skill-catalog.ts` 单文件 **7158 行**，且是生成产物。文档自己承认现在是**双库**（治理注册表源 vs 生成产物），合并留待后续。内核膨胀风险集中在这一个点上。

> 图示：`module-map.dot`（含被禁止的方向，红色区）。

---

## 五、生命周期：哪些状态真的在迁移

`lifecycle-states.dot` 把状态机分成了三区，区分标准是**行为证据**而非类型声明。

**① 裁决类（证据完整）**：`canon_patches`、`creative_artifact_candidates`、`outline_artifacts`、`chapter_production_runs` —— 迁移、幂等、终态保护、CAS 过期全都有代码和测试。

**② 作业/流程类（含崩溃恢复）**：资料解析作业有 `checkpoint_json` + `batch_cursor`，进程重启时启动清扫把 `running|queued` 批量置为 `interrupted`，再经 `/resume` 续跑。这是**真断点续写**，不是口号。章节完成度则是一条 5 阶段有序相（`writes-flushed → … → facts-proposed`），**倒退直接抛错**。

**③ 声明但未接线（不得当作业务事实）**：

| 声明的状态 | 实情 |
|---|---|
| `chapter_production_runs: 'rejected'` | **死字面量**，全 `server/` 无写入点 |
| `SetupTaskStatus: 'confirmed'` | 无写入方 |
| `IdeaFragment: 'converted'` | 无写入方 |
| `foreshadowings: planted/hinted/payoff` | 无直接赋值，仅派生计算 |
| `ReviewIssue.status`（7 值） | **只在客户端置位**，无服务端路由改写 |
| `novels.status` | 仅 CRUD 透传，无状态机 |

这张表的价值在于：读代码时若把 ③ 当既有环节去改，就会**凭空发明行为**。

---

## 六、运行时：三态同码，两种拓扑

| 形态 | Express 位置 | 端口 | 关键差异 |
|---|---|---|---|
| `npm run dev` | 同进程（Vite middlewareMode 内联） | 3000，可 +1 漂移 | 浏览器人开；dev 令牌端点三重门 |
| `electron:dev` | **独立进程**（脚本派生，外壳不 spawn） | 3000 固定 | 外壳只 `waitForServer` |
| 打包发布 | **`child_process.spawn` 子进程**（非主进程、非 `utilityProcess`） | pin 死 | stdout 单行 JSON 端口握手 |

三条非显性但极重要的设计：

- **信任前置**：`/api/identity` 探活通过才 `loadURL`。不匹配返回 404，因而**探测本身不泄露任何信息**。
- **重启必须 pin 端口**：换端口就抛「refusing unsafe renderer reload」。原因写在代码里 —— 渲染层内存中挂着未落盘的写入队列，重载连到另一个端口会让它接错服务器。**宁可拒绝重载，也不冒丢稿的险。**
- **关闭握手有逃生门**：`idle→awaiting-renderer→complete|blocked`，超时或保存失败进 blocked，弹四按钮对话框（重试 / 导出到文件 / 放弃并销毁 / 取消）。丢稿场景被当成必须给出路的状态，而不是异常抛出。

**密钥边界**：打包态 API Key **从不写进 `config.json`**，走 `safeStorage → secure-key.bin` 0600，只经环境变量注入子进程。Web 开发态则 AES-256-GCM 加密后落盘。

**CSP 在 Express 侧（helmet）而不是 Electron 侧** —— 一个不常见但合理的取舍：单一后端同时服务桌面与 Web，安全头就近在同一处下发。

> 图示：`runtime-topology.dot`。

---

## 七、诚实性：贯穿三处的同一套价值观

这个系统在「不能确认」时的反应是一致的，这是最有辨识度的架构特征：

| 场景 | 不能确认时 | 而不是 |
|---|---|---|
| LLM 连通性 | 三态里的 `'unknown'` + 琥珀色 + 本地可继续写作的指引 | 乐观回退成「已连接」 |
| 生成质量 | 抛 `quality_rejected`；全失败时草稿以「**待改进预览**」交付 | 把低质文本当成功返回 |
| 嵌入可用性 | 无 Key 抛 `EmbeddingUnavailableError` | 伪造 provider 调用 |
| 上下文预算 | 收据如实记录 `truncated` 与 `injectedChars` | 静默截断 |
| 连续性审计 | `auditMeta` 允许 `'not_run'` / `'unknown'` | 省略即代表通过 |
| 内部状态名 | 禁止 `STATE_UNKNOWN` 等直出为用户文案 | 泄露实现细节 |

守护测试明确存在（`src/tests/llm-availability.test.ts` 等）。**这套「不确定就说不确定」的纪律是本仓库最强的架构不变式**，比任何分层规则都更成体系。

---

## 八、AI 代理能否安全地改这个仓库？

`AGENTS.md` 质量偏高，且**是领域导向的，不只是构建命令清单**：四条技术不变式各自指向一份 `docs/specs/*.md`，并写明「改动哪些文件前先读哪份」。测试命令按改动区域映射。多 Agent 并发有硬隔离（禁写运行中的 `data.db`、凭证继承、不同子任务不得同改一源文件）。

**已覆盖的回归路径**：SQLite 备份/导出/导入、LLM 状态诚实性、驾驶舱→编辑器路由、能力消毒/白标安全。

**仍 underspecified 的（是发现，不是遗漏就好）**：

- 四类候选路径在 `AGENTS.md` 里**没有作为一条不变式出现**。新人最可能犯的错正是把 C/D 类候选误当「有表的候选」去改，或破坏 C→D 的顺序门。
- `chapter_production_runs` 的 `applied` 是事实裁决的前置条件，这条跨实体顺序依赖无文档承载。
- 状态机的 ③ 区（声明未接线）无任何标注，代码读者会自然地把它们读成已存在的环节。

**验证资产相当厚**：后端 `node --test` 并发 4 且每 worker 独立临时库；前端 vitest 144 文件、显式 `maxWorkers:1`；Playwright 18 个 spec 跑**已构建产物**、把 config 指向黑洞端口 `127.0.0.1:9` 以**确保永不真调 Provider、永不读真实凭证**；CI 覆盖率是**棘轮式**（90/80/85）且 `npm audit` 豁免表**故意留空并带到期日**；提交门经 `node` 直调本地二进制，防止全局 npm 损坏时门禁静默失效。

这套验证设计的成熟度明显高于同规模项目均值。

---

## 九、改哪里会牵连到什么（速查）

| 你要动 | 必然牵连 | 先读 |
|---|---|---|
| 任一 accept/reject 路径 | 四路同构的世代守卫 + 事务边界 + CAS 判据 + `notify()` | `docs/architecture/candidate-store-model.dot` |
| 生产运行状态 | `applied` 是事实裁决前置，改状态等于改顺序门 | §C3 顺序门行 |
| `shared/lib/*` | **前后端同时受影响**；跑 `npm test` + `npm run test:frontend` | `AGENTS.md` 测试命令地图 |
| 货架/投影/消毒面 | 白标泄露失效模式；两条路径不得增第三条 | `docs/specs/capability-sanitize.md` |
| 备份/导出/导入 | 运行中禁止物理拷贝 WAL 主库；`db.backup()` 快照 + 临时文件零残留 | `docs/specs/sqlite-backup.md` |
| LLM 可用性展示 | 异常统一 `'unknown'`，禁止乐观回退 | `docs/specs/llm-status-honesty.md` |
| 驾驶舱推荐动作 | 就绪后静默首发执行，不是静态面板切换 | `docs/specs/cockpit-routing.md` |
| 后端进程生命周期 | 端口 pin、关闭握手、待写队列三者耦合 | `runtime-topology.dot` |
| `data.db` schema | **无版本化迁移**：幂等 CREATE + `ensureColumn()` ALTER；无 `user_version` | `db-init.ts:253-708` |

**最后一条值得单独强调**：这个仓库**没有**迁移框架，靠幂等建表 + `ensureColumn()` 加列。没有 `schema_version` 表。所以「加个迁移文件」在这里不是默认动作 —— 任何 schema 变更都要按 `ensureColumn` 的既有形态写，且要考虑老库升级路径。

---

## 十、本次模型仍不知道的事

按优先级，全部列为验证任务（详表见 `inkflow.evidence.md §F`）：

1. **回退是「前端组装的一次普通保存」**：服务端没有 `restore` 端点，`DB_WHITELIST` 里只有版本表的读写四个方法；点「恢复此版本」＝按 id 取全文 → 走既有编辑保存链路。README 的承诺成立，且这条链路照样带世代守卫。残留问题：**回退前不会给被覆盖的当前文本留快照**（常规 `updateChapter` 不写 `chapter_versions`），连续试几个版本时中间态只活在前端 undo 栈里。
2. **打包态模型权重落点未度量**：若 cacheDir 落在 `.app` 卷内且卷只读，首启语义检索可能整体失败。
3. **消毒不变式有一处调用点不做过滤**（`useEditorIntelligenceContext.ts:107-119`）。当下无原文外泄 —— 因为生成产物恰好零条待消毒 —— 但**安全性依赖生成器而非调用点**。
4. `legacy-artifact-structuring/confirm` 与 `capability-migration/apply|confirm` 是否构成第五、六类裁决门，未判定。
5. `/api/audit` 与 world 作业存进程内 `Map`，重启即失，与已落库的 continuation 作业不一致 —— 是否有意为之未证。
6. `Scene` 类型无表无 CRUD，疑为残留模型。

**本次未运行 `typecheck` / `npm test` / E2E**，全部为只读静态取证。因此「测试当前通过」不在本文断言范围内。

---

## 十一、知识谱系：从资料包到可注入的图谱

> 本节的取证日期是 **2026-09-28**（HEAD `4b68c24`，Plan 263 E7 补写）；2026-09-18 的取证未覆盖这条链路。

作者导入的「续写资料包」里除了正文，还有**逐章细纲 / 遗物体系 / 公理**这类结构化素材。知识谱系就是把它们从文档变成两类可查询的权威行，再送进写作提示词：

```
续写资料包 ─► 解析（幂等）─┬─► foreshadowings（伏笔台账）─┬─► loadForeshadowingContext ─► planner/writer/critic 提示词
                          └─► entity_relationships（图谱边）┴─► buildStoryStateLedger ──► chapter contract（开放伏笔）
```

- **解析与落库**（`server/helpers/knowledge-lineage.ts`）：`extractXigangEntries(markdown)` 解析 `### Ch001 · 标题` + 字段行得到 `XigangEntry[]`（含标题/目标/情节点等字段），`extractElementProposals` 产出叙事元素提案。写入是**幂等**的：伏笔台账按 `title + plantedChapterId` 去重、图谱边按 `source + target + type` 去重；只写确定性事实，**不自动删既有行**（提案制），文档更新后可重跑增量补齐。
- **命令入口**（`server/cli/knowledge-lineage.ts`）：`npx tsx server/cli/knowledge-lineage.ts <novelId>`（入库 + 覆盖度报告）、`propose <novelId>`（叙事元素提案）、`confirm <novelId> [--all]`（确认提案入道具库）。向量索引初始化走 `server/cli/vector-init.ts`。
- **消费路径 A：伏笔上下文**（`server/helpers/knowledge-lineage-enrich.ts:242 loadForeshadowingContext(novelId, chapterOrder)`）返回 `toPlant` / `toPayOff` / `arrears`（欠账，注入前按 `MAX_ARREARS_IN_PROMPT = 12` 截断）/ `relatedCharacterNames` / `promptBlock` / `checklistBlock`；由 `server/helpers/ai-production-pipeline.ts:412-417` 接入 —— planner（`:455`）、writer 整章与分场景（`:553`、`:601`）加 `promptBlock`，critic 加 `checklistBlock`（`:891`，逐条核对「应埋/应收」）。无台账时返回空块，不阻断生成。
- **消费路径 B：故事状态账本**（`server/routes/production.ts:295` → `shared/lib/story-state-ledger.ts:110 buildStoryStateLedger`）：把开放伏笔等状态聚合成账本，再由 `shared/lib/chapter-production.ts` 渲染进 planner / writer 的章节合同；`shared/lib/story-memory-projection.ts` 负责投影面。
- **可执行能力面**（与第十二节的能力引用同一入口）：`POST /api/novels/:novelId/knowledge-capabilities/:assetId/run`（`server/routes/utilities.ts:53`，内核 `server/helpers/knowledge-capabilities.ts:40 runKnowledgeCapability`）。两张工具卡：`knowledge-extract`（重跑摄入，返回覆盖度；二跑 `ledgerInserted=0` 即位级幂等）与 `foreshadow-settle`（返回核对清单：待收/欠账/未回收数）。错误码：`KNOWLEDGE_INVALID_INPUT` / `KNOWLEDGE_CAPABILITY_UNSUPPORTED` / `KNOWLEDGE_NOVEL_NOT_FOUND` / `DATABASE_GENERATION_STALE` / `KNOWLEDGE_INTERNAL_ERROR`。
- **观察面**：记忆健康度五项指标（`shared/lib/memory-health.ts` + 驾驶舱 `src/components/MemoryHealthPanel.tsx`），其中「伏笔欠账」是唯一带硬阈值的指标（`arrears > 12` ⇒ 琥珀 + 阈值说明）；维护入口在「世界」图谱页（`src/components/KnowledgeMaintenancePanel.tsx`）与伏笔面板的折叠入口（`src/components/ForeshadowingPanel.tsx`）。
- **仍未证实**：真实作品的资料包覆盖率（现有覆盖度报告只在开发样本上跑过）；图谱边除 `entity_relationships` 外是否还有隐藏写入点；提案制的「只增不删」在长期使用后是否会造成台账臃肿。

## 十二、能力链路：技能序列流怎么把「卡」送进提示词

> 本节的取证日期是 **2026-09-28**（HEAD `4b68c24`）；2026-09-18 的取证只有「候选/治理门」视角，没有链路编排与卡片引用面。

「能力链路」（技能序列流）是一组**按步骤推进的写作流程**：链路 → 步骤 → 步骤声明的资产/卡 → 提示词。定义在 `shared/lib/prompt-governance-catalog.ts`（`SKILL_SERIES_FLOWS`，:881），共 6 条：`xiaofeiji-novel-flow`（:883）、`generic-novel-flow`（:1023）、`tomato-platform-flow`（:1114）、`book-deconstruction-flow`（:1201）、`fenghua-short-flow`（:1257）、`tianma-outline-flow`（:1340）；生成物是 `shared/lib/public-skill-catalog.ts`（禁止手改，用 `scripts/generate-public-catalog.ts` 再生）。

每一步是一个 `SkillSeriesFlowStep`（`shared/types/prompt-assets-governed.ts:255`）：`stage`（planner/writer/critic，声明优先）、`assetId`、`cardRef?`、`capabilityRef?`、`gate?`、`guidanceOnly?`。三种引用是**三条互不替代的通道**：

| 通道 | 解析器 | 结果去向 |
|---|---|---|
| 资产正文（`assetId`） | `isRuntimeReadyAsset` + `!isShellTemplatePrompt` | 注入步骤提示词：`步骤合同 + 【可运行资产 Prompt】 + 卡正文` |
| 卡片引用（`cardRef`） | `shared/lib/flow-step-card-slot.ts:68 resolveFlowStepCard` | 按声明阶段进 `stagePrompts`，**同一阶段优先于资产正文**（只挂一份） |
| 能力引用（`capabilityRef`） | `shared/lib/flow-step-capability-ref.ts:64 resolveFlowStepCapability` | **不注入提示词**；只产出可执行能力元数据（assetId/title/kind/action/stages/scope），执行走第十一节的知识能力端点 |

**装配与注入**（`server/helpers/writing-style-service.ts:1164 buildFlowStep`）：取当前步骤 → 判定资产可用性 → 拼 `flowStep.prompt` 与 `stagePrompts`；真正读的地方是 `flowStepPromptFor(stage)`（`:2026-2031`）—— `stagePrompts[stage] ?? (step.stage === stage ? step.prompt : undefined)`，再过 `!isShellTemplatePrompt` 过滤。执行快照的 `stagePrompts` 是 planner / writer / critic **解析后**的读法，生产 / agents / audit / world 四条路由都从这里取。

**质量门**：每步一个 `gate{kind}`，已从旧 `qualityGate` 字段收敛为三类 —— `advisory`（文本门）/ `mechanical` / `critic`（34 步 = advisory 32 / mechanical 1 / critic 1）。

**可用性读数**（2026-09-28，Plan 262/263 后，`scratch/capB-chain.ts`）：34 步 / 可运行 **28（82.4%）** / 仅引导 **6** / `cardRef` 6 步 / 能力引用 2 步 / 被引用资产 28 / 目录 189。余下 6 个「仅引导」步骤**恰是已挂 `cardRef` 的 6 步** —— 它们的卡片正文已经由卡片通道进入提示词，但 `assetId` 仍是平台转投壳，所以可用性读数仍作「仅引导」（口径治理面未收口，已登记）。

**守门与证据**：`tests/flow-step-guidance.test.ts`（声明集合 == 检测到的壳集合、静默壳 0）、`tests/flow-step-stage.test.ts`（阶段分布）、`tests/flow-chain-determinism.test.ts`（串台对照 34×33）、`tests/flow-step-capability-ref.test.ts`（六诊断码 + 执行面）；读数脚本 `scratch/capB-chain.ts`，提示词哈希快照 `scratch/stageprompts-snapshot.ts`（六场景）。

**仍未证实**：卡正文对生成质量的因果影响只有「文本是否进提示词」层面的证据，没有质量测量；「assetId 与 cardRef 的可用性语义」仍是治理面口径债。

## 阅读顺序建议

1. `inkflow.structurizr.dsl` 的 `01-system-context` —— 先确立边界
2. `inkflow.structurizr.dsl` 的 `02-containers` —— 再看可部署单元
3. `flow-chapter-candidate.dot` —— 业务主链路，作者视角
4. `candidate-store-model.dot` —— 技术下钻，四条路径
5. `lifecycle-states.dot` —— 状态迁移的能与不能
6. `module-map.dot` —— 动手改代码前的分层地图
7. `runtime-topology.dot` —— 只有碰进程/打包/密钥时才需要

用 Qoder 的 **Structurizr DSL 预览器**打开 `.dsl`，**DOT 预览器**打开 `.dot`。
本机已安装 Graphviz，6 张 `.dot` 均已按 `README.md` 的命令验证可直接渲染 SVG（`candidate-store-model.dot` 与 `flow-chapter-candidate.dot` 依赖文件内的 `newrank=true`，缺失会 Abort trap 6）。仓库不提交 SVG 派生物：`.dsl`/`.dot` 是事实源，渲染件是派生物。
