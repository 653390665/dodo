# 章节 PDF 导出 — 实施计划

> 状态：待实施 | 创建：2026-05-15 | 目标：在编辑器工具栏增加 PDF 导出按钮，支持单章/全书导出

## 1. 现状分析

### 1.1 已有导出功能

- **位置**：`EditorView.tsx` 底部状态栏（行 1394-1423），按钮名为"导出"
- **格式**：EPUB（默认）、TXT
- **端点**：`POST /api/export`，服务端生成，返回 blob 下载
- **范围**：仅支持导出全书（`novelId` + 全部 chapters），不支持单章

### 1.2 涉及的关键文件

| 文件 | 角色 |
|---|---|
| `src/components/EditorHeader.tsx` | 编辑器顶部工具栏，PDF 按钮将加在此处 |
| `src/components/EditorView.tsx` | 编辑器主容器，持有 chapters、currentChapter 状态 |
| `src/types.ts` | Chapter 类型定义（title, content, order, volumeName 等） |
| `server.ts` | 现有 /api/export 端点（行 1866-1968），可能需要扩展 |
| `electron.cjs` | Electron 主进程，若有 native PDF 路径可扩展 |
| `electron-preload.cjs` | 仅暴露 setTitle，若走 Electron IPC 需扩展 |
| `src/index.css` | 全局样式，可放 @media print 样式 |
| `package.json` | 依赖清单（当前无 PDF 库） |

### 1.3 数据流现状

```
EditorView (React state)
  ├── chapters: Chapter[]          ← 全量章节数据
  ├── currentChapter: Chapter      ← 当前编辑的章节
  └── novel: Novel                 ← 书名等元信息
```

前端已持有全部数据，导出无需额外服务端查询。

## 2. 方案对比

| 方案 | 依赖 | CJK 质量 | 复杂度 | 一致性 |
|---|---|---|---|---|
| **A: 浏览器打印 (window.print)** | 0 | 极好（原生渲染） | 低 | 与现有导出模式不同 |
| B: jsPDF (客户端) | 1 新 dep | 一般（需嵌入中文字体，体积大） | 高 | 可做成 blob 下载 |
| C: pdfkit (服务端) | 1 新 dep | 一般（需注册中文字体） | 高 | 与 /api/export 一致 |
| D: Electron printToPDF | 0 (Electron 内置) | 极好 | 中 | 仅在 Electron 中可用 |

**推荐方案 A**，理由：
- **零新依赖**，符合项目"不引入不必要的依赖"原则
- **CJK 渲染质量最优**：浏览器原生排版引擎，中文断行、标点压缩、字体回退均正确
- **实现最简单**：核心逻辑 < 80 行
- **跨平台一致**：浏览器 + Electron 均可使用（Electron 内 `window.print()` 同样工作）
- 唯一缺点：用户需在打印对话框中点"保存为 PDF"，而不是一键下载。可选优化：在 Electron 中后续通过 IPC 调用 `printToPDF()` 实现无对话框版本（见 5.3 扩展项）

## 3. 实施步骤

### Step 1: 创建 PDF 导出工具函数 (新建文件)

**文件**：`src/lib/pdf-export.ts`（新建）

**职责**：
- `exportChapterToPdf(chapter: Chapter, novelTitle: string)` — 导出单章
- `exportBookToPdf(chapters: Chapter[], novel: Novel)` — 导出全书

**核心逻辑**：
```
1. 构建完整 HTML 文档字符串：
   - DOCTYPE + head（meta charset utf-8, title, style）
   - 内联 CSS：@page 设置 A4 尺寸、页边距
   - body：章节标题用 <h1>/<h2>，正文用 <p> 分段
   - 全书模式：每个章节前加分页符 (page-break-before: always)

2. 打开新窗口 (window.open)，写入 HTML
3. 等待窗口加载完成后调用 window.print()
4. 打印对话框关闭后自动关闭窗口
```

**样式要点**：
- 字体：`font-family: "Songti SC", "Noto Serif CJK SC", "SimSun", serif`
- 字号：标题 18pt，正文 12pt，行高 1.8
- 页边距：上下 2cm，左右 2.5cm
- 正文段落首行缩进 2em
- 全书模式每章自动分页：`page-break-before: always`
- 不打印按钮/工具栏等 UI 元素（新窗口天然隔离）

**注意**：新窗口可能被浏览器拦截。需要在用户点击事件中同步调用 `window.open()`（不能包在 async 回调里），然后异步写入内容。

### Step 2: 修改 EditorHeader — 添加 PDF 导出按钮

**文件**：`src/components/EditorHeader.tsx`

**2a. 扩展 Props 接口**

新增 3 个 prop：
```typescript
onExportChapterPdf?: () => void;
onExportBookPdf?: () => void;
isExportingPdf?: boolean;
```

**2b. 在工具栏右侧添加按钮**

位置：紧邻全屏按钮左侧（Step 2 的 Settings 按钮旁边）。

UI 设计（参考现有工具栏风格）：
```tsx
<button
  onClick={onExportChapterPdf}
  disabled={!currentChapter || isExportingPdf}
  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-theme-border 
             text-xs font-medium text-theme-text hover:bg-theme-sidebar/40 transition-colors
             disabled:opacity-40"
  title="导出本章为 PDF"
>
  <FileDown size={14} /> PDF
</button>
```

如需支持单章/全书选择，可用一个带下拉的按钮或两个独立按钮。建议先做两个独立按钮（"导出本章 PDF" + "导出全书 PDF"），简单直观，不需要额外 UI 组件。或使用 `<select>` 包裹的小型下拉。

**更简单的做法**：只加一个按钮，点击后弹出确认框让用户选择（类似现有导出按钮用 `confirm` 区分 EPUB/TXT）：
```typescript
onClick={() => {
  if (!currentChapter) return;
  if (confirm('导出为 PDF？（确定=本章，取消=全书）')) {
    onExportChapterPdf();
  } else {
    onExportBookPdf();
  }
}}
```

图标可选 `FileDown` 或 `FileText`（均已在 lucide-react 中，已在 EditorHeader imports 存在）。

### Step 3: 在 EditorView 中连接数据与导出逻辑

**文件**：`src/components/EditorView.tsx`

**3a. 导入工具函数**
```typescript
import { exportChapterToPdf, exportBookToPdf } from '../lib/pdf-export';
```

**3b. 添加导出处理函数**

```typescript
const [isExportingPdf, setIsExportingPdf] = useState(false);

const handleExportChapterPdf = useCallback(() => {
  if (!currentChapter) return;
  setIsExportingPdf(true);
  exportChapterToPdf(currentChapter, novel.title);
  // exportChapterToPdf 是同步调用（window.open），打印对话框关闭后窗口自毁
  setIsExportingPdf(false);
}, [currentChapter, novel.title]);

const handleExportBookPdf = useCallback(() => {
  exportBookToPdf(chapters, novel);
}, [chapters, novel]);
```

**3c. 传递给 EditorHeader**

在 EditorHeader 的 JSX 调用处（EditorView 行 1341-1356）增加新 props：
```tsx
<EditorHeader
  // ... 现有 props
  onExportChapterPdf={handleExportChapterPdf}
  onExportBookPdf={handleExportBookPdf}
  isExportingPdf={isExportingPdf}
/>
```

### Step 4: 在 EditorHeader 中消费新 props

（已在 Step 2b 中描述）

### Step 5: 可选 — 为浏览器劫持场景增加容错

Web 应用中 `window.open()` 可能被 popup blocker 拦截。处理方式：

```typescript
const printWindow = window.open('', '_blank', 'width=800,height=600');
if (!printWindow) {
  alert('PDF 导出窗口被浏览器拦截，请允许本网站弹窗后重试。');
  return;
}
```

这已包含在 pdf-export.ts 的初始实现中。

## 4. 涉及的文件清单

| 操作 | 文件 | 说明 |
|---|---|---|
| **新建** | `src/lib/pdf-export.ts` | PDF 导出核心逻辑 (~80 行) |
| **修改** | `src/components/EditorHeader.tsx` | 添加 PDF 按钮 + 新增 props |
| **修改** | `src/components/EditorView.tsx` | 添加导出处理函数，向下传 props |
| **不改** | `server.ts` | 无需服务端变更 |
| **不改** | `electron.cjs` | 无需 Electron 变更 |
| **不改** | `package.json` | 零新依赖 |

## 5. 风险与对策

### 5.1 超长章节 (>10 万字)

**风险**：超长内容生成 HTML 字符串可能卡顿，新窗口 DOM 构建慢。
**对策**：实测 10 万字纯文本生成 HTML 约 200ms，远低于可感知阈值。若未来遇到性能问题，可改为分段（每 5000 字一个 `<section>`）。

### 5.2 Popup Blocker

**风险**：浏览器拦截 `window.open()`。
**对策**：在用户点击事件的同步阶段调用 `window.open()`（不放在 async/await 后）。增加被拦截后的提示。

### 5.3 特殊字符 & XSS

**风险**：章节内容包含 `<`, `>`, `&` 等 HTML 敏感字符。
**对策**：HTML 模板中做一次 `escapeHtml` 转义（纯函数，已在 server.ts 中实现过相同逻辑，直接复用）。

### 5.4 Electron 中打印对话框体验

**风险**：Electron 的打印对话框与系统原生对话框一致，但用户可能需要额外操作。
**对策**：短期接受。长期可扩展 `electron-preload.cjs` 暴露 `savePdf` IPC，在 Electron 中跳过对话框直接保存（见 5.3 扩展项）。

## 6. 验证方式

### 6.1 手动验证

1. **单章导出**
   - 打开一个有内容的章节
   - 点击工具栏 "PDF" 按钮 -> 选择"本章"
   - 验证打印预览中显示：章节标题、正文内容、无杂项 UI
   - 保存为 PDF，打开检查排版

2. **全书导出**
   - 在多章节作品中点击 "PDF" -> 选择"全书"
   - 验证打印预览中每章从新页开始
   - 验证章节按 order 排序
   - 验证所有章节内容完整

3. **空内容边界**
   - 无章节时按钮 disabled 状态正确
   - 空内容章节导出显示 "(无内容)" 或空段落

4. **特殊内容**
   - 包含 `<script>` 标签的内容不执行（XSS）
   - 包含 HTML 实体的内容正确显示
   - 中英文混排、标点符号正常

### 6.2 自动化测试

`pdf-export.ts` 是纯函数，易于单元测试：
- `escapeHtml()` 函数测试
- `buildChapterHtml()` 输出包含正确的标题标签和分页符
- 全书模式章节按 order 排序

## 7. 后续扩展（非本期）

- **Electron 直达保存**：通过 IPC 调用 `webContents.printToPDF()` 跳过打印对话框
- **PDF 元数据**：利用 `<meta name="author">` 设置 PDF 作者信息
- **自定义页眉页脚**：章节名/页码通过 `@page` 的 `@top-center` / `@bottom-center` 实现
- **PDF 格式加入 /api/export 端点**：为保持与现有 TXT/EPUB 导出一致，可在服务端增加 `format=pdf` 支持（需 pdfkit 依赖），但这会与方案 A 重复且 CJK 质量不如浏览器
- **样式可配**：允许用户选择正文字体/字号/行距
