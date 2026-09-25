import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPABILITY_KINDS,
  LEGACY_CAPABILITY_KINDS,
  type CapabilityKind,
  type CapabilityManifestEntry,
} from '../shared/types/capability-manifest.js';
import { listCatalogCapabilityManifests } from '../shared/lib/capability-manifest-catalog.js';
import { PROMPT_GOVERNANCE_CATALOG } from '../shared/lib/prompt-governance-catalog.js';
import {
  CARD_ROLES,
  cardRoleForGovernedCategory,
  cardRoleForKind,
  cardRoleForManifest,
  listKindRoleProjections,
} from '../shared/lib/capability-card-role.js';

const ROLES = new Set<string>(CARD_ROLES);

function manifestById(id: string): CapabilityManifestEntry {
  const entry = listCatalogCapabilityManifests().find((e) => e.id === id);
  assert.ok(entry, `治理货架缺少 manifest: ${id}`);
  return entry;
}

test('guardrail / diagnostic / utility 直接投影为对应角色', () => {
  assert.equal(cardRoleForKind('guardrail'), 'guardrail');
  assert.equal(cardRoleForKind('diagnostic'), 'diagnostic');
  assert.equal(cardRoleForKind('utility'), 'transform');
});

test('technique 按输出语义分流：transform-preview → transform，其余 → rule', () => {
  assert.equal(cardRoleForKind('technique', { output: 'transform-preview' }), 'transform');
  assert.equal(cardRoleForKind('technique', { output: 'configuration' }), 'rule');
  // 决策钉（批次 A 保守投影）：project 级候选型技法当前以原文常驻注入 → rule，不改运行时行为
  assert.equal(cardRoleForKind('technique', { output: 'outline-candidate' }), 'rule');
  assert.equal(cardRoleForKind('technique', { output: 'artifact-candidate' }), 'rule');
  assert.equal(cardRoleForKind('technique'), 'rule');
});

test('skill-card 与 legacy role-skill / overlay 都归 rule', () => {
  assert.equal(cardRoleForKind('skill-card'), 'rule');
  assert.equal(cardRoleForKind('role-skill'), 'rule');
  assert.equal(cardRoleForKind('overlay'), 'rule');
});

test('flow 不参与卡投影；未知 kind 不静默兜底', () => {
  assert.equal(cardRoleForKind('flow'), null);
  assert.equal(cardRoleForKind('mystery-kind' as CapabilityKind), null);
});

test('listKindRoleProjections 覆盖现行 + legacy 全部 kind，flow 显式 null', () => {
  const projections = listKindRoleProjections();
  assert.deepEqual(
    projections.map((p) => p.kind),
    [...CAPABILITY_KINDS, ...LEGACY_CAPABILITY_KINDS]
  );
  for (const p of projections) {
    if (p.role !== null) assert.ok(ROLES.has(p.role), `越界角色: ${p.kind} → ${p.role}`);
  }
  assert.equal(projections.find((p) => p.kind === 'flow')?.role, null);
});

test('cardRoleForManifest 依据真实目录分流技法卡与卡组卡', () => {
  assert.equal(cardRoleForManifest(manifestById('de-ai-slop-shield')), 'transform');
  assert.equal(cardRoleForManifest(manifestById('de-ai-rhythm-restorer')), 'transform');
  assert.equal(cardRoleForManifest(manifestById('opening-gold-three')), 'rule');
  assert.equal(cardRoleForManifest(manifestById('refine-outline-rebuild')), 'rule');
  assert.equal(cardRoleForManifest(manifestById('style-cthulhu-mystique')), 'rule');
  assert.equal(cardRoleForManifest(manifestById('audit-cliche-detector')), 'diagnostic');
});

test('cardRoleForGovernedCategory 覆盖全部六个治理分类，未知不兜底', () => {
  assert.equal(cardRoleForGovernedCategory('quality-guardrail'), 'guardrail');
  assert.equal(cardRoleForGovernedCategory('platform-criteria'), 'diagnostic');
  assert.equal(cardRoleForGovernedCategory('utility-tool'), 'transform');
  for (const category of ['author-workflow', 'constellation-pack', 'style-reference'] as const) {
    assert.equal(cardRoleForGovernedCategory(category), 'rule');
  }
  assert.equal(cardRoleForGovernedCategory(undefined), null);
  assert.equal(cardRoleForGovernedCategory('unknown-category'), null);
});

test('覆盖度：现有目录零未映射（非 flow manifest + 治理资产）', () => {
  const manifests = listCatalogCapabilityManifests();
  const cards = manifests.filter((e) => e.kind !== 'flow');
  const flows = manifests.filter((e) => e.kind === 'flow');
  assert.ok(cards.length > 0, '预期存在非 flow 卡');
  assert.ok(flows.length > 0, '预期存在链路（flow）条目不参与卡投影');
  assert.deepEqual(
    cards.filter((e) => cardRoleForManifest(e) === null).map((e) => `${e.id}:${e.kind}`),
    []
  );
  assert.ok(flows.every((e) => cardRoleForManifest(e) === null));
  assert.deepEqual(
    PROMPT_GOVERNANCE_CATALOG.filter(
      (e) => cardRoleForGovernedCategory(e.primaryCategory) === null
    ).map((e) => e.id),
    []
  );
});
