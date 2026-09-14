# Plan 213: plan199 尾巴终局处置——两个缓议 E2E 给结论

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat aad58c2..HEAD -- tests/e2e/plan150-writing-style-confirmation.spec.ts tests/e2e/full-browser-click-journey.spec.ts src/components/SkillsStudioView.tsx src/components/EditorStatusBar.tsx`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED（若查明为产品真回归而非 spec 陈旧，需转归因另立）
- **Depends on**: 212（E2E 先自动 build，保证测的是新代码）
- **Category**: bug-fix/E2E 债清偿（199 收口前置）
- **Planned at**: commit `aad58c2`, 2026-09-14

## Why this matters

plan199 是台账最后一个 PARTIAL，两个缓议项「无期限缓议=永挂」。2026-09-14 实测（aad58c2 构建后）：两项仍红——现在是给出终局（重锚/修复/归档）的时候。

## Current state（2026-09-14 实测，锚点基于 `aad58c2`）

1. **plan150-writing-style-confirmation** `desktop confirms, survives style 409, and resumes once`（:166）：点「生成本章正文」→ 弹窗「确认并生成」后 `draftCalls` 停在 0（expect :177 失败）。selector 用 `/生成本章正文|确认并生成/.first()` 多匹配取首，域内按钮 DOM 序漂移即可点错；亦不可排除写法确认→orchestrate-draft 链路真回归（Round 32 改动面不含写法链，先验概率低）。
2. **full-browser-click-journey** `浏览器点击全流程：能力卡到正文`（:340）：「回到刚才章节写作」按钮 isVisible=true 但 click 10s 超时——命中区被遮挡类不稳定（hit-target 拦截）。**需排查是否 208 portal 化副作用**（EditorStatusBar 菜单 portal 到 body 的 z-50 层或其关闭监听）或预存堆叠问题。

## Steps

### Step 1: plan150 desktop 用例诊断与重锚

定位「本次写法」region 内匹配按钮集合与实际点击目标；若为 selector 多匹配漂移 → 精确化（exact 文案/role 层级）；若确认链路真未发 orchestrate-draft → 归因（对照 207/208/210 改动面）。

**Verify**: 该用例绿；若真回归 → STOP 报告转归因
### Step 2: full-browser hit-target 排查与处置

用 trace/错误上下文定位「回到刚才章节写作」被谁拦截；208 portal 副作用则修 EditorStatusBar（如 portal 层 pointer-events 或关闭时机）；预存堆叠则修拦截方或该按钮等待语义。

**Verify**: 该用例绿
### Step 3: 199 收口

两项终局后：199 行转 DONE（终局方式入账）；若 Step 1/2 触发 STOP 转归因，199 保持 PARTIAL 并附新归因。

**Verify**: 台账落账

## Test plan

受影响 spec 3 连跑绿 + 全 E2E 套件一轮绿（本轮已含 build 守卫）。

## Done criteria

- [ ] 两用例终局（绿或归档有据）
- [ ] 台账 213/199 行落账

## STOP conditions

- 查明为产品真回归（非 selector 陈旧/非可修拦截）→ 停止转归因另立，不硬修 spec 掩盖。
- full-browser 拦截方为第三方叠加层且修复涉及大范围 z-index 体系重构 → 停止报告方案。
