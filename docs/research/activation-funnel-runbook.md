# 激活漏斗复测 Runbook（Plan 262 E6）

> 目的：把「产品激活漏斗」从一次性 scratch 脚本变成**可复跑、可复核**的固定动作（离线读导出 JSON，不碰数据库文件）。
> 背景：2026-09-22 的复测发现旧账本读数（`docs/plans/README.md:65` / `002` / `008` 的
> `editor_enter 152 → first_content_input 0 → draft_accept 1`）与事实不符，并在量测过程里查出三处埋点口径缺陷；
> 三处已修（提交 `d2e9b4f`，2026-09-24），本 runbook 是修复后的复测入口。

## 为什么要固定口径

- 旧读数被当成「产品 P0（用户开始写了 0）」的依据，实际是**工具口径错**（`editor_enter` 被 dev 热重载放大、
  `writing_style_required` 只在挂载期去重、`first_content_input` 只在「空章节首次有内容」时触发）。
- 口径分散在一次性脚本里 = 下次复测要重新发明；且结论无法被旁人复核。

## 前置条件

- 本地实例在跑（`npm run dev`）。dev 环回令牌端点需 `INKFLOW_ENABLE_DEV_AUTH_TOKEN=true`。
- **不得**用 sqlite 客户端直接读 `~/.inkflow/data.db`（AGENTS.md + `docs/specs/sqlite-backup.md`：运行中禁物理拷贝；
  读取一律走应用自身端点）。

## 步骤

```bash
# 1) 取本机令牌（仅 loopback 可用）
TOKEN=$(curl -s http://127.0.0.1:3000/api/dev-auth-token | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')

# 2) 导出事件（保留窗 90 天，导出件不要入库/入库前脱敏）
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://127.0.0.1:3000/api/product-events/export?days=90' -o /tmp/inkflow-events.json

# 3) 出报告（口径与 /api/product-events/metrics 同源：复用纯函数 buildProductEventMetrics）
npx tsx scripts/report-activation-funnel.ts /tmp/inkflow-events.json --days=90
```

报告包含：采样（事件 / 去重作品 / 去重会话 / 时间范围 / 修复前事件条数）、北星、激活漏斗（作品口径 + 会话口径）、
能力链路、逐事件（事件 / 作品 / 会话）、判读纪律。

## 口径与断点（重要）

| 项 | 语义 | 陷阱 |
|---|---|---|
| `editor_enter` | 每次进入编辑器/刷新都上报 | dev 热重载会放大：判读优先看**会话口径** `editorEntrySessions` |
| `first_content_input` | 任意章节首次真实手输（2026-09-24 起放宽；此前仅「空章节首次有内容」） | 旧值**系统性低估**「开始写作」；新旧数据不得合并 |
| `writing_style_required` | 按 `writing-style-required:{novelId}:{fingerprint}` 认领 | 修复前按组件挂载期去重（313 条 → 实际 19 个指纹） |
| `distinctObjectIds` | 有 `objectId` 的不同对象数 | **不是事件条数**（旧字段名 `sampleSize` 易误读） |
| 北星 `acceptedChapters` | `draft_accept` 且 `result==='success'` 的**去重 chapterId** | 不要用事件条数代替 |
| 北星 `activeNovels` | 任一 `result==='success'` 事件的去重 `novelId` | 与「有账号的作品数」不同 |

## 历史读数（仅供参考，修复前口径，2026-09-24 采集）

- 范围：90 天，本机操作者数据；1016 事件 / 442 会话 / 8 作品。
- 漏斗（去重作品口径）：`editor_enter` 7 作品（370 事件）→ `generation_entry_used` 3 → `draft_preview` 5 →
  `draft_accept` success 4（3 作品）→ `first_content_input` 1 → `content_save` 2 → `first_chapter_accepted` 2。
- 北星：`acceptedChapters` 4 / `activeNovels` 8；30 天窗口：`editorEntries` 5 / `firstInputs` 1 / `contentSaves` 1。
- `capabilities.configurationCompletion` 7/8 = 87.5%。
- 提醒：样本是**操作者狗粮**（非用户总体），且为修复前口径 → 只能定工程问题，不能定产品 P0。

## 何时重跑 / 何时能关掉 E6

1. 每次埋点口径变更（新增事件、改去重键、改触发点）后：重跑一次，记录新基线，并**注明断点日期**。
2. 出现非操作者的真实用户会话后（去重会话数明显超出本机使用量）：重跑，作为产品判读依据。
3. E6 只有拿到真实用户数据才能关闭；在此之前本项保持「工具已就绪、样本待真实用户」的状态，不得用狗粮数据下产品结论。

## 证据

- 脚本：`scripts/report-activation-funnel.ts`（纯函数口径 `buildProductEventMetrics`，见
  `server/lib/db/product-events.ts`）。
- 测试：`tests/activation-funnel-report.test.ts` 4/4（纯函数与 DB 路径逐字段一致 / 去重口径 / 报告读数行 / CLI 参数）。
- 修复提交：`d2e9b4f`（埋点三处）+ `9a2c234`（创作入口收敛 WIP）。
- 旧账本作废标记：`docs/plans/README.md:65`、`docs/plans/002-audit-consolidation.md`、`docs/plans/008-entry-consolidation.md`。
