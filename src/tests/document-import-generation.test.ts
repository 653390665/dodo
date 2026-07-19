import { afterEach, describe, expect, test, vi } from 'vitest';

import { parseDocAsync } from '../lib/prompt-client';

describe('world document import generation contract', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('polls and returns the database generation issued with the parse job', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          novelId: 'novel-1',
          filename: '设定.txt',
          filedata: 'YQ==',
        });
        return new Response(JSON.stringify({
          jobId: 'parse-doc-1',
          databaseGeneration: 7,
        }), { status: 202, headers: { 'content-type': 'application/json' } });
      })
      .mockImplementationOnce(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe('/api/parse-doc/jobs/parse-doc-1?databaseGeneration=7');
        return new Response(JSON.stringify({
          status: 'completed',
          progress: 100,
          result: { globalOutline: '解析结果' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      });
    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = parseDocAsync({ novelId: 'novel-1', filename: '设定.txt', filedata: 'YQ==' });
    await vi.advanceTimersByTimeAsync(1500);

    await expect(resultPromise).resolves.toEqual({
      globalOutline: '解析结果',
      databaseGeneration: 7,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
