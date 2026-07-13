import { describe, expect, test, vi } from 'vitest';
import { IncompleteIdeaFragmentStreamError, streamIdeaFragment } from '../lib/idea-fragment-stream';

function sseResponse(payload: string): Response {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload));
      controller.close();
    },
  }));
}

describe('streamIdeaFragment', () => {
  test('previews many tokens but persists exactly once after [DONE]', async () => {
    const previews: string[] = [];
    const commit = vi.fn().mockResolvedValue(undefined);
    const committed = await streamIdeaFragment({
      response: sseResponse('data: {"token":"a"}\n\ndata: {"token":"b"}\n\ndata: [DONE]\n\n'),
      originalExpansion: 'old',
      isCurrent: () => true,
      onPreview: (text) => previews.push(text),
      onCommit: commit,
    });

    expect(committed).toBe(true);
    expect(previews).toEqual(['a', 'ab']);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('ab');
  });

  test('restores the original and never persists incomplete or error streams', async () => {
    for (const payload of [
      'data: {"token":"partial"}\n\n',
      'data: {"token":"partial"}\n\ndata: {"error":"model failed"}\n\n',
    ]) {
      const previews: string[] = [];
      const commit = vi.fn();
      await expect(streamIdeaFragment({
        response: sseResponse(payload),
        originalExpansion: 'original',
        isCurrent: () => true,
        onPreview: (text) => previews.push(text),
        onCommit: commit,
      })).rejects.toBeInstanceOf(payload.includes('model failed') ? Error : IncompleteIdeaFragmentStreamError);
      expect(previews.at(-1)).toBe('original');
      expect(commit).not.toHaveBeenCalled();
    }
  });

  test('a stale request cannot commit over a newer request', async () => {
    const commit = vi.fn();
    await expect(streamIdeaFragment({
      response: sseResponse('data: {"token":"stale"}\n\ndata: [DONE]\n\n'),
      originalExpansion: 'original',
      isCurrent: () => false,
      onPreview: vi.fn(),
      onCommit: commit,
    })).resolves.toBe(false);
    expect(commit).not.toHaveBeenCalled();
  });

  test('Abort restores the original expansion and never commits', async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.error(new DOMException('aborted', 'AbortError'));
      },
    }));
    const preview = vi.fn();
    const commit = vi.fn();
    await expect(streamIdeaFragment({
      response,
      originalExpansion: 'original',
      isCurrent: () => true,
      onPreview: preview,
      onCommit: commit,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(preview).toHaveBeenLastCalledWith('original');
    expect(commit).not.toHaveBeenCalled();
  });
});
