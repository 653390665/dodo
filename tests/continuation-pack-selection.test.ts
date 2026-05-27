import test from 'node:test';
import assert from 'node:assert/strict';

import { getPreferredContinuationPackId } from '../src/lib/continuation-pack-selection';
import type { ContinuationPack } from '../src/types';

function buildPack(id: string, updatedAt: number): ContinuationPack {
  return {
    id,
    novelId: 'novel-1',
    title: id,
    status: 'approved',
    sourceDocuments: [],
    canonFacts: [],
    characterStates: [],
    plotState: {
      currentTimeline: '第一卷',
      latestScene: '城门夜雨',
      unresolvedHooks: [],
      immediateConflict: '追兵逼近',
      nextLikelyMove: '潜入内城',
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
    continuationTask: '继续推进剧情',
    createdAt: updatedAt - 1_000,
    updatedAt,
  };
}

test('getPreferredContinuationPackId keeps current selection when it is still available', () => {
  const packs = [buildPack('pack-old', 100), buildPack('pack-new', 200)];

  assert.equal(getPreferredContinuationPackId(packs, 'pack-old'), 'pack-old');
});

test('getPreferredContinuationPackId falls back to the most recently updated approved pack', () => {
  const packs = [buildPack('pack-old', 100), buildPack('pack-new', 200), buildPack('pack-mid', 150)];

  assert.equal(getPreferredContinuationPackId(packs, 'missing-pack'), 'pack-new');
  assert.equal(getPreferredContinuationPackId(packs), 'pack-new');
});
