# Plan 266：正文质量门与保底稿 —— 单个副词枪毙整章 + 分镜字段混入正文

- 状态：✅ 已完成（2026-09-30）；包含验证中暴露的 Plan 265 回归（思考档位取值）修复。
- 起因：Plan 263 诊断（`plans/263-closeout-and-truth-up.md`）后的真机复测：run `46109ca3-8d26-4430-8d1b-748b0a815b73` 三次 attempt 的模型稿全部被质量门拒绝，应用只得回退保底稿，critic 打 1-2 分 / 总分 12，终态 `review_required`。

## 根因（两处，各自独立）

### ① 正文质量门对「软文风命中」不做计数，1 条即阻断整章

- `shared/lib/draft-quality.ts` 原判定：`hardLiteraryHits` = 命中任一 `ai_cliche | style_slop | tell_dont_show`（`shared/lib/slop-scorer.ts` 给 tell_dont_show 显式 `priority: 'P1'`）**或** structural P1 且 signal ∈ {paragraph-opening, scene-template} → **只要 ≥1 条**就产出 `literary-slop` P1 → `ok = false`。
- 同一 scorer 的其它检测器都按计数/密度：paragraph-opening ≥3→P2 / ≥5→P1、scene-template ≥3、subject-action-chain ≥4；机械分通道按 `MIN_COMPLETE_CHAPTER_SLOP_SCORE = 85` 判定。只有这条软命中路径是无条件的。
- 真机后果：门输入实测 `len=5177`、`mechanicalScore=97.10`、唯一命中 `{category: 'tell_dont_show', priority: 'P1', snippet: '极其简陋的黄色外'}`（正文里就一个副词「极其」）→ 整章被判 `literary-slop` 丢弃。

### ② 保底稿把 planner 分镜字段拼进正文，且门抓不到

- `server/helpers/fallback-draft.ts:440-516 buildFallbackDraft` 原实现：每块取 `[title, **核心冲突**, **关键动作链**, **退场钩子**].join('。')` 作为 beats[i]，再嵌入三段固定模板。
- `expandDraftToMinimum` 的提示句池 `hints = [...beatHints, ...filteredContext]`，而 `sanitizeFallbackContext`（`shared/lib/draft-quality.ts`）会把字段标签剥掉只留字段值，行内多字段行则原样保留 → 字段值/标签被 `hintSentence(hint)` 插进扩写段落。
- `metadata-residue` 检测（`validateCompleteChapterDraftQuality`）只认**行首**字段标签（`BEATS_FIELD_RESIDUE`），细纲式的行内标签（"场景 1：… 出场人物：… 核心冲突：…"）漏检 → 拼贴稿反而以 score 100 过门。

## 修复

- **Fix 1（比例化）** `shared/lib/draft-quality.ts`：新增 `export const SOFT_LITERARY_BLOCKING_HITS = 3;`。软类别命中 ≥3 条（或存在 structural P1）仍产出 `literary-slop` P1；1-2 条改为新增 `literary-polish` **P2**（不阻断，附证据与建议），`ok = findings.every(f => f.severity === 'P2')` 维持不变。
- **Fix 2（先重写、后回退）** `server/helpers/ai-production-pipeline.ts`：新增 `isRetriableWriterSoftFailure(quality)`（要求 `mechanicalReview.status === 'pass'` + 至少一条 `literary-slop` + 其余 finding 全为 P2 或 literary-slop）与 `buildLiteraryRetryFeedback(quality)`（抽 ≤6 条 evidence 片段 → `【上一稿未通过正文质量门禁，请重写整章】…重写要求：段首句式必须多样化…`）。门失败且属软命中时可重试一次（`attempt < MAX_RETRIES`）→ `continue`；硬缺陷（metadata-residue / markdown-residue / structural P1 / 机械分不足）仍直接回退保底稿，不烧重试。
  - 兼容性：`literary-slop` 的 `evidence` 实测为**字符串数组**（真机 dump）与**对象数组**（`{line, snippet, suggestion}`，离线夹具）两种形态，`buildLiteraryRetryFeedback` 两种都取。
- **Fix 3（保底稿去分镜化）**
  - `server/helpers/fallback-draft.ts`：beat 只取 `**核心冲突**` 字段值作为前提句（不再取 title/关键动作链/退场钩子、不再 `join('。')`）；尾段模板去掉三段 beat 拼接（`openingPremise` 只出现在第三段）。
  - `shared/lib/draft-quality.ts`：`BEATS_FIELD_RESIDUE` 由函数内常量提升为**导出常量**（生成侧复用同一标签集），并新增 `BEATS_FIELD_RESIDUE_INLINE`（行内字段 / `场景 N：` 签名）。
  - 扩写的提示句池两处都过滤：`beatHints`（分镜文本）与 `contextLines`（writer 上下文里的资料包细纲）—— 2026-09-30 真机保底稿实测证明细纲是多字段挤在同一行的形态，行首锚定抓不到。

## 验证读数

- 定向：`tests/draft-quality.test.ts` / `tests/flow-step-gate.test.ts` / `tests/writer-quality-gate-retry.test.ts` / `tests/production-prompt-sentinel.test.ts` / `tests/server-llm.test.ts` → **88/88**；`npx tsc --noEmit` **0**；`npx eslint server src shared tests scripts --max-warnings=0` **0**；后端全量 **1475/1475**。
- 新增集成测试 `tests/writer-quality-gate-retry.test.ts`：内容分类 mock（`PLANNER_SENTINEL` / `WRITER_SENTINEL` / `SYSTEM CORRECTION GATE` / `CRITIC_SENTINEL`），3 个软命中场景（各 20 段 + 一条 tell_dont_show 软句）→ 断言 6 次 writer 调用（三场景写两遍）、后 3 条带定向反馈且含 `/简陋/`、终稿为 model 稿并含重试稿哨兵句；hard residue 用例 → 1 次调用、直接 fallback。
- 真机（隔离 3301 + CLIProxyAPI 反代，`INKFLOW_DB_PATH=/tmp/inkflow-writetest/data.db` 生产库副本，未碰生产库/用户配置）：

| run | 模型 | 耗时 | 门拒 | 保底稿分镜字段 | 终态 |
|---|---|---|---|---|---|
| `46109ca3`（修复前） | gemini-3.8-flash-high | 170 s | 3 次（`literary-slop`，唯一命中副词「极其」） | 含（labels=出场人物/入场钩子/核心冲突/关键动作链） | review_required |
| `f99af891`（Fix 1/2/3） | gpt-5.6-terra | 402 s | 0（Fix 1 生效） | 含（Fix 3 未覆盖行内形态） | review_required |
| `81827b80`（+Fix 3c） | gpt-5.6-terra | 424 s | 1 次（`markdown-residue` P1 + `duplicate-paragraph` P2 → 硬缺陷直接回退，未烧重试） | **labels=[] scene_headers=0** | review_required（critic provider 失败） |

- run `81827b80` 版本行：`source=model` 5692 字（过门落库）+ `source=fallback` 4186 字（无任何分镜字段）；窗口内 `parameter_incompatible` = 0。

## 验证中暴露的连带缺陷（Plan 265 回归）

- 现象：真机每调用都 400（`parameter_incompatible`，`rejectedParameter: undefined`），planner/writer/critic 全部退化；反代日志：`thinking: validation failed | provider=codex model=gpt-5.6-terra error=level "minimal" not supported, valid levels: low, medium, high, xhigh, max`。
- 根因：Plan 265 给未知 OpenAI 兼容端点统一下发 `reasoning_effort: 'minimal'`（对 antigravity 有效，它会把 minimal clamp 到 low），但 codex 系后端只接受 low/medium/high/xhigh/max；且 `getParameterRejection` 只认 `thinking|reasoning` 字样，这种「档位不合法」报文（无 param、无 thinking 字样）识别不出 → 无 omit_thinking 重试 → 整章退化。
- 修复：`server/lib/server-llm.ts` 取值改 `'low'`；`getParameterRejection` 的思考控制签名扩到 `/thinking|reasoning|valid levels/i`；新增用例「level-only rejections are treated as thinking-control rejection and retried」。修复后真机 `parameter_incompatible` = 0。

## 残余 / 后续

- critic 侧真机仍偶发 provider 失败（500 / parse）→ `审计不可用` → `review_required`（诚实降级）；与本次改动无关，属反代/上游稳定性，已在 `plans/263` 登记同类观察。
- Fix 2 的真机触发需要「软命中为主」的门失败（场景拼接累计 ≥3 条软命中）；本次真机未出现（真机软命中未达阈值），由集成测试覆盖。
- 保底稿仍是确定性模板散文（可读但情节薄），critic 低分属预期；它只作为模型不可用时的兜底预览。

## 证据文件

- `/tmp/gate-fail-gemini2.jsonl`（门失败明细：len / violations / findings / mechanicalScore）
- `/tmp/gate-in-gemini2.txt`（门输入全文快照，DEBUG_GATE_IN=1）
- `/tmp/writer-prompts-gemini2.jsonl`（writer 提示词与响应，DEBUG_WRITER_PROMPT=1）
- `/tmp/chain-gemini.log`（SSE 逐事件）、`/tmp/inkflow-server-3301-gate.log`（服务日志：门告警 / ProviderError / llm-usage）
- `/tmp/chain-drive-3301.py`（驱动脚本：token → 文风 resolve/confirm → start-stream SSE → 只读 sqlite 取证）

## 复跑命令

```bash
# 定向（node 22.22.3）
NODE_ENV=test node --test --test-timeout=45000 --import tsx --import ./tests/helpers/test-db-preload.ts \
  tests/draft-quality.test.ts tests/writer-quality-gate-retry.test.ts tests/server-llm.test.ts

# 真机（隔离库/配置 + 调试埋点；服务须宿主侧启动，bash 沙箱写 vite 临时文件会 EPERM）
bash /tmp/launch-3301-gatedbg.sh   # PORT=3301 INKFLOW_DB_PATH=/tmp/inkflow-writetest/data.db
python3 /tmp/chain-drive-3301.py   # SSE → /tmp/chain-gemini.log
```
