import test from 'node:test';
import assert from 'node:assert/strict';

import { listNovels, subscribeToChanges, updateNovel } from '../src/lib/db-client';
import { DbTransportError, __dbTransportTestHooks } from '../src/lib/db-transport';

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

test('db transport preserves HTTP status and stable error code', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    ({
      ok: false,
      status: 409,
      json: async () => ({ code: 'DB_GENERATION_CONFLICT', message: '数据库已变化，请刷新后重试' }),
    } as Response);

  try {
    await assert.rejects(
      () => updateNovel('novel-1', { summary: '新的简介' }),
      (error: unknown) => error instanceof DbTransportError
        && error.status === 409
        && error.code === 'DB_GENERATION_CONFLICT'
        && error.message === '数据库已变化，请刷新后重试',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('subscribeToChanges authorizes and shares one EventSource until the last unsubscribe', async () => {
  const OriginalEventSource = globalThis.EventSource;
  const originalFetch = globalThis.fetch;
  MockEventSource.instances = [];
  // @ts-expect-error test double
  globalThis.EventSource = MockEventSource;
  globalThis.fetch = async (input, init) => {
    assert.equal(input, '/api/db/events-token');
    assert.equal(init?.method, 'POST');
    return { ok: true, json: async () => ({ token: 'a'.repeat(64) }) } as Response;
  };

  let firstCount = 0;
  let secondCount = 0;

  try {
    const unsubscribeFirst = subscribeToChanges(() => {
      firstCount += 1;
    });
    const unsubscribeSecond = subscribeToChanges(() => {
      secondCount += 1;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(MockEventSource.instances.length, 1);
    const instance = MockEventSource.instances[0];
    assert.equal(instance.url, `/api/db/events?token=${'a'.repeat(64)}`);

    instance.onmessage?.({} as MessageEvent);
    assert.equal(firstCount, 1);
    assert.equal(secondCount, 1);

    unsubscribeFirst();
    assert.equal(instance.closed, false);

    unsubscribeSecond();
    assert.equal(instance.closed, true);
  } finally {
    __dbTransportTestHooks.reset();
    globalThis.fetch = originalFetch;
    globalThis.EventSource = OriginalEventSource;
  }
});

test('last unsubscribe clears reconnect after EventSource has already been nulled', async () => {
  const OriginalEventSource = globalThis.EventSource;
  const originalFetch = globalThis.fetch;
  MockEventSource.instances = [];
  // @ts-expect-error test double
  globalThis.EventSource = MockEventSource;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ token: 'b'.repeat(64) }) }) as Response;

  try {
    const unsubscribe = subscribeToChanges(() => {});
    await new Promise<void>((resolve) => setImmediate(resolve));
    const instance = MockEventSource.instances[0];
    instance.onerror?.();
    assert.equal(instance.closed, true);
    assert.equal(__dbTransportTestHooks.hasReconnectTimer(), true);

    unsubscribe();
    assert.equal(__dbTransportTestHooks.hasReconnectTimer(), false);
  } finally {
    __dbTransportTestHooks.reset();
    globalThis.fetch = originalFetch;
    globalThis.EventSource = OriginalEventSource;
  }
});
