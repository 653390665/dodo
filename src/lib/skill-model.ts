import type {
  MountedSkillLoadoutItem,
  Skill,
  SkillCompositionProfile,
  SkillDimension,
  SkillUsageRecord,
  SkillUsageStats,
} from '../../shared/types';
import { collectSkillRoleKeys, normalizeRoleKey, type SkillRoleKey } from './skill-language';

const DEFAULT_PROFILE: SkillCompositionProfile = {
  styleWeight: 0.5,
  characterWeight: 0.5,
  worldWeight: 0.5,
  powerWeight: 0.5,
  plotWeight: 0.5,
  pacingWeight: 0.5,
  conflictTags: [],
  blendHints: [],
};

export interface SkillConflict {
  leftId: string;
  rightId: string;
  reason: string;
}

export interface SkillFitResult {
  totalScore: number;
  breakdown: {
    coverageScore: number;
    contextScore: number;
    stabilityScore: number;
    conflictPenalty: number;
  };
  conflicts: SkillConflict[];
  recommendations: string[];
}

function getProfile(skill: Partial<Skill>): SkillCompositionProfile {
  return {
    ...DEFAULT_PROFILE,
    ...(skill.compositionProfile || {}),
  };
}

function collectCoveredResponsibilities(skill: Partial<Skill>): Set<SkillRoleKey> {
  return new Set(collectSkillRoleKeys(skill));
}

export function coerceMountedSkillLoadout(
  mountedSkillIds: string[] | undefined,
): MountedSkillLoadoutItem[] {
  return (mountedSkillIds || []).slice(0, 3).map((skillId, slot) => ({
    slot,
    skillId,
    weight: 1,
    lockedDimensions: [],
  }));
}

export function detectSkillConflicts(skills: Partial<Skill>[]): SkillConflict[] {
  const conflicts: SkillConflict[] = [];

  for (let i = 0; i < skills.length; i += 1) {
    for (let j = i + 1; j < skills.length; j += 1) {
      const left = skills[i];
      const right = skills[j];
      if (!left.id || !right.id) continue;

      const leftProfile = getProfile(left);
      const rightProfile = getProfile(right);
      const sharedDimensions = (left.dimensionTags || []).filter((dimension) =>
        (right.dimensionTags || []).includes(dimension),
      );

      const hasExplicitConflict =
        leftProfile.conflictTags.length > 0 || rightProfile.conflictTags.length > 0;
      const isStyleCollision =
        left.primaryDimension === 'style' &&
        right.primaryDimension === 'style' &&
        hasExplicitConflict;

      if (sharedDimensions.length > 0 && isStyleCollision) {
        conflicts.push({
          leftId: left.id,
          rightId: right.id,
          reason: `shared-style-dimensions:${sharedDimensions.join(',')}`,
        });
      }
    }
  }

  return conflicts;
}

export function calculateSkillFitScore(args: {
  requiredDimensions: SkillDimension[];
  chapterSignals: SkillDimension[];
  loadout: Partial<Skill>[];
}): SkillFitResult {
  const covered = new Set<SkillRoleKey>();
  for (const skill of args.loadout) {
    for (const role of collectCoveredResponsibilities(skill)) {
      covered.add(role);
    }
  }

  const matchedRequired = args.requiredDimensions.filter((dimension) => {
    const role = normalizeRoleKey(dimension);
    return role ? covered.has(role) : false;
  });
  const matchedSignals = args.chapterSignals.filter((dimension) => {
    const role = normalizeRoleKey(dimension);
    return role ? covered.has(role) : false;
  });
  const conflicts = detectSkillConflicts(args.loadout);
  const stabilityAverage =
    args.loadout.length > 0
      ? args.loadout.reduce((sum, skill) => sum + (skill.stabilityScore || 0), 0) /
        args.loadout.length
      : 0;

  const coverageScore = matchedRequired.length / Math.max(args.requiredDimensions.length, 1);
  const contextScore = matchedSignals.length / Math.max(args.chapterSignals.length, 1);
  const stabilityScore = stabilityAverage / 100;
  const conflictPenalty = conflicts.length * 0.12;
  const totalScore = Math.max(
    0,
    Math.min(
      1,
      coverageScore * 0.45 + contextScore * 0.25 + stabilityScore * 0.3 - conflictPenalty,
    ),
  );

  return {
    totalScore: Math.round(totalScore * 100),
    breakdown: {
      coverageScore: Math.round(coverageScore * 100),
      contextScore: Math.round(contextScore * 100),
      stabilityScore: Math.round(stabilityScore * 100),
      conflictPenalty: Math.round(conflictPenalty * 100),
    },
    conflicts,
    recommendations:
      conflicts.length > 0 ? ['考虑替换存在职责冲突的卡牌'] : [],
  };
}

export function summarizeUsageStats(records: SkillUsageRecord[]): SkillUsageStats {
  const mountedCount = records.length;
  const acceptedCount = records.filter((record) => record.userAction === 'accepted').length;
  const rejectedCount = records.filter((record) => record.userAction === 'rejected').length;
  const revisedCount = records.filter((record) => record.userAction === 'revised').length;
  const averageFitScore =
    mountedCount > 0
      ? records.reduce((sum, record) => sum + record.fitScore, 0) / mountedCount
      : 0;

  return {
    mountedCount,
    acceptedCount,
    rejectedCount,
    revisedCount,
    averageFitScore,
  };
}

export function calculateFeedbackScore(stats: SkillUsageStats | null | undefined): number {
  if (!stats || stats.mountedCount === 0) {
    return 50;
  }

  const acceptRatio = stats.acceptedCount / stats.mountedCount;
  const reviseRatio = stats.revisedCount / stats.mountedCount;
  const rejectRatio = stats.rejectedCount / stats.mountedCount;
  const fitRatio = Math.max(0, Math.min(1, stats.averageFitScore / 100));

  const score = acceptRatio * 45 + fitRatio * 35 + reviseRatio * 10 - rejectRatio * 20 + 20;
  return Math.max(0, Math.min(100, Math.round(score)));
}
