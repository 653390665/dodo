# Plan 161: 正文文学质量合同与阶段上下文收敛

## 状态

`DONE`（2026-08-23；确定性质量合同与候选接受边界已复核）

## 目标

解决“没有乱码但仍不像正常小说”的产品问题：把确定性硬错误、结构性问题和文学性建议分层，避免用一个分数或一组正则掩盖语义审阅缺口。

## 已完成

- 新增 `P0/P1/P2` 正文质量合同。
- `P0/P1` 阻断候选；`P2` 作为可见文风警告，不阻断作者选择。
- 质量报告保留兼容的 `violations`，并增加结构化 `findings`。
- 语义连续性、角色一致性和世界规则检查明确标记为 `unknown`，不伪装成确定性通过。
- Planner、Writer、Critic 使用独立上下文，Critic 不再隐式复用 Planner 上下文。
- 候选预览显示硬性检查结果、语义审阅状态和 P2 建议数量。
- 结构化审稿的 `fatalIssues` 与 `evidence` 已统一映射到章节问题单和四类语义检查：章节目标、人物一致性、世界规则、伏笔与悬念。
- 精修/选中改写候选复用正文质量门禁；精修候选标记为“修正候选待确认”，接受后自动发起受影响问题的局部复审。
- 质量面板显示逐条语义证据、原文片段、位置和修复建议；正文 hash 变化后旧语义结论自动失效。
- 连续性生产管线也写入同一语义状态，未运行模型审阅时保持 `unknown`。

## 收口证据

- 隔离复核 worktree `/private/tmp/inkflow-live-review.CVqoF9`：质量/生产定向 Node 测试 43/43 通过；候选接受、过期候选拒绝、质量失败零写入和 fallback 质量门禁均通过。
- 前端候选/生命周期/质量旅程 9/9 通过；未审阅风险默认禁用、确认绑定哈希、防双击、失败可重试和结果变化后重新确认均有断言。
- `npm run typecheck`、`npm run lint`、`git diff --check` 均通过。
- 2026-08-23 真实 `--live-only` 三样本矩阵完整运行并生成四项指标，但三个审稿响应均为 `audit_response_unparseable`，没有候选或接受结果；该失败保留在 Plan 162，不能被解释为 Provider 文学质量通过。

## 下一步

- 建立隔离的真实 Provider 评测集，记录 P0 逃逸率、P1 漏检率、精修接受率和错误改写率，详见 `plans/162-real-provider-evaluation-metrics.md`。
- 2026-08-19 复核：`npm run smoke:provider-quality` 单段真实 Provider smoke 通过（249 个非空字符，约 4.4 秒）；三样章 `--live-only` 在首个审稿请求超时后退出，未生成完整 LIVE 指标，因此不能把现有 fallback 报告当作真实质量证据。
- 同轮门禁：`npm run typecheck` 通过；质量/审稿/Embedding 定向测试 16/16 通过；`npm run lint` 仍有 2 个错误和 1 个警告（`shared/lib/draft-quality.ts:36`、`src/lib/hooks/useEditorGenerationFlow.ts:327`、`:334`），需先按对应代码所有权修复后再收口。

## 验收

- `P0/P1` 质量问题不能接受并写入。
- `P2` 警告必须在候选预览中可见。
- 语义检查不可在未运行审稿时显示为通过。
- Planner、Writer、Critic Prompt 不互相泄漏阶段专属上下文。
- 定向测试、类型检查和 Lint 通过后，再运行全量回归。
