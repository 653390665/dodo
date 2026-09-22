/**
 * 知识谱系 CLI：资料包权威素材 → 伏笔台账/图谱边入库（幂等可重跑），
 * 并提供叙事元素实体化提案/确认流程。
 *
 * 用法：
 *   npx tsx server/cli/knowledge-lineage.ts <novelId>                    # 谱系入库 + 覆盖度报告
 *   npx tsx server/cli/knowledge-lineage.ts propose <novelId>            # 生成叙事元素提案
 *   npx tsx server/cli/knowledge-lineage.ts confirm <novelId> [--all]    # 确认提案入道具库
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { initDb } from '../lib/db.ts';
import { getDb } from '../lib/db-instance.ts';
import { runLineageEnrichment, packSourceDocuments } from '../helpers/knowledge-lineage-enrich.ts';
import { extractElementProposals, extractXigangEntries } from '../helpers/knowledge-lineage.ts';

initDb();
const db = getDb();
const args = process.argv.slice(2);
const command = args[0] === 'propose' || args[0] === 'confirm' ? args[0] : 'enrich';
const novelId = command === 'enrich' ? args[0] : args[1];

if (!novelId) {
  console.error(
    '用法:\n  … knowledge-lineage.ts <novelId>\n  … propose <novelId>\n  … confirm <novelId> [--all]'
  );
  process.exit(1);
}

function proposalsFile(id: string): string {
  return path.join(os.homedir(), '.inkflow', `element-proposals-${id}.json`);
}

if (command === 'propose') {
  const docs = packSourceDocuments(db, novelId);
  const xigangDoc = docs.find((d) => d.filename.includes('逐章细纲'));
  if (!xigangDoc) {
    console.error('资料包中无逐章细纲');
    process.exit(1);
  }
  const entries = extractXigangEntries(xigangDoc.text);
  const existingNames = new Set(
    (db.prepare('SELECT name FROM items WHERE novel_id = ?').all(novelId) as Array<{ name: string }>).map(
      (r) => r.name
    )
  );
  const proposals = extractElementProposals(entries, existingNames);
  const file = proposalsFile(novelId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(proposals, null, 1));
  console.log(`叙事元素提案 ${proposals.length} 条已写入 ${file}`);
  for (const p of proposals.slice(0, 15)) {
    console.log(`  [${p.firstSeenChapter}] ${p.name} — ${p.description.slice(0, 50)}`);
  }
  if (proposals.length > 15) console.log(`  … 其余 ${proposals.length - 15} 条见提案文件`);
  console.log('确认入库: npx tsx server/cli/knowledge-lineage.ts confirm ' + novelId + ' --all');
  process.exit(0);
}

if (command === 'confirm') {
  const file = proposalsFile(novelId);
  if (!fs.existsSync(file)) {
    console.error('无提案文件，请先运行 propose');
    process.exit(1);
  }
  const proposals = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<{
    name: string;
    description: string;
    firstSeenChapter: string;
  }>;
  const confirmed = args.includes('--all')
    ? proposals
    : proposals.filter((p) => args.slice(2).includes(p.name));
  const insertItem = db.prepare(
    'INSERT INTO items (id, novel_id, name, description, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  let added = 0;
  for (const p of confirmed) {
    const exists = db.prepare('SELECT id FROM items WHERE novel_id = ? AND name = ?').get(novelId, p.name);
    if (exists) continue;
    insertItem.run(randomUUID(), novelId, p.name, p.description, '叙事元素', Date.now(), Date.now());
    added += 1;
  }
  fs.writeFileSync(
    file,
    JSON.stringify(proposals.filter((p) => !confirmed.some((c) => c.name === p.name)), null, 1)
  );
  console.log(`已入库 ${added} 个叙事元素；剩余提案 ${proposals.length - added} 条`);
  const report = runLineageEnrichment(novelId);
  console.log(
    `谱系同步完成: 台账 +${report.ledgerInserted}，公理边 +${report.powerEdgesAdded}，遗物边 +${report.relicEdgesAdded}`
  );
  process.exit(0);
}

// 默认：谱系入库 + 覆盖度报告
const report = runLineageEnrichment(novelId);
console.log('=== 知识谱系入库报告 ===');
console.log(`细纲条目解析: ${report.xigangEntries}`);
console.log(`伏笔台账: 新增 ${report.ledgerInserted} / 跳过(已存在) ${report.ledgerSkipped}`);
console.log(`公理持有边: +${report.powerEdgesAdded}`);
console.log(`遗物持有边: +${report.relicEdgesAdded}`);
console.log(`亲和边: +${report.affinityEdgesAdded} | 居住边: +${report.residenceEdgesAdded}`);
console.log(`关系类型归一化: ${report.relationshipTypesNormalized} 行`);
console.log('=== 覆盖度 ===');
console.log(JSON.stringify(report.coverage, null, 1));
