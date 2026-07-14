import { describe, expect, test } from 'vitest';
import { IncompleteDraftStreamError, readDraftStream } from '../lib/draft-stream';
import { SseParseError } from '../lib/sse-client';

function sseResponse(payload: string): Response {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload));
      controller.close();
    },
  }));
}

describe('readDraftStream strict completion', () => {
  test('commits only the authoritative text from a typed done event', async () => {
    const tokens: string[] = [];
    const result = await readDraftStream(sseResponse([
      'data: {"type":"status","message":"writing"}',
      'data: {"type":"token","content":"part"}',
      'data: {"type":"done","text":"final text"}',
      '',
    ].join('\n\n')), { onToken: (token) => tokens.push(token) });

    expect(result).toBe('final text');
    expect(tokens).toEqual(['part']);
  });

  test('rejects a business error even after partial tokens', async () => {
    await expect(readDraftStream(sseResponse([
      'data: {"type":"token","content":"partial"}',
      'data: {"type":"error","message":"writer failed"}',
      '',
    ].join('\n\n')))).rejects.toThrow('writer failed');
  });

  test('rejects EOF without done and malformed JSON', async () => {
    await expect(readDraftStream(sseResponse('data: {"type":"token","content":"partial"}\n\n')))
      .rejects.toBeInstanceOf(IncompleteDraftStreamError);
    await expect(readDraftStream(sseResponse('data: {not-json}\n\n')))
      .rejects.toBeInstanceOf(SseParseError);
    await expect(readDraftStream(sseResponse('data: null\n\n')))
      .rejects.toBeInstanceOf(SseParseError);
  });

  test('raw [DONE] cannot impersonate the required typed done event', async () => {
    await expect(readDraftStream(sseResponse([
      'data: {"type":"token","content":"partial"}',
      'data: [DONE]',
      '',
    ].join('\n\n')))).rejects.toBeInstanceOf(IncompleteDraftStreamError);
  });
});
