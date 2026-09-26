/**
 * Plan 262 B3：目录去向报告（可复跑）。
 *
 * 运行：`npx tsx scripts/report-catalog-hygiene.ts`
 * 退出码：有滞留资产（未登记去向）→ 1；否则 0。
 */
import {
  describeCatalogDispositions,
  formatCatalogDispositionReport,
} from './lib/catalog-disposition.js';

const report = describeCatalogDispositions();
for (const line of formatCatalogDispositionReport(report)) console.log(line);
process.exitCode = report.stranded.length === 0 ? 0 : 1;
