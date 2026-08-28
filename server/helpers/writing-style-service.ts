import type { GovernedPromptAsset, Novel, Skill, WritingStyleCandidate, WritingStyleMode, WritingStyleResolution, WritingStyleSourceSummary, ExecutionSnapshot, ProjectExecutionContract, CapabilityStage, ExecutionOverlay, ExecutionGuardrail, RoleSkillSnapshot } from '../../shared/types.js';
import { CARD_STAGE_MAP } from '../../shared/types.js';
import { PROMPT_GOVERNANCE_CATALOG } from '../../shared/lib/prompt-governance-catalog.js';
import { CURATED_PRODUCT_SKILLS } from '../../shared/lib/curated-product-skills.js';
import { resolveSkillLoadout } from '../../shared/lib/skill-model.js';
import * as db from '../lib/db.js';
import { isMonetizationEnabled } from './quota-guard.js';
import { buildSkillsPrompt } from './prompt-helpers.js';
import { resolveCuratedTechniquePrompt, resolveRuntimeCuratedPrompts } from './curated-skill-runtime.js';
import { buildContinuationContextBundle } from '../../shared/lib/continuation-pack.js';
import { getNovelCurrentStepId, SKILL_SERIES_FLOWS } from '../../shared/lib/prompt-governance-catalog.js';
import {
  canonicalWritingStyleFingerprint,
  checkWritingStyleConfirmation,
  resolveWritingStyle,
  type WritingStyleResolution as WritingStyleSnapshot,
} from './writing-style-resolver.js';
import { capabilityManifestFor } from '../capabilities/manifest.js';
import { validateSkillCardForScope, SkillCardValidationError } from '../capabilities/manifest.js';
import type { ExecutionSkillStack, ExecutionTechnique, ExecutionTechniques } from '../../shared/types/capability-execution.js';
import { getDatabaseGeneration } from '../lib/db-instance.js';

export interface WritingStyleRequestInput {
  chapterId?: string;
  databaseGeneration?: number;
  mode?: WritingStyleMode;
  continuationPackId?: string;
  sessionCardIds?: string[];
}

export class WritingStyleRequestError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: string,
    message: string,
    readonly sessionCardId?: string,
  ) {
    super(message);
    this.name = 'WritingStyleRequestError';
  }
}

export interface ResolvedWritingStyleRequest {
  novel: Novel;
  snapshot: WritingStyleSnapshot;
  resolution: WritingStyleResolution;
  candidates: WritingStyleCandidate[];
  writerPrompt: string;
  plannerPrompt: string;
  stageSkills: { planner: Skill[]; writer: Skill[]; critic: Skill[] };
  criticPrompt: string;
  executionSnapshot: ExecutionSnapshot;
}

const MODE_LABELS: Record<WritingStyleMode, string> = {
  default: '系统默认笔调',
  'skill-deck': '作品卡组优先',
  'writer-skill': '主笔优先',
  'continuation-pack': '资料包优先',
  blend: '融合写法',
};

const WRITER_SESSION_CARD_TYPES = new Set(['style-card', 'pacing-card', 'platform-card']);

interface RuntimeSessionAsset {
  id: string;
  title: string;
  template: string;
  deconstructionCardType: NonNullable<GovernedPromptAsset['deconstructionCardType']>;
  source?: 'project' | 'chapter';
  version: string | number;
  sourceBadge: string;
  dimensionOwners: Record<string, string>;
  resolvedRules: Record<string, unknown>;
  lineage: Record<string, unknown>;
}

const SESSION_CARD_TITLES: Record<RuntimeSessionAsset['deconstructionCardType'], string> = {
  'worldview-card': '世界观拆书卡',
  'character-card': '人物拆书卡',
  'pacing-card': '节奏拆书卡',
  'hook-card': '钩子拆书卡',
  'conflict-card': '冲突拆书卡',
  'style-card': '风格拆书卡',
  'platform-card': '平台拆书卡',
};

const SESSION_RULE_KEYS = [
  'style', 'pacing', 'vocabulary', 'sentenceStructure', 'imagery', 'bannedWords',
  'characterTraits', 'worldBuilding', 'foreshadowing', 'plotPattern', 'corePatterns', 'bannedElements',
] as const;

function isSupportedCardType(value: string | undefined): value is RuntimeSessionAsset['deconstructionCardType'] {
  return Boolean(value && value in CARD_STAGE_MAP);
}

function hasRuntimeRuleValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
}

function projectMethodChain(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  if (typeof source.summary === 'string' && source.summary.trim()) projected.summary = source.summary;
  if (Array.isArray(source.items)) {
    const items = source.items.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const raw = item as Record<string, unknown>;
      const projectedItem: Record<string, unknown> = {};
      if (typeof raw.formalization === 'string' && raw.formalization.trim()) projectedItem.formalization = raw.formalization;
      if (Array.isArray(raw.steps)) {
        const steps = raw.steps.filter((step): step is string => typeof step === 'string' && Boolean(step.trim()));
        if (steps.length > 0) projectedItem.steps = steps;
      }
      if (typeof raw.boundary === 'string' && raw.boundary.trim()) projectedItem.boundary = raw.boundary;
      return Object.keys(projectedItem).length > 0 ? [projectedItem] : [];
    });
    if (items.length > 0) projected.items = items;
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
}

function projectSavedSkill(skill: Skill, novel: Novel): RuntimeSessionAsset {
  try {
    validateSkillCardForScope(skill, 'chapter');
  } catch (error) {
    if (error instanceof SkillCardValidationError) {
      throw new WritingStyleRequestError(400, error.code, error.message);
    }
    throw error;
  }
  const fusedRules = skill.sourceBadge === 'fused' ? skill.fusionMeta?.resolvedRules : undefined;
  const sourceManifest = skill.parentSkillId ? capabilityManifestFor(skill.parentSkillId) : undefined;
  const isGovernedCatalogClone = sourceManifest?.kind === 'skill-card'
    && sourceManifest.runtimeStatus === 'active'
    && sourceManifest.sourceType === skill.sourceType
    && sourceManifest.deconstructionCardType === skill.deconstructionCardType;
  if (skill.sourceBadge !== 'book-extracted'
    && !isGovernedCatalogClone
    && !(skill.sourceBadge === 'fused' && fusedRules && typeof fusedRules === 'object')) {
    throw new WritingStyleRequestError(400, 'SESSION_CARD_NOT_RUNTIME_READY', '本章使用卡当前不可运行');
  }
  if (!isSupportedCardType(skill.deconstructionCardType)) {
    throw new WritingStyleRequestError(400, 'UNKNOWN_SESSION_CARD_TYPE', '本章使用卡类型无法路由');
  }
  if (!Number.isFinite(skill.executionScore) || (skill.executionScore as number) < 60) {
    throw new WritingStyleRequestError(400, 'SESSION_CARD_NOT_RUNTIME_READY', '本章使用卡当前不可运行');
  }
  const rules: Record<string, unknown> = {};
  if (fusedRules && typeof fusedRules === 'object') Object.assign(rules, valueCopy(fusedRules));
  for (const key of SESSION_RULE_KEYS) {
    const value = skill[key as keyof Skill];
    if (hasRuntimeRuleValue(value)) rules[key] = value;
  }
  const methodChain = projectMethodChain(skill.methodChain);
  if (methodChain) rules.methodChain = methodChain;
  if (Object.keys(rules).length === 0) {
    throw new WritingStyleRequestError(400, 'SESSION_CARD_NOT_RUNTIME_READY', '本章使用卡当前不可运行');
  }
  if (isMonetizationEnabled() && skill.accessTier === 'paid' && novel.projectPreferenceProfile?.commercialMode !== 'paid') {
    throw new WritingStyleRequestError(403, 'SESSION_CARD_FORBIDDEN', '当前作品无权使用这张本章使用卡');
  }
  return {
    id: skill.id,
    title: SESSION_CARD_TITLES[skill.deconstructionCardType],
    template: JSON.stringify(rules),
    deconstructionCardType: skill.deconstructionCardType,
    version: skill.version,
    sourceBadge: isGovernedCatalogClone ? sourceManifest.sourceType : (skill.sourceBadge || 'book-extracted'),
    dimensionOwners: valueCopy(skill.fusionMeta?.dimensionOwners || {}),
    resolvedRules: valueCopy(fusedRules || rules),
    lineage: valueCopy({ ...(skill.fusionMeta?.components ? { components: skill.fusionMeta.components } : {}), ...(skill.lineageRootId ? { rootId: skill.lineageRootId } : {}) }),
  };
}

function projectCatalogAsset(asset: GovernedPromptAsset): RuntimeSessionAsset {
  if (!isSupportedCardType(asset.deconstructionCardType)) {
    throw new WritingStyleRequestError(400, 'UNKNOWN_SESSION_CARD_TYPE', '本章使用卡类型无法路由');
  }
  return {
    id: asset.id,
    title: SESSION_CARD_TITLES[asset.deconstructionCardType],
    template: asset.template,
    deconstructionCardType: asset.deconstructionCardType,
    version: 'catalog',
    sourceBadge: asset.sourceType || 'built-in',
    dimensionOwners: {},
    resolvedRules: { template: asset.template },
    lineage: { catalogId: asset.id },
  };
}

function projectActiveCatalogSkillCard(id: string, novel: Novel, scope: 'project' | 'chapter'): RuntimeSessionAsset | null {
  const manifest = capabilityManifestFor(id);
  if (!manifest) return null;
  const scopeLabel = scope === 'project' ? '作品卡组' : '本章使用卡';
  const codePrefix = scope === 'project' ? 'PROJECT_SKILL_CARD' : 'SESSION_CARD';
  if (manifest.kind !== 'skill-card' || manifest.runtimeStatus !== 'active' || !manifest.allowedScopes.includes(scope)) {
    throw new WritingStyleRequestError(400, `${codePrefix}_SCOPE_INVALID`, `${scopeLabel}作用域或类型无效`, id);
  }
  if (!isSupportedCardType(manifest.deconstructionCardType)) {
    throw new WritingStyleRequestError(400, `${codePrefix}_TYPE_INVALID`, `${scopeLabel}类型无效`, id);
  }
  if (isMonetizationEnabled() && manifest.sourceType === 'licensed' && novel.projectPreferenceProfile?.commercialMode !== 'paid') {
    throw new WritingStyleRequestError(403, `${codePrefix}_FORBIDDEN`, `当前作品无权使用这张${scopeLabel}`, id);
  }
  const template = resolveCuratedTechniquePrompt(id);
  if (!template) {
    throw new WritingStyleRequestError(400, `${codePrefix}_NOT_RUNTIME_READY`, `${scopeLabel}当前不可运行`, id);
  }
  return {
    id,
    title: CURATED_PRODUCT_SKILLS.find((asset) => asset.id === id)?.title || SESSION_CARD_TITLES[manifest.deconstructionCardType],
    template,
    deconstructionCardType: manifest.deconstructionCardType,
    version: manifest.version,
    sourceBadge: manifest.sourceType,
    dimensionOwners: {},
    resolvedRules: { template },
    lineage: { catalogId: id },
    source: scope,
  };
}

function projectProjectSkillDeckAsset(id: string, novel: Novel): RuntimeSessionAsset {
  const manifest = capabilityManifestFor(id);
  if (!manifest || manifest.kind !== 'skill-card' || manifest.runtimeStatus !== 'active' || !manifest.allowedScopes.includes('project')) {
    throw new WritingStyleRequestError(400, 'PROJECT_SKILL_CARD_SCOPE_INVALID', '作品卡组能力卡作用域或类型无效', id);
  }
  if (!isSupportedCardType(manifest.deconstructionCardType)) {
    throw new WritingStyleRequestError(400, 'PROJECT_SKILL_CARD_TYPE_INVALID', '作品卡组能力卡类型无效', id);
  }
  const savedSkill = db.getSkill(id);
  if (savedSkill) {
    return { ...projectSavedSkill(savedSkill, novel), source: 'project' as const };
  }
  if (isMonetizationEnabled() && manifest.sourceType === 'licensed' && novel.projectPreferenceProfile?.commercialMode !== 'paid') {
    throw new WritingStyleRequestError(403, 'PROJECT_SKILL_CARD_FORBIDDEN', '当前作品无权使用这张作品卡组能力卡', id);
  }
  const template = resolveCuratedTechniquePrompt(id);
  if (!template) {
    throw new WritingStyleRequestError(400, 'PROJECT_SKILL_CARD_NOT_RUNTIME_READY', '作品卡组能力卡当前不可运行', id);
  }
  return {
    id,
    title: SESSION_CARD_TITLES[manifest.deconstructionCardType],
    template,
    deconstructionCardType: manifest.deconstructionCardType,
    version: manifest.version,
    sourceBadge: manifest.sourceType,
    dimensionOwners: {},
    resolvedRules: { template },
    lineage: { catalogId: id },
    source: 'project' as const,
  };
}

function getStageSkills(novel: Novel): { planner: Skill[]; writer: Skill[]; critic: Skill[] } {
  const profile = novel.projectPreferenceProfile;
  // v3 owns execution through Flow, Techniques and the Skill Deck. Legacy
  // mounted slots remain readable only for v2 projects.
  if (profile?.capabilityModelVersion === 3 && profile.capabilityProfile?.version === 3) {
    return { planner: [], writer: [], critic: [] };
  }
  const migrated = resolveSkillLoadout({
    profileVersion: novel.projectPreferenceProfile?.skillLoadoutSchemaVersion,
    mountedSkillLoadout: novel.mountedSkillLoadout,
    mountedSkillIds: novel.mountedSkillIds,
  });
  if (migrated.pendingSkillIds.length > 0) {
    throw new WritingStyleRequestError(409, 'SKILL_LOADOUT_CONFIRMATION_REQUIRED', '能力需要先确认阶段位置');
  }
  const readSlot = (slot: number) => migrated.loadout
    .filter((entry) => entry.slot === slot)
    .map((entry) => db.getSkill(entry.skillId))
    .filter((skill): skill is Skill => Boolean(skill));
  return { planner: readSlot(0), writer: readSlot(1), critic: readSlot(2) };
}

function hasCapabilityV3(novel: Novel): boolean {
  return novel.projectPreferenceProfile?.capabilityModelVersion === 3
    && novel.projectPreferenceProfile.capabilityProfile?.version === 3;
}

/** Validate a proposed v3 project profile without mutating the database. */
export function validateCapabilityProfile(novelId: string, value: unknown): void {
  if (!value || typeof value !== 'object') throw new WritingStyleRequestError(400, 'CAPABILITY_PROFILE_INVALID', '能力配置格式无效');
  const profile = value as Record<string, unknown>;
  if (profile.version !== 3) throw new WritingStyleRequestError(400, 'CAPABILITY_PROFILE_VERSION_INVALID', '能力配置版本无效');
  if (profile.activeFlowId !== undefined) {
    if (typeof profile.activeFlowId !== 'string' || !profile.activeFlowId.trim()) throw new WritingStyleRequestError(400, 'CAPABILITY_FLOW_INVALID', '创作流程配置无效');
    const flowManifest = capabilityManifestFor(profile.activeFlowId);
    if (!flowManifest || flowManifest.kind !== 'flow' || flowManifest.runtimeStatus !== 'active' || !flowManifest.allowedScopes.includes('project')) {
      throw new WritingStyleRequestError(400, 'CAPABILITY_FLOW_UNAVAILABLE', '创作流程当前不可用');
    }
  }
  const deck = profile.projectSkillDeck;
  if (!deck || typeof deck !== 'object') throw new WritingStyleRequestError(400, 'PROJECT_SKILL_DECK_INVALID', '作品卡组格式无效');
  const deckRecord = deck as Record<string, unknown>;
  const supportIds = deckRecord.supportCardIds;
  if (!Array.isArray(supportIds) || supportIds.length > 2 || supportIds.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new WritingStyleRequestError(400, 'PROJECT_SKILL_DECK_INVALID', '作品卡组格式无效');
  }
  const mainId = deckRecord.mainCardId;
  if (mainId !== undefined && (typeof mainId !== 'string' || !mainId.trim())) throw new WritingStyleRequestError(400, 'PROJECT_SKILL_DECK_INVALID', '作品卡组格式无效');
  if (mainId === undefined && supportIds.length > 0) throw new WritingStyleRequestError(400, 'PROJECT_SKILL_DECK_MAIN_REQUIRED', '存在副卡时必须显式选择主卡');
  const ids = [mainId, ...supportIds].filter((id): id is string => typeof id === 'string').map((id) => id.trim());
  if (new Set(ids).size !== ids.length) throw new WritingStyleRequestError(400, 'PROJECT_SKILL_DECK_DUPLICATE', '作品卡组能力卡不能重复');
  for (const id of ids) {
    const manifest = capabilityManifestFor(id);
    if (manifest && (manifest.kind !== 'skill-card' || manifest.runtimeStatus !== 'active' || !manifest.allowedScopes.includes('project'))) {
      throw new WritingStyleRequestError(400, 'PROJECT_SKILL_CARD_SCOPE_INVALID', '作品卡组能力卡作用域或类型无效', id);
    }
    if (manifest) {
      if (!isSupportedCardType(manifest.deconstructionCardType)) {
        throw new WritingStyleRequestError(400, 'PROJECT_SKILL_CARD_TYPE_INVALID', '作品卡组能力卡类型无效', id);
      }
      continue;
    }
    const skill = db.getSkill(id);
    if (!skill) throw new WritingStyleRequestError(400, 'PROJECT_SKILL_CARD_NOT_FOUND', '作品卡组能力卡不存在', id);
    projectSavedSkill(skill, db.getNovel(novelId) || ({ id: novelId } as Novel));
  }
  if (profile.favoriteTechniqueIds !== undefined && (!Array.isArray(profile.favoriteTechniqueIds) || profile.favoriteTechniqueIds.some((id) => typeof id !== 'string'))) {
    throw new WritingStyleRequestError(400, 'CAPABILITY_TECHNIQUES_INVALID', '常用技法配置无效');
  }
  if (profile.projectTechniqueIds !== undefined && (!Array.isArray(profile.projectTechniqueIds) || profile.projectTechniqueIds.some((id) => typeof id !== 'string'))) {
    throw new WritingStyleRequestError(400, 'CAPABILITY_PROJECT_TECHNIQUES_INVALID', '作品默认技法配置无效');
  }
  if (profile.guardrailIds !== undefined && (!Array.isArray(profile.guardrailIds) || profile.guardrailIds.some((id) => typeof id !== 'string'))) {
    throw new WritingStyleRequestError(400, 'CAPABILITY_GUARDRAILS_INVALID', '系统检查候选格式无效');
  }
  for (const id of (profile.guardrailIds as string[] | undefined) || []) {
    const trimmed = id.trim();
    const manifest = capabilityManifestFor(trimmed);
    const catalogGuardrail = PROMPT_GOVERNANCE_CATALOG.find((asset) => asset.id === trimmed);
    const isDefaultGuardrail = Boolean(manifest?.kind === 'guardrail' && manifest.runtimeStatus === 'active' && manifest.allowedScopes.includes('system'));
    if (!isDefaultGuardrail && !isConfigurableGuardrailAsset(catalogGuardrail)) {
      throw new WritingStyleRequestError(400, 'CAPABILITY_GUARDRAIL_UNAVAILABLE', '系统检查候选当前不可用', trimmed);
    }
  }
  if (profile.capabilityMemberships !== undefined && !Array.isArray(profile.capabilityMemberships)) {
    throw new WritingStyleRequestError(400, 'CAPABILITY_MEMBERSHIPS_INVALID', '能力来源记录格式无效');
  }
  for (const item of (profile.capabilityMemberships as unknown[] | undefined) || []) {
    if (!item || typeof item !== 'object') {
      throw new WritingStyleRequestError(400, 'CAPABILITY_MEMBERSHIPS_INVALID', '能力来源记录格式无效');
    }
    const membership = item as Record<string, unknown>;
    const sourceId = typeof membership.sourceId === 'string' ? membership.sourceId.trim() : '';
    const sourceVersion = typeof membership.sourceVersion === 'string' ? membership.sourceVersion.trim() : '';
    const sourceType = membership.sourceType;
    const persistedSkillId = typeof membership.persistedSkillId === 'string' ? membership.persistedSkillId.trim() : '';
    if (!sourceId || !sourceVersion || !['built-in', 'plaza', 'licensed', 'book-extracted'].includes(String(sourceType))) {
      throw new WritingStyleRequestError(400, 'CAPABILITY_MEMBERSHIPS_INVALID', '能力来源记录格式无效');
    }
    if (sourceType !== 'built-in' && !persistedSkillId) {
      throw new WritingStyleRequestError(400, 'CAPABILITY_MEMBERSHIP_PERSISTENCE_REQUIRED', '非内置能力必须关联已持久化能力卡');
    }
    if (sourceType === 'built-in') continue;
    const saved = db.getSkill(persistedSkillId);
    if (!saved) {
      throw new WritingStyleRequestError(400, 'CAPABILITY_MEMBERSHIP_SKILL_NOT_FOUND', '能力来源对应的本地能力卡不存在', persistedSkillId);
    }
    const savedSourceId = saved.parentSkillId || saved.id;
    const sourceMatches = savedSourceId === sourceId && String(saved.version) === sourceVersion;
    const typeMatches = sourceType === 'book-extracted'
      ? saved.sourceBadge === 'book-extracted'
      : saved.sourceType === sourceType;
    if (!sourceMatches || !typeMatches) {
      throw new WritingStyleRequestError(400, 'CAPABILITY_MEMBERSHIP_MISMATCH', '能力来源与本地能力卡不匹配', persistedSkillId);
    }
  }
  if (profile.favoriteTechniqueIds !== undefined) {
    buildTechniques(resolveFavoriteTechniqueIdsFromProfile(profile, profile.favoriteTechniqueIds as string[]));
  }
  if (profile.projectTechniqueIds !== undefined) {
    buildTechniques(resolveFavoriteTechniqueIdsFromProfile(profile, profile.projectTechniqueIds as string[]));
  }
}

function resolveFavoriteTechniqueIdsFromProfile(profile: Record<string, unknown>, favoriteTechniqueIds: string[]): string[] {
  const membershipByPersistedId = new Map(
    ((Array.isArray(profile.capabilityMemberships) ? profile.capabilityMemberships : []) as unknown[])
      .filter((item): item is Record<string, unknown> => {
        if (!item || typeof item !== 'object') return false;
        return typeof (item as Record<string, unknown>).persistedSkillId === 'string';
      })
      .map((item) => [(item.persistedSkillId as string).trim(), item]),
  );
  return favoriteTechniqueIds.map((id) => {
    const trimmed = id.trim();
    const manifest = capabilityManifestFor(trimmed);
    if (manifest?.kind === 'technique') return trimmed;
    const membership = membershipByPersistedId.get(trimmed);
    const sourceId = typeof membership?.sourceId === 'string' ? membership.sourceId.trim() : '';
    const sourceManifest = sourceId ? capabilityManifestFor(sourceId) : undefined;
    return sourceManifest?.kind === 'technique' ? sourceId : trimmed;
  });
}

function resolveProjectSkillDeck(novel: Novel): { mainCard: RuntimeSessionAsset | null; supportCards: RuntimeSessionAsset[]; all: RuntimeSessionAsset[] } {
  if (!hasCapabilityV3(novel)) return { mainCard: null, supportCards: [], all: [] };
  const deck = novel.projectPreferenceProfile!.capabilityProfile!.projectSkillDeck;
  const supportIds = Array.isArray(deck.supportCardIds) ? deck.supportCardIds : [];
  if ((deck.mainCardId !== undefined && typeof deck.mainCardId !== 'string') || supportIds.some((id) => typeof id !== 'string')) {
    throw new WritingStyleRequestError(400, 'PROJECT_SKILL_DECK_INVALID', '作品卡组格式无效');
  }
  const ids = [deck.mainCardId, ...supportIds].filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  const uniqueIds = [...new Set(ids.map((id) => id.trim()))];
  if (uniqueIds.length !== ids.length) throw new WritingStyleRequestError(400, 'PROJECT_SKILL_DECK_DUPLICATE', '作品卡组能力卡不能重复');
  if (supportIds.length > 2) throw new WritingStyleRequestError(400, 'PROJECT_SKILL_DECK_TOO_MANY_SUPPORTS', '作品卡组最多两张副卡');
  const cards = uniqueIds.map((id) => {
    const skill = db.getSkill(id);
    if (skill) {
      try {
        return { ...projectSavedSkill(skill, novel), source: 'project' as const };
      } catch (error) {
        if (error instanceof WritingStyleRequestError) {
          throw new WritingStyleRequestError(error.status, `PROJECT_${error.code}`, error.message, id);
        }
        throw error;
      }
    }
    return projectProjectSkillDeckAsset(id, novel);
  });
  return { mainCard: cards[0] || null, supportCards: cards.slice(1), all: cards };
}

function resolveSessionAssets(novel: Novel, ids: string[]): RuntimeSessionAsset[] {
  if (ids.length > 6) {
    throw new WritingStyleRequestError(400, 'TOO_MANY_SESSION_CARDS', '本章使用卡最多使用 6 张');
  }
  if (ids.some((id) => typeof id !== 'string')) {
    throw new WritingStyleRequestError(400, 'INVALID_SESSION_CARD_IDS', '本章使用卡 ID 格式无效');
  }
  const uniqueIds = [...new Set(ids.map((id) => id.trim()))];
  return uniqueIds.map((id) => {
    const asset = PROMPT_GOVERNANCE_CATALOG.find((candidate) => candidate.id === id);
    if (asset) {
      if (!asset.isRuntimeReady || asset.runtimeStatus !== 'active' || asset.sanitizationStatus !== 'runtime-ready') {
        throw new WritingStyleRequestError(400, 'SESSION_CARD_NOT_RUNTIME_READY', '本章使用卡当前不可运行', id);
      }
      if (asset.licenseStatus === 'unknown' || asset.processDecision === 'reject' || asset.processDecision === 'research-only') {
        throw new WritingStyleRequestError(403, 'SESSION_CARD_UNAUTHORIZED', '本章使用卡未获运行授权', id);
      }
      if (isMonetizationEnabled() && asset.sourceType === 'licensed' && novel.projectPreferenceProfile?.commercialMode !== 'paid') {
        throw new WritingStyleRequestError(403, 'SESSION_CARD_FORBIDDEN', '当前作品无权使用这张本章使用卡', id);
      }
      return { ...projectCatalogAsset(asset), source: 'chapter' as const };
    }
    const catalogSkillCard = projectActiveCatalogSkillCard(id, novel, 'chapter');
    if (catalogSkillCard) return { ...catalogSkillCard, source: 'chapter' as const };
    const savedSkill = db.getSkill(id);
    if (!savedSkill) throw new WritingStyleRequestError(400, 'UNKNOWN_SESSION_CARD', '本章使用卡不存在', id);
    try {
      return { ...projectSavedSkill(savedSkill, novel), source: 'chapter' as const };
    } catch (error) {
      if (error instanceof WritingStyleRequestError && !error.sessionCardId) {
        throw new WritingStyleRequestError(error.status, error.code, error.message, id);
      }
      throw error;
    }
  });
}

function buildCriticPrompt(snapshot: WritingStyleSnapshot, packStyle: Record<string, unknown> | undefined, writerSessionAssets: RuntimeSessionAsset[], criticSkill: Skill | undefined, flowPrompt?: string): string {
  const summary = [
    `【写法契约标准】模式：${snapshot.mode}（${MODE_LABELS[snapshot.mode]}）`,
    `项目基调：${snapshot.styleAnchors.join(' / ') || '系统默认'}`,
    packStyle ? `资料包 styleProfile：${JSON.stringify(packStyle)}` : '资料包 styleProfile：无',
    '本章写法卡仅作为写作规则补充；审查只检查其规则是否被遵守，不读取主笔能力卡原文。',
    writerSessionAssets.length > 0 ? `本章写法卡规则：\n${writerSessionAssets.map((asset) => `【${asset.title}】\n${asset.template}`).join('\n\n')}` : '本章写法卡：无',
  ].join('\n');
  const criticSkillPrompt = criticSkill ? `【Critic Slot 2 规则】\n${buildWriterRules(criticSkill)}` : '';
  return [summary, flowPrompt ? `【当前流程步骤】\n${flowPrompt}` : '', criticSkillPrompt].filter(Boolean).join('\n\n');
}

function buildWriterRules(writerSkill: Skill | undefined): string {
  if (!writerSkill) return '';
  const rules: Record<string, unknown> = {};
  for (const key of ['style', 'pacing', 'vocabulary', 'sentenceStructure', 'imagery', 'bannedWords', 'characterTraits', 'plotPattern']) {
    const value = writerSkill[key as keyof Skill];
    if (value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0)) rules[key] = value;
  }
  return Object.keys(rules).length > 0 ? `【Writer 已解析写法规则】\n${JSON.stringify(rules)}` : '';
}

function buildWriterContractPrompt(snapshot: WritingStyleSnapshot, writerSkill: Skill | undefined, packStyle: Record<string, unknown> | undefined, writerSessionAssets: RuntimeSessionAsset[], flowPrompt?: string): string {
  const priorityPolicy: Record<WritingStyleMode, string> = {
    default: '项目基调 > 系统默认笔调',
    'skill-deck': '项目基调 > 作品卡组 > 本章使用卡 > 资料包',
    'writer-skill': '项目基调 > 主笔能力卡 > 资料包',
    'continuation-pack': '项目基调 > 资料包 > 主笔能力卡',
    blend: '项目基调保持最高优先级；资料包负责 POV、时态和避免项；主笔能力卡负责句法、词汇和意象；节奏卡作为共同覆盖层。',
  };
  const anchors = snapshot.styleAnchors.length > 0 ? `【项目基调】\n${snapshot.styleAnchors.join(' / ')}` : '';
  const pack = packStyle ? `【资料包写法】\n${JSON.stringify(packStyle)}` : '';
  const overlays = writerSessionAssets.length > 0
    ? `【本章写法卡规则】\n${writerSessionAssets.map((asset) => `【${asset.title}】\n${asset.template}`).join('\n\n')}`
    : '';
  return [anchors, `【写法优先级】\n${priorityPolicy[snapshot.mode]}`, flowPrompt ? `【当前流程步骤】\n${flowPrompt}` : '', buildWriterRules(writerSkill), pack, overlays].filter(Boolean).join('\n\n');
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function valueCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeContinuationPack(pack: NonNullable<ReturnType<typeof db.getContinuationPack>>) {
  const copy = valueCopy(pack) as typeof pack;
  return {
    ...copy,
    sourceMap: { sections: copy.sourceMap?.sections || [], keyConflicts: copy.sourceMap?.keyConflicts || [] },
    readingQuestions: copy.readingQuestions || [],
    continuationGaps: copy.continuationGaps || [],
  };
}

function projectRoleSkills(stageSkills: { planner: Skill[]; writer: Skill[]; critic: Skill[] }): { planner: RoleSkillSnapshot[]; writer: RoleSkillSnapshot[]; critic: RoleSkillSnapshot[] } {
  const project = (stage: CapabilityStage, skills: Skill[]): RoleSkillSnapshot[] => skills.map((skill) => {
    const rules: Record<string, unknown> = {};
    for (const key of ['style', 'pacing', 'vocabulary', 'sentenceStructure', 'imagery', 'bannedWords', 'characterTraits', 'plotPattern']) {
      const value = skill[key as keyof Skill];
      if (value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0)) rules[key] = value;
    }
    return { stage, version: skill.version, rules };
  });
  return { planner: project('planner', stageSkills.planner), writer: project('writer', stageSkills.writer), critic: project('critic', stageSkills.critic) };
}

function freezeExecutionSnapshot(snapshot: ExecutionSnapshot): ExecutionSnapshot {
  return deepFreeze({
    ...snapshot,
    stageSkills: { planner: [...snapshot.stageSkills.planner], writer: [...snapshot.stageSkills.writer], critic: [...snapshot.stageSkills.critic] },
    roleSkills: { planner: [...snapshot.roleSkills.planner], writer: [...snapshot.roleSkills.writer], critic: [...snapshot.roleSkills.critic] },
    sessionCards: [...snapshot.sessionCards],
    overlays: [...snapshot.overlays],
    guardrails: [...snapshot.guardrails],
    stagePrompts: { ...snapshot.stagePrompts },
  });
}

function stagesForAsset(asset: RuntimeSessionAsset | GovernedPromptAsset): CapabilityStage[] {
  if (asset.deconstructionCardType && asset.deconstructionCardType in CARD_STAGE_MAP) return [...CARD_STAGE_MAP[asset.deconstructionCardType]];
  const stageMap: Record<string, CapabilityStage> = { discovery: 'planner', foundation: 'planner', planning: 'planner', drafting: 'writer', polish: 'writer', review: 'critic' };
  const stage = 'stage' in asset ? stageMap[asset.stage] : undefined;
  return stage ? [stage] : [];
}

function stageForGovernedAsset(asset: GovernedPromptAsset): CapabilityStage | null {
  const stageMap: Record<string, CapabilityStage> = { discovery: 'planner', foundation: 'planner', planning: 'planner', drafting: 'writer', polish: 'writer', review: 'critic' };
  return stageMap[asset.stage] || null;
}

function isRuntimePromptAsset(asset: GovernedPromptAsset | undefined): asset is GovernedPromptAsset {
  return Boolean(
    asset
      && asset.isRuntimeReady
      && asset.runtimeStatus === 'active'
      && asset.sanitizationStatus === 'runtime-ready',
  );
}

function isConfigurableGuardrailAsset(asset: GovernedPromptAsset | undefined): asset is GovernedPromptAsset {
  return Boolean(isRuntimePromptAsset(asset) && asset.primaryCategory === 'quality-guardrail');
}

function buildFlowStep(novel: Novel): ExecutionSnapshot['flowStep'] {
  const profile = novel.projectPreferenceProfile;
  const isV3 = profile?.capabilityModelVersion === 3 && profile.capabilityProfile?.version === 3;
  const activeSeriesId = isV3 ? profile?.capabilityProfile?.activeFlowId : profile?.activeSeriesId;
  if (!activeSeriesId) return null;
  const currentStep = getNovelCurrentStepId(novel, activeSeriesId);
  const flow = SKILL_SERIES_FLOWS.find((item) => item.id === activeSeriesId);
  const step = flow?.steps.find((item) => item.id === currentStep);
  if (!step) return null;
  const asset = PROMPT_GOVERNANCE_CATALOG.find((item) => item.id === step.assetId);
  const assetRunnable = Boolean(
    asset?.isRuntimeReady
      && asset.runtimeStatus === 'active'
      && asset.sanitizationStatus === 'runtime-ready',
  );
  const stepContract = [
    `【流程步骤：${step.name}】`,
    `【步骤输入】${step.input}`,
    `【预期输出】${step.output}`,
    `【质量门】${step.qualityGate}`,
  ].join('\n');
  return {
    activeFlowId: activeSeriesId,
    currentStep: step.id,
    name: step.name,
    input: step.input,
    output: step.output,
    stage: asset ? stageForGovernedAsset(asset) : null,
    assetId: step.assetId,
    qualityGate: step.qualityGate,
    prompt: assetRunnable ? `${stepContract}\n【可运行资产 Prompt】\n${asset?.template || ''}` : stepContract,
    ...(assetRunnable ? {} : { warning: 'FLOW_STEP_ASSET_UNAVAILABLE' }),
  };
}

function buildGuardrails(novel: Novel): ExecutionGuardrail[] {
  const configuredIds = hasCapabilityV3(novel) ? novel.projectPreferenceProfile?.capabilityProfile?.guardrailIds || [] : [];
  const configured = configuredIds
    .filter((id) => id !== 'default-guardrail')
    .map((id) => PROMPT_GOVERNANCE_CATALOG.find((asset) => asset.id === id))
    .filter(isConfigurableGuardrailAsset);
  const assets = [...PROMPT_GOVERNANCE_CATALOG.filter((asset) => asset.placementTier === 'core-default' && isRuntimePromptAsset(asset)), ...configured];
  const seen = new Set<string>();
  return assets.flatMap((asset) => stagesForAsset(asset).map((stage) => ({ id: asset.id, stage, prompt: asset.template })))
    .filter((guardrail) => {
      const key = `${guardrail.id}\u0000${guardrail.stage}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildTechniques(ids: string[]): ExecutionTechniques {
  const techniqueIds = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))];
  const result: Record<CapabilityStage, ExecutionTechnique[]> = { planner: [], writer: [], critic: [] };
  for (const id of techniqueIds) {
    const manifest = capabilityManifestFor(id);
    if (!manifest) throw new WritingStyleRequestError(400, 'TECHNIQUE_NOT_FOUND', '技法不存在', id);
    if (manifest.kind !== 'technique') throw new WritingStyleRequestError(400, 'TECHNIQUE_KIND_INVALID', '该能力不是阶段技法', id);
    if (manifest.runtimeStatus !== 'active') throw new WritingStyleRequestError(400, 'TECHNIQUE_NOT_RUNTIME_READY', '阶段技法当前不可运行', id);
    const catalog = PROMPT_GOVERNANCE_CATALOG.find((asset) => asset.id === id);
    const runtimePrompt = resolveRuntimeCuratedPrompts([{
      id,
      parentSkillId: id,
      style: 'INKFLOW_CURATED_RUNTIME_DECOUPLED_PLACEHOLDER',
      pacing: '',
      description: '',
    }])[0]?.style;
    const prompt = typeof runtimePrompt === 'string' && runtimePrompt !== 'INKFLOW_CURATED_RUNTIME_DECOUPLED_PLACEHOLDER'
      ? runtimePrompt
      : catalog?.template;
    const canRun = catalog
      ? Boolean(catalog.isRuntimeReady && catalog.runtimeStatus === 'active' && catalog.sanitizationStatus === 'runtime-ready' && prompt)
      : Boolean(prompt);
    if (!canRun) {
      throw new WritingStyleRequestError(400, 'TECHNIQUE_NOT_RUNTIME_READY', '阶段技法当前不可运行', id);
    }
    for (const stage of manifest.stages) {
      result[stage].push({ id, stage, version: manifest.version, prompt: prompt || '', outputArtifact: manifest.outputArtifact });
    }
  }
  return result;
}

function resolveFavoriteTechniqueIds(novel: Novel): string[] {
  if (!hasCapabilityV3(novel)) return [];
  const profile = novel.projectPreferenceProfile!.capabilityProfile!;
  const membershipByPersistedId = new Map(
    (profile.capabilityMemberships || [])
      .filter((membership) => membership.persistedSkillId)
      .map((membership) => [membership.persistedSkillId!, membership]),
  );
  const ids = profile.projectTechniqueIds ?? profile.favoriteTechniqueIds ?? [];
  return ids.map((id) => {
    const manifest = capabilityManifestFor(id);
    if (manifest?.kind === 'technique') return id;
    const membership = membershipByPersistedId.get(id);
    if (!membership) return id;
    const sourceManifest = capabilityManifestFor(membership.sourceId);
    return sourceManifest?.kind === 'technique' ? membership.sourceId : id;
  });
}

function resolveChapterCapabilityState(novelId: string, chapterId: string | undefined, currentGeneration: number): { techniqueIds: string[]; overlayCardIds: string[] } {
  if (!chapterId) return { techniqueIds: [], overlayCardIds: [] };
  const chapter = db.getChapter(chapterId);
  if (!chapter) throw new WritingStyleRequestError(404, 'CHAPTER_NOT_FOUND', '章节不存在');
  if (chapter.novelId !== novelId) throw new WritingStyleRequestError(403, 'CHAPTER_SCOPE_MISMATCH', '章节不属于当前作品');
  const state = chapter.workflowMeta?.capabilityState;
  if (state?.novelId !== undefined && state.novelId !== novelId) {
    throw new WritingStyleRequestError(403, 'CHAPTER_SCOPE_MISMATCH', '章节能力状态不属于当前作品');
  }
  if (state && (state.novelId === undefined || !Number.isInteger(state.databaseGeneration))) {
    throw new WritingStyleRequestError(409, 'DATABASE_GENERATION_STALE', '章节能力状态已过期，请刷新后重试');
  }
  if (state?.databaseGeneration !== undefined && state.databaseGeneration !== currentGeneration) {
    throw new WritingStyleRequestError(409, 'DATABASE_GENERATION_STALE', '章节能力状态已过期，请刷新后重试');
  }
  const ids = state?.techniqueIds;
  const overlayIds = state?.overlayCardIds;
  if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))) throw new WritingStyleRequestError(400, 'CHAPTER_TECHNIQUES_INVALID', '章节技法配置无效');
  if (overlayIds !== undefined && (!Array.isArray(overlayIds) || overlayIds.some((id) => typeof id !== 'string'))) throw new WritingStyleRequestError(400, 'CHAPTER_OVERLAYS_INVALID', '本章使用卡配置无效');
  const techniqueVersions = state?.techniqueVersions || {};
  const overlayVersions = state?.overlayVersions || {};
  const checkVersion = (id: string, expected: string | number | undefined, actual: string | number | undefined, code: string) => {
    if (expected === undefined || actual === undefined || String(expected) !== String(actual)) {
      throw new WritingStyleRequestError(409, code, '章节能力版本已变化，请刷新后重试', id);
    }
  };
  for (const id of Array.isArray(ids) ? ids : []) {
    const manifest = capabilityManifestFor(id);
    if (!manifest || manifest.kind !== 'technique') throw new WritingStyleRequestError(400, 'CAPABILITY_KIND_INVALID', '章节能力不是阶段技法', id);
    if (!manifest.allowedScopes.includes('chapter')) throw new WritingStyleRequestError(400, 'CAPABILITY_SCOPE_INVALID', '阶段技法不允许用于章节', id);
    if (manifest.runtimeStatus !== 'active') throw new WritingStyleRequestError(409, 'CAPABILITY_NOT_RUNTIME_READY', '阶段技法当前不可运行', id);
    checkVersion(id, techniqueVersions[id], manifest.version, 'CAPABILITY_VERSION_STALE');
  }
  for (const id of Array.isArray(overlayIds) ? overlayIds : []) {
    const manifest = capabilityManifestFor(id);
    const saved = db.getSkill(id);
    const actual = manifest?.kind === 'skill-card' ? manifest.version : saved?.version;
    if (!manifest && !saved) throw new WritingStyleRequestError(400, 'CAPABILITY_KIND_INVALID', '本章使用卡不存在', id);
    if (manifest && manifest.kind !== 'skill-card') throw new WritingStyleRequestError(400, 'CAPABILITY_KIND_INVALID', '章节能力不是能力卡', id);
    if (manifest && !manifest.allowedScopes.includes('chapter')) throw new WritingStyleRequestError(400, 'CAPABILITY_SCOPE_INVALID', '能力卡不允许用于章节', id);
    if (manifest && manifest.runtimeStatus !== 'active') throw new WritingStyleRequestError(409, 'CAPABILITY_NOT_RUNTIME_READY', '能力卡当前不可运行', id);
    checkVersion(id, overlayVersions[id], actual, 'CAPABILITY_VERSION_STALE');
  }
  return { techniqueIds: Array.isArray(ids) ? ids : [], overlayCardIds: Array.isArray(overlayIds) ? overlayIds : [] };
}

function buildSkillStack(projectDeck: { mainCard: RuntimeSessionAsset | null; supportCards: RuntimeSessionAsset[]; all: RuntimeSessionAsset[] }, chapterCards: RuntimeSessionAsset[]): ExecutionSkillStack {
  const toOverlay = (asset: RuntimeSessionAsset, position: ExecutionOverlay['position']): ExecutionOverlay => ({
    id: asset.id,
    version: asset.version,
    source: asset.sourceBadge,
    position,
    type: asset.deconstructionCardType,
    stages: stagesForAsset(asset),
    prompt: asset.template,
    dimensionOwners: asset.dimensionOwners,
    resolvedRules: asset.resolvedRules,
    lineage: asset.lineage,
  });
  return {
    mainCard: projectDeck.mainCard ? toOverlay(projectDeck.mainCard, 'project-main') : null,
    projectSupportCards: projectDeck.supportCards.map((asset) => toOverlay(asset, 'project-support')),
    chapterCards: chapterCards.map((asset) => toOverlay(asset, 'chapter')),
    effectiveCards: [
      ...(projectDeck.mainCard ? [toOverlay(projectDeck.mainCard, 'project-main')] : []),
      ...projectDeck.supportCards.map((asset) => toOverlay(asset, 'project-support')),
      ...chapterCards.map((asset) => toOverlay(asset, 'chapter')),
    ],
  };
}

function buildTechniquePrompt(techniques: readonly ExecutionTechnique[]): string {
  return techniques.map((technique) => `【阶段技法：${technique.id}】\n${technique.prompt}`).join('\n\n');
}

function summarizeSources(snapshot: WritingStyleSnapshot, writerSkill: Skill | undefined, projectDeckAssets: RuntimeSessionAsset[], packId: string | undefined, packStatus: 'draft' | 'approved' | undefined, sessionAssets: RuntimeSessionAsset[]): WritingStyleSourceSummary[] {
  const sources: WritingStyleSourceSummary[] = [];
  if (snapshot.styleAnchors.length > 0) sources.push({ kind: 'project-tone', label: snapshot.styleAnchors.join(' / ') });
  if (writerSkill) sources.push({
    kind: 'writer-skill',
    id: writerSkill.id,
    label: writerSkill.version ? `${writerSkill.name} v${writerSkill.version}` : writerSkill.name,
    version: writerSkill.version,
  });
  if (projectDeckAssets.length > 0) sources.push({
    kind: 'skill-deck',
    id: projectDeckAssets[0].id,
    label: `作品卡组：${projectDeckAssets.map((asset) => asset.title).join('、')}`,
  });
  if (packId && packStatus) sources.push({ kind: 'continuation-pack', id: packId, label: packStatus === 'draft' ? '未确认资料包' : '资料包', status: packStatus });
  for (const asset of sessionAssets.filter((item) => item.source !== 'project' && WRITER_SESSION_CARD_TYPES.has(item.deconstructionCardType || ''))) {
    sources.push({ kind: 'writer-session', id: asset.id, label: asset.title });
  }
  if (sources.length === 0) sources.push({ kind: 'default', label: MODE_LABELS.default });
  return sources;
}

function buildSummary(mode: WritingStyleMode, sources: WritingStyleSourceSummary[]): string {
  const labels = sources.map((source) => source.label).filter((label): label is string => Boolean(label));
  return labels.length > 0 && sources[0]?.kind !== 'default'
    ? `${MODE_LABELS[mode]}：${labels.join(' · ')}`
    : MODE_LABELS.default;
}

function buildWriterPrompt(snapshot: WritingStyleSnapshot, writerSkill: Skill | undefined, packStyle: Record<string, unknown> | undefined, sessionAssets: RuntimeSessionAsset[]): string {
  const blocks: string[] = [];
  if (snapshot.styleAnchors.length > 0) blocks.push(`【项目基调（最高优先级）】\n${snapshot.styleAnchors.map((item) => `- ${item}`).join('\n')}`);
  const priorityPolicy: Record<WritingStyleMode, string> = {
    default: '项目基调 > 系统默认笔调',
    'skill-deck': '项目基调 > 作品卡组 > 本章使用卡 > 资料包',
    'writer-skill': '项目基调 > 主笔能力卡 > 资料包',
    'continuation-pack': '项目基调 > 资料包 > 主笔能力卡',
    blend: '项目基调保持最高优先级；资料包负责 POV、时态和避免项；主笔能力卡负责句法、词汇和意象；节奏卡作为共同覆盖层。',
  };
  blocks.push(`【写法优先级】\n${priorityPolicy[snapshot.mode]}`);
  const writerBlock = writerSkill ? buildSkillsPrompt([writerSkill]).trim() : '';
  const packBlock = packStyle ? `【资料包写法】\n${JSON.stringify(packStyle)}` : '';
  const sessionBlock = sessionAssets
    .filter((asset) => WRITER_SESSION_CARD_TYPES.has(asset.deconstructionCardType || ''))
    .map((asset) => `【本章写法卡：${asset.title}】\n${asset.template}`)
    .join('\n\n');

  if (snapshot.mode === 'continuation-pack') blocks.push(packBlock, writerBlock);
  else if (snapshot.mode === 'blend') blocks.push(packBlock, writerBlock);
  else if (snapshot.mode === 'writer-skill') blocks.push(writerBlock, packBlock);
  if (sessionBlock) blocks.push(sessionBlock);
  return blocks.filter(Boolean).join('\n\n');
}

function buildPlannerSessionPrompt(sessionAssets: RuntimeSessionAsset[]): string {
  const plannerTypes = new Set(['worldview-card', 'character-card', 'hook-card', 'conflict-card', 'pacing-card', 'platform-card']);
  return sessionAssets
    .filter((asset) => plannerTypes.has(asset.deconstructionCardType || ''))
    .map((asset) => `【本章规划卡：${asset.title}】\n${asset.template}`)
    .join('\n\n');
}

export function resolveWritingStyleRequest(novelId: string, input: WritingStyleRequestInput = {}): ResolvedWritingStyleRequest {
  const initialGeneration = getDatabaseGeneration();
  if (input.databaseGeneration !== undefined && input.databaseGeneration !== initialGeneration) {
    throw new WritingStyleRequestError(409, 'DATABASE_GENERATION_STALE', '数据库已变化，请刷新后重试');
  }
  const novel = db.getNovel(novelId);
  if (!novel) throw new WritingStyleRequestError(404, 'NOVEL_NOT_FOUND', '作品不存在');
  if (hasCapabilityV3(novel)) validateCapabilityProfile(novelId, novel.projectPreferenceProfile?.capabilityProfile);
  const stageSkills = getStageSkills(novel);
  const chapterState = resolveChapterCapabilityState(novelId, input.chapterId, initialGeneration);
  const chapterTechniqueIds = chapterState.techniqueIds;
  const writerSkill = stageSkills.writer[0];
  const projectDeck = resolveProjectSkillDeck(novel);
  const pack = input.continuationPackId ? db.getContinuationPack(input.continuationPackId) : undefined;
  if (input.continuationPackId && !pack) throw new WritingStyleRequestError(404, 'CONTINUATION_PACK_NOT_FOUND', '资料包不存在');
  if (pack && pack.novelId !== novelId) throw new WritingStyleRequestError(409, 'CONTINUATION_PACK_OWNERSHIP_MISMATCH', '资料包不属于当前作品');
  if (input.sessionCardIds !== undefined && !Array.isArray(input.sessionCardIds)) {
    throw new WritingStyleRequestError(400, 'INVALID_SESSION_CARD_IDS', '本章使用卡 ID 格式无效');
  }
  const projectTechniqueIds = resolveFavoriteTechniqueIds(novel);
  const combinedSessionCardIds = [...chapterState.overlayCardIds, ...(input.sessionCardIds || [])];
  if (combinedSessionCardIds.length > 6) throw new WritingStyleRequestError(400, 'TOO_MANY_SESSION_CARDS', '本章使用卡最多使用 6 张');
  const requestedSessionAssets = resolveSessionAssets(novel, [...new Set(combinedSessionCardIds)]);
  const projectIds = new Set(projectDeck.all.map((asset) => asset.id));
  const chapterAssets = requestedSessionAssets.filter((asset) => !projectIds.has(asset.id));
  const effectiveCardCount = projectDeck.all.length + chapterAssets.length;
  if (effectiveCardCount > 6) throw new WritingStyleRequestError(400, 'TOO_MANY_EFFECTIVE_SKILL_CARDS', '作品卡组与本章使用卡最多使用 6 张');
  const sessionAssets = [...projectDeck.all, ...chapterAssets];
  const writerSessionAssets = sessionAssets.filter((asset) => WRITER_SESSION_CARD_TYPES.has(asset.deconstructionCardType || '') && stagesForAsset(asset).includes('writer'));
  const writerDeckAssets = projectDeck.all.filter((asset) => stagesForAsset(asset).includes('writer'));
  const writerPromptAssets = [...writerDeckAssets, ...writerSessionAssets.filter((asset) => !writerDeckAssets.some((deckAsset) => deckAsset.id === asset.id))];
  const allowedModes: WritingStyleMode[] = projectDeck.all.length > 0 || writerSkill || pack ? [
    ...(projectDeck.all.length > 0 ? ['skill-deck' as const] : []),
    ...(writerSkill ? ['writer-skill' as const] : []),
    ...(pack ? ['continuation-pack' as const] : []),
    ...(writerSkill && pack ? ['blend' as const] : []),
  ] : ['default'];
  if (input.mode && !allowedModes.includes(input.mode)) {
    throw new WritingStyleRequestError(400, 'WRITING_STYLE_MODE_UNAVAILABLE', '当前写法来源不支持所选模式');
  }
  const storedMode = novel.projectPreferenceProfile?.writingStyleConfirmation?.mode;
  const requestedMode = input.mode
    ?? (storedMode && allowedModes.includes(storedMode) ? storedMode : undefined)
    ?? (projectDeck.all.length > 0 ? 'skill-deck' : writerSkill ? 'writer-skill' : pack ? 'continuation-pack' : 'default');
  const techniques = buildTechniques([...projectTechniqueIds, ...chapterTechniqueIds]);
  const writerSnapshot = writerSkill ? {
    id: writerSkill.id,
    name: writerSkill.name,
    version: writerSkill.version,
    prompt: buildSkillsPrompt([writerSkill]),
  } : undefined;
  const sessionSnapshots = writerSessionAssets.map((asset) => ({
    id: asset.id,
    type: asset.deconstructionCardType,
    version: asset.version,
    source: asset.sourceBadge,
    position: 'chapter',
    runtimeContent: asset.template,
    dimensionOwners: asset.dimensionOwners,
    resolvedRules: asset.resolvedRules,
    lineage: asset.lineage,
  }));
  const createSnapshot = (mode: WritingStyleMode) => resolveWritingStyle({
    novelId,
    mode,
    styleAnchors: novel.projectPreferenceProfile?.contract?.styleAnchors,
    writerSkill: writerSnapshot,
    skillDeck: writerDeckAssets.map((asset) => ({ id: asset.id, type: asset.deconstructionCardType, version: asset.version, source: asset.sourceBadge, position: 'project', runtimeContent: asset.template, dimensionOwners: asset.dimensionOwners, resolvedRules: asset.resolvedRules, lineage: asset.lineage })),
    techniques: techniques.writer.map((technique) => ({ id: technique.id, version: technique.version, prompt: technique.prompt })),
    pack: pack ? { id: pack.id, novelId: pack.novelId, status: pack.status, styleProfile: pack.styleProfile as unknown as Record<string, unknown> } : undefined,
    sessionCards: sessionSnapshots,
  });
  let snapshot: WritingStyleSnapshot;
  try {
    snapshot = createSnapshot(requestedMode);
  } catch (error) {
    if (error instanceof Error && error.message === 'TOO_MANY_SESSION_CARDS') {
      throw new WritingStyleRequestError(400, 'TOO_MANY_SESSION_CARDS', '本章使用卡最多使用 6 张');
    }
    throw error;
  }
  const fingerprint = canonicalWritingStyleFingerprint(snapshot);
  const sources = summarizeSources(snapshot, writerSkill, projectDeck.all, pack?.id, pack?.status, writerSessionAssets);
  const storedFingerprint = novel.projectPreferenceProfile?.writingStyleConfirmation?.fingerprint;
  const resolution: WritingStyleResolution = {
    resolverVersion: snapshot.resolverVersion,
    fingerprint,
    mode: requestedMode,
    summary: buildSummary(requestedMode, sources),
    sources,
    allowedModes,
    warnings: snapshot.warnings,
    confirmed: storedFingerprint === fingerprint,
  };
  const candidates = allowedModes.map((mode) => {
    const candidateSnapshot = createSnapshot(mode);
    return {
      mode,
      fingerprint: canonicalWritingStyleFingerprint(candidateSnapshot),
      summary: buildSummary(mode, sources),
      sources,
    };
  });
  const flowStep = buildFlowStep(novel);
  const packStyleProfile = pack?.styleProfile ? valueCopy(pack.styleProfile as unknown as Record<string, unknown>) : undefined;
  const guardrails = buildGuardrails(novel);
  const skillStack = buildSkillStack(projectDeck, chapterAssets);
  const criticPrompt = [
    buildCriticPrompt(snapshot, packStyleProfile, writerPromptAssets, stageSkills.critic[0], flowStep?.stage === 'critic' ? flowStep.prompt : undefined),
    buildTechniquePrompt(techniques.critic),
  ].filter(Boolean).join('\n\n');
  const overlays: ExecutionOverlay[] = skillStack.effectiveCards.filter((overlay) => overlay.stages.length > 0);
  const roleSkills = projectRoleSkills(stageSkills);
  const packContextBundle = pack
    ? buildContinuationContextBundle(normalizeContinuationPack(pack), { includeStyle: false })
    : undefined;
  const packSnapshot = pack ? {
    id: pack.id,
    status: pack.status,
    context: packContextBundle?.text || '',
    receipt: packContextBundle!.receipt,
    styleProfile: packStyleProfile || {},
  } : null;
  const guardrailPrompt = (stage: CapabilityStage) =>
    guardrails.filter((item) => item.stage === stage).map((item) => `【系统护栏：${item.id}】\n${item.prompt}`).join('\n\n');
  const plannerStagePrompt = [
    buildSkillsPrompt(stageSkills.planner),
    buildPlannerSessionPrompt(sessionAssets),
    buildTechniquePrompt(techniques.planner),
    flowStep?.stage === 'planner' ? `【当前流程步骤】\n${flowStep.prompt}` : '',
    guardrailPrompt('planner'),
  ].filter(Boolean).join('\n\n');
  const executionSnapshot = freezeExecutionSnapshot({
    novelId,
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    databaseGeneration: initialGeneration,
    canon: { novelId, styleAnchors: valueCopy(snapshot.styleAnchors), pack: packSnapshot },
    flowStep,
    roleSkills,
    overlays: valueCopy(overlays),
    guardrails: valueCopy(guardrails),
    techniques: valueCopy(techniques),
    skillStack: valueCopy(skillStack),
    stageSkills: roleSkills,
    sessionCards: valueCopy(overlays),
    stagePrompts: {
      planner: plannerStagePrompt,
      writer: [
        buildWriterContractPrompt(snapshot, writerSkill, packStyleProfile, writerPromptAssets, flowStep?.stage === 'writer' ? flowStep.prompt : undefined),
        buildTechniquePrompt(techniques.writer),
        guardrailPrompt('writer'),
      ].filter(Boolean).join('\n\n'),
      critic: [criticPrompt, guardrailPrompt('critic')].filter(Boolean).join('\n\n'),
    },
    writingStyleSummary: resolution.summary,
    writingStyleFingerprint: fingerprint,
    capabilityRefs: [...new Set([
      ...Object.values(techniques).flat().map((item) => item.id),
      ...overlays.map((item) => item.id),
      ...guardrails.map((item) => item.id),
      ...(flowStep?.assetId ? [flowStep.assetId] : []),
      ...stageSkills.planner.map((skill) => skill.id),
      ...stageSkills.writer.map((skill) => skill.id),
      ...stageSkills.critic.map((skill) => skill.id),
    ])],
    resolvedAtGeneration: initialGeneration,
  });
  if (getDatabaseGeneration() !== initialGeneration || (input.databaseGeneration !== undefined && input.databaseGeneration !== getDatabaseGeneration())) {
    throw new WritingStyleRequestError(409, 'DATABASE_GENERATION_STALE', '数据库已变化，请刷新后重试');
  }
  return {
    novel,
    snapshot,
    resolution,
    candidates,
    writerPrompt: buildWriterPrompt(snapshot, writerSkill, packStyleProfile, writerSessionAssets),
    plannerPrompt: buildPlannerSessionPrompt(sessionAssets),
    stageSkills,
    criticPrompt,
    executionSnapshot,
  };
}

/** Read all execution inputs once and expose an immutable runtime contract. */
export function resolveProjectExecutionContract(novelId: string, input: WritingStyleRequestInput = {}): ProjectExecutionContract {
  return resolveWritingStyleRequest(novelId, input).executionSnapshot;
}

export const resolveExecutionSnapshot = resolveProjectExecutionContract;

export function requireWritingStyleConfirmation(resolved: ResolvedWritingStyleRequest, providedFingerprint?: string): void {
  const result = checkWritingStyleConfirmation({
    currentFingerprint: resolved.resolution.fingerprint,
    storedFingerprint: resolved.novel.projectPreferenceProfile?.writingStyleConfirmation?.fingerprint,
    providedFingerprint,
  });
  if (!result.ok) throw new WritingStyleRequestError(409, 'STYLE_CONFIRMATION_REQUIRED', '请先确认本次写法');
}
