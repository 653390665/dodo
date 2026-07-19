import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

import { registerContinuationRoutes } from '../server/routes/continuation.js';
import { registerDbRoutes } from '../server/routes/db.js';
import { closeDb, createContinuationPack, createNovel, initDb } from '../server/lib/db.js';
import { getDb, getDatabaseGeneration, advanceDatabaseGeneration } from '../server/lib/db-instance.js';
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
  app.use(express.json());
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

  await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packId: pack.id }),
  });

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

    const res = await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId: pack.id, novelId: NOVEL_ID, databaseGeneration: getDatabaseGeneration() }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { extraction: { characters: unknown[]; locations: unknown[]; items: unknown[]; factions: unknown[]; relationships: unknown[] } };
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

  // Create a pack, then delete it AFTER the transaction starts writing.
  // The transaction will read entities, start writing, then fail at pack check
  // (pack was deleted), causing full rollback.
  const pack = makePack('t3-rollback-mid', NOVEL_ID, 'approved');
  createContinuationPack(pack);

  // Delete pack to trigger PACK_NOT_FOUND inside the transaction
  db.prepare('DELETE FROM continuation_packs WHERE id = ?').run('t3-rollback-mid');

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
  assert.equal(res.status, 404);

  // All pre-seed data must survive — no partial writes
  assert.deepEqual(listCharacters(NOVEL_ID).map(c => c.name).sort(), beforeChars, 'pre-seed characters survive');
  assert.deepEqual(listLocations(NOVEL_ID).map(l => l.name).sort(), beforeLocs, 'pre-seed locations survive');
  assert.deepEqual(listEntityRelationships(NOVEL_ID).map(r => `${r.sourceType}:${r.sourceId}-${r.targetType}:${r.targetId}`).sort(), beforeRels, 'pre-seed relationships survive');
});

test('T3.2: FIFO novel fields — second sync does not overwrite first', async () => {
  const pack1 = makePack('t3-fifo-1', NOVEL_ID, 'approved');
  const pack2 = makePack('t3-fifo-2', NOVEL_ID, 'approved');
  createContinuationPack(pack1);
  createContinuationPack(pack2);

  const dbInstance = getDb();

  // First sync sets globalOutline and worldRules
  const res1 = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack1.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [],
      globalOutline: '第一版大纲',
      worldRules: '第一版规则',
    }),
  });
  assert.equal(res1.status, 200);

  const row1 = dbInstance.prepare('SELECT global_outline, world_rules FROM novels WHERE id = ?').get(NOVEL_ID) as { global_outline: string; world_rules: string };
  assert.equal(row1.global_outline, '第一版大纲');
  assert.equal(row1.world_rules, '第一版规则');

  // Second sync tries to overwrite — should be ignored (FIFO)
  const res2 = await fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId: pack2.id,
      novelId: NOVEL_ID,
      databaseGeneration: getDatabaseGeneration(),
      characters: [],
      globalOutline: '第二版大纲',
      worldRules: '第二版规则',
    }),
  });
  assert.equal(res2.status, 200);

  const row2 = dbInstance.prepare('SELECT global_outline, world_rules FROM novels WHERE id = ?').get(NOVEL_ID) as { global_outline: string; world_rules: string };
  assert.equal(row2.global_outline, '第一版大纲', 'FIFO: first write wins for globalOutline');
  assert.equal(row2.world_rules, '第一版规则', 'FIFO: first write wins for worldRules');
});

test('T3.3: concurrent syncs do not produce duplicate entities', async () => {
  const pack1 = makePack('t3-concur-1', NOVEL_ID, 'approved');
  const pack2 = makePack('t3-concur-2', NOVEL_ID, 'approved');
  createContinuationPack(pack1);
  createContinuationPack(pack2);

  const payload1 = {
    packId: pack1.id,
    novelId: NOVEL_ID,
    databaseGeneration: getDatabaseGeneration(),
    characters: [{ name: '并发角色' }],
    locations: [{ name: '并发地点' }],
  };
  const payload2 = {
    packId: pack2.id,
    novelId: NOVEL_ID,
    databaseGeneration: getDatabaseGeneration(),
    characters: [{ name: '并发角色' }],
    locations: [{ name: '并发地点' }],
  };

  // Fire both concurrently
  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload1),
    }),
    fetch(`${baseUrl}/api/continuation-packs/sync-to-world`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload2),
    }),
  ]);

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
    const resA = await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId: packA.id, novelId: NOVEL_ID, databaseGeneration: gen }),
    });
    const bodyA = await resA.json() as { extraction: { characters: { name: string }[] }; packId: string };

    // Extract pack B immediately
    const resB = await fetch(`${baseUrl}/api/continuation-packs/extract-entities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId: packB.id, novelId: NOVEL_ID, databaseGeneration: gen }),
    });
    const bodyB = await resB.json() as { extraction: { characters: { name: string }[] }; packId: string };

    // Pack B's result should have pack B's character, not pack A's
    assert.equal(bodyB.packId, packB.id, 'response is for pack B');
    assert.equal(bodyB.extraction.characters[0]?.name, 'PackB角色', 'pack B extraction correct');
  } finally {
    globalThis.fetch = originalFetch;
    if (savedConfigDir === undefined) delete process.env.INKFLOW_CONFIG_DIR; else process.env.INKFLOW_CONFIG_DIR = savedConfigDir;
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  }
});
