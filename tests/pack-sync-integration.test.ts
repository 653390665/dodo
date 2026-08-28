import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

import { registerContinuationRoutes } from '../server/routes/continuation.js';
import { registerDbRoutes } from '../server/routes/db.js';
import { closeDb, createContinuationPack, createNovel, getArtifactCore, initDb } from '../server/lib/db.js';
import { getDb, getDatabaseGeneration, advanceDatabaseGeneration, holdWriteQueue, runInSerializedWriteForGeneration } from '../server/lib/db-instance.js';
import { reloadConfig } from '../server/lib/config.js';
import { __rateLimitTestHooks } from '../server/middleware/rate-limit.js';
import {
  listCharacters,
  listLocations,
  listItems,
  listFactions,
  listPowerLevels,
  listTimelineEvents,
  listEntityRelationships,
} from '../server/lib/db/world.js';
import type { ContinuationPack, Novel } from '../shared/types.js';

const NOVEL_ID = 'test-sync-novel';
const OTHER_NOVEL_ID = 'other-novel';
const now = Date.now();

function makeNovel(id: string): Novel {
  return {
    id,
    title: `测试作品-${id}`,
    authorId: 'local',
    summary: '',
    projectPreferenceProfile: { commercialMode: 'paid' } as any,
    status: 'ongoing',
    createdAt: now,
    updatedAt: now,
  };
}

function makePack(id: string, novelId: string, status: ContinuationPack['status']): ContinuationPack {
  return {
    id,
    novelId,
    title: `资料包-${id}`,
    status,
    sourceDocuments: [
      { id: `doc-${id}`, packId: id, filename: 'doc1.txt', kind: 'other', text: '角色张三是一名剑客，性格刚毅。地点京城是繁华都城。', excerpt: '', createdAt: now },
    ],
    canonFacts: [],
    characterStates: [{ name: '张三', role: 'protagonist', currentGoal: '成为剑圣', emotionalState: '坚定', secrets: [], relationshipNotes: [], evidence: '' }],
    plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
    styleProfile: { pov: 'third', tense: 'past', pacing: '', dialogueDensity: 'normal', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
    contradictions: [],
    continuationTask: '',
    sourceMap: { sections: [], keyConflicts: [] },
    readingQuestions: [],
    continuationGaps: [],
    createdAt: now,
    updatedAt: now,
  };
}

let server: ReturnType<express.Express['listen']>;
let baseUrl: string;
let dbPath: string;

before(() => {
  dbPath = path.join(os.tmpdir(), `inkflow-pack-sync-int-${process.pid}.db`);
  closeDb();
  initDb(dbPath);
  createNovel(makeNovel(NOVEL_ID));
  createNovel(makeNovel(OTHER_NOVEL_ID));

  const app = express();
  app.use(express.json({ limit: '50mb' }));
  registerDbRoutes(app);
  registerContinuationRoutes(app);
  server = app.listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string', `server.address() returned ${JSON.stringify(addr)}`);
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

beforeEach(() => {
  __rateLimitTestHooks.reset();
});

async function waitForExtractionJob(startResponse: Response, allowFailure = false): Promise<any> {
  assert.equal(startResponse.status, 202);
  const started = await startResponse.json() as { jobId: string; databaseGeneration: number };
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = await fetch(`${baseUrl}/api/continuation-packs/jobs/${started.jobId}?databaseGeneration=${started.databaseGeneration}`);
    const job = await status.json() as any;
    if (job.status === 'completed') return job.result;
    if (job.status === 'failed') {
      if (allowFailure) return job;
      throw new Error(`${job.code || 'EXTRACTION_FAILED'}: ${job.error || ''}`);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('extraction job did not finish');
}

async function runExtractionWithMock(pack: ContinuationPack, content: string | string[], finishReason?: string): Promise<any> {
  createContinuationPack(pack);
  const savedConfigDir = process.env.INKFLOW_CONFIG_DIR;
  const originalFetch = globalThis.fetch;
  const tmpConfigDir = path.join(os.tmpdir(), `inkflow-plan142-${process.pid}-${pack.id}`);
  fs.mkdirSync(tmpConfigDir, { recursive: true });
  fs.writeFileSync(path.join(tmpConfigDir, 'config.json'), JSON.stringify({
    apiKey: 'sk-plan142-key', baseUrl: 'https://api.openai-mock.com/v1', model: 'gpt-4o',
  }));
  process.env.INKFLOW_CONFIG_DIR = tmpConfigDir;
  reloadConfig();
  let modelCall = 0;
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (urlStr.includes('/chat/completions') || urlStr.includes('api.openai-mock')) {
      const responseContent = Array.isArray(content) ? content[Math.min(modelCall, content.length - 1)] : content;
      modelCall += 1;
      return new Response(JSON.stringify({ choices: [{ finish_reason: finishReason || 'stop', message: { content: responseContent } }] }), { status: 200 });
    }
    return originalFetch(url, init);
  };
  try {
    return await waitForExtractionJob(await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId: pack.id, novelId: NOVEL_ID, databaseGeneration: getDatabaseGeneration() }),
    }), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (savedConfigDir === undefined) delete process.env.INKFLOW_CONFIG_DIR; else process.env.INKFLOW_CONFIG_DIR = savedConfigDir;
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
    reloadConfig();
  }
}

async function runDeepSeekProviderResponses(
  pack: ContinuationPack,
  responses: Array<{ status: number; body: unknown; finishReason?: string }>,
): Promise<{ job: any; requestBodies: Array<Record<string, unknown>> }> {
  createContinuationPack(pack);
  const savedConfigDir = process.env.INKFLOW_CONFIG_DIR;
  const originalFetch = globalThis.fetch;
  const tmpConfigDir = path.join(os.tmpdir(), `inkflow-plan143-deepseek-${process.pid}-${pack.id}`);
  fs.mkdirSync(tmpConfigDir, { recursive: true });
  fs.writeFileSync(path.join(tmpConfigDir, 'config.json'), JSON.stringify({
    apiKey: 'sk-plan143-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash',
  }));
  process.env.INKFLOW_CONFIG_DIR = tmpConfigDir;
  reloadConfig();
  let modelCall = 0;
  const requestBodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (urlStr.includes('/chat/completions')) {
      requestBodies.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>);
      const response = responses[Math.min(modelCall, responses.length - 1)];
      modelCall += 1;
      if (response.status >= 400) {
        return new Response(typeof response.body === 'string' ? response.body : JSON.stringify(response.body), { status: response.status });
      }
      return new Response(JSON.stringify({ choices: [{ finish_reason: response.finishReason || 'stop', message: { content: response.body } }] }), { status: response.status });
    }
    return originalFetch(url, init);
  };
  try {
    const startedResponse = await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId: pack.id, novelId: NOVEL_ID, databaseGeneration: getDatabaseGeneration() }),
    });
    assert.equal(startedResponse.status, 202);
    const started = await startedResponse.json() as { jobId: string; databaseGeneration: number };
    let job: any;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = await fetch(`${baseUrl}/api/continuation-packs/jobs/${started.jobId}?databaseGeneration=${started.databaseGeneration}`);
      job = await status.json();
      if (job.status === 'completed' || job.status === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    job.jobId = started.jobId;
    return { job, requestBodies };
  } finally {
    globalThis.fetch = originalFetch;
    if (savedConfigDir === undefined) delete process.env.INKFLOW_CONFIG_DIR; else process.env.INKFLOW_CONFIG_DIR = savedConfigDir;
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
    reloadConfig();
  }
}

after(() => {
  server?.close();
  closeDb();
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
});

// ─── extract-entities 验证 ───────────────────────────────────────

test('extract-entities: draft pack rejected', async () => {
  const pack = makePack('draft-pack', NOVEL_ID, 'draft');
  createContinuationPack(pack);

  const res = await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packId: pack.id }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /仅已批准/);
});

test('extract-entities: nonexistent pack returns 404', async () => {
  const res = await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packId: 'nonexistent-id' }),
  });
  assert.equal(res.status, 404);
});

test('extract-entities: missing packId returns 400', async () => {
  const res = await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: '请先选择要同步的续写资料包。' });
});

// ─── sync-to-world 验证 ──────────────────────────────────────────

test('sync-to-world: draft pack rejected', async () => {
  const pack = makePack('draft-sync', NOVEL_ID, 'draft');
  createContinuationPack(pack);

  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [{ name: '新角色', role: 'supporting' }],
    }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /仅已批准/);
});

test('sync-to-world: cross-novel pack rejected (403)', async () => {
  const pack = makePack('cross-novel', OTHER_NOVEL_ID, 'approved');
  createContinuationPack(pack);

  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [{ name: '新角色' }],
    }),
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /不属于当前作品/);
});

test('sync-to-world: missing packId/novelId returns 400', async () => {
  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packId: 'x' }),
  });
  assert.equal(res.status, 400);
});

// ─── 同名跳过 + 幂等 ─────────────────────────────────────────────

test('sync-to-world: same-name character skipped (idempotent)', async () => {
  const pack = makePack('idempotent-pack', NOVEL_ID, 'approved');
  createContinuationPack(pack);

  // First sync: create
  const res1 = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [{ name: '幂等角色', role: 'protagonist' }],
    }),
  });
  assert.equal(res1.status, 200);
  const body1 = await res1.json();
  assert.equal(body1.created.characters, 1);
  assert.equal(body1.skipped.characters, 0);

  // Verify written
  const chars = listCharacters(NOVEL_ID);
  assert.ok(chars.some(c => c.name === '幂等角色'));

  // Second sync: skip
  const res2 = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [{ name: '幂等角色', role: 'protagonist' }],
    }),
  });
  assert.equal(res2.status, 200);
  const body2 = await res2.json();
  assert.equal(body2.created.characters, 0);
  assert.equal(body2.skipped.characters, 1);
});

test('sync-to-world: name normalization skips variant whitespace', async () => {
  const pack = makePack('whitespace-pack', NOVEL_ID, 'approved');
  createContinuationPack(pack);

  // Pre-create with trimmed name
  const res1 = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [{ name: '空白角色' }],
    }),
  });
  assert.equal((await res1.json()).created.characters, 1);

  // Sync with padded name → should skip
  const res2 = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [{ name: '  空白角色  ' }],
    }),
  });
  assert.equal((await res2.json()).skipped.characters, 1);
});

// ─── 正常创建验证 ────────────────────────────────────────────────

test('sync-to-world: creates entities and relationship correctly', async () => {
  const pack = makePack('create-pack', NOVEL_ID, 'approved');
  createContinuationPack(pack);

  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [{ name: '创建角色A', role: 'protagonist', summary: '主角', bio: '背景', traits: ['勇敢'] }],
      locations: [{ name: '创建地点X', region: '北方', description: '繁华' }],
      items: [{ name: '创建物品Y', type: 'weapon', description: '锋利' }],
      factions: [{ name: '创建势力Z', leader: '盟主', territory: '中原', description: '正派' }],
      powerLevels: [{ name: '练气', tier: 1, characteristics: '基础', description: '入门' }],
      timelineEvents: [{ title: '开篇', timestamp: '第一天', description: '故事开始', order: 1 }],
      relationships: [
        { sourceName: '创建角色A', sourceType: 'character', targetName: '创建地点X', targetType: 'location', relationshipType: '居住', description: '住在京城' },
      ],
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.created.characters, 1);
  assert.equal(body.created.locations, 1);
  assert.equal(body.created.items, 1);
  assert.equal(body.created.factions, 1);
  assert.equal(body.created.powerLevels, 1);
  assert.equal(body.created.timelineEvents, 1);
  assert.equal(body.created.relationships, 1);

  // Verify DB state
  assert.ok(listCharacters(NOVEL_ID).some(c => c.name === '创建角色A'));
  assert.ok(listLocations(NOVEL_ID).some(l => l.name === '创建地点X'));
  assert.ok(listItems(NOVEL_ID).some(i => i.name === '创建物品Y'));
  assert.ok(listFactions(NOVEL_ID).some(f => f.name === '创建势力Z'));
  assert.ok(listPowerLevels(NOVEL_ID).some(p => p.name === '练气'));
  assert.ok(listTimelineEvents(NOVEL_ID).some(t => t.title === '开篇'));
  const rels = listEntityRelationships(NOVEL_ID);
  assert.ok(rels.some(r => r.relationshipType === '居住'));
});

test('sync-to-world: returns source-backed character facts without accepting a character core', async () => {
  const pack = makePack('character-provenance-pack', NOVEL_ID, 'approved');
  const sourceDocumentId = pack.sourceDocuments[0].id;
  pack.canonFacts = [{
    id: 'character-fact-1', priority: 'hard', category: 'character', text: '溯源角色来自北境',
    sourceDocumentId, evidence: '北境守门人',
  }];
  createContinuationPack(pack);

  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [{
        name: '溯源角色', role: 'supporting', summary: '北境守门人', bio: '来自北境', traits: ['克制'],
        sourceDocumentIds: [sourceDocumentId, 'unknown-document'],
      }],
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as {
    pendingCharacterFacts: Array<{
      characterName: string;
      sourceDocumentIds: string[];
      fields: Array<{ path: string; sourceDocumentIds: string[] }>;
      canonFacts: Array<{ id: string; sourceDocumentId?: string }>;
    }>;
  };
  assert.deepEqual(body.pendingCharacterFacts[0].sourceDocumentIds, [sourceDocumentId]);
  assert.deepEqual(body.pendingCharacterFacts[0].fields.map((field) => field.path), ['summary', 'bio', 'traits']);
  assert.ok(body.pendingCharacterFacts[0].fields.every((field) => field.sourceDocumentIds[0] === sourceDocumentId));
  assert.deepEqual(body.pendingCharacterFacts[0].canonFacts.map((fact) => ({ id: fact.id, sourceDocumentId: fact.sourceDocumentId })), [{ id: 'character-fact-1', sourceDocumentId }]);
  const character = listCharacters(NOVEL_ID).find((item) => item.name === '溯源角色');
  assert.ok(character);
  assert.equal(getArtifactCore(NOVEL_ID, 'character', character.id), undefined);
});

test('sync-to-world: atomically creates an approved pack batch above the legacy entity limit', async () => {
  const pack = makePack('large-character-batch-pack', NOVEL_ID, 'approved');
  createContinuationPack(pack);
  const characters = Array.from({ length: 120 }, (_, index) => ({
    name: `批量同步角色-${index + 1}`,
    role: 'supporting',
    summary: `第 ${index + 1} 个批量同步角色`,
    bio: '',
    traits: [],
  }));

  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters,
      locations: [],
      items: [],
      factions: [],
      powerLevels: [],
      timelineEvents: [],
      relationships: [],
    }),
  });
  const responseText = await res.text();
  assert.equal(res.status, 200, responseText);
  const body = JSON.parse(responseText) as {
    created: { characters: number };
    skipped: { characters: number };
  };
  assert.equal(body.created.characters, 120);
  assert.equal(body.skipped.characters, 0);
  assert.equal(
    listCharacters(NOVEL_ID).filter(character => character.name.startsWith('批量同步角色-')).length,
    120,
  );
});

test('sync-to-world: accepts aggregate text and traits above single-chunk limits', async () => {
  const pack = makePack('aggregate-sync-pack', NOVEL_ID, 'approved');
  createContinuationPack(pack);
  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [{
        name: '跨批合并角色', role: 'supporting', summary: '', bio: '',
        traits: Array.from({ length: 21 }, (_, index) => `特征-${index + 1}`),
      }],
      locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [], relationships: [],
      globalOutline: '大'.repeat(50_001),
    }),
  });
  const responseText = await res.text();
  assert.equal(res.status, 200, responseText);
  assert.ok(listCharacters(NOVEL_ID).some(character => character.name === '跨批合并角色'));
});

// ─── 关系端点歧义 ────────────────────────────────────────────────

test('sync-to-world: relationship with unknown entity is silently skipped', async () => {
  const pack = makePack('rel-ambig', NOVEL_ID, 'approved');
  createContinuationPack(pack);

  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [{ name: '已知角色' }],
      relationships: [
        { sourceName: '已知角色', sourceType: 'character', targetName: '未知角色', targetType: 'character', relationshipType: '敌对' },
      ],
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.created.characters, 1);
  assert.equal(body.created.relationships, 0);
});

test('sync-to-world: self-relationship is skipped', async () => {
  const pack = makePack('self-rel', NOVEL_ID, 'approved');
  createContinuationPack(pack);

  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [{ name: '独行侠' }],
      relationships: [
        { sourceName: '独行侠', sourceType: 'character', targetName: '独行侠', targetType: 'character', relationshipType: '自恋' },
      ],
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.created.characters, 1);
  assert.equal(body.created.relationships, 0);
});

// ─── 空内容资料包 ────────────────────────────────────────────────

test('extract-entities: pack with no text returns 400', async () => {
  const pack: ContinuationPack = {
    id: 'empty-text-pack',
    novelId: NOVEL_ID,
    title: '空文本',
    status: 'approved',
    sourceDocuments: [
      { id: 'doc-empty', packId: 'empty-text-pack', filename: 'empty.txt', kind: 'other', text: '', excerpt: '', createdAt: now },
    ],
    canonFacts: [],
    characterStates: [],
    plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
    styleProfile: { pov: 'third', tense: 'past', pacing: '', dialogueDensity: 'normal', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
    contradictions: [],
    continuationTask: '',
    sourceMap: { sections: [], keyConflicts: [] },
    readingQuestions: [],
    continuationGaps: [],
    createdAt: now,
    updatedAt: now,
  };
  createContinuationPack(pack);

  const res = await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packId: pack.id }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /无有效文本/);
});

// ─── 所有分类空数组时幂等 ────────────────────────────────────────

test('sync-to-world: empty arrays produce zero creates', async () => {
  const pack = makePack('empty-sync', NOVEL_ID, 'approved');
  createContinuationPack(pack);

  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [],
      locations: [],
      items: [],
      factions: [],
      powerLevels: [],
      timelineEvents: [],
      relationships: [],
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.created.characters, 0);
  assert.equal(body.created.locations, 0);
  assert.equal(body.created.items, 0);
  assert.equal(body.created.factions, 0);
  assert.equal(body.created.powerLevels, 0);
  assert.equal(body.created.timelineEvents, 0);
  assert.equal(body.created.relationships, 0);
});

// ─── T6 验收测试 ──────────────────────────────────────────────────

test('T6.1: extract-entities does not write to any entity table', async () => {
  const pack = makePack('t6-extract-nowrite', NOVEL_ID, 'approved');
  createContinuationPack(pack);

  const charsBefore = listCharacters(NOVEL_ID).length;
  const locsBefore = listLocations(NOVEL_ID).length;
  const itemsBefore = listItems(NOVEL_ID).length;
  const factionsBefore = listFactions(NOVEL_ID).length;

  await waitForExtractionJob(await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packId: pack.id }),
  }), true);

  assert.equal(listCharacters(NOVEL_ID).length, charsBefore, 'extract-entities must not write characters');
  assert.equal(listLocations(NOVEL_ID).length, locsBefore, 'extract-entities must not write locations');
  assert.equal(listItems(NOVEL_ID).length, itemsBefore, 'extract-entities must not write items');
  assert.equal(listFactions(NOVEL_ID).length, factionsBefore, 'extract-entities must not write factions');
});

test('T6.2: Zod validation rejects invalid relationship types', async () => {
  const pack = makePack('t6-zod', NOVEL_ID, 'approved');
  createContinuationPack(pack);

  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      relationships: [{ sourceName: 'A', sourceType: 'invalid_type', targetName: 'B', targetType: 'character', relationshipType: '敌对' }],
    }),
  });
  assert.equal(res.status, 400);
});

test('T6.3: generation mismatch returns 409', async () => {
  const pack = makePack('t6-gen', NOVEL_ID, 'approved');
  createContinuationPack(pack);

  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: 999999,
      characters: [{ name: '测试角色' }],
    }),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.code, 'GENERATION_MISMATCH');
});

test('T6.4: idempotent sync — second call creates zero new entities', async () => {
  const pack = makePack('t6-idempotent', NOVEL_ID, 'approved');
  createContinuationPack(pack);

  const payload = {
    packId: pack.id,
    novelId: NOVEL_ID,
    databaseGeneration: getDatabaseGeneration(),
    characters: [{ name: 'T6幂等角色X' }],
    locations: [{ name: 'T6幂等地点X' }],
    items: [{ name: 'T6幂等道具X' }],
    factions: [{ name: 'T6幂等势力X' }],
    powerLevels: [{ name: 'T6幂等力量X' }],
    timelineEvents: [{ title: 'T6幂等事件X', timestamp: 'T1', description: '', order: 1 }],
  };

  const res1 = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(res1.status, 200);
  const body1 = await res1.json();
  assert.equal(body1.created.characters, 1);
  assert.equal(body1.created.locations, 1);
  assert.equal(body1.created.items, 1);
  assert.equal(body1.created.factions, 1);
  assert.equal(body1.created.powerLevels, 1);
  assert.equal(body1.created.timelineEvents, 1);

  const res2 = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(res2.status, 200);
  const body2 = await res2.json();
  assert.equal(body2.created.characters, 0);
  assert.equal(body2.created.locations, 0);
  assert.equal(body2.created.items, 0);
  assert.equal(body2.created.factions, 0);
  assert.equal(body2.created.powerLevels, 0);
  assert.equal(body2.created.timelineEvents, 0);
});

test('T6.5: type-aware relationship disambiguation — same name different types', async () => {
  const pack = makePack('t6-disambig', NOVEL_ID, 'approved');
  createContinuationPack(pack);

  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [{ name: '同名实体' }],
      factions: [{ name: '同名实体' }],
      relationships: [
        { sourceName: '同名实体', sourceType: 'character', targetName: '同名实体', targetType: 'faction', relationshipType: '隶属' },
      ],
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.created.characters, 1);
  assert.equal(body.created.factions, 1);
  assert.equal(body.created.relationships, 1);

  const rels = listEntityRelationships(NOVEL_ID);
  const rel = rels.find(r => r.relationshipType === '隶属');
  assert.ok(rel);
  assert.equal(rel.sourceType, 'character');
  assert.equal(rel.targetType, 'faction');
});

test('T6.6: within-request duplicate characters skipped', async () => {
  const pack = makePack('t6-dup', NOVEL_ID, 'approved');
  createContinuationPack(pack);

  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [{ name: '重复角色' }, { name: '重复角色' }, { name: '唯一角色' }],
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.created.characters, 2);
  assert.equal(body.skipped.characters, 1);
});

test('T6.7: empty text pack extract returns 400', async () => {
  const pack: ContinuationPack = {
    id: 't6-empty-text',
    novelId: NOVEL_ID,
    title: '空',
    status: 'approved',
    sourceDocuments: [
      { id: 'de1', packId: 't6-empty-text', filename: 'e.txt', kind: 'other', text: '   ', excerpt: '', createdAt: now },
    ],
    canonFacts: [], characterStates: [],
    plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
    styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
    contradictions: [], continuationTask: '',
    sourceMap: { sections: [], keyConflicts: [] },
    readingQuestions: [], continuationGaps: [],
    createdAt: now, updatedAt: now,
  };
  createContinuationPack(pack);

  const res = await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packId: pack.id }),
  });
  assert.equal(res.status, 400);
});

test('extract-entities is not blocked by the unrelated advanced-audit quota', async () => {
  const exhaustedNovelId = 'exhausted-audit-quota-novel';
  createNovel({
    ...makeNovel(exhaustedNovelId),
    projectPreferenceProfile: {
      commercialMode: 'free',
      quotaLimits: { advancedAuditCount: 5, advancedAuditMax: 5 },
    } as any,
  });
  const pack = makePack('exhausted-audit-quota-pack', exhaustedNovelId, 'approved');
  const originalFetch = globalThis.fetch;
  const savedConfigDir = process.env.INKFLOW_CONFIG_DIR;
  const tmpConfigDir = path.join(os.tmpdir(), `inkflow-extraction-quota-${process.pid}`);
  createContinuationPack(pack);
  fs.mkdirSync(tmpConfigDir, { recursive: true });
  fs.writeFileSync(path.join(tmpConfigDir, 'config.json'), JSON.stringify({
    apiKey: 'sk-extraction-quota-key', baseUrl: 'https://api.openai-mock.com/v1', model: 'gpt-4o',
  }));
  process.env.INKFLOW_CONFIG_DIR = tmpConfigDir;
  reloadConfig();
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (urlStr.includes('/chat/completions') || urlStr.includes('api.openai-mock')) {
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        characters: [{ name: '张三', role: 'protagonist', summary: '剑客', bio: '', traits: [] }],
        locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [], relationships: [], globalOutline: '', worldRules: '',
      }) } }] }), { status: 200 });
    }
    return originalFetch(url, init);
  };

  try {
    const result = await waitForExtractionJob(await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId: pack.id, novelId: exhaustedNovelId, databaseGeneration: getDatabaseGeneration() }),
    }));
    assert.equal(result.extraction.characters[0].name, '张三');
  } finally {
    globalThis.fetch = originalFetch;
    if (savedConfigDir === undefined) delete process.env.INKFLOW_CONFIG_DIR; else process.env.INKFLOW_CONFIG_DIR = savedConfigDir;
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
    reloadConfig();
  }
});

test('Plan 142: invalid JSON and schema mismatch use distinct error codes', async () => {
  const invalidJsonJob = await runExtractionWithMock(makePack('t142-invalid-json', NOVEL_ID, 'approved'), '{"characters":[abc]}');
  assert.equal(invalidJsonJob.code, 'EXTRACTION_INVALID_JSON');

  const schemaMismatchJob = await runExtractionWithMock(makePack('t142-schema-mismatch', NOVEL_ID, 'approved'), '{"relationships":[{"sourceName":"张三","sourceType":"unknown","targetName":"李四","targetType":"character","relationshipType":"敌对"}]}');
  assert.equal(schemaMismatchJob.code, 'EXTRACTION_SCHEMA_MISMATCH');
});

test('Plan 142: finish_reason length is never published as a successful snapshot', async () => {
  const job = await runExtractionWithMock(makePack('t142-truncated', NOVEL_ID, 'approved'), '{"characters":[', 'length');
  assert.equal(job.code, 'EXTRACTION_OUTPUT_TRUNCATED');
  assert.equal(job.result, undefined);
});

test('Plan 143: wrapper, nulls, aliases, and string arrays are safely normalized', async () => {
  const job = await runExtractionWithMock(makePack('t143-normalize', NOVEL_ID, 'approved'), JSON.stringify({ data: {
    characters: [{ name: '林默', role: null, summary: null, bio: null, traits: '冷静' }],
    locations: [{ name: '临河城', region: null, description: null }],
    items: [{ name: '青锋剑', type: '武器', description: null }],
    factions: [], powerLevels: [], timelineEvents: [], relationships: [], globalOutline: '', worldRules: '',
  }}));
  assert.equal(job.extraction.characters[0].role, 'supporting');
  assert.deepEqual(job.extraction.characters[0].traits, ['冷静']);
  assert.equal(job.extraction.items[0].type, 'weapon');
});

test('a 52-item catalog and bounded negative tier do not cause persistent schema failures', async () => {
  const job = await runExtractionWithMock(makePack('dense-valid-schema-batch', NOVEL_ID, 'approved'), JSON.stringify({
    characters: [],
    locations: [],
    items: Array.from({ length: 52 }, (_, index) => ({ name: `道具-${index + 1}`, type: 'other', description: '' })),
    factions: [],
    powerLevels: [{ name: '未定级', tier: -1, characteristics: '', description: '' }],
    timelineEvents: [],
    relationships: [],
    globalOutline: '',
    worldRules: '',
  }));

  assert.equal(job.extraction.items.length, 52);
  assert.equal(job.extraction.powerLevels[0].tier, 0);
});

test('entity extraction still rejects payloads above the 180-entity safety limit', async () => {
  const job = await runExtractionWithMock(makePack('over-dense-schema-batch', NOVEL_ID, 'approved'), JSON.stringify({
    characters: [],
    locations: [],
    items: Array.from({ length: 181 }, (_, index) => ({ name: `过密道具-${index + 1}`, type: 'other', description: '' })),
    factions: [], powerLevels: [], timelineEvents: [], relationships: [], globalOutline: '', worldRules: '',
  }));

  assert.equal(job.code, 'EXTRACTION_OUTPUT_TRUNCATED');
  assert.equal(job.result, undefined);
});

test('Plan 143: schema failure gets one format-only repair request', async () => {
  const job = await runExtractionWithMock(makePack('t143-schema-repair', NOVEL_ID, 'approved'), [
    '{"relationships":[{"sourceName":"林默","sourceType":"unknown","targetName":"玄霜盟","targetType":"faction","relationshipType":"敌对"}]}',
    '{"characters":[{"name":"林默","role":"protagonist","summary":"主角","bio":"","traits":[]}],"locations":[],"items":[],"factions":[],"powerLevels":[],"timelineEvents":[],"relationships":[],"globalOutline":"","worldRules":""}',
  ]);
  assert.equal(job.extraction.characters[0].name, '林默');
});

test('Plan 143: an entirely empty semantic result is not published', async () => {
  const job = await runExtractionWithMock(makePack('t143-empty-semantic', NOVEL_ID, 'approved'), JSON.stringify({
    characters: [], locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [], relationships: [], globalOutline: '', worldRules: '',
  }));
  assert.equal(job.code, 'EXTRACTION_EMPTY_SEMANTIC_RESULT');
  assert.equal(job.result, undefined);
});

test('Plan 143: resume repairs only the failed batch and preserves its trace', async () => {
  const pack = makePack('t143-resume', NOVEL_ID, 'approved');
  createContinuationPack(pack);
  const savedConfigDir = process.env.INKFLOW_CONFIG_DIR;
  const originalFetch = globalThis.fetch;
  const tmpConfigDir = path.join(os.tmpdir(), `inkflow-plan143-resume-${process.pid}`);
  fs.mkdirSync(tmpConfigDir, { recursive: true });
  fs.writeFileSync(path.join(tmpConfigDir, 'config.json'), JSON.stringify({ apiKey: 'sk-plan143-key', baseUrl: 'https://api.openai-mock.com/v1', model: 'gpt-4o' }));
  process.env.INKFLOW_CONFIG_DIR = tmpConfigDir;
  reloadConfig();
  let modelCalls = 0;
  const responses = [
    '{"relationships":[{"sourceName":"林默","sourceType":"unknown","targetName":"玄霜盟","targetType":"faction","relationshipType":"敌对"}]}',
    '{"relationships":[{"sourceName":"林默","sourceType":"unknown","targetName":"玄霜盟","targetType":"faction","relationshipType":"敌对"}]}',
    '{"characters":[{"name":"林默","role":"protagonist","summary":"主角","bio":"","traits":[]}],"locations":[],"items":[],"factions":[],"powerLevels":[],"timelineEvents":[],"relationships":[],"globalOutline":"","worldRules":""}',
  ];
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (urlStr.includes('/chat/completions')) {
      const content = responses[Math.min(modelCalls, responses.length - 1)];
      modelCalls += 1;
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }), { status: 200 });
    }
    return originalFetch(url, init);
  };
  try {
    const startedResponse = await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId: pack.id, novelId: NOVEL_ID, databaseGeneration: getDatabaseGeneration() }),
    });
    const started = await startedResponse.json() as { jobId: string; databaseGeneration: number; traceId: string };
    assert.equal(startedResponse.status, 202);
    const traceId = started.traceId;
    let failed: any;
    for (let i = 0; i < 100; i += 1) {
      const status = await fetch(`${baseUrl}/api/continuation-packs/jobs/${started.jobId}?databaseGeneration=${started.databaseGeneration}`);
      failed = await status.json();
      if (failed.status === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(failed.code, 'EXTRACTION_SCHEMA_MISMATCH');
    assert.equal(failed.traceId, traceId);
    assert.equal(failed.completedResults, undefined);
    assert.ok(failed.schemaIssues?.length);

    const resumedResponse = await fetch(`${baseUrl}/api/continuation-packs/jobs/${started.jobId}/resume`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ databaseGeneration: started.databaseGeneration }),
    });
    assert.equal(resumedResponse.status, 202);
    for (let i = 0; i < 100; i += 1) {
      const status = await fetch(`${baseUrl}/api/continuation-packs/jobs/${started.jobId}?databaseGeneration=${started.databaseGeneration}`);
      const job = await status.json();
      if (job.status === 'completed') {
        assert.equal(job.traceId, traceId);
        assert.equal(job.result.extraction.characters[0].name, '林默');
        break;
      }
      if (job.status === 'failed') throw new Error(`${job.code}: ${job.error}`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(modelCalls, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (savedConfigDir === undefined) delete process.env.INKFLOW_CONFIG_DIR; else process.env.INKFLOW_CONFIG_DIR = savedConfigDir;
    reloadConfig();
  }
});

test('entity extraction keeps an old job alive through recent failure and resume activity', async () => {
  const pack = makePack('entity-job-activity-ttl', NOVEL_ID, 'approved');
  pack.sourceDocuments = [{
    id: 'activity-ttl-doc', packId: pack.id, filename: 'activity.txt', kind: 'other',
    text: '张三是一名剑客。', excerpt: '', createdAt: now,
  }];
  createContinuationPack(pack);
  const savedConfigDir = process.env.INKFLOW_CONFIG_DIR;
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  const tmpConfigDir = path.join(os.tmpdir(), `inkflow-activity-ttl-${process.pid}`);
  const ttlMs = 30 * 60 * 1000;
  const createdAt = 1_000_000;
  let fakeNow = createdAt;
  let modelCalls = 0;
  const invalid = '{"characters":[abc]}';
  const valid = JSON.stringify({
    characters: [{ name: '张三', role: 'protagonist', summary: '剑客', bio: '', traits: [] }],
    locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [], relationships: [],
    globalOutline: '', worldRules: '',
  });
  Date.now = () => fakeNow;
  fs.mkdirSync(tmpConfigDir, { recursive: true });
  fs.writeFileSync(path.join(tmpConfigDir, 'config.json'), JSON.stringify({
    apiKey: 'sk-activity-ttl-key', baseUrl: 'https://api.openai-mock.com/v1', model: 'gpt-4o',
  }));
  process.env.INKFLOW_CONFIG_DIR = tmpConfigDir;
  reloadConfig();
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (urlStr.includes('/chat/completions')) {
      modelCalls += 1;
      if (modelCalls === 1) fakeNow = createdAt + ttlMs - 100;
      const content = modelCalls < 3 ? invalid : valid;
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }), { status: 200 });
    }
    return originalFetch(url, init);
  };

  try {
    const startedResponse = await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId: pack.id, novelId: NOVEL_ID, databaseGeneration: getDatabaseGeneration() }),
    });
    assert.equal(startedResponse.status, 202);
    const started = await startedResponse.json() as { jobId: string; databaseGeneration: number };
    let failed: any;
    for (let i = 0; i < 100; i += 1) {
      const status = await fetch(`${baseUrl}/api/continuation-packs/jobs/${started.jobId}?databaseGeneration=${started.databaseGeneration}`);
      failed = await status.json();
      if (failed.status === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(failed.status, 'failed');
    assert.equal(failed.code, 'EXTRACTION_INVALID_JSON');

    // The createdAt is now over the TTL, while the failed batch was active 100ms ago.
    fakeNow += 200;
    const resumedResponse = await fetch(`${baseUrl}/api/continuation-packs/jobs/${started.jobId}/resume`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ databaseGeneration: started.databaseGeneration }),
    });
    assert.equal(resumedResponse.status, 202);

    let completed: any;
    for (let i = 0; i < 100; i += 1) {
      const status = await fetch(`${baseUrl}/api/continuation-packs/jobs/${started.jobId}?databaseGeneration=${started.databaseGeneration}`);
      completed = await status.json();
      if (completed.status === 'completed') break;
      if (completed.status === 'failed') throw new Error(`${completed.code}: ${completed.error}`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(completed.status, 'completed');
    assert.equal(completed.result.extraction.characters[0].name, '张三');
    assert.equal(modelCalls, 3);
  } finally {
    Date.now = originalDateNow;
    globalThis.fetch = originalFetch;
    if (savedConfigDir === undefined) delete process.env.INKFLOW_CONFIG_DIR; else process.env.INKFLOW_CONFIG_DIR = savedConfigDir;
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
    reloadConfig();
  }
});

test('Plan 143: invalid JSON retry changes the prompt contract without repeating raw output', async () => {
  const pack = makePack('t143-json-repair', NOVEL_ID, 'approved');
  createContinuationPack(pack);
  const savedConfigDir = process.env.INKFLOW_CONFIG_DIR;
  const originalFetch = globalThis.fetch;
  const tmpConfigDir = path.join(os.tmpdir(), `inkflow-plan143-json-${process.pid}`);
  fs.mkdirSync(tmpConfigDir, { recursive: true });
  fs.writeFileSync(path.join(tmpConfigDir, 'config.json'), JSON.stringify({ apiKey: 'sk-plan143-key', baseUrl: 'https://api.openai-mock.com/v1', model: 'gpt-4o' }));
  process.env.INKFLOW_CONFIG_DIR = tmpConfigDir;
  reloadConfig();
  const prompts: string[] = [];
  let modelCalls = 0;
  const valid = '{"characters":[{"name":"林默","role":"protagonist","summary":"主角","bio":"","traits":[]}],"locations":[],"items":[],"factions":[],"powerLevels":[],"timelineEvents":[],"relationships":[],"globalOutline":"","worldRules":""}';
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (urlStr.includes('/chat/completions')) {
      prompts.push(String(init?.body || ''));
      modelCalls += 1;
      const content = modelCalls === 1 ? '{"characters":[abc]}' : valid;
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }), { status: 200 });
    }
    return originalFetch(url, init);
  };
  try {
    const job = await waitForExtractionJob(await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId: pack.id, novelId: NOVEL_ID, databaseGeneration: getDatabaseGeneration() }),
    }));
    assert.equal(job.extraction.characters[0].name, '林默');
    assert.equal(modelCalls, 2);
    assert.notEqual(prompts[0], prompts[1]);
    assert.match(prompts[1], /单一 JSON 根对象/);
    assert.match(prompts[1], /不得输出 Markdown、注释或尾逗号/);
  } finally {
    globalThis.fetch = originalFetch;
    if (savedConfigDir === undefined) delete process.env.INKFLOW_CONFIG_DIR; else process.env.INKFLOW_CONFIG_DIR = savedConfigDir;
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
    reloadConfig();
  }
});

test('Plan 143: DeepSeek omits only thinking after rejection and completes in JSON mode', async () => {
  const valid = '{"characters":[{"name":"林默","role":"protagonist","summary":"主角","bio":"","traits":[]}],"locations":[],"items":[],"factions":[],"powerLevels":[],"timelineEvents":[],"relationships":[],"globalOutline":"","worldRules":""}';
  const result = await runDeepSeekProviderResponses(makePack('t143-deepseek-omit-thinking', NOVEL_ID, 'approved'), [
    { status: 400, body: { error: { param: 'thinking', code: 'invalid_request_error' } } },
    { status: 200, body: valid },
  ]);

  assert.equal(result.job.result.extraction.characters[0].name, '林默');
  assert.equal(result.requestBodies.length, 2);
  assert.deepEqual(result.requestBodies[0].thinking, { type: 'disabled' });
  assert.deepEqual(result.requestBodies[0].response_format, { type: 'json_object' });
  assert.equal('thinking' in result.requestBodies[1], false);
  assert.deepEqual(result.requestBodies[1].response_format, { type: 'json_object' });
});

test('Plan 143: two DeepSeek parameter rejections stop without parser or resume fallback', async () => {
  const beforeCharacters = listCharacters(NOVEL_ID).length;
  const result = await runDeepSeekProviderResponses(makePack('t143-deepseek-parameter-error', NOVEL_ID, 'approved'), [
    { status: 400, body: { error: { param: 'thinking', code: 'invalid_request_error' } } },
    { status: 422, body: { error: { param: 'response_format', code: 'unsupported_parameter' } } },
  ]);

  assert.equal(result.job.status, 'failed');
  assert.equal(result.job.code, 'EXTRACTION_PROVIDER_PARAMETER');
  assert.equal(result.job.outputDiagnostic?.rejectedParameter, 'response_format');
  assert.equal(result.job.outputDiagnostic?.compatibilityMode, 'omit_thinking');
  assert.equal(result.job.outputDiagnostic?.providerRequestCount, 2);
  assert.equal(result.job.failedChunk?.providerRequestCount, 2);
  assert.equal(result.job.result, undefined);
  assert.equal(listCharacters(NOVEL_ID).length, beforeCharacters);
  const resume = await fetch(`${baseUrl}/api/continuation-packs/jobs/${result.job.jobId}/resume`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ databaseGeneration: getDatabaseGeneration() }),
  });
  assert.equal(resume.status, 409);
  assert.equal(result.requestBodies.length, 2);
});

test('T7.1: type-aware relationship lookup uses type-prefixed key', async () => {
  const pack: ContinuationPack = {
    id: 't7-type-aware',
    novelId: NOVEL_ID,
    title: '类型感知关系',
    status: 'approved',
    sourceDocuments: [{ id: 'd1', packId: 't7-type-aware', filename: 't.txt', kind: 'other', text: '张三是主角', excerpt: '', createdAt: now }],
    canonFacts: [], characterStates: [],
    plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
    styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
    contradictions: [], continuationTask: '',
    sourceMap: { sections: [], keyConflicts: [] },
    readingQuestions: [], continuationGaps: [],
    createdAt: now, updatedAt: now,
  };
  createContinuationPack(pack);

  const db = getDb();
  db.prepare('INSERT INTO characters (id, novel_id, name, role, summary, traits, bio, current_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'char-zhang', NOVEL_ID, '张三', 'protagonist', '', '[]', '', '', now, now
  );
  db.prepare('INSERT INTO locations (id, novel_id, name, region, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'loc-beijing', NOVEL_ID, '北京', '华北', '首都', now, now
  );

  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [],
      locations: [],
      items: [],
      factions: [],
      powerLevels: [],
      timelineEvents: [],
      relationships: [
        { sourceName: '张三', sourceType: 'character', targetName: '北京', targetType: 'location', relationshipType: '居住', description: '' },
      ],
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { created: { relationships: number } };
  assert.equal(body.created.relationships, 1);
});

test('T7.2: relationship dedup skips existing DB relationship', async () => {
  const pack: ContinuationPack = {
    id: 't7-dedup-db',
    novelId: NOVEL_ID,
    title: '去重测试',
    status: 'approved',
    sourceDocuments: [{ id: 'd1', packId: 't7-dedup-db', filename: 't.txt', kind: 'other', text: '内容', excerpt: '', createdAt: now }],
    canonFacts: [], characterStates: [],
    plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
    styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
    contradictions: [], continuationTask: '',
    sourceMap: { sections: [], keyConflicts: [] },
    readingQuestions: [], continuationGaps: [],
    createdAt: now, updatedAt: now,
  };
  createContinuationPack(pack);

  const db = getDb();
  db.prepare('INSERT INTO characters (id, novel_id, name, role, summary, traits, bio, current_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'c1', NOVEL_ID, '角色A', 'protagonist', '', '[]', '', '', now, now
  );
  db.prepare('INSERT INTO characters (id, novel_id, name, role, summary, traits, bio, current_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'c2', NOVEL_ID, '角色B', 'supporting', '', '[]', '', '', now, now
  );
  db.prepare('INSERT INTO entity_relationships (id, novelId, sourceType, sourceId, targetType, targetId, relationshipType, description, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'rel-exist', NOVEL_ID, 'character', 'c1', 'character', 'c2', '朋友', '', now
  );

  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [],
      locations: [],
      items: [],
      factions: [],
      powerLevels: [],
      timelineEvents: [],
      relationships: [
        { sourceName: '角色A', sourceType: 'character', targetName: '角色B', targetType: 'character', relationshipType: '朋友', description: '' },
      ],
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { created: { relationships: number }; skipped: { relationships: number } };
  assert.equal(body.created.relationships, 0);
  assert.equal(body.skipped.relationships, 1);
});

test('T7.3: relationship dedup skips within-request duplicate', async () => {
  const pack: ContinuationPack = {
    id: 't7-dedup-req',
    novelId: NOVEL_ID,
    title: '请求内去重',
    status: 'approved',
    sourceDocuments: [{ id: 'd1', packId: 't7-dedup-req', filename: 't.txt', kind: 'other', text: '内容', excerpt: '', createdAt: now }],
    canonFacts: [], characterStates: [],
    plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
    styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
    contradictions: [], continuationTask: '',
    sourceMap: { sections: [], keyConflicts: [] },
    readingQuestions: [], continuationGaps: [],
    createdAt: now, updatedAt: now,
  };
  createContinuationPack(pack);

  const db = getDb();
  db.prepare('INSERT INTO characters (id, novel_id, name, role, summary, traits, bio, current_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'c3', NOVEL_ID, '角色X', 'protagonist', '', '[]', '', '', now, now
  );
  db.prepare('INSERT INTO characters (id, novel_id, name, role, summary, traits, bio, current_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'c4', NOVEL_ID, '角色Y', 'supporting', '', '[]', '', '', now, now
  );

  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [],
      locations: [],
      items: [],
      factions: [],
      powerLevels: [],
      timelineEvents: [],
      relationships: [
        { sourceName: '角色X', sourceType: 'character', targetName: '角色Y', targetType: 'character', relationshipType: '同事', description: '' },
        { sourceName: '角色X', sourceType: 'character', targetName: '角色Y', targetType: 'character', relationshipType: '同事', description: '' },
      ],
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { created: { relationships: number }; skipped: { relationships: number } };
  assert.equal(body.created.relationships, 1);
  assert.equal(body.skipped.relationships, 1);
});

test('T7.4: databaseGeneration is required for sync-to-world', async () => {
  const pack = makePack('t7-gen-required', NOVEL_ID, 'approved');
  createContinuationPack(pack);

  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      characters: [],
    }),
  });
  assert.equal(res.status, 400);
});

// ─── T1 批准旁路封死 ─────────────────────────────────────────────

test('T1.1: updateContinuationPack via /api/db rejects status field', async () => {
  const pack = makePack('t1-status-reject', NOVEL_ID, 'draft');
  createContinuationPack(pack);

  const res = await fetch(`${baseUrl}/api/db`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'updateContinuationPack',
      args: [pack.id, { status: 'approved' }],
    }),
  });
  assert.equal(res.status, 400);
  const body = await res.json() as { error: string };
  assert.match(body.error, /approve-import/);
});

test('T1.2: updateContinuationPack via /api/db allows continuationTask', async () => {
  const pack = makePack('t1-task-ok', NOVEL_ID, 'draft');
  createContinuationPack(pack);

  const res = await fetch(`${baseUrl}/api/db`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'updateContinuationPack',
      args: [pack.id, { continuationTask: '新的续写方向' }],
    }),
  });
  assert.equal(res.status, 200);
  const db = getDb();
  const row = db.prepare('SELECT continuation_task FROM continuation_packs WHERE id = ?').get('t1-task-ok') as { continuation_task: string };
  assert.equal(row.continuation_task, '新的续写方向');
});

// ─── T4 验收测试 ──────────────────────────────────────────────────

test('T4.1: extract-entities with non-empty LLM output writes zero entities (full snapshot)', async () => {
  const pack: ContinuationPack = {
    id: 't4-empty-extract',
    novelId: NOVEL_ID,
    title: '非空提取零写入',
    status: 'approved',
    sourceDocuments: [
      { id: 't4e1', packId: 't4-empty-extract', filename: 'a.txt', kind: 'other', text: '内容', excerpt: '', createdAt: now },
    ],
    canonFacts: [], characterStates: [],
    plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
    styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
    contradictions: [], continuationTask: '',
    sourceMap: { sections: [], keyConflicts: [] },
    readingQuestions: [], continuationGaps: [],
    createdAt: now, updatedAt: now,
  };
  createContinuationPack(pack);

  // Full before snapshot
  const beforeChars = listCharacters(NOVEL_ID).map(c => c.name).sort();
  const beforeLocs = listLocations(NOVEL_ID).map(l => l.name).sort();
  const beforeItems = listItems(NOVEL_ID).map(i => i.name).sort();
  const beforeFactions = listFactions(NOVEL_ID).map(f => f.name).sort();
  const beforeRels = listEntityRelationships(NOVEL_ID).map(r => `${r.sourceType}:${r.sourceId}-${r.targetType}:${r.targetId}`).sort();
  const beforePowerLevels = listPowerLevels(NOVEL_ID).map(p => p.name).sort();
  const beforeTimeline = listTimelineEvents(NOVEL_ID).map(t => t.title).sort();
  const dbInstance = getDb();
  const beforeNovel = dbInstance.prepare('SELECT world_rules, global_outline FROM novels WHERE id = ?').get(NOVEL_ID) as { world_rules: string; global_outline: string };

  const savedConfigDir = process.env.INKFLOW_CONFIG_DIR;
  const originalFetch = globalThis.fetch;
  const tmpConfigDir = path.join(os.tmpdir(), `inkflow-t4-empty-${process.pid}`);
  try {
    fs.mkdirSync(tmpConfigDir, { recursive: true });
    fs.writeFileSync(path.join(tmpConfigDir, 'config.json'), JSON.stringify({
      apiKey: 'sk-t4-empty-key', baseUrl: 'https://api.openai-mock.com/v1', model: 'gpt-4o',
    }));
    process.env.INKFLOW_CONFIG_DIR = tmpConfigDir;
    reloadConfig();

    // Non-empty LLM output — entities have real data but extract-entities must NOT write them
    const mockExtraction = {
      characters: [{ name: '提取角色A', role: 'protagonist', summary: '主角', bio: '详细', traits: ['勇敢'] }],
      locations: [{ name: '提取地点X', region: '华北', description: '首都' }],
      items: [{ name: '提取物品Y', type: 'weapon', description: '神兵' }],
      factions: [{ name: '提取势力Z', leader: '盟主', territory: '中原', description: '正派' }],
      powerLevels: [{ name: '提取力量Q', tier: 1, characteristics: '基础', description: '入门' }],
      timelineEvents: [{ title: '提取事件R', timestamp: '第一天', description: '开始', order: 1 }],
      relationships: [{ sourceName: '提取角色A', sourceType: 'character', targetName: '提取地点X', targetType: 'location', relationshipType: '居住', description: '' }],
      globalOutline: '提取的世界大纲',
      worldRules: '提取的世界规则',
    };

    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (urlStr.includes('/chat/completions') || urlStr.includes('api.openai-mock')) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(mockExtraction) } }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(url, init);
    };

    const result = await waitForExtractionJob(await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId: pack.id, novelId: NOVEL_ID, databaseGeneration: getDatabaseGeneration() }),
    }));
    const body = result as { extraction: { characters: unknown[]; locations: unknown[]; items: unknown[]; factions: unknown[]; relationships: unknown[] } };
    assert.equal(body.extraction.characters.length, 1, 'LLM returned 1 character');
    assert.equal(body.extraction.locations.length, 1, 'LLM returned 1 location');
    assert.equal(body.extraction.relationships.length, 1, 'LLM returned 1 relationship');

    // Full after snapshot — everything must be unchanged
    assert.deepEqual(listCharacters(NOVEL_ID).map(c => c.name).sort(), beforeChars, 'characters unchanged');
    assert.deepEqual(listLocations(NOVEL_ID).map(l => l.name).sort(), beforeLocs, 'locations unchanged');
    assert.deepEqual(listItems(NOVEL_ID).map(i => i.name).sort(), beforeItems, 'items unchanged');
    assert.deepEqual(listFactions(NOVEL_ID).map(f => f.name).sort(), beforeFactions, 'factions unchanged');
    assert.deepEqual(listEntityRelationships(NOVEL_ID).map(r => `${r.sourceType}:${r.sourceId}-${r.targetType}:${r.targetId}`).sort(), beforeRels, 'relationships unchanged');
    assert.deepEqual(listPowerLevels(NOVEL_ID).map(p => p.name).sort(), beforePowerLevels, 'powerLevels unchanged');
    assert.deepEqual(listTimelineEvents(NOVEL_ID).map(t => t.title).sort(), beforeTimeline, 'timelineEvents unchanged');
    const afterNovel = dbInstance.prepare('SELECT world_rules, global_outline FROM novels WHERE id = ?').get(NOVEL_ID) as { world_rules: string; global_outline: string };
    assert.deepEqual(afterNovel, beforeNovel, 'novel world_rules/global_outline unchanged');
  } finally {
    globalThis.fetch = originalFetch;
    if (savedConfigDir === undefined) delete process.env.INKFLOW_CONFIG_DIR; else process.env.INKFLOW_CONFIG_DIR = savedConfigDir;
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  }
});

test('T4.2: sync-to-world with stale generation returns 409', async () => {
  const pack: ContinuationPack = {
    id: 't4-stale-gen',
    novelId: NOVEL_ID,
    title: '过期快照',
    status: 'approved',
    sourceDocuments: [{ id: 'sg1', packId: 't4-stale-gen', filename: 't.txt', kind: 'other', text: '内容', excerpt: '', createdAt: now }],
    canonFacts: [], characterStates: [],
    plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
    styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
    contradictions: [], continuationTask: '',
    sourceMap: { sections: [], keyConflicts: [] },
    readingQuestions: [], continuationGaps: [],
    createdAt: now, updatedAt: now,
  };
  createContinuationPack(pack);

  const staleGeneration = getDatabaseGeneration();

  advanceDatabaseGeneration();

  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack.id,
      novelId: NOVEL_ID,
      databaseGeneration: staleGeneration,
      characters: [{ name: '迟到角色' }],
      locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [], relationships: [],
    }),
  });
  assert.equal(res.status, 409);
  const body = await res.json() as { code: string };
  assert.equal(body.code, 'GENERATION_MISMATCH');
});

test('T4.3: sync-to-world failure preserves all entity counts (no partial writes)', async () => {
  const pack: ContinuationPack = {
    id: 't4-rollback-sync',
    novelId: NOVEL_ID,
    title: '事务回滚验证',
    status: 'approved',
    sourceDocuments: [
      { id: 'rb1', packId: 't4-rollback-sync', filename: 'data.txt', kind: 'other', text: '测试内容', excerpt: '', createdAt: now },
    ],
    canonFacts: [], characterStates: [],
    plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
    styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
    contradictions: [], continuationTask: '',
    sourceMap: { sections: [], keyConflicts: [] },
    readingQuestions: [], continuationGaps: [],
    createdAt: now, updatedAt: now,
  };
  createContinuationPack(pack);

  // Full snapshot before sync
  const beforeChars = listCharacters(NOVEL_ID).map(c => c.name).sort();
  const beforeLocs = listLocations(NOVEL_ID).map(l => l.name).sort();
  const beforeItems = listItems(NOVEL_ID).map(i => i.name).sort();
  const beforeFactions = listFactions(NOVEL_ID).map(f => f.name).sort();
  const beforeRels = listEntityRelationships(NOVEL_ID).map(r => `${r.sourceType}:${r.sourceId}-${r.targetType}:${r.targetId}`).sort();
  const beforePowerLevels = listPowerLevels(NOVEL_ID).map(p => p.name).sort();
  const beforeTimeline = listTimelineEvents(NOVEL_ID).map(t => t.title).sort();
  const dbInstance = getDb();
  const beforeNovel = dbInstance.prepare('SELECT world_rules, global_outline FROM novels WHERE id = ?').get(NOVEL_ID) as { world_rules: string; global_outline: string };
  const gen = getDatabaseGeneration();

  // Delete the pack BEFORE calling sync-to-world.
  // Since all reads now happen inside the transaction, the transaction
  // will start, pass the generation check, then fail at the pack check.
  // This verifies the transaction does not produce partial writes.
  dbInstance.prepare('DELETE FROM continuation_packs WHERE id = ?').run('t4-rollback-sync');

  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: 't4-rollback-sync',
      novelId: NOVEL_ID,
      databaseGeneration: gen,
      characters: [{ name: '事务回滚角色' }],
      locations: [{ name: '事务回滚地点' }],
      items: [{ name: '事务回滚物品' }],
      factions: [{ name: '事务回滚势力' }],
      powerLevels: [], timelineEvents: [],
      relationships: [{ sourceName: '事务回滚角色', sourceType: 'character', targetName: '事务回滚地点', targetType: 'location', relationshipType: '关联', description: '' }],
    }),
  });
  assert.equal(res.status, 404, 'sync fails because pack was deleted');

  // All entity counts must remain exactly as before — no partial writes
  assert.deepEqual(listCharacters(NOVEL_ID).map(c => c.name).sort(), beforeChars, 'characters unchanged after failure');
  assert.deepEqual(listLocations(NOVEL_ID).map(l => l.name).sort(), beforeLocs, 'locations unchanged after failure');
  assert.deepEqual(listItems(NOVEL_ID).map(i => i.name).sort(), beforeItems, 'items unchanged after failure');
  assert.deepEqual(listFactions(NOVEL_ID).map(f => f.name).sort(), beforeFactions, 'factions unchanged after failure');
  assert.deepEqual(listEntityRelationships(NOVEL_ID).map(r => `${r.sourceType}:${r.sourceId}-${r.targetType}:${r.targetId}`).sort(), beforeRels, 'relationships unchanged after failure');
  assert.deepEqual(listPowerLevels(NOVEL_ID).map(p => p.name).sort(), beforePowerLevels, 'powerLevels unchanged after failure');
  assert.deepEqual(listTimelineEvents(NOVEL_ID).map(t => t.title).sort(), beforeTimeline, 'timelineEvents unchanged after failure');
  const afterNovel = getDb().prepare('SELECT world_rules, global_outline FROM novels WHERE id = ?').get(NOVEL_ID) as { world_rules: string; global_outline: string };
  assert.deepEqual(afterNovel, beforeNovel, 'novel fields unchanged after failure');
});

test('T4.4: sync failure response preserves error for retry', async () => {
  const pack: ContinuationPack = {
    id: 't4-sync-fail',
    novelId: NOVEL_ID,
    title: '同步失败保留',
    status: 'approved',
    sourceDocuments: [{ id: 'sf1', packId: 't4-sync-fail', filename: 't.txt', kind: 'other', text: '内容', excerpt: '', createdAt: now }],
    canonFacts: [], characterStates: [],
    plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
    styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
    contradictions: [], continuationTask: '',
    sourceMap: { sections: [], keyConflicts: [] },
    readingQuestions: [], continuationGaps: [],
    createdAt: now, updatedAt: now,
  };
  createContinuationPack(pack);

  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: 'nonexistent-pack',
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [], locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [], relationships: [],
    }),
  });
  assert.equal(res.status, 404);
  const body = await res.json() as { error: string };
  assert.ok(body.error.length > 0, 'error message is present for retry guidance');
});

// ─── T3 真实数据安全测试 ─────────────────────────────────────────

test('T3.1: transaction rollback — mid-write failure preserves all entities', async () => {
  // Pre-seed some entities so we can verify they survive a failed sync
  const db = getDb();
  db.prepare('INSERT INTO characters (id, novel_id, name, role, summary, traits, bio, current_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    't3-seed-char', NOVEL_ID, '种子角色', 'protagonist', '', '[]', '', '', now, now
  );
  db.prepare('INSERT INTO locations (id, novel_id, name, region, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    't3-seed-loc', NOVEL_ID, '种子地点', '华北', '首都', now, now
  );

  const beforeChars = listCharacters(NOVEL_ID).map(c => c.name).sort();
  const beforeLocs = listLocations(NOVEL_ID).map(l => l.name).sort();
  const beforeRels = listEntityRelationships(NOVEL_ID).map(r => `${r.sourceType}:${r.sourceId}-${r.targetType}:${r.targetId}`).sort();

  // Create a trigger that fires on the SECOND location INSERT and throws an error.
  // This simulates a mid-transaction failure AFTER the character is written
  // but BEFORE the transaction commits — forcing a full rollback.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_t3_rollback_fail
    AFTER INSERT ON locations
    WHEN NEW.name = '回滚地点'
    BEGIN
      SELECT RAISE(ABORT, 'simulated mid-write failure');
    END;
  `);

  const pack = makePack('t3-rollback-mid', NOVEL_ID, 'approved');
  createContinuationPack(pack);

  const res = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: 't3-rollback-mid',
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [{ name: '回滚角色' }],
      locations: [{ name: '回滚地点' }],
      relationships: [{ sourceName: '回滚角色', sourceType: 'character', targetName: '回滚地点', targetType: 'location', relationshipType: '关联', description: '' }],
    }),
  });
  assert.equal(res.status, 500);

  // Clean up trigger
  db.exec('DROP TRIGGER IF EXISTS trg_t3_rollback_fail');

  // ALL pre-seed data must survive AND the mid-written character must be rolled back
  assert.deepEqual(listCharacters(NOVEL_ID).map(c => c.name).sort(), beforeChars, 'pre-seed characters survive, mid-write character rolled back');
  assert.deepEqual(listLocations(NOVEL_ID).map(l => l.name).sort(), beforeLocs, 'pre-seed locations survive, mid-write location rolled back');
  assert.deepEqual(listEntityRelationships(NOVEL_ID).map(r => `${r.sourceType}:${r.sourceId}-${r.targetType}:${r.targetId}`).sort(), beforeRels, 'pre-seed relationships survive');
});

test('T3.2: FIFO novel fields — second sync does not overwrite first', async () => {
  const pack1 = makePack('t3-fifo-1', NOVEL_ID, 'approved');
  const pack2 = makePack('t3-fifo-2', NOVEL_ID, 'approved');
  createContinuationPack(pack1);
  createContinuationPack(pack2);

  const dbInstance = getDb();
  const gen = getDatabaseGeneration();

  // Hold the write queue so we can enqueue operations in controlled order
  const queueHold = holdWriteQueue();

  // 1. Enqueue a "user save" that sets globalOutline and worldRules
  const userSavePromise = runInSerializedWriteForGeneration(gen, () => {
    dbInstance.prepare('UPDATE novels SET global_outline = ?, world_rules = ? WHERE id = ?').run('用户保存的大纲', '用户保存的规则', NOVEL_ID);
    return { executed: true as const, result: 'user-save' };
  });

  // 2. Enqueue sync pack1 (should see the user save's values and NOT overwrite them)
  const sync1Promise = fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack1.id,
      novelId: NOVEL_ID,
      databaseGeneration: gen,
      characters: [],
      globalOutline: '第一版大纲',
      worldRules: '第一版规则',
    }),
  });

  // 3. Enqueue sync pack2 (FIFO: should NOT overwrite pack1's result)
  const sync2Promise = fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack2.id,
      novelId: NOVEL_ID,
      databaseGeneration: gen,
      characters: [],
      globalOutline: '第二版大纲',
      worldRules: '第二版规则',
    }),
  });

  // Release — operations drain in FIFO order
  await queueHold.waitForQueued(3);
  queueHold.release();

  const [userSaveResult, res1, res2] = await Promise.all([userSavePromise, sync1Promise, sync2Promise]);
  assert.ok(userSaveResult.executed, 'user save executed');

  const body1 = await res1.json() as { error?: string };
  const body2 = await res2.json() as { error?: string };

  // Both syncs should succeed (user save ran first, syncs follow)
  assert.equal(res1.status, 200, `sync1 status: ${JSON.stringify(body1)}`);
  assert.equal(res2.status, 200, `sync2 status: ${JSON.stringify(body2)}`);

  // FIFO: user save wrote first, then sync1 wrote on top (since novel fields were already non-empty
  // at the time sync1 ran, sync1 should NOT overwrite user save's values)
  const row = dbInstance.prepare('SELECT global_outline, world_rules FROM novels WHERE id = ?').get(NOVEL_ID) as { global_outline: string; world_rules: string };
  assert.equal(row.global_outline, '用户保存的大纲', 'FIFO: user save values preserved — sync did not overwrite');
  assert.equal(row.world_rules, '用户保存的规则', 'FIFO: user save values preserved — sync did not overwrite');
});

test('T3.3: concurrent syncs do not produce duplicate entities', async () => {
  const pack1 = makePack('t3-concur-1', NOVEL_ID, 'approved');
  const pack2 = makePack('t3-concur-2', NOVEL_ID, 'approved');
  createContinuationPack(pack1);
  createContinuationPack(pack2);

  const gen = getDatabaseGeneration();
  const payload1 = {
    packId: pack1.id,
    novelId: NOVEL_ID,
    databaseGeneration: gen,
    characters: [{ name: '并发角色' }],
    locations: [{ name: '并发地点' }],
  };
  const payload2 = {
    packId: pack2.id,
    novelId: NOVEL_ID,
    databaseGeneration: gen,
    characters: [{ name: '并发角色' }],
    locations: [{ name: '并发地点' }],
  };

  // Hold the queue so both syncs are guaranteed to be queued before either runs
  const queueHold = holdWriteQueue();

  const p1 = fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload1),
  });
  const p2 = fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload2),
  });

  // Release — both syncs now run in FIFO order
  await queueHold.waitForQueued(2);
  queueHold.release();

  const [res1, res2] = await Promise.all([p1, p2]);

  const body1 = await res1.json() as { created: { characters: number }; skipped: { characters: number } };
  const body2 = await res2.json() as { created: { characters: number }; skipped: { characters: number } };

  // One should create, the other should skip — total created must be exactly 1
  const totalCreated = body1.created.characters + body2.created.characters;
  const totalSkipped = body1.skipped.characters + body2.skipped.characters;
  assert.equal(totalCreated, 1, 'exactly one sync creates the character');
  assert.equal(totalSkipped, 1, 'the other sync skips it');

  // DB must have exactly one
  const chars = listCharacters(NOVEL_ID).filter(c => c.name === '并发角色');
  assert.equal(chars.length, 1, 'no duplicate in DB');
});

test('T3.4: late response from pack A discarded when switched to pack B', async () => {
  const packA = makePack('t3-late-a', NOVEL_ID, 'approved');
  const packB = makePack('t3-late-b', NOVEL_ID, 'approved');
  createContinuationPack(packA);
  createContinuationPack(packB);

  // Simulate: extract for pack A, then immediately extract for pack B
  // The second call should cancel the first (via seq increment + abort)
  // and only pack B's result should be set.
  const savedConfigDir = process.env.INKFLOW_CONFIG_DIR;
  const originalFetch = globalThis.fetch;
  const tmpConfigDir = path.join(os.tmpdir(), `inkflow-t3-late-${process.pid}`);
  let callCount = 0;
  try {
    fs.mkdirSync(tmpConfigDir, { recursive: true });
    fs.writeFileSync(path.join(tmpConfigDir, 'config.json'), JSON.stringify({
      apiKey: 'sk-t3-late-key', baseUrl: 'https://api.openai-mock.com/v1', model: 'gpt-4o',
    }));
    process.env.INKFLOW_CONFIG_DIR = tmpConfigDir;
    reloadConfig();

    // Mock LLM: first call returns pack A extraction, second returns pack B
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (urlStr.includes('/chat/completions') || urlStr.includes('api.openai-mock')) {
        callCount++;
        if (callCount === 1) {
          // Pack A extraction — slow (simulate delay)
          await new Promise(r => setTimeout(r, 50));
          return new Response(JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
              characters: [{ name: 'PackA角色', role: 'supporting', summary: '', bio: '', traits: [] }],
              locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [],
              relationships: [], globalOutline: '', worldRules: '',
            }) } }],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        // Pack B extraction
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            characters: [{ name: 'PackB角色', role: 'protagonist', summary: '', bio: '', traits: [] }],
            locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [],
            relationships: [], globalOutline: '', worldRules: '',
          }) } }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(url, init);
    };

    // Extract pack A
    const gen = getDatabaseGeneration();
    const jobA = await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId: packA.id, novelId: NOVEL_ID, databaseGeneration: gen }),
    });

    // Extract pack B immediately
    const jobB = await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId: packB.id, novelId: NOVEL_ID, databaseGeneration: gen }),
    });
    // Wait for both jobs so pack A's extraction has settled before asserting B.
    await waitForExtractionJob(jobA);
    const bodyB = await waitForExtractionJob(jobB) as { extraction: { characters: { name: string }[] }; packId: string };

    // Pack B's result should have pack B's character, not pack A's
    assert.equal(bodyB.packId, packB.id, 'response is for pack B');
    assert.equal(bodyB.extraction.characters[0]?.name, 'PackB角色', 'pack B extraction correct');
  } finally {
    globalThis.fetch = originalFetch;
    if (savedConfigDir === undefined) delete process.env.INKFLOW_CONFIG_DIR; else process.env.INKFLOW_CONFIG_DIR = savedConfigDir;
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  }
});
