import { HttpApiError, request as requestHttp } from './http';

export class CapabilityMigrationError extends HttpApiError {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string
  ) {
    super(message, status, code);
    this.name = 'CapabilityMigrationError';
  }
}

export type CapabilityMigrationPreview = {
  flow?: { id: string; source: string };
  techniques: Array<{ id: string; source: string }>;
  skillCards: {
    main?: { id: string; source: string };
    support: Array<{ id: string; source: string }>;
  };
  mainCard?: { id: string; source: string };
  supportCards: Array<{ id: string; source: string }>;
  conflicts: Array<{ id: string; reason: string; relatedIds?: string[] }>;
  migrationPendingIds: string[];
  capabilityProfile: Record<string, unknown>;
  suggestion?: string;
  previewToken: string;
  databaseGeneration: number;
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
      throw new CapabilityMigrationError(
        error.code || `HTTP_${error.status}`,
        error.status,
        error.message
      );
    }
    throw error;
  }
};

export function previewCapabilityMigration(
  novelId: string,
  databaseGeneration: number
): Promise<CapabilityMigrationPreview> {
  return request(`/api/novels/${encodeURIComponent(novelId)}/capabilities/migration/preview`, {
    databaseGeneration,
  });
}

export function applyCapabilityMigration(
  novelId: string,
  databaseGeneration: number,
  previewToken: string
): Promise<{ applied: boolean; profile: Record<string, unknown>; databaseGeneration: number }> {
  return request(`/api/novels/${encodeURIComponent(novelId)}/capabilities/migration/apply`, {
    databaseGeneration,
    previewToken,
  });
}

export const confirmCapabilityMigration = applyCapabilityMigration;
