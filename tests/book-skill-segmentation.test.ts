import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBookEvidenceSegments } from '../src/lib/book-skill-segmentation';

test('buildBookEvidenceSegments creates ordered whole-book slices for opening, middle, and climax evidence', () => {
  const text = Array.from({ length: 1200 }, (_, index) => `第${index}句内容`).join('\n');
  const segments = buildBookEvidenceSegments(text);

  assert.equal(segments.length >= 4, true);
  assert.equal(segments[0].stage, 'opening');
  assert.equal(segments.some((segment) => segment.stage === 'mid'), true);
  assert.equal(segments.some((segment) => segment.stage === 'climax'), true);
});
