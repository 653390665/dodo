# PRD 草稿：生成链路遗留项与原生对话框清理

> 状态：草稿（待排期）
> 日期：2026-09-05
> 父文档：[2026-09-05 首章生成体验整合](./2026-09-05-generation-entry-consolidation.md) §12 实施记录
> 来源：父 PRD 实施后的完成度评审

## 1. 摘要

收尾父 PRD 的 3 条部分完成验收子项，并把组件中残留的 21 处原生 `alert()` 统一替换为应用内反馈，使"生成链路"的体验整合完整闭环。

## 2. 范围

### A. 三条遗留验收子项

| # | 事项 | 关键工作 | 前置依赖 |
|---|---|---|---|
| A1 | 统一状态条（分镜→正文→审稿→待写入） | 先做交互决策：快速模式（orchestrate-draft）与完整生产（chapter-production-runs）的状态如何合并呈现；再在生成正文面板顶部实现单一状态条 | 🔵 交互决策未定 |
| A2 | 生产历史条目降级标记 | 后端 run 记录携带降级元数据（beatsSource/draftSource 快照）；前端历史列表渲染 ⚠️ 标 | 无，纯增量 |
| A3 | 章节列表"有预览未接受"角标 | 打通章节列表与生产预览状态的数据通路（预览态 run 的 targetChapterId 已存在） | 无，纯增量 |

### B. 原生 `alert()` 清理（21 处）

- 涉及组件：`SettingsModal`（导入/导出/清除反馈）、`SkillsStudioView`（未选作品提示）、`Library`、`WorldBibleView`、`EditorStatusBar`；
- 替换原则：成功/失败反馈 → 轻量 toast（复用现有 toast 体系，`AppShell` 已有）；需要用户确认的 → `appConfirm`（已建成）；
- 验收：`grep -rn "alert(" src/components` 组件代码零命中（tests 除外）。

### C. 埋点方案补全（父 PRD §10 🔵，阻塞主指标）

- 决策：复用 `product-events` 表扩展事件（`generation_entry_used`、`generation_retry_self_served`、`first_chapter_accepted`），前端在三个动点位埋点；
- 产出主指标"无辅助首章激活率"的可计算口径。

## 3. 建议排期

1. **先行**：C（埋点口径）→ 否则 A/B 上线也无法度量；
2. **一批**：B（alert 清理，机械替换、低风险）+ A2 + A3（数据通路小改）；
3. **后行**：A1（等交互决策，可先出线框）。

## 4. 不做什么

- 不合并两套生成后端管线（沿用父 PRD 边界）；
- 不改质量门禁语义；
- 不新增全局状态管理库（A3 用现有轮询/事件通道）。

## 5. 待决问题

- 🔵 A1 状态条合并交互：快速模式是否也展示"待写入"卡片？（倾向：是，统一以"预览→接受"叙事收口）
- 🔵 toast 体系是否已有统一的错误样式可复用？（实现前确认 `AppShell` toast API）
