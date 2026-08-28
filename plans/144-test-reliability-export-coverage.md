# Plan 144: 收口测试稳定性与导出数据安全覆盖

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report. Do not modify the user's primary
> worktree; work only in the isolated worktree prepared for this plan.
>
> **Drift check**: `git diff --stat dff4445..HEAD -- package.json .github/workflows/build.yml server/routes/production.ts tests/production-stream-disconnect.test.ts tests/world-character-state-generation.test.ts tests/vector-store.test.ts tests/book-deconstruction-flow.test.ts tests/config-saving-regression.test.ts tests/user-flows-integration.test.ts server/routes/export.ts server/routes/db.ts`

## Status

- **State**: DONE
- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `dff4445`, 2026-07-31

## Why this matters

默认后端测试缺少并发与超时上限，少数测试还依赖固定磁盘路径、未恢复环境变量或固定时间等待。小说导出已有 E2E happy path，但 TXT/错误分支和 SQLite 快照下载没有直接服务端覆盖。本计划只修复这些已确认问题，不把尚未证实的“SQLite 路径导致全量挂死”当作根因，也不机械补齐所有顶层组件测试。

## Current state

- `package.json` 的 `test` 当前为 `NODE_ENV=test node --test --import tsx tests/*.test.ts`，没有并发和单测试超时。
- `.github/workflows/build.yml` 的 `check` job 直接执行 `npm run test`，没有 job 超时。
- `tests/vector-store.test.ts`、`tests/book-deconstruction-flow.test.ts`、`tests/user-flows-integration.test.ts` 使用固定 DB 路径；`tests/config-saving-regression.test.ts` 和 `tests/user-flows-integration.test.ts` 使用固定配置目录。
- `tests/config-saving-regression.test.ts`、`tests/user-flows-integration.test.ts` 删除环境变量而不是恢复进入测试前的值。
- `tests/production-stream-disconnect.test.ts` 在 abort 后固定等待 300ms；`server/routes/production.ts` 已有 `__productionTestHooks`，应沿用该测试钩子模式。
- `tests/world-character-state-generation.test.ts` 在第三个 provider 调用后固定等待 50ms；服务端已返回 jobId，并提供 world job 状态查询端点。
- `server/routes/export.ts` 是 `POST /api/export`（TXT/EPUB）；`server/routes/db.ts` 的 `GET /api/db/export-file` 才包含 `db.backup()`、临时文件清理和未初始化降级。

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0, 0 warnings |
| Focused backend | `NODE_ENV=test node --test --test-concurrency=4 --test-timeout=45000 --import tsx tests/export-route.test.ts tests/production-stream-disconnect.test.ts tests/world-character-state-generation.test.ts tests/vector-store.test.ts tests/book-deconstruction-flow.test.ts tests/config-saving-regression.test.ts tests/user-flows-integration.test.ts` | all pass |
| Full backend | `npm test` | all pass, exits without hanging |
| Whitespace | `git diff --check` | exit 0 |

## Scope

**In scope**:

- `package.json`
- `.github/workflows/build.yml`
- `server/routes/production.ts`
- `tests/helpers/test-environment.ts` (new)
- `tests/export-route.test.ts` (new)
- `tests/production-stream-disconnect.test.ts`
- `tests/world-character-state-generation.test.ts`
- `tests/vector-store.test.ts`
- `tests/book-deconstruction-flow.test.ts`
- `tests/config-saving-regression.test.ts`
- `tests/user-flows-integration.test.ts`

**Out of scope**:

- Production behavior of `server/routes/export.ts` and `server/routes/db.ts`; tests must characterize it without changing public behavior.
- Converting every SQLite test to `:memory:`.
- Blanket direct tests for every React component.
- `--test-force-exit`, swallowed failures, increased arbitrary sleeps, new dependencies, migrations or schema changes.
- Plans 141–143 and their uncommitted files.

## Steps

### Step 1: Bound the backend test runner

- Change `npm test` and `test:watch` to pass an explicit reasonable concurrency (`4`) and per-test timeout (`45000` ms). Do not add `--test-force-exit`.
- Add `timeout-minutes: 15` to the CI `check` job so infrastructure failure cannot consume an unlimited runner.

**Verify**: `npm test -- --test-name-pattern='nonexistent-plan144-sanity-pattern'` must exit rather than reject the CLI flags. If npm argument forwarding makes this unsuitable, validate with `node --test --test-concurrency=4 --test-timeout=45000 --import tsx tests/async-utils.test.ts`.

### Step 2: Add a shared test environment helper and remove fixed paths

Create `tests/helpers/test-environment.ts` with small, dependency-free helpers:

- create a unique `mkdtempSync` directory and DB/config paths;
- recursively remove the directory so DB, WAL and SHM files are all removed;
- snapshot selected environment variables and restore their exact prior values (including the distinction between absent and present).

Use it only in the four listed fixed-path test files. Preserve each test's assertions and DB lifecycle. Do not create a general framework.

**Verify**: run the four affected tests together with `--test-concurrency=4`; all pass and no `tests/temp-*`, `.db`, `.db-wal` or `.db-shm` files remain in the repository.

### Step 3: Replace fixed timing guesses with observable completion

- Extend the existing `__productionTestHooks` with a nullable disconnect-observed callback invoked from the existing `bindClientDisconnect` callback. Reset it in teardown. In both abort tests, await a deferred promise resolved by this hook before releasing `preFallbackWriteHook`; delete the 300ms sleeps.
- In `world-character-state-generation.test.ts`, retain the provider blocker but collect returned job IDs and poll the documented world-job status until the third job reaches `completed` or `failed`. Delete the fixed 50ms settle wait. A bounded status poll is acceptable because it verifies the public job protocol; arbitrary settling time is not.

**Verify**: run both tests three consecutive times; every run passes.

### Step 4: Add direct export route coverage

Create one backend test file using a unique temp DB/config directory and a real ephemeral Express server. Cover:

- `POST /api/export`: invalid payload 400, unknown novel 404, TXT success with chapters sorted by `order`, EPUB success with a valid ZIP and escaped title/content.
- `GET /api/db/export-file`: initialized DB returns a readable SQLite snapshot containing current data; generated `.temp-export` files are removed after response completion; when DB is uninitialized but the configured DB file exists, fallback download succeeds; when neither initialized DB nor file exists, return 404.

Do not mock `db.backup()` for the happy path. It must exercise the real snapshot API with an isolated test DB. Never point at the user's production database.

**Verify**: `NODE_ENV=test node --test --test-concurrency=1 --test-timeout=45000 --import tsx tests/export-route.test.ts` passes.

### Step 5: Full verification and scope audit

Run the Commands table. Inspect `git diff --stat` and confirm only in-scope files changed. Commit in the isolated branch with message `test: close export and backend reliability gaps`.

## Done criteria

- [x] Backend test commands have explicit concurrency and timeout, without force-exit.
- [x] CI check job has a finite timeout.
- [x] Four fixed-path tests use unique temporary directories and restore environment values.
- [x] The two 300ms sleeps and the character-state 50ms settle sleep are absent.
- [x] Direct tests cover both export endpoints and real SQLite snapshot cleanup/fallback.
- [x] Focused tests, full backend tests, typecheck, lint and `git diff --check` pass.
- [x] Plan 144 changes stayed within the scoped files; unrelated pre-existing worktree changes were preserved.

## STOP conditions

- Any in-scope source differs materially from the Current state at committed `dff4445`.
- Real SQLite backup testing would require accessing the primary worktree DB.
- A test needs more than 45 seconds individually under normal local load.
- Fixing a failure requires production behavior changes in `server/routes/export.ts` or `server/routes/db.ts`.
- Verification fails twice after a scoped correction.

## Maintenance notes

- Keep export route and DB backup route tests separate in assertions even if they share one server fixture; they protect different user promises.
- A future test-runner hang should first report the timed-out test name and active path, not be “fixed” by adding force-exit.
- Direct component coverage remains deferred because the audit's exact count was inaccurate and no concrete regression justified a broad test-only rewrite.
