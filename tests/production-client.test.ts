import test from 'node:test';
import assert from 'node:assert/strict';

import { applyChapterProductionRun, startChapterProductionRunStream } from '../src/lib/production-client';

test('applyChapterProductionRun returns chapter id from apply endpoint', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(input, '/api/chapter-production-runs/run-42/apply');
    return {
      ok: true,
      json: async () => ({ chapterId: 'chapter-9' }),
    } as Response;
  };

  try {
    const result = await applyChapterProductionRun('run-42');
    assert.deepEqual(result, { chapterId: 'chapter-9' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('startChapterProductionRunStream parses streamed SSE events', async () => {
  const originalFetch = globalThis.fetch;
  const events: Array<{ type: string; [key: string]: unknown }> = [];
  const requests: Array<{ url: string; body: string | null }> = [];

  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: typeof init?.body === 'string' ? init.body : null,
    });
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"status","message":"正在生成"}\n\n'));
        controller.enqueue(encoder.encode('data: {"type":"done","run":{"id":"run-1","status":"review_required"}}\n\n'));
        controller.close();
      },
    });

    return {
      ok: true,
      body,
    } as Response;
  };

  try {
    await startChapterProductionRunStream(
      {
        novelId: 'novel-1',
        userIntent: '继续写下一章',
        continuationPackId: 'pack-9',
      },
      (event) => events.push(event),
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/chapter-production-runs/start-stream');
    assert.deepEqual(JSON.parse(requests[0].body || '{}'), {
      novelId: 'novel-1',
      userIntent: '继续写下一章',
      continuationPackId: 'pack-9',
    });
    assert.equal(events.length, 2);
    assert.deepEqual(events[0], { type: 'status', message: '正在生成' });
    assert.deepEqual(events[1], {
      type: 'done',
      run: { id: 'run-1', status: 'review_required' },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('startChapterProductionRunStream stitches split chunks and parses trailing buffer', async () => {
  const originalFetch = globalThis.fetch;
  const events: Array<{ type: string; [key: string]: unknown }> = [];

  globalThis.fetch = async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"status",'));
        controller.enqueue(encoder.encode('"message":"第一阶段"}\n\n'));
        controller.enqueue(encoder.encode('data: {"type":"done","run":{"id":"run-2","status":"applied"}}'));
        controller.close();
      },
    });

    return {
      ok: true,
      body,
    } as Response;
  };

  try {
    await startChapterProductionRunStream(
      {
        novelId: 'novel-2',
        userIntent: '继续写第二章',
      },
      (event) => events.push(event),
    );

    assert.deepEqual(events, [
      { type: 'status', message: '第一阶段' },
      { type: 'done', run: { id: 'run-2', status: 'applied' } },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('startChapterProductionRunStream ignores non-data and invalid json chunks', async () => {
  const originalFetch = globalThis.fetch;
  const events: Array<{ type: string; [key: string]: unknown }> = [];

  globalThis.fetch = async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: ping\n\n'));
        controller.enqueue(encoder.encode('data: not-json\n\n'));
        controller.enqueue(encoder.encode('data: {"foo":"bar"}\n\n'));
        controller.enqueue(encoder.encode('data: {"type":"status","message":"仍在继续"}\n\n'));
        controller.close();
      },
    });

    return {
      ok: true,
      body,
    } as Response;
  };

  try {
    await startChapterProductionRunStream(
      {
        novelId: 'novel-3',
        userIntent: '继续写第三章',
      },
      (event) => events.push(event),
    );

    assert.deepEqual(events, [
      { type: 'status', message: '仍在继续' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('startChapterProductionRunStream surfaces server error payload', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'stream temporarily unavailable' }),
    } as Response);

  try {
    await assert.rejects(
      () =>
        startChapterProductionRunStream(
          {
            novelId: 'novel-4',
            userIntent: '继续写第四章',
          },
          () => undefined,
        ),
      /stream temporarily unavailable/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
