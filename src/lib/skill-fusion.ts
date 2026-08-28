import type {
  ProjectPreferenceProfile,
  Skill,
  SkillFusionExplanation,
  SkillUsageRecord,
  SkillDimension,
} from '../../shared/types';
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

export interface ResolvedFusionDraft {
  status: 'ready' | 'rejected';
  draft?: Skill;
  risks: string[];
  conflicts: string[];
  errorCode?: 'FUSION_SAME_SOURCE' | 'FUSION_NO_RUNTIME_RULE';
}

export interface FusionResolutionOptions {
  confirmConflicts?: boolean;
}

function isAuthorizedRuntimeCard(skill: Skill): boolean {
  const hasRule = [skill.style, skill.pacing, skill.characterTraits, skill.worldBuilding, skill.plotPattern, skill.foreshadowing, ...(skill.corePatterns || []), ...(skill.fewShots || [])]
    .some((value) => typeof value === 'string' && value.trim().length > 0);
  return Boolean(skill.deconstructionCardType && skill.version > 0
    && !(skill.accessTier === 'paid' && skill.sourceType !== 'licensed')
    && typeof skill.sourceType === 'string'
    && ['built-in', 'licensed', 'plaza', 'book-extracted'].includes(skill.sourceType)
    && (skill as Skill & { isRuntimeReady?: boolean }).isRuntimeReady === true
    && (skill as Skill & { sanitizationStatus?: string }).sanitizationStatus === 'runtime-ready'
    && (skill as Skill & { runtimeStatus?: string }).runtimeStatus === 'active'
    && hasRule);
}

export function isAuthorizedSkillFusionSource(skill: Skill): boolean {
  return Boolean(skill.deconstructionCardType && isAuthorizedRuntimeCard(skill));
}

export function validatePersistedFusionDraft(skill: Skill): string | null {
  const meta = skill.fusionMeta;
  if (skill.sourceBadge !== 'fused' && !meta) return null;
  if (!meta?.mainSkillId || !meta.supportSkillId || meta.mainSkillId === meta.supportSkillId) {
    return '融合卡必须包含两个不同来源能力卡 ID';
  }
  if (!Array.isArray(meta.components) || meta.components.length !== 2
    || meta.components.some((component) => !component?.skillId || !Number.isInteger(component.version) || component.version <= 0)) {
    return '融合卡 components/version 不完整';
  }
  if (!meta.dimensionOwners || Object.keys(meta.dimensionOwners).length === 0) return '融合卡 dimensionOwners 不完整';
  if (!meta.resolvedRules || typeof meta.resolvedRules !== 'object' || !('version' in meta.resolvedRules)) return '融合卡 resolvedRules 不完整';
  const lineage = (meta.resolvedRules as Record<string, unknown>).lineage;
  if (!lineage || typeof lineage !== 'object' || !Array.isArray((lineage as Record<string, unknown>).sources)) return '融合卡 lineage 不完整';
  if ((meta.risks || []).some((risk) => /未确认|unconfirmed/i.test(risk))) return '融合卡存在未确认冲突';
  return null;
}

const DIMENSION_FIELDS: Record<SkillDimension, string[]> = {
  style: ['style', 'sentenceStructure', 'vocabulary', 'imagery', 'bannedWords'],
  character: ['characterTraits'],
  world: ['worldBuilding'],
  power: ['corePatterns', 'bannedElements'],
  plot: ['plotPattern', 'foreshadowing'],
  pacing: ['pacing'],
};

function normalizeRuleValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return typeof value === 'string' ? value.trim() : value;
}

function ruleValues(skill: Skill, dimension: SkillDimension): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of DIMENSION_FIELDS[dimension]) {
    const normalized = normalizeRuleValue((skill as unknown as Record<string, unknown>)[field]);
    if (Array.isArray(normalized) ? normalized.length > 0 : Boolean(normalized)) {
      values[field] = normalized;
    }
  }
  return values;
}

function sortedDimensions(mainSkill: Skill, supportSkill: Skill): SkillDimension[] {
  return Array.from(new Set([
    ...(mainSkill.dimensionTags || []),
    ...(supportSkill.dimensionTags || []),
    mainSkill.primaryDimension,
    supportSkill.primaryDimension,
  ].filter((dimension): dimension is SkillDimension => Boolean(dimension)))).sort();
}

/**
 * Resolve a two-card fusion into a deterministic runtime snapshot. The
 * snapshot carries both source rules and the selected owner for every
 * dimension, so later execution never has to re-read or silently overwrite a
 * source card.
 */
export function buildResolvedFusionDraft(
  mainSkill: Skill,
  supportSkill: Skill,
  now = Date.now(),
  options: FusionResolutionOptions = {},
): ResolvedFusionDraft {
  if (!isAuthorizedRuntimeCard(mainSkill) || !isAuthorizedRuntimeCard(supportSkill)) {
    return { status: 'rejected', risks: ['仅允许运行时就绪且已授权的能力卡融合'], conflicts: [], errorCode: 'FUSION_NO_RUNTIME_RULE' };
  }
  if (!mainSkill.id || !supportSkill.id || mainSkill.id === supportSkill.id) {
    return {
      status: 'rejected',
      risks: [],
      conflicts: [],
      errorCode: 'FUSION_SAME_SOURCE',
    };
  }

  const dimensions = sortedDimensions(mainSkill, supportSkill);
  const dimensionOwners: Partial<Record<SkillDimension, string>> = {};
  const resolvedDimensions: Record<string, unknown> = {};
  const conflicts: string[] = [];
  const risks: string[] = [];

  for (const dimension of dimensions) {
    const mainRules = ruleValues(mainSkill, dimension);
    const supportRules = ruleValues(supportSkill, dimension);
    const mainHasRules = Object.keys(mainRules).length > 0;
    const supportHasRules = Object.keys(supportRules).length > 0;
    if (!mainHasRules && !supportHasRules) continue;

    // The main card owns any dimension it explicitly declares. If it has no
    // concrete rule for that dimension, the support rule may fill the gap,
    // but ownership remains visible and deterministic.
    const owner = mainHasRules || (mainSkill.dimensionTags || []).includes(dimension)
      ? mainSkill.id
      : supportSkill.id;
    dimensionOwners[dimension] = owner;
    if (mainHasRules && supportHasRules && JSON.stringify(mainRules) !== JSON.stringify(supportRules)) {
      conflicts.push(`${dimension} 维度同时存在主卡和辅卡规则，融合候选保留主卡作为规则来源`);
    }
    resolvedDimensions[dimension] = {
      owner,
      main: mainRules,
      support: supportRules,
      effective: mainHasRules ? mainRules : supportRules,
    };
  }

  if (Object.keys(resolvedDimensions).length === 0) {
    return {
      status: 'rejected',
      risks: ['主卡和辅卡均没有可执行规则'],
      conflicts: [],
      errorCode: 'FUSION_NO_RUNTIME_RULE',
    };
  }
  if (conflicts.length > 0 && !options.confirmConflicts) {
    return {
      status: 'rejected',
      risks: ['存在未确认的维度规则冲突'],
      conflicts,
    };
  }
  if (conflicts.length > 0) risks.push('存在维度规则冲突，融合候选保留主卡规则并显示辅卡差异');

  const retainedTraits = collectSkillTraits(mainSkill);
  const absorbedTraits = collectSkillTraits(supportSkill);
  const resolvedRules: Record<string, unknown> = {
    version: 1,
    dimensions: resolvedDimensions,
    lineage: {
      mainSkillId: mainSkill.id,
      supportSkillId: supportSkill.id,
      sources: [mainSkill, supportSkill].map((skill) => ({
        skillId: skill.id,
        version: skill.version,
        parentSkillId: skill.parentSkillId,
        lineageRootId: skill.lineageRootId || skill.id,
        deckGroupId: skill.deckGroupId,
        sourceBadge: skill.sourceBadge,
        sourceType: skill.sourceType,
        deconstructionCardType: skill.deconstructionCardType,
        evidenceCoverage: skill.evidenceCoverage,
        evidenceMoments: [...(skill.evidenceMoments || [])],
      })),
    },
  };

  const draft: Skill = {
    ...mainSkill,
    id: `${mainSkill.id}-fusion-${supportSkill.id}-${now}`,
    name: `${mainSkill.name} · ${supportSkill.name} 融合版`,
    description: `${mainSkill.name} 为主卡，融合 ${supportSkill.name} 的辅卡特征。`,
    version: (mainSkill.version || 1) + 1,
    parentSkillId: mainSkill.id,
    lineageRootId: mainSkill.lineageRootId || mainSkill.id,
    sourceBadge: 'fused',
    dimensionTags: Array.from(new Set([
      ...(mainSkill.dimensionTags || []),
      ...(supportSkill.dimensionTags || []),
    ])),
    stabilityScore: Math.round(((mainSkill.stabilityScore || 0) + (supportSkill.stabilityScore || 0)) / 2),
    fusionMeta: {
      mainSkillId: mainSkill.id,
      supportSkillId: supportSkill.id,
      retainedTraits,
      absorbedTraits,
      risks: [...risks, ...conflicts],
      components: [
        { skillId: mainSkill.id, version: mainSkill.version },
        { skillId: supportSkill.id, version: supportSkill.version },
      ],
      dimensionOwners,
      resolvedRules,
    },
    createdAt: now,
    updatedAt: now,
  };
  return { status: 'ready', draft, risks, conflicts };
}

export function buildFusionDraft(mainSkill: Skill, supportSkill: Skill): Skill | null {
  const now = Date.now();
  const resolved = buildResolvedFusionDraft(mainSkill, supportSkill, now);
  if (resolved.draft) return resolved.draft;

  return null;
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
