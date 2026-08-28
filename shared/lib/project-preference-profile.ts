import type {
  CapabilityMembership,
  ProjectCapabilityProfile,
  ProjectPreferenceProfile,
  ProjectPreferenceWeights,
  ProjectSkillDeck,
} from '../types/preferences.js';

const DEFAULT_WEIGHTS: ProjectPreferenceWeights = {
  styleWeight: 0.5,
  characterWeight: 0.5,
  worldWeight: 0.5,
  plotWeight: 0.5,
  pacingWeight: 0.5,
};

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function normalizedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean))];
}

function normalizedOptionalId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim() || undefined;
}

const MEMBERSHIP_SOURCE_TYPES = new Set<CapabilityMembership['sourceType']>([
  'built-in', 'plaza', 'licensed', 'book-extracted',
]);

function normalizeCapabilityMemberships(value: unknown): CapabilityMembership[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: CapabilityMembership[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;
    const sourceId = typeof source.sourceId === 'string' ? source.sourceId.trim() : '';
    const sourceVersion = typeof source.sourceVersion === 'string'
      ? source.sourceVersion.trim()
      : typeof source.sourceVersion === 'number' && Number.isFinite(source.sourceVersion)
        ? String(source.sourceVersion)
        : '';
    const sourceType = typeof source.sourceType === 'string' && MEMBERSHIP_SOURCE_TYPES.has(source.sourceType as CapabilityMembership['sourceType'])
      ? source.sourceType as CapabilityMembership['sourceType']
      : undefined;
    if (!sourceId || !sourceVersion || !sourceType) continue;
    const key = `${sourceId}\u0000${sourceVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const persistedSkillId = normalizedOptionalId(source.persistedSkillId);
    result.push({ sourceId, sourceVersion, sourceType, ...(persistedSkillId ? { persistedSkillId } : {}) });
  }
  return result;
}

function normalizeCapabilityProfile(value: unknown): ProjectCapabilityProfile {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawDeck = source.projectSkillDeck && typeof source.projectSkillDeck === 'object'
    ? source.projectSkillDeck as Record<string, unknown>
    : {};
  const mainCardId = normalizedOptionalId(rawDeck.mainCardId);
  const supportCardIds = normalizedIds(rawDeck.supportCardIds)
    .filter((id) => id !== mainCardId);
  const updatedAt = typeof rawDeck.updatedAt === 'number'
    && Number.isFinite(rawDeck.updatedAt) && rawDeck.updatedAt >= 0
    ? rawDeck.updatedAt
    : 0;
  const projectSkillDeck: ProjectSkillDeck = {
    ...rawDeck,
    ...(mainCardId ? { mainCardId } : {}),
    supportCardIds,
    updatedAt,
  };
  if (!mainCardId) delete projectSkillDeck.mainCardId;

  return {
    ...source,
    version: 3,
    activeFlowId: normalizedOptionalId(source.activeFlowId),
    projectSkillDeck,
    favoriteTechniqueIds: normalizedIds(source.favoriteTechniqueIds),
    ...(source.projectTechniqueIds !== undefined
      ? { projectTechniqueIds: normalizedIds(source.projectTechniqueIds) }
      : {}),
    ...(source.guardrailIds !== undefined
      ? { guardrailIds: normalizedIds(source.guardrailIds) }
      : {}),
    capabilityMemberships: normalizeCapabilityMemberships(source.capabilityMemberships),
    ...(source.migrationPendingIds !== undefined
      ? { migrationPendingIds: normalizedIds(source.migrationPendingIds) }
      : {}),
  } as ProjectCapabilityProfile;
}

export function normalizeProjectPreferenceProfile(input: unknown): ProjectPreferenceProfile {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const rawWeights = source.weights && typeof source.weights === 'object'
    ? source.weights as Record<string, unknown>
    : {};
  const weights = { ...DEFAULT_WEIGHTS };
  for (const key of Object.keys(DEFAULT_WEIGHTS) as Array<keyof ProjectPreferenceWeights>) {
    if (typeof rawWeights[key] === 'number' && Number.isFinite(rawWeights[key])) {
      weights[key] = rawWeights[key] as number;
    }
  }
  const evidenceCount = typeof source.evidenceCount === 'number'
    && Number.isFinite(source.evidenceCount) && source.evidenceCount >= 0
    ? source.evidenceCount
    : 0;
  const normalized = {
    ...source,
    tags: arrayOrEmpty<string>(source.tags),
    weights,
    acceptedDimensions: arrayOrEmpty(source.acceptedDimensions),
    rejectedDimensions: arrayOrEmpty(source.rejectedDimensions),
    notes: arrayOrEmpty<string>(source.notes),
    evidenceCount,
  } as ProjectPreferenceProfile;
  if (source.capabilityModelVersion === 3) {
    normalized.capabilityModelVersion = 3;
    normalized.capabilityProfile = normalizeCapabilityProfile(source.capabilityProfile);
  }
  return normalized;
}
