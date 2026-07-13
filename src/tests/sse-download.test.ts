import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { readSseStream, SseParseError } from '../lib/sse-client';

describe('readSseStream', () => {
  test('throws on invalid JSON payloads', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {not-json}\n\n'));
        controller.close();
      },
    });
    const response = new Response(body);

    await expect(readSseStream(response, () => {})).rejects.toBeInstanceOf(SseParseError);
  });

  test('returns done=false when [DONE] is missing', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"token":"hello"}\n\n'));
        controller.close();
      },
    });
    const response = new Response(body);
    const result = await readSseStream(response, () => {});
    expect(result.done).toBe(false);
    expect(result.text).toBe('hello');
  });

  test('accumulates tokens until [DONE]', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"token":"a"}\n\ndata: {"token":"b"}\n\ndata: [DONE]\n\n'));
        controller.close();
      },
    });
    const response = new Response(body);
    const tokens: string[] = [];
    const result = await readSseStream(response, (token) => tokens.push(token));
    expect(result.done).toBe(true);
    expect(result.text).toBe('ab');
    expect(tokens).toEqual(['a', 'b']);
  });
});

describe('downloadAuthenticatedFile', () => {
  const originalFetch = globalThis.fetch;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:mock');
    revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('sends Authorization bearer and revokes blob URL', async () => {
    const { downloadAuthenticatedFile } = await import('../lib/download-client');
    globalThis.fetch = vi.fn(async (_url, init) => {
      expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer test-token');
      return new Response('db-bytes', {
        status: 200,
        headers: { 'Content-Disposition': 'attachment; filename="backup.db"' },
      });
    }) as typeof fetch;

    const click = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValue({ click } as never);

    await downloadAuthenticatedFile('/api/db/export-file', {
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    expect(click).toHaveBeenCalled();
  });

  test('throws on non-2xx responses', async () => {
    const { downloadAuthenticatedFile } = await import('../lib/download-client');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })) as typeof fetch;

    await expect(downloadAuthenticatedFile('/api/db/export-file')).rejects.toThrow('Unauthorized');
  });
});
