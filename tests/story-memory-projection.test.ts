import test from 'node:test';
import assert from 'node:assert/strict';
import { projectStoryMemory } from '../shared/lib/story-memory-projection.js';

const input = {
  novelId: 'novel-1',
  characters: [{ id: 'hero', novelId: 'novel-1', name: '主角', role: 'protagonist' as const, summary: '', traits: [], bio: '' }],
  chapters: [
    { id: 'ch-1', novelId: 'novel-1', title: '第一章', content: '', order: 1, wordCount: 0, createdAt: 1, updatedAt: 2 },
    { id: 'ch-2', novelId: 'novel-1', title: '第二章', content: '', order: 2, wordCount: 0, createdAt: 3, updatedAt: 4 },
  ],
  narrativePromises: [{
    id: 'promise-1', novelId: 'novel-1', title: '戒指秘密', description: '', status: 'planted' as const,
    relatedCharacterIds: ['hero'], createdAt: 1, updatedAt: 5,
    narrativeCore: { schemaVersion: 1 as const, plan: { intent: '揭示戒指来源', plannedHintRanges: [{ from: 2, to: 3 }], sourceOutlineNodeIds: ['outline-1'] }, evidence: [
      { chapterId: 'ch-1', action: 'plant' as const, quote: '戒面闪过一道光', confirmedAt: 6 },
      { chapterId: 'ch-2', action: 'payoff' as const, quote: '真相揭晓', confirmedAt: 7 },
    ] },
  }],
};

test('projectStoryMemory uses stable namespaced node and edge ids without duplicate nodes', () => {
  const projection = projectStoryMemory({ ...input, characters: [...input.characters, ...input.characters] });
  assert.deepEqual(projection.nodes.map((node) => node.id), [
    'novel-1:character:hero', 'novel-1:chapter:ch-1', 'novel-1:chapter:ch-2', 'novel-1:narrative-promise:promise-1',
  ]);
  assert.deepEqual(projection.edges.map((edge) => edge.id), [
    'novel-1:edge:planted-in:novel-1:chapter:ch-1:novel-1:narrative-promise:promise-1',
    'novel-1:edge:paid-off-in:novel-1:chapter:ch-2:novel-1:narrative-promise:promise-1',
  ]);
  assert.equal(new Set(projection.edges.map((edge) => edge.id)).size, projection.edges.length);
  assert.deepEqual(projectStoryMemory(input), projectStoryMemory(input));
});

test('projectStoryMemory projects confirmed plant and payoff evidence, but not planned ranges', () => {
    const projection = projectStoryMemory(input);
    assert.deepEqual(projection.edges.map((edge) => edge.kind), ['planted-in', 'paid-off-in']);
    assert.equal(projection.edges.some((edge) => edge.kind === 'hinted-in'), false);
});

test('projectStoryMemory filters to current chapter while retaining its promise neighborhood', () => {
    const global = projectStoryMemory(input);
    const current = projectStoryMemory(input, { currentChapterId: 'ch-1' });
    assert.equal(global.nodes.length, 4);
    assert.deepEqual(current.nodes.map((node) => node.id), ['novel-1:chapter:ch-1', 'novel-1:narrative-promise:promise-1']);
    assert.equal(global.nodes.length, 4);
});

test('projectStoryMemory reads confirmed legacy plant and payoff chapter links without inferring hints', () => {
  const projection = projectStoryMemory({
    novelId: 'novel-1',
    chapters: input.chapters,
    narrativePromises: [{
      id: 'legacy-promise', novelId: 'novel-1', title: '旧稿戒指', description: '', status: 'payoff' as const,
      plantedChapterId: 'ch-1', payoffChapterId: 'ch-2', relatedCharacterIds: [], createdAt: 1, updatedAt: 1,
    }],
  });

  assert.deepEqual(projection.edges.map((edge) => [edge.kind, edge.source, edge.target]), [
    ['planted-in', 'novel-1:chapter:ch-1', 'novel-1:narrative-promise:legacy-promise'],
    ['paid-off-in', 'novel-1:chapter:ch-2', 'novel-1:narrative-promise:legacy-promise'],
  ]);
  assert.equal(projection.edges.some((edge) => edge.kind === 'hinted-in'), false);
});

test('projectStoryMemory ignores legacy links to chapters outside the projection', () => {
  const projection = projectStoryMemory({
    novelId: 'novel-1',
    chapters: [input.chapters[0]],
    narrativePromises: [{
      id: 'legacy-promise', novelId: 'novel-1', title: '旧稿戒指', description: '', status: 'payoff' as const,
      plantedChapterId: 'missing', payoffChapterId: 'ch-1', relatedCharacterIds: [], createdAt: 1, updatedAt: 1,
    }],
  });

  assert.deepEqual(projection.edges.map((edge) => edge.kind), ['paid-off-in']);
});

test('projectStoryMemory does not add legacy links when valid core evidence exists', () => {
  const projection = projectStoryMemory({
    novelId: 'novel-1',
    chapters: input.chapters,
    narrativePromises: [{
      id: 'core-promise', novelId: 'novel-1', title: '新稿戒指', description: '', status: 'payoff' as const,
      plantedChapterId: 'ch-2', payoffChapterId: 'ch-2', relatedCharacterIds: [], createdAt: 1, updatedAt: 1,
      narrativeCore: {
        schemaVersion: 1,
        plan: { intent: '戒指秘密', plannedHintRanges: [], sourceOutlineNodeIds: ['outline-1'] },
        evidence: [{ chapterId: 'ch-1', action: 'plant', quote: '戒面闪光', confirmedAt: 1 }],
      },
    }],
  });

  assert.deepEqual(projection.edges.map((edge) => [edge.kind, edge.source]), [
    ['planted-in', 'novel-1:chapter:ch-1'],
  ]);
});
