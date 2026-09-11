export class HttpApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly traceId?: string,
    readonly payload?: unknown
  ) {
    super(message);
    this.name = 'HttpApiError';
  }
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const payload = await res.json().catch(() => null);
  if (!res.ok || (payload && typeof payload === 'object' && 'code' in payload && payload.code)) {
    throw new HttpApiError(
      payload?.error || payload?.message || `HTTP ${res.status}`,
      res.status,
      payload?.code,
      payload?.traceId,
      payload
    );
  }
  return payload as T;
}
