import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPreferredContinuationPackId, getPreferredContinuationPack } from '../src/lib/continuation-pack-selection';
import type { ContinuationPack } from '../shared/types';

function makePack(overrides: Partial<ContinuationPack>): ContinuationPack {
  return {
    id: 'pack-1',
    novelId: 'novel-1',
    title: 'Test Pack',
    status: 'draft',
    sourceDocuments: [],
    canonFacts: [],
    characterStates: [],
    plotState: { currentTimeline: '', latestScene: '', immediateConflict: '', nextLikelyMove: '', unresolvedHooks: [] },
    styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
    contradictions: [],
    continuationTask: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('getPreferredContinuationPackId', () => {
  it('returns empty string for empty list', () => {
    assert.equal(getPreferredContinuationPackId([]), '');
  });

  it('keeps explicit currentPackId if it exists in list', () => {
    const packs = [
      makePack({ id: 'a', status: 'approved', updatedAt: 200 }),
      makePack({ id: 'b', status: 'draft', updatedAt: 300 }),
    ];
    assert.equal(getPreferredContinuationPackId(packs, 'b'), 'b');
  });

  it('ignores explicit currentPackId if not in list, picks approved', () => {
    const packs = [
      makePack({ id: 'a', status: 'approved', updatedAt: 200 }),
      makePack({ id: 'b', status: 'draft', updatedAt: 300 }),
    ];
    assert.equal(getPreferredContinuationPackId(packs, 'nonexistent'), 'a');
  });

  it('prefers approved over draft even if draft is newer', () => {
    const packs = [
      makePack({ id: 'draft-new', status: 'draft', updatedAt: 500 }),
      makePack({ id: 'approved-old', status: 'approved', updatedAt: 100 }),
    ];
    assert.equal(getPreferredContinuationPackId(packs), 'approved-old');
  });

  it('falls back to draft when no approved exists', () => {
    const packs = [
      makePack({ id: 'd1', status: 'draft', updatedAt: 100 }),
      makePack({ id: 'd2', status: 'draft', updatedAt: 200 }),
    ];
    assert.equal(getPreferredContinuationPackId(packs), 'd2');
  });
});

describe('getPreferredContinuationPack', () => {
  it('returns null for empty list', () => {
    assert.equal(getPreferredContinuationPack([]), null);
  });

  it('returns the pack object matching the selected id', () => {
    const packs = [
      makePack({ id: 'a', status: 'approved', title: 'Approved Pack' }),
    ];
    const result = getPreferredContinuationPack(packs);
    assert.equal(result?.title, 'Approved Pack');
  });
});
