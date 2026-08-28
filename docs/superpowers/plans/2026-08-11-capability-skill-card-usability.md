# Capability Skill Card Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** Make capability store and deconstruction skill cards usable from the writing flow without forcing writers to understand the whole store.
**Architecture:** Reuse existing project deck, chapter capability state, capability launch, and manifest models. Add lightweight stage/category mapping and scoped UI labels before any storage model expansion.
**Tech Stack:** React, TypeScript, existing capability manifest/types, Vitest.

## Scope

Allowed files for the first implementation slice:

- `shared/types/capability-manifest.ts`
- `shared/types/skills.ts`
- `shared/lib/capability-manifest-catalog.ts`
- `src/lib/capability-launch.ts`
- `src/lib/chapter-capability-state.ts`
- optional new pure helper: `src/lib/capability-stage-cards.ts`
- `src/components/AgentWorkspaceKnowledgePanel.tsx`
- focused tests under `src/tests/`

Current dirty files to treat carefully before implementation:

- `server/routes/writing-style.ts`
- `server/validation.ts`
- `shared/types/capability-execution.ts`
- `src/components/SkillsStudioView.tsx`
- `src/lib/capability-configuration-client.ts`

Do not overwrite or revert those files without Sol review.

Do not:

- add a new database table
- redesign Skills Studio
- add verbose "skill effect explanation" UI
- expose internal terms like `mounted`, `overlay`, `utility`, `guardrail` as primary labels
- make style cards default without user confirmation

## Task 1: Add Author-Facing Card Category Mapping

Steps:

- [x] Create a pure helper that maps existing card/manifest kinds to:

```text
文风卡
结构卡
世界观卡
审稿卡
精修卡
护栏卡
```

- [x] Map current `DeconstructionCardType` minimally:

```text
style -> 文风卡
hook/conflict/pacing/platform -> 结构卡
worldview/character -> 世界观卡
critic diagnostic/utility -> 审稿卡
transform-preview -> 精修卡
guardrail/system -> 护栏卡
```

- [x] Add tests covering all known current types.

Expected test command:

```bash
npm run test:frontend -- --run src/tests/capability-stage-cards.test.ts
```

## Task 2: Normalize User-Facing Scope Labels

Steps:

- [x] Reuse existing scopes:

```text
project -> 作品默认
chapter -> 本章使用
single-run -> 仅运行一次
system -> 系统启用
```

- [x] Map actions:

```text
用于本章 -> add-to-stack / use-overlay
设为项目默认 -> configuration preview/apply
仅运行一次 -> utility/diagnostic execution
```

- [x] Keep unsupported scope actions disabled or absent.
- [x] Test action/scope mapping as pure logic.

Expected test command:

```bash
npm run test:frontend -- --run src/tests/capability-launch-state.test.ts
```

## Task 3: Add Lightweight Effective Skills Summary

Steps:

- [x] In the writing flow, show a compact summary only:

```text
作品默认 N · 本章 N · 系统护栏 N
```

- [x] Show at most 3-5 active card names; fold overflow.
- [x] Do not add a prompt/debug explanation strip.
- [x] Ensure current chapter switch updates the summary.
- [x] Do not require opening Skills Studio for the summary.

Expected test command:

```bash
npm run test:frontend -- --run src/tests/agent-workspace-knowledge-panel.test.tsx
```

## Task 4: Keep Writeback Safe

Steps:

- [x] Confirm polish/writeback still previews before applying.
- [x] Confirm confirmed writeback creates or preserves version behavior.
- [x] Confirm world-bible writes still require user confirmation.
- [x] Do not auto-apply skill-card output to manuscript or world bible.

Status notes:
- Author-facing category/scope/action mapping lives in `src/lib/capability-stage-cards.ts` and is covered by `src/tests/capability-stage-cards.test.ts` plus `src/tests/capability-launch-state.test.ts`.
- The real Skills Studio capability store card UI now consumes the author-facing mapping for categories, scopes, and primary actions; `src/tests/skills-studio-plan158.test.tsx` covers structure/world/style/polish/deconstruction/diagnostic cards and blocks old internal scope labels.
- Capability packages now use the canonical package step recipes from `shared/lib/enhancement-packages.ts` and render author-facing package action/scope labels; `src/tests/skills-studio-plan158.test.tsx` covers run-now and project-configuration package components.
- Capability package result states now explain the next author action from each step's mode and manifest; focused coverage verifies audit, rule-confirmation, and polish-preview outcomes.
- Capability package result states are now keyed by package step, so a two-step card can show `本章规则待确认` and `精修预览待生成` on the correct rows instead of mixing by asset id.
- Diagnostic and utility package rows now say `不改正文` instead of the tool-centric `仅提供工具`, so authors can see the action is read-only.
- Capability package entry and dialog copy now explains that submission reveals per-step next actions and does not directly rewrite prose, replacing the vague `不自动应用` badge.
- Import-gated package components now say `加入后可勾选` / `加入后再提交` / `加入并勾选`, removing the repeated `先加入...后可选择` wording.
- Imported package components now show `已勾选，待提交` after `加入并勾选`, making the remaining submission boundary explicit.
- Capability package submission now shows the concrete disabled reason inline after a selection, instead of hiding required-step guidance in the submit button title.
- Capability package required-step blockers now name the missing required ability, so authors know exactly what to add before submitting.
- Capability package dependency blockers now name the missing preceding ability, instead of showing a generic `前置能力` message.
- Capability package cards now show closed-package selections as `待提交 N 项` instead of the ambiguous `暂存` copy.
- Capability package dialogs now count current selections as `待提交 N 项`, keeping the pre-submit state consistent inside and outside the dialog.
- Capability package submission now clears the pending selection count after results appear, so completed rows do not still look unsubmitted.
- Capability package result rows now prefix follow-up states with `下一步：`, matching the package promise that submission reveals the next author action.
- Capability package terminal results now use `结果：...` for unavailable/conflict/skipped rows, separating dead-end outcomes from actionable next steps.
- Capability package dialogs now relabel the disabled submit button as `选择能力后可提交` after submitted results clear the pending selection.
- Capability package post-submit disabled reason now says `请选择要继续提交的能力`, matching the post-submit empty-selection state.
- Capability package helper copy and utility run results now say `辅助动作` instead of tool-centric `工具`, while keeping the existing category navigation unchanged.
- Capability package result rows now expose direct action buttons for run-now review diagnostics, polish previews, and utility actions, carrying the originating chapter context into the editor launch state.
- Capability package configuration and candidate result rows now explicitly say whether the author must apply the staged configuration or add the candidate to the work deck before it takes effect.
- Capability package dialogs now show a local `应用本包配置并返回写作` action whenever package choices have staged unapplied configuration, so authors do not need to leave the dialog to find the top-page apply button.
- Capability package skill-card candidate rows now expose local `设为主卡` and `设为辅卡` actions, reusing the existing replacement dialog when the work deck is full.
- Capability package skill-card rows now switch to `应用配置后启用作品卡组` once the candidate is assigned to the staged work deck, and hide the now-completed deck assignment buttons.
- Capability package result rows now separate status text from follow-up action buttons, keeping dense review, polish, and deck actions readable inside the dialog.
- Capability store cards now show short `适合：...` use hints for structure, worldbuilding, review, polish, guardrail, and prose cards so authors can scan when to use each ability type.
- Capability store category navigation now labels diagnostic/utility cards as `审稿与辅助` instead of the tool-centric `诊断与工具`.
- Capability store stage filters now use action-oriented labels like `立设定与大纲`, `写正文与提速`, `审稿与精修`, and `过签与平台检查`, with descriptions that tell authors which card type to pick next.
- Capability package cards now show package kind badges such as `审稿包`, `精修包`, `设定包`, and `拆书包`, plus a short post-submit next-step hint on the package cover.
- Legacy role-slot API errors now use `能力卡`/`职责位` wording instead of leaking `mounted skill` text.
- The writing page header, writing surface, and project cockpit no longer show legacy "mounted/temporary overlay" copy; focused tests cover `生效能力卡`, `能力卡 N`, and cockpit `本章使用` labels.
- The AgentWorkspace context panel now uses `作品默认能力卡` and `本章使用卡` copy instead of legacy temporary/mounted ability wording; focused tests cover visible context copy and source-level cleanup guards.
- The book deconstruction factory no longer exposes user-facing `Skill Deck`/`Deck` copy in its main entry, extraction result, details, and save/equip messages; source guards cover these book-factory surfaces.
- Pre-writing entry points now use capability-card copy in AppShell empty state, Library readiness chips, ContextReceipt, and WorldBibleOnboarding; focused tests cover these entry labels and legacy copy guards.
- WorldBible onboarding capability suggestions now say they will not auto-apply, avoiding legacy `装配` wording.
- Welcome page onboarding and recommendation copy now uses `导入`/`启用`/`写入` instead of legacy `挂载` wording.
- The book deconstruction factory now consistently calls extracted units `拆书卡` and project-level combinations `作品卡组`; visible `技能卡组`/`装配`/`叠加` wording is guarded in focused cleanup tests.
- The capability center, welcome page, project preference panels, and writing-style source labels now use `能力卡`/`拆书卡`/`作品卡组` copy instead of legacy `技能库`/`技能卡组`/`装配 Skill` wording; focused source guards cover these surfaces.
- The capability detail drawer now uses `能力卡` wording for its empty state, field placeholders, close label, and current-card preview copy.
- Capability center map, test bench, card accessibility labels, and no-work alert now use `能力卡`/`配置能力` wording instead of `Skill`/`技能试驾`/`装备`.
- Runtime recommendation toasts, API validation/errors, copilot actions, public capability catalog entries, and model prompt assets now use `能力卡`/`拆书卡`/`作品卡组`/`本章使用卡` wording instead of legacy `技能卡`/`挂载`/`叠加` wording; focused source guards cover these runtime and prompt surfaces.
- Writing-style resolver errors and prompt labels now use `本章使用卡`/`作品卡组能力卡`/`主笔能力卡` instead of `临时卡`/`项目技能卡`/`主笔技能` wording.
- Fusion, quality-gate, rewrite, audit, and book-card aggregation messages now use `能力卡`/`启用` wording instead of `技能卡`/`挂载` leakage.
- Writer/rewrite prompt contexts and recommendation explanations now use `当前启用`/`推荐启用`/`应用` wording, and the generated public catalog has been refreshed from the governance source so marketplace goals no longer expose `挂载 ... 提高完读率` copy.
- Copilot writing suggestions now show `作品默认能力卡`/`调整能力配置` wording in visible reason/action text, and stale overlay launch errors now call the failed item a `本章使用卡`.
- The compact writing-flow summary is rendered in `AgentWorkspaceKnowledgePanel` and covered by `src/tests/agent-workspace-knowledge-panel.test.tsx`.
- Skills-panel coverage confirms switching chapters refreshes the effective chapter card count and names.
- System guardrail card names are visible in the writing-flow skills panel, not only counted in the summary.
- AppShell capability-launch coverage confirms diagnostics and overlay cards return to the originating chapter context from the capability center.
- Writing-style service coverage confirms persisted chapter overlay cards change the server-side writing fingerprint and writer prompt, not just the UI summary.
- Hook-level coverage confirms active chapter card IDs are preserved in draft, audit, polish, and chapter-production requests.
- EditorView component coverage confirms persisted chapter cards hydrate into the writing skills panel and generation/production hook inputs.
- Transform previews remain read-only until the user clicks apply; apply creates a chapter version first and now rejects invalid selection ranges before writing.
- EditorView component coverage confirms applying a transform preview creates the pre-apply chapter version before writing the preview into the editor.
- EditorView capability result panel now labels running/result states as `能力卡`/`审稿卡诊断报告`/`精修卡修改预览`, and the preview apply action is visible as `应用精修预览`.
- World-bible and character-card planner techniques return outline candidates through `/api/generate-outline`; tests confirm the generated candidate does not mutate `globalOutline`, `worldRules`, or world entity tables.
- Prompt asset success signals now describe deconstruction output as directly guiding writing, avoiding the legacy `职责卡` metaphor.
- Governance reasons, capability-detail labels, onboarding recommendations, and deconstruction prompts now use `能力卡`/`能力画像`/`拆书卡组` wording instead of legacy `技能`/`职责` copy.
- Library readiness chips, writing-workbench context receipts, and the writing surface header now count v3 `作品卡组` cards before falling back to legacy mounted IDs, so configured capability decks no longer appear as `能力卡 0/3` or `能力卡 0`.
- AgentWorkspace context lists now show v3 `作品卡组` card names instead of reading only legacy mounted slots.
- Editor intelligence context now includes v3 `作品卡组` cards in `mountedSkills` and Copilot readiness, so front-end writing guidance does not silently treat configured projects as cardless.
- Writing-style source summaries now include planner/world/structure cards from v3 `作品卡组`, not only writer-stage cards, so effective project cards stay visible to authors.
- Production context receipts now label runtime stage prompt sources as `规划/正文/审稿阶段能力卡与护栏`, making capability usage evidence author-facing instead of raw engineering stage labels.
- Editor capability result panels now show `本次能力来源` from runtime receipts or the current writing-style sources, so diagnostic/polish results can be traced back to the active cards.
- One-shot capability result panels now always include the launched card title in `本次能力来源`, even when the utility response has no receipt sources.
- One-shot diagnostic/polish utility execution now returns context receipt sources for the target text and the concrete `审稿卡`/`精修卡`, instead of only a bare chapter id.
- Prompt governance inference now respects v3 `activeFlowId` and includes v3 `作品卡组` IDs in capability-aware routing checks before falling back to legacy mounted IDs.
- Real Skills Studio coverage confirms `仅运行一次` 审稿卡 launches preserve the originating `targetChapterId` instead of making the writer reselect a chapter.
- Precision-polish transform cards now expose both `用于本章` and `仅运行一次`; the one-shot path launches the existing read-only polish preview with the originating chapter context.
- Capability center and Book Factory visible copy now says `能力卡`/`我的能力卡` instead of the fuzzier `能力库`, and scope labels say `仅运行一次` instead of `单次运行`.
- Server-side capability invocation now accepts preview-only transform cards as read-only one-shot polish utilities, so the `仅运行一次` 精修入口 does not fail after navigation.
- Capability store cards now only show `仅运行一次` when the current route can actually run that card as a one-shot utility; ordinary writing techniques show `本章使用` only.
- One-shot polish previews now use a deterministic zero-API de-AI rewrite helper instead of echoing the original chapter text unchanged.
- One-shot polish previews now branch by card: the rhythm-restorer card produces short-sentence rhythm previews instead of sharing the slop-shield output.
- Applying a one-shot polish preview now rejects no-op previews and empty whole-chapter previews before creating a version or writing content.
- Applying a one-shot polish preview now leaves an in-editor success state that explains the pre-apply version was saved for rollback.
- One-shot diagnostic reports now show a clear next step for each issue: revise manually or run a polish card to generate a preview before applying.
- One-shot diagnostic issue rows now include an `打开精修卡` action that preserves the current chapter and opens the capability center in the polish stage.
- Capability center stage launches now open the capability store directly on the relevant stage instead of landing on the generic personal-card tab.
- Editor-origin polish-stage visits now explain that `生成精修预览` returns to the originating chapter with a read-only polish preview.
- Polish preview cards now label their single-run action as `生成精修预览`, while diagnostic cards keep the generic `仅运行一次` label.
- Polish preview cards now label their chapter-scoped configuration action as `本章启用规则`, avoiding confusion with preview generation.
- Polish preview cards now label their favorite action as `收藏精修卡` instead of generic `收藏技法`.
- Enabling a polish card for the current chapter now confirms `本章精修规则` instead of the generic `本章技法`.
- Polish-rule save failures now show `本章精修规则保存失败，请重试` instead of a generic chapter capability-configuration error.
- Diagnostic cards now label their direct action as `运行审稿诊断`, while retaining `仅运行一次` as the scope label.
- Capability package component rows now reuse card-specific run labels such as `运行审稿诊断` and `生成精修预览`.
- Capability package scheduled polish components now say `本章启用规则` instead of the generic reminder label.
- One-shot polish preview/application events now share a stable action session, and local metrics expose `精修预览应用率` from real transform previews instead of a synthetic diagnostic apply event.
- One-shot capability cancellation and execution-failure telemetry now keeps the same safe action/session envelope, so failed or abandoned `仅运行一次` runs remain measurable without storing error text or manuscript content.
- Runtime writing prompts now label active writing inputs as `写作能力卡组` and `拆书卡规则`, removing engineering `Overlay/Injector/White-Label` wording from the model-facing capability context.
- Capability center leave confirmation now says `能力配置尚未应用` and `未应用的能力配置`, removing the confusing `临时配置` label from the author-facing flow.
- Capability center editor-origin return now says it will go back to the previous chapter, reducing chapter re-selection confusion after visiting the store from writing.
- Capability center, editor fallback toasts, and world-outline prompts now use `能力卡` wording instead of lingering `技能` labels for impact panels, stale legacy cards, and planning-stage context.
- Default prompt templates now use `能力卡规则`/`预期能力卡规则` wording instead of `Skill约束`/`Skills DNA`/`Skill 插件`, keeping model-facing audit and critic prompts aligned with the author-facing capability-card concept.
- Default planner/writer prompt sections now say `当前启用的能力卡规则` and `能力卡规则`, removing remaining `写作卡牌规约`/`叙事 DNA` wording from model-facing generation templates.
- Capability package submission copy now says selected abilities rather than components, making package application read like author-facing capability activation instead of engineering assembly.
- Rewrite/polish prompts now label active writing inputs as `能力卡规则/文风约束`, removing the lingering `叙事 DNA 插件` frame from model-facing rewrite instructions.
- Capability scoring gates now explain non-card assets as `非能力卡资产`, removing runtime `Skill Card` wording from score-channel reasons.
- Fusion risk examples now describe continued use of `世界观能力卡` instead of `叠加世界观型 Skill`, keeping fusion explanations aligned with capability-card language.
- Book-deconstruction job polling and cancellation now return Chinese author-facing task errors instead of `Skill extraction job`/`Cancelled` API leakage.
- Worldbuilding/background job polling and cancellation now return Chinese author-facing task errors instead of generic `Job not found`/`Cancelled` responses.
- Audit job polling and cancellation now return Chinese author-facing task errors instead of `Audit job`/`Cancelled` leakage in审稿卡 flows.
- Audit and world job generation-stale paths now return Chinese task-state errors instead of English database-generation mismatch messages.
- Onboarding story-card and world-setup background jobs now return Chinese task-state errors instead of `Job not found`/`Cancelled`/generation mismatch leakage.
- Onboarding session, story-card, setup-refine, and world-setup validation/fallback errors now use author-facing Chinese guidance instead of raw API field names.
- Generate-outline technique and source-selection failures now use `规划能力卡`/导入资料 wording instead of `Planner` and low-level document/source messages.
- Book-deconstruction extraction now localizes rate-limit and abort fallback errors, keeping拆书卡 flows free of raw `Rate limited`/`Skill extraction` leakage.
- Editor-agent job polling/cancellation and assistant entry/rate-limit errors now return Chinese task/context guidance instead of raw `Job`/`Continuation pack`/`editor-agent` messages.
- Audit and rewrite entrypoints now return Chinese work-context/rate-limit/database-switch guidance instead of raw `novelId`/`Database changed` messages.
- World/character helper entrypoints now return Chinese work-context, rate-limit, and status guidance instead of raw field names and background queue messages.
- Idea-fragment expansion now returns Chinese rate-limit, database-switch, and fallback errors instead of raw `Rate limited`/`Internal server error` leakage.
- Prompt-template test runs now return Chinese parameter, template, rate-limit, and fallback errors instead of raw template-key/API failures.
- Inspiration and draft-generation database-switch paths now use Chinese writing-context guidance instead of raw `Database changed` messages.
- Continuation import and document-parse entrypoints now return Chinese upload/session guidance instead of raw `Rate limited`/`novelId`/cancelled messages.
- Continuation relationship repair, entity extraction, and world-sync entrypoints now return Chinese rate-limit/context guidance instead of raw `Rate limited`/`packId` messages.
- Production start, stream, and apply entrypoints now return Chinese writing-context/version guidance instead of raw `Rate limited`/`novelId`/`Production run`/`Internal server error` messages.
- Capability utility execution now returns Chinese scoped-context/stale-selection guidance instead of raw `chapterId`/`database generation`/`not found` messages.
- Outline and canon-patch APIs now return Chinese stale-generation/not-found guidance instead of raw `database generation changed`/`novel not found` messages.
- Export and DB proxy fallback paths now return Chinese recovery guidance instead of raw `Novel not found`/`Internal server error` messages.
- Idea-fragment expansion validation now uses Chinese missing-content/oversized-input/interruption guidance instead of raw schema/connection messages.

Expected test command:

```bash
npm run test:frontend -- --run src/tests/capability-preview-apply.test.ts
npm run test:frontend -- --run src/tests/chapter-capability-state.test.ts
```

## Validation

Focused:

```bash
npm run test:frontend -- --run src/tests/capability-stage-cards.test.ts src/tests/capability-launch-state.test.ts src/tests/chapter-capability-state.test.ts src/tests/agent-workspace-knowledge-panel.test.tsx
```

Broad:

```bash
npm run typecheck
npm run test:frontend
```

## Rollback

Revert only files touched by this plan. Do not revert pre-existing dirty files unless Sol explicitly authorizes it.
