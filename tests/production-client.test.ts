import test from 'node:test';
import assert from 'node:assert/strict';

import { applyChapterProductionRun, startChapterProductionRunStream } from '../src/lib/production-client';
import type { ChapterProductionRun } from '../shared/types';

function makeProductionRun(
  id: string,
  novelId: string,
  status: ChapterProductionRun['status'],
): ChapterProductionRun {
  return {
    id,
    novelId,
    status,
    userIntent: '继续写',
    sceneBeats: '场景节拍',
    draftContent: '正文',
    styleAudit: '审计结果',
    continuityReport: {
      score: 100,
      issues: [],
      proposedPatch: {
        characterUpdates: [],
        itemUpdates: [],
        foreshadowingUpdates: [],
        timelineEventsToCreate: [],
        foreshadowingsToCreate: [],
      },
    },
    createdAt: 1,
    updatedAt: 2,
  };
}

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
  const doneRun = makeProductionRun('run-1', 'novel-1', 'review_required');

  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: typeof init?.body === 'string' ? init.body : null,
    });
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"status","message":"正在生成"}\n\n'));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', run: doneRun })}\n\n`));
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
      run: doneRun,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('startChapterProductionRunStream stitches split chunks and parses trailing buffer', async () => {
  const originalFetch = globalThis.fetch;
  const events: Array<{ type: string; [key: string]: unknown }> = [];
  const doneRun = makeProductionRun('run-2', 'novel-2', 'applied');

  globalThis.fetch = async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"status",'));
        controller.enqueue(encoder.encode('"message":"第一阶段"}\n\n'));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', run: doneRun })}`));
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
      { type: 'done', run: doneRun },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('startChapterProductionRunStream rejects invalid json immediately', async () => {
  const originalFetch = globalThis.fetch;
  const events: Array<{ type: string; [key: string]: unknown }> = [];

  globalThis.fetch = async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: ping\n\n'));
        controller.enqueue(encoder.encode('data: not-json\n\n'));
        controller.close();
      },
    });

    return {
      ok: true,
      body,
    } as Response;
  };

  try {
    await assert.rejects(
      () => startChapterProductionRunStream(
        {
          novelId: 'novel-3',
          userIntent: '继续写第三章',
        },
        (event) => events.push(event),
      ),
      /Invalid SSE payload/,
    );
    assert.deepEqual(events, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('startChapterProductionRunStream rejects EOF without done', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const encoder = new TextEncoder();
    return {
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"fallback_draft_token","content":"半段正文"}\n\n'));
          controller.close();
        },
      }),
    } as Response;
  };
  try {
    await assert.rejects(
      () => startChapterProductionRunStream(
        { novelId: 'novel-5', userIntent: '继续写' },
        () => undefined,
      ),
      /完成事件前中断/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('startChapterProductionRunStream rejects raw DONE without a typed run', async () => {
  const originalFetch = globalThis.fetch;
  const events: Array<{ type: string; [key: string]: unknown }> = [];
  globalThis.fetch = async () => {
    const encoder = new TextEncoder();
    return {
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"fallback_draft_token","content":"预览正文"}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      }),
    } as Response;
  };

  try {
    await assert.rejects(
      () => startChapterProductionRunStream(
        { novelId: 'novel-7', userIntent: '继续写' },
        (event) => events.push(event),
      ),
      /完成事件前中断/,
    );
    assert.deepEqual(events, [{ type: 'fallback_draft_token', content: '预览正文' }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const [label, invalidRun] of [
  ['an empty run object', {}],
  ['an array run', []],
  ['a non-string run status', { ...makeProductionRun('run-invalid', 'novel-invalid', 'running'), status: ['running'] }],
] as const) {
  test(`startChapterProductionRunStream rejects ${label}`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      const encoder = new TextEncoder();
      return {
        ok: true,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', run: invalidRun })}\n\n`));
            controller.close();
          },
        }),
      } as Response;
    };

    try {
      await assert.rejects(
        () => startChapterProductionRunStream(
          { novelId: 'novel-invalid-run', userIntent: '继续写' },
          () => undefined,
        ),
        /invalid run/i,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test('startChapterProductionRunStream rejects a business error event', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const encoder = new TextEncoder();
    return {
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"error","message":"writer failed"}\n\n'));
          controller.close();
        },
      }),
    } as Response;
  };
  try {
    await assert.rejects(
      () => startChapterProductionRunStream(
        { novelId: 'novel-6', userIntent: '继续写' },
        () => undefined,
      ),
      /writer failed/,
    );
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
