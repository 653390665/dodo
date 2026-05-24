import test from 'node:test';
import assert from 'node:assert/strict';

import { listNovels, subscribeToChanges, updateNovel } from '../src/lib/db-client';

class MockEventSource {
  static OPEN = 1;
  static CLOSED = 2;
  static instances: MockEventSource[] = [];

  readyState = MockEventSource.OPEN;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
    this.readyState = MockEventSource.CLOSED;
  }
}

test('listNovels posts to /api/db and unwraps result', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(input, '/api/db');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      method: 'listNovels',
      args: [],
    });

    return {
      ok: true,
      json: async () => ({
        result: [{ id: 'novel-1', title: '测试作品' }],
      }),
    } as Response;
  };

  try {
    const novels = await listNovels();
    assert.deepEqual(novels, [{ id: 'novel-1', title: '测试作品' }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('updateNovel surfaces db api error message', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    ({
      ok: false,
      json: async () => ({
        error: 'DB write failed',
      }),
    } as Response);

  try {
    await assert.rejects(
      () => updateNovel('novel-1', { summary: '新的简介' }),
      /DB write failed/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('subscribeToChanges shares one EventSource and closes it after last unsubscribe', () => {
  const OriginalEventSource = globalThis.EventSource;
  MockEventSource.instances = [];
  // @ts-expect-error test double
  globalThis.EventSource = MockEventSource;

  let firstCount = 0;
  let secondCount = 0;

  try {
    const unsubscribeFirst = subscribeToChanges(() => {
      firstCount += 1;
    });
    const unsubscribeSecond = subscribeToChanges(() => {
      secondCount += 1;
    });

    assert.equal(MockEventSource.instances.length, 1);
    const instance = MockEventSource.instances[0];
    assert.equal(instance.url, '/api/db/events');

    instance.onmessage?.({} as MessageEvent);
    assert.equal(firstCount, 1);
    assert.equal(secondCount, 1);

    unsubscribeFirst();
    assert.equal(instance.closed, false);

    unsubscribeSecond();
    assert.equal(instance.closed, true);
  } finally {
    globalThis.EventSource = OriginalEventSource;
  }
});
