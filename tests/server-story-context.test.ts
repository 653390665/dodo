import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  closeDb,
  createChapter,
  createCharacter,
  createForeshadowing,
  createNovel,
  initDb,
  saveNarrativePromiseCoreInTransaction,
} from '../server/lib/db.ts';
import { buildServerStoryContext, buildServerStoryContextWithSemantic } from '../server/helpers/story-context.ts';

let dbPath = '';

afterEach(() => {
  closeDb();
  if (!dbPath) return;
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
});

test('server story context rebuilds canon and keeps client context supplemental', () => {
  dbPath = path.join(os.tmpdir(), `inkflow-story-context-${Date.now()}.db`);
  initDb(dbPath);
  createNovel({
    id: 'novel-ledger',
    title: '账本测试',
    authorId: 'local-user',
    summary: '城中所有钟都慢一刻钟。',
    worldRules: '太阳落山后不能说出真名。',
    globalOutline: '主角必须在第三次月蚀前找到门。',
    status: 'ongoing',
    createdAt: 1,
    updatedAt: 1,
  });
  createChapter({ id: 'chapter-ledger', novelId: 'novel-ledger', title: '第一章', content: '林渡看见钟楼。', sceneBeats: '进入钟楼', order: 1, wordCount: 8, createdAt: 1, updatedAt: 1 });
  createCharacter({ id: 'character-lindu', novelId: 'novel-ledger', name: '林渡', role: 'protagonist', summary: '害怕钟声却必须守钟', bio: '', traits: ['克制'], createdAt: 1, updatedAt: 1 });
  createForeshadowing({
    id: 'promise-server-only-73',
    novelId: 'novel-ledger',
    title: '第十三下钟声',
    description: '只有主角能听见不存在的第十三下钟声。',
    narrativeCore: {
      schemaVersion: 1,
      plan: {
        intent: '建立第十三下钟声的悬念',
        revealConstraint: '本章只能埋下声音证据，不得说明它为何不存在。',
        plannedHintRanges: [{ from: 1, to: 2 }],
        sourceOutlineNodeIds: ['outline-ledger-node'],
      },
      evidence: [],
    },
    status: 'planted',
    plantedChapterId: 'chapter-ledger',
    relatedCharacterIds: ['character-lindu'],
    createdAt: 1,
    updatedAt: 1,
  });
  saveNarrativePromiseCoreInTransaction({
    novelId: 'novel-ledger',
    foreshadowingId: 'promise-server-only-73',
    plan: {
      intent: '建立第十三下钟声的悬念',
      revealConstraint: '本章只能埋下声音证据，不得说明它为何不存在。',
      plannedHintRanges: [{ from: 1, to: 2 }],
      sourceOutlineNodeIds: ['outline-ledger-node'],
    },
  });

  const context = buildServerStoryContext({
    novelId: 'novel-ledger',
    chapterId: 'chapter-ledger',
    clientContext: '客户端临时选择：重点检查开篇节奏。',
  });

  assert.match(context, /太阳落山后不能说出真名/);
  assert.match(context, /林渡/);
  assert.match(context, /promise-server-only-73/);
  assert.match(context, /第十三下钟声/);
  assert.match(context, /只有主角能听见不存在的第十三下钟声/);
  assert.match(context, /本章只能埋下声音证据，不得说明它为何不存在/);
  assert.match(context, /客户端补充上下文/);
  assert.match(context, /重点检查开篇节奏/);
});

test('server story context rejects a chapter from another novel', () => {
  dbPath = path.join(os.tmpdir(), `inkflow-story-context-scope-${Date.now()}.db`);
  initDb(dbPath);
  createNovel({ id: 'novel-a', title: 'A', authorId: 'local-user', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  createNovel({ id: 'novel-b', title: 'B', authorId: 'local-user', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  createChapter({ id: 'chapter-b', novelId: 'novel-b', title: 'B1', content: '', order: 1, wordCount: 0, createdAt: 1, updatedAt: 1 });

  assert.throws(
    () => buildServerStoryContext({ novelId: 'novel-a', chapterId: 'chapter-b' }),
    /CHAPTER_SCOPE_MISMATCH/,
  );
});

test('semantic wrapper falls back to the base context when embedding is unavailable', async () => {
  dbPath = path.join(os.tmpdir(), `inkflow-story-context-semantic-${Date.now()}.db`);
  initDb(dbPath);
  createNovel({ id: 'semantic-novel', title: 'S', authorId: 'local-user', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  createChapter({ id: 'semantic-chapter', novelId: 'semantic-novel', title: 'S1', content: '雨夜入店。', order: 1, wordCount: 5, createdAt: 1, updatedAt: 1 });

  const context = await buildServerStoryContextWithSemantic({
    novelId: 'semantic-novel',
    chapterId: 'semantic-chapter',
  });
  // No vector chunks exist for this novel, so the semantic section must not
  // appear and the base keyword-ledger context must be intact.
  assert.doesNotMatch(context, /语义相关的过往章节片段/);
  assert.match(context, /【服务端故事状态账本】/);
});
