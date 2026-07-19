import { describe, expect, test, vi } from 'vitest';
import {
  enqueueLatestCharacterBioCommit,
  IncompleteBioStreamError,
  streamCharacterBio,
} from '../lib/character-bio-stream';
import { SseParseError } from '../lib/sse-client';

function sseResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event));
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function controlledSseResponse() {
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

  return {
    response,
    send(payload: string) {
      streamController?.enqueue(encoder.encode(payload));
    },
    close() {
      streamController?.close();
    },
    error(error: Error) {
      streamController?.error(error);
    },
  };
}

describe('character bio streaming persistence', () => {
  test('multiple tokens update the database exactly once after [DONE]', async () => {
    const previews: string[] = [];
    const commit = vi.fn(async () => {});

    await expect(streamCharacterBio({
      response: sseResponse([
        'data: {"token":"甲"}\n\n',
        'data: {"token":"乙"}\n\n',
        'data: {"token":"丙"}\n\n',
        'data: [DONE]\n\n',
      ]),
      originalBio: '原小传',
      isCurrent: () => true,
      onPreview: bio => previews.push(bio),
      onCommit: commit,
    })).resolves.toBe(true);

    expect(previews).toEqual(['甲乙丙']);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('甲乙丙');
  });

  test('a slower stale request cannot preview or commit over the newer result', async () => {
    const oldStream = controlledSseResponse();
    const newStream = controlledSseResponse();
    const commits: string[] = [];
    let visibleBio = '原小传';
    let currentRequest = 1;

    const oldPending = streamCharacterBio({
      response: oldStream.response,
      originalBio: visibleBio,
      isCurrent: () => currentRequest === 1,
      onPreview: bio => { visibleBio = bio; },
      onCommit: async bio => { commits.push(bio); },
    });

    currentRequest = 2;
    const newPending = streamCharacterBio({
      response: newStream.response,
      originalBio: visibleBio,
      isCurrent: () => currentRequest === 2,
      onPreview: bio => { visibleBio = bio; },
      onCommit: async bio => { commits.push(bio); },
    });

    newStream.send('data: {"token":"最终文本"}\n\ndata: [DONE]\n\n');
    newStream.close();
    await expect(newPending).resolves.toBe(true);

    oldStream.send('data: {"token":"过期文本"}\n\ndata: [DONE]\n\n');
    oldStream.close();
    await expect(oldPending).resolves.toBe(false);

    expect(visibleBio).toBe('最终文本');
    expect(commits).toEqual(['最终文本']);
  });

  test('a newer commit waits for an in-flight old commit and persists last', async () => {
    const commitChains = new Map<string, Promise<void>>();
    const persistedValues: string[] = [];
    let currentRequest = 1;
    let oldCommitStarted = false;
    let releaseOldCommit: (() => void) | undefined;
    const oldCommitGate = new Promise<void>(resolve => {
      releaseOldCommit = resolve;
    });

    const oldCommit = enqueueLatestCharacterBioCommit(
      commitChains,
      'character-1',
      () => currentRequest === 1,
      async () => {
        oldCommitStarted = true;
        await oldCommitGate;
        persistedValues.push('旧文本');
      },
    );
    await vi.waitFor(() => expect(oldCommitStarted).toBe(true));

    currentRequest = 2;
    const newCommit = enqueueLatestCharacterBioCommit(
      commitChains,
      'character-1',
      () => currentRequest === 2,
      async () => {
        persistedValues.push('新文本');
      },
    );

    await Promise.resolve();
    expect(persistedValues).toEqual([]);
    releaseOldCommit?.();
    await Promise.all([oldCommit, newCommit]);

    expect(persistedValues).toEqual(['旧文本', '新文本']);
    expect(persistedValues.at(-1)).toBe('新文本');
    expect(commitChains.size).toBe(0);
  });

  test.each([
    {
      name: 'missing [DONE]',
      response: () => sseResponse(['data: {"token":"部分文本"}\n\n']),
      errorType: IncompleteBioStreamError,
    },
    {
      name: 'invalid JSON',
      response: () => sseResponse(['data: {bad json}\n\n']),
      errorType: SseParseError,
    },
    {
      name: 'server error event',
      response: () => sseResponse(['data: {"error":"upstream failed"}\n\n']),
      errorType: Error,
    },
  ])('$name restores the original bio without persisting partial output', async ({ response, errorType }) => {
    const previews: string[] = [];
    const commit = vi.fn(async () => {});

    await expect(streamCharacterBio({
      response: response(),
      originalBio: '原小传',
      isCurrent: () => true,
      onPreview: bio => previews.push(bio),
      onCommit: commit,
    })).rejects.toBeInstanceOf(errorType);

    expect(previews.at(-1)).toBe('原小传');
    expect(commit).not.toHaveBeenCalled();
  });

  test('an aborted stream restores the original bio and never commits', async () => {
    const stream = controlledSseResponse();
    const previews: string[] = [];
    const commit = vi.fn(async () => {});
    const pending = streamCharacterBio({
      response: stream.response,
      originalBio: '原小传',
      isCurrent: () => true,
      onPreview: bio => previews.push(bio),
      onCommit: commit,
      previewIntervalMs: 50,
    });

    stream.send('data: {"token":"部分文本"}\n\n');
    stream.error(new DOMException('Aborted', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(previews.at(-1)).toBe('原小传');
    expect(commit).not.toHaveBeenCalled();
  });
});
