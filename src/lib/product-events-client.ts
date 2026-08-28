import type { ProductEventInput, ProductEventMetrics } from '../../shared/types/product-events';

function createTelemetryId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}:${uuid || `${Date.now()}:${Math.random().toString(36).slice(2)}`}`;
}

const productEventSessionId = createTelemetryId('session');

export function createProductEventSessionId(scope = 'session'): string {
  return createTelemetryId(scope);
}

/** Stable within one user action/session, preventing duplicate lifecycle rows from rerenders. */
export function createProductEventId(action: string, sessionId = productEventSessionId): string {
  const hash = [...`${sessionId}\u0000${action}`].reduce((value, character) => {
    value ^= character.charCodeAt(0);
    return Math.imul(value, 16_777_619) >>> 0;
  }, 2_166_136_261).toString(36);
  const safeSession = sessionId.replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 80);
  const safeAction = action.replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 80);
  return `event:${safeSession}:${safeAction}:${hash}`;
}

async function parseResponse<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : fallback);
  return data as T;
}

export async function recordProductEvent(input: ProductEventInput): Promise<void> {
  try {
    const envelope: ProductEventInput = {
      ...input,
      schemaVersion: 1,
      eventId: input.eventId || createTelemetryId('event'),
      sessionId: input.sessionId || productEventSessionId,
      occurredAt: input.occurredAt ?? Date.now(),
    };
    const response = await fetch('/api/product-events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope) });
    await parseResponse(response, 'Failed to record product event');
  } catch {
    // Local telemetry must never change the outcome of the user action.
  }
}
export async function getProductMetrics(days = 30): Promise<ProductEventMetrics> {
  const response = await fetch(`/api/product-events/metrics?days=${encodeURIComponent(days)}`);
  return parseResponse<ProductEventMetrics>(response, 'Failed to load product event metrics');
}
export async function exportProductEvents(): Promise<void> {
  const response = await fetch('/api/product-events/export');
  if (!response.ok) throw new Error('Failed to export product events');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'inkflow-product-events.json';
  anchor.click();
  URL.revokeObjectURL(url);
}
export async function clearProductEvents(): Promise<void> {
  const response = await fetch('/api/product-events', { method: 'DELETE' });
  await parseResponse(response, 'Failed to clear product events');
}
