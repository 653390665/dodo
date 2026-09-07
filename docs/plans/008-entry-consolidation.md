# 008 — 接受断点引导 + 生成呈现收拢（PM 审查落地批）

> 生成：2026-09-07。来源：产品经理视角 UI 审查（customer-journey-map 框架）。
> 审查结论修正：工作台页签实为"6 常驻 + 更多"，非 13 个常驻——原"13→4+1"建议**取消**，无页签收敛需求。

## 背景（为什么）

激活漏斗 `editor_enter 152 → first_content_input 0 → draft_accept 1` 断在接受：快速模式产出走编辑器横幅、完整生产走生产报告，两套呈现不讲同一个故事；用户看不到"现在轮到你接受/写入了"。006 已交付 `GenerationStatusBar`（订阅 production-store），缺的是 quick 接线与"④ 待写入 → 接受区"的引导跳。

## 目标

1. **quick 状态条接线**：编辑器 AI 候选横幅位上方渲染 `GenerationStatusBar mode="quick"`，`quickDraftReady` = 当前章存在 AI 正文候选；快速模式的四段（分镜→正文→审稿已跳过→写入）与完整生产共用同一组件。
2. **④ 待写入可点击**：ProductionTab 的状态条"④ 写入"段在存在待接受 run 时可点击，平滑滚动到 `ProductionRunReview` 接受区。
3. **审稿处理一跳直达**：编辑器完成审查/候选横幅提供"到工作台处理"，点击 `setAgentTab('quality')` + 展开侧栏（复用 copilot action 既有模式）。
4. **007 T4 补完**：`src/lib/workflow-copy.ts` 动作词表常量化。

## 涉及文件

- `src/components/EditorView.tsx`（quick 状态条 + 处理跳转按钮）
- `src/components/book-factory/ProductionTab.tsx`（④锚点与滚动）
- `src/components/GenerationStatusBar.tsx`（④可点击回调）
- `src/lib/workflow-copy.ts`（新增）
- `src/stores/app-store.ts`（如需 quickWritten 瞬态标记）

## 实施步骤

1. GenerationStatusBar 增加可选 `onWriteClick`；"④ 写入"段 tone 为 active（待写入/写入中）时渲染为 button。
2. ProductionTab：ProductionRunReview 包裹锚点 div + ref，`onWriteClick` = scrollIntoView({block:'center'})。
3. EditorView：候选横幅上方挂 quick 状态条；横幅内追加"到工作台处理"按钮（条件：qualityState 非直通时）。
4. workflow-copy.ts：drafting/audit/plan 动作词常量，替换 5 处散落文案（渐进，本批先建表 + 替换 ProductionTab 两处）。

## 验证

- `npx tsc --noEmit` 0；eslint 改动文件 0；前端 vitest 全绿
- 新增：GenerationStatusBar ④可点击测试；既有 quick/full 断言保持

## 边界

- 不改任何生成/写入逻辑；仅呈现与引导
- 页签不做收敛（审查修正）；术语全局替换仍渐进

## 执行状态（2026-09-07）

| 项 | 状态 |
|---|---|
| quick 状态条接线 | ✅ commit 9a4af0d |
| ④ 待写入可点击滚动接受区 | ✅ commit 9a4af0d |
| 横幅一跳到工作台质量页签 | ✅ commit 9a4af0d（"到工作台处理"，文案入 workflow-copy 动作词表） |
| 007 T4 动作词表 | ◐ `src/lib/workflow-copy.ts` 已建并首个接入；5 处表面全量替换仍渐进 |
| 页签收敛 | ❌ 取消（审查修正：工作台已是"6 常驻 + 更多"，无收敛需求） |

## 完成标准

- [x] 快速与完整两种模式呈现同一状态条
- [x] 待写入段可点击滚动到接受区
- [x] 横幅问题可一跳到工作台质量页签
