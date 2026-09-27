type HitBag = { contacts: number; authors: number; brands: number; watermarks: number };
function hitSum(hits: HitBag | undefined): number {
  if (!hits) return 0;
  return hits.contacts + hits.authors + hits.brands + hits.watermarks;
}
/**
 * capD：清洗管线实况 —— 公开目录/消毒副本的准入、排除与去重清单。
 * 运行：npx tsx scripts/report-catalog-sanitize.ts
 */
import { PROMPT_GOVERNANCE_CATALOG } from '../shared/lib/prompt-governance-catalog.js';
import { PUBLIC_SKILL_GOVERNANCE_CATALOG, SANITIZED_SKILL_COPIES } from '../shared/lib/public-skill-catalog.js';
import { collectSanitizeCandidates, buildPublicCatalogModel, admitPublicAsset } from '../scripts/lib/public-catalog-pipeline.js';

const publicIds = new Set(PUBLIC_SKILL_GOVERNANCE_CATALOG.map((a) => a.id));
const runtimeReady = PROMPT_GOVERNANCE_CATALOG.filter((a) => a.isRuntimeReady);

console.log('=== 公开目录准入（runtime 目录 → 公开目录） ===');
console.log(`  runtime 目录 ${PROMPT_GOVERNANCE_CATALOG.length} → 公开目录 ${PUBLIC_SKILL_GOVERNANCE_CATALOG.length}`);
const excludedByAdmit = PROMPT_GOVERNANCE_CATALOG.filter((a) => !admitPublicAsset(a));
console.log(`  admitPublicAsset 拒绝 ${excludedByAdmit.length} 张:`);
for (const a of excludedByAdmit) {
  console.log(`    - ${a.id} | ${a.title} | tier=${a.placementTier} | score=${a.score} | ready=${a.isRuntimeReady}`);
}
const admittedButAbsent = PROMPT_GOVERNANCE_CATALOG.filter((a) => admitPublicAsset(a) && !publicIds.has(a.id));
console.log(`  通过准入但未出现在公开目录: ${admittedButAbsent.length} 张 → ${admittedButAbsent.map((a) => a.id).join(', ') || '(无)'}`);

console.log('\n=== 消毒候选（collectSanitizeCandidates） ===');
const collected = collectSanitizeCandidates();
console.log(`  candidates ${collected.candidates.length} · excluded ${collected.excluded.length} · deduped ${collected.deduped.length}`);
console.log(`  副本表 SANITIZED_SKILL_COPIES ${SANITIZED_SKILL_COPIES.length}`);
console.log('  被排除（不产副本）清单:');
for (const item of collected.excluded) {
  const asset = item as unknown as Record<string, unknown>;
  console.log(`    - ${String(asset.id)} | tier=${String(asset.placementTier)} | runtime=${String(asset.runtimeStatus)} | sanitize=${String(asset.sanitizationStatus)} | ${String(asset.title)}`);
}
if (collected.deduped.length > 0) {
  console.log('  去重清单:');
  for (const item of collected.deduped) {
    const asset = item as unknown as Record<string, unknown>;
    console.log(`    - ${String(asset.id)} | ${String(asset.title)}`);
  }
}

console.log('\n=== 需要清洗但未进候选（runtime 目录口径） ===');
const needs = PROMPT_GOVERNANCE_CATALOG.filter((a) => a.sanitizationStatus !== 'runtime-ready');
const candidateIds = new Set(collected.candidates.map((a) => (a as unknown as { id: string }).id));
const missing = needs.filter((a) => !candidateIds.has(a.id));
console.log(`  needs-sanitization ${needs.length} · 在候选内 ${needs.length - missing.length} · 未进候选 ${missing.length}`);
for (const a of missing) {
  console.log(`    - ${a.id} | tier=${a.placementTier} | runtime=${a.runtimeStatus} | score=${a.score} | ${a.title}`);
}

console.log('\n=== 公开目录报告（buildPublicCatalogModel） ===');
const built = buildPublicCatalogModel();
const report = built.report as unknown as Record<string, unknown>;
for (const [key, value] of Object.entries(report)) {
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    console.log(`  ${key} = ${String(value)}`);
  } else if (Array.isArray(value)) {
    console.log(`  ${key} = [${value.length} 项]`);
  } else if (value && typeof value === 'object') {
    console.log(`  ${key} = {${Object.keys(value).length} 键}`);
  }
}

console.log('\n=== 已就绪资产里从无消毒动作/从无命中的情况 ===');
console.log(`  runtime-ready ${runtimeReady.length} 张，其中 sanitizationHits 非空: ${runtimeReady.filter((a) => hitSum(a.sanitizationHits) > 0).length}`);
console.log(`  runtime 目录内 sanitizationHits 非空总数: ${PROMPT_GOVERNANCE_CATALOG.filter((a) => hitSum(a.sanitizationHits) > 0).length}`);
