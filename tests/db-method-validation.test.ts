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
