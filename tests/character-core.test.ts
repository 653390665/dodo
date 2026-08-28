import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnoseCharacterCore, normalizeCharacterCore } from '../shared/lib/character-core.js';
import { buildCharacterCandidateInput } from '../server/helpers/character-candidates.js';
import { acceptArtifactCandidate, previewArtifactCandidate } from '../server/helpers/creative-artifact-candidates.js';
import { closeDb, createCharacter, createEntityRelationship, createForeshadowing, createNovel, getArtifactCore, getCharacter, initDb } from '../server/lib/db.js';
import { getDatabaseGeneration } from '../server/lib/db-instance.js';

test('character completeness is deterministic and normalization invents no facts', () => {
  const readable = { summary: '守夜人', bio: '她守着北门。', traits: ['克制'] };
  const before = structuredClone(readable);
  const core = normalizeCharacterCore(readable);
  assert.deepEqual(diagnoseCharacterCore(core), [
    'desire', 'externalGoal', 'fearOrFalseBelief', 'contradictions', 'speechPattern', 'decisionPattern', 'arc', 'immutableFacts',
  ]);
  assert.deepEqual(readable, before);
  assert.deepEqual(normalizeCharacterCore({ desire: '守住城门', externalGoal: '查清失踪案', fear: '失去同伴', contradictions: ['冷静却冲动'], speechPattern: '短句', decisionPattern: '先观察', arc: { start: '封闭', turns: ['失守'], target: '信任' }, immutableFacts: ['出身北门'] }), {
    schemaVersion: 1, desire: '守住城门', externalGoal: '查清失踪案', internalNeed: '', fear: '失去同伴', woundOrFalseBelief: '', strengths: [], flaws: [], contradictions: ['冷静却冲动'], speechPattern: '短句', habitualActions: [], decisionPattern: '先观察', relationshipTensions: [], arc: { start: '封闭', turns: ['失守'], target: '信任' }, immutableFacts: ['出身北门'],
  });
});

test('only accepting a character candidate persists its structured core', async () => {
  closeDb();
  initDb(':memory:');
  try {
    createNovel({ id: 'n1', title: 'N', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
    createCharacter({ id: 'c1', novelId: 'n1', name: '北门', role: 'protagonist', summary: '守夜人', bio: '原始小传', traits: ['克制'], createdAt: 1, updatedAt: 1 });
    createCharacter({ id: 'c2', novelId: 'n1', name: '南门', role: 'supporting', summary: '', bio: '', traits: [], createdAt: 1, updatedAt: 1 });
    createEntityRelationship({ id: 'rel-1', novelId: 'n1', sourceType: 'character', sourceId: 'c1', targetType: 'character', targetId: 'c2', relationshipType: '同僚', description: '', createdAt: 1 });
    createForeshadowing({ id: 'promise-1', novelId: 'n1', title: '北门失守', description: '', status: 'planted', relatedCharacterIds: ['c1'], createdAt: 1, updatedAt: 1 });
    const character = getCharacter('c1')!;
    const candidate = await previewArtifactCandidate(buildCharacterCandidateInput({
      novelId: 'n1', character, rawOutput: JSON.stringify({ desire: '守住城门' }),
    }));
    assert.deepEqual(candidate.impactReport.affectedEntities, [
      { kind: 'relationship', id: 'rel-1', reviewRequired: true },
      { kind: 'narrative-promise', id: 'promise-1', reviewRequired: true },
    ]);
    assert.equal(getArtifactCore('n1', 'character', 'c1'), undefined);
    assert.deepEqual(getCharacter('c1'), character);
    await acceptArtifactCandidate({ novelId: 'n1', candidateId: candidate.id, databaseGeneration: getDatabaseGeneration() });
    assert.equal((getArtifactCore('n1', 'character', 'c1')?.core as { desire?: string }).desire, '守住城门');
    assert.deepEqual(getCharacter('c1'), character);
  } finally {
    closeDb();
  }
});
