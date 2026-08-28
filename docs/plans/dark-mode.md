# Dark Mode 功能实施计划

## 现状评估：已部分实现

暗色模式的 CSS 基础设施和状态管理层已就绪，但大量组件的硬编码颜色值导致实际切换暗色后视觉效果损坏。本计划聚焦于**补齐缺失**。

## 证据表

| 声明 | 证据 | 文件:行 |
|---|---|---|
| Tailwind CSS v4 已安装，支持 `@theme` 和 `[data-theme]` 选择器 | `"tailwindcss": "^4.1.14"`, `"@tailwindcss/vite": "^4.2.4"` | package.json:45, package.json:22 |
| CSS 自定义属性已定义 light/dark 双套值 | `@theme { --color-theme-bg: ... }` 和 `[data-theme="dark"] { ... }` | src/index.css:3-28 |
| `data-theme` 属性已由 App.tsx 写入 `<html>` | `document.documentElement.dataset.theme = resolved` | src/App.tsx:38 |
| localStorage 持久化已实现 | `localStorage.setItem(THEME_KEY, theme)` | src/App.tsx:68 |
| 系统颜色方案监听已实现 | `window.matchMedia('(prefers-color-scheme: dark)')` | src/App.tsx:72-76 |
| Theme 类型定义已存在 | `type Theme = 'light' \| 'dark' \| 'system'` | src/App.tsx:32 |
| 设置面板已有三档切换 UI (亮色/暗色/跟随系统) | Sun/Moon/Monitor 按钮组 | src/components/SettingsModal.tsx:214-237 |
| SettingsModal 正确接收 theme 和 onThemeChange props | `{ theme, onThemeChange }` | src/components/SettingsModal.tsx:11 |
| `clsx` + `tailwind-merge` 已安装 | `"clsx": "^2.1.1"`, `"tailwind-merge": "^3.5.0"` | package.json:25, package.json:35 |
| 项目是 Electron 应用，但 UI 是标准浏览器环境 | `"electron": "^33.4.0"`, `index.html` 加载 React | electron.cjs, index.html |
| `natural-btn-primary` 组件类使用 `bg-theme-accent text-white` | `@apply px-4 py-2 bg-theme-accent text-white ...` | src/index.css:61-63 |
| 已有模式：SettingsModal 主题按钮使用 `bg-theme-accent text-theme-bg` | 选中态: `bg-theme-accent text-theme-bg` | src/components/SettingsModal.tsx:227-228 |
| 有 `bg-theme-accent text-theme-bg` 正确模式可沿用 | 保存按钮: `bg-theme-accent text-theme-bg` | src/components/SettingsModal.tsx:434 |

## 根本问题分析

CSS 变量 `--color-theme-accent` 的值在 light/dark 之间反转：
- **light**: `#000000` (黑色)
- **dark**: `#ffffff` (白色)

当前大量组件使用 `bg-theme-accent text-white` 组合：
- light 模式下：黑底白字，OK
- dark 模式下：**白底白字，不可见**

同样，`bg-theme-text text-white` 在 dark 模式 (`--color-theme-text: #e5e5e5`) 下对比度极低。

修正方向：将 `text-white` 替换为 `text-theme-bg`（在两种模式下均有足够对比度）。

## 实施范围

### 第 1 步：修正 CSS 组件类（影响面最广，一行改多处）

**文件: `src/index.css`**

修正 `natural-btn-primary`：
```
当前（有 bug）: bg-theme-accent text-white
修正为:          bg-theme-accent text-theme-bg
```
证据：SettingsModal.tsx:227 已使用此正确模式。

### 第 2 步：替换存在系统性问题的颜色组合（全局替换）

以下组合需要全局替换：

| 当前组合 | 替换为 | 原因 |
|---|---|---|
| `bg-theme-accent text-white` | `bg-theme-accent text-theme-bg` | dark 下 accent=white 导致白字不可见 |
| `bg-theme-text text-white` | `bg-theme-text text-theme-bg` | dark 下 text=#e5e5e5 与 white 对比度太低 |
| `bg-white` (作为容器背景) | `bg-theme-sidebar` 或 `bg-paper` | 白色在 dark 下刺眼 |

**影响文件清单**（通过代码审查确认）:

| 文件 | 需修正行 | 硬编码颜色 |
|---|---|---|
| `src/App.tsx` | 581, 585 | `bg-white` 在 AI 抽屉和头部 |
| `src/components/WritingSurface.tsx` | 74, 106, 108, 124, 134, 148, 155, 163, 164, 191, 200, 202, 221, 241, 258 | `bg-white`, `bg-[#fcfbf8]`, `from-[#fffdf8]`, 硬编码渐变 |
| `src/components/AIAssistant.tsx` | 258, 260, 301, 346, 361, 390, 392, 438, 472, 528, 535 | `bg-white`, `hover:bg-white`, `bg-white/80` |
| `src/components/Sidebar.tsx` | 70 | `bg-white` 在激活导航项 |
| `src/components/EditorView.tsx` | 1437, 1506 | `bg-white` |
| `src/components/EditorHeader.tsx` | 94, 98, 105 | `bg-white/70` |
| `src/components/Library.tsx` | 142, 204, 277 | `bg-white`, `focus:bg-white`, `bg-white` |
| `src/components/WelcomeView.tsx` | 124, 136, 155, 172, 200, 261, 299 | `bg-white` 多处 |
| `src/components/SplitWorkspace.tsx` | 61, 73 | `bg-white` |

### 第 3 步：处理写作区特殊渐变背景

**文件: `src/components/WritingSurface.tsx`**

当前第 163-164 行和 191 行使用了硬编码的暖色纸张背景：
```
bg-[#fcfbf8]           → 需替换为 bg-paper 或 theme token
from-[#fffdf8]         → 需替换
bg-[linear-gradient(180deg,rgba(250,247,241,0.92)_0%,rgba(255,255,255,1)_18%)]
```

方案：新增 CSS 自定义属性或在 `index.css` 中定义 `.writing-area` 组件类，使其在 dark 下切换为暗色调。

推荐在 `index.css` 的 `[data-theme="dark"]` 块中追加：
```css
[data-theme="dark"] .writing-area {
  background: linear-gradient(180deg, rgba(26,26,26,0.92) 0%, rgba(15,15,15,1) 18%);
}
```
然后 WritingSurface.tsx 中 `bg-[#fcfbf8]` 替换为 `bg-paper`，渐变替换为 `writing-area`。

### 第 4 步：图书封面渐变调整

**文件: `src/components/Library.tsx`** (第 186-194 行)

当前封面渐变类使用了 Tailwind 的浅色渐变（`from-rose-100`, `to-teal-50` 等），dark 模式下这些浅色渐变仍然明亮。

方案：不做结构性改动（封面只是装饰），但在 dark 模式下通过 CSS 降低覆盖层透明度。当前已有 `from-white/40` 覆盖层，可增加 dark 变体。

### 第 5 步：输入框和文本域

**多文件**: SettingsModal.tsx:356 有 `bg-white` 的 textarea。  
各组件中的 `<input>` 和 `<textarea>` 若使用 `bg-white`，需替换为 `bg-theme-bg`。

SettingsModal.tsx:367 的 textarea (`bg-white`) 为最明显的问题点。

### 第 6 步（可选）：Electron 原生窗口主题

**文件: `electron.cjs`**

当前未设置 `backgroundColor` 或 `titleBarStyle`。可在 `BrowserWindow` 创建时添加：
```js
backgroundColor: '#0f0f0f',  // 与 dark 背景一致，减少闪白
```
注意：Electron 窗口原生外观独立于 Web 内容，不会自动跟随 CSS 主题切换。需要用 `nativeTheme` API 或 IPC 通信来同步，范围较大，建议作为后续优化。

## 不需要做的事情

1. **不需要新增 npm 依赖** -- Tailwind CSS v4、clsx、tailwind-merge 已就位。
2. **不需要新增 ThemeContext/Provider** -- App.tsx 的状态 + `data-theme` 属性方案已经 works，加 Context 属于过度抽象。
3. **不需要修改 CSS 变量定义** -- `src/index.css` 的 `@theme` 和 `[data-theme="dark"]` 变量值合理。
4. **不需要修改 `SettingsModal` 主题切换 UI** -- 已完整实现。
5. **不需要改 `main.tsx`** -- 入口文件不涉及主题逻辑。

## 未检查的内容及原因

| 未检查 | 原因 |
|---|---|
| `src/components/skills/*` 子组件的全部颜色 | 数量多（8 个文件），计划优先修正主视图，子组件遵循相同规则批量处理 |
| `src/components/copilot/*` 子组件 | 同上述，子组件在父组件背景下渲染，但仍有独立 `bg-white` 需修正 |
| `src/components/onboarding/*` 子组件 | 同上 |
| `tests/` 目录 | 无现有主题测试，不涉及功能逻辑变更 |
| `server.ts` | 后端文件，不涉及前端主题 |

## 实施顺序建议

1. **Step 1**: 修正 `src/index.css` 的 `natural-btn-primary` -- 一行改多处
2. **Step 2**: 逐文件替换 `bg-theme-accent text-white` -> `text-theme-bg`（全局正则替换，影响 ~30 处）
3. **Step 3**: 逐文件替换 `bg-white` -> `bg-theme-sidebar` 或 `bg-paper`（按语义选择，影响 ~40 处）
4. **Step 4**: 处理写作区特殊渐变（WritingSurface.tsx + index.css）
5. **Step 5**: 肉眼验证所有主要视图在 dark 模式下的可读性
6. **Step 6** (后续): Electron 原生窗口主题

## 风险

1. **语义选择歧义**: `bg-white` 替换为 `bg-theme-sidebar` 还是 `bg-paper` 需根据上下文判断 -- 如果原本用作卡片/面板背景，用 `bg-theme-sidebar`；如果原本是页面主内容区，用 `bg-paper`。
2. **暗色渐变缺失**: 写作区渐变替换后，如果没有定义对应的 dark 渐变，视觉效果会退化。建议先在 `index.css` 中定义好 dark 渐变再替换。
3. **Electron 白色闪烁**: 当前 Electron 窗口未设置背景色，启动时可能在 CSS 加载前闪现白色。这在方案中已标注为后续优化。
4. **遗漏**: 本项目组件数量多（约 25+ 个 .tsx 文件），仅审查了主要视图。skills/copilot/onboarding 子目录中的子组件大概率也有 `bg-white` 需要修正。
