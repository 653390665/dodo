# Plan 212: E2E 自动 build 守卫——消灭「测旧 dist」陷阱

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt（测试基建）
- **Planned at**: commit `aad58c2`, 2026-09-14

## Why this matters

Plan 207 执行期实测：playwright webServer 以 `DISABLE_VITE_DEV_MIDDLEWARE=1` 服务 `dist/` 构建产物，**改源码后不手动 `npm run build` 就跑 E2E，测的是旧代码**——当时排查耗了三轮才发现（207 台账行有注记）。这是结构性陷阱：任何「E2E 失败」都要先怀疑构建新鲜度，验证成本恒定增加。

## Fix

`playwright.config.ts` webServer.command 前置 `npm run build`：

```
command: 'npm run build && DISABLE_VITE_DEV_MIDDLEWARE=1 node --import tsx server.ts'
```

构建实测 ~5-7s，webServer timeout 120s 预算充足；`reuseExistingServer: false` 保证每次 E2E 都走新构建。

**Out of scope**：给 webServer 换回 Vite dev middleware（启动预算与时序问题，当年刻意关闭，见 config 注释）。

## Steps

### Step 1: 改 webServer command

**Verify**: 改一个源码可见断言（临时）→ 直接跑任一 E2E → 断言按新源码生效（证明构建自动前置）；还原临时改动
### Step 2: 台账落账（207 行注记补「已由 212 结构性消除」）

**Verify**: 台账落账

## Done criteria

- [ ] E2E 启动自动前置 build，源码改动无需手动构建
- [ ] 台账 212/207 行落账

## STOP conditions

- build 前置导致 CI/E2E 启动超时（120s 预算被吃穿）→ 停止改用 globalSetup 检查 dist 新鲜度并报错拦下的方案。
