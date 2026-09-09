# Plan 191: 文档与 DX 修复——README 失实宣称、死链、账目双头、pre-commit、format 门、env 清单、根目录归档

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 0dfbbcf..HEAD -- README.md PRD.md PRD_V2.md DESIGN.md .github/workflows/build.yml scripts/pre-commit.sh package.json docs/`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs + dx
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

文档是本仓库的「真相之源」体系（README 自我声明「当前产品定位以本 README 为准」、MEMORY/TOOLS 指定账本权威），但当前：

1. README:238 宣称「全局 Cmd/Ctrl+K 搜索」——功能不存在（快捷键表无此项、无搜索面板）；Cmd+Z 宣称在 Plan 173 修复前也是失实的。
2. 三处权威文档链接指向已迁 archive 的文件（README:35、PRD.md:3、PRD_V2.md:3）。
3. 计划账目双头：`plans/README.md` 与 `docs/plans/README.md` 均自称唯一权威；`docs/plans/chapter-pdf-export.md` 标「待实施」但导出 PDF 已上线（EditorStatusBar.tsx:143）。
4. DESIGN.md 暗色 muted 令牌（0.52）与实现（0.62，AA 对比度故意提亮）漂移。
5. pre-commit 未版本化、未自动安装、依赖坏掉的 npx/npm；`--no-verify` 日常化。
6. prettier 不覆盖 server/、shared/、scripts/；CI 无 format 门。
7. `.env.example` 仅 3 个变量 vs 实际 15+ 个 INKFLOW_* 运行时变量无文档。
8. 根目录 9+ 份历史评估报告（含 0.9MB HTML/PDF）违反 `docs/README.md:19-20` 自己定的规则。

## Current state

关键摘录：

```md
<!-- README.md:238 -->
- **键盘快捷键**：全局 `Cmd/Ctrl+K` 搜索，编辑器支持 `Cmd/Ctrl+Z` 撤销 / ...
<!-- README.md:35 -->
完整边界见 [权益与商业化边界](docs/monetization-boundary.md)   ← 实际在 docs/archive/
```

```md
<!-- PRD.md:3 / PRD_V2.md:3 -->
...以 `README.md` 和 `docs/release-readiness.md` 为准   ← 实际在 docs/archive/
```

```md
<!-- docs/plans/chapter-pdf-export.md:3 -->
> 状态：待实施   ← 但 src/components/EditorStatusBar.tsx:147 已有「导出 PDF」按钮（src/lib/pdf-export.ts）
```

```md
<!-- DESIGN.md:24（暗色表）-->
| `theme-muted` | `oklch(0.52 0.005 60)` | Secondary text |
<!-- src/index.css:31-32（实现）-->
/* Lifted from 0.52: muted text must clear AA (4.5:1) against theme-bg at 9-11px */
--color-theme-muted: oklch(0.62 0.005 60);
```

```bash
# scripts/pre-commit.sh:3-4 — 手工安装、依赖 npx/npm
# Install: cp scripts/pre-commit.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
npx eslint $STAGED_TS --max-warnings=0
npm run typecheck
```

```jsonc
// package.json:25 — format 覆盖面缺口
"format": "prettier --write \"src/**/*.{ts,tsx,css,json}\" \"server.ts\""
// .env.example 仅 API_KEY/API_BASE_URL/API_MODEL 三个
```

运行时 env 全集（grep `process.env.INKFLOW_` 与已知项）：INKFLOW_FIXED_PORT、INKFLOW_ENABLE_DEV_AUTH_TOKEN、INKFLOW_VALIDATION_DEBUG、INKFLOW_SECURE_API_KEY、INKFLOW_DB_PATH、INKFLOW_CONFIG_DIR、INKFLOW_WRITER_TIMEOUT_MS、INKFLOW_WRITER_MODEL、INKFLOW_ENABLE_MONETIZATION 等（执行时以 `grep -rn "process.env" server/ server.ts --include="*.ts" | grep INKFLOW` 的结果为准）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck`（或 `node node_modules/typescript/bin/tsc --noEmit`） | exit 0 |
| 全量测试 | `npm test`、`npm run test:frontend` | 全绿 |
| Format 校验 | `npx prettier --check <新覆盖 glob>`（npm 坏时 `node node_modules/prettier/bin/prettier.cjs --check ...`） | exit 0 |

## Scope

**In scope**：

- `README.md`、`PRD.md`、`PRD_V2.md`、`DESIGN.md`、`docs/README.md`
- `docs/plans/chapter-pdf-export.md`（状态关账）
- `scripts/pre-commit.sh`、`package.json`（prepare 脚本 + format glob）
- `.env.example`（注释块文档化）
- 根目录历史报告的 `git mv` 归档
- `.github/workflows/build.yml`（追加 prettier --check 步骤）

**Out of scope**：

- 修复本机 npm 安装（系统级，超出仓库边界；pre-commit 的 node 直调改造正是为此兜底）
- PRODUCT.md / AGENTS.md 内容修订（无失实证据）
- 历史报告内容修订（归档保留原样）

## Git workflow

每类一次提交；消息如 `docs: fix dead links to archived boundary docs`；完成即提交，不 push。

## Steps

### Step 1: README 失实宣称与死链

1. `README.md:238`：删除「全局 `Cmd/Ctrl+K` 搜索」短语（Plan 194 spike 落地后再加回）；Cmd+Z 部分核对 `src/lib/keyboard-shortcuts.ts` 现状后保留。
2. `README.md:35` 链接改 `docs/archive/monetization-boundary.md`；`PRD.md:3`、`PRD_V2.md:3` 的 `docs/release-readiness.md` 改 `docs/archive/release-readiness.md`（或把两份文档移回 `docs/` 活跃区——若其内容仍被视为现行边界文档则移动并在 `docs/README.md` 登记；二选一，默认改链接保守处理）。

**Verify**: `grep -n "Cmd/Ctrl+K" README.md` 无命中；`for f in docs/monetization-boundary.md docs/release-readiness.md; do test -e $f || echo "broken: $f"; done` 输出为空或链接已指向 archive 实际路径

### Step 2: 账目双头与 PDF 计划关账

1. `docs/plans/chapter-pdf-export.md:3` 状态改「✅ 已交付（EditorStatusBar 导出 PDF，src/lib/pdf-export.ts）」。
2. `plans/README.md` 头部注（本计划执行者补一行）：「历史轮次账目（1–29 轮，计划 001–171）。当前能力卡整合轮见 `docs/plans/README.md`；2026-09-10 起的第 30 轮起（2026-09-10）新计划以 173+ 登记于本表。」（若主会话已写入则跳过。）

**Verify**: `grep -n "待实施" docs/plans/chapter-pdf-export.md` 无命中

### Step 3: DESIGN.md 令牌对齐

`DESIGN.md:24` 暗色 `theme-muted` 改 `oklch(0.62 0.005 60)`，并在该表格下方 Rules 区补一行：「muted 从 0.52 提亮至 0.62 以满足 AA（4.5:1）对比度（2026-08 前后的对比度修复，见 src/index.css 注释）」。逐格核对暗色表其余令牌与 `src/index.css:26-35` 一致（亮色表同样抽查）。

**Verify**: `grep -n "0.52 0.005 60" DESIGN.md` 无命中（暗色表）

### Step 4: pre-commit node 直调改造 + 自动安装

1. `scripts/pre-commit.sh` 改为不依赖 npm/npx：

```bash
ESLINT="./node_modules/eslint/bin/eslint.js"
TSC="./node_modules/typescript/bin/tsc"
[ -x "$ESLINT" ] || { echo "[pre-commit] node_modules missing"; exit 1; }
if [ -n "$STAGED_TS" ]; then
  node "$ESLINT" $STAGED_TS --max-warnings=0
fi
node "$TSC" --noEmit
```

2. `package.json` 加 `"prepare": "cp scripts/pre-commit.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit || true"`（`|| true` 防非 git 环境安装失败阻断 install；注释写进脚本头部）。
3. MEMORY.md 是未跟踪文件不动；在 `docs/README.md` 或 README 开发节补一句「本机 npm 损坏时验证门用 node 直调（见 scripts/pre-commit.sh）」。

**Verify**: `bash -n scripts/pre-commit.sh` 语法通过；`grep -n "prepare" package.json` 命中

### Step 5: format 覆盖面 + CI format 门

1. `package.json` format script 扩为：`"prettier --write \"src/**/*.{ts,tsx,css,json}\" \"server/**/*.{ts,json}\" \"shared/**/*.{ts,json}\" \"scripts/**/*.mjs\" \"server.ts\" \"*.{ts,mts}\""`（以仓库实际文件面微调；`*.{ts,mts}` 覆盖 server.ts/env-bootstrap.ts 等）。
2. 首次全量 format **独立提交**（大 diff 隔离）。
3. `.github/workflows/build.yml` check job 在 lint 步骤后加 `- run: npx prettier --check "src/**/*.{ts,tsx,css,json}" "server/**/*.ts" "shared/**/*.ts" "server.ts"`。

**Verify**: `npx prettier --check "server/**/*.ts"` exit 0；typecheck/测试全绿（格式化不改语义）

### Step 6: env 清单文档化

`.env.example` 追加注释块：逐个列出 Step「Current state」grep 到的 INKFLOW_* 变量，含用途、默认值、覆盖顺序说明（env 只是初始默认，应用内配置 `~/.inkflow/config.json` 落库后优先——`server/lib/config.ts` 的加载顺序为准）。README 安装节同步一句指向 `.env.example`。

**Verify**: `grep -c "INKFLOW_" .env.example` ≥ 8

### Step 7: 根目录报告归档

```bash
git mv InkFlow_产品体验审计报告.md InkFlow_产品体验审计报告.html InkFlow_产品体验审计报告.pdf \
       InkFlow墨影_横纵分析报告.md InkFlow墨影_横纵分析报告.html InkFlow墨影_横纵分析报告.pdf \
       PRODUCT_EVALUATION_2026-08-09.md PRODUCT_DEEP_EVALUATION_2026-08-15.md \
       PROJECT_EVALUATION_2026-08-09.md TEST_AUDIT_REPORT.md TEST_REPORT_2026-08-17.md \
       implementation_plan.md docs/archive/2026-08-reports/
```

`docs/README.md` 的 archive 节加一行索引。`MEMORY.md`/`TOOLS.md` 未跟踪，不动。`.github/build-trigger-20260708-001.txt` 若仍存在且确认无消费者（`grep -rn "build-trigger" .github/ .github/workflows/`），一并 `git mv` 归档或删除（删除需在报告中注明）。

**Verify**: `ls *.md | grep -E "EVALUATION|审计|横纵|TEST_"` 无命中；typecheck/测试全绿（归档不影响构建）

## Test plan

文档/配置改动以 grep 验证为主；Step 5 的首次全量 format 后必须跑 `npm run typecheck`、`npm test`、`npm run test:frontend` 确认零语义变化。

## Done criteria

- [ ] 所有 Step 的 Verify 命令通过
- [ ] typecheck、前后端测试全绿
- [ ] 根目录无历史评估报告残留
- [ ] `git status` 无 in-scope 之外的改动
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- `docs/release-readiness.md` 被其他活跃代码/脚本路径引用（不只是文档链接）——移动方案需重新评估。
- 首次全量 format 导致任何测试失败——回退 format 提交，报告 diff 中可疑文件。
- `prepare` 钩子在某些 CI 环境造成 install 失败（无 bash）——改用 `|| true` 兜底仍失败则 STOP。

## Maintenance notes

- 评审关注点：本计划是「让真相之源重新可信」——后续所有审计/计划都依赖 README/账本的准确性。
- Plan 194（Cmd+K spike）落地后记得回填 README:238 与快捷键列表（Plan 175 的 SettingsModal 列表）。
- 根目录规则（docs/README.md 维护规则 1/2）以后由评审执行：新报告直接进 `docs/archive/<日期>-*/`。
