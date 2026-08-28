import type { CapabilityMembership, Skill, MountedSkillLoadoutItem, Novel, ProjectCapabilityProfile, ProjectPreferenceProfile } from '../../shared/types';
import type { CuratedProductSkill } from '../../shared/types/prompt-assets-governed';
import { getCatalogCapabilityManifest } from '../../shared/lib/capability-manifest-catalog';
import type { CapabilityManifestEntry } from '../../shared/types/capability-manifest';
import { normalizeProjectPreferenceProfile } from '../../shared/lib/project-preference-profile';

export type RoleSkillSlot = 'planner' | 'writer' | 'critic';

const ROLE_SLOT_INDEX: Record<RoleSkillSlot, number> = { planner: 0, writer: 1, critic: 2 };

export function getProjectCapabilityProfile(novel?: Pick<Novel, 'projectPreferenceProfile'> | null): ProjectCapabilityProfile | null {
  const profile = novel?.projectPreferenceProfile?.capabilityProfile;
  if (!profile || profile.version !== 3 || !profile.projectSkillDeck) return null;
  return {
    version: 3,
    activeFlowId: typeof profile.activeFlowId === 'string' ? profile.activeFlowId : undefined,
    projectSkillDeck: {
      mainCardId: typeof profile.projectSkillDeck.mainCardId === 'string' ? profile.projectSkillDeck.mainCardId : undefined,
      supportCardIds: Array.isArray(profile.projectSkillDeck.supportCardIds)
        ? [...new Set(profile.projectSkillDeck.supportCardIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
        : [],
      updatedAt: Number.isFinite(profile.projectSkillDeck.updatedAt) ? profile.projectSkillDeck.updatedAt : 0,
    },
    favoriteTechniqueIds: Array.isArray(profile.favoriteTechniqueIds)
      ? [...new Set(profile.favoriteTechniqueIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
      : [],
    projectTechniqueIds: Array.isArray(profile.projectTechniqueIds)
      ? [...new Set(profile.projectTechniqueIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
      : Array.isArray(profile.favoriteTechniqueIds)
        ? [...new Set(profile.favoriteTechniqueIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
        : [],
    guardrailIds: Array.isArray(profile.guardrailIds)
      ? [...new Set(profile.guardrailIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
      : undefined,
    capabilityMemberships: Array.isArray(profile.capabilityMemberships)
      ? profile.capabilityMemberships.map((membership) => ({ ...membership }))
      : [],
    migrationPendingIds: Array.isArray(profile.migrationPendingIds)
      ? [...new Set(profile.migrationPendingIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
      : undefined,
  };
}

export function buildV3CapabilityProfile(
  novel: Pick<Novel, 'projectPreferenceProfile'> | null | undefined,
  patch: Partial<ProjectCapabilityProfile>,
): ProjectPreferenceProfile {
  const existing: ProjectCapabilityProfile = getProjectCapabilityProfile(novel) || {
    version: 3 as const,
    activeFlowId: undefined,
    projectSkillDeck: { supportCardIds: [], updatedAt: 0 },
    favoriteTechniqueIds: [],
    projectTechniqueIds: [],
    capabilityMemberships: [],
  };
  return {
    ...normalizeProjectPreferenceProfile(novel?.projectPreferenceProfile),
    capabilityModelVersion: 3,
    capabilityProfile: {
      ...existing,
      ...patch,
      version: 3,
      projectSkillDeck: {
        ...existing.projectSkillDeck,
        ...(patch.projectSkillDeck || {}),
        supportCardIds: [...new Set(patch.projectSkillDeck?.supportCardIds || existing.projectSkillDeck.supportCardIds)],
        updatedAt: patch.projectSkillDeck?.updatedAt ?? existing.projectSkillDeck.updatedAt,
      },
      favoriteTechniqueIds: [...new Set(patch.favoriteTechniqueIds ?? existing.favoriteTechniqueIds)],
      projectTechniqueIds: [...new Set(patch.projectTechniqueIds ?? existing.projectTechniqueIds ?? [])],
      guardrailIds: patch.guardrailIds || existing.guardrailIds,
      capabilityMemberships: (patch.capabilityMemberships || existing.capabilityMemberships || []).map((membership) => ({ ...membership })),
    },
  };
}

export function upsertCapabilityMembership(
  profile: ProjectCapabilityProfile | null | undefined,
  membership: CapabilityMembership,
): ProjectCapabilityProfile {
  const base = profile || {
    version: 3 as const,
    projectSkillDeck: { supportCardIds: [], updatedAt: 0 },
    favoriteTechniqueIds: [],
    projectTechniqueIds: [],
    capabilityMemberships: [],
  };
  const key = `${membership.sourceId}\u0000${membership.sourceVersion}`;
  const memberships = (base.capabilityMemberships || [])
    .filter((item) => `${item.sourceId}\u0000${item.sourceVersion}` !== key)
    .map((item) => ({ ...item }));
  memberships.push({ ...membership });
  return { ...base, capabilityMemberships: memberships };
}

export type ProjectDeckTarget = 'main' | 'support';

export function getProjectDeckIds(profile: ProjectCapabilityProfile | null | undefined): string[] {
  if (!profile) return [];
  const ids = [profile.projectSkillDeck.mainCardId, ...profile.projectSkillDeck.supportCardIds];
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

export function addCardToProjectDeck(
  profile: ProjectCapabilityProfile | null | undefined,
  cardId: string,
  target?: ProjectDeckTarget,
  replaceId?: string,
): { profile: ProjectCapabilityProfile; requiresReplacement: boolean } {
  const base = profile || {
    version: 3 as const,
    projectSkillDeck: { supportCardIds: [], updatedAt: 0 },
    favoriteTechniqueIds: [],
    projectTechniqueIds: [],
  };
  const current = getProjectDeckIds(base);
  if (current.includes(cardId)) return { profile: base, requiresReplacement: false };
  if (current.length >= 3 && !replaceId) return { profile: base, requiresReplacement: true };

  let mainCardId = base.projectSkillDeck.mainCardId;
  let supportCardIds = [...base.projectSkillDeck.supportCardIds];
  if (replaceId) {
    if (mainCardId === replaceId) mainCardId = undefined;
    supportCardIds = supportCardIds.filter((id) => id !== replaceId);
  }
  if (target === 'support' || (!target && mainCardId)) {
    if (supportCardIds.length >= 2) return { profile: base, requiresReplacement: true };
    supportCardIds.push(cardId);
  } else {
    mainCardId = cardId;
  }
  return {
    requiresReplacement: false,
    profile: {
      ...base,
      projectSkillDeck: { mainCardId, supportCardIds: [...new Set(supportCardIds)], updatedAt: Date.now() },
    },
  };
}

export function getMountedRoleSlotState(loadout: MountedSkillLoadoutItem[] = [], skills: Array<Pick<Skill, 'id' | 'name'>> = []) {
  const byId = new Map(skills.map((skill) => [skill.id, skill.name]));
  return {
    planner: byId.get(loadout.find((entry) => entry.slot === 0)?.skillId || '') || '空槽',
    writer: byId.get(loadout.find((entry) => entry.slot === 1)?.skillId || '') || '空槽',
    critic: byId.get(loadout.find((entry) => entry.slot === 2)?.skillId || '') || '空槽',
  };
}

export function canEquipSavedSkill(skill: Pick<Skill, 'id' | 'parentSkillId'>): boolean {
  return getRoleSkillSlots(skill.parentSkillId || skill.id).length > 0;
}

export function getCapabilityDisplayText(text: string, sourceType: CuratedProductSkill['sourceType']): string {
  const clean = text.trim();
  if (!/(购买|会员|付费|无限调用|订阅|充值)/.test(clean)) return clean;
  return sourceType === 'licensed' ? '授权增强能力，具体效果以实际运行结果为准。' : sourceType === 'built-in' ? '官方内置能力，具体效果以实际运行结果为准。' : '广场共享能力，具体效果以实际运行结果为准。';
}

export function getRoleSkillSlots(assetId: string): RoleSkillSlot[] {
  const manifest = getCatalogCapabilityManifest(assetId);
  if (!manifest || manifest.kind !== 'role-skill') return [];
  return manifest.stages.filter((stage): stage is RoleSkillSlot => stage === 'planner' || stage === 'writer' || stage === 'critic');
}

export function buildRoleSkillLoadout(current: MountedSkillLoadoutItem[], skillId: string, slot: RoleSkillSlot): MountedSkillLoadoutItem[] {
  const slotIndex = ROLE_SLOT_INDEX[slot];
  return [...current.filter((entry) => entry.slot !== slotIndex && entry.skillId !== skillId), {
    slot: slotIndex, skillId, weight: 1, lockedDimensions: [],
  }].sort((left, right) => left.slot - right.slot);
}

export function isCapabilityRunnable(asset: Pick<CuratedProductSkill, 'id'>): boolean {
  return getCatalogCapabilityManifest(asset.id)?.runtimeStatus === 'active';
}

export function getCapabilityManifest(asset: Pick<CuratedProductSkill, 'id'>): CapabilityManifestEntry | undefined {
  return getCatalogCapabilityManifest(asset.id);
}

export function getCapabilityScope(manifest: CapabilityManifestEntry): CapabilityManifestEntry['allowedScopes'][number] {
  return manifest.allowedScopes[0] || 'single-run';
}
