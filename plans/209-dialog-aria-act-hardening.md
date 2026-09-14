# Plan 209: 弹窗 aria id 硬化 + act() 警告清理（小项）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 95aefc3..HEAD -- src/components/skills/PackageConfigDialog.tsx src/components/SkillsStudioView.tsx src/tests/plan158-skills-studio-candidates.test.tsx src/tests/skills-studio-plan158.test.tsx src/tests/skills-configuration-session.test.tsx`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt（a11y/测试卫生）
- **Planned at**: commit `95aefc3`, 2026-09-14

## Why this matters

plan205 台账行登记的遗留小项（来源：Round 31 执行期发现）：

1. **弹窗 `aria-labelledby`/`aria-describedby` 用固定字符串 id**：多实例渲染或测试残留 DOM 时可串名——无障碍关系指向错误标题，跑批饥饿场景下显形（超时残留 DOM + 新渲染实例同 id 级联，与 Round 31 观察到的跑批失败形态一致）。
2. **两个组件的测试存在 React `act(...)` 警告未处理**：async onClick 的 await 后续更新落在 act 外，警告噪音掩盖真实回归信号。

## Current state（2026-09-14 勘察，锚点基于 `95aefc3`）

- 固定 id 位置：
  - `src/components/skills/PackageConfigDialog.tsx`：:341-347 `role="dialog"` + `aria-labelledby="capability-package-title"`（:351 对应 `<h2 id>`）；:682 `id="capability-package-submit-help"`（:730-732 `aria-describedby` 引用）。
  - `src/components/SkillsStudioView.tsx`：:2717-2726 flow 详情弹窗 `aria-labelledby="capability-flow-title"`（h2 id 约 :2734）；:2850/:2855 离开确认弹窗 `aria-labelledby="capability-leave-title"`（h2 id 约 :2861）。:2350/:2369 的 section 级 id（含 `capability-package-group-${group.id}` 动态模式）**不在本计划范围**。
- 仓库惯例：全 src 无 `useId` 使用；既有模式是确定性字符串 id（如 `WritingSurface.tsx:93-95` `editor-chapter-heading-${chapter.id}`），且固定 id 是普遍现象（SettingsModal/RelationshipFormDialog/AIAssistant 等）。**本计划只硬化「dialog aria 配对 id」这一最小面**，不做全仓迁移。
- 字面量断言（改关系断言时受影响）：`src/tests/plan158-skills-studio-candidates.test.tsx:275`、`src/tests/skills-studio-plan158.test.tsx:1590`（均断言 `aria-describedby === 'capability-package-submit-help'`）。
- act() 警告来源：「启用所选」onClick 为 async（`PackageConfigDialog.tsx:737-755`，`await onApplyPackage()`/`await onApply(...)` 后更新 zustand store/组件 state，落在 act 外）；消费它的测试 `skills-configuration-session.test.tsx:114-130`（:129 `fireEvent` 点击 + 同步断言）覆盖不到后续更新。`skills-package-store.test.tsx:182-201` 的 `waitFor` settle 是既有对齐模式。测试 setup（`src/tests/setup.ts`）无额外 act 环境处理。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 受影响套件 | `npx vitest run src/tests/plan158-skills-studio-candidates.test.tsx src/tests/skills-studio-plan158.test.tsx src/tests/skills-configuration-session.test.tsx src/tests/skills-package-store.test.tsx` | 全绿且 **0 条 act 警告** |
| 前端全量 | `npm run test:frontend` | 全绿（当前基线 889/889） |
| typecheck | `npm run typecheck` | 0 错误 |
| a11y 关系抽查 | `getByRole('dialog', { name: <包名> })` 在新测试中可解析 | 通过 |

## Scope

**In scope**：

- `PackageConfigDialog.tsx` + `SkillsStudioView.tsx` 三处弹窗的 `aria-labelledby`/`aria-describedby` 配对 id 改 `React.useId()` 派生
- 上述两处字面量断言改关系断言（`getByRole('dialog', { name })` / `within(dialog)` 内解析 describedby 指向的可见提示文本）
- `skills-configuration-session.test.tsx`「启用所选」点击改 `await act(...)` 包裹或 waitFor settle（对齐 `skills-package-store.test.tsx:182-201` 模式），消除 act 警告
- `plans/README.md` 本行 + 205 行遗留小项备注更新

**Out of scope**：

- 全仓库确定性字符串 id 惯例迁移（SettingsModal/AIAssistant 等一律不动）
- SkillsStudioView :2350/:2369 section 级 id（非 dialog aria 配对）
- 任何生产逻辑/视觉行为变化（id 值变化对用户不可见；plan158 文案守卫断言语义不变）

## Steps

### Step 1: useId 派生 dialog aria id

四处弹窗 aria 配对（PackageConfigDialog ×2 组、SkillsStudioView flow 详情 + 离开确认）改 `useId()` 派生（如 `` `${base}-${useId()}` `` 或直接用 useId 值做 id/aria 两端）。保持 `<h2>`/提示元素与 aria 属性的配对关系不变。

**Verify**: typecheck + 受影响四套件全绿（字面量断言此时会红——与 Step 2 同批落地或先行临时跳过说明）。

### Step 2: 字面量断言改关系断言

`:275` 与 `:1590` 两处改为：`getByRole('dialog', { name: <包名> })` 可解析（name 来自 labelledby 关系）+ `within(dialog).getByText(<提交帮助文案>)` 存在且该元素 id 等于提交按钮的 `aria-describedby` 值——断言「关系成立」而非「id 等于某字面量」。

**Verify**: 受影响四套件全绿。

### Step 3: act() 警告清理 + 台账

「启用所选」的 fireEvent 点击包进 `await act(async () => { ... })`（或改 waitFor 断言 spy/store settle）；如仍有挂载期 fetch 的零星警告，按同一模式收敛。验收口径：受影响四套件运行输出 **0 条 `act(...)` 警告**。完成后更新 `plans/README.md` 本行转 DONE，205 行遗留小项备注「已由 209 核销」。

**Verify**: 四套件输出无 act 警告；前端全量绿；台账落账

## Test plan

受影响四套件 + 前端全量 + typecheck。纯测试/标记层改动，无生产行为变化，不需要 E2E。

## Done criteria

- [ ] 三处弹窗 aria 配对 id 由 useId 派生，多实例不串名
- [ ] 两处字面量 id 断言改为关系断言，语义等价
- [ ] 受影响套件 0 条 act 警告；前端全量 + typecheck 绿
- [ ] 台账 209 行转 DONE、205 行遗留小项已核销

## STOP conditions

- `getByRole('dialog', { name })` 改造后无法解析（labelledby 关系断裂的存量问题暴露）→ 停止报告实际可达名，先修 aria 配对再继续。
- act 警告根因不在测试侧而在生产代码（如 effect 内直接 setState 的真实缺陷）→ 停止归因另立，不并入本计划。

## Maintenance notes

本计划是 plan199 观察到的「跑批饥饿 → aria-labelledby 重复 id 级联」的增量硬化，不承诺消除跑批间歇失败本身（根因分层见 207 与 Round 31 归因）。
