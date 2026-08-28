# Plan 168: 能力工具结构精修候选消费闭环

## Status

- **State**: DONE (2026-08-23)
- **Priority**: P1
- **Effort**: S/M
- **Risk**: MED
- **Depends on**: `plans/166-anti-ai-literary-structure-loop.md`
- **Planned at**: 2026-08-23

## Why this matters

Plan 166 已让能力工具返回结构信号以及 `contextRewrite.required/not-required`，但当前能力工具结果的共享类型只声明 `preview/quality`，编辑器也只展示机械预览或“打开精修卡”。结构证据没有稳定地进入现有 `/api/rewrite` 的 `beforeContext/text/afterContext/auditIssue` 请求，因此作者可能看到“需要上下文精修”，却无法从同一结果直接生成局部候选。

本计划只补齐“诊断结果 → 局部上下文精修候选”的消费链路，不改数据库 schema、不自动写入正文、不绕过候选确认、不改变能力卡存储格式。

## Scope

允许修改：

- `shared/types/utility.ts`
- `src/lib/capability-client.ts`
- `src/components/EditorView.tsx`
- `src/lib/hooks/generation/useAuditPolishActions.ts`（仅复用已有局部精修请求参数和候选状态）
- `src/tests/` 中对应能力工具/候选链路测试
- `tests/e2e/full-browser-click-journey.spec.ts` 或独立能力工具 E2E fixture

禁止修改：

- `server/helpers/fallback-draft.ts`
- `server/helpers/ai-production-pipeline.ts`
- `server/routes/production.ts`
- 数据库 schema、embedding、Provider 解码与依赖
- 现有候选接受协议和正文自动写入路径

## Steps

### 1. 固定共享响应合同

在 `shared/types/utility.ts` 为诊断和 transform preview 增加可选的结构信号字段、`qualityMode`、`needsContextRewrite/contextRewrite`。保持旧客户端字段兼容；类型必须允许服务端额外字段被安全读取。结构信号必须保留 `signal/priority/range/scope/snippet/suggestion`，不得包含原始整章或日志。

验证：新增类型级测试或现有能力工具测试断言响应可安全解析旧响应和新响应。

### 2. 绑定能力结果与局部精修请求

在 `EditorView` 中，当 transform preview 的 `contextRewrite.status === 'required'` 时显示明确的“生成上下文精修候选”动作。动作只取当前结果的一个结构证据窗口，携带基线哈希、章节/数据库代次、前后文、目标片段和问题证据，调用现有 `/api/rewrite` 的 `mode: surgical-patch` 请求；不得直接改 textarea 或持久化正文。运行中禁用重复点击，失败保留机械预览和输入并允许重试，切章/切作品/代次变化取消请求。

验证：前端测试断言请求发生、200ms 内进入 running、接受前正文不变、失败可重试、成功产生候选而不是写入。

### 3. 复用现有候选质量和接受边界

上下文精修返回后，复用现有候选质量门禁、基线哈希和 `databaseGeneration` 校验；重新扫描结构信号。若结构复审未通过，保留原文与候选并显示待人工处理，不启用接受。不要把 deterministic preview 或 fallback 结果标记为已去 AI。

验证：候选接受测试覆盖旧预览过期、重试上下文保留和接受后一次写入；服务端错误码不泄露正文、配置或堆栈。

### 4. 浏览器链路

在隔离 E2E 中点击能力工具 → 查看结构证据 → 生成上下文精修候选 → 验证正文未提前变化 → 接受候选 → 验证正文和版本持久化。桌面和移动端均验证按钮可操作、无横向溢出。

## Done criteria

- 能力工具新响应和旧响应均可被类型安全消费。
- `required` 结构问题能从同一结果直接生成局部上下文精修候选。
- 精修运行中、成功、失败、重试状态清晰；失败不清空原文。
- 接受前正文、版本和审稿状态不变；接受后才一次写入并保存前版本。
- 结构复审未通过时接受按钮保持禁用。
- 定向前端、后端和隔离 Chromium 测试通过；不接触生产 `data.db`。

## Verification

```bash
npm run typecheck
npm run lint
npm run test:frontend -- --run src/tests/capability-preview-apply.test.ts src/tests/editor-candidate-acceptance.test.ts
npx playwright test tests/e2e/full-browser-click-journey.spec.ts
git diff --check
```

## STOP conditions

- 需要修改数据库、候选接受协议或生产管线才能完成；停止并回报。
- 结构证据无法稳定定位到正文窗口；不得退化为整章重写。
- Provider 失败只能返回原文/机械预览和可重试错误，不能伪造成功候选。
