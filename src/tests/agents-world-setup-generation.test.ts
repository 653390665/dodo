import { afterEach, describe, expect, it, vi } from 'vitest';

import { editorAgentPhase, extractWorldSetupPhase, type AgentContext } from '../lib/agents';

describe('world setup extraction database generation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('polls and returns the generation captured when the job started', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ jobId: 'setup-1', databaseGeneration: 23 }))
      .mockResolvedValueOnce(Response.json({
        status: 'completed',
        progress: 100,
        result: { characters: [{ name: '阿遥' }] },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(extractWorldSetupPhase('人物设定', 'novel-1')).resolves.toEqual({
      result: { characters: [{ name: '阿遥' }] },
      databaseGeneration: 23,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/extract-world-setup/jobs/setup-1?databaseGeneration=23',
      { signal: undefined },
    );
  });

  it('cancels the same generation when the caller aborts', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/extract-world-setup') {
        return Promise.resolve(Response.json({ jobId: 'setup-2', databaseGeneration: 24 }));
      }
      if (url.includes('/cancel?databaseGeneration=24')) {
        return Promise.resolve(Response.json({ cancelled: true }));
      }
      controller.abort(new DOMException('Aborted', 'AbortError'));
      return Promise.reject(controller.signal.reason);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(extractWorldSetupPhase('人物设定', 'novel-1', undefined, controller.signal)).rejects.toThrow();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/extract-world-setup/jobs/setup-2/cancel?databaseGeneration=24',
      { method: 'POST' },
    );
  });
});

describe('editor agent database generation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('binds start, polling and result to the requested generation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ jobId: 'editor-1', databaseGeneration: 31 }))
      .mockResolvedValueOnce(Response.json({
        status: 'completed',
        progress: 100,
        result: { text: '- 安全分镜' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const context: AgentContext = {
      novel: { id: 'novel-1', title: 'Novel', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 },
      characters: [],
    };

    await expect(editorAgentPhase('生成分镜', context, 31)).resolves.toEqual({
      text: '- 安全分镜',
      databaseGeneration: 31,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/agents/jobs/editor-1?databaseGeneration=31',
      { signal: undefined },
    );
  });

  it('cancels editor-agent work when polling exits without a completed result', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ jobId: 'editor-2', databaseGeneration: 32 }))
      .mockResolvedValueOnce(Response.json({ error: 'poll failed' }, { status: 502 }))
      .mockResolvedValueOnce(Response.json({ cancelled: true }));
    vi.stubGlobal('fetch', fetchMock);
    const context: AgentContext = {
      novel: { id: 'novel-1', title: 'Novel', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 },
      characters: [],
    };

    await expect(editorAgentPhase('生成分镜', context, 32)).rejects.toThrow('HTTP 502');
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents/jobs/editor-2/cancel?databaseGeneration=32',
      { method: 'POST' },
    );
  });
});
