import { afterEach, describe, expect, test, vi } from 'vitest';

import { __dbTransportTestHooks, flushPendingNotifications, subscribeToChanges } from '../lib/db-transport';

// Plan 183：SSE 外部写事件分发 trailing 合并。
// db-transport 无既有 EventSource mock 先例，这里用最小 stub 走真实 onmessage 路径。

type MessageHandler = (event: { data: string }) => void;

class FakeEventSource {
  static OPEN = 1;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.OPEN;
  onmessage: MessageHandler | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }
}

function installTransportStubs(): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ token: 'a'.repeat(64) }),
  })));
  vi.stubGlobal('EventSource', FakeEventSource);
}

async function connect(): Promise<FakeEventSource> {
  const stop = subscribeToChanges(() => {});
  activeUnsubscribe = stop;
  // 等待 token 握手完成、EventSource 建立
  await vi.waitFor(() => {
    expect(FakeEventSource.instances.length).toBeGreaterThan(0);
  });
  return FakeEventSource.instances[FakeEventSource.instances.length - 1];
}

let activeUnsubscribe: (() => void) | null = null;

describe('db-transport external-change coalescing', () => {
  afterEach(() => {
    activeUnsubscribe?.();
    activeUnsubscribe = null;
    __dbTransportTestHooks.reset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeEventSource.instances = [];
  });

  test('5 messages inside the window trigger exactly one listener flush', async () => {
    vi.useFakeTimers();
    installTransportStubs();
    const listener = vi.fn();
    const stop = subscribeToChanges(listener);
    activeUnsubscribe = stop;
    const es = await connect();

    for (let i = 0; i < 5; i += 1) {
      es.onmessage?.({ data: JSON.stringify({ initiator: 'another-client' }) });
    }
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(listener).toHaveBeenCalledTimes(1);

    // 窗口后无新事件不重复分发
    vi.advanceTimersByTime(500);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('a burst inside one window coalesces to a single flush; next window flushes again', async () => {
    vi.useFakeTimers();
    installTransportStubs();
    const listener = vi.fn();
    const stop = subscribeToChanges(listener);
    activeUnsubscribe = stop;
    const es = await connect();

    vi.advanceTimersByTime(500); // 排空上一用例遗留窗口之外的时钟
    expect(listener).toHaveBeenCalledTimes(0);

    for (let i = 0; i < 3; i += 1) {
      es.onmessage?.({ data: JSON.stringify({ initiator: 'another-client' }) });
    }
    vi.advanceTimersByTime(499);
    expect(listener).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('flushPendingNotifications dispatches immediately without waiting for the window', async () => {
    vi.useFakeTimers();
    installTransportStubs();
    const listener = vi.fn();
    const stop = subscribeToChanges(listener);
    activeUnsubscribe = stop;
    const es = await connect();

    es.onmessage?.({ data: JSON.stringify({ initiator: 'another-client' }) });
    flushPendingNotifications();
    expect(listener).toHaveBeenCalledTimes(1);

    // 清掉窗口后，窗口到期不会二次分发
    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('self-initiated events (initiator === CLIENT_ID) skip scheduling entirely', async () => {
    vi.useFakeTimers();
    installTransportStubs();
    const listener = vi.fn();
    const stop = subscribeToChanges(listener);
    activeUnsubscribe = stop;
    const es = await connect();

    for (let i = 0; i < 3; i += 1) {
      es.onmessage?.({ data: JSON.stringify({ initiator: __dbTransportTestHooks.clientId }) });
    }
    // 自写事件不进 timer：推进远超窗口的时间也不分发
    vi.advanceTimersByTime(1000);
    expect(listener).not.toHaveBeenCalled();
  });

  test('malformed payload still falls back to notifying (coalesced)', async () => {
    vi.useFakeTimers();
    installTransportStubs();
    const listener = vi.fn();
    const stop = subscribeToChanges(listener);
    activeUnsubscribe = stop;
    const es = await connect();

    es.onmessage?.({ data: 'not-json' });
    vi.advanceTimersByTime(500);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('listener promise rejections are caught (178 fallback preserved under debounce)', async () => {
    vi.useFakeTimers();
    installTransportStubs();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stop = subscribeToChanges(() => Promise.reject(new Error('boom')));
    activeUnsubscribe = stop;
    const es = await connect();

    es.onmessage?.({ data: JSON.stringify({ initiator: 'another-client' }) });
    await vi.advanceTimersByTimeAsync(500);
    expect(warnSpy).toHaveBeenCalledWith('SSE listener error:', expect.any(Error));
    warnSpy.mockRestore();
  });
});
