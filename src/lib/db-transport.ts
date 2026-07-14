const CLIENT_ID = Math.random().toString(36).substring(2) + Date.now().toString(36);
export const DATABASE_GENERATION_HEADER = 'x-inkflow-database-generation';

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
  const payload = await response.json().catch(() => ({})) as { databaseGeneration?: number; error?: string };
  if (!response.ok || !Number.isInteger(payload.databaseGeneration) || (payload.databaseGeneration as number) < 0) {
    throw new Error(payload.error || 'Unable to read database generation');
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
    const err = await res.json();
    throw new Error(err.error || 'API error');
  }
  const data = await res.json();
  return data.result as T;
}

let globalEventSource: EventSource | null = null;
const globalListeners = new Set<() => void>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 3000;

function connectEventSource() {
  if (globalEventSource && globalEventSource.readyState === EventSource.OPEN) return;
  if (globalEventSource) {
    globalEventSource.close();
    globalEventSource = null;
  }

  const es = new EventSource('/api/db/events');

  es.onmessage = (event) => {
    reconnectDelay = 3000;
    if (event.data) {
      try {
        const payload = JSON.parse(event.data);
        if (payload.initiator === CLIENT_ID) {
          return;
        }
      } catch {
        // Fall back to notifying if parsing fails
      }
    }
    globalListeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.warn('SSE listener error:', e);
      }
    });
  };

  es.onerror = () => {
    es.close();
    globalEventSource = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (globalListeners.size === 0) {
      reconnectTimer = null;
      return;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (globalListeners.size === 0) return;
      connectEventSource();
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
    }, reconnectDelay);
  };

  es.onopen = () => {
    reconnectDelay = 3000;
  };
  globalEventSource = es;
}

export function subscribeToChanges(onChange: () => void, _entityType?: string): () => void {
  globalListeners.add(onChange);
  connectEventSource();
  return () => {
    globalListeners.delete(onChange);
    if (globalListeners.size === 0) {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      globalEventSource?.close();
      globalEventSource = null;
    }
  };
}

export const __dbTransportTestHooks = {
  hasReconnectTimer: () => reconnectTimer !== null,
  reset: () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    globalEventSource?.close();
    globalEventSource = null;
    globalListeners.clear();
    reconnectDelay = 3000;
  },
};

export { call };
