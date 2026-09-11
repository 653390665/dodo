import type {
  CapabilityManifestEntry,
  CapabilityUtilityExecuteInput,
  CapabilityUtilityResult,
} from '../../shared/types';
import { HttpApiError, request as requestHttp } from './http';

export class CapabilityRequestError extends HttpApiError {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string
  ) {
    super(message, status, code);
    this.name = 'CapabilityRequestError';
  }
}

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  try {
    return await requestHttp<T>(url, init);
  } catch (error) {
    if (error instanceof HttpApiError) {
      throw new CapabilityRequestError(
        error.code || 'CAPABILITY_REQUEST_FAILED',
        error.status,
        error.message
      );
    }
    throw error;
  }
};

export function executeCapability(
  novelId: string,
  assetId: string,
  input: CapabilityUtilityExecuteInput,
  signal?: AbortSignal
): Promise<CapabilityUtilityResult> {
  return request(
    `/api/novels/${encodeURIComponent(novelId)}/capabilities/${encodeURIComponent(assetId)}/execute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    }
  );
}

export async function listCapabilityManifest(): Promise<CapabilityManifestEntry[]> {
  const payload = await request<{ entries: CapabilityManifestEntry[] }>(
    '/api/capabilities/manifest'
  );
  return payload.entries;
}
