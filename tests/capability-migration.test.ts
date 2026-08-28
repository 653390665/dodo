import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { closeDb, createNovel, getNovel, initDb } from '../server/lib/db.js';
import { getDatabaseGeneration } from '../server/lib/db-instance.js';
import { registerCapabilityMigrationRoutes } from '../server/routes/capability-migration.js';
import { buildCapabilityMigrationPreview } from '../server/capabilities/migration.js';
import type { Novel, Skill } from '../shared/types.js';

function legacyNovel(id = 'migration-novel'): Novel & { skillLoadoutSchemaVersion: 2 } {
  return { id, title: id, authorId: 'local', summary: '', status: 'ongoing' as const,
    mountedSkillIds: ['xiaofeiji-novel-flow', 'prose-mouth-flavor', 'missing-skill'],
    mountedSkillLoadout: [
      { slot: 0, skillId: 'xiaofeiji-novel-flow', weight: 1, lockedDimensions: [] },
      { slot: 1, skillId: 'prose-mouth-flavor', weight: 1, lockedDimensions: [] },
      { slot: 2, skillId: 'missing-skill', weight: 1, lockedDimensions: [] },
    ], skillLoadoutSchemaVersion: 2 as const, projectPreferenceProfile: {
      tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
      quotaLimits: { generateProseCount: 2 }, commercialMode: 'free' as const, unknownExtension: { keep: true },
    }, createdAt: 1, updatedAt: 1 };
}

async function serverFor(novel = legacyNovel()) {
  closeDb(); initDb(':memory:'); createNovel(novel);
  const app = express(); app.use(express.json()); registerCapabilityMigrationRoutes(app);
  const server = app.listen(0); await new Promise<void>((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

test('migration preview is read-only and classifies v2 entries', { concurrency: false }, async () => {
  const { server, base } = await serverFor();
  try {
    const generation = getDatabaseGeneration();
    const response = await fetch(`${base}/api/novels/migration-novel/capabilities/migration/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: generation }) });
    assert.equal(response.status, 200);
    const body = await response.json() as { previewToken: string; flow?: { id: string }; techniques: Array<{ id: string }>; migrationPendingIds: string[] };
    assert.ok(body.previewToken); assert.equal(body.flow?.id, 'xiaofeiji-novel-flow');
    assert.ok(body.techniques.some((item) => item.id === 'prose-mouth-flavor'));
    assert.ok(body.migrationPendingIds.includes('missing-skill'));
    assert.equal(getNovel('migration-novel')?.projectPreferenceProfile?.capabilityModelVersion, undefined);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); closeDb(); }
});

test('migration apply writes v3 once, preserves unrelated fields, and is idempotent', { concurrency: false }, async () => {
  const { server, base } = await serverFor();
  try {
    const generation = getDatabaseGeneration();
    const preview = await fetch(`${base}/api/novels/migration-novel/capabilities/migration/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: generation }) });
    const token = (await preview.json() as { previewToken: string }).previewToken;
    const payload = JSON.stringify({ databaseGeneration: generation, previewToken: token });
    const applied = await fetch(`${base}/api/novels/migration-novel/capabilities/migration/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload });
    assert.equal(applied.status, 200);
    const saved = getNovel('migration-novel')?.projectPreferenceProfile as Record<string, unknown>;
    assert.equal(saved.capabilityModelVersion, 3); assert.deepEqual(saved.quotaLimits, { generateProseCount: 2 }); assert.deepEqual(saved.unknownExtension, { keep: true });
    const repeated = await fetch(`${base}/api/novels/migration-novel/capabilities/migration/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload });
    assert.equal(repeated.status, 200);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); closeDb(); }
});

test('migration rejects stale generation and preserves explicit v3 empty profile', { concurrency: false }, async () => {
  const { server, base } = await serverFor({ ...legacyNovel('migration-v3'), projectPreferenceProfile: {
    tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 }, acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
    capabilityModelVersion: 3, capabilityProfile: { version: 3, projectSkillDeck: { supportCardIds: [], updatedAt: 1 }, favoriteTechniqueIds: [] },
  } });
  try {
    const generation = getDatabaseGeneration();
    const preview = await fetch(`${base}/api/novels/migration-v3/capabilities/migration/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: generation }) });
    const token = (await preview.json() as { previewToken: string }).previewToken;
    const stale = await fetch(`${base}/api/novels/migration-v3/capabilities/migration/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: generation + 1, previewToken: token }) });
    assert.equal(stale.status, 409);
    const saved = getNovel('migration-v3')?.projectPreferenceProfile?.capabilityProfile;
    assert.deepEqual(saved?.favoriteTechniqueIds, []); assert.equal(saved?.activeFlowId, undefined);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); closeDb(); }
});

test('migration rejects a changed project profile after preview without writing v3', { concurrency: false }, async () => {
  const { server, base } = await serverFor(legacyNovel('migration-profile-stale'));
  try {
    const generation = getDatabaseGeneration();
    const preview = await fetch(`${base}/api/novels/migration-profile-stale/capabilities/migration/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: generation }) });
    const token = (await preview.json() as { previewToken: string }).previewToken;
    const current = getNovel('migration-profile-stale')!;
    current.projectPreferenceProfile = { ...current.projectPreferenceProfile!, tags: ['changed-after-preview'] };
    const { updateNovel } = await import('../server/lib/db/novels.js');
    updateNovel(current.id, { projectPreferenceProfile: current.projectPreferenceProfile });
    const response = await fetch(`${base}/api/novels/migration-profile-stale/capabilities/migration/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: generation, previewToken: token }) });
    assert.equal(response.status, 409);
    assert.notEqual(getNovel('migration-profile-stale')?.projectPreferenceProfile?.capabilityModelVersion, 3);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); closeDb(); }
});

test('migration leaves ambiguous flows and non-runtime cards pending', () => {
  const novel = { ...legacyNovel('ambiguous'), mountedSkillIds: ['xiaofeiji-novel-flow', 'generic-novel-flow', 'card-a'], mountedSkillLoadout: [], projectPreferenceProfile: undefined };
  const card: Skill = { id: 'card-a', name: 'Card', description: 'rule', style: 'style', pacing: 'tight', stabilityScore: 1, evaluationFeedback: '', version: 1, sourceBadge: 'book-extracted', deconstructionCardType: 'style-card', createdAt: 1, isRuntimeReady: false, runtimeStatus: 'active', sanitizationStatus: 'runtime-ready' };
  const preview = buildCapabilityMigrationPreview(novel, [card]);
  assert.equal(preview.flow, undefined);
  assert.ok(preview.migrationPendingIds.includes('xiaofeiji-novel-flow'));
  assert.ok(preview.migrationPendingIds.includes('generic-novel-flow'));
  assert.ok(preview.migrationPendingIds.includes('card-a'));
});

test('migration never infers a main card or truncates excess supports', () => {
  const novel = { ...legacyNovel('explicit-deck'), mountedSkillIds: ['a', 'b', 'c', 'd'], mountedSkillLoadout: [], projectPreferenceProfile: undefined };
  const cards: Skill[] = ['a', 'b', 'c', 'd'].map((id) => ({
    id, name: id, description: '', style: `${id} rule`, pacing: 'tight', stabilityScore: 80, evaluationFeedback: '', version: 1, createdAt: 1,
    sourceBadge: 'book-extracted', sourceType: 'book-extracted', deconstructionCardType: 'style-card',
    isRuntimeReady: true, sanitizationStatus: 'runtime-ready', runtimeStatus: 'active', executionScore: 80,
  }));
  const preview = buildCapabilityMigrationPreview(novel, cards);
  assert.equal(preview.mainCard, undefined);
  assert.deepEqual(preview.supportCards, []);
  assert.deepEqual(new Set(preview.migrationPendingIds), new Set(['a', 'b', 'c', 'd']));
});
