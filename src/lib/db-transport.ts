async function call(method: string, ...args: any[]): Promise<any> {
  const res = await fetch('/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
let globalListeners = new Set<() => void>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 3000;

function connectEventSource() {
  if (globalEventSource && globalEventSource.readyState === EventSource.OPEN) return;
  if (globalEventSource) {
    globalEventSource.close();
    globalEventSource = null;
  }

  const es = new EventSource('/api/db/events');

  es.onmessage = () => {
    reconnectDelay = 3000;
    globalListeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error('SSE listener error:', e);
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

export function subscribeToChanges(onChange: () => void): () => void {
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
