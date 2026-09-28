# 处置计划（按优先级，每条带验收）

来源：`architecture-review.md`。排序依据 = 零容差项优先（作品数据完整性、白标合规）→ 恢复可信反馈回路 → 结构债清账。
工作量记法 S/M/L 指改动面，不是等待时长。

> **复核于 2026-09-28（HEAD 8a8afb7）**：「本轮未执行任何一项」指 2026-09-18 诊断轮。此后各条已被分批执行，
> 下列状态以**代码取证**为准（不采信文档自述）；❌ 未做 / ◐ 部分 / ✅ 已做。
>
> | 项 | 状态 | 证据（2026-09-28） |
> |---|---|---|
> | M1 静态门 | ✅ | `eslint.config.mjs` ignores 含 `.tdai`；`package.json:26` lint 作用域 = `server src shared tests scripts`；`npm run lint` exit 0 |
> | M2 会话隔离 | ✅ | 按 Plan 263 E4（`86ebb62`）收口：不采用 worktree，改为两条硬规则入 `docs/specs/multi-agent-workflow.md`（同一 checkout 串行写入 / 每单元提交）；**仍为约定而非技术强制**。无竞争基线已取得（全量后端 1465 用例 275.8s；全量前端读数见 Round 46） |
> | M3 仓库卫生 | ✅ | `.gitignore` 含 `gui-test-screenshots/`；`git ls-files '*.png'` = 0（85 张截图从未入库）；`plans/round4*`、`plans/246-249-round42.md` 已入库 |
> | M4 降级诚实性 | ✅ | 降级溯源单源 `deriveRunDegradation`（`src/components/ProductionRunReview.tsx`，DB degradation → `auditMeta.source === 'fallback'` → 直播 prop），详情面板与生产历史列表共用；两条历史用例已补（存量纯保底 run 亮「含降级」／记录字段优先不误报），`src/tests/production-run-review.test.tsx` 16/16 |
> | M5① 竞品词 | ✅ | `shared/lib/prompt-sanitizer.ts:152` 竞品正则并入 + 断言用例 |
> | M5② 判据单源 | ✅ | 新模块 `shared/lib/capability-runtime-readiness.ts`；手抄判据调用点 14 → 0；守卫 `tests/capability-runtime-readiness.test.ts` |
> | M5③ 规格诚实描述 | ✅ | `docs/specs/capability-sanitize.md` 已知缺口段 2026-09-28 改写（含剩余面） |
> | M6 打包态模型路径 | ✅ | 拍板①随包附权重：`scripts/fetch-embedding-model.mjs` 取 `Xenova/bge-small-zh-v1.5` 4 文件（23.3 MB）→ gitignored `build/embedding-model/`，`build.extraResources` → `resources/embedding-model/`；`server/embedding.ts` 的 `resolveEmbeddingAssetPaths` 齐备时设 `env.localModelPath` 并关远程；`electron.cjs` 打包态注入 `INKFLOW_EMBEDDING_MODEL_DIR` 与 `INKFLOW_MODEL_CACHE_DIR`（userData/models-cache）；`scripts/check-package-artifacts.mjs` 增权重断言；`tests/embedding-model-assets.test.ts` 9/9。残余：打包态真机验证未做（需联网拉 Electron 头，本机无网） |
> | M7 版本声明 | ✅ | Plan 263 E3（`86ebb62`）落地：`.nvmrc`/`.node-version` = `22.22.3`、`engines` = `>=22.22.3 <23`、CI 四处 `node-version-file: .nvmrc`、守卫 `tests/node-version-declaration.test.ts` 2/2。**本机仍未满足自声明**：`node -v` = v22.22.0（npm v12.0.2 每条命令告警）→ 需将本机升到 ≥ 22.22.3 |
> | M8 台账指针 | ✅ | 本条 ARCH-01 终态已回填根 `plans/README.md`；`MEMORY.md` 权威指针更正；`TOOLS.md` npm 与权威指针条目更正 |
> | M9 死枚举 | ✅ | `shared/types/novel.ts` `'rejected'` 加 JSDoc 声明未接线；`docs/architecture/lifecycle-states.dot` ③ 区补条目（处置③） |

（原句保留在此供对照：「本轮未执行任何一项」——用户要求的是诊断，M1/M3/M4 属配置与忽略规则改动，等一句确认再动。）

---

## M1 恢复静态门可用 —— 对应 R1 · P0 · S

**动作**
1. `eslint.config.mjs` 的 `ignores` 追加 `.tdai/`（与既有 `'.agents'` 同级，一行）。
2. 就 `.tdai/` 的归属做决定：确认属另一项目 → 迁出仓库（`mv` 到仓库外，保留数据）；确认是废弃残留 → 由用户删除。**不建议由 agent 执行删除。**
3. 顺带审一遍 `ignores` 与 `.gitignore` 的差集：`.tdai/` 是 gitignored 但未被 eslint ignored，这类目录都会成为下一个 R1。
4. **收敛 `lint:fix` 的作用域**（`package.json`：`eslint . --fix`）。实测 `.tdai/` 里有 **34 处可自动修复、涉及 21 个文件**（`prefer-const` ×16、删 unused eslint-disable ×18）；而这些文件是 gitignored ⇒ 未跟踪 ⇒ **改完 git 里没有任何副本可恢复**。一次「看到红门就跑 lint:fix」的直觉操作 = 不可逆的越界写入。建议 `lint`/`lint:fix` 都改为显式路径（`eslint server src shared tests scripts`），把「扫全仓」这个默认去掉。

**验收**
- `npm run lint` exit 0，且耗时降到与产品源文件相称的量级（本轮产品侧实测 784 文件 / 0 error）。
- `git ls-files | wc -l` 与 eslint 实际处理的文件数在同一量级（不再 48% 是外来文件）。
- 复测：单独 `npx eslint .tdai` 应报「all files ignored」。
- `npm run lint:fix` 跑完后 `git status --short` 无新增改动，且 `.tdai/` 的 mtime 不变（防越界写入的回归位）。

**为什么排第一**：门红着的时候，其余每一条风险的回归都无人拦截。

---

## M2 会话隔离 —— 对应 R10 · P1 · S（流程）

**动作**
- 每个并发 agent 会话使用独立 worktree（`git worktree add ../inkflow-<session> <branch>`），或至少约定：同一时刻只有一个会话可写工作树，其余只读。
- ~~现存的半截 Plan 246 改动（R4）先由它的作者提交或明确交接~~ **本轮评审期间已自行解决**：19:53:59 另一会话把它提交为 `20f914c`（良性结局，无工作丢失）。但这正好演示了这条为什么要写进流程：三个会话里任何一个当时执行 `git checkout -- .` / `git stash`，那半截改动就没了。
- 同理，**任何会话在做破坏性 git 操作前必须先看 `git status` 并与其它会话对账**——本轮 HEAD 被移动过一次，说明「我读到的工作树状态」在几分钟后就不成立。

**验收**
- `ps -eo command | grep -c "tsc --noEmit"` 在同一仓库路径下同时 ≤ 1。
- 重跑 `npm run typecheck` 与 `npm run test:unit`，得到可用于比较的基线耗时（本轮耗时数字全部不可用作基线，见 review 四.5）。

---

## M3 仓库卫生 —— 对应 R3 · P0 · S

**动作**
- `.gitignore` 追加 agent 产物目录（`gui-test-screenshots/`，以及任何 `*-screenshots/`、`*.output` 约定的落点）。
- 已有 85 张 PNG：由用户决定归档或丢弃。
- 同时检查 `git status --short` 里的其余未跟踪项（`plans/round41-test-plan.md`、`plans/round42-fix-plan.md`、`plans/246-249-round42.md`、`.zcode/plans/*`）—— 计划文档是应该进历史的资产，长期挂未跟踪等于没有。

**验收**
- `git status --short` 只剩当轮真正在改的源码文件。
- `git add -A; git status` 不会带入任何二进制产物。

---

## M4 收口 Plan 246 的诚实性回路 —— 对应 R4 · P1 · S-M

**动作（补齐计划自己的第 3 条，不是新增需求）**
1. `ProductionRunReview.tsx:351,356` 的兜底顺序改为「DB `degradation.beatsSource` → 历史 run 的 `auditMeta.source==='fallback'` → 直播 prop」，让旧数据也亮。
2. `:378,383` 正文徽标同样读 `degradation.draftSource`（后端已写该字段）。
3. `:365` 分镜告警条改用同一个派生值，别留 prop-only 分支。
4. 历史列表 `:652` 的「含降级」判定与详情面板共用一个派生函数，避免两处再次漂移。

**验收**
- 新增前端用例：构造 `continuityReport = { auditMeta:{source:'fallback'}, degradation: undefined }` 的旧 run → 断言分镜与正文徽标均显示降级（当前会不显示）。
- 新增用例：`degradation.draftSource==='fallback'` 且 prop 为 null（模拟刷新后）→ 断言正文徽标显示。
- 把 `plans/246-249-round42.md` 的 Verify 四项逐条勾掉后再提交。

---

## M5 消毒器单源化 —— 对应 R2 + R5 · P0/P1 · M

**动作（分两步，第一步是安全收口，第二步是结构收口）**
1. **先补运行时的竞品词**：把 `analyzeAndSanitize:65` 的 competitor 正则并入 `sanitizeWhiteLabelText`（或让服务端运行时消毒改调 `analyzeAndSanitize(...).sanitizedText`），并加一条断言用例：输入含裸 `墨流` 的文本 → 输出不含。
2. **再谈单源**：把准入谓词收成 `shared/` 里的一个函数（`isRuntimeReadyAsset(asset)`），13 处调用点改为引用它；`skill-fusion.ts:66-68` 的 `as Skill & {…}` 断言随之消失。
3. 更新 `docs/specs/capability-sanitize.md` 的「已知缺口」段：CORR-02 从「已修」改为如实描述剩余面。

**验收**
- 定向用例：裸竞品词过运行时端点被剥（先红后绿）。
- `grep -rn "sanitizationStatus === 'runtime-ready'" src server shared` 命中数从 13 降到 1（谓词本体）＋ 该函数的调用点。
- `npm test` + `npm run test:frontend` 全绿；`plans/README.md` 的 ARCH-01 行改写为「已单源化」并附终态计数。

---

## M6 钉住打包态模型路径 —— 对应 R6 · P1 · S-M

**动作**
- 在 `server/embedding.ts` 顶部显式设 `env.cacheDir`（与 `env.localModelPath`）指向用户数据目录（与作品库同级），不依赖 transformers.js 默认值。
- 决定并文档化首启网络依赖：随包附带 `Xenova/bge-small-zh-v1.5` 权重，或首启明示「语义检索需联网下载约数十 MB 模型」。
- 更新 `docs/specs/`：「作品记忆不出机」的边界须涵盖权重下载这一对外依赖。

**验收**
- `npm run smoke:package-artifacts` 通过，且打包件里 `.cache`/`models` 不再出现在 `app.asar.unpacked` 下。
- 打包态跑一次 embedding：日志打印实际 `env.cacheDir` 落在用户数据目录；更新 app 后缓存仍在（重跑 `smoke:packaged-editor` 验证）。
- 断网首启：状态显示 `unavailable` 并给出指引，不伪装可用（按 `llm-status-honesty` 不变式）。

**状态（2026-09-28，Plan 263 E2 执行）**

- 加固（2026-09-28，Plan 263 R3，销账「判据只有尺寸下限」项）：权重 sha256 pin —— `scripts/lib/embedding-weights.mjs` 新增 `EMBEDDING_MODEL_SHA256`（4 文件实测哈希）、`hashFileSha256`、`verifyModelDirHashes`，`embeddingWeightsVerdict` 在尺寸判据之后增 hash 校验（`hashOf` 可注入）；`scripts/fetch-embedding-model.mjs` 取完权重即校验，不符抛错 `权重 sha256 不匹配：…`（exit 1）；`tests/embedding-model-assets.test.ts` 补 3 例（映射键 == 文件清单 / 篡改与不可读 / 冒烟判定 hash mismatch），11/11；实测 `node scripts/fetch-embedding-model.mjs` = 4 文件 cached + 退出 0。

- 已落地（拍板①随包附权重）：新增 `scripts/lib/embedding-weights.mjs`（模型 id / 4 文件清单 / `MIN_QUANTIZED_MODEL_BYTES = 20 MB` / `isCompleteModelDir` / `embeddingWeightsVerdict` 单源）与 `scripts/fetch-embedding-model.mjs`（来源顺序 `INKFLOW_MODEL_SOURCE_DIR` → `node_modules/@huggingface/transformers/.cache` → `huggingface.co`；`SKIP_EMBEDDING_MODEL_FETCH=true` 跳过；缺文件 exit 1）。
- `package.json`：`model:fetch` 脚本；`package` 链在 electron-builder 之前插入取权重；`build.extraResources = [{ from: 'build/embedding-model', to: 'embedding-model' }]`。
- `server/embedding.ts`：`LOCAL_EMBEDDING_MODEL_FILES`（4 文件）+ `resolveEmbeddingAssetPaths`（齐备 → `localModelPath` + `disableRemoteModels`；不全 → 只设 `cacheDir`，保留远程下载）；就绪日志打印 `{ localModelPath, cacheDir, allowRemoteModels }`。
- `electron.cjs`：打包态注入 `INKFLOW_EMBEDDING_MODEL_DIR=resources/embedding-model`（仅在权重齐全时）与 `INKFLOW_MODEL_CACHE_DIR=userData/models-cache`；dev 不注入（避免把 dev 的默认缓存改到 userData）。
- `scripts/check-package-artifacts.mjs`：发布件断言含 `embedding-model/Xenova/bge-small-zh-v1.5/onnx/model_quantized.onnx`（≥ 20 MB）。
- 读数：取权重 `FETCH_EXIT=0`（4 文件 23.3 MB，全部来自本地缓存）；`npx tsc --noEmit` 0 / `npx eslint server src shared tests scripts --max-warnings=0` 0；`tests/embedding-model-assets.test.ts` 9/9（R3 后 11/11，见上）；受影响面 4 文件 23/23。
- 残余（未关闭）：打包态真机验证 —— 验收中的「打包件内 `.cache`/`models` 不再出现」「打包态日志打印实际 `cacheDir`」「断网首启 `unavailable` + 指引」三条需联网拉 Electron 头（本机 `huggingface.co` 与 registry 均不可达）→ 本轮只到配置层 / 纯函数层 / 产物层证据；`release/` 缺失时冒烟脚本先于权重断言退出（既有保护，非缺陷）。 审计 2026-09-28 追加三项待拍板残余：① 发布链依赖 `huggingface.co`（npm 包不带权重，CI 冷启动只能走 Hub，不可达即 exit 1）；② `SKIP_EMBEDDING_MODEL_FETCH=true` 时产物断言同步跳过 → 可产出无权重发布件且通过冒烟；③ 判据仅尺寸下限（≥ 20 MB），无 sha256 / revision pin。**销账进度（Plan 263 R 轮）**：③ 已由 R3 关闭（见上「加固」条）；② 已由 D6 关闭（冒烟不再读 `SKIP_EMBEDDING_MODEL_FETCH`，逃生舱仅认显式 `--allow-missing-weights`）；① 发布链 Hub 依赖待落地。


---

## M7 声明运行时版本 —— 对应 R8 · P2 · S

**动作**
- `package.json` 加 `engines: { "node": "22.x" }`（与 CI 的 `node-version: 22` 对齐），并加 `.nvmrc`/`.node-version`。
- 决定 npm/Node 不匹配的处理：本机 npm 12.0.2 官方不支持 node 22.22.0（每条命令都报警告），要么升 node 到 22.22.2+，要么降 npm。
- 顺手把 `esbuild target: 'node20'` 与 engines 的关系写一行注释，避免三个数字各说各话。

**验收**
- `npm run typecheck` 输出首行不再出现 `npm warn cli`。
- 在声明版本上重装依赖后 `better-sqlite3` 与 `onnxruntime-node` 可加载（`npm run smoke:runtime`）。

---

## M8 台账指针校正 —— 对应 R9 · P2 · S

**动作**
- 逐条复核 `plans/README.md:355-373`（审计 backlog 与 Direction 备忘）的锚点：ARCH-01（4→13 处、两个失效路径）、ARCH-04（331KB→现测 221KB 源文件）、CORR-02（状态记歪）。
- 给每条锚点补「核对于 <日期>」后缀；行号易漂，优先记函数名与不变式。

**验收**
- 抽样 5 条锚点，`grep` 能在所记文件命中所记符号。
- M5 完成后回填 ARCH-01 终态。

---

## M9 死枚举清账 —— 对应 R11 · P3 · S

**动作**：三选一 —— ①接线（作者拒绝一次生产时真的写 `'rejected'`）；②删除该字面量并在 `ProductionRunStatus` 注释说明「拒绝 = 保留旧正文、run 停留在 review_required 后被弃用」；③保留但在 `docs/specs/` 登记为未接线声明。
**验收**：`grep -rn "'rejected'" shared/types/novel.ts` 的后续处置与实现一致；`lifecycle-states.dot` 第③区（声明未接线）同步更新。

---

## 仍开放、需要先补数据再决策

| 项 | 缺什么 | 最小获取动作 |
|---|---|---|
| ~~**前端 2 个失败用例未定位**~~ **已关闭（2026-09-28）** | 全量跑以 `tail` 收集，只留下汇总 `2 failed / 840 passed + 10 unhandled errors`；未重跑定位（会再加 40 分钟竞争） | **M2 落地后**一次无竞争全量跑，用 `--reporter=json --outputFile` 收全，交出两个用例名；同时判读那 10 个 unhandled error（定向复跑里满屏 `not wrapped in act(...)`，这类问题目前不判失败）；**已完成（2026-09-28）**：无竞争全量前端 `161 files / 1022 tests` 全绿 0 failed（日志 `/tmp/audit-fe2.log`，Duration 2563.39s），2026-09-18 基线（2 failed / 840 passed）的 2 例已随 840→1022 用例迁移消失；`not wrapped in act(...)` 为环境级提示，不计失败、不影响退出码 |
| ~~F5 第五/六类裁决门~~ **已关闭（2026-09-28）** | — | 三个 handler 已读：`legacy-artifact-structuring/confirm`（`server/routes/legacy-artifact-structuring.ts:149-188` → `server/helpers/legacy-artifact-structuring.ts:252-300`）—— outline 类走 `createCanonPatch`+`acceptCanonPatch`（机制 A）、其余走 `saveArtifactVersion({expectedVersion,…})`（机制 B），preview 有 TTL 15 min / 代际 / 源指纹三道校验；`capability-migration/apply|confirm`（`server/routes/capability-migration.ts:66-164`）在 `runInSerializedWriteForGeneration` 内重算指纹（不符 → `STALE_CANDIDATE`）→ `mergeMigratedProfile` + `validateCapabilityProfile` → `updateNovel`，幂等双通道（内存 `applied` Map + 持久化 `migrationReceipt{token,generation}`）。结论：**均为权威写入路径，无旁路** |
| ~~F6 get/list 未消毒 `style`~~ **已关闭（2026-09-28）** | 结论：**读层不消毒 = 设计边界，渲染面无未消毒直出**。2026-09-28 复核：`/api/db` 读路径 = `server/lib/db/skills.ts:171-177 listSkills()` → `skillCrud.list()` 直通，**无内容级消毒**（映射层只搬 `sanitization_status`，`server/lib/db-mappers.ts:138/284`）；白标保护仅存在于渲染投影两条路径。定向追证（2026-09-28）：唯一生产消费者 `src/components/AppShell.tsx:1085`（`listSkills()` → `recommendSkillsForStoryCard`）只取 `skillId` 与 `name`；`Skill.style` 生产命中仅 3 处且均非渲染 —— `src/lib/capability-governance.ts:153`（`hasRuntimeRule` 非空谓词）、`src/lib/skill-fusion.ts:23`（`collectSkillTraits` 取前 3 行）与 `:52`（`isAuthorizedRuntimeCard` 门控），融合产物只是草稿且受同一门控 | 已完成：定向追证无未消毒渲染面 |
| ~~F7 `Scene` 类型~~ **已定性（2026-09-28）** | — | **死模型**：声明于 `shared/types/novel.ts:309-322`，全仓零引用（正则 `(?<![A-Za-z_$])Scene(?![A-Za-z_$])` 命中 8 处：7 处为文案 “Scene Beats / Scene Contract”，1 处即声明本身）；无 `scenes` 表（`CREATE TABLE IF NOT EXISTS scenes` 0 命中）。处置：已按选项③处理（`shared/types/novel.ts:309` JSDoc 标「未接线声明」+ 本表登记）；删除仍需拍板 |
| F9 `vector_chunks` 扫描 | 2026-09-28 复核：仍无真实分布数据（本机 8 部作品为狗粮数据） | 取 `vector-store.ts:116` 埋点的生产分布再决策 |
| ~~性能结论~~ **已关闭（2026-09-28）** | — | 单写入者纪律下的基线：全量后端 `1465/1465`，Duration **275,783 ms**（`/tmp/audit-be.log`）；全量前端 `1022/1022`，Duration **2563.39 s**（与 pre-commit 全仓 tsc 并发，属上界，安静环境更快）。2026-09-18 的「受 3 会话并发污染」数字不再引用 |

---

## 建议执行顺序

```
M1 ─┬─ M3 ── M4         （先让门能用，再补诚实性回路）
    └─ M2 ──► M5 ──► M6  （隔离后做结构收口，验收数字才可信）
              M7 · M8 · M9 可与上面并行（互不相干的文件）
```

关键依赖：**M1 必须最先**（否则 M4/M5 的「跑测试确认绿」这一验收没有可信的静态门支撑）；**M5 第 1 步（竞品词）不要和 predicates 单源化捆绑**——前者是零容差安全收口，S 级，可当天做；后者是 M 级结构改动。
