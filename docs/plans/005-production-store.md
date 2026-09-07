# 005 — EditorView 领域状态入 store

## 背景（为什么）

前端审计 Top 2 结构性债务：`EditorView.tsx`（2169 行）本地持有 25 个领域 useState（chapters、production 流程、completion、capabilityUtility 等，112-190 行），导致三层 props 钻孔 `EditorView(109 props) → AgentWorkspace(85) → ProductionPanel → ProductionTab(34)`（`AgentWorkspace.tsx:238-330`），且 `AgentWorkspace` 的 React.memo 被 7 处内联 props 击穿（已有 6 处在 2026-09-05 稳定化为 useCallback/useMemo，但状态下沉才是根治）。同时存在双写防重入模式（`isGeneratingContent` state 与 `isGeneratingContentRef`；`isCompletingChapter` 与 `completionRequestInFlightRef`）。

本计划是 006（统一状态条）的前置：状态条需要跨组件读取生产流程状态，props 钻孔下无法干净实现。

## 现状摘录

```
EditorView.tsx:2045  <AgentWorkspace …109 个 props…>
AgentWorkspace.tsx:1087  <AgentWorkspaceProductionPanel …85 个 props…>
AgentWorkspaceProductionPanel.tsx:272  <ProductionTab …34 个 props…>
useAuditPolishActions.ts:29-60  以 30+ 参数接收 15 个 setter/ref/callback
```

既有正确范例：`book-factory/` 目录按 Tab 拆分 12 个文件；zustand store 现有 3 个（app/novel/assistant-session），小而干净。

## 目标

1. 新建 zustand store：`src/stores/production-store.ts`——承载生产流程域状态（activeProductionRun、productionIntent、isProductionRunning、isApplyingProductionRun、productionError、beats/draft/auditSource、statusMessage、previewRunChapterIds），以及动作（start/stop/apply 的状态部分；LLM 调用仍留在 hooks，store 只存状态与 setter）。
2. `useChapterProductionFlow` 重构：内部改用 production-store 读写，对外签名尽量不变（减少调用方改动）；EditorView/AgentWorkspace/ProductionPanel/ProductionTab 直接 `useProductionStore` 选择性订阅，删除对应透传 props（预计砍 85→约 30）。
3. 同法处理 `writingStyle*` 域（resolution/candidates/confirmed）→ `writing-style-store.ts`（或并入 production-store，建议独立）。
4. 双写收敛：`isCompletingChapter`/`isGeneratingContent` 保留 state 驱动 UI，ref 仅作守卫且**同步点唯一**（审查现有两处赋值路径，收敛为一处，并加注释声明"ref=守卫、state=UI 投影"）。
5. 完成后 AgentWorkspace 的 memo 真正生效：剩余 props 全部为稳定引用（2026-09-05 已修 7 处，本计划消除其余内联）。

## 实施步骤（建议顺序）

1. 建 `production-store.ts`（状态 + setter，无副作用）。
2. `useChapterProductionFlow` 内部 setState 全部改走 store（hooks 签名不变，先做纯替换）。
3. 删 EditorView→AgentWorkspace 的 production 相关 props；AgentWorkspace/ProductionPanel/ProductionTab 改订阅 store。
4. 同法迁移 writingStyle 域。
5. 双写收敛 + 注释。
6. 每步跑全量前端测试（既有 830 个用例是安全网），最后跑 `src/tests/editor-*` 与 `src/tests/components.test.tsx` 重点回归。

## 验证

- `npx tsc --noEmit` → 0
- `npx eslint src/components/EditorView.tsx src/components/AgentWorkspace.tsx src/components/AgentWorkspaceProductionPanel.tsx src/components/book-factory/ProductionTab.tsx src/stores/production-store.ts` → 0
- `npx vitest -c vitest.config.frontend.ts run` → 830/830
- React DevTools profiler：编辑器击键时 AgentWorkspace 不再重渲染（对比改造前）
- grep `productionError|activeProductionRun` 在 EditorView 与 AgentWorkspace 间的 props 传递 = 0

## 边界

- 不重写 LLM 调用逻辑（hooks 保留），只迁移状态归属
- 不动 `assistant-session-store` 与 `novel-store`
- `useAuditPolishActions` 的 30+ 参数收窄列入本计划但可后置（先生产/writingStyle 两域）

## 完成标准

- [ ] EditorView props 总数 ≤ 60（现 109）
- [ ] production 域 props 跨层透传 = 0
- [ ] 击键不触发 AgentWorkspace 重渲染（profiler 证据）
- [ ] 全量测试绿

## 执行状态（2026-09-07 第二轮更新）

| 步骤 | 状态 |
|---|---|
| 1-2 store + hook 迁移 | ✅（b508b22：签名不变 + 冷挂载守卫 + 卸载中止） |
| 3 production props 链拆除 | ✅（9a4af0d 后续批）：ProductionTab/Panel/AgentWorkspace 改订阅 store，EditorView 删 10+1 透传；AgentWorkspace props 109→87；验收门 grep `productionError\|activeProductionRun` 透传 = 0 |
| 5 双写收敛 | ✅：completionRequestInFlightRef 三组散写收敛为 `setCompletionInFlight` 唯一同步点（ref=守卫、state=UI 投影，注释已声明）；isGeneratingContent 已是渲染投影唯一同步点（注释已声明） |
| 4 writingStyle 域入 store | ⏸ 侦察后缓行：EditorView 持 3 state + 派生 fingerprint 参与生产流参数；三层 12-15 处引用、紧邻写法确认留存化敏感面，需独立一批 |
| 6 profiler 验证 | ⏸ 待手工（React DevTools，无法在自动化环境取证）；839/839 全绿作为回归安全网 |

## 维护提示

006 的状态条直接订阅 production-store。新域加入时遵循"hooks 管副作用、store 管状态"的分工。
