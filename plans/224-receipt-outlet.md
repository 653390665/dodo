# Plan 224: 回执出口——生成结果渲染能力消费凭证（G1/P0-A）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat b3a5bcc..HEAD -- server/routes/production.ts src/components/AgentWorkspace.tsx src/components/EditorView.tsx`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P0（价值闭环最后一环：五步操作链的验证环节缺失）
- **Effort**: S-M
- **Risk**: LOW（纯渲染，数据已在库）
- **Depends on**: none
- **Category**: feature（能力商店诊断 · 回执出口）
- **Planned at**: commit `b3a5bcc`, 2026-09-15（来源：能力商店四轮产品思考 · 全面诊断 C1/G1）

## Why this matters

用户完成「选卡→配置→应用→回编辑器」四步后，永远收不到「这次生成用了你的卡」的凭证。应用效果不可见导致：能力体系价值无法感知、配置对错无法归因、能力中心的存在理由悬空。诊断结论：数据早就落库（`executionReceipt.capabilityRefs`），只欠一个出口。

## Current state（2026-09-15 亲读核实，锚点基于 `b3a5bcc`）

1. `server/routes/production.ts` — 生产管线把消费凭证写进 run：`continuityReport.executionReceipt = { capabilityRefs: string[], writingStyleFingerprint, resolvedAtGeneration, contextDimensions }`（`buildProductionExecutionReceipt`；fallback 路径同样写入，SSE `fallback_continuity` 事件可见）。
2. 编辑器侧零渲染：`grep -rn "capabilityRefs|executionReceipt" src/components/AgentWorkspace*.tsx src/components/EditorView.tsx` → 0 命中。唯一消费方是后端测试。
3. 卡 id → 标题解析的客户端素材齐备：`getCatalogCapabilityManifest` + `CURATED_PRODUCT_SKILLS`（public-skill-catalog 已随包下发）。
4. AgentWorkspace 生成完成区（`model_audit`/`done` 后的审稿页签）与 trace 面板（`AgentWorkspaceTracePanel`）是两个候选出口。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 前端定向 | `npx vitest run --config vitest.config.frontend.ts src/tests/<新增用例文件>` | 全绿 |
| 前端全量 | `npm run test:frontend` | 全绿 |
| typecheck | `npm run typecheck` | 0 |

## Scope

**In scope**：
- AgentWorkspace（生成完成后）单处渲染：`本次生成使用：<卡标题…>`（解析 capabilityRefs，无法解析的 id 显示原 id）
- 可选：点开看 contextDimensions/writingStyleFingerprint 摘要（一行即可，不做详情页）

**Out of scope**：
- 后端任何改动（数据已存在）
- 能力包步骤粒度的回执（后续按需）
- 移动端专属布局（沿用现有面板）

## Steps

### Step 1: 凭证条渲染

在生成完成区（审稿页签顶部或 run 摘要区）加「能力回执」条：从 `run.continuityReport.executionReceipt.capabilityRefs` 解析标题渲染 chips；receipt 缺失（旧 run）时整条不渲染。

**Verify**: 新增组件测试——构造含/不含 executionReceipt 的 run fixture，断言 chips 渲染与静默降级

### Step 2: 回归与台账

**Verify**: 前端全量绿；typecheck 0；台账 224 行转 DONE

## Done criteria

- [ ] 每次生成完成后用户可见「本次生成使用了哪些能力」
- [ ] 旧数据（无 receipt）静默降级不报错
- [ ] 台账落账

## STOP conditions

- 实测发现 fallback/正式两条路径的 executionReceipt 结构不一致导致无法统一渲染 → 停止报告差异。
