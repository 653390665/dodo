import type { CapabilityManifestEntry, CapabilityUtilityExecuteInput, CapabilityUtilityResult } from '../../shared/types';

export class CapabilityRequestError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CapabilityRequestError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({})) as T & { code?: string; error?: string };
  if (!response.ok) {
    throw new CapabilityRequestError(payload.code || 'CAPABILITY_REQUEST_FAILED', response.status, payload.error || '能力执行失败');
  }
  return payload;
}

export function executeCapability(
  novelId: string,
  assetId: string,
  input: CapabilityUtilityExecuteInput,
  signal?: AbortSignal,
): Promise<CapabilityUtilityResult> {
  return request(`/api/novels/${encodeURIComponent(novelId)}/capabilities/${encodeURIComponent(assetId)}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
}

export async function listCapabilityManifest(): Promise<CapabilityManifestEntry[]> {
  const payload = await request<{ entries: CapabilityManifestEntry[] }>('/api/capabilities/manifest');
  return payload.entries;
}
