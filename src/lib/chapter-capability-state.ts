import type { ChapterWorkflowMeta, ProjectPreferenceProfile } from '../../shared/types';

const MAX_EFFECTIVE_SKILL_CARDS = 6;

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim())
    .filter(Boolean))];
}

export function getChapterOverlayCapacity(profile?: ProjectPreferenceProfile): number {
  if (profile?.capabilityModelVersion !== 3) return MAX_EFFECTIVE_SKILL_CARDS;
  const deck = profile.capabilityProfile?.projectSkillDeck;
  const projectCardIds = normalizeIds([deck?.mainCardId, ...(deck?.supportCardIds || [])]);
  return Math.max(0, MAX_EFFECTIVE_SKILL_CARDS - projectCardIds.length);
}

export function buildChapterCapabilityWorkflowMeta(
  current: ChapterWorkflowMeta | undefined,
  state: {
    techniqueIds: unknown;
    overlayCardIds: unknown;
    updatedAt?: number;
    novelId?: string;
    databaseGeneration?: number;
    techniqueVersions?: Record<string, string | number>;
    overlayVersions?: Record<string, string | number>;
  },
  ): ChapterWorkflowMeta {
  const normalizeVersions = (value: unknown): Record<string, string | number> => {
    if (!value || typeof value !== 'object') return {};
    const result: Record<string, string | number> = {};
    for (const [id, version] of Object.entries(value as Record<string, unknown>)) {
      if (!id.trim() || (typeof version !== 'string' && typeof version !== 'number')) continue;
      result[id.trim()] = version;
    }
    return result;
  };
  const capabilityState = {
    techniqueIds: normalizeIds(state.techniqueIds),
    overlayCardIds: normalizeIds(state.overlayCardIds),
    updatedAt: typeof state.updatedAt === 'number' && Number.isFinite(state.updatedAt) && state.updatedAt >= 0
      ? state.updatedAt
      : Date.now(),
    ...(typeof state.novelId === 'string' && state.novelId.trim() ? { novelId: state.novelId.trim() } : {}),
    ...(Number.isInteger(state.databaseGeneration) && (state.databaseGeneration as number) >= 0 ? { databaseGeneration: state.databaseGeneration } : {}),
    ...(Object.keys(normalizeVersions(state.techniqueVersions)).length > 0 ? { techniqueVersions: normalizeVersions(state.techniqueVersions) } : {}),
    ...(Object.keys(normalizeVersions(state.overlayVersions)).length > 0 ? { overlayVersions: normalizeVersions(state.overlayVersions) } : {}),
  };
  return {
    ...(current || {}),
    version: 1,
    capabilityState,
  };
}
