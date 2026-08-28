import { afterEach, describe, expect, test, vi } from 'vitest';
import { embedStructuredAudit, extractStructuredAudit, type StructuredAudit } from '../../shared/lib/audit-structured';

afterEach(() => vi.unstubAllGlobals());

describe('structured audit browser codec', () => {
  test('roundtrips unicode audit data without Node Buffer', () => {
    vi.stubGlobal('Buffer', undefined);
    const audit: StructuredAudit = {
      score: 78,
      fatalIssues: [{
        issueType: 'action-chain', issueSubtype: 'weak-action-chain', severity: 'major',
        snippet: '林舟走进废墟', explanation: '动作承接不足', patchHint: '补充动作因果',
      }],
      sceneChecks: [],
      surgerySuggestions: ['先确认灯火来源'],
    };

    expect(extractStructuredAudit(embedStructuredAudit('审稿诊断', audit))).toEqual({ ...audit, evidence: [] });
  });
});
