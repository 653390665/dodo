const CLIENT_ID = Math.random().toString(36).substring(2) + Date.now().toString(36);
export const DATABASE_GENERATION_HEADER = 'x-inkflow-database-generation';

export class DbTransportError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'DbTransportError';
    this.status = status;
    this.code = code;
  }
}

interface ErrorPayload {
  code?: unknown;
  error?: unknown;
  message?: unknown;
}

async function parseErrorPayload(response: Response): Promise<ErrorPayload> {
  const payload = await response.json().catch(() => ({})) as unknown;
  return payload && typeof payload === 'object' ? payload as ErrorPayload : {};
}

function errorMessage(payload: ErrorPayload, fallback: string): string {
  return typeof payload.message === 'string' && payload.message.trim()
    ? payload.message
    : typeof payload.error === 'string' && payload.error.trim()
      ? payload.error
      : fallback;
}

export function requireResponseDatabaseGeneration(response: Response): number {
  const raw = response.headers.get(DATABASE_GENERATION_HEADER);
  if (raw === null || raw.trim() === '') {
    throw new Error('Server response is missing a valid database generation');
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('Server response is missing a valid database generation');
  }
  return value;
}

export async function getDatabaseGenerationSnapshot(signal?: AbortSignal): Promise<number> {
  const response = await fetch('/api/db/generation', { signal });
  const payload = await parseErrorPayload(response) as ErrorPayload & { databaseGeneration?: number };
  if (!response.ok || !Number.isInteger(payload.databaseGeneration) || (payload.databaseGeneration as number) < 0) {
    throw new DbTransportError(errorMessage(payload, 'Unable to read database generation'), response.status, typeof payload.code === 'string' ? payload.code : undefined);
  }
  return payload.databaseGeneration as number;
}

async function call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  return callWithGeneration<T>(undefined, method, ...args);
}

export async function callForGeneration<T = unknown>(
  databaseGeneration: number,
  method: string,
  ...args: unknown[]
): Promise<T> {
  return callWithGeneration<T>(databaseGeneration, method, ...args);
}

export async function callBatch<T = unknown>(method: string, args: unknown[]): Promise<T> {
  return callWithGeneration<T>(undefined, method, args);
}

async function callWithGeneration<T>(databaseGeneration: number | undefined, method: string, ...args: unknown[]): Promise<T> {
  const res = await fetch('/api/db', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': CLIENT_ID,
    },
    body: JSON.stringify({ method, args, ...(databaseGeneration === undefined ? {} : { databaseGeneration }) }),
  });
  if (!res.ok) {
    const err = await parseErrorPayload(res);
    throw new DbTransportError(errorMessage(err, 'API error'), res.status, typeof err.code === 'string' ? err.code : undefined);
  }
  const data = await res.json();
  return data.result as T;
}

let globalEventSource: EventSource | null = null;
const globalListeners = new Set<() => void>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 3000;
let connectPromise: Promise<void> | null = null;
let connectionEpoch = 0;

// 183：外部写事件的 trailing 合并窗口——窗口内多条 SSE 只触发一次分发，
// 抑制实体抽取等批量写引发的「每事件 × 全订阅者」全量刷新风暴。
const LISTENER_FLUSH_DELAY_MS = 500;
let notifyFlushTimer: ReturnType<typeof setTimeout> | null = null;

function dispatchListeners(): void {
  globalListeners.forEach((fn) => {
    // 178：监听器可能返回 promise（如组件内 async 刷新），同步 try/catch 接不住；
    // 统一经 Promise.resolve 兜底，防止 SSE 广播时反复 unhandled rejection。
    Promise.resolve(fn()).catch((e) => console.warn('SSE listener error:', e));
  });
}

function scheduleListenerFlush(): void {
  if (notifyFlushTimer) return; // trailing：窗口内只排一次
  notifyFlushTimer = setTimeout(() => {
    notifyFlushTimer = null;
    dispatchListeners();
  }, LISTENER_FLUSH_DELAY_MS);
}

function cancelPendingListenerFlush(): void {
  if (notifyFlushTimer) {
    clearTimeout(notifyFlushTimer);
    notifyFlushTimer = null;
  }
}

/** 清掉挂起的合并窗口并立即分发一次——供「需要立即刷新」的调用点与测试使用。 */
export function flushPendingNotifications(): void {
  cancelPendingListenerFlush();
  dispatchListeners();
}

function scheduleReconnect() {
  if (reconnectTimer || globalListeners.size === 0) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (globalListeners.size === 0) return;
    void connectEventSource();
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  }, reconnectDelay);
}

async function connectEventSource(): Promise<void> {
  if (globalEventSource && globalEventSource.readyState === EventSource.OPEN) return;
  if (connectPromise) return connectPromise;
  if (globalEventSource) {
    globalEventSource.close();
    globalEventSource = null;
  }

  const epoch = connectionEpoch;
  const pending = (async () => {
    const response = await fetch('/api/db/events-token', { method: 'POST' });
    const payload = await response.json().catch(() => ({})) as { token?: string };
    if (!response.ok || !payload.token || !/^[0-9a-f]{64}$/.test(payload.token)) {
      throw new Error('Unable to authorize database event stream');
    }
    if (epoch !== connectionEpoch || globalListeners.size === 0) return;

    const es = new EventSource(`/api/db/events?token=${encodeURIComponent(payload.token)}`);

    es.onmessage = (event) => {
      reconnectDelay = 3000;
      if (event.data) {
        try {
          const eventPayload = JSON.parse(event.data);
          if (eventPayload.initiator === CLIENT_ID) {
            return;
          }
        } catch {
          // Fall back to notifying if parsing fails
        }
      }
      scheduleListenerFlush();
    };

    es.onerror = () => {
      cancelPendingListenerFlush();
      es.close();
      if (globalEventSource === es) globalEventSource = null;
      scheduleReconnect();
    };

    es.onopen = () => {
      reconnectDelay = 3000;
    };
    globalEventSource = es;
  })().catch(() => {
    scheduleReconnect();
  });
  connectPromise = pending;
  try {
    await pending;
  } finally {
    if (connectPromise === pending) connectPromise = null;
  }
}

export function subscribeToChanges(onChange: () => void, _entityType?: string): () => void {
  globalListeners.add(onChange);
  void connectEventSource();
  return () => {
    globalListeners.delete(onChange);
    if (globalListeners.size === 0) {
      connectionEpoch += 1;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      cancelPendingListenerFlush();
      globalEventSource?.close();
      globalEventSource = null;
    }
  };
}

export const __dbTransportTestHooks = {
  clientId: CLIENT_ID,
  hasReconnectTimer: () => reconnectTimer !== null,
  reset: () => {
    connectionEpoch += 1;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    cancelPendingListenerFlush();
    connectPromise = null;
    globalEventSource?.close();
    globalEventSource = null;
    globalListeners.clear();
    reconnectDelay = 3000;
  },
};

export { call };
