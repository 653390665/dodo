# Plan 269：门禁命中 → 段落级定点修复

- 状态：✅ 已完成（2026-10-01）
- 来源：Plan 266「修复② 只由局部软命中引起的门失败先带定向反馈重写整章」的直系后续
- 批准：User said (m20216):「门禁命中 → 段落级定点修复」
- 真机证据：隔离实例 3301（生产库副本 + 独立 config），作品 `d23eef68-ae47-4ca5-9e5d-cf6ab23bb1df` / 章节 `99b28a6e-0404-4197-ad63-e43d0be69b37`，模型 gemini-3.8-flash-high

## 1. 问题

Plan 266 修复② 之后，**只由软命中**（`literary-slop` 的 `tell_dont_show` 副词弱化等）触发的门失败，代价却是一整轮 writer 重写：≈3000 token、数十秒，且重写结果不可控。而真机命中往往只是 2–3 个句子（run `c6ef02ba` 的三条命中全是 `极其规整` / `极其尖锐刺耳的长` / `极其尖锐的摩擦音` 这类副词弱化）。

第一版接线还暴露了**控制流缺陷**：定点修复的数据通路已通（写回成功、复检通过），但代码仍继续往下走到 Plan 266 ② 的整章重写 / 保底稿构造，把刚修好的稿覆盖成 `fallback` —— 只改了数据，没改控制流。

## 2. 方案（选定）

逐句定点修复 + 同一套质量门复检 + 失败才回退整章重写。

| 备选 | 否决/选定理由 |
| --- | --- |
| 整章重写（Plan 266 ②） | 成本高（数十秒 / 数千 token），且实测会把已过门的好稿换掉 |
| 放宽软命中阈值 | 等于把 AI 腔正文交付给作者，违反产品承诺 |
| 纯字符串删副词 | 机械命中的 snippet 被截断到 8 字符（`极其简陋的黄色外`），直接替换会在正文留半句碎片 |
| **逐句 LLM 定点修复（选定）** | 只改被点名的整句；修完用同一门禁复检；修不动就交回原路径 |

## 3. 交付物

### 3.1 纯函数模块 `shared/lib/local-repair.ts`（314 行 / 12258 B）

常量（单一事实源）：

- `LOCAL_REPAIR_ALLOWED_FINDING_CODES = ['literary-slop','literary-polish']`（:18）
- `LOCAL_REPAIR_CATEGORIES = ['ai_cliche','style_slop','tell_dont_show']`（:21）
- `MAX_LOCAL_REPAIR_TARGETS = 6`（:24）、`MAX_LOCAL_REPAIR_GROWTH_CHARS = 320`（:27）
- `LOCAL_REPAIR_CONTEXT_CHARS = 240`（:30）、`MAX_LOCAL_REPAIR_SENTENCE_CHARS = 240`（:33）

函数：

- `compactTextLength(text: string): number`（:93）—— 与门禁同口径的「有效字符」计数（去空白）。
- `selectLocalRepairTargets(input: { text; findings?; hits?; minChars? }): LocalRepairSelection`（:160）→ `{ repair: boolean; targets: LocalRepairTarget[]; reason?: string; skipped: number }`。
  - 拒绝码：`empty-draft` / `hard-defect:<code>` / `below-contract` / `no-localizable-hits`。
  - 规则：任何**非 P2 且不在白名单**的 finding = 硬缺陷（结构 / 模板 / 长度），点修救不回来 → 不修；`compactTextLength(text) < minChars` → 不修。
  - `LocalRepairTarget`（:60）字段：`key`（类别+行号+起点）/ `category` / `line` / `snippet`（**所在整句**）/ `suggestion?` / `start` `end`（左闭右开，已夹紧）/ `before` `after`（衔接上下文，按 240 字符截断）。
- `expandToSentence`（:134，内部）—— 把命中区间扩回整句：左扫到句末标点 / 换行之后为句首，右扫过句末标点含之；`end - start < 2` 或超 `MAX_LOCAL_REPAIR_SENTENCE_CHARS` 则退回原片段。
- `applyLocalRepairs(text, repairs: readonly { start; end; text }[], { maxGrowthChars? }): LocalRepairApplication`（:270）→ `{ text; applied; skipped }`；右到左写回，区间非法 / 空替换 / 增长超 `320` 字符 → 跳过并计数。

### 3.2 管线接线 `server/helpers/ai-production-pipeline.ts`

- `repairGateHitsLocally(params: { novelId; writerConfig; text; findings; hits; contextStr; minDraftChars?; signal? })`（:509）→ `{ text: string | null; report: … | null; summary: LocalRepairSummary }`；每个目标一次 `generateText`（`buildRewritePrompt`、`mode: 'surgical-patch'`、`LOCAL_REPAIR_INSTRUCTION`）。
  - `LOCAL_REPAIR_INSTRUCTION`（:494-496）= 「只修复被点名的这一小段：删掉 AI 套话与副词弱化（tell-dont-show），改成具体动作、感官细节或停顿；不要扩写剧情、不要新增人物或信息；保持与前后的衔接，篇幅与原文相当。」
  - `LOCAL_REPAIR_LLM_OPTIONS`（:498-503）= `{ maxTokens: 2048, maxAttempts: 1, timeoutMs: WRITER_LLM_OPTIONS.timeoutMs }` —— 不占整章重试额度。
  - `LocalRepairSummary`（:487-492）= `{ targets; applied; skipped; passed; reason? }`。
- 门失败分支（`:1061`）内新增定点修复块（`:1102-1140`）：成功即 `localRepairPassed = true` 并记 `logger.info('[pipeline] local gate repair passed the prose quality gate', { novelId, targets, applied, skipped })`；修过但仍有残留且机械分未下降 → 更新 `lastModelDraft` 作营救候选。
- **控制流修复**（`:1141-1148`）：`if (localRepairPassed) { …按 24 字符回放修好的正文… }` —— 修好的稿直接走收稿路径，不再落到 Plan 266 ② 的重写 / 保底稿构造。
- 修不动时仍按原路径：Plan 266 ② 定向反馈重写整章 → 保底稿（`currentDraft = fallbackDraft; draftSource = 'fallback'`）。

### 3.3 测试（定向 4 文件 60/60）

`tests/local-repair.test.ts`（10 例，纯函数）：`locates a soft hit by snippet when the mechanical range is absent` / `expands a truncated mechanical hit to the enclosing sentence` / `prefers the mechanical character range over snippet search` / `refuses to repair structural hard defects` / `refuses when the draft is below the length contract` / `reports no-localizable-hits when nothing can be located` / `drops overlapping hits and caps the number of repaired sentences` / `applies repairs right-to-left and leaves the rest of the draft intact` / `skips invalid, empty and runaway replacements` / `compactTextLength matches the gate char-count convention`。

`tests/writer-local-repair.test.ts`（2 例，管线集成）：`a soft-only gate failure is repaired sentence-by-sentence instead of rewritten`（软命中 → 逐句修复 → 交付 model 稿）；`structural hard defects still skip local repair and fall back`（硬缺陷 → 不点修，走保底稿）。

## 4. 真机读数（2026-10-01，隔离 3301）

| run | 耗时 | 门检 dump | 定点修复 | 交付 |
| --- | --- | --- | --- | --- |
| `c6ef02ba` | 69.2 s | attempt 0 / len 5653 `literary-slop`（↑三条副词命中） | targets 3 / applied 3 / skipped 0 | **5699 = model**；critic 88 pass |
| `6fc636b0` | 73.1 s | 无（干净过门） | — | 5244 = model；82 pass |
| `0ae5c1b1` | 125.0 s | 无 | — | 4528 = model；86 pass（attempts 2） |
| `1788c609` | 77.6 s | attempt 0 / len 6276 `repeated-opening`+`literary-slop` | INFO | 6295 = model；86 pass |
| `ae2244d2` | 85.1 s | attempt 0 / len 5301 `literary-slop` | INFO | 5320 = model；88 pass |
| `c93aebbb` | 110.1 s | 无 | — | 5309 = model；88 pass |
| `5d68cf24`（负对照，上游代理挂） | 20.8 s | — | 未尝试 | 4186 = fallback（两项版本行均 fallback） |

结论：

1. 3 次软命中 → **3/3 就地修复成功**（服务器日志 `local gate repair passed` 计数 = 3），**零整章重写、零保底稿覆盖**。
2. 6/6 交付稿与其 `chapter_production_run_versions` 的 `model` 行**逐字相同**；命中串（`极其规整` / `极其尖锐`）在修复稿中归零。
3. 负对照 `5d68cf24`（provider 全 500）仍走保底稿路径 —— 降级语义未被本改动影响。

## 5. 残余 / 后续

- **R-269-1**：修复调用 = 目标数（实测 3 次/修复），未合并为单次批量请求。
- **R-269-2**：P2 残留（`literary-polish`）仍原样交付（产品口径：P2 不阻断）。
- **R-269-3**：定点修复失败后仍回落到整章重写（Plan 266 ②）→ 昂贵，但保留为后手。
- 未覆盖（有意）：硬缺陷（结构 / 模板 / 篇幅 / 重复段）一律不进点修；点修对「重复段」类缺陷无效。

## 6. 复现

- 单元/集成：`NODE_ENV=test node --test --test-timeout=45000 --import tsx --import ./tests/helpers/test-db-preload.ts tests/local-repair.test.ts tests/writer-local-repair.test.ts tests/writer-quality-gate-retry.test.ts tests/draft-quality.test.ts` → 60/60
- 静态门禁：`npx tsc --noEmit`（0）、`npx eslint server src shared tests scripts --max-warnings=0`（0）
- 前端全量：`npx vitest -c vitest.config.frontend.ts run` → 162 files / 1030 tests 全绿（1904.9 s；机器并发负载下 environment/setup 占大头，属环境而非产品问题）
- 后端全量：`1500 tests / 1500 pass / 35 suites`
- 真机：`bash /tmp/launch-3301-gatedbg.sh`（隔离库 `/tmp/inkflow-writetest/data.db` + 独立 config，`PORT=3301`）+ `python3 /tmp/chain-drive-3301.py`

## 7. 证据文件

- `/tmp/p269-ab-server.log`（门禁 WARN + 修复 INFO）
- `/tmp/gate-fail-gemini2.jsonl`（每次门检 dump：attempt / len / codes / evidence / hits）
- `/tmp/chain-gemini.log`（SSE 逐事件）
- `/tmp/p269-ab-repeat.py`（4 连跑脚本）、`/tmp/p269-collect2.py`（交付稿 vs model 版本逐字比对）
- 诊断期探针（已移出仓库，避免 `scratch/` 参与类型检查）：`/tmp/p269-probe-targets.ts`
