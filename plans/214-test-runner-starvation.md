# Plan 214: 全量跑批饥饿治理——「昨绿今挂」总根因（占位）

> **Executor instructions**: 按步骤顺序执行。完成后更新 `plans/README.md` 中本计划的状态行。

## Status

- **Priority**: P2（Next 批次占位：杠杆项——过去三轮「间歇失败」的共同根因）
- **Effort**: M
- **Risk**: MED（动测试基建，需专门验证窗口）
- **Depends on**: 212（build 守卫先行，减少归因误判）
- **Category**: tech-debt（测试基建）
- **Planned at**: commit `aad58c2`, 2026-09-14

## Why this matters

Round 31 定性：全量跑批间歇失败是测试运行器饥饿伪影——失败点漂移（plan158 弹窗用例轮换挂）、单跑全绿、空载全量绿；超时残留 DOM 导致 `aria-labelledby` 重复 id 级联。症状跨三轮反复出现（Round 31 归因、209 act 噪音显形、本轮仍在），治好后所有后续计划的验证成本下降。

## Current state

- 前端 vitest 133 文件并行跑（默认 pool/threads），资源争抢下慢用例超时→残留 DOM→级联；后端 node --test 同理（1095+ 用例）。
- 209/211 已消灭 act 噪音与固定 id 串名两个级联放大器，饥饿本体未治。

## Steps

### Step 1: 复现与度量

连续 3 次全量跑，记录失败用例集合漂移与耗时分布，确认饥饿指纹（同用例集合随机挂）。

### Step 2: 并行度调参实验

vitest `pool`/`poolOptions.maxThreads|maxForks`、`sequence.groupOrder`、慢文件分组；后端 node --test `--test-concurrency`。每组参数 3 连全量验证。

**Verify**: 某组参数下 3 连全量 0 失败且总时长可接受（≤ 现状 1.5 倍）

### Step 3: 固化 + 台账

选定参数写入 vitest 配置/npm scripts；台账落账。

## Done criteria

- [ ] 3 连全量 0 失败（前端+后端）
- [ ] 参数固化；台账落账

## STOP conditions

- 调参后仍漂移失败 → 失败非饥饿，逐例归因另立。
