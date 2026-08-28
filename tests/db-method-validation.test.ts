import test from 'node:test';
import assert from 'node:assert/strict';

import { dbSchema } from '../server/validation';

test('db method registry accepts valid method-specific argument tuples', () => {
  assert.equal(dbSchema.safeParse({ method: 'listNovels', args: [] }).success, true);
  assert.equal(dbSchema.safeParse({ method: 'getChapter', args: ['chapter-1'] }).success, true);
  assert.equal(dbSchema.safeParse({
    method: 'updateChapter',
    args: ['chapter-1', { content: '正文' }],
  }).success, true);
  assert.equal(dbSchema.safeParse({
    method: 'updateChapter',
    args: ['chapter-1', {
      workflowMeta: {
        version: 1,
        capabilityState: {
          novelId: 'novel-1',
          databaseGeneration: 1,
          techniqueIds: ['prose-action-booster'],
          overlayCardIds: [],
          updatedAt: 1,
        },
      },
    }],
  }).success, true);
  assert.equal(dbSchema.safeParse({
    method: 'acceptChapterContentCandidate',
    args: [{
      chapterId: 'chapter-1',
      novelId: 'novel-1',
      baselineHash: 'a'.repeat(64),
      content: '正文',
      wordCount: 2,
      operation: 'draft',
      source: 'model',
      version: {
        id: 'version-1',
        chapterId: 'chapter-1',
        content: '旧正文',
        wordCount: 3,
        author: 'editor-agent',
        createdAt: 1,
      },
    }],
  }).success, true);
});

test('db method registry rejects unknown methods and invalid argument shapes', () => {
  assert.equal(dbSchema.safeParse({ method: 'rawSql', args: ['DROP TABLE novels'] }).success, false);
  assert.equal(dbSchema.safeParse({ method: 'getChapter', args: [] }).success, false);
  assert.equal(dbSchema.safeParse({ method: 'updateChapter', args: [{ content: '正文' }] }).success, false);
  assert.equal(dbSchema.safeParse({ method: 'createChapter', args: ['not-an-object'] }).success, false);
});

test('db method registry rejects oversized entity payloads', () => {
  const result = dbSchema.safeParse({
    method: 'updateChapter',
    args: ['chapter-1', { content: 'x'.repeat(1_000_001) }],
  });
  assert.equal(result.success, false);
});

test('db method registry validates core entity fields and enums', () => {
  assert.equal(dbSchema.safeParse({
    method: 'createCharacter',
    args: [{
      id: 'character-1', novelId: 'novel-1', name: '角色', role: 'supporting',
      summary: '', traits: [], bio: '', createdAt: 1, updatedAt: 1,
    }],
  }).success, true);
  assert.equal(dbSchema.safeParse({
    method: 'createCharacter',
    args: [{
      id: 'character-1', novelId: 'novel-1', name: '角色', role: 'invalid-role',
      summary: '', traits: [], bio: '', createdAt: 1, updatedAt: 1,
    }],
  }).success, false);
  assert.equal(dbSchema.safeParse({
    method: 'updateChapter',
    args: ['chapter-1', { wordCount: 'not-a-number' }],
  }).success, false);
  assert.equal(dbSchema.safeParse({
    method: 'updateItem',
    args: ['item-1', { unexpectedField: true }],
  }).success, false);
});

test('db method registry keeps identity and project ownership immutable', () => {
  for (const [method, changes] of [
    ['updateNovel', { id: 'novel-2' }],
    ['updateNovel', { createdAt: 2 }],
    ['updateChapter', { novelId: 'novel-2' }],
    ['updateCharacter', { novelId: 'novel-2' }],
    ['updateLocation', { novelId: 'novel-2' }],
    ['updateItem', { novelId: 'novel-2' }],
    ['updateFaction', { novelId: 'novel-2' }],
    ['updatePowerLevel', { novelId: 'novel-2' }],
    ['updateTimelineEvent', { novelId: 'novel-2' }],
    ['updateIdeaFragment', { novelId: 'novel-2' }],
    ['updateForeshadowing', { novelId: 'novel-2' }],
    ['updateEntityRelationship', { novelId: 'novel-2' }],
  ] as const) {
    assert.equal(
      dbSchema.safeParse({ method, args: ['entity-1', changes] }).success,
      false,
      `${method} must reject immutable fields`,
    );
  }
});
