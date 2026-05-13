import type {
  FitScoreExplanation,
  PreferenceFeedbackAction,
  ProjectPreferenceProfile,
  Skill,
  SkillDimension,
} from '../types';
import { collectSkillRoleKeys, normalizeRoleKey, type SkillRoleKey } from './skill-language';

const DEFAULT_WEIGHTS = {
  styleWeight: 0.5,
  characterWeight: 0.5,
  worldWeight: 0.5,
  plotWeight: 0.5,
  pacingWeight: 0.5,
};

function uniqueDimensions(skills: Skill[]): SkillDimension[] {
  return Array.from(new Set(skills.flatMap((skill) => skill.dimensionTags || []))) as SkillDimension[];
}

function uniqueRoles(skills: Skill[]): SkillRoleKey[] {
  return Array.from(new Set(skills.flatMap((skill) => collectSkillRoleKeys(skill))));
}

export function getAcceptedPreferenceRoles(profile: ProjectPreferenceProfile): SkillRoleKey[] {
  const roles = new Set<SkillRoleKey>();

  profile.acceptedDimensions.forEach((dimension) => {
    const normalized = normalizeRoleKey(dimension);
    if (normalized) roles.add(normalized);
  });

  if (profile.weights.styleWeight >= 0.8) roles.add('lead-style');
  if (profile.weights.characterWeight >= 0.8) roles.add('character-drive');
  if (profile.weights.plotWeight >= 0.8) roles.add('plot-advance');

  return Array.from(roles);
}

export function getRejectedPreferenceRoles(profile: ProjectPreferenceProfile): SkillRoleKey[] {
  const roles = new Set<SkillRoleKey>();

  profile.rejectedDimensions.forEach((dimension) => {
    const normalized = normalizeRoleKey(dimension);
    if (normalized) roles.add(normalized);
  });

  if (profile.weights.worldWeight <= 0.3) roles.add('world-rule');
  if (profile.weights.pacingWeight <= 0.3) roles.add('pace-control');

  return Array.from(roles);
}

export function buildProjectPreferenceSnapshot({
  acceptedSkills,
  rejectedSkills,
}: {
  acceptedSkills: Skill[];
  rejectedSkills: Skill[];
}): ProjectPreferenceProfile {
  const acceptedDimensions = uniqueDimensions(acceptedSkills);
  const rejectedDimensions = uniqueDimensions(rejectedSkills);
  const acceptedRoles = uniqueRoles(acceptedSkills);
  const rejectedRoles = uniqueRoles(rejectedSkills);

  return {
    tags: [
      acceptedRoles.includes('lead-style') ? '更重主笔文风统一' : '',
      acceptedRoles.includes('character-drive') ? '更重人物驱动张力' : '',
      acceptedRoles.includes('plot-advance') ? '更重剧情推进力度' : '',
      rejectedRoles.includes('pace-control') ? '不偏慢节奏铺陈' : '',
    ].filter(Boolean),
    weights: {
      styleWeight: acceptedRoles.includes('lead-style') ? 0.8 : DEFAULT_WEIGHTS.styleWeight,
      characterWeight: acceptedRoles.includes('character-drive') ? 0.8 : DEFAULT_WEIGHTS.characterWeight,
      worldWeight: rejectedRoles.includes('world-rule') ? 0.3 : DEFAULT_WEIGHTS.worldWeight,
      plotWeight: acceptedRoles.includes('plot-advance') ? 0.8 : DEFAULT_WEIGHTS.plotWeight,
      pacingWeight: rejectedRoles.includes('pace-control') ? 0.3 : DEFAULT_WEIGHTS.pacingWeight,
    },
    acceptedDimensions,
    rejectedDimensions,
    notes: [],
    evidenceCount: acceptedSkills.length + rejectedSkills.length,
  };
}

export function explainFitScoreDelta(input: {
  previousScore: number;
  nextScore: number;
  matchedTraits: string[];
  resolvedConflicts: string[];
  remainingRisks: string[];
}): FitScoreExplanation {
  const delta = input.nextScore - input.previousScore;
  return {
    summary:
      delta >= 0
        ? `这次组合比上次更贴近当前项目偏好，适配分从 ${input.previousScore} 提升到 ${input.nextScore}。`
        : `这次组合与当前项目偏好更远，适配分从 ${input.previousScore} 降到 ${input.nextScore}。`,
    highlights: [
      input.matchedTraits.length ? `更贴近：${input.matchedTraits.join('、')}` : '',
      input.resolvedConflicts.length ? `改善点：${input.resolvedConflicts.join('、')}` : '',
    ].filter(Boolean),
    risks: input.remainingRisks,
  };
}

export function applyPreferenceFeedback(
  profile: ProjectPreferenceProfile,
  input: {
    action: PreferenceFeedbackAction;
    dimension?: SkillDimension;
    note?: string;
  },
): ProjectPreferenceProfile {
  const next: ProjectPreferenceProfile = {
    ...profile,
    acceptedDimensions: [...profile.acceptedDimensions],
    rejectedDimensions: [...profile.rejectedDimensions],
    notes: [...profile.notes],
    weights: { ...profile.weights },
    evidenceCount: profile.evidenceCount + 1,
  };

  if (input.action === 'more-like-me' && input.dimension && !next.acceptedDimensions.includes(input.dimension)) {
    next.acceptedDimensions.push(input.dimension);
  }

  if (input.action === 'not-for-me' && input.dimension && !next.rejectedDimensions.includes(input.dimension)) {
    next.rejectedDimensions.push(input.dimension);
  }

  const normalized = normalizeRoleKey(input.dimension);
  if (input.action === 'more-like-me' && normalized === 'lead-style') {
    next.weights.styleWeight = Math.max(next.weights.styleWeight, 0.8);
  }
  if (input.action === 'more-like-me' && normalized === 'character-drive') {
    next.weights.characterWeight = Math.max(next.weights.characterWeight, 0.8);
  }
  if (input.action === 'more-like-me' && normalized === 'plot-advance') {
    next.weights.plotWeight = Math.max(next.weights.plotWeight, 0.8);
  }
  if (input.action === 'not-for-me' && normalized === 'world-rule') {
    next.weights.worldWeight = Math.min(next.weights.worldWeight, 0.3);
  }
  if (input.action === 'not-for-me' && normalized === 'pace-control') {
    next.weights.pacingWeight = Math.min(next.weights.pacingWeight, 0.3);
  }

  if (input.note) {
    next.notes.push(input.note);
  }

  return next;
}
