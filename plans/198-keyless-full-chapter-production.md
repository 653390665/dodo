# Plan 198: 无 Key 全章生产修复——保底草稿模板多样性改造

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat f39b597..HEAD -- server/helpers/fallback-draft.ts shared/lib/draft-quality.ts server/routes/production.ts tests/e2e/real-pipeline-journey.spec.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P1（无 Key 用户的全章生产当前实际不可用）
- **Effort**: M
- **Risk**: MED（保底草稿是确定性文案资产，改造涉及文风；质量门阈值不动）
- **Depends on**: none
- **Category**: product-bug + content
- **Planned at**: commit `f39b597`, 2026-09-12

## Why this matters

Plan 187 E2E 勘察发现（2026-09-11 实测）：空 Key 下 `start-stream` 的保底路径在**默认章长（无字数意图 → minChars=4000）必挂质量门**——`validateCompleteChapterDraftQuality` 对模板扩写稿报 `duplicate-sentence`（P1）/`mechanical-cadence`（P1）/slop 78.4<85，路由走 `DRAFT_QUALITY_GATE_FAILED` → run failed，用户拿不到任何草稿。声明低字数（如「800字」→ minChars=800）则门能过（935 字草稿 ok=true）。也就是说：无 Key 体验能否用，取决于用户是否碰巧在意图里写了小字数——这是隐藏的行为悬崖，不是设计意图。

质量门阈值**不动**（宁缺毋滥是 plan165 的既定语义）；修的是**保底草稿生成器的重复密度**。

## Current state

- `server/helpers/fallback-draft.ts`：
  - `buildFallbackDraft(sceneBeats, contextStr, minChars?)`（265 行）三大分支（isFallbackTemplate 模板 / 场景块解析 / 空态兜底），最终都走 `ensureMinimumDraftLength`（249 行）→ `expandDraftToMinimum` 扩写。
  - `expandDraftToMinimum`（9 行起）从固定句式池（cadence/texture/reflection/turn/detailHints 等数组）循环拼接，`index % N` 型取模复用——**4000 字下同一句式高密度复现**。
  - `buildFallbackSceneBeats(userIntent)`（343 行）三场景模板固定。
- 质量门：`shared/lib/draft-quality.ts`——`MIN_COMPLETE_CHAPTER_CHARS = 4000`（197 行）、`MIN_COMPLETE_CHAPTER_SLOP_SCORE = 85`（199 行）；`validateCompleteChapterDraftQuality`（367 行）叠加 `duplicate-sentence`/`repeated-opening`/`mechanical-cadence`/slop score 判定。
- 实测（2026-09-11 node 直调）：默认意图下 draft 4168 字 → 4 条 findings（见上）；800 字意图 → 935 字 ok=true、0 findings。
- E2E 佐证：`tests/e2e/real-pipeline-journey.spec.ts` 当前用「本章写800字」意图才能走通全链路（workaround 已在台账记录）；`agent-workspace-journey.spec.ts` 同理。
- 参考先例：同文件已有 anti-template 处理（`isFallbackTemplate` 分支的替换表 `他没有→他并未` 等），说明「模板感」问题此前已部分治理过。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 质量复现 | `node --import tsx -e "import {buildFallbackDraft, buildFallbackSceneBeats} from './server/helpers/fallback-draft'; import {validateCompleteChapterDraftQuality} from './shared/lib/draft-quality'; const b=buildFallbackSceneBeats('x'); const d=buildFallbackDraft(b,'ctx'); console.log(JSON.stringify(validateCompleteChapterDraftQuality(d,undefined).findings?.map(f=>f.code)))"` | 修复前 4 findings；修复后 `[]` |
| 保底单测 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/fallback-draft.test.ts` | 全绿（tests/draft-quality.test.ts 也覆盖 buildFallbackDraft） |
| 生产流回归 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/production-stream-disconnect.test.ts tests/production-domain-integrity.test.ts` | 全绿 |
| E2E 回归 | `npm run build && npx playwright test tests/e2e/real-pipeline-journey.spec.ts tests/e2e/agent-workspace-journey.spec.ts` | 全绿（含改回默认意图后） |

## Scope

**In scope**：

- `server/helpers/fallback-draft.ts`（句式池扩容 + 组合策略多样化）
- `tests/draft-quality.test.ts` / `tests/fallback-draft.test.ts`（新断言：默认意图 4000 字过门）
- `tests/e2e/real-pipeline-journey.spec.ts`、`tests/e2e/agent-workspace-journey.spec.ts`（userIntent 从 800 字 workaround 改回真实默认意图）

**Out of scope**：

- `shared/lib/draft-quality.ts` 阈值与判定规则（一律不动）
- 有 Key 模型链路
- 保底草稿的文风品质主观提升（只解决「过门」必需的重复密度）

## Steps

### Step 1: 复现锚定

写一个临时脚本输出默认意图下 4000 字扩写稿的 findings 全文与重复句清单，存 plans/notes-198-repro.md 作为改造基线。

**Verify**: findings 与本计划 Current state 记载一致

### Step 2: 句式池扩容 + 组合去密

目标：4000 字内不触发 `duplicate-sentence`（完整句重复）与 `mechanical-cadence`（保底句式密度），slop ≥85。手段按需组合：

1. 每类句式池（cadence/texture/reflection/turn/bridge）扩到互异句 ≥ 3× 当前循环用量；
2. 取模循环改为带状态的无放回洗牌（确定性：以 sceneBeats+intent 哈希为种子，同输入输出不变）；
3. 段落开头模式多样化（消除 `repeated-opening`）。

每改一轮跑 Step 1 脚本观测 findings 收敛。

**Verify**: Step 1 脚本输出 `findings = []`、slop ≥ 85；连续 3 个不同 intent 均过门

### Step 3: 确定性回归断言

在 tests/draft-quality.test.ts（或 fallback-draft 专属测试）固化：①默认意图（无字数声明）buildFallbackDraft 过 `validateCompleteChapterDraftQuality`；②同 intent 两次生成输出逐字节相同（确定性契约）；③output 长度 ≥ 4000。同时跑保底与生产流既有测试防回归。

**Verify**: 全绿

### Step 4: E2E 撤掉 workaround

`real-pipeline-journey.spec.ts` 与 `agent-workspace-journey.spec.ts` 的 userIntent 改回默认（去掉「本章写800字」），重跑两个 spec + 全套件口径核对（21 passed 基线不退）。

**Verify**: 两 spec 绿；台账 187 行的「附带发现①」标注已修复

## Test plan

见各步 Verify；最终回归 = 保底/生产/质量单测 + 前端全量不受影响（未改前端）+ 两条 journey E2E。

## Done criteria

- [ ] 默认意图 4000 字保底草稿过完整章质量门（确定性、可复跑）
- [ ] E2E 不再依赖低字数 workaround
- [ ] `plans/README.md` 状态行已更新（187 行发现①标注修复）

## STOP conditions

- Step 2 多轮迭代后 slop 仍 < 85 → 停止，报告「扩池上限」与两个替代选项（质量门对保底源豁免＝违背设计意图，不推荐；引导意图降档＝产品策略）供拍板。
- 改造后草稿出现新的 slop 类别命中（如 ai_cliche）→ 报告样例再议。

## Maintenance notes

保底句式池是文案资产：后续任何扩池需跑 Step 1 脚本防密度回归；可考虑把「过门检查」固化进 generate 前的脚本（本计划不强制）。
