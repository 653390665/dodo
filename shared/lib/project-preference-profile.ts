import type {
  CapabilityMembership,
  ProjectCapabilityProfile,
  ProjectPreferenceProfile,
  ProjectPreferenceWeights,
  ProjectSkillDeck,
  TechniquePriority,
  TechniquePriorityRole,
} from '../types/preferences.js';

/** 作品卡组辅卡容量上限（Plan 256：由 2 扩至 4；服务端校验与 UI 槽位共用此常量）。 */
export const PROJECT_DECK_MAX_SUPPORT_CARDS = 4;

const DEFAULT_WEIGHTS: ProjectPreferenceWeights = {
  styleWeight: 0.5,
  characterWeight: 0.5,
  worldWeight: 0.5,
  plotWeight: 0.5,
  pacingWeight: 0.5,
};

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

function normalizedOptionalId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim() || undefined;
}

const MEMBERSHIP_SOURCE_TYPES = new Set<CapabilityMembership['sourceType']>([
  'built-in',
  'plaza',
  'licensed',
  'book-extracted',
]);

function normalizeCapabilityMemberships(value: unknown): CapabilityMembership[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: CapabilityMembership[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;
    const sourceId = typeof source.sourceId === 'string' ? source.sourceId.trim() : '';
    const sourceVersion =
      typeof source.sourceVersion === 'string'
        ? source.sourceVersion.trim()
        : typeof source.sourceVersion === 'number' && Number.isFinite(source.sourceVersion)
          ? String(source.sourceVersion)
          : '';
    const sourceType =
      typeof source.sourceType === 'string' &&
      MEMBERSHIP_SOURCE_TYPES.has(source.sourceType as CapabilityMembership['sourceType'])
        ? (source.sourceType as CapabilityMembership['sourceType'])
        : undefined;
    if (!sourceId || !sourceVersion || !sourceType) continue;
    const key = `${sourceId}\u0000${sourceVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const persistedSkillId = normalizedOptionalId(source.persistedSkillId);
    result.push({
      sourceId,
      sourceVersion,
      sourceType,
      ...(persistedSkillId ? { persistedSkillId } : {}),
    });
  }
  return result;
}

const TECHNIQUE_PRIORITY_ROLES = new Set<string>(['base', 'accent', 'seasonal']);

/**
 * Plan 260：技法装配优先度归一化——按 id 去重（首见生效）、role 白名单校验、
 * order 缺省按出现序填充。字段整体缺省时保持缺省（不注入空数组），旧 profile 行为不变。
 */
function normalizeTechniquePriorities(value: unknown): TechniquePriority[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: TechniquePriority[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const role = row.role;
    if (!id || typeof role !== 'string' || !TECHNIQUE_PRIORITY_ROLES.has(role)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const order =
      typeof row.order === 'number' && Number.isFinite(row.order) ? row.order : result.length;
    result.push({ id, role: role as TechniquePriorityRole, order });
  }
  return result;
}

function normalizeCapabilityProfile(value: unknown): ProjectCapabilityProfile {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const rawDeck =
    source.projectSkillDeck && typeof source.projectSkillDeck === 'object'
      ? (source.projectSkillDeck as Record<string, unknown>)
      : {};
  const mainCardId = normalizedOptionalId(rawDeck.mainCardId);
  const supportCardIds = normalizedIds(rawDeck.supportCardIds).filter((id) => id !== mainCardId);
  const updatedAt =
    typeof rawDeck.updatedAt === 'number' &&
    Number.isFinite(rawDeck.updatedAt) &&
    rawDeck.updatedAt >= 0
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
    ...(source.techniquePriorities !== undefined
      ? { techniquePriorities: normalizeTechniquePriorities(source.techniquePriorities) }
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
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const rawWeights =
    source.weights && typeof source.weights === 'object'
      ? (source.weights as Record<string, unknown>)
      : {};
  const weights = { ...DEFAULT_WEIGHTS };
  for (const key of Object.keys(DEFAULT_WEIGHTS) as Array<keyof ProjectPreferenceWeights>) {
    if (typeof rawWeights[key] === 'number' && Number.isFinite(rawWeights[key])) {
      weights[key] = rawWeights[key] as number;
    }
  }
  const evidenceCount =
    typeof source.evidenceCount === 'number' &&
    Number.isFinite(source.evidenceCount) &&
    source.evidenceCount >= 0
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
