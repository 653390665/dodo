import assert from 'node:assert/strict';
import test from 'node:test';

import { buildContinuationOverviewState } from '../src/lib/continuation-overview';
import type { ContinuationPack } from '../src/types';

function buildPack(overrides: Partial<ContinuationPack> = {}): ContinuationPack {
  return {
    id: 'pack-1',
    novelId: 'novel-1',
    title: '城隍庙资料包',
    status: 'draft',
    sourceDocuments: [],
    canonFacts: [{ id: 'fact-1', priority: 'hard', category: 'world', text: '供桌下有机关', evidence: 'doc' }],
    characterStates: [],
    plotState: {
      currentTimeline: '第一卷中段',
      latestScene: '林砚被追兵逼入城隍庙',
      unresolvedHooks: [],
      immediateConflict: '追兵逼近',
      nextLikelyMove: '掀开供桌寻找机关',
    },
    styleProfile: {
      pov: '第三人称',
      tense: '过去时',
      pacing: '紧推进',
      dialogueDensity: '中等',
      proseTraits: [],
      avoidTraits: [],
      sampleEvidence: '',
    },
    contradictions: [],
    continuationTask: '继续写城隍庙机关与暗道',
    sourceMap: { sections: [], keyConflicts: [] },
    readingQuestions: [],
    continuationGaps: [],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

test('overview prefers approved pack over draft packs', () => {
  const draftPack = buildPack({ id: 'draft-1', status: 'draft', updatedAt: 30 });
  const approvedPack = buildPack({ id: 'approved-1', status: 'approved', updatedAt: 20 });
  const state = buildContinuationOverviewState([draftPack, approvedPack]);

  assert.equal(state.kind, 'ready');
  assert.equal(state.primaryPack?.id, 'approved-1');
  assert.equal(state.draftPack?.id, 'draft-1');
  assert.equal(state.approvedPack?.id, 'approved-1');
});

test('overview falls back to ready when newest approved pack has no high risk', () => {
  const pack = buildPack({ id: 'approved-1', status: 'approved', updatedAt: 50 });
  const state = buildContinuationOverviewState([pack]);

  assert.equal(state.kind, 'ready');
  assert.equal(state.primaryPack?.id, 'approved-1');
});

test('overview enters risk state for approved pack with severe contradictions and gaps', () => {
  const pack = buildPack({
    id: 'approved-risk',
    status: 'approved',
    contradictions: [
      { id: 'c-1', severity: 'high', summary: '时间线冲突', conflictingEvidence: ['A', 'B'], suggestedResolution: '先人工确认' },
    ],
    continuationGaps: [{ id: 'g-1', description: '暗道终点未定', severity: 'high', suggestedDirection: '先定废井或旧仓库', relatedFacts: [] }],
  });
  const state = buildContinuationOverviewState([pack]);

  assert.equal(state.kind, 'risk');
  assert.equal(state.highlightWarnings[0], '时间线冲突');
  assert.equal(state.highlightWarnings[1], '暗道终点未定');
});

test('overview returns draft kind when only draft exists', () => {
  const pack = buildPack({ id: 'draft-1', status: 'draft' });
  const state = buildContinuationOverviewState([pack]);

  assert.equal(state.kind, 'draft');
  assert.equal(state.primaryPack?.id, 'draft-1');
});

test('overview is empty when there are no packs', () => {
  const state = buildContinuationOverviewState([]);
  assert.equal(state.kind, 'empty');
  assert.equal(state.primaryPack, null);
});
