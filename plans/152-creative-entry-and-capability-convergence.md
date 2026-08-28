# Plan 152: 完成创作入口与能力选择收敛

> **Executor instructions**: This is a reconciled remainder plan. Preserve the Plan 150 server contract and the already-landed five-category capability UI. Do not repeat completed work.
>
> **Drift check (run first)**: `git diff --stat dff4445..HEAD -- src/components/WelcomeView.tsx src/components/ProjectCockpitView.tsx src/components/SkillsStudioView.tsx src/components/AppShell.tsx src/components/WorldBibleOnboarding.tsx src/lib/capability-governance.ts src/tests/capability-client-boundary.test.ts src/tests/components.test.tsx src/tests/skills-studio-trust.test.ts tests/e2e/plan150-capability-governance.spec.ts tests/e2e/mobile-layout.spec.ts` and the same command without `dff4445..HEAD` to include the dirty worktree. If live behavior differs from the current-state facts below, stop and report.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plan 150 DONE, Plan 151 DONE
- **Category**: direction | ux | correctness
- **Planned at**: commit `dff4445` + current worktree, reconciled 2026-08-10
- **Execution state**: DONE (2026-08-10)

## Why this matters

能力治理合同已经存在，但用户仍不能从当前创作阶段直接理解“推荐什么、为什么、进入商店后看哪一组”。剩余工作只解决发现、解释和导航上下文，不改变技能运行时、槽位、配额或数据库。

## Current state

已完成：

- Welcome 已移除虚假离线生成与固定时长承诺。
- 驾驶舱通过专用 `onOpenCapabilities({ novelId, stage })` 进入能力页；旧 `onNavigate` 第二参数重载已移除。
- 唯一工作流阶段 helper 覆盖 8 个 phase；Sidebar 旧入口仍从全部阶段进入。
- 驾驶舱与 onboarding 已呈现 Flow、Role Skill、Overlay、Guardrail 摘要，且 Role Skill 仍需显式接受。
- Skills Studio 的五类能力、真实动作和 Flow 数量已对齐；移动旅程先进入能力商店，再逐类验证。
- production 请求边界与 `buildContextPrompt` sentinel 已证明不上传 Skill 对象、prompt 或卡片正文。
- Coordinator 定向 Vitest 29/29、typecheck、改动源码 ESLint、diff check 均通过；独立规格与质量复审均 APPROVE。实际 Playwright 旅程由 Plan 155 执行。

## Scope

**In scope**: `src/components/WelcomeView.tsx`, `src/components/ProjectCockpitView.tsx`, `src/components/SkillsStudioView.tsx`, `src/components/AppShell.tsx`, `src/components/WorldBibleOnboarding.tsx`, `src/lib/capability-governance.ts`, `src/tests/capability-client-boundary.test.ts`, `src/tests/components.test.tsx`, `src/tests/skills-studio-trust.test.ts`, `tests/e2e/plan150-capability-governance.spec.ts`, `tests/e2e/mobile-layout.spec.ts`.

**Out of scope**: server resolver/routes, shared stage contract, slot schema, SQLite,会员/配额、能力目录重分类、删除旧路由、大规模视觉重构。

## Remaining steps

### Step 1: 修正所有 Welcome 生成承诺

将三处剩余文案改为真实状态：模型处理中只说明正在等待；失败时只承诺保留输入，以及本地编辑、保存和资料整理仍可用。不得承诺固定 2 秒、后台必然替换或离线生成。

**Verify**: `rg -n "本地保底架构|本地算法保底方案|本地离线方案|大概需要 2 秒" src/components/WelcomeView.tsx` → 无匹配；Welcome 离线组件测试通过。

### Step 2: 建立显式能力启动上下文

在 `src/lib/capability-governance.ts` 增加唯一的工作流阶段映射：`sync/planning -> creative-setup`、`drafting -> active-drafting`、`audit/polish -> style-polish`。使用专用 `onOpenCapabilities(stage)` 或等价的强类型状态从驾驶舱进入 Skills Studio；不得继续把 novelId 塞进 `onNavigate` 的 `WorkspaceNavKey` 参数。Sidebar 旧入口保持 `all`，驾驶舱入口初始化为当前阶段。

**Verify**: 组件测试断言 Sidebar 进入为 `all`、驾驶舱进入为映射后的阶段、当前作品未丢失。

### Step 3: 只读呈现阶段推荐

复用现有分层目录，在驾驶舱呈现当前阶段的一条 Flow、一条 Role Skill、一条可选 Overlay 和默认 Guardrail 摘要；没有候选时显示系统默认能力，不自动装配。Flow 继续来自 `SKILL_SERIES_FLOWS`，Guardrail/Overlay 来自治理目录，Role Skill 继续使用作品方案匹配结果，禁止为了 UI 汇总另造一个混合资产目录。onboarding 显示这四类摘要并提供“稍后调整”；Role Skill 接受动作仍需用户显式点击。

**Verify**: 测试覆盖空目录/有候选、未点击时 loadout 不变、点击原有装配按钮后才写入。

### Step 4: 补齐信任边界和可访问测试

扩展测试覆盖五类标签、三种动作、旧入口、阶段筛选、窄屏换行。拦截至少一个正文生成请求，断言包含 fingerprint、governed ID/session card ID 和允许的业务字段，不包含 Skill 对象、prompt 或卡片正文。事实性的 `contextStr` 可以保留，但不得包含测试 sentinel 标记的技能 prompt、文风正文或资料包文风重复注入。

**Verify**:

```bash
npx vitest -c vitest.config.frontend.ts run src/tests/skills-studio-trust.test.ts src/tests/components.test.tsx src/tests/capability-client-boundary.test.ts
npm run typecheck
npm run lint
git diff --check
```

## Done criteria

- [x] Welcome 不再伪造离线生成或固定时长。
- [x] 驾驶舱进入能力页时保留当前作品并定位当前阶段；Sidebar 旧入口仍为全部阶段。
- [x] 当前阶段能看到 Flow、Role Skill、Overlay、Guardrail 摘要，且不会自动装配。
- [x] 保存、装配、仅本次使用仍可区分。
- [x] 生成请求不上传 Skill 对象、prompt 或卡片正文；事实性 `contextStr` 不重复注入技能/资料包文风。
- [x] 定向 Vitest、typecheck、lint 和 diff check 全部通过。

## STOP conditions

- 需要修改 Plan 150 服务端执行合同、共享 slot schema 或 SQLite。
- 当前目录无法给出阶段候选，且必须新增第二套分类才能实现。
- 阶段导航必须破坏旧 `skills` 路由才可完成。

## Maintenance notes

阶段映射必须只有一个 helper；新增工作流阶段时同时更新映射测试。推荐摘要只是发现入口，不是运行时执行证明。
