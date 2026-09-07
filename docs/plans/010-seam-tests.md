# 010 — 接缝测试补齐（J6 消毒链端到端 + J7 store 传播）

> 生成：2026-09-08。来源：链路联动测试的接缝矩阵（docs/research/2026-09-08-chain-block-testing.md）。
> 矩阵修正：J4（候选接受→重审）经查已有完整背书（editor-candidate-acceptance.test.ts:165/193/218），从缺口中移除。

## 背景

链路分块测试证明六条链路各自健康；联动块证明已知接缝全绿。但两条**本批次新产物的接缝**只有单侧测试：

1. **J6 消毒链端到端**：消毒端点（后端 5 例）与启用链路（plan158）各测各的，"点击消毒并启用 → 端点调用 → savedSkills 刷新 → 卡移出需解锁 → 启用链路落库"没有一条贯穿断言。
2. **J7 store 传播**：GenerationStatusBar 的组件级测试用 setState 驱动；"两个表面同时挂载、一处写入、另一处同步"的传播契约无断言。

## 目标

1. J6 集成测试：mock 消毒端点 → 点击「消毒并启用」→ 断言端点被以正确 assetId 调用、`applyCapabilityConfiguration` 被调用（启用链路走通）、该卡的消毒按钮从需解锁分组消失。
2. J7 传播测试：同屏两个 `GenerationStatusBar`（模拟工作台与编辑器两个表面），通过 store 写入模拟一次生产生命周期，断言两个表面四段同步流转。

## 涉及文件

- `src/tests/skills-studio-plan158.test.tsx`（J6，复用既有 mock 基建）
- `src/tests/generation-status-bar.test.tsx`（J7）

## 验证

- `npx vitest -c vitest.config.frontend.ts run` 全绿（839 → 841+）
- `npx tsc --noEmit` 0

## 边界

- 不修改源码——只补测试；若测试暴露产品缺陷，停下报告而非就地修
- 不动后端

## 执行状态（2026-09-08 完成）

| 项 | 状态 |
|---|---|
| J6 消毒链端到端 | ✅ 且**接缝测试抓到真产品缺陷**：45 张候选卡全被目录 candidate 状态挡在 cloneAssetToSkill 门外，"消毒并启用"永远只消毒不启用却谎报成功。修复：新增 `equipPersistedTechnique`（目录克隆与消毒副本共用装配路径），消毒后启用直接装配已落库副本，不再过目录克隆门槛（004 意图：消毒完成即视为可用） |
| J7 store 传播 | ✅ 双表面挂载 + 生产生命周期 store 写入的同步流转断言 |
| J4 矩阵修正 | 候选接受→重审已有完整背书（editor-candidate-acceptance:165/193/218），从缺口移除 |

## 完成标准

- [x] J6 端到端用例存在且通过（并修复暴露的产品缺陷）
- [x] J7 双表面传播用例存在且通过
