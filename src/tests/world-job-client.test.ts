import { afterEach, describe, expect, it, vi } from 'vitest';

import { startWorldJob } from '../lib/world-job-client';

describe('world job client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('polls the returned job instead of treating the start envelope as model output', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ databaseGeneration: 7 }))
      .mockResolvedValueOnce(Response.json({ jobId: 'job-1', databaseGeneration: 7 }))
      .mockResolvedValueOnce(Response.json({ status: 'completed', progress: 100, result: { outline: '完整大纲' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(startWorldJob<{ outline: string }>('/api/generate-outline', {}, { intervalMs: 0 }))
      .resolves.toEqual({ result: { outline: '完整大纲' }, databaseGeneration: 7 });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/generate-outline', expect.objectContaining({
      body: JSON.stringify({ databaseGeneration: 7 }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/world/jobs/job-1?databaseGeneration=7', { signal: undefined });
  });

  it('calls the server cancellation endpoint when the caller aborts', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/db/generation') return Promise.resolve(Response.json({ databaseGeneration: 8 }));
      if (url === '/api/generate-outline') return Promise.resolve(Response.json({ jobId: 'job-2', databaseGeneration: 8 }));
      if (url === '/api/world/jobs/job-2/cancel?databaseGeneration=8') return Promise.resolve(Response.json({ cancelled: true }));
      controller.abort(new DOMException('Aborted', 'AbortError'));
      return Promise.reject(controller.signal.reason);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(startWorldJob('/api/generate-outline', {}, {}, controller.signal)).rejects.toThrow();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledWith('/api/world/jobs/job-2/cancel?databaseGeneration=8', { method: 'POST' });
  });

  it('cancels the provider job when polling fails before completion', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ databaseGeneration: 9 }))
      .mockResolvedValueOnce(Response.json({ jobId: 'job-3', databaseGeneration: 9 }))
      .mockResolvedValueOnce(Response.json({ error: 'network proxy failed' }, { status: 502 }))
      .mockResolvedValueOnce(Response.json({ cancelled: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(startWorldJob('/api/generate-outline', {}, { intervalMs: 0 })).rejects.toThrow('HTTP 502');
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/world/jobs/job-3/cancel?databaseGeneration=9',
      { method: 'POST' },
    );
  });
});
