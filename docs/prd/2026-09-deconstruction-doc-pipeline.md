# PRD（方向 Spike）：拆书工厂接入文档解析管线（docx / 长文本）

> 状态：**Spike 设计稿（未拍板、未实施）**
> 日期：2026-09-10
> 来源：Plan 193（`plans/193-spike-book-deconstruction-doc-pipeline.md`，planned at `0dfbbcf`）
> 性质：direction 类产出——管线差异盘点 + 分章拆解策略草案 + 模块边界/schema 设计 + 最小链路验证脚本（`scripts/deconstruct-docx-prototype.mjs`）。不含任何功能实施。

## 1. 执行摘要

拆书工厂目前只接受 `.txt/.md` 客户端读入后粘贴（`src/components/book-factory/BookFactoryInput.tsx:29` `accept=".txt,.md"`），服务端 `extractSkillSchema` 仅接受 `text` 字符串且上限 15 万字（`server/validation.ts:310`）。想拆整本参考小说（网文单本常见 50 万–300 万字）或 Word 稿的作者只能手工预处理。

而「资料续写」已建成完整的文档→文本管线：base64 上传、docx 安全解压校验（JSZip manifest 限长）、mammoth 抽取纯文本、zip/文件夹队列与前端去重。本 spike 结论：**接入是纯复用，工程上无阻塞**；真正需要拍板的是两个设计题——

1. 「文档→文本」管线从 `server/routes/continuation.ts` 抽出为 `server/helpers/doc-text-extraction.ts` 的模块边界（§4）；
2. 超 15 万字输入的分章拆解策略：按章切分 → 多次 extract → 卡组合并（§5，核心设计题）。

## 2. 管线差异盘点（现状对照）

两条管线都在同一 Express 进程内、共用 `createLlmExecution` 执行门（quota 类型不同，见下表），**执行上下文兼容，无 STOP 冲突**。

| 维度 | /api/parse-doc 与 /api/continuation-packs/parse（资料续写） | /api/extract-skill（拆书工厂） |
| --- | --- | --- |
| 入口文件类型 | `.txt/.md/.json/.docx`，base64 上传（`parseDocSchema`/`continuationParseSchema`，`server/validation.ts:462-489`） | `.txt/.md` 仅在前端由浏览器读为文本填入 textarea（`BookFactoryInput.tsx:29`），服务端只见纯文本 |
| 单文件大小 | parse-doc：base64 ≤ 8,000,000 字符（约 6 MB）；packs：单文件 ≤ 10 MB、≤100 个、合计 base64 ≤ 50,000,000 字符（约 35 MB） | `text` ≤ 150,000 字符（`extractSkillSchema`，`server/validation.ts:310`） |
| 解压安全 | docx 走 `validateDocxArchive`（JSZip manifest，`DOCX_ARCHIVE_LIMITS`：≤2000 条目、单条解压 ≤32 MB、合计 ≤96 MB、压缩比 ≤200）；packs 另有总解压预算 128 MB（`shared/lib/archive-limits.ts`） | 无（不收文件） |
| 编码处理 | `.txt/.md/.json` 按 UTF-8 解码；`.docx` 由 mammoth `extractRawText` 抽取（`continuation.ts:842-855`） | 默认前端已解码；服务端无编码逻辑，靠 `validateExtractSkillInput` 的中文字符门禁兜底（`shared/lib/quality-gates.ts:70`：非空、≥1 中文字、字符刷屏检测、低字数/低多样性拒绝） |
| 服务端文本预处理 | parse-doc：截 30,000 字送 LLM（`continuation.ts:918`）；packs：每文档截 60,000 字、≥20 中文字校验（`continuation.ts:1077-1081`），再按 provider 分档截断组装 prompt（`buildContinuationPackParseAttempts`：常规 15000/6000/3000 字降档） | `text.substring(0, 120000)` 后按比例切 5 段（`buildBookEvidenceSegments`，`shared/lib/book-skill-segmentation.ts`：开篇/前中/中/后中/高潮收束 5 个比例窗，段最小 300 字，<2000 字整本单段）；每段摘录截 12,000 字送 LLM |
| LLM 深度覆盖 | packs：单次调用，多轮降档重试 | `buildBookEvidenceSegments` 恒产出 ≤5 个段窗（开篇/前中/中/后中/高潮），全部做模型深度分析（`skills.ts:91` 的 6 段上限从不触顶）；每段摘录在组装 prompt 时截 12,000 字（`skills.ts:116`）——对 15 万字输入，实际送入模型的正文 ≤60,000 字，且 120,000 字之后的内容完全不参与 |
| 执行/配额语义 | parse-doc：异步 job（202 + jobId 轮询 + databaseGeneration 代际校验 + cancel），quota `advancedAudit`，90 s | 同步首响应（本地保底卡组秒回）+ 后台异步 job（`skillExtractionJobs`），quota `extractSkill`，240 s |
| 合并语义 | 多文档 → 单包；sync-extract 另有 `buildSyncExtractionChunks`（30,000 字/批、≤100 批）+ `mergeSyncExtractionResults`（实体按名归一合并）多批合并先例 | 段级证据 → `buildSkillDeckFromEvidence` 合成主笔卡+副卡组 → `evaluateSkillOutputQuality` 质量门禁 |

关键结论：15 万字上限对整本书远远不够；且即便放开上限，extract-skill 单次调用只有约 7.2 万字能被模型深度分析，直接塞长文本只会让绝大部分内容落到"快速保底"萃取。**拆分必须发生在调用 extract-skill 之前**，而不是放大单次输入。

## 3. 用户故事与目标

- 作者在拆书工厂直接上传 `.docx` 全本（或 30 万字以上的 `.txt`），不手工切分预处理。
- 系统自动按章节切分 → 逐段走既有 extract-skill 深度拆解 → 合并为一份卡组（主笔卡 + 副卡组），每张卡可追溯到来源章节。
- 输入超限时给出可解释的进度与成本预期（拆多少段、预计几次调用），而不是 400 报错。

非目标（Out of scope，与计划一致）：前端 accept 扩展与上传 UI 的具体实现、分章拆解完整方案实施、卡组合并算法定稿。

## 4. 模块边界：抽出 `server/helpers/doc-text-extraction.ts`

### 4.1 现状

以下三个函数目前内联在 `server/routes/continuation.ts:842-894`：

- `extractUploadedText(filename, filedata, prevalidatedBuffer?)` — 按扩展名分派 UTF-8 解码 / mammoth 抽取；
- `validateDocxArchive(buffer)` — JSZip manifest 安全校验（zip 炸弹防护）；
- `preflightUploadedDocumentArchives(documents, maxTotalUncompressedBytes?)` — 批量预检并缓存 docx buffer。

它们只依赖 `jszip`、`mammoth`、`shared/lib/archive-limits`，**无路由级依赖（不碰 db、不碰 LLM 配置）**，可做纯移动重构，`continuation.ts` 以 re-export 或改 import 保持兼容。

### 4.2 目标边界（建议）

```
server/helpers/doc-text-extraction.ts
  ├─ extractDocumentText(filename, buffer)          // 纯文本抽取（txt/md/json/docx 分派）
  ├─ validateDocxArchive(buffer)                    // 原样迁出
  ├─ preflightUploadedDocumentArchives(documents)   // 原样迁出
  └─ splitIntoDeconstructionChunks(text, opts)      // 新增：§5 的分章切分（供拆书侧使用；
                                                    //   资料续写不用，因其有独立的 60k 截断语义）
```

共享后三端受益：`/api/parse-doc`（设定解析）、`/api/continuation-packs/parse`（资料续写）、未来的拆书文档入口共用同一条「上传 → 安全校验 → 纯文本」管线，docx 安全策略只维护一份。

## 5. 分章拆解策略草案（核心设计题）

### 5.1 总体流

```
docx/长文本 → 抽取纯文本（§4 管线）
  → 章节切分（5.2）→ 每块 ≤ CHUNK_BUDGET（< 15 万字 schema 上限）
  → 逐块调用 extract-skill 深度拆解（每块独立走 buildBookEvidenceSegments 五段窗）
  → 卡组合并（5.4，复用 buildSkillDeckFromEvidence 语义扩展到跨块）
```

### 5.2 切分规则（两层降级，已在原型中实现）

1. **章节边界优先**：mammoth 输出按 `\n\n` 分段；段首匹配章节标题启发式（`第[0-9一二三四五六七八九十百千万零两]+[章卷回节]`、短行 ≤30 字）。按段落贪心装箱，**装不下时**切分，切分点回退到块内最后一个章节标题（章节对齐），使每块由整数个章组成。代码库中目前**没有**任何既有章节切分工具（已检索 `shared/lib`、`server/lib`），本策略为全新逻辑。
2. **碎块护栏**：回退标题边界时，标题前的前缀块须 ≥500 字（对齐 `buildBookEvidenceSegments` 的 `MIN_SEGMENT_CHARS=300` 量级），否则放弃标题边界直接在段前切——防止「卷标题紧跟章标题」被切成只有几个字的碎块（这类碎块会被 extract-skill 输入门禁正确拒绝；原型首轮运行实际暴露并修复了此问题）。
3. **无标题降级**：检测不到标题时自然退化为段落边界贪心装箱，禁止句中硬切；每块保留与前后块各 ≤200 字的重叠窗，降低卡在边界处的证据丢失。
4. **安全阀**：单段超预算是唯一允许句中硬切的例外（按预算硬切）。

参数建议（草案）：`CHUNK_BUDGET = 50,000` 字（依据见 5.3）；`MAX_CHUNKS = 100`（对齐 `SYNC_EXTRACTION_MAX_CHUNKS` 先例，可覆盖 500 万字）。

### 5.3 为什么是 50,000 而不是贴着 15 万上限

- extract-skill 单次调用的深度分析 = 5 段窗 × 每段摘录 12,000 字 = **60,000 字正文**；最大段窗占块体的 24%（中段 0.38–0.62），块体 ≤50,000 字时 24% ≤ 12,000，**整块无截断地全部进入深度分析**；贴 15 万上限则超过 120,000 字的部分完全不参与、其余也有近半在摘录截断中损失。
- 每块是一次独立的 `extractSkill` 配额调用（240 s 超时），块越小失败重试的代价越低。
- token 成本：50,000 字 ≈ 单块 prompt 4–5 万 token 量级，与现有单次拆书同数量级，前端可据此给出"N 段 × 预计调用次数"的成本提示（§7 开放问题 3）。
- 原型默认 60,000（可环境变量覆盖）：中段窗截断约 4%，用于演示两种切分形态（60,000 预算整本 7 万字切 2 块；9,000 预算逐章对齐切 12 块）。

### 5.4 卡组合并语义（草案）

复用现有两段式：每块内部仍是「5 段窗 → `collectSegmentEvidence` → 段级证据」，跨块把所有段级证据汇入一次 `buildSkillDeckFromEvidence` 合成主笔卡+副卡组——即把现在"单文本内 5 段"的聚合自然升级为"多块 × 5 段"的聚合，合并不引入新算法。需要配套的约束：

- 每块内部恒有 5 次段级 LLM 调用（五段窗），跨 N 块即 5N 次 `extractSkill` 配额调用；采样/限流策略应作用于**块级**（如 >6 块时按块均匀采样，或设单次上传的调用预算上限），否则成本随块数线性膨胀；
- `evaluateSkillOutputQuality` 质量门禁改为对**合并后卡组**整体评估（现状是对单文本前 8000 字锚定打分）。

### 5.5 与执行门/配额的兼容性（STOP 条件核验）

mammoth 管线运行在路由请求线程（纯 CPU，jszip+mammoth，无子进程），与 skills 路由同一 Express 上下文；拆解调用沿用 `createLlmExecution`（quota `extractSkill`）。两管线无 FIFO/配额语义冲突，**计划设定的 STOP 条件 1 不触发**。切分对章节边界采用「标题优先 + 段落边界兜底 + 重叠窗」，启发式误差被限定在单块边界 ±1 段以内，**STOP 条件 2 不触发**；整本压缩拆解作为极端降级记入 §7 开放问题 6。

## 6. Schema 改动方案（两个选项）

### 选项 A：扩展 `extractSkillSchema`（推荐）

```ts
extractSkillSchema = z.object({
  text: z.string().min(1).max(150000).optional(),          // 粘贴路径保持不变
  documents: z.array(z.object({                             // 新增，复用 continuationParseSchema
    filename,                                               //   的 document 子结构（.txt/.md/.json/.docx）
    filedata,
  })).max(N).optional(),
  novelId: dbIdSchema,
  // title/style/skills 不变
}).refine(d => d.text || d.documents?.length, { message: '请提供文本或文档' });
```

- 优点：沿用拆书现有「同步保底秒回 + jobId 异步深析」契约（`prompt-client.ts:96` 及 job 轮询端点不变），前端改动最小；服务端在路由内完成抽取 → 切分 → 把每块作为独立深析任务复用现有 job 通道。
- 配套：分块数、逐块进度需要扩展 job 状态（现为单任务 pending/completed），或仿照 parse-doc 增加 `progress/stageText` 字段。

### 选项 B：完全复用 parse-doc job 模式（备选）

新端点（如 `/api/extract-skill-doc`）照抄 `/api/parse-doc` 的 202+jobId+轮询+代际校验，深析完成后走卡组合并。

- 优点：长任务的进度/取消/代际语义最完整；
- 缺点：放弃现有"保底卡组秒回"体验，前端需要新的调用与轮询路径，等于双轨并行。

**推荐 A**：拆书的差异化体验就是"秒回保底 + 后台深析"，选项 A 在获得文档能力的同时不破坏该契约。

## 7. 开放问题（拍板前需决策）

1. **跨块卡组合并去重**：`buildSkillDeckFromEvidence` 现按段聚合，跨 20+ 块时同名/近义规则卡（如"三段式爽点节奏"在多章重复出现）如何归一与去重？是投票计数（出现块数 ≥ 阈值才入卡）还是交由一次收口 LLM 调用做合并？现无实现先例，`mergeSyncExtractionResults` 的实体按名合并只可部分借鉴（卡是规则文本而非实体名）。
2. **单卡质量阈值**：合并后卡组变大，`evaluateSkillOutputQuality` 的锚定分（现基于前 8000 字）与"泛化卡"判定阈值是否要按块数重标定；副卡组数量上限（`skills` ≤3 的请求侧约束）是否保留。
3. **超长文本的 token 成本提示**：切分完成后、调用前，前端应展示「共 N 章 → M 块 → 预计 M 次 extractSkill 调用」及配额余量；交互上是否需要用户确认（类似资料续写的"确认并启用"步）。
4. **配额语义**：多块 = 多次 `extractSkill` 扣减，一次上传可能一次扣掉数日配额；是否引入单次上传的调用数上限或打包配额。
5. **进度模型**：选项 A 下现有 job 是单任务布尔态，多块并行度（串行 or `concurrency: 1` 队列）与逐块进度上报需要设计。
6. **整本压缩拆解（降级方案）**：当切分数超 `MAX_CHUNKS` 或用户不愿多块成本时，退化为"全本按比例采样 ≤15 万字一次性拆解"——覆盖率换成本，是否作为用户可见选项。
7. **编码兜底**：GBK 等 UTF-8 之外的 `.txt` 在现有管线下会产出乱码并被中文字符门禁拒绝；是否在前端/管线加编码探测（资料续写同样存在此问题，可一并解决）。

## 8. 最小链路验证（已运行通过）

`scripts/deconstruct-docx-prototype.mjs`（验证命令 `node --import tsx scripts/deconstruct-docx-prototype.mjs`，exit 0，90 项断言）：

1. 用 JSZip 在临时目录构造最小合法 docx（2 卷 × 6 章 ≈ 7.1 万字合成叙事文本；不做网络请求、不触 data.db、退出前清理临时目录）；
2. mammoth `extractRawText` 抽取纯文本（实测 70,988 字符、12 个章节标题）；
3. 按 §5.2 两层策略切分，两种形态均验证：预算 60,000 → 2 块（58,924 + 12,060 字）；预算 9,000 → 12 块且每块以章节标题开头（逐章对齐）；
4. 每块断言：通过**真实 import 的** `extractSkillSchema`（完整请求体 `text` + `novelId`）、通过 `/api/extract-skill` 的 Layer-1 输入门禁 `validateExtractSkillInput`、能产出非空的五段窗证据段；
5. 以资料续写同款方式组装输入（`【文件名】\n正文` 分节 + `buildContinuationPackPrompt`，不真实调用 LLM），断言 prompt 覆盖全部分节。

脚本通过即证明「docx → 抽取 → 切分 → extract-skill 可接受输入」的最小链路成立。

## 9. 实施前置条件

拍板 §6 方案与 §7 开放问题后，另立实施计划（预期 Effort M）：schema 扩展 + `doc-text-extraction.ts` 抽取重构 + 切分器实现 + 卡组合并扩展 + 前端 accept/UI。本 spike 不含以上任何代码改动（仅新增设计文档与验证脚本）。
