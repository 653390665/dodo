import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { closeDb, createChapter, createNovel, createSkill, getChapter, getNovel, initDb } from '../server/lib/db.js';
import { getDatabaseGeneration, holdWriteQueue } from '../server/lib/db-instance.js';
import { registerWritingStyleRoutes } from '../server/routes/writing-style.js';

function profile() {
  return {
    tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
    acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
    capabilityModelVersion: 3 as const,
    capabilityProfile: { version: 3 as const, activeFlowId: 'xiaofeiji-novel-flow', projectSkillDeck: { supportCardIds: [], updatedAt: 1 }, favoriteTechniqueIds: [] },
    quotaLimits: { generateProseCount: 2, generateProseMax: 10 }, commercialMode: 'free' as const,
    unknownExtension: { keep: true },
  };
}

test('capability configuration preview is read-only and apply preserves unrelated profile fields', async () => {
  closeDb(); initDb(':memory:');
  createNovel({ id: 'config-novel', title: 'Config', authorId: 'local', summary: '', status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [], projectPreferenceProfile: profile(), createdAt: 1, updatedAt: 1 });
  createChapter({ id: 'config-novel-chapter', novelId: 'config-novel', title: '第一章', content: '', order: 1, wordCount: 0, createdAt: 1, updatedAt: 1 });
  const app = express(); app.use(express.json()); registerWritingStyleRoutes(app);
  const server = app.listen(0); await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const generation = getDatabaseGeneration();
    const next = { ...profile(), capabilityProfile: { ...profile().capabilityProfile, activeFlowId: 'generic-novel-flow', guardrailIds: ['default-guardrail'] }, writingStyleConfirmation: { mode: 'default', fingerprint: 'a'.repeat(64), confirmedAt: 1 } };
    const preview = await fetch(`${base}/api/novels/config-novel/capabilities/configuration/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: generation, capabilityProfile: next.capabilityProfile }) });
    assert.equal(preview.status, 200);
    const previewBody = await preview.json() as { previewToken: string; profile: typeof next.capabilityProfile };
    assert.ok(previewBody.previewToken);
    assert.equal(getNovel('config-novel')?.projectPreferenceProfile?.capabilityProfile?.activeFlowId, 'xiaofeiji-novel-flow');
    const applied = await fetch(`${base}/api/novels/config-novel/capabilities/configuration/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      databaseGeneration: generation,
      previewToken: previewBody.previewToken,
      capabilityProfile: next.capabilityProfile,
      packageSteps: [
        { stepId: 'outline-step', assetId: 'opening-gold-three', mode: 'configure', trigger: 'outline', scope: 'project', order: 1, required: true },
        { stepId: 'audit-step', assetId: 'audit-cliche-detector', mode: 'run-now', trigger: 'after-draft', scope: 'chapter', order: 2, required: false, dependsOn: ['outline-step'] },
        { stepId: 'unscheduled-technique', assetId: 'prose-action-booster', mode: 'schedule', trigger: 'before-draft', scope: 'chapter', order: 3, required: false },
      ],
    }) });
    assert.equal(applied.status, 200);
    const appliedBody = await applied.json() as { profile: typeof next.capabilityProfile; items: Array<{ capabilityId: string; stepId?: string; status: string }> };
    assert.equal(appliedBody.profile.activeFlowId, 'generic-novel-flow');
    assert.equal('capabilityProfile' in appliedBody.profile, false, 'apply response must return only ProjectCapabilityProfile');
    assert.deepEqual(appliedBody.items, [
      { capabilityId: 'opening-gold-three', stepId: 'outline-step', status: 'configured' },
      { capabilityId: 'audit-cliche-detector', stepId: 'audit-step', status: 'recommended', reason: '当前版本不会自动安排或运行该能力，请在写作流程中手动触发。' },
      { capabilityId: 'prose-action-booster', stepId: 'unscheduled-technique', status: 'skipped' },
    ]);
    assert.equal(getNovel('config-novel')?.projectPreferenceProfile?.capabilityProfile?.activeFlowId, 'generic-novel-flow');
    assert.equal(getChapter('config-novel-chapter')?.workflowMeta?.capabilityState, undefined);
    const saved = getNovel('config-novel')?.projectPreferenceProfile;
    assert.equal(saved?.capabilityProfile?.activeFlowId, 'generic-novel-flow');
    assert.deepEqual(saved?.capabilityProfile?.guardrailIds, ['default-guardrail']);
    assert.deepEqual(saved?.quotaLimits, profile().quotaLimits);
    assert.equal(saved?.commercialMode, 'free');
    assert.deepEqual((saved as Record<string, unknown>).unknownExtension, { keep: true });
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); closeDb(); }
});

test('capability configuration rejects a concurrent apply using the same preview token', async () => {
  closeDb(); initDb(':memory:');
  createNovel({ id: 'config-concurrent', title: 'Config', authorId: 'local', summary: '', status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [], projectPreferenceProfile: profile(), createdAt: 1, updatedAt: 1 });
  const app = express(); app.use(express.json()); registerWritingStyleRoutes(app);
  const server = app.listen(0); await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const generation = getDatabaseGeneration();
    const capabilityProfile = profile().capabilityProfile;
    const preview = await fetch(`${base}/api/novels/config-concurrent/capabilities/configuration/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: generation, capabilityProfile }) });
    const { previewToken } = await preview.json() as { previewToken: string };
    const queue = holdWriteQueue();
    const body = JSON.stringify({ databaseGeneration: generation, previewToken, capabilityProfile });
    const first = fetch(`${base}/api/novels/config-concurrent/capabilities/configuration/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    await queue.waitForQueued(1);
    const second = await fetch(`${base}/api/novels/config-concurrent/capabilities/configuration/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(second.status, 409);
    assert.equal((await second.json() as { code?: string }).code, 'CAPABILITY_CONFIGURATION_APPLY_IN_PROGRESS');
    queue.release();
    assert.equal((await first).status, 200);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); closeDb(); }
});

test('chapter technique schedule writes target workflow state and preserves overlays', async () => {
  closeDb(); initDb(':memory:');
  createNovel({ id: 'config-schedule', title: 'Config', authorId: 'local', summary: '', status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [], projectPreferenceProfile: profile(), createdAt: 1, updatedAt: 1 });
  createChapter({ id: 'scheduled-chapter', novelId: 'config-schedule', title: '第一章', content: '', order: 1, wordCount: 0, workflowMeta: { version: 1, capabilityState: { techniqueIds: [], overlayCardIds: ['existing-overlay'], overlayVersions: { 'existing-overlay': 'catalog' }, updatedAt: 1 } }, createdAt: 1, updatedAt: 1 });
  const app = express(); app.use(express.json()); registerWritingStyleRoutes(app);
  const server = app.listen(0); await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const generation = getDatabaseGeneration();
    const capabilityProfile = profile().capabilityProfile;
    const preview = await fetch(`${base}/api/novels/config-schedule/capabilities/configuration/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: generation, capabilityProfile }) });
    const { previewToken } = await preview.json() as { previewToken: string };
    const applied = await fetch(`${base}/api/novels/config-schedule/capabilities/configuration/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: generation, previewToken, capabilityProfile, packageSteps: [
      { stepId: 'schedule-technique', assetId: 'prose-action-booster', mode: 'schedule', trigger: 'before-draft', scope: 'chapter', order: 1, required: false },
    ], targetChapterId: 'scheduled-chapter' }) });
    assert.equal(applied.status, 200);
    assert.equal((await applied.json() as { items: Array<{ status: string }> }).items[0].status, 'scheduled');
    const state = getChapter('scheduled-chapter')?.workflowMeta?.capabilityState;
    assert.deepEqual(state?.techniqueIds, ['prose-action-booster']);
    assert.deepEqual(state?.overlayCardIds, ['existing-overlay']);
    assert.deepEqual(state?.overlayVersions, { 'existing-overlay': 'catalog' });
    assert.deepEqual(state?.techniqueVersions, { 'prose-action-booster': '3' });
    assert.equal(state?.novelId, 'config-schedule');
    assert.equal(state?.databaseGeneration, generation);
    assert.equal(typeof state?.updatedAt, 'number');
    assert.notEqual(state?.updatedAt, 1);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); closeDb(); }
});

test('chapter technique schedule rejects a target chapter from another novel without writes', async () => {
  closeDb(); initDb(':memory:');
  createNovel({ id: 'config-owner', title: 'Config', authorId: 'local', summary: '', status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [], projectPreferenceProfile: profile(), createdAt: 1, updatedAt: 1 });
  createNovel({ id: 'config-other', title: 'Other', authorId: 'local', summary: '', status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [], projectPreferenceProfile: profile(), createdAt: 1, updatedAt: 1 });
  createChapter({ id: 'foreign-chapter', novelId: 'config-other', title: 'Other', content: '', order: 1, wordCount: 0, createdAt: 1, updatedAt: 1 });
  const app = express(); app.use(express.json()); registerWritingStyleRoutes(app);
  const server = app.listen(0); await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const generation = getDatabaseGeneration();
    const capabilityProfile = profile().capabilityProfile;
    const preview = await fetch(`${base}/api/novels/config-owner/capabilities/configuration/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: generation, capabilityProfile }) });
    const { previewToken } = await preview.json() as { previewToken: string };
    const applied = await fetch(`${base}/api/novels/config-owner/capabilities/configuration/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: generation, previewToken, capabilityProfile, packageSteps: [
      { stepId: 'schedule-foreign', assetId: 'prose-action-booster', mode: 'schedule', trigger: 'before-draft', scope: 'chapter', order: 1, required: false },
    ], targetChapterId: 'foreign-chapter' }) });
    assert.equal(applied.status, 400);
    assert.equal(getNovel('config-owner')?.projectPreferenceProfile?.capabilityProfile?.activeFlowId, 'xiaofeiji-novel-flow');
    assert.equal(getChapter('foreign-chapter')?.workflowMeta?.capabilityState, undefined);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); closeDb(); }
});

test('capability configuration rejects guardrail candidates that cannot run as system checks', async () => {
  closeDb(); initDb(':memory:');
  createNovel({ id: 'config-guardrail', title: 'Config', authorId: 'local', summary: '', status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [], projectPreferenceProfile: profile(), createdAt: 1, updatedAt: 1 });
  const app = express(); app.use(express.json()); registerWritingStyleRoutes(app);
  const server = app.listen(0); await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const generation = getDatabaseGeneration();
    const response = await fetch(`${base}/api/novels/config-guardrail/capabilities/configuration/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      databaseGeneration: generation,
      capabilityProfile: { ...profile().capabilityProfile, guardrailIds: ['licensed-cthulhu-style'] },
    }) });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, 'CAPABILITY_GUARDRAIL_UNAVAILABLE');
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); closeDb(); }
});

test('capability configuration rejects non-technique favorite capabilities before saving', async () => {
  closeDb(); initDb(':memory:');
  createNovel({ id: 'config-technique', title: 'Config', authorId: 'local', summary: '', status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [], projectPreferenceProfile: profile(), createdAt: 1, updatedAt: 1 });
  const app = express(); app.use(express.json()); registerWritingStyleRoutes(app);
  const server = app.listen(0); await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const generation = getDatabaseGeneration();
    const response = await fetch(`${base}/api/novels/config-technique/capabilities/configuration/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      databaseGeneration: generation,
      capabilityProfile: { ...profile().capabilityProfile, favoriteTechniqueIds: ['style-ancient-elegance'] },
    }) });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, 'TECHNIQUE_KIND_INVALID');
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); closeDb(); }
});

test('capability configuration rejects stale token without writing', async () => {
  closeDb(); initDb(':memory:');
  createNovel({ id: 'config-stale', title: 'Config', authorId: 'local', summary: '', status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [], projectPreferenceProfile: profile(), createdAt: 1, updatedAt: 1 });
  const app = express(); app.use(express.json()); registerWritingStyleRoutes(app);
  const server = app.listen(0); await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const response = await fetch(`${base}/api/novels/config-stale/capabilities/configuration/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: getDatabaseGeneration(), previewToken: 'missing', capabilityProfile: profile().capabilityProfile }) });
    assert.equal(response.status, 409);
    assert.equal(getNovel('config-stale')?.projectPreferenceProfile?.capabilityProfile?.activeFlowId, 'xiaofeiji-novel-flow');
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); closeDb(); }
});

test('capability configuration persists a normalized source-to-skill membership and rejects mismatches', async () => {
  closeDb(); initDb(':memory:');
  createNovel({ id: 'config-membership', title: 'Config', authorId: 'local', summary: '', status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [], projectPreferenceProfile: profile(), createdAt: 1, updatedAt: 1 });
  createSkill({
    id: 'persisted-style-card', name: 'Style', description: '', style: 'short sentences', pacing: '',
    stabilityScore: 80, evaluationFeedback: '', version: 3, parentSkillId: 'style-ancient-elegance',
    sourceType: 'plaza', sourceBadge: 'manual', deconstructionCardType: 'style-card', executionScore: 80,
    isRuntimeReady: true, sanitizationStatus: 'runtime-ready', runtimeStatus: 'active', createdAt: 1,
  });
  const app = express(); app.use(express.json()); registerWritingStyleRoutes(app);
  const server = app.listen(0); await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const generation = getDatabaseGeneration();
    const membership = { sourceId: 'style-ancient-elegance', sourceVersion: '3', sourceType: 'plaza', persistedSkillId: 'persisted-style-card' };
    const capabilityProfile = { ...profile().capabilityProfile, capabilityMemberships: [membership, membership] };
    const preview = await fetch(`${base}/api/novels/config-membership/capabilities/configuration/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: generation, capabilityProfile }) });
    assert.equal(preview.status, 200);
    const previewBody = await preview.json() as { previewToken: string; profile: { capabilityMemberships: typeof membership[] } };
    assert.deepEqual(previewBody.profile.capabilityMemberships, [membership]);
    const applied = await fetch(`${base}/api/novels/config-membership/capabilities/configuration/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: generation, previewToken: previewBody.previewToken, capabilityProfile }) });
    assert.equal(applied.status, 200);
    assert.deepEqual(getNovel('config-membership')?.projectPreferenceProfile?.capabilityProfile?.capabilityMemberships, [membership]);

    const mismatch = { ...capabilityProfile, capabilityMemberships: [{ ...membership, sourceId: 'forged-source' }] };
    const rejected = await fetch(`${base}/api/novels/config-membership/capabilities/configuration/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: generation, capabilityProfile: mismatch }) });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json() as { code: string }).code, 'CAPABILITY_MEMBERSHIP_MISMATCH');
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); closeDb(); }
});
