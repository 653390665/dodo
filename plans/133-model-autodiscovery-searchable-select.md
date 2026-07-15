# Plan 133：模型自动发现与可搜索选择

## 状态

`DONE`

## 范围

- 测试连接时同步获取服务商可用模型列表。
- Model 输入框升级为可搜索、可选择、可手填的组合框。
- 避免模型名拼写错误，同时兼容不支持模型列表接口的私有代理。

## 实现说明

### T1：后端模型发现（已完成）

`server/helpers/model-discovery.ts` 已实现：
- OpenAI 兼容服务调用 `GET {baseUrl}/models`，使用 Bearer Key
- Google 官方服务通过 `@google/genai` SDK 的 `models.list()` 获取
- 名称统一 trim、去重、排序；最多 500 项，单项最长 500 字符
- 404/405/501 返回 `unsupported`，保留手填模式
- 401/403 视为凭证失败；其他发现错误降级执行连接测试

`server/routes/config.ts` 的 `POST /api/config/test-connection` 已集成发现流程：
- 返回 `{ ok, connectionOk, models, modelDiscovery, selectedModelValid, modelTested, message, warning }`
- 模型为空或不在列表时不发起无效生成请求
- 连接限流、并发控制、15 秒超时已共用

### T2：前端组合框（当前实现）

`src/components/SettingsModal.tsx`：
- Model 字段改为无新增依赖的可编辑组合框
- 输入文字即时过滤模型列表
- 支持鼠标选择及方向键、Enter、Escape 键盘导航
- 使用 `combobox/listbox/option` 语义和对应 ARIA 属性
- 点击"测试连接"后填充模型选项，显示"已发现 N 个模型"
- 当前值不在列表时继续保留，标记为"自定义模型"
- API Key 或 Base URL 改变时清除旧模型列表和旧测试结果
- 不支持模型发现时显示琥珀色提示，继续允许手动填写

### 前端测试

- 测试后展示模型列表
- 搜索过滤
- 键盘选择
- 保存选中模型
- 自定义模型保留
- 服务配置变化清除旧列表

## 验收

```bash
npm run typecheck
npm run lint
npm test
npm run test:frontend
npx playwright test
git diff --check
```

## 依赖

- 不新增外部依赖
- 不修改数据库 schema
- 不改变现有配置保存格式
