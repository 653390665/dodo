# InkFlow 文档索引

| 目录 | 内容 | 约定 |
|---|---|---|
| `prd/` | 产品需求文档（PRD） | 文件名带日期：`YYYY-MM-DD-<slug>.md`；状态写在文首引用块；实施后回写"实施记录"章节 |
| `specs/` | **技术不变式规范**（被根目录 `AGENTS.md` 硬引用，改动对应领域前必读） | 路径不可随意变更 |
| `plans/` | 实施计划 | — |
| `research/`、`prompt-research/` | 调研材料 | — |
| `archive/` | 历史报告与归档（含早期评审、开发记录） | 只读参考，不再维护 |
| `recovery/` | 故障恢复记录 | — |
| `superpowers/` | 工作流技巧沉淀 | — |

## 活跃 PRD

- [2026-09-05 首章生成体验整合](prd/2026-09-05-generation-entry-consolidation.md) — P0/P1 已实施；遗留 3 项验收子项与后续 PRD 见 [2026-09-05 生成链路遗留项](prd/2026-09-05-generation-follow-ups.md)

## archive/ 索引

- `archive/2026-08-reports/` — 2026-08 根目录历史评估报告（产品体验审计 md/html/pdf、横纵分析 md/html/pdf、PRODUCT/PROJECT 评估、测试审计/报告、implementation_plan）及 `.github` CI build-trigger 记录，2026-09-10 自根目录归档。

## 维护规则

1. 新 PRD 一律放 `prd/`，根目录不再散落 md；
2. 历史评审/一次性报告进 `archive/`；
3. 涉及领域不变式的改动，先读 `specs/` 对应文档再动手。
