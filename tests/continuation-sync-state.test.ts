import test from 'node:test';
import assert from 'node:assert/strict';

import { computeContinuationPackContentHash, mapContinuationPackRow } from '../server/lib/db-mappers.js';

const baseRow = {
  id: 'p1', novel_id: 'n1', title: 'Pack', status: 'approved',
  source_documents: '[]', canon_facts: '[]', character_states: '[]',
  plot_state: '{}', style_profile: '{}', contradictions: '[]',
  continuation_task: '', source_map: '{}', reading_questions: '[]',
  continuation_gaps: '[]', source_badge: null, created_at: 1, updated_at: 2,
};

test('legacy continuation rows map to not_started sync state', () => {
  const pack = mapContinuationPackRow(baseRow);
  assert.equal(pack.syncState!.status, 'not_started');
  assert.equal(pack.syncState!.pendingRelationshipCount, 0);
});

test('content hash excludes sync state and updatedAt but changes with sync content', () => {
  const first = mapContinuationPackRow({ ...baseRow, sync_state: JSON.stringify({ status: 'synced', contentHash: 'old' }) });
  const second = { ...first, updatedAt: 999, syncState: { ...first.syncState!, status: 'stale' as const, contentHash: 'different' } };
  assert.equal(computeContinuationPackContentHash(first), computeContinuationPackContentHash(second));
  assert.notEqual(computeContinuationPackContentHash(first), computeContinuationPackContentHash({ ...first, continuationTask: 'changed' }));
});
