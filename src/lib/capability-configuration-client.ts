import type { ProjectCapabilityProfile } from '../../shared/types';
import type {
  CapabilityApplicationItemResult,
  CapabilityPackageStep,
} from '../../shared/types/capability-execution';
import { HttpApiError, request as requestHttp } from './http';

export class CapabilityConfigurationError extends HttpApiError {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string
  ) {
    super(message, status, code);
    this.name = 'CapabilityConfigurationError';
  }
}

type ConfigurationPayload = {
  databaseGeneration: number;
  capabilityProfile: ProjectCapabilityProfile;
};

const request = async <T>(url: string, body: unknown): Promise<T> => {
  try {
    return await requestHttp<T>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof HttpApiError) {
      throw new CapabilityConfigurationError(
        error.code || `HTTP_${error.status}`,
        error.status,
        error.message
      );
    }
    throw error;
  }
};

export function previewCapabilityConfiguration(
  novelId: string,
  databaseGeneration: number,
  capabilityProfile: ProjectCapabilityProfile
): Promise<{ previewToken: string; databaseGeneration: number }> {
  const payload: ConfigurationPayload = { databaseGeneration, capabilityProfile };
  return request(
    `/api/novels/${encodeURIComponent(novelId)}/capabilities/configuration/preview`,
    payload
  );
}

export function applyCapabilityConfiguration(
  novelId: string,
  databaseGeneration: number,
  previewToken: string,
  capabilityProfile: ProjectCapabilityProfile,
  packageSteps?: readonly CapabilityPackageStep[],
  targetChapterId?: string
): Promise<{
  profile: ProjectCapabilityProfile;
  databaseGeneration: number;
  items?: readonly CapabilityApplicationItemResult[];
  applied?: boolean;
  idempotent?: boolean;
}> {
  return request(`/api/novels/${encodeURIComponent(novelId)}/capabilities/configuration/apply`, {
    databaseGeneration,
    previewToken,
    capabilityProfile,
    ...(packageSteps?.length ? { packageSteps } : {}),
    ...(targetChapterId ? { targetChapterId } : {}),
  });
}
