import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { Chapter, Foreshadowing, Novel } from '../shared/types';
import { closeDb, createChapter, createForeshadowing, createForeshadowingsBatch, createNovel, createNovelWithChapter, getNovel, initDb, listForeshadowings } from '../server/lib/db';

const novel = (id: string): Novel => ({
  id, title: id, authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1,
});

const chapter = (id: string, novelId: string): Chapter => ({
  id, novelId, title: '第一章', content: '', order: 0, wordCount: 0, createdAt: 1, updatedAt: 1,
});

const foreshadowing = (id: string): Foreshadowing => ({
  id, novelId: 'n1', title: id, description: '', status: 'planted', relatedCharacterIds: [], createdAt: 1, updatedAt: 1,
});

describe('atomic database create operations', () => {
  beforeEach(() => initDb(':memory:'));
  afterEach(() => closeDb());

  test('rolls back novel when its first chapter cannot be created', () => {
    createNovel(novel('existing'));
    createChapter(chapter('duplicate-chapter', 'existing'));

    assert.throws(() => createNovelWithChapter(novel('new'), chapter('duplicate-chapter', 'new')));
    assert.equal(getNovel('new'), undefined);
  });

  test('rolls back the entire foreshadowing batch on a duplicate id', () => {
    createNovel(novel('n1'));
    createForeshadowing(foreshadowing('existing'));
    assert.throws(() => createForeshadowingsBatch([foreshadowing('new'), foreshadowing('existing')]));
    assert.deepEqual(listForeshadowings('n1').map((item) => item.id), ['existing']);
  });
});
