# Plan 217: @xmldom/xmldom 钉版——解阻 CI 依赖审计门（DEPS-01/SEC-01）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat d6c2ed2..HEAD -- package.json package-lock.json .github/workflows/build.yml tests/continuation-extraction-failure.spec.ts`
> 并运行 `npm audit --omit=dev 2>&1 | tail -3`——若已无 high，说明上游已修或已有人处理，本计划可直接核销。

## Status

- **Priority**: P1（CI 审计门已实际变红：下次 push main 必挂）
- **Effort**: S-M
- **Risk**: MED（xmldom 0.8→0.9 有 breaking change，需 docx 导入回归护航）
- **Depends on**: none
- **Category**: deps/security
- **Planned at**: commit `d6c2ed2`, 2026-09-15（发现：improve 四路审计 DEPS-01/SEC-01）

## Why this matters

`npm audit --omit=dev` 现报 **1 high**：`@xmldom/xmldom@0.8.13`（8 条公告：XML 注入、ReDoS、二次方内存消耗）。两条引入路径中 `mammoth@1.12.0 → @xmldom/xmldom@0.8.13` 是**运行时可达**的——`server/routes/continuation.ts:1128` 动态 import mammoth 解析用户上传的 .docx。同时 `.github/workflows/build.yml:39` 的审计豁免表为空（`const exemptions = {};`，注释 "Empty as of 2026-09"），`:56-57` 命中未豁免漏洞即 `exit(1)`——**下一次 push main，CI 的 "Audit production dependencies" 步骤必失败**。mammoth 最新版（1.12.3）仍 pin `@xmldom/xmldom ^0.8.6`，升级 mammoth 修不掉。

## Current state（2026-09-15 亲读核实，锚点基于 `d6c2ed2`）

- `package.json:91-97` overrides 已有同模式先例：`"@huggingface/transformers": { "sharp": "^0.35.4" }`、`nanoid`、`postcss`、`tar`。
- `.github/workflows/build.yml:39` 豁免表结构支持带到期日的豁免条目（注释要求 "Add entries only with an expiry date and a plan"）。
- docx 导入测试基线：`tests/continuation-extraction-failure.spec.ts`（E2E）与 tests/ 下资料导入用例。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 审计 | `npm audit --omit=dev 2>&1 | tail -3` | 0 high |
| docx 回归 | `npm test`（tests/ 下资料导入相关）+ `npx playwright test tests/e2e/continuation-extraction-failure.spec.ts` | 全绿 |

## Scope

**In scope**：

- `package.json` overrides 增 `"@xmldom/xmldom": "^0.9.x"`（首选）或 build.yml 带到期日豁免（回退）
- docx 导入回归验证

**Out of scope**：

- Electron-builder→plist 的构建期 xmldom 路径（不在 production audit 分母）
- mammoth 替换选型

## Steps

### Step 1: overrides 钉 ^0.9

package.json overrides 加条目，`npm install` 重算 lockfile，`npm ls @xmldom/xmldom` 确认双路径都到 0.9.x。

**Verify**: `npm audit --omit=dev` → 0 high；`npm test` 中资料导入用例绿

### Step 2: docx 导入回归

跑 E2E continuation-extraction-failure + 手工冒烟（上传一份真实 .docx 走资料续写导入）。

**Verify**: 全绿；若 mammoth 与 0.9 不兼容（导入解析报错/结果异常）→ 走回退

### Step 3（回退路径，仅 Step 2 失败时）: 带到期日豁免

build.yml 豁免表加条目（30 天到期 + 指向升级计划），CI 恢复绿；台账注明升级债务。

**Verify**: 本地模拟 CI 审计步骤通过

## Done criteria

- [ ] `npm audit --omit=dev` 0 high（override 生效）或豁免带到期日入账
- [ ] docx 导入回归绿；台账落账

## STOP conditions

- overrides 后出现非 docx 面的功能回归 → 停止，改走豁免路线并单独排查。
