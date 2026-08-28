import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

test('rewrite missing writing-style fingerprint has no quota or provider side effects', async () => {
  const dbPath = path.join(os.tmpdir(), `inkflow-style-gate-rewrite-${Date.now()}.db`);
  const db = await import('../server/lib/db.js');
  const { closeDb } = await import('../server/lib/db-instance.js');
  const { initDb } = await import('../server/lib/db-init.js');
  const { registerAuditRoutes } = await import('../server/routes/audit.js');
  let providerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (String(url).includes('127.0.0.1') || String(url).includes('localhost')) return originalFetch(url, init); providerCalls += 1; return new Response('{}', { status: 200 }); };
  let server: Server | undefined;
  try {
    closeDb(); initDb(dbPath);
    db.createNovel({ id: 'style-gate-rewrite', title: 'test', authorId: 'local-user', summary: '', status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [], projectPreferenceProfile: { tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 }, acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0, quotaLimits: { advancedAuditCount: 0, advancedAuditMax: 10 } }, createdAt: 1, updatedAt: 1 });
    db.createChapter({ id: 'style-gate-rewrite-chapter', novelId: 'style-gate-rewrite', title: '第一章', content: '原文', order: 1, wordCount: 2, createdAt: 1, updatedAt: 1 });
    assert.equal((await import('../server/helpers/writing-style-service.js')).resolveWritingStyleRequest('style-gate-rewrite').resolution.confirmed, false);
    const app = express(); app.use(express.json()); registerAuditRoutes(app); server = app.listen(0);
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const port = (server.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/rewrite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'style-gate-rewrite', chapterId: 'style-gate-rewrite-chapter', databaseGeneration: (await import('../server/lib/db-instance.js')).getDatabaseGeneration(), text: '原文' }) });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'STYLE_CONFIRMATION_REQUIRED');
    assert.equal(db.getNovel('style-gate-rewrite')?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount, 0);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch; if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); closeDb();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  }
});

test('production start missing writing-style fingerprint creates no run or provider call', async () => {
  const dbPath = path.join(os.tmpdir(), `inkflow-style-gate-production-${Date.now()}.db`);
  const db = await import('../server/lib/db.js');
  const { closeDb, getDatabaseGeneration } = await import('../server/lib/db-instance.js');
  const { initDb } = await import('../server/lib/db-init.js');
  const { registerProductionRoutes } = await import('../server/routes/production.js');
  let providerCalls = 0; const originalFetch = globalThis.fetch; globalThis.fetch = async (url, init) => { if (String(url).includes('127.0.0.1') || String(url).includes('localhost')) return originalFetch(url, init); providerCalls += 1; return new Response('{}', { status: 200 }); };
  let server: Server | undefined;
  try {
    closeDb(); initDb(dbPath); db.createNovel({ id: 'style-gate-production', title: 'test', authorId: 'local-user', summary: '', status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [], projectPreferenceProfile: { tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 }, acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0, quotaLimits: { generateProseCount: 0, generateProseMax: 10 } }, createdAt: 1, updatedAt: 1 });
    db.createChapter({ id: 'style-gate-production-chapter', novelId: 'style-gate-production', title: '第一章', content: '', order: 1, wordCount: 0, createdAt: 1, updatedAt: 1 });
    const app = express(); app.use(express.json()); registerProductionRoutes(app); server = app.listen(0); await new Promise<void>((resolve) => server!.once('listening', resolve)); const port = (server.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/chapter-production-runs/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'style-gate-production', chapterId: 'style-gate-production-chapter', targetChapterId: 'style-gate-production-chapter', databaseGeneration: getDatabaseGeneration(), userIntent: '写作' }) });
    assert.equal(response.status, 409); assert.equal((await response.json()).code, 'STYLE_CONFIRMATION_REQUIRED');
    assert.equal(db.listChapterProductionRuns('style-gate-production').length, 0); assert.equal(providerCalls, 0); assert.equal(db.getNovel('style-gate-production')?.projectPreferenceProfile?.quotaLimits?.generateProseCount, 0);
  } finally { globalThis.fetch = originalFetch; if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); closeDb(); for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true }); }
});

test('critic-only editor-agent path is currently expected to bypass writing-style confirmation', async () => {
  const dbPath = path.join(os.tmpdir(), `inkflow-style-gate-critic-${Date.now()}.db`);
  const db = await import('../server/lib/db.js'); const { closeDb, getDatabaseGeneration } = await import('../server/lib/db-instance.js'); const { initDb } = await import('../server/lib/db-init.js'); const { registerAgentsRoutes } = await import('../server/routes/agents.js');
  const originalFetch = globalThis.fetch; globalThis.fetch = async (url, init) => { if (String(url).includes('127.0.0.1') || String(url).includes('localhost')) return originalFetch(url, init); return new Response('{}', { status: 200 }); }; let server: Server | undefined;
  try {
    closeDb(); initDb(dbPath); db.createNovel({ id: 'style-gate-critic', title: 'test', authorId: 'local-user', summary: '', status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [], projectPreferenceProfile: { tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 }, acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0 }, createdAt: 1, updatedAt: 1 });
    db.createChapter({ id: 'style-gate-critic-chapter', novelId: 'style-gate-critic', title: '第一章', content: '正文', order: 1, wordCount: 2, createdAt: 1, updatedAt: 1 });
    const app = express(); app.use(express.json()); registerAgentsRoutes(app); server = app.listen(0); await new Promise<void>((resolve) => server!.once('listening', resolve)); const port = (server.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/editor-agent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'style-gate-critic', chapterId: 'style-gate-critic-chapter', userIntent: '审稿', contextStr: '正文', surface: 'chapter-review', chain: ['chainConsistencyReview'], databaseGeneration: getDatabaseGeneration() }) });
    assert.notEqual(response.status, 409, 'critic-only review should not require style confirmation');
  } finally { globalThis.fetch = originalFetch; if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); closeDb(); for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true }); }
});

test('writer editor-agent path missing fingerprint returns 409 before creating a job', async () => {
  const dbPath = path.join(os.tmpdir(), `inkflow-style-gate-writer-${Date.now()}.db`);
  const db = await import('../server/lib/db.js'); const { closeDb, getDatabaseGeneration } = await import('../server/lib/db-instance.js'); const { initDb } = await import('../server/lib/db-init.js'); const { registerAgentsRoutes } = await import('../server/routes/agents.js');
  const originalFetch = globalThis.fetch; let providerCalls = 0; globalThis.fetch = async (url, init) => { if (String(url).includes('127.0.0.1') || String(url).includes('localhost')) return originalFetch(url, init); providerCalls += 1; return new Response('{}', { status: 200 }); }; let server: Server | undefined;
  try {
    closeDb(); initDb(dbPath); db.createNovel({ id: 'style-gate-writer', title: 'test', authorId: 'local-user', summary: '', status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [], projectPreferenceProfile: { tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 }, acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0 }, createdAt: 1, updatedAt: 1 });
    db.createChapter({ id: 'style-gate-writer-chapter', novelId: 'style-gate-writer', title: '第一章', content: '正文', order: 1, wordCount: 2, createdAt: 1, updatedAt: 1 });
    const app = express(); app.use(express.json()); registerAgentsRoutes(app); server = app.listen(0); await new Promise<void>((resolve) => server!.once('listening', resolve)); const port = (server.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/editor-agent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'style-gate-writer', chapterId: 'style-gate-writer-chapter', userIntent: '扩写正文', contextStr: '正文', surface: 'workspace-draft', databaseGeneration: getDatabaseGeneration() }) });
    assert.equal(response.status, 409); assert.equal((await response.json()).code, 'STYLE_CONFIRMATION_REQUIRED'); assert.equal(providerCalls, 0);
  } finally { globalThis.fetch = originalFetch; if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); closeDb(); for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true }); }
});
