# Plan 068: 落地基于 Diff 追踪的自适应 Reflexion 进化引擎

## Goal
实现 PRD 规划中的 Evolution Agent 闭环：对比 AI 原始生成的草稿与用户最终修改并保存的文本，提取差异（如删除的词语、调整的句式），自动归纳写作规则，并增量更新到该小说的 Skill 配置文件中。

## Proposed Changes

### [MODIFY] [production.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/server/routes/production.ts)
- 在用户点击“应用并写入”时，将 AI 原始草稿（`run.draftContent`）与用户当前的编辑器内容进行段落和字符级 Diff 对比。
- 如果差异率（Diff Ratio）达到阈值且存在显著改动，在后台启动一个 Evolution 任务：
  - 将 Diff 结果投递给 Evolution Agent (LLM)。
  - Evolution Agent 分析出作者删除了哪些词汇（如 AI 腔高频词）或改写了哪些段落（如说教改描写）。
  - 将新识别出的避坑规则自动追加到对应小说关联的 Skill 配置文件中（如增加 `bannedWords` 或调整写作偏好）。

## Verification Plan
1. 生成一章草稿，故意手动删除其中的“不禁”、“倒吸一口凉气”并保存。
2. 触发应用保存后，检查后台日志是否触发了 Evolution 分析。
3. 查看该小说的 Skill 卡片，验证“禁词表”中是否已自动追加了被删词汇。
