import { validateMountedSkillLoadout } from '../../capabilities/manifest';
import { normalizeProjectPreferenceProfile } from '../../../shared/lib/project-preference-profile';

// Novel entity preflight extracted from the /api/db proxy closure (was ~110
// inline lines in server/routes/db.ts): skill-loadout parent inheritance,
// mounted-loadout validation, and the commercial/quota entitlement boundary.

export class DbEntitlementBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbEntitlementBoundaryError';
  }
}

interface PreflightContext {
  getNovel: (novelId: string) => { projectPreferenceProfile?: unknown } | undefined;
  getSkill: (skillId: string) => { parentSkillId?: string } | undefined;
}

function quotaLimitsEqual(left: unknown, right: unknown): boolean {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return left === right;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
  return [...keys].every((key) => leftRecord[key] === rightRecord[key]);
}

/**
 * Validate and normalize a novel entity arriving through the db proxy before
 * it reaches the persistence layer. Mutates `entity` in place exactly as the
 * original inline logic did; throws DbEntitlementBoundaryError on entitlement
 * abuse. `updateNovelId` is the proxy arg[0] for updateNovel (the entity is
 * arg[1]); for creation methods the novel id lives inside the entity.
 */
export function preflightNovelEntity(
  method: 'createNovel' | 'updateNovel' | 'createNovelWithChapter',
  entity: Record<string, unknown>,
  updateNovelId: string | undefined,
  ctx: PreflightContext,
): void {
  const mountedSkillLoadout = Array.isArray(entity?.mountedSkillLoadout)
    ? entity.mountedSkillLoadout.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const skillId = (entry as Record<string, unknown>).skillId;
      if (typeof skillId !== 'string') return entry;
      const skill = ctx.getSkill(skillId);
      return skill?.parentSkillId
        ? { ...(entry as Record<string, unknown>), parentSkillId: skill.parentSkillId }
        : entry;
    })
    : entity?.mountedSkillLoadout;
  validateMountedSkillLoadout(mountedSkillLoadout);

  const profile = entity?.projectPreferenceProfile;
  const hasQuotaLimits = profile && typeof profile === 'object'
    && Object.prototype.hasOwnProperty.call(profile, 'quotaLimits');
  const commercialMode = profile && typeof profile === 'object'
    ? (profile as Record<string, unknown>).commercialMode
    : undefined;
  const quotaLimits = profile && typeof profile === 'object'
    ? (profile as Record<string, unknown>).quotaLimits
    : undefined;

  if (method === 'createNovel' || method === 'createNovelWithChapter') {
    if (profile && typeof profile === 'object') {
      entity.projectPreferenceProfile = normalizeProjectPreferenceProfile(profile);
    }
    if (commercialMode === 'paid' || hasQuotaLimits) {
      throw new DbEntitlementBoundaryError('客户端不得设置付费权益');
    }
    return;
  }

  const existing = ctx.getNovel(updateNovelId || '');
  const existingProfile = existing?.projectPreferenceProfile as Record<string, unknown> | undefined;
  const existingIsPaid = existingProfile?.commercialMode === 'paid';
  if (!existingIsPaid && commercialMode === 'paid') {
    throw new DbEntitlementBoundaryError('客户端不得修改付费权益');
  }
  if (existingIsPaid && commercialMode !== undefined && commercialMode !== 'paid') {
    throw new DbEntitlementBoundaryError('付费作品权益不可降级或覆盖');
  }
  if (hasQuotaLimits && !quotaLimitsEqual(quotaLimits, existingProfile?.quotaLimits)) {
    throw new DbEntitlementBoundaryError(existingIsPaid
      ? '付费作品权益不可降级或覆盖'
      : '客户端不得修改付费权益');
  }
  if (profile && typeof profile === 'object') {
    const incomingProfile = profile as Record<string, unknown>;
    const mergedProfile: Record<string, unknown> = {
      ...existingProfile,
      ...incomingProfile,
      ...(existingIsPaid ? { commercialMode: 'paid' } : {}),
      ...(existingProfile && Object.prototype.hasOwnProperty.call(existingProfile, 'quotaLimits')
        ? { quotaLimits: existingProfile.quotaLimits }
        : {}),
    };
    if (incomingProfile.weights && typeof incomingProfile.weights === 'object') {
      mergedProfile.weights = {
        ...(existingProfile?.weights && typeof existingProfile.weights === 'object'
          ? existingProfile.weights as Record<string, unknown>
          : {}),
        ...incomingProfile.weights as Record<string, unknown>,
      };
    }
    entity.projectPreferenceProfile = normalizeProjectPreferenceProfile(mergedProfile);
  }
}