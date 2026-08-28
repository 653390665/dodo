import test, { after } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

import { closeDb, createContinuationPack, updateContinuationPack, createNovel, createContinuationExtractionJob, getContinuationExtractionJob, initDb } from '../server/lib/db.js';
import { buildSyncExtractionChunks } from '../shared/lib/sync-extraction-chunks.js';
import { advanceDatabaseGeneration, getDatabaseGeneration, getDb, holdWriteQueue } from '../server/lib/db-instance.js';
import { getConfig, reloadConfig } from '../server/lib/config.js';
import { registerContinuationRoutes } from '../server/routes/continuation.js';

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-extraction-recovery-')), 'test.db');
const novelId = 'recovery-novel';
const packId = 'recovery-pack';
const valid = JSON.stringify({ characters: [{ name: '张三', role: 'protagonist', summary: '剑客', bio: '', traits: [] }], locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [], relationships: [], globalOutline: '', worldRules: '' });

function makePack() {
  const now = Date.now();
  return { id: packId, novelId, title: '恢复测试', status: 'approved' as const, sourceDocuments: [
    { id: 'doc-a', packId, filename: 'a.txt', kind: 'other' as const, text: '第一批资料。'.repeat(5000), excerpt: '', createdAt: now },
    { id: 'doc-b', packId, filename: 'b.txt', kind: 'other' as const, text: '第二批资料。'.repeat(5000), excerpt: '', createdAt: now },
  ], canonFacts: [], characterStates: [], plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' }, styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' }, contradictions: [], continuationTask: '', createdAt: now, updatedAt: now };
}

async function startServer() {
  const app = express();
  app.use(express.json());
  registerContinuationRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function seedInterruptedJob(generation: number) {
  createContinuationExtractionJob({ id: 'extract-recovery-job', packId, novelId, status: 'running', progress: 45, stageText: '分析中', batchCursor: 1, totalBatches: 2, databaseGeneration: generation, createdAt: Date.now(), updatedAt: Date.now(), checkpointJson: JSON.stringify({ traceId: 'trace-recovery', completedResults: [], completedChunkIndexes: [0], failedChunk: { index: 1, code: 'EXTRACTION_NETWORK', attempt: 1 }, chunkMeta: [{ index: 0, filename: 'a.txt', charCount: 30000 }, { index: 1, filename: 'b.txt', charCount: 30000 }] }) });
}

test('restart marks stale extraction jobs interrupted and explicit resume reuses checkpoint/job id', async () => {
  closeDb();
  initDb(dbPath);
  createNovel({ id: novelId, title: '恢复测试', authorId: 'local', summary: '', status: 'ongoing', createdAt: Date.now(), updatedAt: Date.now() });
  createContinuationPack(makePack());
  const generation = getDatabaseGeneration();
  seedInterruptedJob(generation);
  createContinuationExtractionJob({ id: 'extract-queued-recovery-job', packId, novelId, status: 'queued', progress: 0, stageText: '等待提取', batchCursor: 0, totalBatches: 2, databaseGeneration: generation, createdAt: Date.now(), updatedAt: Date.now() });
  const originalConfig = { apiKey: getConfig().apiKey, baseUrl: getConfig().baseUrl, model: getConfig().model };
  const originalFetch = globalThis.fetch;
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-recovery-config-'));
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ apiKey: 'test-key', baseUrl: 'https://recovery.test/v1', model: 'test-model' }));
  process.env.INKFLOW_CONFIG_DIR = configDir;
  reloadConfig();
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/chat/completions')) { calls += 1; await new Promise(resolve => setTimeout(resolve, 100)); return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: valid } }] })); }
    return originalFetch(input, init);
  };
  const { server, baseUrl } = await startServer();
  try {
    const getBefore = await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-recovery-job`);
    assert.equal(getBefore.status, 200);
    assert.equal((await getBefore.json()).status, 'interrupted');
    const queuedBefore = await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-queued-recovery-job`);
    assert.equal(queuedBefore.status, 200);
    assert.equal((await queuedBefore.json()).status, 'interrupted');
    assert.equal(calls, 0);
    const [first, second] = await Promise.all([
      fetch(`${baseUrl}/api/continuation-packs/jobs/extract-recovery-job/resume`, { method: 'POST' }),
      fetch(`${baseUrl}/api/continuation-packs/jobs/extract-recovery-job/resume`, { method: 'POST' }),
    ]);
    assert.equal(first.status, 202, await first.clone().text());
    assert.equal(second.status, 202);
    for (let i = 0; i < 100; i += 1) {
      const job = await (await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-recovery-job`)).json() as any;
      if (job.status === 'completed') break;
      if (job.status === 'failed') throw new Error(`${job.code}: ${job.error}`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const stored = getContinuationExtractionJob('extract-recovery-job');
    assert.equal(stored?.status, 'completed');
    assert.equal(calls, 1);
    assert.equal((await (await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-recovery-job`)).json() as any).traceId, 'trace-recovery');
  } finally {
    server.close();
    globalThis.fetch = originalFetch;
    getConfig().apiKey = originalConfig.apiKey; getConfig().baseUrl = originalConfig.baseUrl; getConfig().model = originalConfig.model;
    delete process.env.INKFLOW_CONFIG_DIR;
    fs.rmSync(configDir, { recursive: true, force: true });
    reloadConfig();
  }
});

test('stale terminal extraction jobs are pruned from persisted storage after ttl', async () => {
  const generation = getDatabaseGeneration();
  const extraction = JSON.parse(valid);
  const staleUpdatedAt = Date.now() - 31 * 60 * 1000;
  createContinuationExtractionJob({
    id: 'extract-stale-terminal-job',
    packId,
    novelId,
    status: 'completed',
    progress: 100,
    stageText: '提取完成',
    batchCursor: 2,
    totalBatches: 2,
    databaseGeneration: generation,
    createdAt: staleUpdatedAt,
    updatedAt: staleUpdatedAt,
    resultJson: JSON.stringify({ packId, novelId, databaseGeneration: generation, extraction }),
  });
  createContinuationExtractionJob({
    id: 'extract-recent-terminal-job',
    packId,
    novelId,
    status: 'completed',
    progress: 100,
    stageText: '提取完成',
    batchCursor: 2,
    totalBatches: 2,
    databaseGeneration: generation,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    resultJson: JSON.stringify({ packId, novelId, databaseGeneration: generation, extraction }),
  });
  const { server, baseUrl } = await startServer();
  try {
    const stale = await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-stale-terminal-job`);
    assert.equal(stale.status, 404);
    assert.equal(getContinuationExtractionJob('extract-stale-terminal-job'), undefined);
    const recent = await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-recent-terminal-job`);
    assert.equal(recent.status, 200);
    assert.equal((await recent.json() as any).status, 'completed');
  } finally {
    server.close();
  }
});

test('cancel hydrates persisted terminal extraction jobs without pretending to cancel', async () => {
  const generation = getDatabaseGeneration();
  createContinuationExtractionJob({
    id: 'extract-interrupted-db-only-job',
    packId,
    novelId,
    status: 'interrupted',
    progress: 45,
    stageText: '提取已中断',
    batchCursor: 1,
    totalBatches: 2,
    databaseGeneration: generation,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    checkpointJson: JSON.stringify({ traceId: 'trace-cancel-terminal', failedChunk: { index: 1, code: 'EXTRACTION_NETWORK', attempt: 1 } }),
    errorCode: 'EXTRACTION_NETWORK',
    errorMessage: '网络中断',
  });
  const { server, baseUrl } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-interrupted-db-only-job/cancel`, { method: 'POST' });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.cancelled, false);
    assert.equal(body.job.status, 'interrupted');
    assert.equal(body.job.traceId, 'trace-cancel-terminal');
    assert.equal(getContinuationExtractionJob('extract-interrupted-db-only-job')?.status, 'interrupted');
  } finally {
    server.close();
  }
});

test('cancel can mark a db-only active extraction job as explicitly cancelled', async () => {
  const generation = getDatabaseGeneration();
  const { server, baseUrl } = await startServer();
  try {
    createContinuationExtractionJob({
      id: 'extract-running-db-only-job',
      packId,
      novelId,
      status: 'running',
      progress: 20,
      stageText: '正在提取',
      batchCursor: 1,
      totalBatches: 2,
      databaseGeneration: generation,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      checkpointJson: JSON.stringify({ traceId: 'trace-cancel-active' }),
    });
    const response = await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-running-db-only-job/cancel`, { method: 'POST' });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.cancelled, true);
    assert.equal(body.job.status, 'failed');
    assert.equal(body.job.code, 'EXTRACTION_CANCELLED');
    assert.equal(body.job.traceId, 'trace-cancel-active');
    const stored = getContinuationExtractionJob('extract-running-db-only-job');
    assert.equal(stored?.status, 'failed');
    assert.equal(stored?.errorCode, 'EXTRACTION_CANCELLED');
  } finally {
    server.close();
  }
});

test('job creation persists initial trace and chunk metadata before runner checkpoint', async () => {
  const writeHold = holdWriteQueue();
  const originalConfig = { apiKey: getConfig().apiKey, baseUrl: getConfig().baseUrl, model: getConfig().model };
  const originalFetch = globalThis.fetch;
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-initial-checkpoint-config-'));
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ apiKey: 'test-key', baseUrl: 'https://recovery.test/v1', model: 'test-model' }));
  process.env.INKFLOW_CONFIG_DIR = configDir;
  reloadConfig();
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/chat/completions')) return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: valid } }] }));
    return originalFetch(input, init);
  };
  let jobId: string | undefined;
  const { server, baseUrl } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packId, novelId, databaseGeneration: getDatabaseGeneration() }) });
    assert.equal(response.status, 202, await response.clone().text());
    const started = await response.json() as { jobId: string; traceId: string };
    jobId = started.jobId;
    await writeHold.waitForQueued(1);
    const stored = getContinuationExtractionJob(started.jobId);
    assert.equal(stored?.status, 'queued');
    const checkpoint = JSON.parse(stored?.checkpointJson || '{}') as any;
    assert.equal(checkpoint.traceId, started.traceId);
    assert.equal(checkpoint.completedResults.length, 0);
    assert.equal(checkpoint.completedChunkIndexes.length, 0);
    assert.equal(checkpoint.chunkMeta.length, 2);
    assert.equal(typeof checkpoint.chunkMeta[0].sha256, 'string');
  } finally {
    writeHold.release();
    if (jobId) {
      for (let i = 0; i < 100; i += 1) {
        const stored = getContinuationExtractionJob(jobId);
        if (stored?.status === 'completed' || stored?.status === 'failed') break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    server.close();
    globalThis.fetch = originalFetch;
    getConfig().apiKey = originalConfig.apiKey; getConfig().baseUrl = originalConfig.baseUrl; getConfig().model = originalConfig.model;
    delete process.env.INKFLOW_CONFIG_DIR;
    fs.rmSync(configDir, { recursive: true, force: true });
    reloadConfig();
  }
});

test('persisted resume provider failure preserves provider diagnostics', async () => {
  const generation = getDatabaseGeneration();
  const chunks = buildSyncExtractionChunks(makePack().sourceDocuments);
  createContinuationExtractionJob({
    id: 'extract-provider-failure-resume',
    packId,
    novelId,
    status: 'failed',
    progress: 45,
    stageText: '失败',
    batchCursor: 1,
    totalBatches: chunks.length,
    databaseGeneration: generation,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    checkpointJson: JSON.stringify({
      traceId: 'trace-provider-resume',
      failedChunk: { index: 1, code: 'EXTRACTION_NETWORK', attempt: 1 },
      chunkMeta: chunks.map(chunk => ({ index: chunk.index, filename: chunk.filename, charCount: chunk.text.length, sha256: createHash('sha256').update(chunk.text).digest('hex') })),
    }),
    errorCode: 'EXTRACTION_NETWORK',
    errorMessage: '网络中断',
  });
  const originalConfig = { apiKey: getConfig().apiKey, baseUrl: getConfig().baseUrl, model: getConfig().model };
  const originalFetch = globalThis.fetch;
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-provider-resume-config-'));
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ apiKey: 'test-key', baseUrl: 'https://recovery.test/v1', model: 'test-model' }));
  process.env.INKFLOW_CONFIG_DIR = configDir;
  reloadConfig();
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/chat/completions')) return new Response(JSON.stringify({ error: { message: 'temporary outage' } }), { status: 500 });
    return originalFetch(input, init);
  };
  const { server, baseUrl } = await startServer();
  try {
    const resume = await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-provider-failure-resume/resume`, { method: 'POST' });
    assert.equal(resume.status, 202, await resume.clone().text());
    let job: any;
    for (let i = 0; i < 100; i += 1) {
      job = await (await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-provider-failure-resume`)).json();
      if (job.status === 'failed' && job.code !== 'EXTRACTION_NETWORK') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(job.status, 'failed');
    assert.equal(job.code, 'EXTRACTION_SERVICE_UNAVAILABLE');
    assert.equal(job.traceId, 'trace-provider-resume');
    assert.equal(job.outputDiagnostic?.providerHttpStatus, 500);
    assert.equal(job.outputDiagnostic?.compatibilityMode, 'none');
    assert.ok((job.failedChunk?.providerRequestCount || 0) >= 1);
    assert.equal(getContinuationExtractionJob('extract-provider-failure-resume')?.errorCode, 'EXTRACTION_SERVICE_UNAVAILABLE');
  } finally {
    server.close();
    globalThis.fetch = originalFetch;
    getConfig().apiKey = originalConfig.apiKey; getConfig().baseUrl = originalConfig.baseUrl; getConfig().model = originalConfig.model;
    delete process.env.INKFLOW_CONFIG_DIR;
    fs.rmSync(configDir, { recursive: true, force: true });
    reloadConfig();
  }
});

test('persisted resume schema mismatch preserves schema issues', async () => {
  const generation = getDatabaseGeneration();
  const chunks = buildSyncExtractionChunks(makePack().sourceDocuments);
  createContinuationExtractionJob({
    id: 'extract-schema-failure-resume',
    packId,
    novelId,
    status: 'failed',
    progress: 45,
    stageText: '失败',
    batchCursor: 1,
    totalBatches: chunks.length,
    databaseGeneration: generation,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    checkpointJson: JSON.stringify({
      traceId: 'trace-schema-resume',
      failedChunk: { index: 1, code: 'EXTRACTION_NETWORK', attempt: 1 },
      chunkMeta: chunks.map(chunk => ({ index: chunk.index, filename: chunk.filename, charCount: chunk.text.length, sha256: createHash('sha256').update(chunk.text).digest('hex') })),
    }),
    errorCode: 'EXTRACTION_NETWORK',
    errorMessage: '网络中断',
  });
  const originalConfig = { apiKey: getConfig().apiKey, baseUrl: getConfig().baseUrl, model: getConfig().model };
  const originalFetch = globalThis.fetch;
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-schema-resume-config-'));
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ apiKey: 'test-key', baseUrl: 'https://recovery.test/v1', model: 'test-model' }));
  process.env.INKFLOW_CONFIG_DIR = configDir;
  reloadConfig();
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/chat/completions')) return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"relationships":[{"sourceName":"张三","sourceType":"unknown","targetName":"张三","targetType":"character","relationshipType":"同一人"}]}' } }] }));
    return originalFetch(input, init);
  };
  const { server, baseUrl } = await startServer();
  try {
    const resume = await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-schema-failure-resume/resume`, { method: 'POST' });
    assert.equal(resume.status, 202, await resume.clone().text());
    let job: any;
    for (let i = 0; i < 100; i += 1) {
      job = await (await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-schema-failure-resume`)).json();
      if (job.status === 'failed' && job.code === 'EXTRACTION_SCHEMA_MISMATCH') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(job.status, 'failed');
    assert.equal(job.code, 'EXTRACTION_SCHEMA_MISMATCH');
    assert.equal(job.traceId, 'trace-schema-resume');
    assert.ok(job.schemaIssues?.length);
    const stored = getContinuationExtractionJob('extract-schema-failure-resume');
    assert.equal(stored?.errorCode, 'EXTRACTION_SCHEMA_MISMATCH');
    const checkpoint = JSON.parse(stored?.checkpointJson || '{}') as any;
    assert.ok(checkpoint.schemaIssues?.length);
  } finally {
    server.close();
    globalThis.fetch = originalFetch;
    getConfig().apiKey = originalConfig.apiKey; getConfig().baseUrl = originalConfig.baseUrl; getConfig().model = originalConfig.model;
    delete process.env.INKFLOW_CONFIG_DIR;
    fs.rmSync(configDir, { recursive: true, force: true });
    reloadConfig();
  }
});

test('resume rejects a database generation mismatch without provider call', async () => {
  const generation = getDatabaseGeneration();
  createContinuationExtractionJob({ id: 'extract-generation-mismatch', packId, novelId, status: 'failed', progress: 100, stageText: '失败', batchCursor: 1, totalBatches: 2, databaseGeneration: generation + 1, createdAt: Date.now(), updatedAt: Date.now(), checkpointJson: JSON.stringify({ traceId: 'trace-generation', failedChunk: { index: 1, code: 'EXTRACTION_NETWORK', attempt: 1 }, chunkMeta: [{ index: 0, filename: 'a.txt', charCount: 30000 }, { index: 1, filename: 'b.txt', charCount: 30000 }] }), errorCode: 'EXTRACTION_NETWORK' });
  const { server, baseUrl } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-generation-mismatch/resume`, { method: 'POST' });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'GENERATION_MISMATCH');
  } finally {
    server.close();
  }
});

test('corrupt checkpoint is exposed as a failed protocol error and cannot resume', async () => {
  const generation = getDatabaseGeneration();
  createContinuationExtractionJob({ id: 'extract-corrupt-checkpoint', packId, novelId, status: 'running', progress: 45, stageText: '分析中', batchCursor: 1, totalBatches: 2, databaseGeneration: generation, createdAt: Date.now(), updatedAt: Date.now(), checkpointJson: '{"completedResults":' });
  const { server, baseUrl } = await startServer();
  try {
    const getResponse = await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-corrupt-checkpoint`);
    assert.equal(getResponse.status, 200);
    const job = await getResponse.json() as any;
    assert.equal(job.status, 'failed');
    assert.equal(job.code, 'EXTRACTION_PROTOCOL_ERROR');
    assert.equal(job.databaseGeneration, generation);
    assert.equal(job.currentChunk, 1);
    assert.match(job.error, /检查点损坏/);
    const resume = await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-corrupt-checkpoint/resume`, { method: 'POST' });
    assert.equal(resume.status, 409);
    assert.equal((await resume.json()).code, 'EXTRACTION_RESUME_UNAVAILABLE');
  } finally {
    server.close();
  }
});

test('corrupt result snapshot preserves checkpoint batches and cannot resume', async () => {
  const generation = getDatabaseGeneration();
  createContinuationExtractionJob({ id: 'extract-corrupt-result', packId, novelId, status: 'completed', progress: 100, stageText: '提取完成', batchCursor: 2, totalBatches: 2, databaseGeneration: generation, createdAt: Date.now(), updatedAt: Date.now(), checkpointJson: JSON.stringify({ completedChunkIndexes: [0, 1], chunkMeta: [{ index: 0, filename: 'a.txt', charCount: 30000 }, { index: 1, filename: 'b.txt', charCount: 30000 }] }), resultJson: '{"packId":' });
  const { server, baseUrl } = await startServer();
  try {
    const getResponse = await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-corrupt-result`);
    assert.equal(getResponse.status, 200);
    const job = await getResponse.json() as any;
    assert.equal(job.status, 'failed');
    assert.equal(job.code, 'EXTRACTION_PROTOCOL_ERROR');
    assert.equal(job.totalChunks, 2);
    assert.equal(job.currentChunk, 2);
    assert.deepEqual(job.completedChunkIndexes, [0, 1]);
    const resume = await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-corrupt-result/resume`, { method: 'POST' });
    assert.equal(resume.status, 409);
    assert.equal((await resume.json()).code, 'EXTRACTION_RESUME_UNAVAILABLE');
  } finally {
    server.close();
  }
});

test('completed job without a valid result is downgraded to a protocol failure', async () => {
  const generation = getDatabaseGeneration();
  createContinuationExtractionJob({ id: 'extract-missing-result', packId, novelId, status: 'completed', progress: 100, stageText: '提取完成', batchCursor: 2, totalBatches: 2, databaseGeneration: generation, createdAt: Date.now(), updatedAt: Date.now(), checkpointJson: JSON.stringify({ completedChunkIndexes: [0, 1], chunkMeta: [{ index: 0, filename: 'a.txt', charCount: 30000 }, { index: 1, filename: 'b.txt', charCount: 30000 }] }) });
  const { server, baseUrl } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-missing-result`);
    assert.equal(response.status, 200);
    const job = await response.json() as any;
    assert.equal(job.status, 'failed');
    assert.equal(job.code, 'EXTRACTION_PROTOCOL_ERROR');
    assert.equal(job.databaseGeneration, generation);
    assert.deepEqual(job.completedChunkIndexes, [0, 1]);
    const resume = await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-missing-result/resume`, { method: 'POST' });
    assert.equal(resume.status, 409);
    assert.equal((await resume.json()).code, 'EXTRACTION_RESUME_UNAVAILABLE');
  } finally {
    server.close();
  }
});

test('structurally corrupt checkpoint is normalized without throwing or resuming', async () => {
  const generation = getDatabaseGeneration();
  createContinuationExtractionJob({ id: 'extract-invalid-checkpoint-shape', packId, novelId, status: 'failed', progress: 45, stageText: '分析中', batchCursor: 1, totalBatches: 2, databaseGeneration: generation, createdAt: Date.now(), updatedAt: Date.now(), checkpointJson: JSON.stringify({ completedChunkIndexes: '0', failedChunk: { index: '1', code: 7 }, chunkMeta: [{ index: 0, filename: 'a.txt', charCount: 30000 }] }), errorCode: 'EXTRACTION_NETWORK' });
  const { server, baseUrl } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-invalid-checkpoint-shape`);
    assert.equal(response.status, 200);
    const job = await response.json() as any;
    assert.equal(job.status, 'failed');
    assert.equal(job.code, 'EXTRACTION_PROTOCOL_ERROR');
    assert.equal(job.totalChunks, 2);
    assert.equal(job.currentChunk, 1);
    assert.deepEqual(job.completedChunkIndexes, []);
    const resume = await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-invalid-checkpoint-shape/resume`, { method: 'POST' });
    assert.equal(resume.status, 409);
    assert.equal((await resume.json()).code, 'EXTRACTION_RESUME_UNAVAILABLE');
  } finally {
    server.close();
  }
});

test('resume rejects same-length source changes when checkpoint hashes differ', async () => {
  const originalPack = makePack();
  const chunks = buildSyncExtractionChunks(originalPack.sourceDocuments);
  const generation = getDatabaseGeneration();
  createContinuationExtractionJob({ id: 'extract-content-mismatch', packId, novelId, status: 'failed', progress: 100, stageText: '失败', batchCursor: 1, totalBatches: chunks.length, databaseGeneration: generation, createdAt: Date.now(), updatedAt: Date.now(), checkpointJson: JSON.stringify({ failedChunk: { index: 0, code: 'EXTRACTION_NETWORK', attempt: 1 }, chunkMeta: chunks.map(chunk => ({ index: chunk.index, filename: chunk.filename, charCount: chunk.text.length, sha256: createHash('sha256').update(chunk.text).digest('hex') })) }), errorCode: 'EXTRACTION_NETWORK' });
  const changedPack = { ...originalPack, sourceDocuments: originalPack.sourceDocuments.map((document, index) => index === 0 ? { ...document, text: document.text.replace('第一', '第二') } : document) };
  updateContinuationPack(packId, { sourceDocuments: changedPack.sourceDocuments });
  const { server, baseUrl } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/continuation-packs/jobs/extract-content-mismatch/resume`, { method: 'POST' });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'EXTRACTION_CHECKPOINT_MISMATCH');
  } finally {
    server.close();
    updateContinuationPack(packId, { sourceDocuments: originalPack.sourceDocuments });
  }
});

test('same-process failed runner rechecks changed source before resume', async () => {
  const originalConfig = { apiKey: getConfig().apiKey, baseUrl: getConfig().baseUrl, model: getConfig().model };
  const originalFetch = globalThis.fetch;
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-runner-recovery-config-'));
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ apiKey: 'test-key', baseUrl: 'https://recovery.test/v1', model: 'test-model' }));
  process.env.INKFLOW_CONFIG_DIR = configDir;
  reloadConfig();
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/chat/completions')) {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: 'temporary failure' } }), { status: 500 });
    }
    return originalFetch(input, init);
  };
  const originalPack = makePack();
  const { server, baseUrl } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packId, novelId, databaseGeneration: getDatabaseGeneration() }) });
    assert.equal(response.status, 202, await response.clone().text());
    let stored: ReturnType<typeof getContinuationExtractionJob>;
    for (let i = 0; i < 100; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 10));
      stored = getContinuationExtractionJob(JSON.parse(await response.clone().text()).jobId);
      if (stored?.status === 'failed') break;
    }
    assert.equal(stored?.status, 'failed');
    assert.equal(calls, 1);
    updateContinuationPack(packId, { sourceDocuments: originalPack.sourceDocuments.map((document, index) => index === 0 ? { ...document, text: document.text.replace('第一', '第二') } : document) });
    const resume = await fetch(`${baseUrl}/api/continuation-packs/jobs/${stored!.id}/resume`, { method: 'POST' });
    assert.equal(resume.status, 409);
    assert.equal((await resume.json()).code, 'EXTRACTION_CHECKPOINT_MISMATCH');
    assert.equal(calls, 1);
  } finally {
    server.close();
    updateContinuationPack(packId, { sourceDocuments: originalPack.sourceDocuments });
    globalThis.fetch = originalFetch;
    getConfig().apiKey = originalConfig.apiKey; getConfig().baseUrl = originalConfig.baseUrl; getConfig().model = originalConfig.model;
    delete process.env.INKFLOW_CONFIG_DIR;
    fs.rmSync(configDir, { recursive: true, force: true });
    reloadConfig();
  }
});

test('checkpoint write failure is observable and cannot masquerade as resumable progress', async () => {
  const writeHold = holdWriteQueue();
  const { server, baseUrl } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packId, novelId, databaseGeneration: getDatabaseGeneration() }) });
    assert.equal(response.status, 202, await response.clone().text());
    const { jobId } = await response.json() as { jobId: string };
    await writeHold.waitForQueued(1);
    getDb().prepare('DELETE FROM continuation_extraction_jobs WHERE id = ?').run(jobId);
    writeHold.release();

    let job: any;
    for (let i = 0; i < 100; i += 1) {
      job = await (await fetch(`${baseUrl}/api/continuation-packs/jobs/${jobId}`)).json();
      if (job.status === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(job.status, 'failed');
    assert.equal(job.code, 'EXTRACTION_CHECKPOINT_PERSIST_FAILED');
    assert.match(job.error, /保存失败/);
    assert.equal(getContinuationExtractionJob(jobId), undefined);

    const resume = await fetch(`${baseUrl}/api/continuation-packs/jobs/${jobId}/resume`, { method: 'POST' });
    assert.equal(resume.status, 409);
    assert.equal((await resume.json()).code, 'EXTRACTION_RESUME_UNAVAILABLE');
  } finally {
    writeHold.release();
    server.close();
  }
});

test('running extraction does not write old job state into a new database generation', async () => {
  const originalConfig = { apiKey: getConfig().apiKey, baseUrl: getConfig().baseUrl, model: getConfig().model };
  const originalFetch = globalThis.fetch;
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-generation-config-'));
  const replacementDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-generation-db-')), 'replacement.db');
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ apiKey: 'test-key', baseUrl: 'https://recovery.test/v1', model: 'test-model' }));
  process.env.INKFLOW_CONFIG_DIR = configDir;
  reloadConfig();
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/chat/completions')) {
      await new Promise(resolve => setTimeout(resolve, 150));
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: valid } }] }));
    }
    return originalFetch(input, init);
  };
  const { server, baseUrl } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packId, novelId, databaseGeneration: getDatabaseGeneration() }) });
    assert.equal(response.status, 202, await response.clone().text());
    const { jobId } = await response.json() as { jobId: string };
    await new Promise(resolve => setTimeout(resolve, 20));
    advanceDatabaseGeneration();
    closeDb();
    initDb(replacementDbPath);
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(getContinuationExtractionJob(jobId), undefined);
  } finally {
    server.close();
    globalThis.fetch = originalFetch;
    closeDb();
    initDb(dbPath);
    getConfig().apiKey = originalConfig.apiKey; getConfig().baseUrl = originalConfig.baseUrl; getConfig().model = originalConfig.model;
    delete process.env.INKFLOW_CONFIG_DIR;
    fs.rmSync(configDir, { recursive: true, force: true });
    fs.rmSync(path.dirname(replacementDbPath), { recursive: true, force: true });
    reloadConfig();
  }
});

after(() => closeDb());
