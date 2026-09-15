# Plan 230: 新用户保底配置——一键「套用推荐配置」+ 空状态导购（F1/P0-C，依赖 225）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat b3a5bcc..HEAD -- src/components/SkillsStudioView.tsx src/lib/capability-governance.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P1（空货架死状态：145 张卡对零导购，新用户唯一出口是离开）
- **Effort**: S-M
- **Risk**: LOW（复用既有应用链路，纯新增入口）
- **Depends on**: 225（推荐集取自官方规范区）
- **Category**: feature（能力商店诊断 · 成长引导）
- **Planned at**: commit `b3a5bcc`, 2026-09-15（来源：四轮思考 · 全面诊断 F1「145 张卡对零导购」）

## Why this matters

未配置作品的用户进能力中心，看到的是满墙卡 + 「先在书库选择作品」；选了作品的零配置用户，面对的同样是不知道从哪下手的货架。产品明明有一个高质量答案：去AI味规则卡（95 分官方内置）+ 官方主流程 + 默认护栏已是自动生效——一套「保底配置」一键即可给到，却要用户自己从 118 张卡里拼出来。

## Current state（2026-09-15 亲读核实，锚点基于 `b3a5bcc`）

1. 未选作品：页首摘要卡「未选择流程 / 0 张已收藏 / 卡组 0/3」+ 正文区「先在书库选择作品，再管理能力」+「去书库选择作品」按钮（导航已通）。
2. 已选作品零配置：`capabilityProfile` 缺省（收藏 0/卡组 0/流程未选）；`getProjectCapabilityProfile` 返回默认结构。
3. 应用链路成熟：`applyConfiguration`（含 226 前的 preview→apply、失效技法自动摘除）；护栏 12 条 core-default 自动生效无需配置。
4. 225 后：官方规范区可程序化取推荐集（去AI味规则卡 + 官方流程 id）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 定向 | `npx vitest run --config vitest.config.frontend.ts src/tests/<新用例>` | 全绿 |
| 前端全量 | `npm run test:frontend` | 全绿 |
| typecheck | `npm run typecheck` | 0 |

## Scope

**In scope**：
- 推荐配置常量：`STARTER_PROFILE_PRESET`（去AI味规则卡加入收藏技法 + 官方主流程 activeFlowId；护栏不动——已自动生效）
- 零配置作品的空状态导购卡：「先套用保底配置（去 AI 味 + 商业连载流程），或自己逛货架」两个动作；未选作品时仅展示说明与书库导航（不预配置）
- 一键应用走既有 `applyConfiguration(true)`（含预览/摘除/回写作导航全链路）

**Out of scope**：
- 按题材差异化推荐（适合度推荐后续结合回执数据另立项）
- 二次推荐/推荐解释面板

## Steps

### Step 1: 预设常量与空状态导购

`STARTER_PROFILE_PRESET`（id 显式、可测试）；零配置检测（profile 无收藏且无流程且无卡组）；空状态导购卡渲染（仅零配置时）。

**Verify**: 组件测试——零配置显示导购卡/已配置不显示；预设常量含预期卡与流程 id

### Step 2: 一键应用与回归

「套用保底配置」→ 组装预设 profile → `applyConfiguration(true)` 复用；成功后走「返回写作」导航。前端全量 + typecheck；台账落账。

**Verify**: 组件测试（点击 → 调 applyConfiguration with preset）；前端全量绿

## Done criteria

- [ ] 零配置用户一键获得可用保底配置并回写作
- [ ] 空状态不再是死胡同
- [ ] 台账落账

## STOP conditions

- 保底配置应用被既有校验拒绝（如流程 id 与免费/商业化状态冲突）→ 停止，报告冲突点。
