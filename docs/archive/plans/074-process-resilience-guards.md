# 实施计划: 落地进程级异常容错与崩溃守护 (074)

本计划旨在为 InkFlow 的本地后端服务添加全局异常拦截器，防止在 Electron 桌面端运行时因偶发的未捕获异常导致后端静默退出。

## 发现的稳定性缺陷
当前 `server.ts` 中没有注册全局的 `uncaughtException` 和 `unhandledRejection` 事件监听：
- 在调用外部 AI API（如 Gemini API）或者进行后台异步 RAG 索引时，如果发生网络突变、API 超时或本地磁盘写入瞬间锁死，可能会产生未捕获的 Promise 拒绝。
- 根据 Node.js 的默认行为，未捕获的异常会导致 Node 进程直接崩溃退出。
- 在 Electron 环境下，后台 Express 服务的崩溃将直接导致前端所有的 AI 交互、设定读取和自动保存功能彻底失效（表现为界面卡死或空白），严重损害用户体验。

## 解决方案
- 在 `server.ts` 文件的末尾注册进程级的 `uncaughtException` 和 `unhandledRejection` 守护。
- 捕获异常并输出结构化错误日志，拦截崩溃信号，确保本地服务在非灾难性异常下保持运行，极大地增强系统的鲁棒性。

## 变更文件

### [server.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/server.ts)
- 添加全局 `process.on('uncaughtException')` 与 `process.on('unhandledRejection')` 监听逻辑。

## 验证计划
- 运行 `npx tsc --noEmit` 确保无编译类型错误。
- 运行 `npm run test` 确保无回归错误。
