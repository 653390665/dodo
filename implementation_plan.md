# 发布阻塞项二次修复实施计划

## 目标

在不新增依赖或数据库迁移的前提下，关闭 Audit / Rewrite 时序与持久化问题、Electron 与下载安全缺口、配额退款幂等缺口、数据库导入关闭竞态，并修复计划索引。

## 第一波并行边界

- Agent A（T1）：Audit / Rewrite 后端与前端生成流、对应测试。避免修改配额 helper 的公共契约。
- Agent B（T2）：Electron 来源/协议/IPC 校验、下载 helper 与对应测试。
- Agent C（T4、T5）：数据库实例/导入串行化、数据库竞态测试、计划索引。避免修改 Audit 路由。

## 第二波协调

- Coordinator（T3）：在第一波完成后统一修改 quota guard 及所有 reserve/refund 调用方，处理与 Audit 路由的契约交集。

## 验收门禁

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`
4. `npm run test:frontend`
5. `npx playwright test`

Plan 110 仅在上述门禁和独立 Gatekeeper 复核全部通过后保留为 DONE。

## Plan 121：全仓流式断连治理

- Coordinator：扩展 `stream-disconnect`，提供幂等绑定与 dispose。
- Agent A：迁移 `world.ts`、`simple-llm.ts` 普通 SSE。
- Agent B：统一迁移 `agents.ts` 三处 SSE，保留交付前退款、交付后提交语义。
- Agent C：迁移数据库事件流，补测试和计划台账。
- Gatekeeper：全仓搜索、门禁和断连/配额语义独立复核。

Plan 121 的全部命令与独立 Gatekeeper 复核已通过，状态收口为 `DONE`。

## Plan 122–125：写作数据安全闭环

### 目标

在不新增依赖、不修改数据库业务 schema 的前提下，消除退出丢稿、幽灵章节、人物小传流式部分落盘和错误备份替换主库的风险。

### 并行边界与顺序

- Agent A（Plan 122 → 123）：串行重构编辑器五类字段保存队列、显式 flush、Electron 关闭握手，再收紧章节创建和 update/delete 成功语义。
- Agent B（Plan 124）：人物小传使用严格 SSE reader、节流本地预览、完成后单次落盘及失败恢复。
- Agent C（Plan 125）：唯一临时文件预检、SQLite 完整性/外键/schema/关键查询验证，再进入现有串行替换流程。
- Coordinator：总装跨层契约、计划台账和项目切换边界。
- Gatekeeper：使用隔离数据库独立复核定向持久化测试、全量门禁和打包契约。

### 完成条件

`npm run typecheck`、`npm run lint`、`npm test`、`npm run test:frontend`、`npx playwright test`、`git diff --check` 全部通过后，Plan 122–125 才能从 `IN PROGRESS` 收口为 `DONE`。

GitHub 官方 Playwright、runtime smoke、macOS 与 Windows 打包及全部本地门禁均已通过，Plan 122–125 状态收口为 `DONE`。

## Plan 126：发布数据安全复核收口

- 将编辑器章节选择改为 ID 与完整实体分离，完整正文返回前保持加载态，使用请求序号阻止迟到响应覆盖。
- 所有 AI 正文/分镜写回和全局助手应用动作先等待编辑器写队列，失败时不启动或提交 AI 覆盖。
- 数据库导入增加 `integrity_check`、应用标识、初始化后复检、同盘 rename 和时间戳备份。
- 致命后端异常进入拒绝新请求、drain、关闭、非零退出流程。
- 收紧前端同源鉴权、数据库事件重连和 `/api/db` 方法参数 registry。
- 打包 CI 启动真实 Electron，执行输入、立即退出、重启和正文校验。

Plan 126 仅在本地全量门禁及 macOS/Windows packaged lifecycle smoke 全部通过后标记 `DONE`。

## Plan 129–131：发布阻塞收口

### 目标

在不新增依赖或业务 schema 迁移的前提下，关闭跨作品数据污染、异步 AI 跨库写回、LLM 取消与成本治理、Electron 退出恢复以及压缩包资源耗尽风险。

### 并行审查边界

- Agent A（Plan 129）：归属与事务、database generation、导入 schema 白名单、DB 核心字段不可变。
- Agent B（Plan 130）：provider 真取消、execution gate、配额/并发/速率、后台任务取消。
- Agent C（Plan 131）：Electron 关闭恢复、Watchdog 固定端口、ZIP/DOCX 资源预算。
- Coordinator：补丁导入、跨层契约总装、测试 ABI 顺序、计划台账与最终提交。

### 验收门禁

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`
4. `npm run test:frontend`
5. `npx playwright test`
6. `npm run build`
7. `git diff --check`
8. macOS/Windows 打包及 packaged lifecycle smoke

Plan 129–131 在完整 Node 原生测试、Playwright 和双平台打包生命周期全部通过前保持 `IN PROGRESS`。
