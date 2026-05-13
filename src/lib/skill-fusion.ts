import type {
  ProjectPreferenceProfile,
  Skill,
  SkillFusionExplanation,
  SkillUsageRecord,
} from '../types';
import { getAcceptedPreferenceRoles, getRejectedPreferenceRoles } from './preference-flywheel';
import { collectSkillRoleKeys } from './skill-language';

export interface FusionSuggestionPair {
  mainSkill: Skill;
  supportSkill: Skill;
  acceptedCoMountCount: number;
}

function collectSkillTraits(skill: Skill): string[] {
  const candidates = [
    skill.style,
    skill.pacing,
    skill.characterTraits,
    skill.worldBuilding,
    skill.plotPattern,
    ...(skill.corePatterns || []),
  ];

  return candidates
    .flatMap((value) => String(value || '').split(/\n+/))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 3);
}

export function buildFusionDraft(mainSkill: Skill, supportSkill: Skill): Skill {
  const now = Date.now();
  const retainedTraits = collectSkillTraits(mainSkill);
  const absorbedTraits = collectSkillTraits(supportSkill);
  const risks = [
    mainSkill.primaryDimension === supportSkill.primaryDimension
      ? '同写作职责叠加可能导致表达过载'
      : '',
    mainSkill.compositionProfile?.conflictTags?.length ||
    supportSkill.compositionProfile?.conflictTags?.length
      ? '请在试驾台确认冲突标签没有放大'
      : '',
  ].filter(Boolean);

  return {
    ...mainSkill,
    id: `${mainSkill.id}-fusion-${supportSkill.id}-${now}`,
    name: `${mainSkill.name} · ${supportSkill.name} 融合版`,
    description: `${mainSkill.name} 为主卡，吸收 ${supportSkill.name} 的增强特征。`,
    version: (mainSkill.version || 1) + 1,
    parentSkillId: mainSkill.id,
    lineageRootId: mainSkill.lineageRootId || mainSkill.id,
    primaryDimension: mainSkill.primaryDimension,
    dimensionTags: Array.from(
      new Set([...(mainSkill.dimensionTags || []), ...(supportSkill.dimensionTags || [])]),
    ),
    stabilityScore: Math.round(
      ((mainSkill.stabilityScore || 0) + (supportSkill.stabilityScore || 0)) / 2,
    ),
    fusionMeta: {
      mainSkillId: mainSkill.id,
      supportSkillId: supportSkill.id,
      retainedTraits,
      absorbedTraits,
      risks,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function explainSkillFusion(input: {
  mainSkillName: string;
  supportSkillName: string;
  retained: string[];
  absorbed: string[];
  risks: string[];
}): SkillFusionExplanation {
  return {
    retained: input.retained,
    absorbed: input.absorbed,
    risks: input.risks,
  };
}

export function shouldSuggestFusion(input: {
  mainSkillId: string;
  supportSkillId: string;
  records: SkillUsageRecord[];
  minimumFitScore: number;
  minimumAcceptedCount: number;
}): boolean {
  const acceptedMatches = input.records.filter(
    (record) =>
      record.userAction === 'accepted' &&
      record.fitScore >= input.minimumFitScore &&
      record.mountedSkillIds.includes(input.mainSkillId) &&
      record.mountedSkillIds.includes(input.supportSkillId),
  );

  return acceptedMatches.length >= input.minimumAcceptedCount;
}

export function pickFusionSuggestionPair(
  mountedSkills: Skill[],
  records: SkillUsageRecord[],
  projectProfile?: ProjectPreferenceProfile,
): FusionSuggestionPair | null {
  if (mountedSkills.length < 2) {
    return null;
  }

  const candidates: FusionSuggestionPair[] = [];

  for (let i = 0; i < mountedSkills.length; i += 1) {
    for (let j = i + 1; j < mountedSkills.length; j += 1) {
      const left = mountedSkills[i];
      const right = mountedSkills[j];
      const acceptedCoMountCount = records.filter(
        (record) =>
          record.userAction === 'accepted' &&
          record.fitScore >= 80 &&
          record.mountedSkillIds.includes(left.id) &&
          record.mountedSkillIds.includes(right.id),
      ).length;

      if (acceptedCoMountCount < 2) continue;

      candidates.push({
        mainSkill:
          (left.stabilityScore || 0) >= (right.stabilityScore || 0) ? left : right,
        supportSkill:
          (left.stabilityScore || 0) >= (right.stabilityScore || 0) ? right : left,
        acceptedCoMountCount,
      });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  function preferenceBoost(pair: FusionSuggestionPair): number {
    if (!projectProfile || projectProfile.evidenceCount < 2) return 0;
    let boost = 0;
    const acceptedRoles = new Set(getAcceptedPreferenceRoles(projectProfile));
    const rejectedRoles = new Set(getRejectedPreferenceRoles(projectProfile));
    const mainRoles = collectSkillRoleKeys(pair.mainSkill);
    const supportRoles = collectSkillRoleKeys(pair.supportSkill);

    mainRoles.forEach((role) => {
      if (acceptedRoles.has(role)) boost += 2;
      if (rejectedRoles.has(role)) boost -= 3;
    });
    supportRoles.forEach((role) => {
      if (acceptedRoles.has(role)) boost += 1;
      if (rejectedRoles.has(role)) boost -= 2;
    });
    return boost;
  }

  return candidates.sort((left, right) => {
    if (right.acceptedCoMountCount !== left.acceptedCoMountCount) {
      return right.acceptedCoMountCount - left.acceptedCoMountCount;
    }

    const leftBoost = preferenceBoost(left);
    const rightBoost = preferenceBoost(right);
    if (rightBoost !== leftBoost) {
      return rightBoost - leftBoost;
    }

    return (
      (right.mainSkill.stabilityScore || 0) +
        (right.supportSkill.stabilityScore || 0) -
      ((left.mainSkill.stabilityScore || 0) +
        (left.supportSkill.stabilityScore || 0))
    );
  })[0];
}
