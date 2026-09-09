# Plan 192: [方向 Spike] 能力卡/拆书 Deck 的导出与导入格式设计

> **Executor instructions**: 这是设计/调研型计划（direction 类）。产出是**设计文档 + 可运行的最小原型验证**，不是完整功能交付。按步骤执行，产出物写入 `docs/prd/2026-09-deck-pack-format.md`；触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 状态行。

## Status

- **Priority**: P3（方向类，产品决策后升级）
- **Effort**: M（粗估）
- **Risk**: LOW-MED
- **Depends on**: none
- **Category**: direction（design/spike）
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

拆书工厂消耗真实 LLM 调用产出「主笔卡+副卡组」，是用户投入最重的资产，但目前**有店无流通**：技能域后端只有 sanitize/extract/job 端点，无任何 deck 导出/导入路由；换机只能整库备份恢复，无法单卡组备份或分享给其他作者。而复用基建已齐：jszip 在依赖中（EPUB 导出与 zip 导入双端在用）、导出前白标清理管线已建成。分享/流通是「商店」定位的自然延伸，sanitize 管线本来就是分享前清理的一半工程。

## Grounding evidence（来自仓库）

- `server/routes/skills.ts:231,276,382,397` — 仅有 sanitize、extract-skill、job 查询/取消端点
- `src/components/skills/`（10 个组件）grep 导入/分享/export-pack 零命中
- `PRODUCT.md:16` — "White-label isolated prompt capability store"；`README.md:170-171` — 拆书产出存入商店
- jszip：`package.json:52`；sanitize：`server/routes/skills.ts:231`

## Scope

**In scope**：设计文档 + 走通「导出一个 deck → zip → 重新导入」的最小命令行原型（node 脚本，复用 sanitize + jszip）；不改 UI。

**Out of scope**：SkillDetailDrawer 导出入口 UI、格式版本迁移矩阵、分享市场/社区功能。

## Steps

### Step 1: 盘点 deck 数据面

读 `shared/types/skills.ts` 的 Skill/SkillCard/主辅卡结构与 `server/lib/db/` 的技能持久层（`grep -rn "skill" server/lib/db/ --include="*.ts" -l`），列出「一个可分享 deck」的最小字段集：卡数据、系列流（SKILL_SERIES_FLOWS 引用还是内联）、治理元数据（isSanitizeRequired 等）、增强包引用。判定：引用型字段导出时内联还是保留 id（跨机 id 冲突问题）。

### Step 2: 格式设计

写 `docs/prd/2026-09-deck-pack-format.md`：zip 结构（manifest.json + assets/）、版本字段、消毒承诺（导出必须过 `whiteLabelSanitize` 管线，等价 `skills.ts:231` 的服务端路径）、导入信任边界（导入的 deck 不得绕过本地治理校验）。开放问题清单（更新传播、作者署名、与 ENHANCEMENT_PACKAGES 的付费边界——引用 `docs/archive/monetization-boundary.md` 的商业化红线）。

### Step 3: 最小原型

`scripts/deck-pack-prototype.mjs`：从开发库导出一个 deck → zip → 再导入到另一临时库 → 断言字段往返一致（sanitize 前后快照对比）。只跑临时库，不碰 data.db。

**Verify**: `node --import tsx scripts/deck-pack-prototype.mjs` exit 0 并输出往返校验报告

## Done criteria

- [ ] 设计文档落入 docs/prd/，含开放问题清单
- [ ] 原型脚本往返校验通过
- [ ] `plans/README.md` 状态行更新，附「产品决策待定点」摘要

## STOP conditions

- deck 数据耦合用户库本地 id 链过深（无法内联化）——报告耦合图。
- sanitize 管线无法在脚本侧离线复用（依赖请求上下文）。

## Maintenance notes

产品拍板后，把设计文档升级为 PRD 并另立实施计划（预期 M：一个 pack 路由 + 导入导出对话框）。
