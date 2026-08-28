import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { finalizeContextReceipt } from '../shared/lib/continuation-pack.ts';

test('finalize receipt hashes actual text and drops absent runtime sources', () => {
  const receipt = finalizeContextReceipt({
    actual: true, sourceIds: [], runtimeSha256: '', injectedChars: 0, itemCount: 0, truncated: false,
    sources: [{ id: 'old', label: 'old', chars: 10, itemCount: 1, truncated: false }],
  }, 'actual fragment', [
    { id: 'present', label: 'present', text: 'actual fragment', itemCount: 1 },
    { id: 'empty', label: 'empty', text: '', itemCount: 1 },
  ]);
  assert.equal(receipt?.runtimeSha256, createHash('sha256').update('actual fragment').digest('hex'));
  assert.deepEqual(receipt?.sources?.map((source) => source.id), ['present']);
  assert.equal(receipt?.injectedChars, 'actual fragment'.length);
});
