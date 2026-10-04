# Plan 281：保底稿接地 + 场景衔接（R-279-1 / R-272-1）

**Status**：✅ 已完成（2026-10-04）
**前置**：Plan 279（保底稿去年代化）、Plan 278（花名册裁成「- 名字」）、Plan 268/275（档位缩放与自适应 holdback 窗口）
**触发**：User said (m26014)「按你的推荐来，继续工作」——在链路主线（链路通顺 / 配置完整 / 模型最优 / 过评审与门禁）下推「作者看到的成品下限」。

## 1. 问题

### 1.1 R-279-1：保底稿是通用散文，没有人也没有地方
- `server/helpers/fallback-draft.ts` 的模板段落写死了「他停在门边」「有人挪开杯盏」「另一个人却在杯沿上停住了手指」：一次性拿到保底稿的作者看到的是一章没有人物、没有具体处境的安全文本。
- 同一路径还有一条档案泄漏：`expandDraftToMinimum` 的 `hints = [...beatHints, ...filteredContext]` 吃 `sanitizeFallbackContext(contextStr)` 的输出，而 sanitize 会把 `- 林舟（旧值班室）：负责核对船期` 的标签剥掉、只留档案句 → 档案句被当提示句嵌进正文（探针 `/tmp/p281-probe-cast.ts` 实测 `HAS_SKETCH true`）。

### 1.2 R-272-1：split 模式每个场景重新起头
- split 模式下每个场景是一次独立 writer 调用，模型习惯用天色/环境/到场描写重新开场，四段拼起来读起来像四个新场景而不是一章。
- 基线读数（Plan 281 变更前，3 reps / 12 次场景调用）：非首场 9 次里 env 7 / other 2 / person 0 ⇒ **承接率 0/9**。

## 2. 方案

### 2.1 保底稿接地（`server/helpers/fallback-draft.ts`）
- 新增 `export function extractFallbackCast(contextStr: string, limit = 2): string[]`：只读花名册区块（`关键人物：`/`出场人物：` + `-`/`·` 条目），只取名字——遇 `（`/`(`/`：`/`:`/空格截断，跳过 `无`，去重。
- 名字形状守卫 `const FALLBACK_CAST_NAME = /^[一-鿿A-Za-z·]{1,12}$/u;`：夹具与脏数据里的「角色证据-林舟」这类哨兵/标签值不许上台（否则保底稿直接命中 `EVIDENCE_LABEL_RESIDUE`）。
- `buildFallbackDraft` 接地：`const cast = extractFallbackCast(contextStr); const lead = cast[0] || '他'; const foil = cast[1] || (cast[0] ? '另一个人' : '有人');`，注入模板段落（`${lead}停在门边…`、`${foil}挪开杯盏…`、`…${lead}没有立刻说话…`、`试探从一句不重的话开始。${foil}故意把问题说得很轻…${lead}却在杯沿上停住了手指。`）；无花名册时退回无名兜底。
- 档案句不再当提示句：`expandDraftToMinimum` 在 `sanitizeFallbackContext` **之前**按原始行剔除列表条目（`const STRUCTURED_CONTEXT_LINE = /^(?:[-*·•]\s?)/;`）。
- 只剔列表条目、**不**剔区块标签：连 `世界规则：` 标签行一起剔，会让它的值行单独存活、绕过下面 Plan 261 的 `SETTING_RESIDUE` 过滤——`tests/production-stream-disconnect.test.ts` 的控制字符夹具实测（保底稿带上 worldRules 的不可见字符 → 门禁拒收，2 例红）。

### 2.2 场景衔接指令（`server/helpers/ai-production-pipeline.ts`，split 分支）
- 首场：「本章第一个场景：先把在场的人与当下处境交代清楚，写完本场景即停，不要越到下一场景。」
- 中间场：「本场景不是本章开头：第一句必须承接上一场景末尾正在发生的动作或对话，禁止用天色、时辰、地点、环境或旁白重新起头，也不要让人物重新到场；写完本场景即停。」
- 终场：「本章最终场景：第一句同样要承接上一场景末尾正在发生的动作或对话，不要用天色、时辰、地点、环境或旁白重新起头；在承接的基础上按分镜收束本章悬念，给出章节结尾。」（此前终场只收到「收束」提示，3 场景章里只有第 2 场收到承接要求）

## 3. 真机读数（隔离 3301 / gemini-3.8-flash-high @ low / n=3 每臂 / 同一隔离库与作品）

| 臂 | rep | 耗时 s | 审计分 | 交付字数 | 承接 |
| --- | --- | --- | --- | --- | --- |
| 基线 `flash-p281` | rep1 `901fe646` | 95.2 | 84 pass | 5851 model | 0/3 |
| | rep2 `f629dd6f` | 79.3 | 84 pass | 5642（resets 1） | |
| | rep3 `8ca8ce9c` | 100.1 | 88 pass | 5741（repairs 1） | |
| 变更后 `flash-p281b` | rep1 `7cd704d3` | 54.7 | 90 pass | 5158 | 1/3 |
| | rep2 `ac754320` | 281.6 | **46 fail**（critic 62→46→12） | 13857（repairs 1） | 5/9 |
| | rep3 `5904154d` | 51.8 | 88 pass | 5024 | 3/3 |
| 变更后 `flash-p281c` | rep1 `e462aefd` | 73.4 | 88 pass | 5856（repairs 1 通过） | — |
| | rep2 `988d426f` | 71.0 | 88 pass | 6996 | — |
| | rep3 `bbb70ffd` | 76.6 | 84 pass | 6862（resets 1） | — |

- **承接率（R-272-1 主指标）**：基线 12 次场景调用 / 非首场 9 次 → env 7 / other 2 / person 0 = **0/9**；变更后 20 次调用 / 非首场 15 次 → person 9 / env 5 / other 1 = **9/15（60%）**。
- **质量**：变更后 6 跑 5 过（90 / 88 / 88 / 88 / 84）+ 1 失（46）；基线 3 跑 3 过（84 / 84 / 88）。过门跑耗时反而更短（51.8–76.6 s vs 79.3–100.1 s）。
- **保底稿**：fallback 版本行 4178 字（基线 4129）——接地后仍满足篇幅合同，且不再出现花名册档案句。

## 4. 失败例 `ac754320` 的归因（登记 R-281-1，未修）
- 首轮（attempt 0）单场景输出 2092 / 788 / 2359 / 1513 字，与基线同量级（0.9–2.2k）⇒ **不是**衔接指令导致的首轮膨胀。
- 膨胀只出现在重试轮：attempt 1 = 6357 / 1024 / 1553 / 4917（合计 13.9k）、attempt 2 = 5054 / 5631 / 4818 / 2642（合计 18.1k），且 attempt 2 的第 2、3 场有约 480 字逐字重复（`/tmp/p281-dup2.py` 40 字 shingle 实测 440）。
- 门禁判 `duplicate-paragraph` + `repeated-opening`（P1），critic 三轮 62 → 46 → 12，最终交付 13857 字模型稿、审计 46 fail。
- 机制：重试反馈（`buildLiteraryRetryFeedback` / `buildWriterRetryFeedback` 都写「重写整章」）被送进**按场景**的 writer 调用，于是每个场景都重写章级篇幅 → 跨场景复述 → 结构类硬命中。
- 登记为 R-281-1；本次不动（衔接指令本身与首轮无关，且修法要在重试路径上做减法，自成单元）。

## 5. 门禁
- `tsc --noEmit` 0、`eslint server src shared tests scripts --max-warnings=0` 0、定向 7 文件 **101/101**。
- 新增/改动测试：`tests/fallback-draft-tone.test.ts`（+`extractFallbackCast reads the roster block and nothing else`、+`a deterministic fallback draft puts the roster cast on stage and keeps the archive out`、+`evidence-label sentinels never become fallback cast members`）、`tests/writer-quality-gate-retry.test.ts`（+`split-scene prompts force every scene after the first to bridge the previous ending`）、`tests/draft-quality.test.ts`（改写 `fallback context removes structured entity fields and workflow instructions`：档案值不再进场，只有名单里的名字以在场人物身份进入正文——有意变更既有契约）。
- 后端全量 **1551/1551**（36 suites，173.9 s；首轮曾因保底稿夹具回归 2 例红，定位见 2.1）。

## 6. 残余（登记）
- **R-281-1**：重试路径按场景执行「重写整章」反馈 → 单场景膨胀 + 跨场景复述（真机 `ac754320` 一例；首轮不受影响）。
- 沿用：R-279-2（续写轮数写死 2）/ R-279-3（批量回执可能整块落空）/ R-279-4（≥2 处即 P1，真机未闭环）/ R-272-2（critic 无逐字反馈）/ R-273-3（reset 仅在非前缀差异时触发）/ R-275-1..3 / R-269-1（点修逐处一次调用）/ R-269-3（点修失败回落整章重写）/ R-276-1（弱模型批量 0 槽）/ R-277-2（拒修时 SSE 文案口径）/ R-278-2（pro-low 不适配，默认档位保持 flash@low）/ R-278-4（单条命中不阻断）/ R-280-1..3。

## 7. 证据与复现
- 矩阵脚本：`/tmp/p281-flash.py`（基线 tag `flash-p281`）、`/tmp/p281-flashb.py`、`/tmp/p281-flashc.py`；结果 `/tmp/p281-flash.json`、`/tmp/p281-flashb.json`、`/tmp/p281-flashc.json`；服务日志 `/tmp/p278-server-flash-p281.log` / `-p281b.log` / `-p281c.log`。
- 每场景 dump：`/tmp/writer-prompts-flash-p281*.jsonl`（归档 off-by-one：`-rep2.jsonl` = rep1、`-rep3.jsonl` = rep2、无后缀 = rep3）。
- 分析：`/tmp/p281-openings.py <tag> <jsonl...>`（场景开头人物/环境启发式）、`/tmp/p281-dup2.py <jsonl...>`（逐 attempt 场景字数 + 40 字 shingle 重叠）。
- 门禁：`/tmp/p281-gates.sh` → `/tmp/p281-gates.log`、`/tmp/p281-tests.log`；后端 `/tmp/p281-be.sh` → `/tmp/p281-be.log`。
