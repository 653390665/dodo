import { describe, expect, test } from 'vitest';
import { buildContinuationContextBundle, finalizeContextReceipt } from '../../shared/lib/continuation-pack';
import type { ContinuationPack } from '../../shared/types';
import { classifyCriticFeedback } from '../../server/helpers/ai-production-pipeline';

const pack = { id: 'pack-1', novelId: 'novel-1', title: '资料', status: 'approved', sourceDocuments: [{ id: 'doc-1', packId: 'pack-1', filename: '设定.txt', kind: 'world', text: '世界规则', excerpt: '世界规则', createdAt: 1 }], canonFacts: [], characterStates: [], plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' }, styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' }, contradictions: [], continuationTask: '继续', createdAt: 1, updatedAt: 99 } as ContinuationPack;

describe('P0 AI trust contracts', () => {
  test('context bundle records SHA-256, source counts and truncation', () => {
    const bundle = buildContinuationContextBundle(pack, 12);
    expect(bundle.text.length).toBe(12);
    expect(bundle.receipt.actual).toBe(true);
    expect(bundle.receipt.packUpdatedAt).toBe(99);
    expect(bundle.receipt.sourceIds).toEqual([]);
    expect(bundle.receipt.truncated).toBe(true);
    expect(bundle.receipt.runtimeSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test('critic preserves UNKNOWN and requires structured JSON', () => {
    expect(classifyCriticFeedback('模型不可用', false)).toEqual({ status: 'unknown' });
    expect(classifyCriticFeedback('PASS')).toEqual({ status: 'unknown' });
    expect(classifyCriticFeedback('评分: 55')).toEqual({ status: 'unknown' });
  });

  test('context receipt hashes the actual runtime fragments and records source metadata', () => {
    const bundle = buildContinuationContextBundle(pack, {
      maxChars: 10_000,
      runtimeSources: [
        { id: 'planner', label: 'story ledger/planner', text: '规划上下文', itemCount: 2, version: 'v2' },
      ],
    });
    const changed = buildContinuationContextBundle(pack, {
      maxChars: 10_000,
      runtimeSources: [
        { id: 'planner', label: 'story ledger/planner', text: '另一份规划上下文', itemCount: 2, version: 'v2' },
      ],
    });
    expect(bundle.text).not.toBe(buildContinuationContextBundle(pack, 10_000).text);
    expect(bundle.text).toContain('规划上下文');
    expect(bundle.receipt.sources?.some((source) => source.id === 'planner' && source.sha256)).toBe(true);
    expect(bundle.receipt.runtimeSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(bundle.receipt.runtimeSha256).not.toBe(changed.receipt.runtimeSha256);
    const finalized = finalizeContextReceipt(bundle.receipt, `${bundle.text}\n\nintent-a\n\nskill-a\n\npref-a`, []);
    const changedFinalized = finalizeContextReceipt(bundle.receipt, `${bundle.text}\n\nintent-b\n\nskill-a\n\npref-a`, []);
    expect(finalized?.runtimeSha256).not.toBe(changedFinalized?.runtimeSha256);
  });
});
