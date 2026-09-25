/**
 * 公开目录生成 CLI（薄壳）。
 *
 * 本文件只做三件事：跑管线 → 打印留痕日志 → 写盘。全部纯逻辑（准入、治理、
 * 消毒、副本、渲染）都在 `scripts/lib/public-catalog-pipeline.ts`，与守卫测试
 * （tests/public-catalog-freshness.test.ts、tests/public-catalog-governance.test.ts）
 * 同源 import —— 仓内不再有「需要手工同步的第二份卡面正文/规则」。
 *
 * 用法：node --import tsx scripts/generate-public-catalog.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  CATALOG_MODULE_PATH,
  buildPublicCatalogModel,
  renderPublicCatalogModule,
} from './lib/public-catalog-pipeline.js';

function generate() {
  console.log('Starting white-label physical catalog sanitization pipeline...');

  const { model, report } = buildPublicCatalogModel();

  if (report.excludedJunkPublic.length > 0) {
    console.log(
      `Excluded ${report.excludedJunkPublic.length} junk assets from public pools: [${report.excludedJunkPublic.join(', ')}]`
    );
  }
  if (report.excludedJunkCandidates.length > 0) {
    console.log(
      `Excluded ${report.excludedJunkCandidates.length} junk sanitize candidates: [${report.excludedJunkCandidates.join(', ')}]`
    );
  }
  if (report.dedupedCandidates.length > 0) {
    console.log(
      `Deduped ${report.dedupedCandidates.length} sanitize candidates by normalized title: [${report.dedupedCandidates.join(', ')}]`
    );
  }
  if (report.penaltyLog.length > 0) {
    console.log(
      `Plan 258 governance (score cap + featured guard) applied to ${report.penaltyLog.length} cards:\n  ${report.penaltyLog.join('\n  ')}`
    );
  }
  if (report.goalRewrites + report.signalRewrites > 0) {
    console.log(
      `Rewrote ${report.goalRewrites} goals + ${report.signalRewrites} signals into de-commercialized variants (plan 234).`
    );
  }

  console.log(`Cleaned ${report.counts.registry} registry assets.`);
  console.log(`Cleaned ${report.counts.flows} series flows.`);
  console.log(`Cleaned ${report.counts.curatedSkills} curated skills.`);
  console.log(`Cleaned ${report.counts.catalog} total catalog assets.`);
  console.log(`Cleaned ${report.counts.packages} enhancement packages.`);
  console.log(
    `Generated ${report.counts.sanitizedCopies} sanitized copies from ${report.counts.sanitizeCandidates} sanitize-required candidates.`
  );

  const outputPath = path.resolve(process.cwd(), CATALOG_MODULE_PATH);
  fs.writeFileSync(outputPath, renderPublicCatalogModule(model), 'utf-8');
  console.log(`Successfully generated safe public catalog at ${outputPath}`);
}

generate();
