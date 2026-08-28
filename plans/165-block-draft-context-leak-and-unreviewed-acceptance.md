# Plan 165: 阻断正文上下文泄漏、机械重复与未审阅误接受

> **Executor instructions**: 严格按步骤执行，只修改 Scope 中列出的文件。每步运行对应验证；遇到 STOP condition 立即停止并报告，不得扩大范围。不要更新 `plans/README.md`，由审查者维护。
>
> **Drift check**: 当前工作区 `.git/HEAD` 被 macOS 标记为 `dataless`，Git 命令无法稳定读取。执行前直接核对下述符号与当前代码；若不匹配，停止并报告。

## Status

- **State**: DONE (2026-08-23; isolated review passed)
- **Reviewed worktree**: `/private/tmp/inkflow-live-review.CVqoF9`
- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/161-literary-quality-contract.md`, `plans/163-literary-quality-lint-closure.md`
- **Category**: bug
- **Planned at**: working tree inspected 2026-08-21; Git SHA unavailable because `.git/HEAD` is a cloud placeholder

## Why this matters

真实浏览器链路已生成包含 `前情提要及剧情内存 (RAG Context)`、题材/平台参数、字数参数和“第一章从……开场”等内部信息的正文；保底草稿还大量重复“他没有”“没有人”“危险却没有退去”等固定节奏。当前质量门禁不能稳定识别这些长文本污染和机械重复，语义审阅未知时界面又允许一次点击直接接受风险。完成后，污染或机械模板不能成为可接受候选，未审阅风险必须经过明确二次确认。

## Current state

- `shared/lib/draft-quality.ts`: `META_LINE`/`META_TOKEN` 未覆盖完整 RAG 标题、平台/字数参数和嵌入式写作指令；`repeated-opening` 排除了常见代词开头并只记为 P2。
- `server/helpers/fallback-draft.ts`: 固定 `paragraphTemplates/cadence/texture/reflection/turn/cycleBridges` 循环扩写至 4000 字，容易生成机械正文。
- `tests/draft-quality.test.ts`: 已覆盖基本元数据、乱码、短场景和重复段落，但没有覆盖超过 4000 字的 RAG 污染、固定模板短语密度和常见主语开头重复。
- `src/components/ChapterCompletionReview.tsx`: `quality === 'unknown'` 时直接显示“接受风险”按钮，没有明确确认控件。
- `src/tests/editor-completion-flow.test.tsx`: 当前断言一次点击即可接受风险。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Backend tests | `NODE_ENV=test node --test --test-timeout=45000 --import tsx --import ./tests/helpers/test-db-preload.ts tests/draft-quality.test.ts` | exit 0 |
| Frontend tests | `npx vitest -c vitest.config.frontend.ts run src/tests/editor-completion-flow.test.tsx` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Diff hygiene | `git diff --check` | exit 0；若仅因已知 dataless Git 元数据无法运行，原样报告 |

## Scope

**In scope**

- `shared/lib/draft-quality.ts`
- `server/helpers/fallback-draft.ts`
- `server/helpers/ai-production-pipeline.ts`
- `server/routes/production.ts`
- `tests/draft-quality.test.ts`
- `tests/production-stream-disconnect.test.ts`
- `tests/production-domain-integrity.test.ts`
- `src/components/ChapterCompletionReview.tsx`
- `src/components/EditorView.tsx`
- `src/tests/editor-completion-flow.test.tsx`

**Out of scope**

- `data.db`、数据库 Schema、Provider 配置、Prompt 模板、能力中心、开书向导、版本历史协议、审稿 API。
- 不新增依赖，不降低 4000 字目标，不把语义质量伪装成确定性通过。

## Steps

### Step 1: 扩展正文污染硬门禁

在 `shared/lib/draft-quality.ts` 增加稳定检测，至少覆盖：完整 `RAG Context`/“前情提要及剧情内存”标题、目标平台/题材/篇幅/字数/文风参数、独立的英文题材平台标签、`第一章从……开场`、`直接围绕……打造`、`延续上一章剧情` 等送模或规划说明。污染必须为 P0/P1 阻断；普通小说中自然出现“第一章”或数字不得误报。

**Verify**: 定向 Node 测试中新增长文本污染 fixture 被拒绝，普通多段小说仍通过。

### Step 2: 将机械重复升级为阻断问题

检测重复完整句、常见机械句首（包括“他没有”“没有人”“这一次”）和保底模板固定短语密度。达到明确阈值时标记 P1；少量自然重复或短对白仍允许。阈值与辅助函数保持纯函数、可测试，不引入语义评分假象。

在 `server/helpers/fallback-draft.ts` 减少单段内固定句阵列的叠加：每次扩写只选择必要的动作、细节和转折，不再把 cadence、texture、reflection、turn 五组全部拼到同一段。保底结果如果仍触发重复门禁，应被拒绝而非伪装成高质量正文。

**Verify**: fallback fixture 不含同一固定句重复；人工构造的高密度机械句被 P1 阻断；普通场景测试继续通过。

### Step 3: 未审阅风险增加显式二次确认

在 `ChapterCompletionReview` 中把状态拆清楚为“确定性检查”和“语义审阅未知”。未知时按钮文案改为“接受未审阅风险”，默认禁用；用户必须先勾选带明确后果的确认框。确认必须绑定当前 `contentHash + planHash`，结果变化后旧确认不可复用。`EditorView` 必须把风险确认请求的成功/失败结果返回给组件；请求进行中禁用重复点击，仅成功后锁定当前结果，失败后保留确认并允许重试。重试与返回编辑入口保持不变。

**Verify**: 前端测试证明默认不能提交、请求中不能双击、失败后可重试、成功后只能提交一次、换一份结果后需重新确认。

### Step 4: 验收

在 `server/helpers/ai-production-pipeline.ts` 的模型不合格和模型异常两条 fallback 路径中，fallback 必须再次执行 `validateChapterDraftQuality`。失败时抛出既有稳定错误格式 `DRAFT_QUALITY_GATE_FAILED:<violations>`，不得发送正文 token 或以 `PipelineResult.draft` 返回。

在 `server/routes/production.ts` 的非流式与流式即时 fallback 路径中，必须在 SSE 展示、持久化和创建版本前执行同一质量门禁。不合格 fallback 不得成为 `review_required` 候选或 `fallback` 版本；保留明确、可重试的质量失败状态。模型管线失败后不得把 fallback 误记为 `model` 版本。

**Verify**: 定向生产测试证明不合格 fallback 不会被展示/持久化为可应用版本，且既有 apply 质量门禁继续返回 `422 DRAFT_QUALITY_GATE_FAILED`。

### Step 5: 验收

运行定向 Node、Vitest、typecheck 和 diff hygiene。不得访问生产数据库。

## Done criteria

- [ ] 超过 4000 字的 RAG/平台/字数/规划说明污染正文被硬门禁拒绝。
- [ ] 高密度机械句式和保底固定短语为 P1，不能成为可接受候选。
- [ ] 普通中文小说、多段场景和短对白没有新增误报。
- [ ] 语义审阅未知时必须显式勾选后才能“接受未审阅风险”，确认不能跨结果复用。
- [ ] 生产流的不合格 fallback 不会展示、持久化或被误标为 `model` 候选版本。
- [ ] 定向 Node、Vitest、typecheck 通过；无依赖和数据库变更。

## STOP conditions

- 需要修改 Prompt、Provider、数据库、能力中心或开书向导才能完成本计划。
- 质量门禁只能通过大范围词库或语义模型实现，无法用高置信确定性规则控制误报。
- 现有源码符号与 Current state 不匹配。
- 任一验证连续两次失败且修复需要扩大 Scope。

## Maintenance notes

- 确定性门禁只负责证明“不是内部上下文、乱码或机械模板”，不能宣称人物、世界观或文学质量已通过。
- 后续 fallback 模板变化时必须同步更新高密度模板测试，避免用单条关键词误伤正常小说。

## Review evidence

- Drift check passed; all planned symbols were present and no scope expansion was required.
- `NODE_ENV=test node --test --test-timeout=45000 --import tsx --import ./tests/helpers/test-db-preload.ts tests/draft-quality.test.ts tests/production-stream-disconnect.test.ts tests/production-domain-integrity.test.ts`: 43/43 passed.
- Pipeline sentinel: 2/2 passed; low-quality model/fallback returns `DRAFT_QUALITY_GATE_FAILED` without writer tokens or persistence.
- Frontend review flow: 9/9 passed; unknown semantic review requires current `contentHash + planHash` confirmation and supports retry without double submit.
- `npm run typecheck`, `npm run lint`, and `git diff --check`: passed.
- Full deterministic backend suite: 1092/1092 passed; full frontend suite: 825/825 passed.
- The implementation was already present in the working tree; the executor made no additional source changes. Existing unrelated working-tree modifications were preserved and not treated as Plan 165 scope.
