import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb, closeDb, createNovel, createContinuationPack, listContinuationPacks, getContinuationPack, updateContinuationPack } from '../src/lib/db';
import type { ContinuationPack } from '../src/types';

const DB_PATH = '/tmp/test-continuation-pack.db';

import fs from 'node:fs';

test.beforeEach(() => {
  try { closeDb(); } catch {}
  try { fs.unlinkSync(DB_PATH); } catch {}
  initDb(DB_PATH);
  createNovel({ id: 'novel-1', title: '测试', authorId: 'user', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
});

test.after(() => {
  closeDb();
});

test('create and list continuation packs', () => {
  const pack: ContinuationPack = {
    id: 'pack-1', novelId: 'novel-1', title: '续写资料包', status: 'draft',
    sourceDocuments: [{ id: 'd1', packId: 'pack-1', filename: '设定.txt', kind: 'world', text: '灵气复苏', excerpt: '灵气', createdAt: 1 }],
    canonFacts: [{ id: 'f1', priority: 'hard', category: 'world', text: '死者不能复生', evidence: '设定原文' }],
    characterStates: [{ name: '林照', role: '主角', currentGoal: '复仇', emotionalState: '压抑', secrets: [], relationshipNotes: [], evidence: '' }],
    plotState: { currentTimeline: '第2章后', latestScene: '酒馆', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
    styleProfile: { pov: '第三人称', tense: '过去', pacing: '紧', dialogueDensity: '中', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
    contradictions: [], continuationTask: '续写下一章',
    createdAt: 1, updatedAt: 1,
  };
  createContinuationPack(pack);

  const list = listContinuationPacks('novel-1');
  assert.equal(list.length, 1);
  assert.equal(list[0].title, '续写资料包');
  assert.equal(list[0].status, 'draft');
});

test('update continuation pack status', () => {
  const pack: ContinuationPack = {
    id: 'pack-2', novelId: 'novel-1', title: '更新测试', status: 'draft',
    sourceDocuments: [], canonFacts: [], characterStates: [],
    plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
    styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
    contradictions: [], continuationTask: '', createdAt: 1, updatedAt: 1,
  };
  createContinuationPack(pack);
  updateContinuationPack('pack-2', { status: 'approved' });

  const updated = getContinuationPack('pack-2');
  assert.equal(updated?.status, 'approved');
});
