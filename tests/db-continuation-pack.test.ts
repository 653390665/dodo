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
    sourceMap: { sections: [{ title: '世界规则', summary: '灵气复苏但死者不能复生', sourceIds: ['d1'] }], keyConflicts: ['复生规则存在冲突'] },
    readingQuestions: [{ id: 'q1', question: '主角知道复生禁忌吗？', context: '影响下一章行动', category: 'plot' }],
    continuationGaps: [{ id: 'g1', description: '下一章缺少明确行动目标', severity: 'medium', suggestedDirection: '从酒馆账本切入', relatedFacts: ['f1'] }],
    sourceBadge: 'user-uploaded',
    createdAt: 1, updatedAt: 1,
  };
  createContinuationPack(pack);

  const list = listContinuationPacks('novel-1');
  assert.equal(list.length, 1);
  assert.equal(list[0].title, '续写资料包');
  assert.equal(list[0].status, 'draft');
  assert.equal(list[0].sourceMap?.sections[0].title, '世界规则');
  assert.equal(list[0].readingQuestions?.[0].question, '主角知道复生禁忌吗？');
  assert.equal(list[0].continuationGaps?.[0].suggestedDirection, '从酒馆账本切入');
  assert.equal(list[0].sourceBadge, 'user-uploaded');
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
