import { afterEach, describe, expect, test, vi } from 'vitest';

import { CapabilityRequestError, executeCapability } from '../lib/capability-client';

afterEach(() => vi.restoreAllMocks());

describe('capability client', () => {
  test('executes a governed utility by ids and database generation only', async () => {
    const response = {
      kind: 'diagnostic', capabilityId: 'platform-tomato-scoring', baselineHash: 'hash-1', readOnly: true,
      report: { issueCount: 0, issues: [] },
      contextReceipt: { actual: true, sourceIds: ['chapter-1'], runtimeSha256: 'runtime', injectedChars: 10, itemCount: 1, truncated: false },
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(response));

    await expect(executeCapability('novel-1', 'platform-tomato-scoring', {
      chapterId: 'chapter-1', databaseGeneration: 7, stage: 'critic',
    })).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledWith('/api/novels/novel-1/capabilities/platform-tomato-scoring/execute', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ chapterId: 'chapter-1', databaseGeneration: 7, stage: 'critic' }),
    }));
  });

  test('preserves a stable server error code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ code: 'UTILITY_GENERATION_STALE', error: 'changed' }, { status: 409 }));
    await expect(executeCapability('n', 'u', { chapterId: 'c', databaseGeneration: 1 }))
      .rejects.toMatchObject({ code: 'UTILITY_GENERATION_STALE', status: 409 } satisfies Partial<CapabilityRequestError>);
  });
});
