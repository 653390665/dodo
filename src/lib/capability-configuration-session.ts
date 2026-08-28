import type { ProjectCapabilityProfile } from '../../shared/types';
import type { EnhancementPackageStep } from '../../shared/types/prompt-assets-governed';

export type CapabilitySessionTab = 'mySkills' | 'plaza';
export type CapabilitySessionStoreTab =
  | 'flow'
  | 'technique'
  | 'skill-card'
  | 'diagnostic'
  | 'role-skill'
  | 'overlay'
  | 'utility'
  | 'guardrail'
  | 'diagnostic-tools'
  | 'packages';
export type CapabilitySessionCategory =
  | 'all'
  | 'creative-setup'
  | 'active-drafting'
  | 'style-polish'
  | 'commercial-sign';

export interface CapabilityConfigurationSession {
  version: 1;
  novelId: string;
  databaseGeneration: number;
  baselineToken: string;
  configurationDraft: ProjectCapabilityProfile | null;
  pendingPackageSteps?: EnhancementPackageStep[];
  /** Stable lifecycle session binding for capability events in this novel. */
  sessionId?: string;
  candidateCardIds: string[];
  pendingCandidateId: string | null;
  activeTab: CapabilitySessionTab;
  selectedCapability: CapabilitySessionStoreTab;
  selectedCategory: CapabilitySessionCategory;
  selectedAssetId: string | null;
  scrollTop: number;
  updatedAt: number;
}

export function isCapabilityConfigurationSessionStale(
  session: CapabilityConfigurationSession,
  databaseGeneration: number,
  baselineToken: string,
): boolean {
  return session.databaseGeneration !== databaseGeneration || session.baselineToken !== baselineToken;
}

const STORAGE_PREFIX = 'inkflow:capability-configuration:v1:';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

/** Stable local baseline identifier; it is only a session binding, not a security token. */
export function getCapabilityConfigurationBaselineToken(profile: ProjectCapabilityProfile | null | undefined): string {
  return JSON.stringify(canonicalize(profile || null));
}

function storageKey(novelId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(novelId)}`;
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  return window.sessionStorage;
}

function normalizeSession(value: unknown): CapabilityConfigurationSession | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.novelId !== 'string' || !record.novelId.trim()) return null;
  if (!Number.isInteger(record.databaseGeneration) || (record.databaseGeneration as number) < 0) return null;
  if (typeof record.baselineToken !== 'string' || !record.baselineToken.trim()) return null;

  const candidateCardIds = Array.isArray(record.candidateCardIds)
    ? [...new Set(record.candidateCardIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
    : [];
  const pendingPackageSteps = Array.isArray(record.pendingPackageSteps)
    ? record.pendingPackageSteps.filter((step): step is EnhancementPackageStep => Boolean(step && typeof step === 'object' && typeof (step as Record<string, unknown>).id === 'string' && typeof (step as Record<string, unknown>).assetId === 'string'))
    : [];
  const activeTab = record.activeTab === 'plaza' ? 'plaza' : 'mySkills';
  const selectedCapability = typeof record.selectedCapability === 'string'
    ? record.selectedCapability as CapabilitySessionStoreTab
    : 'flow';
  const selectedCategory = typeof record.selectedCategory === 'string'
    ? record.selectedCategory as CapabilitySessionCategory
    : 'all';
  const scrollTop = Number.isFinite(record.scrollTop) && (record.scrollTop as number) >= 0 ? record.scrollTop as number : 0;
  return {
    version: 1,
    novelId: record.novelId,
    databaseGeneration: record.databaseGeneration as number,
    baselineToken: record.baselineToken,
    configurationDraft: record.configurationDraft && typeof record.configurationDraft === 'object'
      ? record.configurationDraft as ProjectCapabilityProfile
      : null,
    pendingPackageSteps,
    sessionId: typeof record.sessionId === 'string' && record.sessionId.trim()
      ? record.sessionId
      : `capability:${record.novelId}:${record.databaseGeneration}:legacy`,
    candidateCardIds,
    pendingCandidateId: typeof record.pendingCandidateId === 'string' && candidateCardIds.includes(record.pendingCandidateId)
      ? record.pendingCandidateId
      : null,
    activeTab,
    selectedCapability,
    selectedCategory,
    selectedAssetId: typeof record.selectedAssetId === 'string' ? record.selectedAssetId : null,
    scrollTop,
    updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt as number : Date.now(),
  };
}

export function saveCapabilityConfigurationSession(session: CapabilityConfigurationSession): void {
  const storage = getStorage();
  if (!storage) return;
  const normalized = normalizeSession(session);
  if (!normalized) return;
  try {
    storage.setItem(storageKey(normalized.novelId), JSON.stringify(normalized));
  } catch {
    // sessionStorage is optional and may be unavailable in private browsing.
  }
}

export function loadCapabilityConfigurationSession(novelId: string, databaseGeneration: number, baselineToken: string): CapabilityConfigurationSession | null {
  const storage = getStorage();
  if (!storage || !novelId || !Number.isInteger(databaseGeneration) || !baselineToken) return null;
  try {
    const parsed = normalizeSession(JSON.parse(storage.getItem(storageKey(novelId)) || 'null'));
    if (!parsed || parsed.novelId !== novelId || parsed.databaseGeneration !== databaseGeneration || parsed.baselineToken !== baselineToken) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Loads the latest draft for a work without requiring the current database
 * snapshot. Callers must use isCapabilityConfigurationSessionStale before
 * allowing the draft to be applied.
 */
export function loadLatestCapabilityConfigurationSession(novelId: string): CapabilityConfigurationSession | null {
  const storage = getStorage();
  if (!storage || !novelId) return null;
  try {
    const parsed = normalizeSession(JSON.parse(storage.getItem(storageKey(novelId)) || 'null'));
    return parsed && parsed.novelId === novelId ? parsed : null;
  } catch {
    return null;
  }
}

export function clearLatestCapabilityConfigurationSession(novelId: string): void {
  const storage = getStorage();
  if (!storage || !novelId) return;
  try { storage.removeItem(storageKey(novelId)); } catch { /* optional storage */ }
}

export function clearCapabilityConfigurationSession(novelId: string, databaseGeneration?: number, baselineToken?: string): void {
  const storage = getStorage();
  if (!storage || !novelId) return;
  if (databaseGeneration !== undefined && baselineToken !== undefined && !loadCapabilityConfigurationSession(novelId, databaseGeneration, baselineToken)) return;
  try { storage.removeItem(storageKey(novelId)); } catch { /* optional storage */ }
}

export function getCapabilityConfigurationStorageKey(novelId: string): string {
  return storageKey(novelId);
}
