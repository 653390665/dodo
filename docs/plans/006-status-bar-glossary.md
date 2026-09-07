# 006 — 统一状态条 + 术语收敛

## 背景（为什么）

**状态条（父 PRD 001 Story 1 遗留）**：生成入口归一后仍缺"分镜 → 正文 → 审稿 → 待写入"的统一状态条——快速模式产出走编辑器横幅，完整生产走生产报告，两套呈现未合并。依赖 005 的 store 才能干净读取两域状态。

**术语收敛（审计 F7）**：同一概念多种叫法——能力 179 处 / 能力卡 64 处 / 写法 32 处；另有拆书卡/技法/流程卡/护栏/配置候选等 9 个名词同屏。用户词汇表过载。

## 目标

### A. 统一状态条（生成正文面板顶部）
单一组件 `GenerationStatusBar`，从 production-store 读状态，无论哪种模式都讲同一个故事：

```
[① 分镜 ✓/⚠️降级/进行中] → [② 正文 ✓/进行中/未通过] → [③ 审稿 ✓/未运行] → [④ 待写入/已写入]
```

- 快速模式：①显示来源（分镜状态），②草稿就绪后直接到 ④（③标记"已跳过"）；
- 完整生产：四段全显；
- ④可点击 → 滚动到接受区/或触发接受确认。
快速模式（orchestrate-draft）不产生 run 记录，状态从 `aiActionState` + 候选存在性推导。

### B. 术语收敛（建立词汇表）
对外统一决策：

| 对外唯一名词 | 收编的旧词 |
|---|---|
| **能力卡** | 技能、拆书卡、结构卡、职责卡 |
| **常用技法** | 技法、偏好技法 |
| **写法确认** | 写法确认（专有流程名，保留） |
| **质量标准** | 系统护栏、护栏增强 |
| **创作流程** | 流程、技能系列 |

实施：新增 `src/lib/glossary.ts`（映射表）+ 全局替换高频 UI 文案（`SkillsStudioView`、`AgentWorkspace`、`EditorView`、`WritingSurface`）；CONTEXT.md 风格词汇表写入 `docs/research/2026-09-06-capability-system-essence.md` 附录。

### C. 微调
- 空状态 CTR 补齐（"暂无智能建议"→ 可点击）；生产历史/章节导航虚拟化**不在本计划**（依赖批准）。

## 涉及文件

- 新增 `src/components/GenerationStatusBar.tsx` + `src/stores/production-store.ts`（005 产物）
- `src/components/book-factory/ProductionTab.tsx`、`AgentWorkspace.tsx`、`EditorView.tsx`
- 术语替换：全 components 高频文案（grep 驱动）
- `src/tests/editor-guidance-layout.test.tsx`、`src/tests/production-run-review.test.tsx` 同步

## 实施步骤

1. `GenerationStatusBar`：props 仅 `{ mode: 'full' | 'quick' }`，内部订阅两 store/hook 状态；四段式渲染，点击段落跳转对应面板。
2. ProductionTab 顶部挂载（full 模式）；快速模式在编辑器横幅位置渲染同组件（quick 模式）。
3. 术语表落地：先改六处高频面（工作台标签、能力中心头卡、商店分类名、编辑器横幅、弹窗标题、toast），再 grep 收敛剩余。
4. 测试同步（文案断言全量 grep 更新）。

## 验证

- `npx tsc --noEmit` → 0；`npx eslint` 改动文件 → 0
- `npx vitest -c vitest.config.frontend.ts run` → 全过
- 手动：两种模式各生成一次，状态条四段流转正确；全局 grep `拆书卡` 在用户可见文案中 = 0（详情抽屉内类型标签除外）

## 边界

- 不改任何后端与数据字段
- 不动"写法确认"流程名（刚落地的留存化机制依赖其语义）
- 虚拟化、375px 以下进一步优化不在本计划

## 完成标准

- [ ] 两种生成模式共用同一状态条组件
- [ ] 状态条四段流转正确且有测试
- [ ] 词汇表文档存在且高频 UI 已收敛
