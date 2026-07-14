import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateInspiration } from '../lib/prompt-client';

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { status, headers: { 'content-type': 'text/event-stream' } });
}

function mockWelcomeFetch(response: Response) {
  return vi.fn().mockImplementation((url: string) => {
    if (url === '/api/onboarding/llm-session') {
      return Promise.resolve(Response.json({ sessionId: 'onboarding-test' }, { status: 201 }));
    }
    return Promise.resolve(response);
  });
}

describe('generateInspiration SSE protocol', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns accumulated tokens only after a formal DONE event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      'data: {"token":"第一段"}\n\n',
      'data: {"token":"第二段"}\n\n',
      'data: [DONE]\n\n',
    ])));

    await expect(generateInspiration('prompt', 'workspace-draft', 'novel-1'))
      .resolves.toBe('第一段第二段');
  });

  it('rejects EOF without DONE and malformed or business-error events', async () => {
    for (const chunks of [
      ['data: {"token":"partial"}\n\n'],
      ['data: {bad json}\n\n'],
      ['data: {"error":"provider failed"}\n\n'],
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(chunks)));
      await expect(generateInspiration('prompt', 'workspace-draft', 'novel-1')).rejects.toThrow();
    }
  });

  it('uses a server-issued onboarding session for welcome inspiration', async () => {
    const fetchMock = mockWelcomeFetch(sseResponse([
      'data: {"token":"welcome"}\n\ndata: [DONE]\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateInspiration('prompt', 'welcome')).resolves.toBe('welcome');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/onboarding/llm-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'inspiration' }),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      onboardingSessionId: 'onboarding-test',
      surface: 'welcome',
    });
  });
});
