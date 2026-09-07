# InkFlow Beta Release Readiness Report (发布就绪状态报告)

本报告记录 InkFlow Beta 发布门禁状态。本地应用门禁和真实 Provider 连接已验证；macOS arm64 可生成本地测试包，但正式分发仍被 Apple 签名/公证凭证阻塞，Windows/Linux 仍需原生 runner 验证。

> **证据时效性**：下方历史报告只记录当时的验证结果，不能作为当前 commit/SHA 的发布证据。每次候选发布必须填写并保存一份绑定当前 SHA 的 Release Evidence。

## Current Release Evidence (2026-08-17 UTC)

- Candidate/version: InkFlow Beta controlled candidate
- Base commit SHA: `f4eac24`
- Candidate source state: dirty worktree; the exact candidate cannot be identified by commit SHA until the existing in-progress changes are reviewed and committed.
- Worktree scope: this release pass adds macOS signing/notarization configuration, Linux packaging/CI contracts, their focused tests, and this evidence update. Existing unrelated changes were preserved.
- Environment: Darwin arm64, Node.js `v22.22.0`
- Commands executed:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `npm test`
  - `npm run test:frontend`
  - `npx playwright test --project=chromium`
  - `npm run package`
  - `npm run smoke:package-artifacts`
  - `INKFLOW_PACKAGED_PORT=3017 INKFLOW_PACKAGED_EXECUTABLE="$PWD/release/mac-arm64/InkFlow.app/Contents/MacOS/InkFlow" npm run smoke:packaged-editor`
  - `POST /api/config/test-connection` against the configured Provider (credentials redacted)
  - `git diff --check`
- Results:
  - TypeScript typecheck: exit 0.
  - ESLint: exit 0.
  - Vite build: exit 0 (`2116 modules transformed`).
  - Node tests: exit 0 (`1029/1029`).
  - Frontend tests: exit 0 (`114 files, 788/788`).
  - Desktop Chromium E2E: exit 0 (`19/19`).
  - macOS arm64 package: exit 0; DMG, blockmap, and packaged executable generated.
  - Package artifact contract: exit 0.
  - Packaged Electron editor lifecycle: exit 0; content persisted across close and relaunch.
  - Real Provider connection/model probe: HTTP success; `connectionOk: true`, `selectedModelValid: true`, `modelTested: true`, response `OK`.
  - Diff whitespace check: exit 0.
- Isolation: Playwright uses one worker, port 3001, and the isolated `test-results/inkflow-e2e.db`; no production `data.db` was modified.
- Known test-environment warnings: embedding/model fallback and missing-provider errors are expected degradation paths and are covered by passing tests.
- Platform package verification:
  - macOS arm64: current dirty worktree packaged locally and passed the packaged-editor lifecycle smoke.
  - Windows x64: build configuration and native GitHub Actions job exist, but this worktree has not run on a Windows runner.
  - Linux x64: AppImage configuration, strict artifact check, packaged-editor smoke step, and native GitHub Actions job are present; no Linux runner evidence exists yet. The current Darwin host has no Docker Desktop/daemon.
- Signing/notarization status: `hardenedRuntime`, entitlements, and CI credential wiring are configured. The local build found `0 valid identities`, skipped signing, and produced no notarization ticket. Formal macOS distribution remains blocked on a Developer ID Application certificate and Apple notarization credentials.
- Artifacts:
  - `release/InkFlow-1.2.0-mac-arm64.dmg`: SHA-256 `4b4b1d2fd8c381a2b74fa84098981ca8badb03f10c879f892b54f071fa478f16`
  - `release/InkFlow-1.2.0-mac-arm64.dmg.blockmap`: SHA-256 `0b250c44911ae1b52794ceff10fef5cb0227923b9965ee65317fc92c31e0de9d`
- Real Provider/API key verification: passed through the authenticated local API without printing or persisting credentials; Provider host `api.deepseek.com`, model `deepseek-v4-flash`, prompt guard `strict`.
- Release decision: not ready for cross-platform public distribution. macOS signed/notarized evidence and current-source Windows/Linux native-runner evidence are still required.
- Reviewer: Codex

## Historical Release Evidence (2026-08-11 UTC)

## Task 15 Journey Evidence (2026-08-15)

- Scope: `unified-creation-new-project.spec.ts` and `unified-creation-imported-project.spec.ts`.
- Tested code commit SHA: `0befbcf` (docs-only follow-up does not change runtime code).
- Isolation: Playwright uses one worker, port 3001, and `test-results/inkflow-e2e.db`; provider boundaries are route-mocked.
- Coverage: new-project governance, capability routing, outline/scene/prose acceptance, completion risk and facts, next chapter; imported Canon protection, character/outline candidates, fact confirmation, and `unknown` provider manual-writing degradation.
- Results: `npm run typecheck` exit 0; `npm run lint` exit 0; `npm test` exit 0 (`1007/1007`); `npm run test:frontend` exit 0 (`745/745`); `npm run build` exit 0; focused frontend regression exit 0 (`44/44`); focused Playwright exit 0 (`3/3`); `git diff --check` exit 0.
- Known warnings: Playwright emits the existing `NO_COLOR`/`FORCE_COLOR` warning; no-API-key embedding/model fallback warnings are expected in isolated tests.

- Candidate/version: Beta stabilization baseline
- Tested code commit SHA: `e851ca7`
- Note: 本节记录当前代码候选的本地验证；后续 docs-only commit 不改变运行代码与打包产物。
- Verification date (UTC): `2026-08-11 17:18:45 UTC`
- Environment: `Darwin arm64`, Node.js `v22.22.0`
- Commands executed:
  - `npm run typecheck`
  - `npm run lint`
  - `npm audit --omit=dev`
  - `npm run test:frontend -- --run src/tests/writing-style-control.test.tsx`
  - `npm test`
  - `npm run test:frontend`
  - `npx playwright test --project=chromium`
  - `npm run package`
  - `npm rebuild better-sqlite3 --build-from-source`
  - `RUNTIME_ROOT="${TMPDIR:-/tmp}/inkflow-runtime-smoke-e851ca7-$$"; mkdir -p "$RUNTIME_ROOT/config"; PORT=3020 INKFLOW_ENABLE_DEV_AUTH_TOKEN=true INKFLOW_DB_PATH="$RUNTIME_ROOT/runtime.db" INKFLOW_CONFIG_DIR="$RUNTIME_ROOT/config" npx tsx server.ts`
  - `INKFLOW_BASE_URL=http://127.0.0.1:3020 npm run smoke:runtime`
  - `INKFLOW_PACKAGED_PORT=3017 INKFLOW_PACKAGED_EXECUTABLE="$PWD/release/mac-arm64/InkFlow.app/Contents/MacOS/InkFlow" npm run smoke:packaged-editor`
- Results and exit codes:
  - `npm run typecheck`: exit 0.
  - `npm run lint`: exit 0.
  - `npm audit --omit=dev`: exit 0, 0 vulnerabilities.
  - `writing-style-control` frontend target: exit 0, 1 file passed / 4 tests passed.
  - `npm test`: exit 0, 874 pass / 0 fail / 0 cancelled.
  - `npm run test:frontend`: exit 0, 101 files passed / 620 tests passed.
  - Desktop Chromium Playwright: exit 0, 15 passed.
  - `npm run package`: exit 0, generated `release/InkFlow-1.2.0-mac-arm64.dmg`, `release/InkFlow-1.2.0-mac-arm64.dmg.blockmap`, and `release/mac-arm64/InkFlow.app`; package artifact smoke passed.
  - `npm rebuild better-sqlite3 --build-from-source`: exit 0, restored Node ABI after Electron package rebuild.
  - Isolated runtime server on `127.0.0.1:3020`: started with temp DB/config; Vite websocket warned that `24678` was already in use, HTTP server remained available.
  - `npm run smoke:runtime`: exit 0, config redaction, `listSkills`, and authenticated DB SSE all opened successfully against `http://127.0.0.1:3020`.
  - Packaged editor lifecycle smoke: exit 0, editor content persisted after packaged app close/relaunch.
- CI run / artifact links: 未执行，本轮为本地验证。
- Platform package verification: macOS arm64 本地 DMG 已打包并通过 packaged editor lifecycle smoke；Windows/Linux 未执行。
- Artifacts:
  - macOS arm64 DMG: `release/InkFlow-1.2.0-mac-arm64.dmg` (`216M`)
  - macOS arm64 blockmap: `release/InkFlow-1.2.0-mac-arm64.dmg.blockmap` (`233K`)
- SHA-256:
  - macOS arm64 DMG: `05d180914aa2bca17a3ba897eb27fc430d728b52fae58a82648b8d7d8fc8bf1e`
  - macOS arm64 blockmap: `bd7f1d55882181008308c29a879f57cfb17729cc50986ce320fcaeaaeddf6733`
- Signing/notarization status: 未执行；本地 macOS 打包配置 `identity: null`，未签名、未公证。
- Known limitations or unverified platforms:
  - 未执行移动端 Playwright；桌面 Chromium 已全量执行。
  - 未验证 Windows/Linux 包、签名、公证、真实 Provider/API Key、移动端。
  - 移动端不作为本轮 Beta 验收范围。
- Reviewer: Codex

## Release Evidence 模板

复制以下模板，为每个候选发布填写实际结果；未执行的项目必须标记为 `未执行`，不得以历史报告代替。

```text
Release Evidence
- Candidate/version:
- Tested code commit SHA:
- Note:
- Verification date (UTC):
- Environment (OS, architecture, Node.js):
- Commands executed:
  - npm ci
  - npm run typecheck
  - npm run lint
  - npm run build
  - npx playwright test
  - [other release checks]
- Results and exit codes:
- CI run / artifact links:
- Platform package verification:
- Artifacts:
- SHA-256:
- Signing/notarization status:
- Known limitations or unverified platforms:
- Reviewer:
```

## 总览

| 验证日期 | 核心能力 | 已知限制 |
|----------|----------|----------|
| 2026-08-09 | 本地作品/设定/章节编辑；SQLite WAL 原生 `backup()` 一致性快照与导出恢复；AI 失败输入恢复、显式重试和本地指标；能力治理与报告 stale 处理 | AI 依赖外部 API Key 和网络；macOS 包未签名且使用默认图标；Windows 包未在本轮重验 |

---

## 1. 核心可用功能 (Core Capabilities)

当前版本已经实现并精细润色了长篇网文大纲、设定与协同写作的所有核心链路：

- **作品驾驶舱 (ProjectCockpitView)**: 
  - 支持多卷级、多章管理。
  - 智能行动决策推荐引导（自动根据当前作品状态推荐“创建首章”、“精修局部润色”、“作品深度审计”）。
  - 精美的 OKLCH 渐变视觉设计，与上下文完全自适应。
- **微光引导系统 V1 (User Guidance)**:
  - 针对**新用户/空状态**在 WelcomeView、ProjectCockpitView 及 EditorView 智能渲染微动效新手引导 Banner（支持 localStorage 状态持久化，不污染数据库结构）。
- **协同编辑器 (EditorView)**:
  - 支持全屏沉浸、卡片/行内高亮及右侧辅助大纲。
  - 行内精修润色、段落续写大图景完美拼装。
- **一致性数据保护**:
  - schema 初始化完成后使用 SQLite 原生 `backup()` 建立 `.db.bak` 一致性快照。
  - 网页端支持一键下载 SQLite 一致性事务快照，杜绝 WAL 缓存丢失。
  - 支持 `.db` 恢复覆盖，附带上传魔术字校验与原子回滚容灾守卫。
- **三态 LLM 诚实降级 (Tri-State API Fallback)**:
  - 密钥和连接检测机制支持 `'unknown'` 第三态。
  - 在断网、异常或未配置时展示琥珀色指示器与温和的本地编辑/保存指导；模型生成仍需外部 API Key 与网络，杜绝盲目乐观伪装连接。

---

## 2. 已知限制与暂不处理项 (Known Limitations & Deferred Items)

为了专注于高质量的主路径收口，我们对以下内容进行了**Backlog 冻结**，将不在本轮测试版中处理，后续版本逐步迭代：

| 模块 / 任务 ID | 类型 | 当前状态 / 限制说明 | 替代/降级策略 |
| :--- | :--- | :--- | :--- |
| **083 / Live API** | 接口对接 | 暂不引入，等待公网 API 接入后，再开启单独的对接任务。 | 无模型连接时保留本地编辑、保存和设定管理，并明确提示生成不可用。 |
| **103-108** | 功能扩张 | 已进行归档冻结，不在本轮 Beta 中做任何实现。 | 保证现有作品写作大纲与编辑主干高度稳定。 |
| **依赖安全** | 已验证 | `npm audit --omit=dev` 为 0；Electron 43、`better-sqlite3`、`sharp 0.35.3` 已通过 macOS arm64 package 与 lifecycle smoke。 | 其他平台仍需各自运行原生 ABI 与打包验证。 |
| **助手失败闭环（Plans 145–147）** | 已完成 | 空响应三分类、共享 SSE parser、失败占位清理、可恢复 session 和本地指标均已闭环。 | 真实 Provider 可用性仍取决于用户配置、网络和上游服务。 |
| **超大模块拆分** | 性能/重构 | 暂不进行，留待后期做微服务或进程解耦。 | 当前模块内部已进行最大解耦，状态下沉到位。 |
| **全量前端日志治理** | 观测性 | 仅处理了高频警告，未执行全面的统一遥测上报重构。 | 开发环境下保留标准控制台输出，轻量可靠。 |

---

## 3. 门禁审计与验证结果 (Release Gatekeeping Results)

为了保障代码质量，我们执行了严格的“质量三层门”。结果如下：

1. **类型安全检查 (`npm run typecheck`)**：
   - 结果：**通过**，exit 0。
2. **格式与 Lint 校验 (`npm run lint` & `npm run lint:any`)**：
   - 结果：`npm run lint` 与 `npm run lint:any` **通过**；explicit any 为 31/35 预算。
3. **后端与逻辑单元测试 (`npm test`)**：
   - 结果：**798 / 798 通过**。
4. **前端组件交互测试 (`npm run test:frontend`)**：
   - 结果：**475 tests 通过**。
     - API 密钥/网络 `'unknown'` 琥珀色降级 banner；
     - 首次进入 Welcome 新手引导关闭 localStorage 状态持久化；
     - 驾驶舱空章引导与 Editor 智能决策跳转的行动闭环；
     - SettingsModal 管理选项卡数据一键下载交互。
5. **生产包构建编译 (`npm run build`)**：
   - 结果：本轮 Vite build **通过**；macOS arm64 Electron package 和 packaged-editor lifecycle persistence 于 2026-08-08 验证通过。
6. **Playwright 核心旅程**：
   - 结果：Plan 150 Chromium **5 / 5**、Pixel 5 **4 / 4** 通过，含可靠性专项旅程。
7. **依赖安全审计 (`npm audit`)**：
   - 结果：`npm audit --omit=dev` **0 vulnerabilities**；macOS arm64 原生 ABI 与 packaged-editor smoke 已通过。
8. **Coverage（2026-08-08）**：
   - 后端 coverage：lines **91.40%** / branches **81.56%** / functions **87.31%**，超过 90/80/85 门槛。
   - 前端 coverage：**43.33% / 36.29% / 35.97% / 45.58%**（按当前 coverage 报告四项顺序）。
   - 前端覆盖率当前仅作报告，不作为阻断门槛；助手失败恢复、数据库导出、作品切换竞态和自动精修失败路径有定向回归。

---

## 4. 试用建议与反馈导向 (Beta Feedback Guidelines)

Beta V1.0 已满足本地受控试用门禁。发布前仍应在目标平台复核签名、安装和真实 Provider：
1. **作品生命周期**：从「创建作品」-「大纲构建」-「行动决策推荐」-「进入写作」-「润色和深度审计」的完整闭环。
2. **容灾测试**：在写作过程中随时通过「设置」-「数据备份」下载备份，并尝试上传错误的非 db 文件验证回滚系统。
