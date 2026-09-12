# Plan 199: 陈旧 E2E spec 债清偿——8 个 spec 对照现行契约重写

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat f39b597..HEAD -- tests/e2e/core-flow.spec.ts tests/e2e/unified-creation-new-project.spec.ts tests/e2e/unified-creation-imported-project.spec.ts tests/e2e/plan150-writing-style-confirmation.spec.ts tests/e2e/full-browser-click-journey.spec.ts tests/e2e/mobile-layout.spec.ts tests/e2e/helpers/`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P2（CI E2E 门当前必红，长期掩盖新增回归）
- **Effort**: L
- **Risk**: MED（旧 spec 的部分覆盖面语义可能已过时，重写≠逐字恢复）
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `f39b597`, 2026-09-12

## Why this matters

2026-09-11 全量 E2E 归因（plans/README 行 187/190）：29 用例中 8 个必红，全部是 8 月底写的 spec 断言了 9 月 5-7 日会话（checkpoint 8eaf51b）与后续计划改名前的 UI 契约。CI 的 E2E 门因此长期红，新增回归会被淹没在已知红里——这是测试资产的负资产化。2026-09-12 拍板：**全部重写**。

## Current state（归因清单，逐 spec）

| spec | 失败点 | 现行契约锚点 |
|---|---|---|
| `core-flow.spec.ts:131` happy path | 期望内联按钮「确认并生成」；现行 WritingStyleControl.tsx:105 触发钮未确认态叫「生成本章正文」，确认在「确认本次写法」弹窗内（113 行） | `tests/e2e/agent-workspace-journey.spec.ts` 已跑通现行链路（展开智能管家 → 生成正文页签 → 弹窗确认 → review_required + plan165 门禁用接受钮） |
| `unified-creation-imported-project.spec.ts:126,130` | 「总览」strict violation（Plan 175 switcher 与侧栏按钮重名）——126/130 已锚定 switcher（fa4761e 顺手修）；127 「世界设定」→ 现名「设定」；下一断言 起承转合 textbox 所在世界书落地页布局已变（设定与续写/页签化） | switcher：`page.getByTestId('workspace-family-switcher')`；世界书现行结构勘察见 `tests/e2e/world-bible-journey.spec.ts` |
| `unified-creation-new-project.spec.ts:123` | 60s click 超时（同类导航断言链） | 同上 + runOnboardingToEditor helper |
| `unified-creation-new-project.spec.ts:185` | 「确认事实并写入」不可见（生产治理门禁演化后按钮语义变化） | plan165 门禁：保底源禁直接接受；现行完成本章链路见 unified-creation 老流程核对 |
| `plan150-writing-style-confirmation.spec.ts:166` | 60s click 超时；写法确认流 UI 已改（弹窗化） | WritingStyleControl 现行交互 |
| `full-browser-click-journey.spec.ts:340` | 「应用配置并返回写作」不可见 + 「总览」strict violation | 能力配置流现行按钮文案需现场核对 |
| `mobile-layout.spec.ts:36` | 「系统护栏 N」tab 正则无命中（SettingsModal 能力 tab 改名/改构） | SettingsModal 现行 tab 结构 |
| `mobile-layout.spec.ts:85,119` | 写法确认弹窗 / 能力 studio 移动端可操作性断言超时 | 弹窗现行结构 + plan158 组件测试语义 |

共享基建：`tests/e2e/helpers/onboarding.ts`（runOnboardingToEditor/workspaceSwitcherTab）、E2E 环境旋钮（`INKFLOW_RATE_LIMIT_SCALE`/`INKFLOW_ONBOARDING_GRANT_SCALE` 已在 playwright.config.ts:50-60）。已知基线：21 passed / 8 failed。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 单 spec | `npx playwright test tests/e2e/<spec>.spec.ts` | 全绿 |
| 全量基线 | `npm run build && npx playwright test` | 29 全绿（本计划完成后） |
| 契约核对 | `grep -n "<按钮文案>" src/components/<组件>` | 现行文案锚点 |

## Scope

**In scope**：

- 上表 6 个 spec 文件、8 个失败用例的断言更新（保留原覆盖意图：导入旅程、统一创建、写法确认 409 恢复、移动端可用性）
- 必要时复用/扩展 `tests/e2e/helpers/onboarding.ts`

**Out of scope**：

- 新增覆盖面（新旅程已有 Round 30 journey specs）
- 业务代码改动（除非断言核对发现真 bug——那要单独报告，不得顺手改产品行为）

## Steps

每步 = 一个 spec：先跑失败拿到现行快照（error-context.md 的 Page snapshot 是现行 UI 事实源），对照组件源码核对现行契约，更新断言（优先锚 data-testid/aria-label 而非可见文案），跑绿后提交一次。

### Step 1: core-flow happy path —— 按现行生产链路重写生成段（参考 agent-workspace-journey），保留其设置弹窗/焦点陷阱等独有断言
### Step 2: unified-creation-new-project:123（创建→确认→完成本章→下一章）
### Step 3: unified-creation-new-project:185（provider unknown 手动写作 + 风险接受 + 下一章）
### Step 4: unified-creation-imported-project（导入 Canon 不变；「世界设定」→ switcher「设定」；世界书文本框断言按现行落地页重锚）
### Step 5: plan150-writing-style-confirmation（desktop 409 恢复流；对照现行弹窗链重写点击序列）
### Step 6: full-browser-click-journey（能力卡到正文全点击流；「应用配置并返回写作」现行文案核对）
### Step 7: mobile-layout:36（「系统护栏」tab 现行名/结构）
### Step 8: mobile-layout:85 + :119（弹窗与能力 studio 移动端断言重锚）

**Verify（每步）**: 单 spec 全绿
**Verify（最终）**: `npm run build && npx playwright test` → 29/29 全绿

## Test plan

本计划全部产出即测试。

## Done criteria

- [ ] 8 个失败用例全部转绿且覆盖意图保留
- [ ] 全套件 29/29 绿（CI E2E 门自本计划起恢复信号价值）
- [ ] `plans/README.md` 状态行已更新；187/190 行的「8 个预存陈旧 spec」备注改为已清偿

## STOP conditions

- 任一 spec 的现行契约核对发现**产品行为疑似 bug**（而非测试过时）→ 单独报告，不在本计划内改产品代码。
- 某用例旧覆盖意图已被 Round 30 journey specs 完全覆盖 → 报告后可改为归档删除（需在台账记录覆盖映射）。
- mobile 端因 viewport 断言与现行布局系统性冲突（>50% 断言需重写）→ 报告，评估降级为桌面断言 + 移动冒烟。

## Maintenance notes

重写后把各 spec 顶部注释补一行「契约基线：2026-09-12 UI」；后续 UI 改名类计划应在 Done criteria 里加入受影响 E2E 的更新项（此教训来自 8eaf51b 改名无 spec 跟进）。
