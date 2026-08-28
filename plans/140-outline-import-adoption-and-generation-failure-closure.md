# Plan 140：导入大纲直接采用与生成失败闭环

状态：`DONE`

## 目标

让导入资料中的大纲原文可被明确选择、直接采用并安全落盘；AI 整理模式必须使用所选大纲原文，并在生成失败时保留原大纲、给出可操作反馈。

## 收口范围

- 大纲文件展示、主大纲选择、直接采用与覆盖确认。
- 生成请求参数校验、原文/字符预算、输出上限与失败分类。
- 编辑器保存队列接入及失败保护。
- Plan 135 文案回归与真实路由/保存队列测试。

## 验收

```bash
npm run typecheck
npm run lint -- --max-warnings=0
npm test
npm run test:frontend
npx playwright test
git diff --check
```
