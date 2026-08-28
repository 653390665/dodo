import type { ProjectCapabilityProfile } from '../../shared/types';
import type { CapabilityApplicationItemResult, CapabilityPackageStep } from '../../shared/types/capability-execution';

export class CapabilityConfigurationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CapabilityConfigurationError';
  }
}

type ConfigurationPayload = {
  databaseGeneration: number;
  capabilityProfile: ProjectCapabilityProfile;
};

async function request<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { code?: string; error?: string } & T;
  if (!response.ok) {
    throw new CapabilityConfigurationError(payload.code || `HTTP_${response.status}`, response.status, payload.error || '能力配置失败');
  }
  return payload;
}

export function previewCapabilityConfiguration(
  novelId: string,
  databaseGeneration: number,
  capabilityProfile: ProjectCapabilityProfile,
): Promise<{ previewToken: string; databaseGeneration: number }> {
  const payload: ConfigurationPayload = { databaseGeneration, capabilityProfile };
  return request(`/api/novels/${encodeURIComponent(novelId)}/capabilities/configuration/preview`, payload);
}

export function applyCapabilityConfiguration(
  novelId: string,
  databaseGeneration: number,
  previewToken: string,
  capabilityProfile: ProjectCapabilityProfile,
  packageSteps?: readonly CapabilityPackageStep[],
  targetChapterId?: string,
): Promise<{ profile: ProjectCapabilityProfile; databaseGeneration: number; items?: readonly CapabilityApplicationItemResult[]; applied?: boolean; idempotent?: boolean }> {
  return request(`/api/novels/${encodeURIComponent(novelId)}/capabilities/configuration/apply`, {
    databaseGeneration,
    previewToken,
    capabilityProfile,
    ...(packageSteps?.length ? { packageSteps } : {}),
    ...(targetChapterId ? { targetChapterId } : {}),
  });
}
