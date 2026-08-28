import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  buildLegacyStructuringPrompt,
  confirmLegacyStructuringPreview,
  createLegacyArtifactPreview,
  listLegacyArtifactSources,
  parseLegacyStructuringOutput,
} from '../server/helpers/legacy-artifact-structuring.js';
import {
  closeDb, createCharacter, createChapter, createForeshadowing, createNovel,
  createOutlineArtifact, activateOutlineArtifact, getArtifactCore,
  initDb, updateNovel, listOutlineArtifacts,
} from '../server/lib/db.js';
import { getDatabaseGeneration, getDb } from '../server/lib/db-instance.js';
import { getConfig } from '../server/lib/config.js';
import { __rateLimitTestHooks } from '../server/middleware/rate-limit.js';
import { registerRoutes } from '../server/routes/index.js';
import type { LegacyArtifactSource } from '../shared/types/legacy-artifact-structuring.js';

const outlineCore = { schemaVersion: 1, nodes: [{ id: 'n1', type: 'premise', title: '冲突', intent: '建立冲突', order: 0, characterIds: [], foreshadowingIds: [] }] };
const promiseCore = { schemaVersion: 1, plan: { intent: '门会打开', plannedHintRanges: [{ from: 1, to: 2 }], sourceOutlineNodeIds: ['n1'] }, evidence: [] };

function rowCounts(): Record<string, number> {
  return Object.fromEntries(['novels', 'characters', 'outline_artifacts', 'chapters', 'foreshadowings', 'creative_artifact_cores'].map((table) => [table, (getDb().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count]));
}

function fixture(): void {
  closeDb(); initDb(':memory:');
  createNovel({ id: 'n1', title: '测试', authorId: 'local', summary: '', status: 'ongoing', worldRules: '世界规则原文', createdAt: 1, updatedAt: 1 });
  createCharacter({ id: 'char1', novelId: 'n1', name: '甲', role: 'protagonist', summary: '角色摘要', traits: [], bio: '角色传记原文', createdAt: 1, updatedAt: 1 });
  createOutlineArtifact({ id: 'outline1', novelId: 'n1', level: 'master', scope: {}, content: '大纲原文' });
  activateOutlineArtifact('n1', 'outline1');
  createChapter({ id: 'chapter1', novelId: 'n1', title: '第一章', content: '正文', sceneBeats: '场景细纲原文', order: 1, wordCount: 2, createdAt: 1, updatedAt: 1 });
  createForeshadowing({ id: 'promise1', novelId: 'n1', title: '伏笔', description: '伏笔原文', status: 'planted', relatedCharacterIds: [], createdAt: 1, updatedAt: 1 });
}

test.beforeEach(fixture);
test.after(() => closeDb());

test('discovers all five legacy source families without writes', () => {
  const before = rowCounts();
  const sources = listLegacyArtifactSources('n1');
  assert.deepEqual(new Set(sources.map((source) => source.artifactKind)), new Set(['world', 'character', 'master-outline', 'scene-beats', 'narrative-promise']));
  assert.deepEqual(rowCounts(), before);
  const expectedRootField: Partial<Record<LegacyArtifactSource['artifactKind'], string>> = {
    world: 'hardRules', character: 'desire', 'master-outline': 'nodes',
    'scene-beats': 'beats', 'narrative-promise': 'plannedHintRanges',
  };
  for (const source of sources) {
    const prompt = buildLegacyStructuringPrompt(source);
    assert.match(prompt, /只输出 JSON/);
    assert.match(prompt, /不得编造/);
    assert.match(prompt, new RegExp(expectedRootField[source.artifactKind]!));
    assert.match(prompt, new RegExp(source.originalContent));
  }
  createCharacter({ id: 'char2', novelId: 'n1', name: '乙', role: 'supporting', summary: '相同摘要', traits: [], bio: '角色传记原文', createdAt: 1, updatedAt: 1 });
  const matchingCharacters = listLegacyArtifactSources('n1').filter((source) => source.artifactKind === 'character');
  assert.equal(matchingCharacters.length, 2);
  assert.notEqual(matchingCharacters[0].sourceFingerprint, matchingCharacters[1].sourceFingerprint);
});

test('omits every already structured source, including outline core', () => {
  const sources = listLegacyArtifactSources('n1');
  for (const source of sources) {
    if (source.artifactKind === 'master-outline') {
      getDb().prepare('UPDATE outline_artifacts SET core_json = ? WHERE id = ?').run(JSON.stringify(outlineCore), 'outline1');
    } else {
      const core = source.artifactKind === 'world' ? { schemaVersion: 1, hardRules: [{ id: 'r', statement: '不可飞' }] }
        : source.artifactKind === 'character' ? { schemaVersion: 1, desire: '求生' }
          : source.artifactKind === 'scene-beats' ? { schemaVersion: 1, beats: [{ order: 1, summary: '冲突', intent: '推进' }] } : promiseCore;
      getDb().prepare('INSERT INTO creative_artifact_cores (id, novel_id, artifact_kind, artifact_id, version, core_json, readable_content, provenance_json, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, NULL, ?, 1, 1)').run(`core-${source.artifactId}`, 'n1', source.artifactKind, source.artifactId, JSON.stringify(core), '{}');
    }
  }
  assert.equal(listLegacyArtifactSources('n1').length, 0);
});

const validOutputs: Array<[LegacyArtifactSource['artifactKind'], string]> = [
  ['world', JSON.stringify({ schemaVersion: 1, hardRules: [{ id: 'r', statement: '不可飞' }] })],
  ['character', JSON.stringify({ schemaVersion: 1, desire: '求生', externalGoal: '逃离', immutableFacts: ['左撇子'] })],
  ['master-outline', JSON.stringify(outlineCore)],
  ['scene-beats', JSON.stringify({ schemaVersion: 1, beats: [{ order: 1, summary: '冲突', intent: '推进' }] })],
  ['narrative-promise', JSON.stringify(promiseCore)],
];

test('strict parser accepts valid five-kind outputs and rejects malformed cores', () => {
  const sources = listLegacyArtifactSources('n1');
  for (const [kind, raw] of validOutputs) assert.doesNotThrow(() => parseLegacyStructuringOutput(sources.find((source) => source.artifactKind === kind)!, raw));
  const source = sources.find((item) => item.artifactKind === 'scene-beats')!;
  for (const raw of ['not json', '{}', JSON.stringify({ schemaVersion: 1, beats: [{ order: 1, summary: '', intent: 'x' }] })]) assert.throws(() => parseLegacyStructuringOutput(source, raw));
  assert.throws(() => parseLegacyStructuringOutput(sources.find((item) => item.artifactKind === 'master-outline')!, JSON.stringify({ schemaVersion: 1, nodes: [{ bad: true }] })));
  assert.throws(() => parseLegacyStructuringOutput(sources.find((item) => item.artifactKind === 'narrative-promise')!, JSON.stringify({ schemaVersion: 1, plan: {}, evidence: [] })));
  assert.throws(() => parseLegacyStructuringOutput(sources.find((item) => item.artifactKind === 'character')!, '{}'));
});

test('confirmation rejects expiry, generation, fingerprint and ownership without writes', async () => {
  const source = listLegacyArtifactSources('n1').find((item) => item.artifactKind === 'world')!;
  const parsed = parseLegacyStructuringOutput(source, validOutputs[0][1]);
  const before = rowCounts();
  await assert.rejects(confirmLegacyStructuringPreview({ preview: createLegacyArtifactPreview(source, parsed, Date.now() - 1), databaseGeneration: getDatabaseGeneration() }));
  await assert.rejects(confirmLegacyStructuringPreview({ preview: createLegacyArtifactPreview(source, parsed), databaseGeneration: getDatabaseGeneration() + 1 }));
  updateNovel('n1', { worldRules: '新原文' });
  await assert.rejects(confirmLegacyStructuringPreview({ preview: createLegacyArtifactPreview(source, parsed), databaseGeneration: getDatabaseGeneration() }));
  assert.deepEqual(rowCounts(), before);
  const foreign = { ...source, novelId: 'missing' };
  await assert.rejects(confirmLegacyStructuringPreview({ preview: createLegacyArtifactPreview(foreign, parsed), databaseGeneration: getDatabaseGeneration() }));
  assert.deepEqual(rowCounts(), before);
});

test('confirmation persists outline through Canon Patch and other four as readable versions', async () => {
  const generation = getDatabaseGeneration();
  for (const [kind, raw] of validOutputs) {
    const source = listLegacyArtifactSources('n1').find((item) => item.artifactKind === kind)!;
    const preview = createLegacyArtifactPreview(source, parseLegacyStructuringOutput(source, raw));
    const result = await confirmLegacyStructuringPreview({ preview, databaseGeneration: generation });
    assert.equal(result.status, 'accepted');
    if (kind === 'master-outline') assert.ok(listOutlineArtifacts('n1', { status: 'active' }).some((outline) => outline.id !== 'outline1' && outline.core && outline.core.nodes[0].title === '冲突'));
    else {
      const stored = getArtifactCore('n1', kind, source.artifactId)!;
      assert.equal(stored.version, 1);
      assert.equal(stored.readableContent, source.originalContent);
      assert.equal(stored.provenance.source, 'legacy-artifact-structuring');
    }
  }
});

test('explicit routes keep discovery read-only and persist only after valid confirmation', async () => {
  const config = getConfig();
  const originalConfig = { apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model, promptGuardLevel: config.promptGuardLevel };
  const originalFetch = globalThis.fetch;
  const providerOutputs = ['not json', validOutputs[0][1]];
  let providerCalls = 0;
  config.apiKey = '';
  const app = express();
  app.use(express.json());
  registerRoutes(app);
  config.apiKey = 'test-key';
  config.baseUrl = 'https://legacy-structuring.test/v1';
  config.model = 'test-model';
  config.promptGuardLevel = 'disabled';
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith(baseUrl)) return originalFetch(input, init);
    providerCalls += 1;
    return Response.json({ choices: [{ message: { content: providerOutputs.shift() ?? validOutputs[0][1] } }] });
  };
  try {
    const generation = getDatabaseGeneration();
    const discovery = await fetch(`${baseUrl}/api/novels/n1/legacy-artifacts`);
    assert.equal(discovery.status, 200);
    const discovered = await discovery.json() as { sources: LegacyArtifactSource[]; databaseGeneration: number };
    assert.equal(discovered.sources.length, 5);
    assert.equal(discovered.databaseGeneration, generation);
    assert.equal(providerCalls, 0);
    assert.equal(getArtifactCore('n1', 'world', 'n1'), undefined);

    const previewBody = { artifactKind: 'world', artifactId: 'n1', databaseGeneration: generation };
    const malformed = await fetch(`${baseUrl}/api/novels/n1/legacy-artifacts/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(previewBody),
    });
    assert.equal(malformed.status, 422);
    assert.equal(providerCalls, 1);
    assert.equal(getArtifactCore('n1', 'world', 'n1'), undefined);

    const previewResponse = await fetch(`${baseUrl}/api/novels/n1/legacy-artifacts/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(previewBody),
    });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json() as { preview: { previewId: string; source: LegacyArtifactSource } };
    assert.equal(preview.preview.source.originalContent, '世界规则原文');
    assert.equal(providerCalls, 2);
    assert.equal(getArtifactCore('n1', 'world', 'n1'), undefined);

    const invalidConfirm = await fetch(`${baseUrl}/api/novels/n1/legacy-artifacts/confirm`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ previewId: preview.preview.previewId, databaseGeneration: generation, source: preview.preview.source }),
    });
    assert.equal(invalidConfirm.status, 400);
    assert.equal(getArtifactCore('n1', 'world', 'n1'), undefined);

    const confirmed = await fetch(`${baseUrl}/api/novels/n1/legacy-artifacts/confirm`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ previewId: preview.preview.previewId, databaseGeneration: generation }),
    });
    assert.equal(confirmed.status, 200);
    assert.equal((await confirmed.json() as { status: string }).status, 'accepted');
    assert.equal(getArtifactCore('n1', 'world', 'n1')?.readableContent, '世界规则原文');
    const reused = await fetch(`${baseUrl}/api/novels/n1/legacy-artifacts/confirm`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ previewId: preview.preview.previewId, databaseGeneration: generation }),
    });
    assert.equal(reused.status, 409);
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(config, originalConfig);
    __rateLimitTestHooks.reset();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
