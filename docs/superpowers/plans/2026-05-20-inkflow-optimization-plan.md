# InkFlow Optimization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: route through `superpowers plan` before implementation, then execute one workstream at a time.

**Goal:** 以最小风险推进 InkFlow 的下一轮优化，优先解决架构收口、工作台复杂度、prompt/runtime 边界与质量反馈链路，让后续功能开发更稳。  
**Architecture:** 按 4 条主线推进：`AgentWorkspace` 拆分、旧 agent API 退役、prompt runtime 契约强化、评估与回归闭环。每条主线都要求先收边界，再加能力。  
**Tech Stack:** React 19, TypeScript, Vite, Express, SQLite, existing prompt contract tests, existing quality/audit modules.

## 1. Current Diagnosis

基于现有只读检查，InkFlow 当前最值得优先优化的不是“再加新功能”，而是把已经存在的多层 prompt / production / skill / copilot 能力收紧成更稳定的主线。

### 1.1 Confirmed strengths

- Prompt surface 到 template asset 的映射已抽离成独立运行时模块：`src/lib/prompt-runtime.ts`
- 已有 prompt/runtime contract tests：`tests/prompt-runtime.test.ts`
- 已有 quality gate / audit contract tests：`tests/audit-five-dimension-contract.test.ts`
- 工程脚本基本齐全：`lint`、`smoke:runtime`、`build:electron`、`package`

### 1.2 Main issues

1. `AgentWorkspace` 仍是高耦合大组件，承担过多 feature orchestration
2. `src/lib/agents.ts` 仍保留迁移残留接口和局部 `any`
3. Prompt/runtime 目前有测试，但“统一编排入口”还没完全收口
4. 质量评估存在，但还没形成稳定的优化闭环

## 2. Optimization Principles

### 2.1 What to optimize first

优先顺序固定为：

1. **减少耦合**
2. **收紧接口**
3. **固化契约**
4. **再提高生成质量**

### 2.2 What not to do first

- 不先做 UI 大改版
- 不先接更多模型供应商差异化逻辑
- 不先扩充更多“管家 tab”
- 不先把实验能力塞进主工作台

## 3. Workstream Overview

| Workstream | Goal | Priority | Outcome |
|---|---|---:|---|
| A | 拆分 `AgentWorkspace` | P0 | 收窄 UI orchestration 面 |
| B | 退役旧 `agents.ts` 残留接口 | P0 | 统一编排入口 |
| C | 强化 prompt/runtime 契约与 fallback 观测 | P1 | 降低 prompt 漂移风险 |
| D | 建立优化评估闭环 | P1 | 每轮 prompt / UX 优化可量化 |

## 4. Workstream A: AgentWorkspace Decomposition

## Task 1: 先做组件边界切图

**Files:**
- Inspect: `src/components/AgentWorkspace.tsx`
- Inspect: `src/components/copilot/CopilotHomePanel.tsx`
- Inspect: `src/components/ProductionRunReview.tsx`
- Inspect: `src/components/skills/ProjectPreferencePanel.tsx`

**Steps:**

- [ ] 1. 把现有 tab 按职责分成 4 组：copilot、production、knowledge、diagnostics。
- [ ] 2. 标记哪些 props 只属于单一分组。
- [ ] 3. 输出目标拆分图：容器 + 子面板 + shared hooks。

**Acceptance:**

- 形成一张明确的 props ownership 表
- 可以指出第一批可拆出的 2-3 个子容器

## Task 2: 设计目标结构

**Target structure:**

- `AgentWorkspaceShell`
- `AgentWorkspaceTabBar`
- `AgentWorkspaceProductionPanel`
- `AgentWorkspaceKnowledgePanel`
- `AgentWorkspaceDiagnosticsPanel`
- `AgentWorkspaceState` hooks

**Rules:**

- 先移动 UI 编排，不改业务语义
- 不同时重做样式和状态
- 共享状态只保留在 shell 或 dedicated hooks

## 5. Workstream B: Retire Legacy Agent API Surface

## Task 1: 盘点旧入口

**Files:**
- Inspect: `src/lib/agents.ts`
- Inspect: `src/lib/api.ts`
- Inspect: `server.ts`
- Search callers in `src/`

**Steps:**

- [ ] 1. 列出仍然暴露但已迁移的接口。
- [ ] 2. 标记真实主入口：`/api/orchestrate`、`/api/audit`、其他 service endpoints。
- [ ] 3. 标记哪些旧函数仅作为 compatibility shell 存在。

**Acceptance:**

- 有一份 “active API surface vs legacy shell surface” 清单

## Task 2: 收口策略

**Decision:**

- 若旧接口无调用方：删除
- 若旧接口有调用方但语义已迁移：改成 adapter，并在注释和测试中显式声明
- 若旧接口仍是迁移过渡桥：补 deprecation test，避免长期漂移

## 6. Workstream C: Prompt Runtime Hardening

## Task 1: 固化 surface -> stage -> template 契约

**Files:**
- `src/lib/prompt-runtime.ts`
- `src/lib/prompt-stage-routing.ts`
- `src/lib/prompt-assets.ts`
- `tests/prompt-runtime.test.ts`

**Steps:**

- [ ] 1. 枚举所有用户可见 surface。
- [ ] 2. 确认每个 surface 只有一个默认主模板和明确 override 规则。
- [ ] 3. 补测试覆盖“缺模板时报错”和“override 只允许同 stage”。

**Acceptance:**

- 新增任何 surface 都必须改 runtime test
- 不允许静默回落到不相干模板

## Task 2: 建立 fallback 可观测性

**Files:**
- `src/lib/prompt-quality.ts`
- `src/lib/audit-structured.ts`
- `src/lib/chapter-production.ts`
- related tests

**Steps:**

- [ ] 1. 统一记录 `source: model | fallback`。
- [ ] 2. 区分解析失败、超时、内容不合格三类 fallback 原因。
- [ ] 3. 在 UI 可见层保留最小状态透出，不把失败都揉成“生成较慢”。

**Acceptance:**

- 同一次生产 run 可追踪 beats / draft / audit 各自来源
- 后续优化能知道是在 prompt 问题、解析问题还是超时问题

## 7. Workstream D: Optimization Feedback Loop

## Task 1: 建立固定评测集

**Files:**
- Create: `docs/prompt-research/inkflow-eval-cases.md`
- Update or create benchmark script references under `scripts/`

**Steps:**

- [ ] 1. 固定 8-12 个代表性输入场景。
- [ ] 2. 覆盖 welcome、world onboarding、workspace beats、workspace draft、chapter review。
- [ ] 3. 每个场景定义成功信号和失败信号。

**Acceptance:**

- 每次 prompt 迭代都能复跑同一批输入

## Task 2: 固定优化闭环

每次 prompt / runtime 优化按这个顺序：

1. 先跑 contract tests
2. 再跑 eval cases
3. 再看 fallback 来源分布
4. 最后才决定是否改 prompt

不允许：

- 没有对照组就改 prompt
- 多处 prompt 同时大改后再猜是哪一处生效

## 8. Execution Order

## Phase 1: 架构收口

- [ ] A1 `AgentWorkspace` 边界图
- [ ] B1 旧入口盘点
- [ ] B2 API 收口决策

## Phase 2: 契约强化

- [ ] C1 runtime contract 补测
- [ ] C2 fallback reason 统一

## Phase 3: 优化闭环

- [ ] D1 固定评测集
- [ ] D2 形成 prompt 优化 SOP

## 9. Commands

在实现阶段，每个 workstream 至少要跑这些最小验证：

```bash
npm run lint
node --import tsx --test tests/prompt-runtime.test.ts
node --import tsx --test tests/audit-five-dimension-contract.test.ts
node scripts/runtime-smoke.mjs
```

如果只改前端工作台拆分，最小验证至少包括：

```bash
npm run lint
```

## 10. Success Signals

完成这一轮优化后，应该能看到：

1. `AgentWorkspace` 明显瘦身，职责更清楚
2. 旧 `agents.ts` 壳接口不再长期挂着
3. prompt runtime 出错时能定位是哪一层坏掉
4. prompt 优化不再凭感觉，而是有固定评测样本和回归方式

## 11. Risks

- **拆组件时顺手改语义**：会把纯结构优化变成功能回归风险
- **迁移旧入口时漏掉调用方**：会造成运行期断路
- **fallback 观测做太重**：会把产品 UI 变成调试台
- **评测集设计太窄**：会让 prompt 只对样题优化

## 12. Recommendation

最推荐的起步点不是 prompt 本身，而是：

1. 先拆 `AgentWorkspace` 边界
2. 再收口旧 agent API surface
3. 然后补 runtime / fallback 观测
4. 最后才做 prompt 质量强化

这样做的原因是：先把系统边界收紧，后续任何 prompt 或模型优化才不会继续叠在模糊结构之上。
