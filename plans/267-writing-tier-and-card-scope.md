# Plan 267 —— 写作档位与卡片阶段范围（三项后续）

- Status: ✅ 已完成（2026-10-01）
- Labels: `ready-for-agent`
- 上游：Plan 266（正文质量门与保底稿）、Round 50 研究记录（`docs/research/generation-quality-ab.md`）

## 0. 摘要

Round 50 交付后给出三个后续候选，本轮全部执行：

1. ③ 卡片生效阶段标注：`hook-card` 只映射 planner，UI 既不标注也不解释 → 新增「生效阶段」徽标（不改 `CARD_STAGE_MAP` 行为）；并加 `INKFLOW_REASONING_EFFORT` 环境覆盖（写作档位实验用，默认行为不变）。
2. ① 写作档位真机对照（应用内，n=2/档）：**`high` 不可用**——慢 5.7×、稿更短、critic 70s 超时导致审计不可用；`low`（现状）在全部操作维度更优。
3. ② 多场景卡 A/B（n=4/臂，三场面）：结构读数与盲评**仍无正向因果效果**（no-card 4:1 胜）。

## 1. ③ 卡片生效阶段标注 + 推理档位覆盖

### 变更

- `src/lib/capability-stage-cards.ts`：新增 `CARD_STAGE_LABELS`、`CardStageScopeSummary`、`summarizeCardStageScope(cardType)`（单源仍是 `shared/types/capability-execution.ts:168-176` 的 `CARD_STAGE_MAP`）。
- `src/components/book-factory/SkillCardDetails.tsx` / `src/components/book-factory/BookFactoryOutput.tsx`：徽标 `data-testid="card-stage-scope"`，文案「生效阶段：{label}」；非 writer 生效时补「（不进入写作提示）」。
- `server/lib/server-llm.ts`：`export const REASONING_EFFORT_OVERRIDE_ENV = 'INKFLOW_REASONING_EFFORT'`、`export function resolveReasoningEffortOverride(env = process.env)`（`/^[a-z]{3,10}$/`，否则 null）；写作调用点改为 `request.reasoning_effort = resolveReasoningEffortOverride() ?? 'low';`（未设环境变量时与旧行为逐字一致）。
- 测试：`tests/server-llm.test.ts` 新增 1 例（**30/30**）；新 `src/tests/card-stage-scope.test.tsx`（5 例）；前端受影响面 3 files / 19 tests 全绿。

### 决策理由

不改 `CARD_STAGE_MAP`：钩子卡正文属剧情/规划语义，注入 writer 会把剧情指令当写作规则；需求是消解「挂了但不生效」的误解，因此用 UI 标注（「不进入写作提示」）。

## 2. ① 写作档位真机对照（应用内，n=2/档）

隔离实例 3301（生产库副本 + 独立 config），同一作品/章节，`INKFLOW_REASONING_EFFORT` 控制档位（代理日志实证 `level=high|low`）。

| arm | run | elapsed | model 稿 | fallback 稿 | 门禁 | critic |
| --- | --- | --- | --- | --- | --- | --- |
| high | `1660c581` | 425.3 s | 5235 字 | 4186 字 | pass | **审计不可用**（请求失败） |
| high | `da0013d5` | 376.9 s | 4875 字 | 4186 字 | pass | **审计不可用** |
| low | `aa9eb6f5` | 62.8 s | 5950 字 | 4186 字 | pass | 结构化 audit JSON（scores/totalScore） |
| low | （r2） | 70.6 s | 6053 字 | 4186 字 | pass | 结构化 audit JSON |

- 文体读数（`/tmp/effort-metrics.json`）：high 5055 字/80.5 段/对白 0.18/套话 1.0；low 6001.5 字/123.5 段/对白 0.15/套话 2.5；两臂门禁 2/2。
- 机制：high 档下 writer 出现 `empty_response / reasoning_only`（`server/lib/server-llm.ts:153-159` 明确**不可重试**）与 critic 70s 超时（`Critic request failed (unknown) — retrying once with 70000ms timeout`）。
- 结论：**默认保持 `low`**。若要启用 high，必须先（a）放宽/重构 critic 超时策略，（b）处理 reasoning-only 流（不因纯推理直接回退保底稿）——属下一次变更范围。

## 3. ② 多场景卡 A/B（n=4/臂）

固定三段式 BEATS（3000-4500 字，锚点：销户 → 登记簿/车次 → 死亡确认书/最后一班车），臂 = `no-card` / `pacing-card`。

- 结构读数（`scripts/report-card-ab-structure.ts` → `/tmp/cardab4-struct.json`）：
  - no-card：4180 字均 / 73.5 段 / 锚点覆盖 **1.0** / 场序 4/4 / 门禁 4/4。
  - pacing-card：4175 字均 / 60.75 段 / 锚点覆盖 **0.9** / 场序 3/4 / 门禁 4/4。
- 盲评 8 场（claude-sonnet-4-6 / gpt-oss-120b-medium）：有效 5 场，**no-card 4 : pacing-card 1**（claude 1:0、gpt-oss 3:1）；claude 3 场因 markdown 包围 JSON 解析失败。
- 结论：多场景条件下仍未观察到 pacing 卡的正向因果效果；与单场景 n=8（11:5、p≈0.11）一致 —— 方向弱偏挂卡，本轮样本反而偏向不挂卡。

## 4. 残余

- **R-267-1（新发现）**：两臂草稿尾部都出现与主线无关的「年代戏」片段（如「更鼓敲过……灯花矮了……」「布庄打烊前……掌柜的报了个价」），同臂跳 rep 逐字相同；全库检索这些字符串只命中 run/version 草稿（不在资料包/世界观表）→ 疑似上下文或卡片文本被原样带出，需单独定位。
- **R-267-2**：critic 70s 超时在 high 档必然触发（`CRITIC_LLM_OPTIONS` + 70000ms 重试）——高档位前置修复项。
- **R-267-3**：盲评脚本对 claude 的 JSON 容错不足（3/4 解析失败）→ 应强制 strict `json_schema`。

## 5. 复现

- 门禁：`npx tsc --noEmit`；`npx eslint server src shared tests scripts --max-warnings=0`（本轮 TSC_EXIT=0 / LINT_EXIT=0）。
- ① ：`INKFLOW_REASONING_EFFORT=high|low bash /tmp/launch-3301-effort.sh` + `python3 /tmp/effort-ab-run.py`。
- ② ：`python3 /tmp/cardab4-launch.py` → `python3 /tmp/cardab4-run.py`；结构读数 `node --import tsx scripts/report-card-ab-structure.ts /tmp/cardab4`；盲评 `python3 /tmp/cardab4-judge.py`。

## 6. 证据文件

`/tmp/effort-ab/result.json`、`/tmp/effort-metrics.json`、`/tmp/cardab4-result.json`、`/tmp/cardab4-struct.json`、`/tmp/cardab4-judge.json`、`/tmp/cardab4/*.txt`、`/tmp/p267-gates.log`、`/tmp/cardab4-run.log`。
