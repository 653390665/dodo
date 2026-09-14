# Plan 211: act() 警告彻底归零专项（209 遗留收口）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat ef1335e..HEAD -- src/tests/setup.ts src/tests/plan158-skills-studio-candidates.test.tsx src/tests/skills-configuration-session.test.tsx src/tests/skills-studio-plan158.test.tsx package.json`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P3（测试卫生，不阻塞功能）
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 209（已落地 93% 清理；本计划收尾剩余 5 块）
- **Category**: tech-debt（测试卫生/依赖治理）
- **Planned at**: commit `ef1335e`, 2026-09-14

## Why this matters

Plan 209 把受影响四套件的 act 噪音从 268 行降到约 20 行（-93%），scoped 项（异步 onClick 后续更新落 act 外、toast 定时器假警告）已修复。剩余 5 块「The current testing environment is not configured to support act(...)」为 React 19 + RTL `asyncWrapper`（waitFor/findBy 窗口内故意置 `IS_REACT_ACT_ENVIRONMENT=false`）与 zustand 外部 store 通知交错的库间噪音——更新恰好落在环境窗内时 React 以「not configured」口径告警。彻底归零能恢复「警告即真信号」的测试卫生基线。

## Current state（2026-09-14 勘察核实，锚点基于 `ef1335e`）

- 噪音源：`act-compat.js` `withGlobalActEnvironment` + `pure.js` `asyncWrapper`（`setReactActEnvironment(false)` 窗口）；更新来源为 zustand `useSyncExternalStore` 的 `forceStoreRerender`（apply 链尾部 store 写入）。
- 受影响：`plan158-skills-studio-candidates.test.tsx`（3 块）、`skills-configuration-session.test.tsx`（1）、`skills-studio-plan158.test.tsx` flow-directory（1）。
- RTL 版本：`@testing-library/react ^16.3.2`；React 19。仓库无 `jest-dom`（断言用 `toBeDefined()/getAttribute` 口径）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 受影响四套件 | `npx vitest run --config vitest.config.frontend.ts src/tests/plan158-skills-studio-candidates.test.tsx src/tests/skills-studio-plan158.test.tsx src/tests/skills-configuration-session.test.tsx src/tests/skills-package-store.test.tsx` | 全绿且 act 相关 stderr 0 行 |
| 前端全量 | `npm run test:frontend` | 全绿 |

## Scope

**In scope**：受影响四套件的 act 环境管理 / waitFor 收口改写；如走依赖路线则 `@testing-library/react` 升级（需审批）。

**Out of scope**：生产代码改动；其余套件的既有 act 处理模式。

## Steps

### Step 1: 出路选型（三选一，执行前定案）

- **a. RTL 升级**：查 16.3.2 之后的版本是否已改 asyncWrapper 环境窗行为（React 19 适配线）。升级属依赖变更——**先获用户审批再动**。
- **b. fake-timers 专项**：受影响用例 `vi.useFakeTimers()` 控制 store 通知时序，使更新全部落进显式 act 冲刷；风险是与 RTL findBy 的真实定时器轮询冲突，需逐用例验证。
- **c. 环境窗收口**：对 5 处噪音点，把「apply 后仍会落 store 通知」的用例尾部改为 `await waitFor(断言稳定态)` 收口（waitFor 退出前的 updates 被其自身 act 语义吸收），或显式 `IS_REACT_ACT_ENVIRONMENT` 管理——需验证不掩盖真警告（对照：人为注入一次未包 act 的更新应仍然报错）。

**Verify**: 选型理由落账本文件 Maintenance notes

### Step 2: 实施选型

按 Step 1 定案实施；逐用例改，保持断言语义不变。

**Verify**: 受影响四套件 act 相关 stderr 0 行；全量绿

### Step 3: 回归

前端全量 + 台账落账（209 行遗留备注更新为已核销）。

**Verify**: 全量绿；台账落账

## Test plan

受影响四套件 + 前端全量。无生产改动。

## Done criteria

- [ ] 受影响四套件 act 相关 stderr 0 行
- [ ] 真警告信号未被掩盖（Step 1 的对照验证通过）
- [ ] 前端全量绿；台账 211/209 行落账

## STOP conditions

- RTL 升级引入大范围 breaking（render API/act 语义变化）→ 停止报告升级评估。
- fake-timers 方案与既有 findBy/waitFor 模式系统性冲突 → 停止报告，回退改选。

## Maintenance notes

Step 1 选型记录：2026-09-14 立项时未定案；执行时先做 a 的版本调研（只读），a 不可行则 c（最小改动面），b 为最后手段。
