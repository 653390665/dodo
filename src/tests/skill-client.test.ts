import { afterEach, describe, expect, it, vi } from 'vitest';

import { listSkillUsageRecords } from '../lib/skill-client';

describe('skill client usage records request contract', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('omits the optional skill id when it is not provided', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ result: [] }), { status: 200 }),
    );

    await listSkillUsageRecords();

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      method: 'listSkillUsageRecords',
      args: [],
    });
  });

  it('sends the skill id when it is provided', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ result: [] }), { status: 200 }),
    );

    await listSkillUsageRecords('skill-v2');

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      method: 'listSkillUsageRecords',
      args: ['skill-v2'],
    });
  });
});
