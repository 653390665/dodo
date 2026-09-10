# InkFlow 测试审查报告

> 审查日期：2026-07-31
> 审查范围：后端 `tests/*.test.ts`（120 文件）、前端 `src/tests/*.test.ts(x)`（35 文件）、E2E `tests/e2e/`（1 spec）
> 审查方法：全量实跑 + 架构静态分析 + 覆盖缺口比对

---

## 一、测试运行结果

| 套件 | 测试数 | 通过 | 失败 | 跳过 | 耗时 | 命令 |
|------|--------|------|------|------|------|------|
| 后端 | 615 | 615 | 0 | 0 | 4m16s | `node --test --test-concurrency=1 --import tsx` |
| 前端 | 240 | 240 | 0 | 0 | 2m36s | `vitest run --maxWorkers=2` |
| E2E | — | — | — | — | 未跑 | Playwright（1 spec，需启动服务器） |
| Lint | — | — | — | — | — | `eslint . --max-warnings=0` 全绿 |
| TypeCheck | — | — | — | — | — | `tsc --noEmit` 零错误 |

**结论：全量测试在受控参数下全绿，代码质量门禁达标。**

---

## 二、P0 — 需立即修复

### P0-1：默认测试命令并发挂起（严重）

**现象**：`npm test`（默认 `node --test --import tsx tests/*.test.ts`，无并发限制）运行 18 分钟无输出、必须强杀。加 `--test-concurrency=1` 后 4 分 16 秒完成。

**根因**：多个测试文件使用硬编码固定 DB 路径（见 P0-2），并发执行时 SQLite 文件锁冲突导致挂起。

**影响**：CI 环境若不显式传 `--test-concurrency=1`，测试套件会无限挂起，阻塞所有流水线。

**修复建议**：
1. 将 `package.json` 的 `test` 脚本改为带 `--test-concurrency=1 --test-timeout=20000`。
2. 或修复 P0-2 的硬编码路径，使并发安全。

### P0-2：5 个测试文件硬编码固定 DB 路径

以下测试使用固定文件名（无 `Date.now()` / `pid` / `mkdtemp`），且写入 `tests/` 目录而非 `os.tmpdir()`，并发时必然冲突：

| 文件 | 行号 | 路径 |
|------|------|------|
| `tests/vector-store.test.ts` | 29 | `path.join(__dirname, 'test-vector-store.db')` |
| `tests/vector-store.test.ts` | 69 | `path.join(__dirname, 'test-vector-store-model.db')` |
| `tests/book-deconstruction-flow.test.ts` | 15 | `path.join(process.cwd(), 'tests', 'temp-deconstruct-integration.db')` |
| `tests/user-flows-integration.test.ts` | 33 | `path.join(process.cwd(), 'tests', 'temp-integration.db')` |
| `tests/config-saving-regression.test.ts` | 8 | `path.join(process.cwd(), 'tests', 'temp-config-test')` |

**修复建议**：统一改为 `fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-xxx-'))` + 唯一路径，并在 `after()` 中清理。

### P0-3：`server/routes/export.ts` 零测试覆盖

导出路由（124 行，负责小说/章节数据导出）没有任何测试引用。这是用户数据导出的关键路径，涉及文件流和 `db.backup()` 快照逻辑。

**修复建议**：新增 `tests/export-route.test.ts`，覆盖正常导出、空数据、DB 未初始化降级、临时文件清理。

---

## 三、P1 — 重要改进

### P1-1：全部后端测试使用文件型 DB，零 `:memory:`

120 个后端测试全部使用文件型 SQLite，搜索 `:memory:` 零匹配。约 20+ 处用 `tmpdir + Date.now()`、8 处用 `mkdtempSync`（最安全）。纯单元测试（如 `db-mappers.test.ts`、`vector-store.test.ts`）完全可以用 `:memory:`，更快且无 I/O flaky 风险。

### P1-2：定时器轮询导致的 flaky 风险

以下测试依赖固定时间等待或轮询 deadline，慢 CI 上可能不稳定：

| 文件 | 行号 | 风险 |
|------|------|------|
| `production-stream-disconnect.test.ts` | 177, 270 | 固定 `setTimeout(resolve, 300)` 等待 |
| 同上 | 97-104 | 2 秒 deadline 轮询 quotaReservations |
| `world-character-state-generation.test.ts` | 92-96 | 2 秒 deadline 轮询 |
| `pack-sync-integration.test.ts` | 93-103 | 100 次 × 10ms = 1 秒超时轮询 |

**修复建议**：用 `fake timers` 或事件驱动等待替代固定 sleep。

### P1-3：`process.env` 泄漏

- `config-saving-regression.test.ts:23,64` — 设置 `INKFLOW_ELECTRON_MODE` 但 `after()` 中设为 `'false'` 而非恢复原值。
- `user-flows-integration.test.ts:168` — 测试内设置但 `after()` 未恢复。

**修复建议**：`before()` 保存原值，`after()` 恢复。

### P1-4：约 23 个顶层组件无直接测试

37 个顶层组件中仅 14 个有直接测试引用。以下关键组件缺测试：

| 组件 | 行数 | 重要性 |
|------|------|--------|
| `WorldBibleView` | ~1397 | 高 — 世界观管理核心页 |
| `WritingSurface` | — | 高 — 核心编辑区 |
| `Library` | — | 高 — 书库列表页 |
| `AIAssistant` / `AIAssistantDrawer` | — | 中 — AI 对话 |
| `SkillsStudioView` | — | 中 — 技能工作室 |
| `BookFactoryView` | — | 中 — 制作工厂 |
| `ChapterSidebar` | — | 中 — 章节侧栏 |
| `TensionChart` / `PacingDashboard` / `ForeshadowingPanel` / `StoryContractPanel` / `IdeaFragmentBoard` / `ContinuationOverviewPanel` | — | 中 — 分析面板 |

> 注：部分组件可能通过父组件测试间接覆盖（如 EditorView 测试可能覆盖 EditorHeader/EditorModals 子组件），但核心页面级组件缺独立测试仍是风险。

---

## 四、P2 — 改进建议

### P2-1：断言质量总体良好

抽样 7 个文件，未发现 `toBeTruthy()` 占位、`expect(true).toBe(true)` 或空断言。`server-llm.test.ts` 用 `deepEqual` 检查完整请求结构；`pack-sync-integration.test.ts`（1609 行）含 179 处断言（密度 ~0.11/行，合理）。空 catch 块仅出现在 cleanup 代码中（`closeDb()` / `unlinkSync`），可接受。

### P2-2：Mock 模式合理

- 后端统一用 `globalThis.fetch` 覆写 + `try/finally` 恢复（40+ 处）。
- `continuation-database-generation.test.ts` 用 pass-through 区分本地 HTTP 和 LLM 调用，设计精巧。
- 前端用 `vi.stubGlobal('fetch')` + `afterEach(unstubAllGlobals)` 清理干净。
- `app-shell-novel-restore.test.tsx` mock 了 10+ 子组件，属 shell 集成测试的合理做法，未发现过度 mock。

### P2-3：测试隔离基础设施可统一

当前 DB 隔离模式有 4 种写法（`mkdtempSync` / `tmpdir+Date.now()` / `tmpdir+pid` / 固定路径），建议抽取统一 `createTestDb()` helper，消除重复并保证一致性。

---

## 五、数据安全基线

- 所有调用 `initDb()` 的测试都传了显式路径，默认回退 `~/.inkflow/data.db` 未被触发。
- `tests/e2e/global-setup.ts` 有注释明确 "NEVER touch ~/.inkflow/data.db"。
- E2E 配置使用独立 `test-results/inkflow-e2e.db`。
- **生产库无泄露风险。**

---

## 六、修复优先级路线图

| 阶段 | 内容 | 预期效果 |
|------|------|----------|
| 第一周 | P0-1 修 test 脚本 + P0-2 修 5 个硬编码路径 | CI 不再挂起，测试可安全并发 |
| 第一周 | P0-3 补 export 路由测试 | 关键导出路径有覆盖 |
| 第二周 | P1-1 抽取 createTestDb helper + 纯单元测试改 :memory: | 测试提速、隔离统一 |
| 第二周 | P1-2 修定时器 flaky + P1-3 修 env 泄漏 | CI 稳定性提升 |
| 第三-四周 | P1-4 补核心组件测试（WorldBibleView / WritingSurface / Library 优先） | 组件覆盖提升 |
