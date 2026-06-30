import assert from 'node:assert/strict';
import test from 'node:test';

import { buildKnowledgeSearchEntries } from '../src/lib/agent-workspace-knowledge';
import type { ContinuationPack } from '../shared/types';

function buildPack(overrides: Partial<ContinuationPack> = {}): ContinuationPack {
  return {
    id: 'pack-1',
    novelId: 'novel-1',
    title: '城隍庙资料包',
    status: 'approved',
    sourceDocuments: [],
    canonFacts: [
      { id: 'fact-1', priority: 'hard', category: 'world', text: '供桌下有机关', evidence: '原文提及裂砖机关' },
    ],
    characterStates: [
      {
        name: '林砚',
        role: '主角',
        currentGoal: '找到暗道入口',
        emotionalState: '高度戒备',
        secrets: ['知道掌柜隐瞒旧案'],
        relationshipNotes: ['与掌柜互相试探'],
        evidence: '人物设定文档',
      },
    ],
    plotState: {
      currentTimeline: '第一卷中段',
      latestScene: '林砚被追兵逼入城隍庙',
      unresolvedHooks: ['账本下落不明'],
      immediateConflict: '追兵将至',
      nextLikelyMove: '撬开供桌机关',
    },
    styleProfile: {
      pov: '第三人称',
      tense: '过去时',
      pacing: '紧推进',
      dialogueDensity: '中等',
      proseTraits: ['压迫感'],
      avoidTraits: ['空泛抒情'],
      sampleEvidence: '雨夜、追兵、机关三线并压',
    },
    contradictions: [],
    continuationTask: '继续写机关与暗道追逃',
    sourceMap: {
      sections: [{ title: '人物小传', summary: '林砚与掌柜互相试探', sourceIds: ['char-doc'] }],
      keyConflicts: ['掌柜是否可信'],
    },
    readingQuestions: [
      { id: 'q-1', question: '掌柜为何提前知道追兵会来', context: '信息来源不明', category: 'plot' },
    ],
    continuationGaps: [
      { id: 'g-1', description: '暗道出口未定', severity: 'high', suggestedDirection: '废井或旧库房', relatedFacts: ['供桌下有机关'] },
    ],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

test('buildKnowledgeSearchEntries surfaces approved continuation-pack knowledge', () => {
  const entries = buildKnowledgeSearchEntries({
    bibleSearch: '',
    characters: [],
    locations: [],
    items: [],
    continuationPacks: [buildPack()],
    selectedContinuationPackId: 'pack-1',
  });

  assert.equal(entries.length >= 5, true);
  assert.equal(entries[0].sourceLabel.includes('资料包'), true);
  assert.equal(entries.some((entry) => entry.title === '供桌下有机关'), true);
  assert.equal(entries.some((entry) => entry.title === '林砚'), true);
  assert.equal(entries.some((entry) => entry.title === '继续写机关与暗道追逃'), true);
});

test('buildKnowledgeSearchEntries filters continuation-pack knowledge by search term', () => {
  const entries = buildKnowledgeSearchEntries({
    bibleSearch: '掌柜',
    characters: [],
    locations: [],
    items: [],
    continuationPacks: [buildPack()],
    selectedContinuationPackId: 'pack-1',
  });

  assert.equal(entries.length > 0, true);
  assert.equal(entries.every((entry) => `${entry.title} ${entry.summary} ${entry.detail}`.includes('掌柜')), true);
});

test('buildKnowledgeSearchEntries falls back to draft continuation-pack knowledge when no approved pack exists', () => {
  const entries = buildKnowledgeSearchEntries({
    bibleSearch: '',
    characters: [],
    locations: [],
    items: [],
    continuationPacks: [buildPack({ status: 'draft' })],
    selectedContinuationPackId: '',
  });

  assert.equal(entries.length >= 5, true);
  assert.equal(entries.some((entry) => entry.title === '供桌下有机关'), true);
  assert.equal(entries.some((entry) => entry.title === '继续写机关与暗道追逃'), true);
});
