# Plan 142：实体提取 JSON 可靠性收口

状态：`DONE`

## 目标

区分实体提取中的 JSON 语法错误、Schema 错误和模型截断，禁止危险自动补全，并在单批范围内重试或分半恢复，保留已成功批次且不发布部分预览。

## 收口范围

- 严格 JSON 解析、模型结束原因识别和安全字段规范化。
- 当前批次一次重试；截断或实体过密时当前批次分半处理。
- 批次级进度、日志脱敏、错误码和前端可操作反馈。
- 错误、退款、零写入和已成功批次不重复调用测试。

## 验收

```bash
npm run typecheck
npm run lint -- --max-warnings=0
npm test
npm run test:frontend
npx playwright test
git diff --check
```
