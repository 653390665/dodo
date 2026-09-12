# Plan 203: 195 切片 A——SkillsStudioView 配置会话簇下沉 store

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat f39b597..HEAD -- src/components/SkillsStudioView.tsx src/tests/skills-studio-plan158.test.tsx`
> 若有变更，先对照「Current state」摘录核对（行号漂移 ≤ 50 行可接受，语义不一致视为 STOP condition）。

## Status

- **Priority**: P3（架构债，行为安全网已备）
- **Effort**: M
- **Risk**: MED（三段同步 effect 是行为敏感区）
- **Depends on**: none（与 204 可并行；205 依赖本计划）
- **Category**: refactor
- **Planned at**: commit `f39b597`, 2026-09-12

## Why this matters

Plan 195 收尾评估（plans/notes-195-phase3-assessment.md）把 SkillsStudioView.tsx（现 4321 行、30 useState）的剩余分解切成 A/B/C 三片，用户拍板入本批实施。切片 A 抽出**配置会话簇**——与外部数据库代际、工作切换、会话恢复耦合最深、行为最敏感的一簇，先拆它为 B/C 铺路。

## Current state（2026-09-12 勘察，行号为当前实测）

- 三个核心 state：`SkillsStudioView.tsx:1426-1428`（configurationDraft / configurationDirty / staleConfigurationSession）。
- 三段同步 effect：
  - 工作切换重置：1530-1558（1534 行注释 "A work switch invalidates every session-bound configuration control."；1535 有 `set-state-in-effect` 抑制）
  - 代际快照清空/读取：1560-1590
  - 会话恢复水合：1592-1692；**自应用豁免窗口** 1597-1607（`selfAppliedContextRef`（1019 行定义）+ `flagAge < 5000`；1600 有 `react-hooks/purity` 抑制）；1651/1682 各有 `set-state-in-effect`/`exhaustive-deps` 抑制
- 伴随 effect：session 持久化 1694-1735；draft 与 server profile 同步 1737-1745。
- 消费点：1402-1528（派生标志）、1933-2427（apply/preview 动作）、2847-2911 与 3733-3836（JSX 门控）。
- 行为安全网：`src/tests/skills-studio-plan158.test.tsx` 38 用例（含持久化失败/代际过期/脏配置失败路径）。
- store 先例：`src/stores/skills-candidate-store.ts`（Plan 195 Phase 2 产物，23 行）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| plan158 安全网 | `node node_modules/vitest/vitest.mjs -c vitest.config.frontend.ts run src/tests/skills-studio-plan158.test.tsx` | 38 用例全绿 |
| 前端全量 | `npm run test:frontend` | 全绿 |
| lint | `node node_modules/eslint/bin/eslint.js src/components/SkillsStudioView.tsx src/stores/skills-configuration-store.ts --max-warnings=0` | 0 警告 |

## Scope

**In scope**：

- 新建 `src/stores/skills-configuration-store.ts`（zustand，镜像 skills-candidate-store 先例；含 session 编排 action）
- `SkillsStudioView.tsx`：三 state + 三段 effect + 伴随 effect 迁移为 store 订阅/action
- 三条 lint 抑制随迁移消化（1535/1600/1651——迁移后语义由 store action 承载，不需要抑制）

**Out of scope**：

- 切片 B（204）/ 切片 C（205）的 state
- apply/preview 网络动作的语义变化（仅搬移编排）

## Steps

### Step 1: store 骨架 + 纯 state 迁移

三 state 迁入 store；组件改订阅；不改任何 effect 语义（effect 留在组件，读写走 store）。

**Verify**: plan158 38 用例 + 前端全量绿

### Step 2: 三段 effect 编排下沉

工作切换重置/代际快照/会话恢复水合改写为 store action（`onWorkSwitch`/`onGenerationSnapshot`/`hydrateSession`），组件 effect 只剩一行 action 调用；自应用豁免窗口语义（flagAge<5000）逐行等价搬移。逐条消化 1535/1600/1651 抑制。

**Verify**: plan158 全绿（特别是持久化失败/代际过期/脏配置三条失败路径用例）；豁免窗口行为补一条新单测（模拟 apply 后 5s 内外部漂移被豁免）

### Step 3: session 持久化 + draft 同步收口

1694-1735/1737-1745 两个伴随 effect 迁移；1682 的 exhaustive-deps 抑制消除。

**Verify**: 全量绿 + lint 0 警告；记录 props 数变化（口径 62→~50）

## Test plan

plan158 + 前端全量 + 新增豁免窗口单测；E2E 冒烟 `npx playwright test tests/e2e/agent-workspace-journey.spec.ts`（能力卡消费面）。

## Done criteria

- [ ] 三 state + 五 effect 不再存在于 SkillsStudioView
- [ ] 自应用豁免窗口语义有单测锁定
- [ ] lint 抑制净减 ≥3 条
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- 迁移中 plan158 任一用例需要**改断言语义**（非 selector 适配）→ 停止报告（说明行为已变，回退重估拆法）。
- store 订阅导致明显重渲染劣化（plan158 跑批时长翻倍）→ 报告 profiler 数据再议。

## Maintenance notes

205 依赖本计划的 store；落地后 notes-195-phase3-assessment.md 标记切片 A 完成。
