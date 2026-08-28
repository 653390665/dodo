import assert from 'node:assert/strict';
import express from 'express';
import { after, before, describe, test } from 'node:test';
import { getDb, closeDb, getDatabaseGeneration } from '../server/lib/db-instance.js';
import { initDb } from '../server/lib/db-init.js';
import { createNovel } from '../server/lib/db/novels.js';
import { dismissCapabilityRecommendation, isCapabilityRecommendationDismissed } from '../server/lib/db/capability-recommendations.js';
import { buildCapabilityRecommendations, recommendationFingerprint } from '../shared/lib/capability-recommendation.js';
import type { CapabilityManifestEntry } from '../shared/types/capability-manifest.js';
import { registerRoutes } from '../server/routes/index.js';

const manifest = (id: string, overrides: Partial<CapabilityManifestEntry> = {}): CapabilityManifestEntry => ({
  id, version: '1', kind: 'technique', stages: ['writer'], input: 'text', output: 'transform-preview', action: 'preview-transform',
  allowedScopes: ['chapter'], sideEffect: 'preview-only', runtimeStatus: 'active', sourceType: 'built-in',
  artifactContract: { artifactKinds: ['chapter-outline'], operations: ['optimize'], allowedScopes: ['chapter'], requiredInputs: [], output: 'transform-preview', canonEffect: 'candidate-only' },
  ...overrides,
});

describe('capability recommendations', () => {
  before(() => { closeDb(); initDb(':memory:'); });
  after(() => closeDb());

  test('filters contracts then returns one primary and two alternatives', () => {
    const result = buildCapabilityRecommendations({
      issue: { fingerprint: 'issue-a', recommendedCapabilityIds: ['good', 'bad', 'unknown'] }, artifactKind: 'chapter-outline', operation: 'optimize', scope: 'chapter', artifactVersion: 1,
      capabilities: [manifest('good'), manifest('bad', { runtimeStatus: 'unavailable' }), manifest('wrong', { artifactContract: { artifactKinds: ['world'], operations: ['optimize'], allowedScopes: ['chapter'], requiredInputs: [], output: 'transform-preview', canonEffect: 'candidate-only' } }), manifest('alt-1'), manifest('alt-2'), manifest('alt-3')],
    });
    assert.equal(result.primary?.capabilityId, 'good');
    assert.deepEqual(result.alternatives.map((entry) => entry.capabilityId), ['alt-1', 'alt-2']);
    assert.equal(result.recommendations.length, 3);
    assert.equal(buildCapabilityRecommendations({
      issue: { fingerprint: 'issue-a', recommendedCapabilityIds: ['good', 'alt-1'], }, artifactKind: 'chapter-outline', operation: 'optimize', scope: 'chapter', artifactVersion: 1,
      dismissedCapabilityIds: ['good'], capabilities: [manifest('good'), manifest('alt-1')],
    }).primary?.capabilityId, 'alt-1');
  });

  test('filters operation, scope, prerequisites, required artifacts, and access before ranking', () => {
    const base = {
      issue: { fingerprint: 'filters' }, artifactKind: 'chapter-outline' as const, operation: 'optimize' as const,
      scope: 'chapter' as const, artifactVersion: 1, availableArtifacts: [], availablePrerequisites: [], accessibleCapabilityIds: ['candidate'],
    };
    const noRecommendation = (candidate: CapabilityManifestEntry, overrides: Partial<typeof base> = {}) => buildCapabilityRecommendations({
      ...base, ...overrides, capabilities: [candidate],
    }).recommendations.length;
    assert.equal(noRecommendation(manifest('candidate', { artifactContract: { artifactKinds: ['chapter-outline'], operations: ['generate'], allowedScopes: ['chapter'], requiredInputs: [], output: 'transform-preview', canonEffect: 'candidate-only' } })), 0);
    assert.equal(noRecommendation(manifest('candidate', { artifactContract: { artifactKinds: ['chapter-outline'], operations: ['optimize'], allowedScopes: ['project'], requiredInputs: [], output: 'transform-preview', canonEffect: 'candidate-only' } })), 0);
    assert.equal(noRecommendation(manifest('candidate', { artifactContract: { artifactKinds: ['chapter-outline'], operations: ['optimize'], allowedScopes: ['chapter'], requiredInputs: ['world'], output: 'transform-preview', canonEffect: 'candidate-only' } })), 0);
    assert.equal(noRecommendation(manifest('candidate', { lineage: { requiredPrerequisites: ['canon-ready'] } })), 0);
    assert.equal(noRecommendation(manifest('candidate'), { accessibleCapabilityIds: ['other'] }), 0);
  });

  test('AI ranking cannot inject an unknown capability and dismissal is version scoped', () => {
    const input = { issue: { fingerprint: 'issue-b', recommendedCapabilityIds: ['good'] }, artifactKind: 'chapter-outline' as const, operation: 'optimize' as const, scope: 'chapter' as const, artifactVersion: 2, upstreamVersion: 'u1', capabilities: [manifest('good')] };
    const result = buildCapabilityRecommendations({ ...input, aiRankedCapabilityIds: ['unknown', 'good'] });
    assert.deepEqual(result.recommendations.map((entry) => entry.capabilityId), ['good']);
    const fingerprint = recommendationFingerprint(input);
    const owned = { novelId: 'n1', databaseGeneration: getDatabaseGeneration() };
    dismissCapabilityRecommendation({ ...owned, fingerprint, issueFingerprint: 'issue-b', artifactVersion: 2, upstreamVersion: 'u1', capabilityId: 'good' });
    assert.equal(isCapabilityRecommendationDismissed({ ...owned, fingerprint, issueFingerprint: 'issue-b', artifactVersion: 2, upstreamVersion: 'u1', capabilityId: 'good' }), true);
    assert.equal(isCapabilityRecommendationDismissed({ ...owned, fingerprint, issueFingerprint: 'issue-b', artifactVersion: 3, upstreamVersion: 'u1', capabilityId: 'good' }), false);
    assert.notEqual(recommendationFingerprint({ ...input, upstreamVersion: 'u2' }), fingerprint);
    assert.deepEqual(getDb().prepare('SELECT COUNT(*) AS count FROM capability_recommendation_dismissals').get(), { count: 1 });
  });

  test('registerRoutes exposes dismissal persistence endpoints', async () => {
    const app = express();
    app.use(express.json());
    registerRoutes(app);
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    createNovel({ id: 'route-novel', title: 'Route', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
    const payloadBase = { issue: { fingerprint: 'issue-route' }, artifactKind: 'chapter-outline' as const, operation: 'optimize' as const, scope: 'chapter' as const, artifactVersion: 1, upstreamVersion: 'u1', capabilities: [] };
    const payload = { novelId: 'route-novel', databaseGeneration: getDatabaseGeneration(), fingerprint: recommendationFingerprint(payloadBase), issueFingerprint: 'issue-route', artifactKind: 'chapter-outline', operation: 'optimize', scope: 'chapter', artifactVersion: 1, upstreamVersion: 'u1', capabilityId: 'opening-gold-three' };
    try {
      const write = await fetch(`${base}/api/capability-recommendations/dismiss`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      assert.equal(write.status, 204);
      const read = await fetch(`${base}/api/capability-recommendations/dismissed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      assert.equal(read.status, 200);
      assert.deepEqual(await read.json(), { dismissed: true });
      const forged = await fetch(`${base}/api/capability-recommendations/dismiss`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, fingerprint: 'forged' }) });
      assert.equal(forged.status, 400);
      const missingNovel = await fetch(`${base}/api/capability-recommendations/dismiss`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, novelId: 'missing' }) });
      assert.equal(missingNovel.status, 404);
      const staleGeneration = await fetch(`${base}/api/capability-recommendations/dismiss`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, databaseGeneration: payload.databaseGeneration + 1 }) });
      assert.equal(staleGeneration.status, 409);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
