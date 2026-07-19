# Plan 028: 张力心电图 — 章节张力评分 + 历史曲线 + 低谷诊断
> Source: PlotPilot 竞品分析 | Priority: P1 | Effort: S-M

## Why
PlotPilot 的张力心电图是作者最直观看到叙事质量变化的工具。InkFlow 已有 6 维审计评分（文笔/叙事/角色/设定/节奏/追读力），张力可以从中派生 + LLM 辅助诊断低谷。

## Goal
每章生成后自动计算张力评分（0-10），前端展示历史曲线，低谷自动触发 LLM 诊断。

## Steps

### Step 1: 张力评分算法
- 从审计 6 维中派生：`tension = (节奏*0.3 + 追读力*0.3 + 叙事*0.2 + 角色*0.2) / 10`
- 或直接让 audit prompt 多输出一个 `tensionScore` 字段（更准确）
- 存入 `chapters` 表的 `audit_scores` JSON 字段
- Verify: 审计后 `chapter.audit_scores.tensionScore` 存在且 0-10

### Step 2: 后端 `/api/novels/:novelId/tension-curve` 端点
- 查询该 novel 所有已审计章节的张力评分 + 章节号 + 标题
- 返回 `{ chapters: [{ order, title, tensionScore, timestamp }], min, max, avg, trend: 'rising'|'falling'|'flat' }`
- Verify: `curl /api/novels/xxx/tension-curve` 返回完整曲线数据

### Step 3: 前端 TensionChart 组件
- 使用现有 ECharts 依赖（或简化的 SVG 折线图）
- 展示：章节号 x 轴 → 张力评分 y 轴
- 颜色编码：>7 绿色，4-7 黄色，<4 红色
- 低谷点标注红色圆点 + tooltip "可能需要检查节奏"
- 复用 InkFlow 现有主题 token（bg-theme-sidebar, text-theme-text）
- 当趋势为 falling 且最新评分 <5 时，显示 "⚠️ 张力下行" 提示
- Verify: 2+ 章节有审计数据后，Dashboard/PacingDashboard 出现张力曲线

### Step 4: 低张力自动诊断
- 当连续 2 章 tensionScore <5 时，触发 `/api/analyze-pacing` 的 enhanced 诊断
- 诊断提示词增加："张力已连续 N 章低于 5，请重点分析节奏问题与读者期待缺口"
- 结果展示在 PacingDashboard 的 "诊断建议" 区
- Verify: 创建 2 个低分章节后，PacingDashboard 出现诊断建议

## Done Criteria
- [ ] `npx tsc --noEmit` 零错误
- [ ] 每章审计后自动计算张力评分
- [ ] 前端折线图展示全本张力曲线（>2 章后出现）
- [ ] 连续低张力自动触发诊断

## STOP Conditions
- 如果审计结果不包含足够信息派生出张力评分，停止并增加 `tensionScore` 字段到 audit prompt
- 如果前端无 ECharts 依赖（需额外安装），停止并用纯 SVG/CSS 折线图替代
