export class CapabilityMigrationError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) { super(message); this.name = 'CapabilityMigrationError'; }
}

export type CapabilityMigrationPreview = {
  flow?: { id: string; source: string };
  techniques: Array<{ id: string; source: string }>;
  skillCards: { main?: { id: string; source: string }; support: Array<{ id: string; source: string }> };
  mainCard?: { id: string; source: string };
  supportCards: Array<{ id: string; source: string }>;
  conflicts: Array<{ id: string; reason: string; relatedIds?: string[] }>;
  migrationPendingIds: string[];
  capabilityProfile: Record<string, unknown>;
  suggestion?: string;
  previewToken: string;
  databaseGeneration: number;
};

async function request<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({})) as { code?: string; error?: string } & T;
  if (!response.ok) throw new CapabilityMigrationError(payload.code || `HTTP_${response.status}`, response.status, payload.error || '能力迁移失败');
  return payload;
}

export function previewCapabilityMigration(novelId: string, databaseGeneration: number): Promise<CapabilityMigrationPreview> {
  return request(`/api/novels/${encodeURIComponent(novelId)}/capabilities/migration/preview`, { databaseGeneration });
}

export function applyCapabilityMigration(novelId: string, databaseGeneration: number, previewToken: string): Promise<{ applied: boolean; profile: Record<string, unknown>; databaseGeneration: number }> {
  return request(`/api/novels/${encodeURIComponent(novelId)}/capabilities/migration/apply`, { databaseGeneration, previewToken });
}

export const confirmCapabilityMigration = applyCapabilityMigration;
