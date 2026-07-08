# Plan 066: 补充桌面端 Electron 启动与调试文档以及 Google GenAI 渠道配置指南

## Goal
补充 `README.md` 中缺失的 Electron 桌面端本地开发与调试步骤，并详细指引用户如何配置 Google GenAI 渠道以启用 Gemini 模型的 Thinking 深度推理模式。

## Proposed Changes

### [MODIFY] [README.md](file:///Users/Zhuanz/Documents/dodo-inkflow/README.md)
- 在“本地开发”章节中，新增“Electron 桌面端开发与调试”小节：
  - 说明如何运行 `npm run electron:dev` 启动桌面程序并自动开启 Chromium 开发者工具。
  - 解释 `electron.cjs` 的生命周期，以及如何在桌面端主进程与 Express 后端服务之间进行协同调试。
- 在“大模型配置”章节中，新增“Google Gemini 原生配置（推荐）”小节：
  - 引导配置 `GEMINI_API_KEY`（或在设置界面填入）。
  - 说明如何配置以开启原生 Gemini 2.5 Pro 的 Thinking Budget 深度思考限制，从而获得最佳的细纲与逻辑审校体验。

## Verification Plan
1. 在浏览器中阅读 `README.md`，确保排版结构清晰。
