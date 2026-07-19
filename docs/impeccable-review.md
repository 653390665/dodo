# InkFlow Impeccable 审查报告

**审查时间**: 2026-07-10
**审查范围**: WelcomeView, EditorView, WritingSurface, SettingsModal, AIAssistantDrawer, Sidebar, Library, ProjectCockpitView
**审查类型**: Critique (UX 设计评审) + Audit (技术质量检查)

---

## Part 1: Critique — UX 设计启发式评分

### 评分总览

| 维度 | 分数 (1-10) | 说明 |
|------|------------|------|
| **视觉层次** | 7 | 信息密度高但层次清晰，部分区域过度装饰 |
| **交互一致性** | 6 | 按钮样式、弹窗模式、反馈方式不统一 |
| **信息架构** | 7 | 视图导航合理，但 EditorView 职责过重 |
| **反馈与状态** | 5 | 大量 `alert()` 阻塞主线程，缺少 toast 统一反馈 |
| **可访问性** | 5 | Radix 提供基础 ARIA，但大量交互元素缺少 label |
| **情感化设计** | 8 | 终端风遥测面板、雷达图、阶段指示器有个性 |
| **防错与容错** | 6 | 有降级策略，但部分路径静默失败 |
| **响应式适配** | 7 | Sidebar 自适应折叠，编辑器三栏布局有 breakpoint |

**综合得分: 6.4 / 10**

---

### 问题清单

#### P0: 必须修复

| # | 问题 | 位置 | Impeccable 法则违反 |
|---|------|------|---------------------|
| 1 | **硬编码 mock 数据泄漏**：` WritingSurface.tsx:431-443` 中 "💍 龙纹古戒" 和 `:447-452` 中 "林啸" 是开发调试数据，不应出现在生产代码 | WritingSurface.tsx:431-452 | AI slop test — 这是明显的个人 demo 数据 |
| 2 | **58 处 `alert()` 调用**：阻塞主线程，无 dismissal 机制，破坏用户体验流 | 全项目 | Copy — "Every word earns its place"，alert 的文案也缺乏一致性 |
| 3 | **God Component**：WritingSurface 1144 行、AppShell 713 行、WelcomeView 1419 行，单文件职责过重 | 多处 | Layout — "Cards are the lazy answer"，组件拆分不够 |

#### P1: 应该修复

| # | 问题 | 位置 | 建议 |
|---|------|------|------|
| 4 | **按钮样式不一致**：`WritingSurface:572` 用 `bg-theme-text text-white`，`:584` 用 `border border-theme-border bg-theme-sidebar/40`，`:594` 又是另一种 | WritingSurface.tsx:568-620 | 统一为 2-3 种按钮层级 |
| 5 | **嵌套卡片**：WelcomeView 左栏 `rounded-md` 内嵌 `rounded-2xl`，违反 "Nested cards are always wrong" | WelcomeView.tsx:211-274 | 扁平化信息层级 |
| 6 | **渐变装饰条**：`bg-gradient-to-r from-theme-accent/20 via-theme-accent/50 to-theme-accent/20` 违反 "Gradient text" 禁令的精神 | WelcomeView.tsx:213 | 移除或改为纯色细线 |
| 7 | **`hover:scale-[1.01] active:scale-[0.99]`**：违反 "Don't animate CSS layout properties" 和 "No bounce" | WritingSurface.tsx:584,594,607 | 改为 opacity 变化 |
| 8 | **过多 `animate-pulse`**：雷达图、LIVE 标签、状态指示器同时 pulse，视觉噪音大 | WritingSurface.tsx:652,656,676 | 限制同一视口内 pulse 元素数量 |
| 9 | **Prop drilling**：EditorView 向 AgentWorkspace 传递 ~50 个 props | EditorView.tsx:724-796 | 用 Context 或拆分组件 |

#### P2: 可以改进

| # | 问题 | 位置 | 建议 |
|---|------|------|------|
| 10 | **等宽字体滥用**：WelcomeView 遥测面板全用 `font-mono`，包括中文标签 | WelcomeView.tsx:211 | 仅数字/代码用 mono |
| 11 | **过多 `uppercase tracking-wider`**：多处小标签用全大写英文风格，与中文内容不协调 | WritingSurface.tsx:505,529,629 | 中文场景用 `tracking-wide` 替代 |
| 12 | **localStorage key 分散**：`inkflow-*` key 分布在 5+ 个文件中 | 多处 | 集中管理 |
| 13 | **空状态设计薄弱**：Library 空状态只有文字，缺少插图或引导 | Library.tsx | 增加视觉引导 |
| 14 | **WritingSurface 右侧面板 sticky 失效**：`xl:sticky xl:top-0` 在滚动容器内可能不生效 | WritingSurface.tsx:648 | 检查 sticky 上下文 |

---

## Part 2: Audit — 技术质量检查

### A. 可访问性 (Accessibility)

| 问题 | 严重度 | 位置 | 说明 |
|------|--------|------|------|
| 缺少 `aria-label` | 中 | WritingSurface 按钮组 :568-620 | 所有按钮缺少 aria-label，仅靠视觉文字 |
| Focus trap 重复实现 | 低 | AIAssistantDrawer.tsx:41-92, SettingsModal | 应提取为共享 hook 或用 Radix Dialog |
| 缺少 `role="main"` | 低 | AppShell.tsx | 主内容区缺少 landmark role |
| 颜色对比度存疑 | 中 | `text-theme-muted` 在浅色背景上 | OKLCH 0.55 对比度可能不足 4.5:1 |
| 键盘导航不完整 | 中 | WelcomeView 多步向导 | 步骤切换无键盘快捷键 |

### B. 性能 (Performance)

| 问题 | 严重度 | 位置 | 说明 |
|------|--------|------|------|
| WritingSurface 每次 keystroke 重渲染 | 高 | WritingSurface.tsx:312,396-464 | `localContent` 变化触发 800ms entity sniffer，含 `includes()` 全量扫描 |
| 无请求取消 | 高 | useEditorData.ts, prompt-client.ts | 组件卸载后 Promise 仍 resolve 并调用 stale setter |
| 无代码分割 AIAssistant | 中 | AIAssistantDrawer.tsx:4 | 600 行组件 eager import，含 react-markdown |
| `Promise.all` 无错误隔离 | 中 | ProjectCockpitView.tsx:67-85 | 8 个并行请求，任一失败全部 catch |
| useEffect 依赖抖动 | 低 | App.tsx:70-96 | keyboard handler 在每次 state 变化时重新注册 |

### C. 响应式 (Responsive)

| 问题 | 严重度 | 位置 | 说明 |
|------|--------|------|------|
| 编辑器三栏布局断点 | 中 | WritingSurface.tsx:500 | `xl:grid-cols-[1fr_360px]` 在 1280px 以下突然变单栏 |
| WelcomeView 12 栏网格 | 低 | WelcomeView.tsx:205 | `lg:grid-cols-12` 在平板尺寸下左栏过窄 |
| Sidebar 折叠时机 | 低 | Sidebar.tsx:26 | `max-width: 768px` 折叠，但未考虑横屏手机 |
| 写作区域 padding | 低 | WritingSurface.tsx:497 | `px-4 md:px-6 xl:px-8` 在小屏下写作区过窄 |

### D. 代码质量 (Code Quality)

| 问题 | 严重度 | 位置 | 说明 |
|------|--------|------|------|
| 硬编码 mock 数据 | 高 | WritingSurface.tsx:431-452 | 生产代码中的调试数据 |
| `any` 类型泛滥 | 中 | db-mappers.ts, 多处 `as unknown as` | 类型安全缺失 |
| 重复 focus trap 逻辑 | 中 | AIAssistantDrawer, SettingsModal | 应提取为 `useFocusTrap` hook |
| localStorage key 无类型安全 | 低 | 多处 `getItem/setItem` | 应集中定义 key 常量 |
| 缺少 Error Boundary 层级 | 低 | 仅 AppShell 有 ErrorBoundary | 子组件缺少细粒度错误边界 |

---

## Part 3: AI Slop Test

> "If someone could look at this interface and say 'AI made that' without doubt, it's failed."

### 第一阶: 能否从品类猜出主题+调色板?

**通过。** InkFlow 的 OKLCH 暖色调中性色 + 深红棕 accent 不是典型的 "AI 蓝" 或 "AI 紫"。终端风遥测面板和雷达图有辨识度。

### 第二阶: 能否从品类+反引用猜出审美家族?

**部分通过。** 高密度信息布局、发丝边框、紧凑按钮接近 "专业工具" 审美（如 Vercel Dashboard、Linear）。但以下元素暴露 AI 痕迹:

1. **过度装饰的渐变条** (`WelcomeView:213`) — 典型 AI 生成 UI 的 "科技感" 装饰
2. **同时 pulse 的多个元素** — AI 倾向于到处加动画
3. **`animate-pulse` + `LIVE` 标签组合** — 常见于 AI 生成的 dashboard 模板
4. **过多的 `uppercase tracking-wider` 标签** — AI 偏好的 "专业感" 措辞

### 通过率: 7/10

---

## Part 4: 优先修复路线图

### Phase 1: 紧急 (1-2 天)
1. 移除 WritingSurface 硬编码 mock 数据 (`mock-ring`, `林啸`)
2. 替换全局 `alert()` 为 toast 统一反馈
3. 移除 `hover:scale` 动画，改为 opacity

### Phase 2: 重要 (1 周)
4. 拆分 WritingSurface (1144行) 为 3-4 个子组件
5. 提取 focus trap 为共享 hook
6. 统一按钮层级样式 (primary/secondary/ghost)
7. 移除 WelcomeView 渐变装饰条

### Phase 3: 优化 (2 周)
8. EditorView prop drilling 改为 Context
9. 增加 Error Boundary 层级
10. 集中管理 localStorage keys
11. 优化 WritingSurface keystroke 性能
