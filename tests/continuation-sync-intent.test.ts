import assert from 'node:assert/strict';
import test from 'node:test';
import { readContinuationSyncIntent, writeContinuationSyncIntent, clearContinuationSyncIntent } from '../src/lib/continuation-sync-intent.ts';

test('sync intent is generated, retained for the target novel, and expires', () => {
  const values = new Map<string, string>();
  Object.assign(globalThis, { localStorage: { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
  clearContinuationSyncIntent();
  writeContinuationSyncIntent({ intentId: '', createdAt: 0, novelId: 'novel-a', packId: 'pack-a' });
  const intent = readContinuationSyncIntent();
  assert.equal(intent?.novelId, 'novel-a');
  assert.ok(intent?.intentId);
  localStorage.setItem('inkflow-world-bible-sync-intent', JSON.stringify({ ...intent, createdAt: Date.now() - 31 * 60 * 1000 }));
  assert.equal(readContinuationSyncIntent(), null);
});
