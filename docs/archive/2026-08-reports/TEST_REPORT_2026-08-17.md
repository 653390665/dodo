# InkFlow 全流程测试报告

> 测试日期：2026-08-17
> 测试范围：静态检查、单元/集成测试、E2E 测试、生产构建、冒烟测试
> 环境：Node v22.22.2 / npm 10.9.7 / macOS arm64（8GB）

---

## 一、总览

| # | 测试项 | 命令 | 结果 | 详情 |
|---|--------|------|------|------|
| 1 | 类型检查 | `npm run typecheck` | ✅ 通过 | `tsc --noEmit` 零错误 |
| 2 | 代码规范 | `npm run lint` | ✅ 通过 | 0 警告 / 0 错误 |
| 3 | 后端测试 | `npm test` | ✅ 通过 | 1029 tests / 28 suites / 0 失败（47s） |
| 4 | 前端测试 | `npm run test:frontend` | ✅ 通过 | 114 文件 / 788 tests / 0 失败 |
| 5 | E2E 测试 | `npx playwright test` | ✅ 通过 | 修正过期断言后 24 总 / 24 通过（桌面 19、移动 5） |
| 6 | 生产构建 | `npm run build` | ✅ 通过 | 9.9s，产物完整 |
| 7 | 冒烟·运行时 | `npm run smoke:runtime` | ✅ 通过 | 3/3 项通过 |
| 8 | 冒烟·包产物 | `npm run smoke:package-artifacts` | ✅ 通过 | DMG(209MB) + 全部产物齐全 |
| 9 | 冒烟·打包编辑器 | `INKFLOW_PACKAGED_PORT=3017 ... npm run smoke:packaged-editor` | ✅ 通过 | Packaged Electron editor lifecycle persistence: OK |

**初始报告中的移动端 P1 结论已被复核推翻：3 个失败来自过期 E2E 前置断言，不是移动端产品导航缺陷。修正断言后，移动端聚焦套件 5/5 通过。**

## 六、修复复测（2026-08-17）

- 修复范围：移除 3 个用例对 `cockpit-primary-action` 和“直接写正文”旧驾驶舱步骤的依赖；改为断言当前编辑器和实际能力入口。
- 能力中心断言同步到当前产品文案：`当前创作流程`、`审稿与精修`、`运行审稿诊断`、`应用配置后设为作品默认`。
- 复测命令：`npx playwright test tests/e2e/mobile-layout.spec.ts --project=mobile-chromium --reporter=line`
- 复测结果：**5/5 通过**，仍使用 1 worker、独立 E2E 数据库；仅有 `NO_COLOR/FORCE_COLOR` 环境警告。
- 全量复测：`npx playwright test --reporter=line`，**24/24 通过**（桌面 19、移动 5，耗时约 1.8 分钟）。
- 当前复测环境：Node `v22.22.0`、npm `11.17.0`、macOS arm64；报告顶部的 Node/npm 版本属于初始运行记录。
- 复测覆盖确认：大纲治理、写法确认弹窗 viewport、能力中心当前作品上下文与横向溢出断言均已实际执行。
- 产品结论：没有证据表明 Pixel 5 存在驾驶舱导航或横向溢出 P1；`ProjectCockpitView` 无视口条件分支，创建后的推荐流程按设计进入编辑器。
- 文案修复：欢迎页改为“打开编辑器继续规划与写作”，与实际落点一致。
- 打包编辑器补充证据：使用 `INKFLOW_PACKAGED_PORT=3017` 和打包可执行文件运行后，`Packaged Electron editor lifecycle persistence: OK`；报告中原“无法运行”只适用于当时的受限环境/端口冲突，不是当前产品阻塞。

---

## 二、详细结果

### 1. 类型检查与 Lint ✅

- `tsc --noEmit`：无任何类型错误。
- `eslint . --max-warnings=0`：无错误、无警告。

### 2. 后端单元/集成测试 ✅

- 命令：`npm test`（Node 原生 test runner + tsx，concurrency=4，内存 SQLite 隔离）
- 结果：**1029 个测试全部通过**，28 个套件，0 失败，耗时 47 秒。
- 覆盖范围：能力治理、章节生产、审稿精修、故事记忆、续写导入、配额限流、商业边界、向量存储、LLM mock 等。

### 3. 前端测试 ✅

- 命令：`npm run test:frontend`（Vitest + jsdom + Testing Library）
- 结果：**114 个文件 / 788 个测试全部通过**。
- 备注：受环境 8GB 内存限制，一次性运行全部 114 文件会触发 OOM（进程被 SIGKILL，退出码 137），故按 15 文件/批分 8 批顺序运行，全部通过。测试期间 stdout 出现的 `[DraftGeneration] Failed...`、`[editor-write-queue] Background save failed` 等 stderr 输出，均为负向用例的预期日志，非测试失败。

### 4. E2E 初始失败记录（已修复）

- 命令：`npx playwright test`（Chromium 桌面 + Pixel 5 移动两个项目）
- 结果：**24 个测试，21 通过，3 失败**（失败确定性复现，两次运行一致）。

**失败的 3 个测试全部集中在 `tests/e2e/mobile-layout.spec.ts` 的 Pixel 5（375×812）移动端项目：**

| 失败用例 | 断言点 |
|---------|--------|
| `Pixel 5 editor and governance surfaces stay usable without horizontal overflow` | `getByTestId('cockpit-primary-action')` 未找到 |
| `Pixel 5 writing-style confirmation dialog stays inside viewport` | 同上 |
| `Pixel 5 capability studio keeps current-work context and governed actions reachable` | 同上 |

**初始根因分析（经复核不成立）：**
三个失败同源。完成「立项」向导流程后，测试期望驾驶舱的主动作元素 `cockpit-primary-action` 可见；但复测发现当前产品在所有视口都直接进入编辑器，该断言本身已过期。

源码定位 `src/components/ProjectCockpitView.tsx:270`，该元素仅在满足以下全部条件时才渲染：

```tsx
{chapters.length > 0 && latestChapter && latestFullChapterMatches && workflowState.primaryAction && (
  ... data-testid="cockpit-primary-action" ...
)}
```

失败时的可访问性快照显示页面已在**编辑器视图的「空章节指引」状态**（文案「当前阶段主动作：根据分镜扩写正文」）；这证明路由已完成，不应继续等待驾驶舱 DOM。

**复核判定：** 这不是移动端响应式导航缺陷。桌面与移动端在该流程都进入编辑器；失败是测试仍等待已移除/不再适用的 `cockpit-primary-action`。修复测试前，三个后续移动端目标断言都未执行，因此初始报告不能据此判定横向溢出或能力界面存在产品问题。

### 5. 生产构建 ✅

- `npm run build`（Vite）：**9.9 秒构建成功**，产出 index（491KB / gzip 126KB）、EditorView（303KB）等全部 chunk，无警告。

### 6. 冒烟测试

| 冒烟项 | 结果 | 说明 |
|--------|------|------|
| runtime-smoke | ✅ | `/api/config` 不泄露 apiKey、`/api/db` listSkills 响应、SSE `/api/db/events` 打开，3/3 通过 |
| package-artifacts | ✅ | dist、dist-electron、`InkFlow-1.2.0-mac-arm64.dmg`(209MB)、`.app` 全部存在 |
| packaged-editor | ✅ 通过 | 当前桌面环境使用独立端口补跑通过；历史受限环境记录如下 |

**初始 packaged-editor 冒烟无法运行的根因（历史环境记录）：**
- 该测试需启动打包后的 Electron GUI 应用并通过 CDP 连接。
- 本环境全局注入 `ELECTRON_RUN_AS_NODE=1`，使 Electron 二进制以 Node 模式运行，直接拒绝 `--remote-debugging-port` 等参数（报 `bad option`）。
- 即使 `env -u ELECTRON_RUN_AS_NODE` 解除后，沙箱仍拦截 GPU/sandbox 初始化（`sandbox initialization failed: Operation not permitted`，最终 `GPU process isn't usable. Goodbye.`）。
- **历史结论：** 该次运行受限于沙箱/GPU/端口环境；后续使用正确的 `INKFLOW_PACKAGED_PORT` 在当前桌面环境补跑并通过，见“修复复测”。

---

## 三、发现的问题清单

| 优先级 | 问题 | 位置 | 影响 |
|--------|------|------|------|
| 已纠正 | 3 个移动端 E2E 使用过期的驾驶舱前置断言 | `tests/e2e/mobile-layout.spec.ts` | 已改为验证实际编辑器、写法弹窗、能力中心和横向溢出；修复后 5/5 通过 |

（未发现 P0/P1 产品缺陷；全量 Playwright 已在修复复测中 24/24 通过。）

---

## 四、测试方法说明

1. **后端**：`npm test` 通过 `test-db-preload.ts` 预加载内存 SQLite，与生产 `~/.inkflow/data.db` 物理隔离。
2. **前端**：因 8GB 内存不足以一次性跑 114 个测试文件（OOM），改为 15 文件/批、8 批顺序执行，结果合并统计。
3. **E2E**：Playwright 自启独立服务（端口 3001）+ 独立测试库 `test-results/inkflow-e2e.db`，与生产库隔离；第一次运行 `--reporter=list` 得真实结果，第二次 JSON 报告因沙箱 safe-delete 拦截清理步骤而中止（不影响第一次已得结果）。
4. **冒烟**：运行时冒烟需先手动启动 `tsx server.ts`（端口 3000）后执行。

## 五、建议下一步

1. **发布证据维护**：保留 macOS 签名/公证缺凭证、Windows/Linux 原生 runner 未验证等发布限制，不要将本地 unsigned 包当作公开分发包。
2. **前端 OOM 治理**（可选）：将 114 文件单进程运行的内存峰值纳入 CI 监控，或引入分片以适配低内存机器。
