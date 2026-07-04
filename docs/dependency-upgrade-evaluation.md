# InkFlow 第三方依赖升级与安全评估报告

本报告针对 InkFlow 桌面协作客户端及服务端底层第三方依赖架构，进行全面的升级可行性、安全性与兼容性技术审计。

---

## 1. 核心依赖版图与升级策略归类

当前核心依赖已分为以下三大矩阵：**安全可直升 (Patch/Minor)**、**需严密验证 (Major 升舱)** 以及 **暂不动 (Keep Stable)**。

### 📊 升级决策矩阵一览

| 依赖包 (Package) | 当前版本 (Current) | 推荐目标版本 (Target) | 决策归类 (Class) | 升级影响与潜在风险评估 (Impact & Risk) |
| :--- | :--- | :--- | :--- | :--- |
| `better-sqlite3` | `^12.9.0` | `12.x` 最新 Patch | **暂不动** | **高风险**：涉及 Electron Native C++ 原生模块 Node-API 重新编译。Major 升级或不当 Patch 会导致 `better-sqlite3.node` 与 Electron 运行时 ABI 不匹配引起崩溃。 |
| `electron` | `^42.5.0` | `^42.6.x` | **安全可直升** | **中风险**：限制在当前 42 核心大版本内的 Minor/Patch。避免直升跨代大版本，防范 Electron 渲染进程隔离、主进程安全 IPC 通信等 API 被废弃引发的打包失效。 |
| `vite` | `^6.4.3` | `^6.5.x` | **安全可直升** | **低风险**：Vite 6 本身支持 React 19 和 Electron 混合打包，升级 Minor 能提升 HMR 构建速度与首屏冷启动性能。 |
| `tailwindcss` | `^4.1.14` | `^4.2.x` | **安全可直升** | **低风险**：Tailwind CSS v4 在打包和解析 CSS AST 性能上有显著优化，直升不影响现有 CSS 类名渲染。 |
| `@google/genai` | `^1.29.0` | `^1.x` 最新 Minor | **安全可直升** | **中风险**：由于涉及 Gemini-2.5 官方原生 API 通信，应保持 Minor 更新以同步官方 Quota、Thinking 节点优化与流式响应格式微调。 |
| `react` / `react-dom` | `^19.0.1` | `19.0.x` / `19.x` | **暂不动** | **极高风险**：目前已处于最新的 React 19.x，底层 `useEditorRecommendationCards` 与 EditorView 渲染完全贴合 React 19 新并发架构，暂无再次跨代升级需要。 |
| `@radix-ui/*` 组件群 | `^1.x` | `^1.x` 最新 Minor | **暂不动** | **中风险**：Radix Primitives 的无样式交互状态（如 Alert-Dialog, Scroll-Area, Tabs, Tooltip）已与 CSS 主体深度绑定。升级大版本有可能破坏 React 19 的 refs 兼容。 |

---

## 2. 深度架构评估与安全门禁

### 🛠️ 2.1 Native C++ 原生模块编译陷阱 (better-sqlite3)
- **底层风险描述**：`better-sqlite3` 在运行时并不是纯 JS 代码，而是依赖底层 SQLite 的 C 语言原生编译。在 Electron 桌面打包过程中，必须执行 `electron-rebuilder` 或通过 `npmRebuild: true` 针对 Electron 内置的 V8 引擎 ABI（Application Binary Interface）进行交叉编译。
- **治理决策**：**严禁随意升级 `better-sqlite3` 到可能涉及底层 C 源码重大重构的版本。** 在后续升级中，必须在打包机上运行 `npm run package` 全流，确认是否有 `NODE_MODULE_VERSION` 异常报错，确保断电恢复与数据落盘完整性（对应任务 095）。

### 🔒 2.2 Electron 安全边界与打包体积卡控
- **底线防御规则**：
  - 维持当前 Electron `v42.5.0` 的高级安全特性（上下文隔离 Context Isolation 默认开启，集成 Preload 机制）。
  - 在升级任何 `devDependencies`（如 `esbuild`, `electron-builder`）时，确保构建脚本 `scripts/package-electron.mjs` 中的 `asar` 打包白名单没有发生物理泄露，防止 `node_modules/better-sqlite3` 等核心二进制被误排除。

### 🎨 2.3 React 19 与 Radix Primitives 的 Ref 传递兼容性
- **Ref 穿透安全性**：React 19 将 `ref` 变为了普通的 prop 传入。然而，老版本的 Radix 依旧依赖 `forwardRef`。
- **升级考量**：在 Radix Primitives 彻底升级其对 React 19 的全量原生支持前，保持其在 `1.x` 版本内微升级，并开启 `npm overrides`，避免 React 19 严苛模式下的 Ref 内存泄漏或类型崩溃。

---

## 3. 下一步依赖安全升级与全量验证计划

若要落地以上升级建议，应通过以下**三步走**安全防护流程：

```mermaid
graph TD
    A[第一步: 运行 npm upgrade 进行 Minor 升级] --> B[第二步: 执行 npm run typecheck & lint 零报错校验]
    B --> C[第三步: 执行全流程 Electron 打包本地冒烟测试]
    C --> D{全绿通过?}
    D -- Yes --> E[升级包锁定并提交 Git]
    D -- No --> F[执行 Git Rollback 回滚]
```

1. **执行升级命令**：
   ```bash
   # 仅针对安全可直升包进行微升级
   npm update vite tailwindcss @google/genai @eslint/js
   ```
2. **执行编译质量门卡控**：
   - 静态类型检查：`npm run typecheck`
   - Lint 硬限制校验：`npm run lint` 和 `npm run lint:any` （确保 Explicit Any 严格控制在 5/5 以内）
3. **交付全量本地测试**：
   - 必须运行 `npm run test`（345+ 集成与 Mock 边界用例，要求全绿通关，防止任何依赖回归引起行为变异）。
