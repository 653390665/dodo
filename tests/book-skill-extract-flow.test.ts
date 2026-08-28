import assert from 'node:assert/strict';
import test from 'node:test';

import { collectSegmentEvidence } from '../src/lib/book-skill-evidence';

test('collectSegmentEvidence merges signals from all extracted skills in one segment', () => {
  const segment = collectSegmentEvidence(
    [
      {
        style: '冷峻短句',
        compositionProfile: { styleWeight: 0.9 },
      },
      {
        characterTraits: '人物试探感强',
        plotPattern: '冲突升级明显',
        compositionProfile: { characterWeight: 0.76, plotWeight: 0.82 },
      },
    ],
    'mid',
  );

  assert.ok(segment);
  assert.equal(segment?.skillSignals.some((signal) => signal.dimension === 'style'), true);
  assert.equal(segment?.skillSignals.some((signal) => signal.dimension === 'character'), true);
  assert.equal(segment?.skillSignals.some((signal) => signal.dimension === 'plot'), true);
});
