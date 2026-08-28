import type {
  MountedSkillLoadoutItem,
  Skill,
  SkillCompositionProfile,
  SkillDimension,
  SkillUsageRecord,
  SkillUsageStats,
} from '../types';
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

export interface SkillLoadoutMigrationInput {
  profileVersion?: number;
  mountedSkillLoadout?: MountedSkillLoadoutItem[];
  mountedSkillIds?: string[];
}

export interface SkillLoadoutMigrationResult {
  loadout: MountedSkillLoadoutItem[];
  pendingSkillIds: string[];
}

/** Preserve explicit v2 emptiness; only migrate unambiguous legacy data. */
export function resolveSkillLoadout(input: SkillLoadoutMigrationInput): SkillLoadoutMigrationResult {
  const entries = input.mountedSkillLoadout || [];
  if (input.profileVersion === 2) {
    if (entries.length === 0) return { loadout: [], pendingSkillIds: [] };

    const slotCounts = new Map<number, number>();
    const skillCounts = new Map<string, number>();
    for (const entry of entries) {
      slotCounts.set(entry.slot, (slotCounts.get(entry.slot) || 0) + 1);
      skillCounts.set(entry.skillId, (skillCounts.get(entry.skillId) || 0) + 1);
    }
    const pending = new Set<string>();
    const loadout: MountedSkillLoadoutItem[] = [];
    for (const entry of entries) {
      const valid = entry.slot >= 0 && entry.slot <= 2 &&
        slotCounts.get(entry.slot) === 1 && skillCounts.get(entry.skillId) === 1;
      if (valid) loadout.push(entry);
      else pending.add(entry.skillId);
    }
    return { loadout, pendingSkillIds: [...pending] };
  }
  const legacyIds = input.mountedSkillIds || [];
  if (entries.length === 0 && legacyIds.length > 0) {
    return {
      loadout: coerceMountedSkillLoadout(legacyIds),
      pendingSkillIds: [...new Set(legacyIds)],
    };
  }
  const validEntries = entries.filter((entry) => entry.slot >= 0 && entry.slot <= 2);
  const slotZero = validEntries.filter((entry) => entry.slot === 0);
  const uniqueSlots = new Set(validEntries.map((entry) => entry.slot)).size === validEntries.length;
  const duplicateIds = entries
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.skillId === entry.skillId) !== index)
    .map((entry) => entry.skillId);
  // A legacy slot 0 is safe only when it is the sole usable slot. Never silently
  // reinterpret ambiguous 1-based or malformed records.
  if (slotZero.length === 1 && uniqueSlots && duplicateIds.length === 0 && validEntries.length > 0 && validEntries.length === entries.length) {
    return {
      loadout: validEntries,
      pendingSkillIds: [...new Set(legacyIds.filter((skillId) => !validEntries.some((entry) => entry.skillId === skillId)))],
    };
  }
  return {
    loadout: [],
    pendingSkillIds: [...new Set([
      ...entries.map((entry) => entry.skillId),
      ...legacyIds,
      ...duplicateIds,
    ])],
  };
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
      conflicts.length > 0 ? ['考虑替换存在作用冲突的能力卡'] : [],
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

export interface SkillScoreChannels {
  /** @deprecated Compatibility projection; use coldStartEvidence. */
  coldStartScore: number | null;
  evidenceStabilityScore: number | null;
  observedPerformance: { score: number; sampleSize: number } | null;
  /** Four independent P4 channels; no aggregate score is derived. */
  governanceGate: SkillGovernanceResult;
  coldStartEvidence: { score: number | null; sampleSize: number; coverage: number; label: '冷启动评分' };
  currentContextFit: { score: number; signalCount: number; sampleSize: number } | null;
  observedUsageFeedback: { score: number; sampleSize: number } | null;
}

export interface SkillGovernanceResult {
  status: 'ready' | 'review-required';
  reasons: string[];
}

/** Check executable metadata and rule completeness without turning governance into a score. */
export function evaluateSkillGovernance(skill: Partial<Skill>): SkillGovernanceResult {
  const reasons: string[] = [];
  if (!skill.id) reasons.push('缺少能力卡标识');
  if (!skill.name?.trim()) reasons.push('缺少能力卡名称');
  if (!skill.description?.trim()) reasons.push('缺少能力卡说明');
  if (!skill.primaryDimension) reasons.push('未声明主维度');
  if (!skill.dimensionTags || skill.dimensionTags.length === 0) reasons.push('未声明维度标签');
  const hasRule = [skill.style, skill.pacing, skill.characterTraits, skill.worldBuilding,
    skill.plotPattern, skill.foreshadowing, ...(skill.corePatterns || []), ...(skill.fewShots || [])]
    .some((value) => typeof value === 'string' && value.trim().length > 0);
  if (!hasRule) reasons.push('缺少可执行规则或示例');
  return { status: reasons.length === 0 ? 'ready' : 'review-required', reasons };
}

function normalizeScore(value: number | null | undefined): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value as number)));
}

function hasValidUsageStats(stats: SkillUsageStats | null | undefined): stats is SkillUsageStats {
  if (!stats || !Number.isInteger(stats.mountedCount) || stats.mountedCount <= 0) return false;
  const counts = [stats.acceptedCount, stats.rejectedCount, stats.revisedCount];
  return counts.every((count) => Number.isInteger(count) && count >= 0) && Number.isFinite(stats.averageFitScore);
}

/** Keep extraction evidence and real usage feedback as separate decision channels. */
export function getSkillScoreChannels(skill: Partial<Skill>, context?: {
  requiredDimensions?: SkillDimension[];
  chapterSignals?: SkillDimension[];
  loadout?: Partial<Skill>[];
  assetKind?: 'skill-card' | 'flow' | 'technique';
}): SkillScoreChannels {
  const executionScore = normalizeScore(skill.executionScore);
  const evidenceStabilityScore = normalizeScore(skill.stabilityScore);
  const coldStartScore = executionScore;
  const evidenceCoverage = new Set((skill.evidenceMoments || []).filter((value) => typeof value === 'string' && value.trim().length > 0)).size;
  const stats = skill.usageStats;
  const signalCount = new Set((context?.chapterSignals || [])).size;
  const currentContextFit = context?.chapterSignals
    ? { score: calculateSkillFitScore({
      requiredDimensions: context.requiredDimensions || skill.dimensionTags || [],
      chapterSignals: context.chapterSignals,
      loadout: context.loadout || [skill],
    }).breakdown.contextScore, signalCount, sampleSize: signalCount }
    : null;
  const governanceGate = context?.assetKind && context.assetKind !== 'skill-card'
    ? { status: 'review-required' as const, reasons: ['非能力卡资产不进入能力卡评分通道'] }
    : evaluateSkillGovernance(skill);
  const base = {
    coldStartScore,
    evidenceStabilityScore,
    observedPerformance: null as { score: number; sampleSize: number } | null,
    governanceGate,
    coldStartEvidence: { score: coldStartScore, sampleSize: evidenceCoverage, coverage: evidenceCoverage, label: '冷启动评分' as const },
    currentContextFit,
    observedUsageFeedback: null as { score: number; sampleSize: number } | null,
  };
  if (!hasValidUsageStats(stats)) {
    return base;
  }

  const explicitFeedback = normalizeScore(skill.feedbackScore);
  const score = explicitFeedback ?? normalizeScore(calculateFeedbackScore(stats)) ?? 0;
  const observed = { score, sampleSize: stats.mountedCount };
  return { ...base, observedPerformance: observed, observedUsageFeedback: observed };
}
