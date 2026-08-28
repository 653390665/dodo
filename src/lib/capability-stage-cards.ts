import type { CapabilityManifestEntry, CapabilityScope } from '../../shared/types/capability-manifest';
import type { Chapter, ProjectPreferenceProfile, Skill } from '../../shared/types';
import type { DeconstructionCardType } from '../../shared/types/skills';
import { CARD_STAGE_MAP, type CapabilityStage } from '../../shared/types/capability-execution';
import { getCatalogCapabilityManifest } from '../../shared/lib/capability-manifest-catalog';
import { CURATED_PRODUCT_SKILLS, PROMPT_GOVERNANCE_CATALOG } from '../../shared/lib/public-skill-catalog';

export type AuthorFacingCapabilityCardCategory =
  | '文风卡'
  | '结构卡'
  | '世界观卡'
  | '审稿卡'
  | '精修卡'
  | '护栏卡';

const DECONSTRUCTION_CARD_CATEGORY: Record<DeconstructionCardType, AuthorFacingCapabilityCardCategory> = {
  'style-card': '文风卡',
  'hook-card': '结构卡',
  'conflict-card': '结构卡',
  'pacing-card': '结构卡',
  'platform-card': '结构卡',
  'worldview-card': '世界观卡',
  'character-card': '世界观卡',
};

export function getAuthorFacingCapabilityCardCategory(
  capability: Pick<CapabilityManifestEntry, 'kind' | 'output' | 'stages' | 'deconstructionCardType' | 'outputArtifact'> | DeconstructionCardType,
): AuthorFacingCapabilityCardCategory {
  if (typeof capability === 'string') return DECONSTRUCTION_CARD_CATEGORY[capability];
  if (capability.deconstructionCardType) return DECONSTRUCTION_CARD_CATEGORY[capability.deconstructionCardType];
  if (capability.kind === 'guardrail') return '护栏卡';
  if (capability.output === 'transform-preview') return '精修卡';
  if (capability.kind === 'diagnostic' || capability.kind === 'utility' || capability.output === 'diagnostic') return '审稿卡';
  if (capability.outputArtifact === 'worldBibleCandidate' || capability.outputArtifact === 'characterCardCandidate') return '世界观卡';
  if (capability.kind === 'flow' || capability.stages.includes('planner')) return '结构卡';
  return '文风卡';
}

export function getAuthorFacingCapabilityUseHint(category: AuthorFacingCapabilityCardCategory): string {
  if (category === '世界观卡') return '适合：大纲、人设与世界观设定';
  if (category === '结构卡') return '适合：拆解结构、节奏与钩子';
  if (category === '精修卡') return '适合：审稿后生成局部精修预览';
  if (category === '审稿卡') return '适合：写后检查跑偏、重复与逻辑问题';
  if (category === '护栏卡') return '适合：全程守住安全与一致性';
  return '适合：正文风格、口吻与表达';
}

export function getAuthorFacingCapabilityEntryHint(category: AuthorFacingCapabilityCardCategory): string {
  if (category === '世界观卡') return '入口：应用配置后设为作品默认，再回到大纲与设定';
  if (category === '结构卡') return '入口：应用配置后设为作品默认，用于开篇和节奏';
  if (category === '精修卡') return '入口：收藏后可点「应用配置后写入本章规则」或「生成精修预览」';
  if (category === '审稿卡') return '入口：写后直接运行审稿诊断';
  if (category === '护栏卡') return '入口：保存为系统检查候选，应用配置后参与写作与审稿检查';
  return '入口：可设为作品默认统一全文，也可点「用于本章」配置章节表达';
}

export function getAuthorFacingCapabilityDeckHint(
  capability: Pick<CapabilityManifestEntry, 'deconstructionCardType'>,
): string | null {
  return capability.deconstructionCardType ? '入口：先选主卡或辅卡位置，应用配置后用于拆书' : null;
}

export const AUTHOR_FACING_SCOPE_LABELS: Record<CapabilityScope, string> = {
  project: '作品默认',
  chapter: '本章使用',
  'single-run': '仅运行一次',
  system: '系统检查',
};

export function getAuthorFacingCapabilityScopeLabel(scope: CapabilityScope): string {
  return AUTHOR_FACING_SCOPE_LABELS[scope];
}

export function getAuthorFacingCapabilityActionLabel(
  capability: Pick<CapabilityManifestEntry, 'action' | 'allowedScopes' | 'sideEffect'> & Partial<Pick<CapabilityManifestEntry, 'output'>>,
  preferredScope?: CapabilityScope,
): string | undefined {
  if (preferredScope && !capability.allowedScopes.includes(preferredScope)) return undefined;
  if (preferredScope === 'project') return '应用配置后设为作品默认';
  if (preferredScope === 'system') return '保存为系统检查候选';
  if (preferredScope === 'single-run') {
    if (capability.output === 'transform-preview') return '生成精修预览';
    if (capability.action === 'run-diagnostic') return '运行审稿诊断';
    return '运行一次，不保存配置';
  }
  if (preferredScope === 'chapter') return capability.output === 'transform-preview' ? '应用配置后写入本章规则' : '用于本章';
  if (capability.output === 'transform-preview' && capability.allowedScopes.includes('single-run')) return '生成精修预览';
  if (capability.action === 'run-diagnostic') return '运行审稿诊断';
  if (capability.action === 'run-utility' || capability.action === 'preview-transform' || capability.action === 'use-this-time') return '运行一次，不保存配置';
  if (capability.action === 'automatic' || capability.allowedScopes.includes('system')) return '保存为系统检查候选';
  if (capability.sideEffect === 'configuration' && capability.allowedScopes.includes('project')) return '应用配置后设为作品默认';
  return '用于本章';
}

export function getAuthorFacingCapabilityActionHint(
  capability: Pick<CapabilityManifestEntry, 'action' | 'allowedScopes' | 'sideEffect' | 'kind'> & Partial<Pick<CapabilityManifestEntry, 'output' | 'deconstructionCardType' | 'outputArtifact'>>,
): string {
  if (capability.allowedScopes.includes('system') || capability.action === 'automatic') return '护栏卡先保存为系统检查候选；应用配置后参与写作与审稿检查，凭证在生成或审稿结果中查看。';
  if (capability.deconstructionCardType || capability.kind === 'skill-card') return '卡组位置：先选主卡或辅卡，应用配置后写入作品卡组。';
  if (capability.outputArtifact === 'worldBibleCandidate' || capability.outputArtifact === 'characterCardCandidate') return '配置到作品：应用配置后写入设定素材，并前往世界观继续整理。';
  if ((capability.output === 'outline-candidate' || capability.output === 'artifact-candidate') && capability.allowedScopes.includes('project')) return '配置到作品：应用配置后写入大纲技法，并前往大纲继续使用。';
  if (capability.output === 'transform-preview') return '应用配置后可写入本章规则；运行一次只生成精修预览。';
  if (capability.action === 'run-diagnostic' || capability.action === 'run-utility' || capability.sideEffect === 'none') return '运行一次：只生成诊断或辅助结果，不改正文。';
  if (capability.allowedScopes.includes('project') && capability.allowedScopes.includes('chapter')) return '可设为作品默认统一全文，也可只用于当前章节。';
  if (capability.allowedScopes.includes('chapter')) return '应用配置后只影响当前章节写作。';
  if (capability.allowedScopes.includes('project')) return '配置到作品：应用配置后写入作品默认配置。';
  return '运行一次：本次使用，不改变作品配置。';
}

function uniqueIds(ids: Array<string | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim()))];
}

function getOptionalStringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueIds(value.filter((id): id is string => typeof id === 'string'));
}

const GOVERNED_STAGE_MAP = {
  discovery: 'planner',
  foundation: 'planner',
  planning: 'planner',
  drafting: 'writer',
  polish: 'writer',
  review: 'critic',
} as const;

function cardTypeSupportsStage(cardType: DeconstructionCardType, stage: CapabilityStage): boolean {
  return (CARD_STAGE_MAP[cardType] as readonly CapabilityStage[]).includes(stage);
}

function isWriterCard(
  id: string,
  librarySkills: Array<Pick<Skill, 'id' | 'name' | 'deconstructionCardType'>>,
  scope: 'project' | 'chapter',
): boolean {
  const manifest = getCatalogCapabilityManifest(id);
  if (manifest) {
    return manifest.kind === 'skill-card'
      && manifest.runtimeStatus === 'active'
      && manifest.allowedScopes.includes(scope)
      && manifest.stages.includes('writer');
  }
  const cardType = librarySkills.find((skill) => skill.id === id)?.deconstructionCardType;
  return Boolean(cardType && cardTypeSupportsStage(cardType, 'writer'));
}

function resolveTechniqueManifestId(id: string, profile: ProjectPreferenceProfile['capabilityProfile']): string {
  const direct = getCatalogCapabilityManifest(id);
  if (direct?.kind === 'technique') return id;
  return profile?.capabilityMemberships?.find((membership) => membership.persistedSkillId === id)?.sourceId || id;
}

function isWriterTechnique(id: string, requiredScope?: 'chapter'): boolean {
  const manifest = getCatalogCapabilityManifest(id);
  return Boolean(
    manifest?.kind === 'technique'
      && manifest.runtimeStatus === 'active'
      && (!requiredScope || manifest.allowedScopes.includes(requiredScope))
      && manifest.stages.includes('writer'),
  );
}

function getWriterGuardrailIds(configuredIds: string[]): string[] {
  const runtimeReady = (id: string) => {
    const asset = PROMPT_GOVERNANCE_CATALOG.find((candidate) => candidate.id === id);
    return asset
      && asset.isRuntimeReady
      && asset.runtimeStatus === 'active'
      && asset.sanitizationStatus === 'runtime-ready'
      && (asset.deconstructionCardType
        ? cardTypeSupportsStage(asset.deconstructionCardType, 'writer')
        : GOVERNED_STAGE_MAP[asset.stage] === 'writer');
  };
  const defaults = PROMPT_GOVERNANCE_CATALOG
    .filter((asset) => asset.placementTier === 'core-default' && runtimeReady(asset.id))
    .map((asset) => asset.id);
  const configured = configuredIds.filter((id) => {
    const asset = PROMPT_GOVERNANCE_CATALOG.find((candidate) => candidate.id === id);
    return asset?.primaryCategory === 'quality-guardrail' && runtimeReady(id);
  });
  return uniqueIds([...defaults, ...configured]);
}

export function resolveCapabilityDisplayName(
  id: string | undefined,
  librarySkills: Array<Pick<Skill, 'id' | 'name'>>,
): string {
  if (!id) return '未设置';
  return librarySkills.find((skill) => skill.id === id)?.name
    || CURATED_PRODUCT_SKILLS.find((asset) => asset.id === id)?.title
    || PROMPT_GOVERNANCE_CATALOG.find((asset) => asset.id === id)?.title
    || id;
}

export function buildEffectiveCapabilitySummary(input: {
  projectPreferenceProfile: ProjectPreferenceProfile;
  currentChapter: Chapter | null;
  librarySkills: Array<Pick<Skill, 'id' | 'name' | 'deconstructionCardType'>>;
  maxNames?: number;
}) {
  const capabilityProfile = input.projectPreferenceProfile.capabilityProfile;
  const projectCardIds = uniqueIds([
    capabilityProfile?.projectSkillDeck.mainCardId,
    ...(capabilityProfile?.projectSkillDeck.supportCardIds || []),
  ]).filter((id) => isWriterCard(id, input.librarySkills, 'project'));
  const chapterCardIds = uniqueIds(input.currentChapter?.workflowMeta?.capabilityState?.overlayCardIds || [])
    .filter((id) => isWriterCard(id, input.librarySkills, 'chapter'));
  const projectTechniqueIds = uniqueIds(capabilityProfile?.projectTechniqueIds ?? capabilityProfile?.favoriteTechniqueIds ?? [])
    .filter((id) => isWriterTechnique(resolveTechniqueManifestId(id, capabilityProfile)));
  const projectTechniqueIdSet = new Set(projectTechniqueIds.map((id) => resolveTechniqueManifestId(id, capabilityProfile)));
  const chapterTechniqueIds = uniqueIds(input.currentChapter?.workflowMeta?.capabilityState?.techniqueIds || [])
    .filter((id) => isWriterTechnique(id, 'chapter'))
    .filter((id) => !projectTechniqueIdSet.has(id));
  const rawCapabilityProfile = capabilityProfile as Record<string, unknown> | undefined;
  const guardrailIds = getWriterGuardrailIds(getOptionalStringIds(rawCapabilityProfile?.guardrailIds || rawCapabilityProfile?.systemGuardrailIds));
  const names = [...projectCardIds, ...chapterCardIds, ...projectTechniqueIds, ...chapterTechniqueIds, ...guardrailIds]
    .map((id) => resolveCapabilityDisplayName(id, input.librarySkills))
    .filter(Boolean);
  const maxNames = input.maxNames ?? 5;

  return {
    projectDefaultCount: projectCardIds.length,
    chapterCount: chapterCardIds.length,
    projectTechniqueCount: projectTechniqueIds.length,
    chapterTechniqueCount: chapterTechniqueIds.length,
    systemGuardrailCount: guardrailIds.length,
    guardrailIds,
    names: names.slice(0, maxNames),
    overflowCount: Math.max(0, names.length - maxNames),
    summaryText: `作品默认 ${projectCardIds.length} · 本章 ${chapterCardIds.length} · 作品技法 ${projectTechniqueIds.length} · 本章技法 ${chapterTechniqueIds.length} · 系统护栏 ${guardrailIds.length}`,
  };
}
