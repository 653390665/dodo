/**
 * Plan 262 B3：目录滞留清账 —— 每张治理资产都必须有明确去向。
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { PROMPT_GOVERNANCE_CATALOG } from '../shared/lib/prompt-governance-catalog.js';
import { SANITIZED_SKILL_COPIES } from '../shared/lib/public-skill-catalog.js';
import {
  describeCatalogDispositions,
  formatCatalogDispositionReport,
} from '../scripts/lib/catalog-disposition.js';

const report = describeCatalogDispositions();

test('去向分布钉住：189 = public 142 + sanitized-copy 33 + duplicate-absorbed 6 + declared-internal 8', () => {
  assert.equal(report.entries.length, PROMPT_GOVERNANCE_CATALOG.length);
  assert.equal(report.entries.length, 189);
  assert.deepEqual(report.counts, {
    public: 142,
    'sanitized-copy': 33,
    'duplicate-absorbed': 6,
    'declared-internal': 8,
    unclassified: 0,
  });
  assert.deepEqual(report.stranded, []);
  for (const entry of report.entries) {
    assert.ok(entry.reason && entry.reason.length > 0, `${entry.id} 必须给出去向理由`);
  }
  const lines = formatCatalogDispositionReport(report);
  assert.ok(
    lines.some((line) => line.startsWith('PASS：无滞留资产')),
    formatCatalogDispositionReport(report).join('\n')
  );
});

test('每一张卡只落一个去向，且 id 覆盖全量无重复', () => {
  const ids = report.entries.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    [...ids].sort(),
    PROMPT_GOVERNANCE_CATALOG.map((asset) => asset.id).sort()
  );
});

test('副本去向与副本表一一对应（33 张源卡 → sanitized-<id>）', () => {
  const copySourceIds = SANITIZED_SKILL_COPIES.map((copy) => copy.id.replace(/^sanitized-/, ''));
  assert.equal(copySourceIds.length, 33);
  const copyEntries = report.entries.filter((entry) => entry.kind === 'sanitized-copy');
  assert.deepEqual(copyEntries.map((entry) => entry.id).sort(), [...copySourceIds].sort());
  // 源卡自身不上架是设计（公开以副本形态存在），且每张都还在 runtime 目录内。
  const catalogIds = new Set(PROMPT_GOVERNANCE_CATALOG.map((asset) => asset.id));
  for (const id of copySourceIds) assert.ok(catalogIds.has(id), `${id} 应仍在 runtime 目录`);
});

test('重复吸收：6 张换皮重投的覆盖目标确实上架或已有副本', () => {
  const duplicates = report.entries.filter((entry) => entry.kind === 'duplicate-absorbed');
  assert.equal(duplicates.length, 6);
  const byId = new Map(report.entries.map((entry) => [entry.id, entry]));
  for (const entry of duplicates) {
    assert.ok(entry.coveredBy, `${entry.id} 应记录被保留的卡`);
    const covered = byId.get(entry.coveredBy!);
    assert.ok(covered, `${entry.id} 的覆盖目标 ${entry.coveredBy} 应在目录内`);
    assert.ok(
      covered!.kind === 'public' || covered!.kind === 'sanitized-copy',
      `${entry.id} 的覆盖目标 ${covered!.id} 应已上架或有副本（实际 ${covered!.kind}）`
    );
  }
});

test('declared-internal：8 张明确不公开（垃圾标题 6 + 渲染空标题 1 + 测试夹具 1）', () => {
  const internal = report.entries.filter((entry) => entry.kind === 'declared-internal');
  assert.deepEqual(
    internal.map((entry) => entry.id).sort(),
    [
      'private-106',
      'private-167',
      'private-186',
      'private-195',
      'private-197',
      'private-198',
      'test-fixture-lowscore',
      'test-fixture-unsafe',
    ]
  );
  const reasons = new Map(internal.map((entry) => [entry.id, entry.reason]));
  assert.match(reasons.get('private-197')!, /垃圾卡准入规则/);
  assert.match(reasons.get('private-186')!, /品牌剥除后为空/);
  assert.match(reasons.get('test-fixture-unsafe')!, /测试夹具/);
});

test('B3 验收：13 张「needs-sanitization 且无副本」全部有非滞留去向', () => {
  const noCopy = PROMPT_GOVERNANCE_CATALOG.filter(
    (asset) =>
      asset.sanitizationStatus === 'needs-sanitization' &&
      !SANITIZED_SKILL_COPIES.some((copy) => copy.id === `sanitized-${asset.id}`)
  );
  assert.equal(noCopy.length, 13, noCopy.map((asset) => asset.id).join(', '));
  const byId = new Map(report.entries.map((entry) => [entry.id, entry]));
  for (const asset of noCopy) {
    const entry = byId.get(asset.id);
    assert.ok(entry, `${asset.id} 应有去向`);
    assert.ok(
      entry!.kind === 'declared-internal' || entry!.kind === 'duplicate-absorbed',
      `${asset.id} 去向应为「标注不可公开」或「换皮被吸收」，实际 ${entry!.kind}`
    );
  }
});
