# Plan 163: 收口正文质量门禁的 Lint 回归

> **Executor instructions**: 这是一个小范围质量收口任务。只修复下述 lint 违规，保持候选生命周期和语义审阅行为不变。每一步先验证；若需要修改不在 Scope 内的生产文件，停止并报告。
>
> **Drift check（先运行）**: `git diff --stat f4eac24..HEAD -- shared/lib/draft-quality.ts src/lib/hooks/useEditorGenerationFlow.ts tests`。若代码与摘录不符，先停止，不要用禁用规则或大范围重构绕过问题。

## Status

- **State**: DONE
- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/161-literary-quality-contract.md`
- **Category**: tech-debt
- **Planned at**: commit `f4eac24`, 2026-08-19

## Why this matters

当前质量合同、候选接受和复审定向测试能够通过，但 `npm run lint` 仍失败，导致 CI/发布门禁不能证明本轮改动可交付。错误集中在正文语义审阅计算和编辑器复审回调引用：如果直接关闭规则，可能掩盖 React 生命周期或状态竞态问题。最小修复应保留现有行为，并让静态规则帮助发现旧候选覆盖风险。

## Current state

- `shared/lib/draft-quality.ts:36-45` 用 `let needsAction = false` 再在互斥分支中赋值；当前 ESLint 报 `no-useless-assignment`。目标是保留四类检查的完全相同判定逻辑，同时改成静态规则可证明的表达式（例如分支返回值或单一表达式），不得放宽规则。
- `src/lib/hooks/useEditorGenerationFlow.ts:327` 在 React hook render 阶段执行 `auditHandlerRef.current = handleRunAudit`，触发 `react-hooks/refs`。需要将引用同步移到合适的 effect，或使用稳定 callback/ref 模式，确保复审 effect 使用最新 handler 且不在 render 写 ref。
- `src/lib/hooks/useEditorGenerationFlow.ts:329-340` 的 effect 在同一 effect 中同步调用 `setPendingAuditRecheck(null)`，触发 `react-hooks/set-state-in-effect` 警告。修复不能导致重复复审；必须保留“接受精修后仅对受影响问题复审一次”的语义。
- 现有生命周期测试：`src/tests/editor-generation-flow-lifecycle.test.ts`、`src/tests/editor-candidate-acceptance.test.ts`、`src/tests/quality-review-journey.test.tsx`。遵循它们的 Vitest 模式，不新加依赖。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Lint | `npm run lint` | exit 0, no errors or warnings |
| Typecheck | `npm run typecheck` | exit 0 |
| Lifecycle tests | `npx vitest -c vitest.config.frontend.ts run src/tests/editor-generation-flow-lifecycle.test.ts src/tests/editor-candidate-acceptance.test.ts src/tests/quality-review-journey.test.tsx` | all pass |
| Diff hygiene | `git diff --check` | no output, exit 0 |

## Scope

**In scope（仅允许修改）**

- `shared/lib/draft-quality.ts`
- `src/lib/hooks/useEditorGenerationFlow.ts`
- 上述三个现有前端测试文件，仅在补充回归断言确有必要时修改

**Out of scope（禁止修改）**

- ESLint 配置、规则禁用、`server/` 生产逻辑、数据库、Provider 脚本和计划 162 的评测集。
- 任何重写候选接受协议、改变复审范围或改变语义审阅状态的产品行为。

## Steps

### Step 1: 消除语义审阅计算的无效赋值

在 `semanticStatusForAudit()` 中保持四个 `id` 分支的判定条件、返回状态和证据映射完全一致，仅重写局部控制流使 `no-useless-assignment` 通过。添加或更新一个测试，分别覆盖章节目标、人物、世界规则和伏笔四类命中与未命中。

**Verify**: `npx vitest -c vitest.config.frontend.ts run src/tests/quality-review-journey.test.tsx` → 全部通过；`npm run lint -- --quiet` 不再报告 `shared/lib/draft-quality.ts`。

### Step 2: 修复审阅 handler 的 ref 生命周期

将 `auditHandlerRef` 的同步移出 render 阶段，确保接受精修后的复审 effect 读取最新 `handleRunAudit`。必须保留 Abort、章节切换、数据库代次变化和组件卸载的清理逻辑；不得通过 `eslint-disable` 绕过规则。补一个生命周期测试：候选接受后只发起一次 affected review，切章/卸载后不发起旧章节复审。

**Verify**: `npx vitest -c vitest.config.frontend.ts run src/tests/editor-generation-flow-lifecycle.test.ts src/tests/editor-candidate-acceptance.test.ts` → 全部通过；`npm run lint -- --quiet` 不再报告 `react-hooks/refs`。

### Step 3: 消除复审 effect 的同步 setState 警告

调整 `pendingAuditRecheck` 的消费方式，使同一候选不会重复消费，同时不在 effect 初始执行体中同步清空状态。可以采用事件/回调内消费、请求序号或等价的幂等 guard，但不得改变接受前不复审、接受后只复审受影响问题的产品契约。

**Verify**: `npx vitest -c vitest.config.frontend.ts run src/tests/editor-generation-flow-lifecycle.test.ts src/tests/quality-review-journey.test.tsx` → 全部通过；`npm run lint` 无 `react-hooks/set-state-in-effect` 警告。

### Step 4: 总体验收

运行全部小范围门禁，确认没有借助 lint 配置修改掩盖问题。

```bash
npm run typecheck
npm run lint
npx vitest -c vitest.config.frontend.ts run src/tests/editor-generation-flow-lifecycle.test.ts src/tests/editor-candidate-acceptance.test.ts src/tests/quality-review-journey.test.tsx
git diff --check
```

## Done criteria

- [ ] `npm run lint` exit 0 且无 warning。
- [ ] `npm run typecheck` exit 0。
- [ ] 候选接受后的 affected review 仍只执行一次，切章/卸载不会旧请求回写。
- [ ] 未修改 ESLint 配置，未添加 `eslint-disable`，未改变质量合同语义。
- [ ] 仅 Scope 内文件发生修改。

## STOP conditions

- 需要修改 ESLint 配置、关闭 React hook 规则或改变生产接口才能通过。
- 修复后出现重复复审、旧章节回写、接受前正文变化或测试需要访问生产数据库。
- 当前代码与摘录发生漂移，无法在不扩大范围的情况下安全判断。

## Maintenance notes

- 以后新增 hook 状态机时，ref 同步必须放在 effect 或稳定回调边界，不能在 render 中写入。
- 质量合同的四类语义映射应继续保持纯函数，便于静态检查和单元测试；不要把 UI 状态副作用放进共享质量模块。

## Completion evidence

- `npm run typecheck`: exit 0。
- `npm run lint`: exit 0，0 warning。
- 编辑器候选/生命周期/质量旅程：3 files，9 tests passed。
- 质量、审稿、Embedding 定向 Node 测试：16/16 passed。
- 新增竞态断言：affected review 仅一次；切章或在接受请求完成前卸载时，旧章节复审为 0。
- `git diff --check`: exit 0。
