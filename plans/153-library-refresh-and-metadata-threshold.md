# Plan 153: 完成书库刷新竞态证据与批量化决策

> **Executor instructions**: This is a reconciled remainder plan. Keep the existing per-novel API unless deterministic evidence crosses the gate below. Do not add a batch endpoint speculatively.
>
> **Drift check (run first)**: `git diff --stat dff4445..HEAD -- src/components/Library.tsx src/tests/library-refresh.test.tsx src/lib/chapter-client.ts src/lib/continuation-client.ts plans/153-library-refresh-and-metadata-threshold.md` and the same command without `dff4445..HEAD`.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf | correctness | tests
- **Planned at**: commit `dff4445` + current worktree, reconciled 2026-08-10
- **Execution state**: DONE (2026-08-10)

## Why this matters

序号保护已经写入，但现有测试没有真正让旧 metadata 晚于新 metadata 返回，也没有证明失败刷新会保留已有数据。剩余工作是补强证据并形成批量化决策，不扩展 API。

## Current state

- `src/components/Library.tsx:32-88` 已有 request sequence、mounted guard、旧数据保留、amber 错误提示和显式重试。
- `src/tests/library-refresh.test.tsx` 的 8 个测试实例已覆盖删除/SSE、旧 metadata 晚返回、缓存保留、卸载保护和 10/50/100 作品测量。
- 10/50/100 作品受控测量为 20/100/200 个请求与 700/3500/7000 bytes，未跨过批量化门槛。
- Coordinator 已复跑定向 Vitest（8/8）、改动源码 ESLint 和 diff check，均通过。

## Scope

**In scope**: `src/components/Library.tsx`（仅测试发现真实缺陷时）、`src/tests/library-refresh.test.tsx`、本计划的测量决策记录。

**Out of scope**: 新 batch endpoint、DB registry、schema、SSE 协议、列表虚拟化、生产 `data.db`。

## Remaining steps

### Step 1: 真实覆盖旧 metadata 晚返回

第一轮 `listNovels` 正常返回 A，但 A 的 chapter/pack metadata 使用 deferred Promise；触发 SSE 刷新并让第二轮 B 的 metadata 先完成；最后解析 A 的旧 metadata。断言页面和计数仍只属于 B。

### Step 2: 覆盖缓存保留与卸载

先成功加载可见 metadata，再让刷新失败，断言旧章节/资料包计数仍显示并出现重试提示。增加卸载后解析 Promise 不产生 state update/console error 的用例。

### Step 3: 建立可重复的容量证据

对 10/50/100 个 mock 作品记录：请求总数、受控响应序列化字节数和 metadata 完成事件。CI 只断言确定性计数/字节，不对 jsdom wall-clock 设性能阈值。若要测真实耗时，只能在隔离浏览器场景重复至少 5 次并记录中位数。

批量化触发条件固定为：100 作品场景受控 metadata 超过 1 MiB，或隔离浏览器 5 次中位刷新超过 750 ms，或已有用户可复现卡顿证据。未达到则保留现 API，并在本计划记录“NO-GO”；请求数量本身不单独触发新 endpoint。

**Verify**:

```bash
npx vitest -c vitest.config.frontend.ts run src/tests/library-refresh.test.tsx
npm run typecheck
npm run lint
git diff --check
```

## Done criteria

- [x] 测试真实证明旧 metadata 不能覆盖新作品。
- [x] 测试证明失败刷新保留已有 metadata，且卸载后不提交状态。
- [x] 10/50/100 的请求数和序列化字节可重复输出。
- [x] 本计划记录 batch GO/NO-GO 及证据；未达阈值时不新增 endpoint。
- [x] 定向 Vitest、typecheck、lint、diff check 通过。

## Measurement decision (2026-08-10)

- 10 部作品：20 个 metadata 请求，受控序列化响应 700 bytes。
- 50 部作品：100 个 metadata 请求，受控序列化响应 3500 bytes。
- 100 部作品：200 个 metadata 请求，受控序列化响应 7000 bytes。
- 竞态、缓存保留和卸载保护由 `src/tests/library-refresh.test.tsx` 的 6 个确定性用例覆盖。
- 当前没有 100 部作品场景超过 1 MiB 的证据，也没有隔离浏览器 5 次中位刷新超过 750 ms 或用户可复现卡顿证据。

**Decision: NO-GO** — 本轮不新增 batch endpoint。若未来达到任一触发条件，另立独立计划并重新测量；不得仅因请求数为 200 就绕过证据门槛。

## STOP conditions

- 测量需要访问运行中的 `data.db`。
- 测试暴露问题跨越 Library 数据边界或需要改 SSE 协议。
- 需要使用不稳定的 CI 时间阈值才能让测试成立。

## Maintenance notes

未来真正新增 batch API 时必须以新的独立计划执行，并同时覆盖作品删除、SSE 刷新、跨作品归属和逐作品 fallback。
