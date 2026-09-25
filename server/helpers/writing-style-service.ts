import type {
  GovernedPromptAsset,
  Novel,
  Skill,
  WritingStyleCandidate,
  WritingStyleMode,
  WritingStyleResolution,
  WritingStyleSourceSummary,
  ExecutionSnapshot,
  ProjectExecutionContract,
  CapabilityStage,
  ExecutionOverlay,
  ExecutionGuardrail,
  RoleSkillSnapshot,
  TechniquePriority,
  TechniquePriorityRole,
} from '../../shared/types.js';
import { CARD_STAGE_MAP } from '../../shared/types.js';
import { PROJECT_DECK_MAX_SUPPORT_CARDS } from '../../shared/lib/project-preference-profile.js';
import { isShellTemplatePrompt } from '../../shared/lib/prompt-shell.js';
import {
  renderFlowStepCardBlock,
  resolveFlowStepCard,
} from '../../shared/lib/flow-step-card-slot.js';
import { resolveFlowStepStage } from '../../shared/lib/flow-step-stage.js';
import { resolveFlowStepAvailability } from '../../shared/lib/flow-step-guidance.js';
import { PROMPT_GOVERNANCE_CATALOG } from '../../shared/lib/prompt-governance-catalog.js';
import { isRunnableToolManifest } from '../../shared/lib/knowledge-capabilities.js';
import { SANITIZED_SKILL_COPIES } from '../../shared/lib/public-skill-catalog.js';
import { CURATED_PRODUCT_SKILLS } from '../../shared/lib/curated-product-skills.js';
import { resolveSkillLoadout } from '../../shared/lib/skill-model.js';
import * as db from '../lib/db.js';
import { isMonetizationEnabled } from './quota-guard.js';
import { logger } from '../logger';
import { buildSkillsPrompt } from './prompt-helpers.js';
import {
  resolveCuratedTechniquePrompt,
  resolveRuntimeCuratedPrompts,
} from './curated-skill-runtime.js';
import { buildContinuationContextBundle } from '../../shared/lib/continuation-pack.js';
import {
  getNovelCurrentStepId,
  SKILL_SERIES_FLOWS,
} from '../../shared/lib/prompt-governance-catalog.js';
import {
  canonicalWritingStyleFingerprint,
  checkWritingStyleConfirmation,
  resolveWritingStyle,
  type WritingStyleResolution as WritingStyleSnapshot,
} from './writing-style-resolver.js';
import { capabilityManifestFor } from '../capabilities/manifest.js';
import { validateSkillCardForScope, SkillCardValidationError } from '../capabilities/manifest.js';
import type {
  ExecutionSkillStack,
  ExecutionTechnique,
  ExecutionTechniques,
} from '../../shared/types/capability-execution.js';
import { getDatabaseGeneration } from '../lib/db-instance.js';
import { isRuntimeReadyAsset } from '../../shared/lib/capability-runtime-readiness.js';

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
    readonly sessionCardId?: string
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
  /**
   * 写作规则卡类型；工具卡（utility/diagnostic）没有卡型 —— 它们不进入
   * writer/planner/critic 的规则注入通道（过滤按 deconstructionCardType 取值）。
   */
  deconstructionCardType?: NonNullable<GovernedPromptAsset['deconstructionCardType']>;
  /** 批次 C：工具卡元数据（有值时本条目是触发型能力，而非写作规则卡）。 */
  tool?: {
    kind: 'utility' | 'diagnostic';
    action: 'run-utility' | 'run-diagnostic';
    stages: CapabilityStage[];
  };
  source?: 'project' | 'chapter';
  version: string | number;
  sourceBadge: string;
  dimensionOwners: Record<string, string>;
  resolvedRules: Record<string, unknown>;
  lineage: Record<string, unknown>;
}

const SESSION_CARD_TITLES: Record<
  NonNullable<RuntimeSessionAsset['deconstructionCardType']>,
  string
> = {
  'worldview-card': '世界观拆书卡',
  'character-card': '人物拆书卡',
  'pacing-card': '节奏拆书卡',
  'hook-card': '钩子拆书卡',
  'conflict-card': '冲突拆书卡',
  'style-card': '风格拆书卡',
  'platform-card': '平台拆书卡',
};

const SESSION_RULE_KEYS = [
  'style',
  'pacing',
  'vocabulary',
  'sentenceStructure',
  'imagery',
  'bannedWords',
  'characterTraits',
  'worldBuilding',
  'foreshadowing',
  'plotPattern',
  'corePatterns',
  'bannedElements',
] as const;

function isSupportedCardType(
  value: string | undefined
): value is NonNullable<RuntimeSessionAsset['deconstructionCardType']> {
  return Boolean(value && value in CARD_STAGE_MAP);
}

function hasRuntimeRuleValue(value: unknown): boolean {
  return (
    value !== undefined &&
    value !== null &&
    value !== '' &&
    (!Array.isArray(value) || value.length > 0)
  );
}

function projectMethodChain(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  if (typeof source.summary === 'string' && source.summary.trim())
    projected.summary = source.summary;
  if (Array.isArray(source.items)) {
    const items = source.items.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const raw = item as Record<string, unknown>;
      const projectedItem: Record<string, unknown> = {};
      if (typeof raw.formalization === 'string' && raw.formalization.trim())
        projectedItem.formalization = raw.formalization;
      if (Array.isArray(raw.steps)) {
        const steps = raw.steps.filter(
          (step): step is string => typeof step === 'string' && Boolean(step.trim())
        );
        if (steps.length > 0) projectedItem.steps = steps;
      }
      if (typeof raw.boundary === 'string' && raw.boundary.trim())
        projectedItem.boundary = raw.boundary;
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
  const sourceManifest = skill.parentSkillId
    ? capabilityManifestFor(skill.parentSkillId)
    : undefined;
  const isGovernedCatalogClone =
    sourceManifest?.kind === 'skill-card' &&
    sourceManifest.runtimeStatus === 'active' &&
    sourceManifest.sourceType === skill.sourceType &&
    sourceManifest.deconstructionCardType === skill.deconstructionCardType;
  if (
    skill.sourceBadge !== 'book-extracted' &&
    !isGovernedCatalogClone &&
    !(skill.sourceBadge === 'fused' && fusedRules && typeof fusedRules === 'object')
  ) {
    throw new WritingStyleRequestError(
      400,
      'SESSION_CARD_NOT_RUNTIME_READY',
      '本章使用卡当前不可运行'
    );
  }
  if (!isSupportedCardType(skill.deconstructionCardType)) {
    throw new WritingStyleRequestError(400, 'UNKNOWN_SESSION_CARD_TYPE', '本章使用卡类型无法路由');
  }
  if (!Number.isFinite(skill.executionScore) || (skill.executionScore as number) < 60) {
    throw new WritingStyleRequestError(
      400,
      'SESSION_CARD_NOT_RUNTIME_READY',
      '本章使用卡当前不可运行'
    );
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
    throw new WritingStyleRequestError(
      400,
      'SESSION_CARD_NOT_RUNTIME_READY',
      '本章使用卡当前不可运行'
    );
  }
  if (
    isMonetizationEnabled() &&
    skill.accessTier === 'paid' &&
    novel.projectPreferenceProfile?.commercialMode !== 'paid'
  ) {
    throw new WritingStyleRequestError(
      403,
      'SESSION_CARD_FORBIDDEN',
      '当前作品无权使用这张本章使用卡'
    );
  }
  return {
    id: skill.id,
    title: SESSION_CARD_TITLES[skill.deconstructionCardType],
    template: JSON.stringify(rules),
    deconstructionCardType: skill.deconstructionCardType,
    version: skill.version,
    sourceBadge: isGovernedCatalogClone
      ? sourceManifest.sourceType
      : skill.sourceBadge || 'book-extracted',
    dimensionOwners: valueCopy(skill.fusionMeta?.dimensionOwners || {}),
    resolvedRules: valueCopy(fusedRules || rules),
    lineage: valueCopy({
      ...(skill.fusionMeta?.components ? { components: skill.fusionMeta.components } : {}),
      ...(skill.lineageRootId ? { rootId: skill.lineageRootId } : {}),
    }),
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

function projectActiveCatalogSkillCard(
  id: string,
  novel: Novel,
  scope: 'project' | 'chapter'
): RuntimeSessionAsset | null {
  const manifest = capabilityManifestFor(id);
  if (!manifest) return null;
  const scopeLabel = scope === 'project' ? '作品卡组' : '本章使用卡';
  const codePrefix = scope === 'project' ? 'PROJECT_SKILL_CARD' : 'SESSION_CARD';
  if (
    manifest.kind !== 'skill-card' ||
    manifest.runtimeStatus !== 'active' ||
    !manifest.allowedScopes.includes(scope)
  ) {
    throw new WritingStyleRequestError(
      400,
      `${codePrefix}_SCOPE_INVALID`,
      `${scopeLabel}作用域或类型无效`,
      id
    );
  }
  if (!isSupportedCardType(manifest.deconstructionCardType)) {
    throw new WritingStyleRequestError(
      400,
      `${codePrefix}_TYPE_INVALID`,
      `${scopeLabel}类型无效`,
      id
    );
  }
  if (
    isMonetizationEnabled() &&
    manifest.sourceType === 'licensed' &&
    novel.projectPreferenceProfile?.commercialMode !== 'paid'
  ) {
    throw new WritingStyleRequestError(
      403,
      `${codePrefix}_FORBIDDEN`,
      `当前作品无权使用这张${scopeLabel}`,
      id
    );
  }
  const template = resolveCuratedTechniquePrompt(id);
  if (!template) {
    throw new WritingStyleRequestError(
      400,
      `${codePrefix}_NOT_RUNTIME_READY`,
      `${scopeLabel}当前不可运行`,
      id
    );
  }
  return {
    id,
    title:
      CURATED_PRODUCT_SKILLS.find((asset) => asset.id === id)?.title ||
      SESSION_CARD_TITLES[manifest.deconstructionCardType],
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

/**
 * 批次 C（知识图谱可编排）：工具卡投影 —— utility/diagnostic 且动作为运行类的能力卡。
 *
 * 与 skill-card 不同，工具卡不注入写作规则文本（`deconstructionCardType` 为空，
 * writer/planner/critic 的类型过滤不会命中），只在卡组/本章使用卡里作为「可触发入口」
 * 存在；执行入口在 `server/helpers/knowledge-capabilities.ts`。
 */
function projectToolCapabilityAsset(
  id: string,
  novel: Novel,
  scope: 'project' | 'chapter'
): RuntimeSessionAsset | null {
  const manifest = capabilityManifestFor(id);
  if (!isRunnableToolManifest(manifest) || !manifest) return null;
  if (!manifest.allowedScopes.includes(scope)) return null;
  if (
    isMonetizationEnabled() &&
    manifest.sourceType === 'licensed' &&
    novel.projectPreferenceProfile?.commercialMode !== 'paid'
  ) {
    const scopeLabel = scope === 'project' ? '作品卡组' : '本章使用卡';
    throw new WritingStyleRequestError(
      403,
      'TOOL_CARD_FORBIDDEN',
      `当前作品无权使用这张${scopeLabel}`,
      id
    );
  }
  const catalog = PROMPT_GOVERNANCE_CATALOG.find((asset) => asset.id === id);
  const template = catalog?.template || resolveCuratedTechniquePrompt(id);
  if (!template) {
    throw new WritingStyleRequestError(
      400,
      'TOOL_CARD_NOT_RUNTIME_READY',
      '知识能力卡当前不可运行',
      id
    );
  }
  return {
    id,
    title: catalog?.title || id,
    template,
    tool: {
      kind: manifest.kind as 'utility' | 'diagnostic',
      action: manifest.action as 'run-utility' | 'run-diagnostic',
      stages: [...manifest.stages],
    },
    version: manifest.version,
    sourceBadge: manifest.sourceType,
    dimensionOwners: {},
    resolvedRules: { template },
    lineage: { catalogId: id, capabilityKind: manifest.kind },
    source: scope,
  };
}

function projectProjectSkillDeckAsset(id: string, novel: Novel): RuntimeSessionAsset {
  const manifest = capabilityManifestFor(id);
  if (
    !manifest ||
    manifest.kind !== 'skill-card' ||
    manifest.runtimeStatus !== 'active' ||
    !manifest.allowedScopes.includes('project')
  ) {
    throw new WritingStyleRequestError(
      400,
      'PROJECT_SKILL_CARD_SCOPE_INVALID',
      '作品卡组能力卡作用域或类型无效',
      id
    );
  }
  if (!isSupportedCardType(manifest.deconstructionCardType)) {
    throw new WritingStyleRequestError(
      400,
      'PROJECT_SKILL_CARD_TYPE_INVALID',
      '作品卡组能力卡类型无效',
      id
    );
  }
  const savedSkill = db.getSkill(id);
  if (savedSkill) {
    return { ...projectSavedSkill(savedSkill, novel), source: 'project' as const };
  }
  if (
    isMonetizationEnabled() &&
    manifest.sourceType === 'licensed' &&
    novel.projectPreferenceProfile?.commercialMode !== 'paid'
  ) {
    throw new WritingStyleRequestError(
      403,
      'PROJECT_SKILL_CARD_FORBIDDEN',
      '当前作品无权使用这张作品卡组能力卡',
      id
    );
  }
  const template = resolveCuratedTechniquePrompt(id);
  if (!template) {
    throw new WritingStyleRequestError(
      400,
      'PROJECT_SKILL_CARD_NOT_RUNTIME_READY',
      '作品卡组能力卡当前不可运行',
      id
    );
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
    throw new WritingStyleRequestError(
      409,
      'SKILL_LOADOUT_CONFIRMATION_REQUIRED',
      '能力需要先确认阶段位置'
    );
  }
  const readSlot = (slot: number) =>
    migrated.loadout
      .filter((entry) => entry.slot === slot)
      .map((entry) => db.getSkill(entry.skillId))
      .filter((skill): skill is Skill => Boolean(skill));
  return { planner: readSlot(0), writer: readSlot(1), critic: readSlot(2) };
}

function hasCapabilityV3(novel: Novel): boolean {
  return (
    novel.projectPreferenceProfile?.capabilityModelVersion === 3 &&
    novel.projectPreferenceProfile.capabilityProfile?.version === 3
  );
}

/** Validate a proposed v3 project profile without mutating the database. */
export function validateCapabilityProfile(novelId: string, value: unknown): string[] {
  if (!value || typeof value !== 'object')
    throw new WritingStyleRequestError(400, 'CAPABILITY_PROFILE_INVALID', '能力配置格式无效');
  const profile = value as Record<string, unknown>;
  if (profile.version !== 3)
    throw new WritingStyleRequestError(
      400,
      'CAPABILITY_PROFILE_VERSION_INVALID',
      '能力配置版本无效'
    );
  if (profile.activeFlowId !== undefined) {
    if (typeof profile.activeFlowId !== 'string' || !profile.activeFlowId.trim())
      throw new WritingStyleRequestError(400, 'CAPABILITY_FLOW_INVALID', '创作流程配置无效');
    const flowManifest = capabilityManifestFor(profile.activeFlowId);
    if (
      !flowManifest ||
      flowManifest.kind !== 'flow' ||
      flowManifest.runtimeStatus !== 'active' ||
      !flowManifest.allowedScopes.includes('project')
    ) {
      throw new WritingStyleRequestError(400, 'CAPABILITY_FLOW_UNAVAILABLE', '创作流程当前不可用');
    }
  }
  const deck = profile.projectSkillDeck;
  if (!deck || typeof deck !== 'object')
    throw new WritingStyleRequestError(400, 'PROJECT_SKILL_DECK_INVALID', '作品卡组格式无效');
  const deckRecord = deck as Record<string, unknown>;
  const supportIds = deckRecord.supportCardIds;
  if (
    !Array.isArray(supportIds) ||
    supportIds.length > PROJECT_DECK_MAX_SUPPORT_CARDS ||
    supportIds.some((id) => typeof id !== 'string' || !id.trim())
  ) {
    throw new WritingStyleRequestError(400, 'PROJECT_SKILL_DECK_INVALID', '作品卡组格式无效');
  }
  const mainId = deckRecord.mainCardId;
  if (mainId !== undefined && (typeof mainId !== 'string' || !mainId.trim()))
    throw new WritingStyleRequestError(400, 'PROJECT_SKILL_DECK_INVALID', '作品卡组格式无效');
  if (mainId === undefined && supportIds.length > 0)
    throw new WritingStyleRequestError(
      400,
      'PROJECT_SKILL_DECK_MAIN_REQUIRED',
      '存在副卡时必须显式选择主卡'
    );
  const ids = [mainId, ...supportIds]
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim());
  if (new Set(ids).size !== ids.length)
    throw new WritingStyleRequestError(
      400,
      'PROJECT_SKILL_DECK_DUPLICATE',
      '作品卡组能力卡不能重复'
    );
  for (const id of ids) {
    const manifest = capabilityManifestFor(id);
    // 批次 C：工具卡（utility/diagnostic + 运行类动作）可装配进作品卡组，
    // 作为「可触发入口」存在；它们没有 concept 卡型，不注入写作规则文本。
    if (isRunnableToolManifest(manifest) && manifest && manifest.allowedScopes.includes('project')) {
      continue;
    }
    if (
      manifest &&
      (manifest.kind !== 'skill-card' ||
        manifest.runtimeStatus !== 'active' ||
        !manifest.allowedScopes.includes('project'))
    ) {
      throw new WritingStyleRequestError(
        400,
        'PROJECT_SKILL_CARD_SCOPE_INVALID',
        '作品卡组能力卡作用域或类型无效',
        id
      );
    }
    if (manifest) {
      if (!isSupportedCardType(manifest.deconstructionCardType)) {
        throw new WritingStyleRequestError(
          400,
          'PROJECT_SKILL_CARD_TYPE_INVALID',
          '作品卡组能力卡类型无效',
          id
        );
      }
      continue;
    }
    const skill = db.getSkill(id);
    if (!skill)
      throw new WritingStyleRequestError(
        400,
        'PROJECT_SKILL_CARD_NOT_FOUND',
        '作品卡组能力卡不存在',
        id
      );
    projectSavedSkill(skill, db.getNovel(novelId) || ({ id: novelId } as Novel));
  }
  if (
    profile.favoriteTechniqueIds !== undefined &&
    (!Array.isArray(profile.favoriteTechniqueIds) ||
      profile.favoriteTechniqueIds.some((id) => typeof id !== 'string'))
  ) {
    throw new WritingStyleRequestError(400, 'CAPABILITY_TECHNIQUES_INVALID', '常用技法配置无效');
  }
  if (
    profile.projectTechniqueIds !== undefined &&
    (!Array.isArray(profile.projectTechniqueIds) ||
      profile.projectTechniqueIds.some((id) => typeof id !== 'string'))
  ) {
    throw new WritingStyleRequestError(
      400,
      'CAPABILITY_PROJECT_TECHNIQUES_INVALID',
      '作品默认技法配置无效'
    );
  }
  if (
    profile.guardrailIds !== undefined &&
    (!Array.isArray(profile.guardrailIds) ||
      profile.guardrailIds.some((id) => typeof id !== 'string'))
  ) {
    throw new WritingStyleRequestError(
      400,
      'CAPABILITY_GUARDRAILS_INVALID',
      '系统检查候选格式无效'
    );
  }
  for (const id of (profile.guardrailIds as string[] | undefined) || []) {
    const trimmed = id.trim();
    const manifest = capabilityManifestFor(trimmed);
    const catalogGuardrail = PROMPT_GOVERNANCE_CATALOG.find((asset) => asset.id === trimmed);
    const isDefaultGuardrail = Boolean(
      manifest?.kind === 'guardrail' &&
      manifest.runtimeStatus === 'active' &&
      manifest.allowedScopes.includes('system')
    );
    if (!isDefaultGuardrail && !isConfigurableGuardrailAsset(catalogGuardrail)) {
      throw new WritingStyleRequestError(
        400,
        'CAPABILITY_GUARDRAIL_UNAVAILABLE',
        '系统检查候选当前不可用',
        trimmed
      );
    }
  }
  if (
    profile.projectCards !== undefined &&
    (!Array.isArray(profile.projectCards) ||
      profile.projectCards.some((id) => typeof id !== 'string'))
  ) {
    throw new WritingStyleRequestError(
      400,
      'CAPABILITY_PROJECT_CARDS_INVALID',
      '作品装配卡片配置无效'
    );
  }
  if (
    profile.chapterCards !== undefined &&
    (!Array.isArray(profile.chapterCards) ||
      profile.chapterCards.some((id) => typeof id !== 'string'))
  ) {
    throw new WritingStyleRequestError(
      400,
      'CAPABILITY_CHAPTER_CARDS_INVALID',
      '章节装配卡片配置无效'
    );
  }
  if (profile.singleRunCard !== undefined && typeof profile.singleRunCard !== 'string') {
    throw new WritingStyleRequestError(
      400,
      'CAPABILITY_SINGLE_RUN_CARD_INVALID',
      '单次运行卡片配置无效'
    );
  }
  if (
    profile.capabilityMemberships !== undefined &&
    !Array.isArray(profile.capabilityMemberships)
  ) {
    throw new WritingStyleRequestError(
      400,
      'CAPABILITY_MEMBERSHIPS_INVALID',
      '能力来源记录格式无效'
    );
  }
  for (const item of (profile.capabilityMemberships as unknown[] | undefined) || []) {
    if (!item || typeof item !== 'object') {
      throw new WritingStyleRequestError(
        400,
        'CAPABILITY_MEMBERSHIPS_INVALID',
        '能力来源记录格式无效'
      );
    }
    const membership = item as Record<string, unknown>;
    const sourceId = typeof membership.sourceId === 'string' ? membership.sourceId.trim() : '';
    const sourceVersion =
      typeof membership.sourceVersion === 'string' ? membership.sourceVersion.trim() : '';
    const sourceType = membership.sourceType;
    const persistedSkillId =
      typeof membership.persistedSkillId === 'string' ? membership.persistedSkillId.trim() : '';
    if (
      !sourceId ||
      !sourceVersion ||
      !['built-in', 'plaza', 'licensed', 'book-extracted'].includes(String(sourceType))
    ) {
      throw new WritingStyleRequestError(
        400,
        'CAPABILITY_MEMBERSHIPS_INVALID',
        '能力来源记录格式无效'
      );
    }
    if (sourceType !== 'built-in' && !persistedSkillId) {
      throw new WritingStyleRequestError(
        400,
        'CAPABILITY_MEMBERSHIP_PERSISTENCE_REQUIRED',
        '非内置能力必须关联已持久化能力卡'
      );
    }
    if (sourceType === 'built-in') continue;
    const saved = db.getSkill(persistedSkillId);
    if (!saved) {
      throw new WritingStyleRequestError(
        400,
        'CAPABILITY_MEMBERSHIP_SKILL_NOT_FOUND',
        '能力来源对应的本地能力卡不存在',
        persistedSkillId
      );
    }
    const savedSourceId = saved.parentSkillId || saved.id;
    const sourceMatches = savedSourceId === sourceId && String(saved.version) === sourceVersion;
    // 治理重分类（如 plaza→built-in）会让 membership 里记录的来源类型过期；
    // 以 manifest 现值为准：本地卡与目录现值一致即视为匹配（过期副本在下次
    // 应用配置时自愈），仅"本地卡与目录都不认可"才判失配。
    const typeMatches =
      sourceType === 'book-extracted'
        ? saved.sourceBadge === 'book-extracted'
        : saved.sourceType === sourceType ||
          capabilityManifestFor(savedSourceId)?.sourceType === saved.sourceType;
    if (!sourceMatches || !typeMatches) {
      throw new WritingStyleRequestError(
        400,
        'CAPABILITY_MEMBERSHIP_MISMATCH',
        '能力来源与本地能力卡不匹配',
        persistedSkillId
      );
    }
  }
  // 技法收藏是偏好不是刚性依赖：失效引用降级为 warnings，不再 400 锁死整个配置。
  const warnings: string[] = [];
  if (profile.favoriteTechniqueIds !== undefined) {
    warnings.push(
      ...buildTechniquesResilient(
        resolveFavoriteTechniqueIdsFromProfile(profile, profile.favoriteTechniqueIds as string[])
      ).warnings
    );
  }
  if (profile.projectTechniqueIds !== undefined) {
    warnings.push(
      ...buildTechniquesResilient(
        resolveFavoriteTechniqueIdsFromProfile(profile, profile.projectTechniqueIds as string[])
      ).warnings
    );
  }
  return warnings;
}

function resolveFavoriteTechniqueIdsFromProfile(
  profile: Record<string, unknown>,
  favoriteTechniqueIds: string[]
): string[] {
  const membershipByPersistedId = new Map(
    (
      (Array.isArray(profile.capabilityMemberships)
        ? profile.capabilityMemberships
        : []) as unknown[]
    )
      .filter((item): item is Record<string, unknown> => {
        if (!item || typeof item !== 'object') return false;
        return typeof (item as Record<string, unknown>).persistedSkillId === 'string';
      })
      .map((item) => [(item.persistedSkillId as string).trim(), item])
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

function resolveProjectSkillDeck(novel: Novel): {
  mainCard: RuntimeSessionAsset | null;
  supportCards: RuntimeSessionAsset[];
  all: RuntimeSessionAsset[];
} {
  if (!hasCapabilityV3(novel)) return { mainCard: null, supportCards: [], all: [] };
  const deck = novel.projectPreferenceProfile!.capabilityProfile!.projectSkillDeck;
  const supportIds = Array.isArray(deck.supportCardIds) ? deck.supportCardIds : [];
  if (
    (deck.mainCardId !== undefined && typeof deck.mainCardId !== 'string') ||
    supportIds.some((id) => typeof id !== 'string')
  ) {
    throw new WritingStyleRequestError(400, 'PROJECT_SKILL_DECK_INVALID', '作品卡组格式无效');
  }
  const ids = [deck.mainCardId, ...supportIds].filter(
    (id): id is string => typeof id === 'string' && id.trim().length > 0
  );
  const uniqueIds = [...new Set(ids.map((id) => id.trim()))];
  if (uniqueIds.length !== ids.length)
    throw new WritingStyleRequestError(
      400,
      'PROJECT_SKILL_DECK_DUPLICATE',
      '作品卡组能力卡不能重复'
    );
  if (supportIds.length > PROJECT_DECK_MAX_SUPPORT_CARDS)
    throw new WritingStyleRequestError(
      400,
      'PROJECT_SKILL_DECK_TOO_MANY_SUPPORTS',
      `作品卡组最多${PROJECT_DECK_MAX_SUPPORT_CARDS}张副卡`
    );
  const cards = uniqueIds.map((id) => {
    const skill = db.getSkill(id);
    if (skill) {
      try {
        // Plan 259：白标占位克隆先经运行时还原，避免占位符直入 writer 合同与总览。
        const [resolvedSkill] = resolveRuntimeCuratedPrompts([skill]);
        return { ...projectSavedSkill(resolvedSkill, novel), source: 'project' as const };
      } catch (error) {
        if (error instanceof WritingStyleRequestError) {
          throw new WritingStyleRequestError(
            error.status,
            `PROJECT_${error.code}`,
            error.message,
            id
          );
        }
        throw error;
      }
    }
    const toolAsset = projectToolCapabilityAsset(id, novel, 'project');
    if (toolAsset) return toolAsset;
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
      if (
        !asset.isRuntimeReady ||
        asset.runtimeStatus !== 'active' ||
        asset.sanitizationStatus !== 'runtime-ready'
      ) {
        throw new WritingStyleRequestError(
          400,
          'SESSION_CARD_NOT_RUNTIME_READY',
          '本章使用卡当前不可运行',
          id
        );
      }
      if (
        asset.licenseStatus === 'unknown' ||
        asset.processDecision === 'reject' ||
        asset.processDecision === 'research-only'
      ) {
        throw new WritingStyleRequestError(
          403,
          'SESSION_CARD_UNAUTHORIZED',
          '本章使用卡未获运行授权',
          id
        );
      }
      if (
        isMonetizationEnabled() &&
        asset.sourceType === 'licensed' &&
        novel.projectPreferenceProfile?.commercialMode !== 'paid'
      ) {
        throw new WritingStyleRequestError(
          403,
          'SESSION_CARD_FORBIDDEN',
          '当前作品无权使用这张本章使用卡',
          id
        );
      }
      // 批次 C：工具卡（knowledge-extract / foreshadow-settle 等）没有卡型，
      // 在写作规则卡投影之前先按「可触发工具」投影，避免误报 UNKNOWN_SESSION_CARD_TYPE。
      const toolAsset = projectToolCapabilityAsset(id, novel, 'chapter');
      if (toolAsset) return toolAsset;
      return { ...projectCatalogAsset(asset), source: 'chapter' as const };
    }
    const catalogSkillCard = projectActiveCatalogSkillCard(id, novel, 'chapter');
    if (catalogSkillCard) return { ...catalogSkillCard, source: 'chapter' as const };
    // 未登记进治理货架、但有工具 manifest 的能力卡同样可解析（保持与卡组路径一致）。
    const orphanToolAsset = PROMPT_GOVERNANCE_CATALOG.some((asset) => asset.id === id)
      ? null
      : projectToolCapabilityAsset(id, novel, 'chapter');
    if (orphanToolAsset) return orphanToolAsset;
    const savedSkill = db.getSkill(id);
    if (!savedSkill)
      throw new WritingStyleRequestError(400, 'UNKNOWN_SESSION_CARD', '本章使用卡不存在', id);
    try {
      // Plan 259：与卡组路径同口径，占位克隆先还原再投影。
      const [resolvedSkill] = resolveRuntimeCuratedPrompts([savedSkill]);
      return { ...projectSavedSkill(resolvedSkill, novel), source: 'chapter' as const };
    } catch (error) {
      if (error instanceof WritingStyleRequestError && !error.sessionCardId) {
        throw new WritingStyleRequestError(error.status, error.code, error.message, id);
      }
      throw error;
    }
  });
}

function buildCriticPrompt(
  snapshot: WritingStyleSnapshot,
  packStyle: Record<string, unknown> | undefined,
  writerSessionAssets: RuntimeSessionAsset[],
  criticSkill: Skill | undefined,
  flowPrompt?: string
): string {
  const summary = [
    `【写法契约标准】模式：${snapshot.mode}（${MODE_LABELS[snapshot.mode]}）`,
    `项目基调：${snapshot.styleAnchors.join(' / ') || '系统默认'}`,
    packStyle ? `资料包 styleProfile：${JSON.stringify(packStyle)}` : '资料包 styleProfile：无',
    '本章写法卡仅作为写作规则补充；审查只检查其规则是否被遵守，不读取主笔能力卡原文。',
    writerSessionAssets.length > 0
      ? `本章写法卡规则：\n${writerSessionAssets.map((asset) => `【${asset.title}】\n${asset.template}`).join('\n\n')}`
      : '本章写法卡：无',
  ].join('\n');
  const criticSkillPrompt = criticSkill
    ? `【Critic Slot 2 规则】\n${buildWriterRules(criticSkill)}`
    : '';
  return [summary, flowPrompt ? `【当前流程步骤】\n${flowPrompt}` : '', criticSkillPrompt]
    .filter(Boolean)
    .join('\n\n');
}

function buildWriterRules(writerSkill: Skill | undefined): string {
  if (!writerSkill) return '';
  const rules: Record<string, unknown> = {};
  for (const key of [
    'style',
    'pacing',
    'vocabulary',
    'sentenceStructure',
    'imagery',
    'bannedWords',
    'characterTraits',
    'plotPattern',
  ]) {
    const value = writerSkill[key as keyof Skill];
    if (value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0))
      rules[key] = value;
  }
  return Object.keys(rules).length > 0 ? `【Writer 已解析写法规则】\n${JSON.stringify(rules)}` : '';
}

function buildWriterContractPrompt(
  snapshot: WritingStyleSnapshot,
  writerSkill: Skill | undefined,
  packStyle: Record<string, unknown> | undefined,
  writerSessionAssets: RuntimeSessionAsset[],
  flowPrompt?: string
): string {
  const priorityPolicy: Record<WritingStyleMode, string> = {
    default: '项目基调 > 系统默认笔调',
    'skill-deck': '项目基调 > 作品卡组 > 本章使用卡 > 资料包',
    'writer-skill': '项目基调 > 主笔能力卡 > 资料包',
    'continuation-pack': '项目基调 > 资料包 > 主笔能力卡',
    blend:
      '项目基调保持最高优先级；资料包负责 POV、时态和避免项；主笔能力卡负责句法、词汇和意象；节奏卡作为共同覆盖层。',
  };
  const anchors =
    snapshot.styleAnchors.length > 0 ? `【项目基调】\n${snapshot.styleAnchors.join(' / ')}` : '';
  const pack = packStyle ? `【资料包写法】\n${JSON.stringify(packStyle)}` : '';
  const overlays =
    writerSessionAssets.length > 0
      ? `【本章写法卡规则】\n${writerSessionAssets.map((asset) => `【${asset.title}】\n${asset.template}`).join('\n\n')}`
      : '';
  return [
    anchors,
    `【写法优先级】\n${priorityPolicy[snapshot.mode]}`,
    flowPrompt ? `【当前流程步骤】\n${flowPrompt}` : '',
    buildWriterRules(writerSkill),
    pack,
    overlays,
  ]
    .filter(Boolean)
    .join('\n\n');
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
    sourceMap: {
      sections: copy.sourceMap?.sections || [],
      keyConflicts: copy.sourceMap?.keyConflicts || [],
    },
    readingQuestions: copy.readingQuestions || [],
    continuationGaps: copy.continuationGaps || [],
  };
}

function projectRoleSkills(stageSkills: { planner: Skill[]; writer: Skill[]; critic: Skill[] }): {
  planner: RoleSkillSnapshot[];
  writer: RoleSkillSnapshot[];
  critic: RoleSkillSnapshot[];
} {
  const project = (stage: CapabilityStage, skills: Skill[]): RoleSkillSnapshot[] =>
    skills.map((skill) => {
      const rules: Record<string, unknown> = {};
      for (const key of [
        'style',
        'pacing',
        'vocabulary',
        'sentenceStructure',
        'imagery',
        'bannedWords',
        'characterTraits',
        'plotPattern',
      ]) {
        const value = skill[key as keyof Skill];
        if (value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0))
          rules[key] = value;
      }
      return { stage, version: skill.version, rules };
    });
  return {
    planner: project('planner', stageSkills.planner),
    writer: project('writer', stageSkills.writer),
    critic: project('critic', stageSkills.critic),
  };
}

function freezeExecutionSnapshot(snapshot: ExecutionSnapshot): ExecutionSnapshot {
  return deepFreeze({
    ...snapshot,
    stageSkills: {
      planner: [...snapshot.stageSkills.planner],
      writer: [...snapshot.stageSkills.writer],
      critic: [...snapshot.stageSkills.critic],
    },
    roleSkills: {
      planner: [...snapshot.roleSkills.planner],
      writer: [...snapshot.roleSkills.writer],
      critic: [...snapshot.roleSkills.critic],
    },
    sessionCards: [...snapshot.sessionCards],
    overlays: [...snapshot.overlays],
    guardrails: [...snapshot.guardrails],
    stagePrompts: { ...snapshot.stagePrompts },
  });
}

function stagesForAsset(asset: RuntimeSessionAsset | GovernedPromptAsset): CapabilityStage[] {
  if (asset.deconstructionCardType && asset.deconstructionCardType in CARD_STAGE_MAP)
    return [...CARD_STAGE_MAP[asset.deconstructionCardType]];
  const stageMap: Record<string, CapabilityStage> = {
    discovery: 'planner',
    foundation: 'planner',
    planning: 'planner',
    drafting: 'writer',
    polish: 'writer',
    review: 'critic',
  };
  const stage = 'stage' in asset ? stageMap[asset.stage] : undefined;
  return stage ? [stage] : [];
}

/**
 * 批次 C：ExecutionOverlay.type 是必填字符串；工具卡没有卡型，用 `tool:<kind>`
 * 显式标注，避免把工具卡伪装成写作规则卡型。
 */
function runtimeAssetType(asset: RuntimeSessionAsset): string {
  if (asset.deconstructionCardType) return asset.deconstructionCardType;
  return asset.tool ? `tool:${asset.tool.kind}` : 'unknown-card';
}

function stageForGovernedAsset(asset: GovernedPromptAsset): CapabilityStage | null {
  const stageMap: Record<string, CapabilityStage> = {
    discovery: 'planner',
    foundation: 'planner',
    planning: 'planner',
    drafting: 'writer',
    polish: 'writer',
    review: 'critic',
  };
  return stageMap[asset.stage] || null;
}

function isRuntimePromptAsset(
  asset: GovernedPromptAsset | undefined
): asset is GovernedPromptAsset {
  return Boolean(asset) && isRuntimeReadyAsset(asset);
}

function isConfigurableGuardrailAsset(
  asset: GovernedPromptAsset | undefined
): asset is GovernedPromptAsset {
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
  const assetRunnable = isRuntimeReadyAsset(asset);
  // Plan 261 修复⑬：壳资产不注入流程步骤 prompt——小飞鸡流程的"脑洞灵感闪耀"
  // 步骤资产是引用壳，挂到 writer 阶段等于让写手收到"围绕书名简介引擎执行"
  // 的错位指令（run S/T 崩坏主因之一）。
  const assetIsShell = isShellTemplatePrompt(asset?.template);
  const assetUsable = assetRunnable && !assetIsShell;
  // 批次 B「步骤卡片槽位」：cardRef 优先，失败/缺省回退上方 assetId 路径（后者逐字节不变）。
  const cardAttempt = resolveFlowStepCard(step);
  const card = cardAttempt.resolution;
  const stepContract = [
    `【流程步骤：${step.name}】`,
    `【步骤输入】${step.input}`,
    `【预期输出】${step.output}`,
    `【质量门】${step.qualityGate}`,
  ].join('\n');
  const assetPrompt = assetUsable
    ? `${stepContract}\n【可运行资产 Prompt】\n${asset?.template || ''}`
    : stepContract;
  const cardBlock = card ? renderFlowStepCardBlock(card, stepContract) : undefined;
  const stagePrompts =
    card && cardBlock
      ? (Object.fromEntries(
          card.stages.map((stage) => [stage, cardBlock])
        ) as Readonly<Partial<Record<CapabilityStage, string>>>)
      : undefined;
  // 槽位声明的元数据始终记录（含解析失败）：卡 ID/角色/诊断可见，注入与否由 stagePrompts 表达。
  const declaredCardId = typeof step.cardRef?.cardId === 'string' ? step.cardRef.cardId.trim() : '';
  // 批次 B「步骤阶段语义化」：阶段以 `step.stage` 声明为准，不再由资产 stage 决定注入面
  // （此前 30 步里 25 步因资产是 polish 而落到 writer）。未声明 → 回退资产 stage 并记诊断。
  const stageResolution = resolveFlowStepStage(step, {
    assetStage: asset ? stageForGovernedAsset(asset) : null,
  });
  // 批次 B「空壳链路清账」：把「资产是引用壳」这件事显式化到运行时（声明 → guidance；
  // 未声明的壳 → unavailable + 诊断，不再静默）。
  const guidanceResolution = resolveFlowStepAvailability({
    guidanceOnly: step.guidanceOnly,
    assetRunnable,
    assetIsShell,
  });
  return {
    activeFlowId: activeSeriesId,
    currentStep: step.id,
    name: step.name,
    input: step.input,
    output: step.output,
    availability: guidanceResolution.availability,
    guidanceOnly: guidanceResolution.declared,
    ...(guidanceResolution.warnings.length > 0
      ? { guidanceWarning: guidanceResolution.warnings.join(',') }
      : {}),
    stage: stageResolution.stage,
    stageSource: stageResolution.source,
    ...(stageResolution.warnings.length > 0
      ? { stageWarning: stageResolution.warnings.join(',') }
      : {}),
    assetId: step.assetId,
    qualityGate: step.qualityGate,
    // prompt 语义保持「步骤资产注入文本」（未挂卡时的旧行为逐字节不变）；
    // 挂卡后的卡片正文按声明阶段落在 stagePrompts，未声明阶段回退本字段。
    prompt: assetPrompt,
    ...(stagePrompts ? { stagePrompts } : {}),
    ...(declaredCardId
      ? {
          cardId: declaredCardId,
          cardRole: card?.role ?? step.cardRef?.role,
          ...(card ? { cardStages: card.stages } : {}),
        }
      : {}),
    ...(card
      ? card.warning
        ? { cardWarning: card.warning }
        : {}
      : cardAttempt.warning
        ? { cardWarning: cardAttempt.warning }
        : {}),
    ...(assetUsable
      ? {}
      : assetRunnable
        ? { warning: 'FLOW_STEP_ASSET_SHELL' }
        : { warning: 'FLOW_STEP_ASSET_UNAVAILABLE' }),
  };
}

/**
 * Plan 261 修复⑧⑬：壳卡判定——"[XX体] 围绕 X 执行"式引用壳（<80 字、无实际
 * 写作指导）。这类卡治理面标 isRuntimeReady=true，但内容只是对另一个不存在的
 * 提示词名的转投；装备为技法或注入阶段 prompt 都只会制造噪音，诱发模型抄录
 * 结构化材料。真卡（含 55-66 字短指令）实测零误伤。
 *
 * 批次 B：实现迁至 shared/lib/prompt-shell.ts（shared 不得反向依赖 server），此处保留导出面。
 */
export { isShellTemplatePrompt };

function buildGuardrails(novel: Novel): ExecutionGuardrail[] {
  const configuredIds = hasCapabilityV3(novel)
    ? novel.projectPreferenceProfile?.capabilityProfile?.guardrailIds || []
    : [];
  const configured = configuredIds
    .filter((id) => id !== 'default-guardrail')
    .map((id) => PROMPT_GOVERNANCE_CATALOG.find((asset) => asset.id === id))
    .filter(isConfigurableGuardrailAsset);
  const assets = [
    ...PROMPT_GOVERNANCE_CATALOG.filter(
      (asset) => asset.placementTier === 'core-default' && isRuntimePromptAsset(asset)
    ),
    ...configured,
  ];
  const seen = new Set<string>();
  return assets
    .flatMap((asset) =>
      stagesForAsset(asset).map((stage) => ({ id: asset.id, stage, prompt: asset.template }))
    )
    // Plan 261 修复⑬：壳卡不进护栏通道——writer 曾同时收到"围绕逻辑检测分析器
    // 执行""围绕书名简介引擎执行"等互相矛盾的引用壳指令（run S/T 崩坏主因）。
    .filter((guardrail) => !isShellTemplatePrompt(guardrail.prompt))
    .filter((guardrail) => {
      const key = `${guardrail.id}\u0000${guardrail.stage}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildTechniquesResilient(ids: string[]): {
  techniques: ExecutionTechniques;
  warnings: string[];
} {
  const warnings: string[] = [];
  const techniqueIds = [
    ...new Set(ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)),
  ];
  const result: Record<CapabilityStage, ExecutionTechnique[]> = {
    planner: [],
    writer: [],
    critic: [],
  };
  for (const id of techniqueIds) {
    const manifest = capabilityManifestFor(id);
    if (!manifest) {
      warnings.push(`TECHNIQUE_UNRESOLVED:${id}`);
      continue;
    }
    if (manifest.kind !== 'technique') {
      warnings.push(`TECHNIQUE_KIND_INVALID:${id}`);
      continue;
    }
    if (manifest.runtimeStatus !== 'active') {
      warnings.push(`TECHNIQUE_NOT_RUNTIME_READY:${id}`);
      continue;
    }
    // Plan 259 后续：消毒副本（sanitized-*）同样可作为技法运行——
    // 它们的运行时正文在 SANITIZED_SKILL_COPIES（模板真实且已消毒），此前从未接入技法解析。
    const catalog = PROMPT_GOVERNANCE_CATALOG.find((asset) => asset.id === id)
      ?? SANITIZED_SKILL_COPIES.find((asset: { id: string }) => asset.id === id);
    const runtimePrompt = resolveRuntimeCuratedPrompts([
      {
        id,
        parentSkillId: id,
        style: 'INKFLOW_CURATED_RUNTIME_DECOUPLED_PLACEHOLDER',
        pacing: '',
        description: '',
      },
    ])[0]?.style;
    const prompt =
      typeof runtimePrompt === 'string' &&
      runtimePrompt !== 'INKFLOW_CURATED_RUNTIME_DECOUPLED_PLACEHOLDER'
        ? runtimePrompt
        : catalog?.template;
    const canRun = catalog ? Boolean(isRuntimeReadyAsset(catalog) && prompt) : Boolean(prompt);
    if (!canRun) {
      warnings.push(`TECHNIQUE_NOT_RUNTIME_READY:${id}`);
      continue;
    }
    // Plan 261 修复⑧：壳卡不进技法通道（判定与护栏通道共用 isShellTemplatePrompt）。
    if (isShellTemplatePrompt(prompt)) {
      warnings.push(`SHELL_CARD_SKIPPED:${id}`);
      continue;
    }
    for (const stage of manifest.stages) {
      result[stage].push({
        id,
        stage,
        version: manifest.version,
        prompt: prompt || '',
        outputArtifact: manifest.outputArtifact,
      });
    }
  }
  // Plan 260 后续：技法 prompt 预算——按优先级排序后，单阶段总字数超出预算时
  // 从尾部截断（低优先级技法被跳过），防止 prompt 污染和风格互扰。
  // Plan 260 后续②：同阶段技法数量上限——卡太多时模型无法同时满足所有风格指令。
  const TECHNIQUE_PROMPT_BUDGET = 4000;
  const MAX_TECHNIQUES_PER_STAGE = 6;
  for (const stage of ['planner', 'writer', 'critic'] as const) {
    let totalLen = 0;
    const kept: ExecutionTechnique[] = [];
    for (const t of result[stage]) {
      if (kept.length >= MAX_TECHNIQUES_PER_STAGE) {
        warnings.push(`TECHNIQUE_BUDGET_EXCEEDED:${t.id}`);
        continue;
      }
      const pLen = (t.prompt || '').length;
      if (totalLen + pLen > TECHNIQUE_PROMPT_BUDGET && kept.length > 0) {
        warnings.push(`TECHNIQUE_BUDGET_EXCEEDED:${t.id}`);
        continue;
      }
      totalLen += pLen;
      kept.push(t);
    }
    result[stage] = kept;
  }
  return { techniques: result, warnings };
}

/** Plan 260：装配角色的注入桶序——base 优先，其次 accent，再次 seasonal，未标注殿后。 */
const TECHNIQUE_ROLE_BUCKET: Record<TechniquePriorityRole, number> = {
  base: 0,
  accent: 1,
  seasonal: 2,
};

/** Plan 260：planner/writer 段内技法 prompt 的角色标注前缀。 */
const TECHNIQUE_ROLE_LABELS: Record<TechniquePriorityRole, string> = {
  base: '基调技法',
  accent: '强化技法',
  seasonal: '季节技法',
};

function normalizeTechniquePriorityRoles(
  priorities: TechniquePriority[] | undefined
): Map<string, TechniquePriorityRole> {
  const roleByRawId = new Map<string, TechniquePriorityRole>();
  for (const priority of priorities || []) {
    if (!priority || typeof priority.id !== 'string') continue;
    const id = priority.id.trim();
    const role = priority.role;
    if (!id || (role !== 'base' && role !== 'accent' && role !== 'seasonal')) continue;
    roleByRawId.set(id, role);
  }
  return roleByRawId;
}

/**
 * Plan 260：按装配优先度排序作品技法——base → accent(order) → seasonal(order) →
 * 未标注按原序。未标注的作品技法视为 accent（order 取原数组下标）。无 priorities
 * 时原样返回，注入行为与旧版逐字节一致（向后兼容）。
 */
function sortTechniqueIdsByPriority(
  ids: string[],
  priorities: TechniquePriority[] | undefined,
  roleByRawId: Map<string, TechniquePriorityRole>
): string[] {
  if (!priorities || priorities.length === 0) return ids;
  const orderByRawId = new Map<string, number>();
  for (const priority of priorities) {
    if (priority && typeof priority.id === 'string' && Number.isFinite(priority.order)) {
      orderByRawId.set(priority.id.trim(), priority.order);
    }
  }
  return ids
    .map((id, index) => ({
      id,
      index,
      role: roleByRawId.get(id) ?? ('accent' as const),
      order: orderByRawId.get(id) ?? index,
    }))
    .sort((a, b) => {
      const bucket = TECHNIQUE_ROLE_BUCKET[a.role] - TECHNIQUE_ROLE_BUCKET[b.role];
      if (bucket !== 0) return bucket;
      if (a.order !== b.order) return a.order - b.order;
      return a.index - b.index;
    })
    .map((item) => item.id);
}

/**
 * Plan 260：解析作品默认技法（含优先度）。ids 为排序后的运行时技法 ID；
 * roleById 以运行时 id 为键（含持久化卡回溯源 ID 的映射），供注入 prompt 时标注角色。
 * 无 priorities 字段时 roleById 为空 Map，装配行为与旧版完全一致。
 */
function resolveProjectTechniquePlan(novel: Novel): {
  ids: string[];
  roleById: Map<string, TechniquePriorityRole>;
} {
  if (!hasCapabilityV3(novel)) return { ids: [], roleById: new Map() };
  const profile = novel.projectPreferenceProfile!.capabilityProfile!;
  const membershipByPersistedId = new Map(
    (profile.capabilityMemberships || [])
      .filter((membership) => membership.persistedSkillId)
      .map((membership) => [membership.persistedSkillId!, membership])
  );
  const priorities = profile.techniquePriorities;
  const roleByRawId = normalizeTechniquePriorityRoles(priorities);
  const rawIds = sortTechniqueIdsByPriority(
    profile.projectTechniqueIds ?? profile.favoriteTechniqueIds ?? [],
    priorities,
    roleByRawId
  );
  const roleById = new Map<string, TechniquePriorityRole>();
  const hasPriorities = Boolean(priorities && priorities.length > 0);
  const ids = rawIds.map((id) => {
    let resolved = id;
    const manifest = capabilityManifestFor(id);
    if (manifest?.kind !== 'technique') {
      const membership = membershipByPersistedId.get(id);
      if (membership) {
        const sourceManifest = capabilityManifestFor(membership.sourceId);
        if (sourceManifest?.kind === 'technique') resolved = membership.sourceId;
      }
    }
    const role = roleByRawId.get(id) ?? (hasPriorities ? 'accent' : undefined);
    if (role) roleById.set(resolved, role);
    return resolved;
  });
  return { ids, roleById };
}

function resolveChapterCapabilityState(
  novelId: string,
  chapterId: string | undefined,
  currentGeneration: number
): { techniqueIds: string[]; overlayCardIds: string[] } {
  if (!chapterId) return { techniqueIds: [], overlayCardIds: [] };
  const chapter = db.getChapter(chapterId);
  if (!chapter) throw new WritingStyleRequestError(404, 'CHAPTER_NOT_FOUND', '章节不存在');
  if (chapter.novelId !== novelId)
    throw new WritingStyleRequestError(403, 'CHAPTER_SCOPE_MISMATCH', '章节不属于当前作品');
  const state = chapter.workflowMeta?.capabilityState;
  if (state?.novelId !== undefined && state.novelId !== novelId) {
    throw new WritingStyleRequestError(403, 'CHAPTER_SCOPE_MISMATCH', '章节能力状态不属于当前作品');
  }
  if (state && (state.novelId === undefined || !Number.isInteger(state.databaseGeneration))) {
    throw new WritingStyleRequestError(
      409,
      'DATABASE_GENERATION_STALE',
      '章节能力状态已过期，请刷新后重试'
    );
  }
  if (state?.databaseGeneration !== undefined && state.databaseGeneration !== currentGeneration) {
    throw new WritingStyleRequestError(
      409,
      'DATABASE_GENERATION_STALE',
      '章节能力状态已过期，请刷新后重试'
    );
  }
  const ids = state?.techniqueIds;
  const overlayIds = state?.overlayCardIds;
  if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')))
    throw new WritingStyleRequestError(400, 'CHAPTER_TECHNIQUES_INVALID', '章节技法配置无效');
  if (
    overlayIds !== undefined &&
    (!Array.isArray(overlayIds) || overlayIds.some((id) => typeof id !== 'string'))
  )
    throw new WritingStyleRequestError(400, 'CHAPTER_OVERLAYS_INVALID', '本章使用卡配置无效');
  const techniqueVersions = state?.techniqueVersions || {};
  const overlayVersions = state?.overlayVersions || {};
  const checkVersion = (
    id: string,
    expected: string | number | undefined,
    actual: string | number | undefined,
    code: string
  ) => {
    if (expected === undefined || actual === undefined || String(expected) !== String(actual)) {
      throw new WritingStyleRequestError(409, code, '章节能力版本已变化，请刷新后重试', id);
    }
  };
  for (const id of Array.isArray(ids) ? ids : []) {
    const manifest = capabilityManifestFor(id);
    if (!manifest || manifest.kind !== 'technique')
      throw new WritingStyleRequestError(
        400,
        'CAPABILITY_KIND_INVALID',
        '章节能力不是阶段技法',
        id
      );
    if (!manifest.allowedScopes.includes('chapter'))
      throw new WritingStyleRequestError(
        400,
        'CAPABILITY_SCOPE_INVALID',
        '阶段技法不允许用于章节',
        id
      );
    if (manifest.runtimeStatus !== 'active')
      throw new WritingStyleRequestError(
        409,
        'CAPABILITY_NOT_RUNTIME_READY',
        '阶段技法当前不可运行',
        id
      );
    checkVersion(id, techniqueVersions[id], manifest.version, 'CAPABILITY_VERSION_STALE');
  }
  for (const id of Array.isArray(overlayIds) ? overlayIds : []) {
    const manifest = capabilityManifestFor(id);
    const saved = db.getSkill(id);
    const actual = manifest?.kind === 'skill-card' ? manifest.version : saved?.version;
    if (!manifest && !saved)
      throw new WritingStyleRequestError(400, 'CAPABILITY_KIND_INVALID', '本章使用卡不存在', id);
    if (manifest && manifest.kind !== 'skill-card')
      throw new WritingStyleRequestError(400, 'CAPABILITY_KIND_INVALID', '章节能力不是能力卡', id);
    if (manifest && !manifest.allowedScopes.includes('chapter'))
      throw new WritingStyleRequestError(
        400,
        'CAPABILITY_SCOPE_INVALID',
        '能力卡不允许用于章节',
        id
      );
    if (manifest && manifest.runtimeStatus !== 'active')
      throw new WritingStyleRequestError(
        409,
        'CAPABILITY_NOT_RUNTIME_READY',
        '能力卡当前不可运行',
        id
      );
    checkVersion(id, overlayVersions[id], actual, 'CAPABILITY_VERSION_STALE');
  }
  return {
    techniqueIds: Array.isArray(ids) ? ids : [],
    overlayCardIds: Array.isArray(overlayIds) ? overlayIds : [],
  };
}

function buildSkillStack(
  projectDeck: {
    mainCard: RuntimeSessionAsset | null;
    supportCards: RuntimeSessionAsset[];
    all: RuntimeSessionAsset[];
  },
  chapterCards: RuntimeSessionAsset[]
): ExecutionSkillStack {
  const toOverlay = (
    asset: RuntimeSessionAsset,
    position: ExecutionOverlay['position']
  ): ExecutionOverlay => ({
    id: asset.id,
    version: asset.version,
    source: asset.sourceBadge,
    position,
    type: runtimeAssetType(asset),
    stages: stagesForAsset(asset),
    prompt: asset.template,
    dimensionOwners: asset.dimensionOwners,
    resolvedRules: asset.resolvedRules,
    lineage: asset.lineage,
  });
  return {
    mainCard: projectDeck.mainCard ? toOverlay(projectDeck.mainCard, 'project-main') : null,
    projectSupportCards: projectDeck.supportCards.map((asset) =>
      toOverlay(asset, 'project-support')
    ),
    chapterCards: chapterCards.map((asset) => toOverlay(asset, 'chapter')),
    effectiveCards: [
      ...(projectDeck.mainCard ? [toOverlay(projectDeck.mainCard, 'project-main')] : []),
      ...projectDeck.supportCards.map((asset) => toOverlay(asset, 'project-support')),
      ...chapterCards.map((asset) => toOverlay(asset, 'chapter')),
    ],
  };
}

/**
 * Plan 260：技法 prompt 注入格式。带装配角色的技法在 planner/writer 段内以
 * 【基调技法/强化技法/季节技法】标注（仅 base 用「基调」）；无角色（如本章技法）
 * 与 critic 段保持旧版【阶段技法】格式，保证无 priorities 时不改一字节。
 */
function buildTechniquePrompt(
  techniques: readonly ExecutionTechnique[],
  roleById?: ReadonlyMap<string, TechniquePriorityRole>
): string {
  return techniques
    .map((technique) => {
      const role = roleById?.get(technique.id);
      const label =
        role && (technique.stage === 'planner' || technique.stage === 'writer')
          ? TECHNIQUE_ROLE_LABELS[role]
          : '阶段技法';
      return `【${label}：${technique.id}】\n${technique.prompt}`;
    })
    .join('\n\n');
}

function summarizeSources(
  snapshot: WritingStyleSnapshot,
  writerSkill: Skill | undefined,
  projectDeckAssets: RuntimeSessionAsset[],
  packId: string | undefined,
  packStatus: 'draft' | 'approved' | undefined,
  sessionAssets: RuntimeSessionAsset[]
): WritingStyleSourceSummary[] {
  const sources: WritingStyleSourceSummary[] = [];
  if (snapshot.styleAnchors.length > 0)
    sources.push({ kind: 'project-tone', label: snapshot.styleAnchors.join(' / ') });
  if (writerSkill)
    sources.push({
      kind: 'writer-skill',
      id: writerSkill.id,
      label: writerSkill.version ? `${writerSkill.name} v${writerSkill.version}` : writerSkill.name,
      version: writerSkill.version,
    });
  if (projectDeckAssets.length > 0)
    sources.push({
      kind: 'skill-deck',
      id: projectDeckAssets[0].id,
      label: `作品卡组：${projectDeckAssets.map((asset) => asset.title).join('、')}`,
    });
  if (packId && packStatus)
    sources.push({
      kind: 'continuation-pack',
      id: packId,
      label: packStatus === 'draft' ? '未确认资料包' : '资料包',
      status: packStatus,
    });
  for (const asset of sessionAssets.filter(
    (item) =>
      item.source !== 'project' && WRITER_SESSION_CARD_TYPES.has(item.deconstructionCardType || '')
  )) {
    sources.push({ kind: 'writer-session', id: asset.id, label: asset.title });
  }
  if (sources.length === 0) sources.push({ kind: 'default', label: MODE_LABELS.default });
  return sources;
}

function buildSummary(mode: WritingStyleMode, sources: WritingStyleSourceSummary[]): string {
  const labels = sources
    .map((source) => source.label)
    .filter((label): label is string => Boolean(label));
  return labels.length > 0 && sources[0]?.kind !== 'default'
    ? `${MODE_LABELS[mode]}：${labels.join(' · ')}`
    : MODE_LABELS.default;
}

function buildWriterPrompt(
  snapshot: WritingStyleSnapshot,
  writerSkill: Skill | undefined,
  packStyle: Record<string, unknown> | undefined,
  sessionAssets: RuntimeSessionAsset[]
): string {
  const blocks: string[] = [];
  if (snapshot.styleAnchors.length > 0)
    blocks.push(
      `【项目基调（最高优先级）】\n${snapshot.styleAnchors.map((item) => `- ${item}`).join('\n')}`
    );
  const priorityPolicy: Record<WritingStyleMode, string> = {
    default: '项目基调 > 系统默认笔调',
    'skill-deck': '项目基调 > 作品卡组 > 本章使用卡 > 资料包',
    'writer-skill': '项目基调 > 主笔能力卡 > 资料包',
    'continuation-pack': '项目基调 > 资料包 > 主笔能力卡',
    blend:
      '项目基调保持最高优先级；资料包负责 POV、时态和避免项；主笔能力卡负责句法、词汇和意象；节奏卡作为共同覆盖层。',
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
  const plannerTypes = new Set([
    'worldview-card',
    'character-card',
    'hook-card',
    'conflict-card',
    'pacing-card',
    'platform-card',
  ]);
  return sessionAssets
    .filter((asset) => plannerTypes.has(asset.deconstructionCardType || ''))
    .map((asset) => `【本章规划卡：${asset.title}】\n${asset.template}`)
    .join('\n\n');
}

export function resolveWritingStyleRequest(
  novelId: string,
  input: WritingStyleRequestInput = {}
): ResolvedWritingStyleRequest {
  const initialGeneration = getDatabaseGeneration();
  if (input.databaseGeneration !== undefined && input.databaseGeneration !== initialGeneration) {
    throw new WritingStyleRequestError(
      409,
      'DATABASE_GENERATION_STALE',
      '数据库已变化，请刷新后重试'
    );
  }
  const novel = db.getNovel(novelId);
  if (!novel) throw new WritingStyleRequestError(404, 'NOVEL_NOT_FOUND', '作品不存在');
  if (hasCapabilityV3(novel))
    validateCapabilityProfile(novelId, novel.projectPreferenceProfile?.capabilityProfile);
  const stageSkills = getStageSkills(novel);
  const chapterState = resolveChapterCapabilityState(novelId, input.chapterId, initialGeneration);
  const chapterTechniqueIds = chapterState.techniqueIds;
  const writerSkill = stageSkills.writer[0];
  const projectDeck = resolveProjectSkillDeck(novel);
  // Resolve without an explicit pack falls back to the pack remembered at
  // confirm time. Without this, any call that omits the id silently flips to
  // the default mode, churning the fingerprint and invalidating the stored
  // confirmation (the 171:1 STYLE_CONFIRMATION_REQUIRED friction).
  // Legacy confirmations predate the stored id: if they confirmed a
  // continuation-pack mode, fall back to the novel's latest approved pack.
  const storedConfirmation = novel.projectPreferenceProfile?.writingStyleConfirmation;
  const fallbackContinuationPackId =
    storedConfirmation?.continuationPackId ??
    (storedConfirmation?.mode === 'continuation-pack'
      ? db
          .listContinuationPacks(novelId)
          .filter((item) => item.status === 'approved')
          .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id
      : undefined);
  const pack = input.continuationPackId
    ? db.getContinuationPack(input.continuationPackId)
    : fallbackContinuationPackId
      ? db.getContinuationPack(fallbackContinuationPackId)
      : undefined;
  if (input.continuationPackId && !pack)
    throw new WritingStyleRequestError(404, 'CONTINUATION_PACK_NOT_FOUND', '资料包不存在');
  if (pack && pack.novelId !== novelId)
    throw new WritingStyleRequestError(
      409,
      'CONTINUATION_PACK_OWNERSHIP_MISMATCH',
      '资料包不属于当前作品'
    );
  if (input.sessionCardIds !== undefined && !Array.isArray(input.sessionCardIds)) {
    throw new WritingStyleRequestError(400, 'INVALID_SESSION_CARD_IDS', '本章使用卡 ID 格式无效');
  }
  // Plan 260：作品技法按装配优先度排序后注入；roleById 供段内角色标注。
  const { ids: projectTechniqueIds, roleById: techniqueRoleById } =
    resolveProjectTechniquePlan(novel);
  const combinedSessionCardIds = [...chapterState.overlayCardIds, ...(input.sessionCardIds || [])];
  if (combinedSessionCardIds.length > 6)
    throw new WritingStyleRequestError(400, 'TOO_MANY_SESSION_CARDS', '本章使用卡最多使用 6 张');
  const requestedSessionAssets = resolveSessionAssets(novel, [...new Set(combinedSessionCardIds)]);
  const projectIds = new Set(projectDeck.all.map((asset) => asset.id));
  const chapterAssets = requestedSessionAssets.filter((asset) => !projectIds.has(asset.id));
  const effectiveCardCount = projectDeck.all.length + chapterAssets.length;
  if (effectiveCardCount > 6)
    throw new WritingStyleRequestError(
      400,
      'TOO_MANY_EFFECTIVE_SKILL_CARDS',
      '作品卡组与本章使用卡最多使用 6 张'
    );
  const sessionAssets = [...projectDeck.all, ...chapterAssets];
  const writerSessionAssets = sessionAssets.filter(
    (asset) =>
      WRITER_SESSION_CARD_TYPES.has(asset.deconstructionCardType || '') &&
      stagesForAsset(asset).includes('writer')
  );
  const writerDeckAssets = projectDeck.all.filter((asset) =>
    stagesForAsset(asset).includes('writer')
  );
  const writerPromptAssets = [
    ...writerDeckAssets,
    ...writerSessionAssets.filter(
      (asset) => !writerDeckAssets.some((deckAsset) => deckAsset.id === asset.id)
    ),
  ];
  const allowedModes: WritingStyleMode[] =
    projectDeck.all.length > 0 || writerSkill || pack
      ? [
          ...(projectDeck.all.length > 0 ? ['skill-deck' as const] : []),
          ...(writerSkill ? ['writer-skill' as const] : []),
          ...(pack ? ['continuation-pack' as const] : []),
          ...(writerSkill && pack ? ['blend' as const] : []),
        ]
      : ['default'];
  if (input.mode && !allowedModes.includes(input.mode)) {
    throw new WritingStyleRequestError(
      400,
      'WRITING_STYLE_MODE_UNAVAILABLE',
      '当前写法来源不支持所选模式'
    );
  }
  const storedMode = novel.projectPreferenceProfile?.writingStyleConfirmation?.mode;
  const requestedMode =
    input.mode ??
    (storedMode && allowedModes.includes(storedMode) ? storedMode : undefined) ??
    (projectDeck.all.length > 0
      ? 'skill-deck'
      : writerSkill
        ? 'writer-skill'
        : pack
          ? 'continuation-pack'
          : 'default');
  const techniqueBuild = buildTechniquesResilient([
    ...projectTechniqueIds,
    ...chapterTechniqueIds,
  ]);
  if (techniqueBuild.warnings.length > 0) {
    logger.warn(
      'Writing style resolution skipped unavailable technique references:',
      techniqueBuild.warnings
    );
  }
  const techniques = techniqueBuild.techniques;
  const writerSnapshot = writerSkill
    ? {
        id: writerSkill.id,
        name: writerSkill.name,
        version: writerSkill.version,
        prompt: buildSkillsPrompt([writerSkill]),
      }
    : undefined;
  const sessionSnapshots = writerSessionAssets.map((asset) => ({
    id: asset.id,
    type: runtimeAssetType(asset),
    version: asset.version,
    source: asset.sourceBadge,
    position: 'chapter',
    runtimeContent: asset.template,
    dimensionOwners: asset.dimensionOwners,
    resolvedRules: asset.resolvedRules,
    lineage: asset.lineage,
  }));
  const createSnapshot = (mode: WritingStyleMode) =>
    resolveWritingStyle({
      novelId,
      mode,
      styleAnchors: novel.projectPreferenceProfile?.contract?.styleAnchors,
      writerSkill: writerSnapshot,
      skillDeck: writerDeckAssets.map((asset) => ({
        id: asset.id,
        type: runtimeAssetType(asset),
        version: asset.version,
        source: asset.sourceBadge,
        position: 'project',
        runtimeContent: asset.template,
        dimensionOwners: asset.dimensionOwners,
        resolvedRules: asset.resolvedRules,
        lineage: asset.lineage,
      })),
      techniques: techniques.writer.map((technique) => ({
        id: technique.id,
        version: technique.version,
        prompt: technique.prompt,
      })),
      pack: pack
        ? {
            id: pack.id,
            novelId: pack.novelId,
            status: pack.status,
            styleProfile: pack.styleProfile as unknown as Record<string, unknown>,
          }
        : undefined,
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
  const sources = summarizeSources(
    snapshot,
    writerSkill,
    projectDeck.all,
    pack?.id,
    pack?.status,
    writerSessionAssets
  );
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
  // 批次 B：步骤挂卡 → 卡片正文进入声明的每个阶段；未挂卡 → 沿用
  // `stage === 声明阶段 ? prompt : undefined` 单点注入（阶段取自 step.stage 声明，见 buildFlowStep）。
  const flowStepPromptFor = (stage: CapabilityStage): string | undefined => {
    const declared = flowStep?.stagePrompts?.[stage];
    const candidate = declared ?? (flowStep?.stage === stage ? flowStep.prompt : undefined);
    return candidate && !isShellTemplatePrompt(candidate) ? candidate : undefined;
  };
  const packStyleProfile = pack?.styleProfile
    ? valueCopy(pack.styleProfile as unknown as Record<string, unknown>)
    : undefined;
  const guardrails = buildGuardrails(novel);
  const skillStack = buildSkillStack(projectDeck, chapterAssets);
  const criticPrompt = [
    buildCriticPrompt(
      snapshot,
      packStyleProfile,
      writerPromptAssets,
      stageSkills.critic[0],
      flowStepPromptFor('critic')
    ),
    buildTechniquePrompt(techniques.critic, techniqueRoleById),
  ]
    .filter(Boolean)
    .join('\n\n');
  const overlays: ExecutionOverlay[] = skillStack.effectiveCards.filter(
    (overlay) => overlay.stages.length > 0
  );
  const roleSkills = projectRoleSkills(stageSkills);
  const packContextBundle = pack
    ? buildContinuationContextBundle(normalizeContinuationPack(pack), { includeStyle: false })
    : undefined;
  const packSnapshot = pack
    ? {
        id: pack.id,
        status: pack.status,
        context: packContextBundle?.text || '',
        receipt: packContextBundle!.receipt,
        styleProfile: packStyleProfile || {},
      }
    : null;
  const guardrailPrompt = (stage: CapabilityStage) =>
    guardrails
      .filter((item) => item.stage === stage)
      .map((item) => `【系统护栏：${item.id}】\n${item.prompt}`)
      .join('\n\n');
  const plannerFlowStepPrompt = flowStepPromptFor('planner');
  const plannerStagePrompt = [
    buildSkillsPrompt(stageSkills.planner),
    buildPlannerSessionPrompt(sessionAssets),
    buildTechniquePrompt(techniques.planner, techniqueRoleById),
    plannerFlowStepPrompt ? `【当前流程步骤】\n${plannerFlowStepPrompt}` : '',
    guardrailPrompt('planner'),
  ]
    .filter(Boolean)
    .join('\n\n');
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
        buildWriterContractPrompt(
          snapshot,
          writerSkill,
          packStyleProfile,
          writerPromptAssets,
          flowStepPromptFor('writer')
        ),
        buildTechniquePrompt(techniques.writer, techniqueRoleById),
        guardrailPrompt('writer'),
      ]
        .filter(Boolean)
        .join('\n\n'),
      critic: [criticPrompt, guardrailPrompt('critic')].filter(Boolean).join('\n\n'),
    },
    writingStyleSummary: resolution.summary,
    writingStyleFingerprint: fingerprint,
    capabilityRefs: [
      ...new Set([
        ...Object.values(techniques)
          .flat()
          .map((item) => item.id),
        ...overlays.map((item) => item.id),
        ...guardrails.map((item) => item.id),
        ...(flowStep?.assetId ? [flowStep.assetId] : []),
        ...(flowStep?.cardId ? [flowStep.cardId] : []),
        ...stageSkills.planner.map((skill) => skill.id),
        ...stageSkills.writer.map((skill) => skill.id),
        ...stageSkills.critic.map((skill) => skill.id),
      ]),
    ],
    resolvedAtGeneration: initialGeneration,
  });
  if (
    getDatabaseGeneration() !== initialGeneration ||
    (input.databaseGeneration !== undefined && input.databaseGeneration !== getDatabaseGeneration())
  ) {
    throw new WritingStyleRequestError(
      409,
      'DATABASE_GENERATION_STALE',
      '数据库已变化，请刷新后重试'
    );
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
export function resolveProjectExecutionContract(
  novelId: string,
  input: WritingStyleRequestInput = {}
): ProjectExecutionContract {
  return resolveWritingStyleRequest(novelId, input).executionSnapshot;
}

export const resolveExecutionSnapshot = resolveProjectExecutionContract;

export function requireWritingStyleConfirmation(
  resolved: ResolvedWritingStyleRequest,
  providedFingerprint?: string
): void {
  const result = checkWritingStyleConfirmation({
    currentFingerprint: resolved.resolution.fingerprint,
    storedFingerprint:
      resolved.novel.projectPreferenceProfile?.writingStyleConfirmation?.fingerprint,
    providedFingerprint,
  });
  if (!result.ok)
    throw new WritingStyleRequestError(409, 'STYLE_CONFIRMATION_REQUIRED', '请先确认本次写法');
}
