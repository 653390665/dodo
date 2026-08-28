import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCatalogCapabilityManifest,
  listCatalogCapabilityManifests,
} from '../shared/lib/capability-manifest-catalog.js';
import { CURATED_PRODUCT_SKILLS } from '../shared/lib/public-skill-catalog.js';

test('v3 catalog separates flows, techniques, skill cards, diagnostics, and guardrails', () => {
  const expected = new Map([
    ['opening-gold-three', ['technique', 'use-technique']],
    ['bible-world-builder', ['technique', 'use-technique']],
    ['bible-character-arc', ['technique', 'use-technique']],
    ['prose-mouth-flavor', ['technique', 'use-technique']],
    ['prose-action-booster', ['technique', 'use-technique']],
    ['audit-cliche-detector', ['diagnostic', 'run-diagnostic']],
    ['de-ai-slop-shield', ['technique', 'use-technique']],
    ['deconstruct-golden-climax', ['skill-card', 'add-to-stack']],
    ['deconstruct-suspense-hook', ['skill-card', 'add-to-stack']],
  ] as const);

  for (const [id, [kind, action]] of expected) {
    const manifest = getCatalogCapabilityManifest(id);
    assert.equal(manifest?.kind, kind, id);
    assert.equal(manifest?.action, action, id);
    assert.ok(manifest?.allowedScopes.length, `${id} must declare allowed scopes`);
  }
});

test('all v3 catalog manifests declare scope and never write legacy capability kinds', () => {
  const manifests = listCatalogCapabilityManifests();
  assert.ok(manifests.length > 0);
  for (const manifest of manifests) {
    assert.ok(manifest.allowedScopes.length > 0, manifest.id);
    assert.equal(['role-skill', 'overlay'].includes(manifest.kind), false, manifest.id);
    if (manifest.kind === 'skill-card') {
      assert.ok(manifest.deconstructionCardType, `${manifest.id} must declare its card type`);
    } else {
      assert.equal(manifest.deconstructionCardType, undefined, `${manifest.id} must not declare a card type`);
    }
  }
});

test('deconstruction display metadata identifies cards rather than generic utilities', () => {
  const cardTypes = new Map([
    ['style-cthulhu-mystique', 'style-card'],
    ['style-ancient-elegance', 'style-card'],
    ['deconstruct-golden-climax', 'pacing-card'],
    ['deconstruct-suspense-hook', 'hook-card'],
  ] as const);
  for (const [id, cardType] of cardTypes) {
    assert.equal(getCatalogCapabilityManifest(id)?.deconstructionCardType, cardType, id);
  }
  for (const id of ['deconstruct-golden-climax', 'deconstruct-suspense-hook']) {
    const asset = CURATED_PRODUCT_SKILLS.find((entry) => entry.id === id);
    assert.ok(asset, id);
    assert.equal(asset.primaryCategory, 'skill-card', id);
  }
});

test('planner techniques expose governed artifact contracts instead of generic outline candidates', () => {
  const expectedKinds = new Map([
    ['opening-gold-three', ['master-outline', 'volume-outline', 'chapter-outline']],
    ['bible-world-builder', ['world']],
    ['bible-character-arc', ['character']],
  ]);
  for (const [id, artifactKinds] of expectedKinds) {
    const manifest = getCatalogCapabilityManifest(id);
    assert.deepEqual(manifest?.allowedScopes, ['project'], id);
    assert.equal(manifest?.persistence, 'project', id);
    assert.equal(manifest?.input, 'outline-source', id);
    assert.equal(manifest?.output, 'artifact-candidate', id);
    assert.deepEqual(manifest?.artifactContract?.artifactKinds, artifactKinds, id);
    assert.equal(manifest?.allowedScopes.includes('chapter'), false, id);
  }
});

test('writer techniques support full-book defaults, chapter use, and single-run execution', () => {
  for (const id of ['prose-mouth-flavor', 'prose-action-booster']) {
    const manifest = getCatalogCapabilityManifest(id);
    assert.deepEqual(manifest?.allowedScopes, ['project', 'chapter', 'single-run'], id);
    assert.equal(manifest?.persistence, 'chapter-session', id);
    assert.equal(manifest?.output, 'configuration', id);
  }
  for (const id of ['de-ai-slop-shield', 'de-ai-rhythm-restorer']) {
    const manifest = getCatalogCapabilityManifest(id);
    assert.deepEqual(manifest?.allowedScopes, ['chapter', 'single-run'], id);
    assert.equal(manifest?.persistence, 'single-run', id);
    assert.equal(manifest?.output, 'transform-preview', id);
  }
});
