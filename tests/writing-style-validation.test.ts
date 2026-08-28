import test from 'node:test';
import assert from 'node:assert/strict';
import { chapterProductionSchema, writingStyleConfirmSchema, writingStyleResolveSchema } from '../server/validation.js';

test('writing-style resolve and confirm require chapter and database generation', () => {
  for (const schema of [writingStyleResolveSchema, writingStyleConfirmSchema]) {
    assert.equal(schema.safeParse({}).success, false);
    assert.equal(schema.safeParse({ chapterId: 'chapter-1' }).success, false);
    assert.equal(schema.safeParse({ databaseGeneration: 1 }).success, false);
    assert.equal(schema.safeParse({ chapterId: 'chapter-1', databaseGeneration: 1 }).success, true);
  }
});

test('chapter production requires the scoped chapter and database generation', () => {
  const base = { novelId: 'novel-1', userIntent: '继续写' };
  assert.equal(chapterProductionSchema.safeParse(base).success, false);
  assert.equal(chapterProductionSchema.safeParse({ ...base, chapterId: 'chapter-1' }).success, false);
  assert.equal(chapterProductionSchema.safeParse({ ...base, databaseGeneration: 1 }).success, false);
  assert.equal(chapterProductionSchema.safeParse({ ...base, chapterId: 'chapter-1', databaseGeneration: 1 }).success, true);
});
