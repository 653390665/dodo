const CLIENT_ID = Math.random().toString(36).substring(2) + Date.now().toString(36);

async function call(method: string, ...args: any[]): Promise<any> {
  const res = await fetch('/api/db', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': CLIENT_ID,
    },
    body: JSON.stringify({ method, args }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'API error');
  }
  const data = await res.json();
  return data.result;
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
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
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
    if (globalListeners.size === 0 && globalEventSource) {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      globalEventSource.close();
      globalEventSource = null;
    }
  };
}

export { call };
