# 002 — 审稿三合一与精修按需触发

## 背景（为什么）

"审稿"当前有三套互不相认的实现：

| 入口 | 模板 | 结果存放 | 代码 |
|---|---|---|---|
| 工作台审稿标签（手动） | `manualAudit` | AI 横幅（一次性） | `server/routes/audit.ts:255` |
| 生产流水线 Critic | `orchestrateCritic` | run.styleAudit | `server/routes/agents.ts:698` |
| 章节完成审查（自动） | 独立 JSON 审计 | workflowMeta.reviewState + 门禁 | `server/helpers/chapter-completion.ts:70-76` |

四套评分口径（门禁机械分 85 / Critic 阈值 80 / 完成审查 60 分线 / 各自 pass-fail）。用户在三个地方看到三次"审稿"，结论互不引用；精修入口分散且要求预配置。埋点：critic_review 3 / audit 2 / polish 2（对比 editor_enter 152）——采纳无效。

**产品判定（PM）**：审稿应在**每章写入后自动发生一次**（完成审查已承担，且有门禁语义）；精修应**由审稿结论一键触发**，不允许也不需要预配置。

## 目标

1. **完成审查成为唯一自动审稿源**：其结果（reviewState issues + 评分）是唯一权威结论。
2. **工作台审稿标签降级为"质量报告"查看器**：显示完成审查的结论与问题列表 + "重新审查"按钮（重跑 completeChapter 的审计段）；不再独立调 `/api/audit` 生成第二份结论。
3. **生产流水线 Critic 并入口径**：orchestrateCritic 保留流内迭代用途（Writer 重写反馈），但其 styleAudit 结论标注"生产期审稿"，最终章内结论以完成审查为准（现状大体如此，补齐标注与 UI 文案）。
4. **精修按需**：完成审查的每个 issue 保留现有"修复预览/接受风险"按钮（已实现）；删除任何要求"先配置精修卡才能精修"的前置（确认 `handlePolishChapterFromAudit` 无卡也可用——当前实现已无此要求，防止 001 改动时引入）。
5. 评门口径收敛文档化：在 `docs/research/2026-09-06-capability-system-essence.md` 附"口径表"（85 机械 / Critic 80 迭代线 / 完成审查 60 交付线）标注各自用途，避免未来误"统一"。

## 涉及文件

- `src/components/AgentWorkspace.tsx`（审稿标签改为报告查看器；`QualityTab` 相关分支）
- `src/components/book-factory/QualityTab.tsx`（同上，或由其承载查看器）
- `server/routes/audit.ts`（保留 API 但前端不再主用；或在 handler 内改为转发完成审查结果）
- `src/lib/hooks/useEditorGenerationFlow.ts`（handleRunAudit 降级路径）
- `src/components/ProductionRunReview.tsx`（生产期审稿文案标注）

## 实施步骤

1. `QualityTab` 渲染源切换：优先读取 `currentChapter.workflowMeta.reviewState`（完成审查结论）；无结论时显示"尚未审查——接受正文后自动运行"并提供"立即审查"按钮（仍调完成审查的审计段）。
2. `/api/audit` 保留（兼容），但工作台主路径不再调用；在 `audit.ts` 顶部加注释声明降级。
3. `ProductionRunReview` 生产期 styleAudit 区块标题改为"生产期审稿（迭代用）"，与章内权威结论区分。
4. 回归确认：`handlePolishChapterFromAudit` 在零能力卡配置下可用（当前已满足，加测试锁定）。

## 验证

- `npx tsc --noEmit` → 0
- `npx vitest -c vitest.config.frontend.ts run src/tests/production-run-review.test.tsx src/tests/editor-guidance-layout.test.tsx` → 全过
- 手动：接受正文 → 完成审查自动跑 → 工作台审稿标签显示同一份问题列表；精修按钮在未配置任何卡时可用

## 边界

- 不合并三个 prompt 模板本身（评分口径差异是产品语义，见第 5 点）
- 不动 `chapter-completion.ts` 的 60 分线与门禁逻辑

## 完成标准

- [ ] 工作台审稿标签不再独立生成第二份结论
- [ ] 完成审查结论在审稿标签中可见
- [ ] 零配置精修有测试锁定
