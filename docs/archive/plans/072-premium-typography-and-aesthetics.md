# 实施计划: 极致前端美学与排版节奏优化 (072)

本计划旨在根据“极简主义、极致色彩与排版节奏”的前端美学准则，对 InkFlow 的视觉系统进行全面升级，拒绝“AI 味”的单调设计。

## 升级目标
1. **极致色彩 (Color Mastery)**：废除纯黑 (#000)、纯白 (#fff) 及单调的 `#FAFAFA` 灰度调色盘。全面引入 **OKLCH 色彩空间**，为系统注入温暖的书卷气与奢华的编辑品质感。
2. **排版节奏 (Typography & Rhythm)**：将写作区正文行宽严格限制在最优阅读区间 **65-75ch**，并居中排版，防止大屏下因单行过长导致视觉疲劳。
3. **动效约束 (Motion Constraints)**：为所有交互元素引入符合物理学规律的指数级 Ease-out 动效，严禁多余的回弹。

## 变更内容

### [src/index.css](file:///Users/Zhuanz/Documents/dodo-inkflow/src/index.css)
- 重构 `@theme` 部分的变量定义，使用 OKLCH 替代 Hex 颜色：
  - **浅色模式**：
    - 背景 (`--color-theme-bg`)：`oklch(0.98 0.005 60)` (温暖的汉白玉/乳白)
    - 侧栏 (`--color-theme-sidebar`)：`oklch(0.99 0.003 60)` (极柔和的暖白)
    - 边框 (`--color-theme-border`)：`oklch(0.93 0.005 60)` (暖调极淡灰)
    - 文本 (`--color-theme-text`)：`oklch(0.20 0.010 60)` (深暖墨黑)
    - 辅助 (`--color-theme-muted`)：`oklch(0.55 0.010 60)` (中度暖灰)
    - 强调 (`--color-theme-accent`)：`oklch(0.40 0.12 35)` (典雅的古铜/红土赤褐)
  - **深色模式**：
    - 背景 (`--color-theme-bg`)：`oklch(0.14 0.008 60)` (深邃暖曜石)
    - 侧栏 (`--color-theme-sidebar`)：`oklch(0.17 0.008 60)` (深色墨炭)
    - 边框 (`--color-theme-border`)：`oklch(0.24 0.008 60)` (深灰暖调)
    - 文本 (`--color-theme-text`)：`oklch(0.88 0.005 60)` (温润银白)
    - 辅助 (`--color-theme-muted`)：`oklch(0.52 0.005 60)` (哑光中灰)
    - 强调 (`--color-theme-accent`)：`oklch(0.78 0.08 45)` (微光浅金/琥珀)
- 优化滚动条与 `.natural-btn-primary` 的微动效过渡。

### [src/components/WritingSurface.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/WritingSurface.tsx)
- 为主写作区的 `<textarea>` 添加 `max-w-[72ch] mx-auto` 宽度约束与居中，营造专注沉浸的“ distraction-free ”写作环境。

## 验证计划
- 运行 `npx tsc --noEmit` 确保无编译错误。
- 运行 `npm run test` 确保未破坏现有组件测试。
