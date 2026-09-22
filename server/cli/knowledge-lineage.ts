/**
 * 知识谱系 CLI：把资料包权威素材（逐章细纲/遗物体系/公理）解析入库
 * （伏笔台账 + 图谱边），并输出覆盖度报告。幂等可重跑。
 *
 * 用法：npx tsx server/cli/knowledge-lineage.ts <novelId>
 */
import { initDb } from '../lib/db.ts';
import { runLineageEnrichment } from '../helpers/knowledge-lineage-enrich.ts';

initDb();
const novelId = process.argv[2];
if (!novelId) {
  console.error('用法: npx tsx server/cli/knowledge-lineage.ts <novelId>');
  process.exit(1);
}

const report = runLineageEnrichment(novelId);
console.log('=== 知识谱系入库报告 ===');
console.log(`细纲条目解析: ${report.xigangEntries}`);
console.log(`伏笔台账: 新增 ${report.ledgerInserted} / 跳过(已存在) ${report.ledgerSkipped}`);
console.log(`公理持有边: +${report.powerEdgesAdded}`);
console.log(`遗物持有边: +${report.relicEdgesAdded}`);
if (report.relicUnmatched.length > 0) {
  console.log(`遗物未匹配 ${report.relicUnmatched.length} 条:`);
  for (const item of report.relicUnmatched.slice(0, 8)) console.log(`  - ${item}`);
}
console.log(`关系类型归一化: ${report.relationshipTypesNormalized} 行`);
console.log(`亲和边: +${report.affinityEdgesAdded} | 居住边: +${report.residenceEdgesAdded}`);
console.log('=== 覆盖度 ===');
console.log(JSON.stringify(report.coverage, null, 1));
