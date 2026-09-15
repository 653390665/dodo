import { PROMPT_GOVERNANCE_CATALOG } from '../../shared/lib/prompt-governance-catalog';
import {
  CURATED_PRODUCT_SKILLS,
  SANITIZED_SKILL_COPIES,
} from '../../shared/lib/public-skill-catalog';
import type {
  CuratedProductSkill,
  GovernedPromptAsset,
} from '../../shared/types/prompt-assets-governed';
import type { Skill } from '../../shared/types/skills';
import type { WorkflowPhase } from './workflow-state';
import { CARD_STAGE_MAP } from '../../shared/types/capability-execution';
import type { CapabilityManifestEntry } from '../../shared/types/capability-manifest';
import { getCatalogCapabilityManifest } from '../../shared/lib/capability-manifest-catalog';
import type { CapabilityStage } from '../../shared/types/capability-execution';

/** Canonical user-facing capability families. Legacy kinds are read-only compatibility values. */
export type GovernanceCapabilityType =
  | 'flow'
  | 'technique'
  | 'skill-card'
  | 'diagnostic'
  | 'utility'
  | 'guardrail'
  | 'role-skill'
  | 'overlay';
export type GovernanceStage =
  'creative-setup' | 'active-drafting' | 'style-polish' | 'commercial-sign';
export interface CapabilityLaunchContext {
  novelId?: string;
  stage?: GovernanceStage;
}

export interface GovernedStageRecommendation {
  capability: GovernanceCapabilityType;
  asset: CuratedProductSkill;
  stage: GovernanceStage;
}

export function getGovernanceStageForWorkflowPhase(phase: WorkflowPhase): GovernanceStage {
  if (phase === 'drafting') return 'active-drafting';
  if (phase === 'audit' || phase === 'polish' || phase === 'next_chapter') return 'style-polish';
  return 'creative-setup';
}

export function getGovernanceCapabilityType(
  asset: CuratedProductSkill | GovernedPromptAsset
): GovernanceCapabilityType {
  const manifest = getAssetCapabilityManifest(asset);
  if (!manifest) throw new Error(`CAPABILITY_MANIFEST_MISSING:${asset.id}`);
  return manifest.kind;
}

export function getGovernanceActionLabel(type: GovernanceCapabilityType): string {
  return {
    flow: '选择流程',
    technique: '收藏为常用技法',
    'skill-card': '应用到作品卡组',
    diagnostic: '运行诊断',
    'role-skill': '待整理',
    overlay: '本章使用',
    utility: '运行工具',
    guardrail: '保存为系统检查候选',
  }[type];
}

export function getGovernanceStage(asset: CuratedProductSkill): GovernanceStage | null {
  return getAssetCapabilityManifest(asset)?.displayStages?.[0] || null;
}

export function filterGovernedAssets(
  assets: CuratedProductSkill[],
  type: GovernanceCapabilityType,
  stage?: GovernanceStage
) {
  const baseAssets = assets.filter((asset) => {
    const manifest = getAssetCapabilityManifest(asset);
    return manifest?.kind === type && (!stage || manifest.displayStages?.includes(stage));
  });
  if (type !== 'guardrail') return baseAssets;
  const projected = getConfigurableGuardrailAssets().filter(
    (asset) => !stage || getAssetCapabilityManifest(asset)?.displayStages?.includes(stage)
  );
  const seen = new Set(baseAssets.map((asset) => asset.id));
  return [
    ...baseAssets,
    ...projected.filter((asset) => {
      if (seen.has(asset.id)) return false;
      seen.add(asset.id);
      return true;
    }),
  ];
}

export function getGovernedStageRecommendations(
  stage: GovernanceStage
): GovernedStageRecommendation[] {
  return (
    ['flow', 'technique', 'skill-card', 'diagnostic', 'utility', 'guardrail'] as const
  ).flatMap((capability) => {
    const asset = filterGovernedAssets(CURATED_PRODUCT_SKILLS, capability, stage).find(
      (candidate) => getAssetCapabilityManifest(candidate)?.runtimeStatus === 'active'
    );
    return asset ? [{ capability, asset, stage }] : [];
  });
}

export function getCapabilityManifest(
  asset: CuratedProductSkill | GovernedPromptAsset
): CapabilityManifestEntry {
  const manifest = getAssetCapabilityManifest(asset);
  if (!manifest) throw new Error(`CAPABILITY_MANIFEST_MISSING:${asset.id}`);
  return manifest;
}

export function getCapabilitySourceLabel(
  sourceType: CapabilityManifestEntry['sourceType']
): string {
  return sourceType === 'built-in' ? '官方内置' : sourceType === 'plaza' ? '广场共享' : '授权增强';
}

export function getCapabilityRuntimeLabel(
  status: CapabilityManifestEntry['runtimeStatus']
): string {
  return status === 'active' ? '可运行' : status === 'deprecated' ? '已弃用' : '暂不可用';
}

export function getCapabilityScopeLabel(
  scopes: readonly CapabilityManifestEntry['allowedScopes'][number][]
): string {
  const labels: Record<CapabilityManifestEntry['allowedScopes'][number], string> = {
    project: '作品默认',
    chapter: '本章使用',
    'single-run': '仅运行一次',
    system: '系统',
  };
  return scopes.length > 0 ? scopes.map((scope) => labels[scope]).join(' / ') : '系统';
}

function hasRuntimeRule(skill: Skill): boolean {
  return (
    [
      skill.style,
      skill.pacing,
      skill.worldBuilding,
      skill.characterTraits,
      skill.plotPattern,
      skill.foreshadowing,
    ].some((value) => typeof value === 'string' && value.trim().length > 0) ||
    Boolean(skill.methodChain?.items?.length)
  );
}

function isGovernedCatalogCardClone(skill: Skill): boolean {
  const manifest = skill.parentSkillId
    ? getCatalogCapabilityManifest(skill.parentSkillId)
    : undefined;
  return (
    manifest?.kind === 'skill-card' &&
    manifest.runtimeStatus === 'active' &&
    manifest.sourceType === skill.sourceType &&
    manifest.deconstructionCardType === skill.deconstructionCardType &&
    skill.isRuntimeReady === true &&
    skill.sanitizationStatus === 'runtime-ready' &&
    skill.runtimeStatus === 'active'
  );
}

function isTrustedSavedSessionCard(skill: Skill): boolean {
  if (!skill.deconstructionCardType || (skill.executionScore || 0) < 60 || !hasRuntimeRule(skill))
    return false;
  return skill.sourceBadge === 'book-extracted' || isGovernedCatalogCardClone(skill);
}

export function getTrustedSessionCardIds(ids: string[], savedSkills: Skill[] = []): string[] {
  const saved = new Set(savedSkills.filter(isTrustedSavedSessionCard).map((skill) => skill.id));
  const trusted = new Set(
    PROMPT_GOVERNANCE_CATALOG.filter(
      (asset) =>
        asset.runtimeStatus === 'active' &&
        asset.isRuntimeReady === true &&
        asset.sanitizationStatus === 'runtime-ready' &&
        Boolean(asset.deconstructionCardType)
    ).map((asset) => asset.id)
  );
  CURATED_PRODUCT_SKILLS.forEach((asset) => {
    const manifest = getCatalogCapabilityManifest(asset.id);
    if (
      manifest?.kind === 'skill-card' &&
      manifest.runtimeStatus === 'active' &&
      manifest.allowedScopes.includes('chapter') &&
      manifest.deconstructionCardType
    ) {
      trusted.add(asset.id);
    }
  });
  return [
    ...new Set(ids.map((id) => id.trim()).filter((id) => trusted.has(id) || saved.has(id))),
  ].slice(0, 6);
}

export function getGovernedOverlayDisplayAssets(): CuratedProductSkill[] {
  return PROMPT_GOVERNANCE_CATALOG.filter(
    (asset) =>
      asset.runtimeStatus === 'active' &&
      asset.isRuntimeReady === true &&
      asset.sanitizationStatus === 'runtime-ready' &&
      Boolean(asset.deconstructionCardType)
  ).map((asset) => ({
    id: asset.id,
    title: asset.title,
    curatedCategory: 'deconstruct',
    goal: asset.goal,
    successSignal: asset.successSignal,
    score: asset.score || 0,
    grade: asset.grade || 'B',
    sourceType: asset.sourceType || 'built-in',
    primaryCategory: asset.primaryCategory || 'style-reference',
    inputs: asset.inputs || ['content'],
    actionType: 'direct-exec',
    capabilityManifest: getAssetCapabilityManifest(asset),
  }));
}

/** 003：增强护栏候选（非 core-default 的质量护栏），供质量标准面板做开关。 */
export function getConfigurableGuardrailAssets(): CuratedProductSkill[] {
  return PROMPT_GOVERNANCE_CATALOG.filter(
    (asset) =>
      asset.primaryCategory === 'quality-guardrail' &&
      asset.runtimeStatus === 'active' &&
      asset.isRuntimeReady === true &&
      asset.sanitizationStatus === 'runtime-ready' &&
      asset.placementTier !== 'core-default' &&
      asset.sourceGroup !== 'test-fixture'
  ).map((asset) => ({
    id: asset.id,
    title: asset.title,
    curatedCategory: asset.stage === 'review' ? 'audit' : 'de-ai',
    goal: asset.goal,
    successSignal: asset.successSignal,
    score: asset.score || 0,
    grade: asset.grade || 'B',
    sourceType: asset.sourceType || 'built-in',
    primaryCategory: asset.primaryCategory || 'quality-guardrail',
    inputs: asset.inputs || ['content'],
    actionType: 'equip',
    capabilityManifest: {
      id: asset.id,
      version: 'catalog',
      kind: 'guardrail',
      stages: getExecutionStagesForGuardrail(asset),
      input: 'text',
      output: 'diagnostic',
      action: 'automatic',
      allowedScopes: ['system'],
      persistence: 'system',
      sideEffect: 'none',
      runtimeStatus: 'active',
      sourceType: asset.sourceType || 'built-in',
      displayStages: getDisplayStagesForGuardrail(asset),
    },
  }));
}

function getExecutionStagesForGuardrail(asset: GovernedPromptAsset): CapabilityStage[] {
  const stageMap: Record<string, CapabilityStage> = {
    discovery: 'planner',
    foundation: 'planner',
    planning: 'planner',
    drafting: 'writer',
    polish: 'writer',
    review: 'critic',
  };
  const stage = stageMap[asset.stage];
  return stage ? [stage] : ['critic'];
}

function getDisplayStagesForGuardrail(asset: GovernedPromptAsset): GovernanceStage[] {
  if (asset.stage === 'planning' || asset.stage === 'discovery' || asset.stage === 'foundation')
    return ['creative-setup'];
  if (asset.stage === 'drafting') return ['active-drafting'];
  if (asset.stage === 'review' || asset.stage === 'polish') return ['style-polish'];
  return ['style-polish'];
}

function getAssetCapabilityManifest(
  asset: CuratedProductSkill | GovernedPromptAsset
): CapabilityManifestEntry | undefined {
  if ('capabilityManifest' in asset && asset.capabilityManifest) return asset.capabilityManifest;
  const catalogManifest = getCatalogCapabilityManifest(asset.id);
  if (catalogManifest) return catalogManifest;
  if (!('deconstructionCardType' in asset) || !asset.deconstructionCardType) return undefined;
  return {
    id: asset.id,
    version: 'catalog',
    kind: 'skill-card',
    stages: [...CARD_STAGE_MAP[asset.deconstructionCardType]],
    input: 'text',
    output: 'configuration',
    action: 'use-this-time',
    allowedScopes: ['chapter'],
    persistence: 'chapter-session',
    sideEffect: 'configuration',
    runtimeStatus:
      asset.runtimeStatus === 'deprecated'
        ? 'deprecated'
        : asset.runtimeStatus === 'active'
          ? 'active'
          : 'unavailable',
    sourceType: asset.sourceType || 'built-in',
    displayStages: ['active-drafting', 'style-polish'],
  };
}

/** 003：core-default 护栏数量（运行时无条件注入全部三阶段，UI 只读展示）。 */
export function getCoreDefaultGuardrailCount(): number {
  return PROMPT_GOVERNANCE_CATALOG.filter(
    (asset) =>
      asset.placementTier === 'core-default' && asset.primaryCategory === 'quality-guardrail'
  ).length;
}

// Plan 210（197 出路 a）：渲染层只消费 sanitized 副本——生成侧副本（runtime-ready + active）
// 与沉睡目录合并后供给文风可选集；候选原貌仅保留在「需解锁」投影中。
const RUNTIME_STYLE_CATALOG = [...PROMPT_GOVERNANCE_CATALOG, ...SANITIZED_SKILL_COPIES];

// Plan 220：投影谓词模块级预计算——打字/弹窗按键路径的每次重渲不再全量扫描目录。
const SANITIZED_COPY_IDS: ReadonlySet<string> = new Set(
  SANITIZED_SKILL_COPIES.map((copy) => copy.id)
);
const hasGeneratedSanitizedCopy = (assetId: string): boolean =>
  SANITIZED_COPY_IDS.has(`sanitized-${assetId}`);

const SANITIZE_REQUIRED_CATALOG_ASSETS = PROMPT_GOVERNANCE_CATALOG.filter(
  (asset) =>
    asset.placementTier === 'sanitize-required' &&
    asset.runtimeStatus === 'candidate' &&
    asset.sanitizationStatus === 'needs-sanitization' &&
    asset.sourceGroup !== 'test-fixture' &&
    !hasGeneratedSanitizedCopy(asset.id)
);

// 注意：与 getSanitizeRequiredAssets 的白名单谓词刻意不同构——本判定面向单卡
// 「消毒并启用」入口展示，历史行为不含 placementTier/sourceGroup 过滤，保持等价。
const SANITIZE_REQUIRED_ASSET_IDS: ReadonlySet<string> = new Set(
  PROMPT_GOVERNANCE_CATALOG.filter(
    (asset) =>
      asset.runtimeStatus === 'candidate' &&
      asset.sanitizationStatus === 'needs-sanitization' &&
      !hasGeneratedSanitizedCopy(asset.id)
  ).map((asset) => asset.id)
);

/** 004：文风与正文卡（optional-style 且运行就绪），从沉睡目录投影到货架。 */
export function getOptionalStyleAssets(stage?: GovernanceStage): CuratedProductSkill[] {
  const stageMap: Record<string, CapabilityStage> = {
    discovery: 'planner',
    foundation: 'planner',
    planning: 'planner',
    drafting: 'writer',
    polish: 'writer',
    review: 'critic',
  };
  const displayMap: Record<string, GovernanceStage[]> = {
    discovery: ['creative-setup'],
    foundation: ['creative-setup'],
    planning: ['creative-setup'],
    drafting: ['active-drafting'],
    polish: ['style-polish'],
    review: ['style-polish'],
  };
  return RUNTIME_STYLE_CATALOG.filter(
    (asset) =>
      asset.placementTier === 'optional-style' &&
      asset.runtimeStatus === 'active' &&
      asset.isRuntimeReady === true &&
      asset.sanitizationStatus === 'runtime-ready' &&
      asset.sourceGroup !== 'test-fixture' &&
      (!stage || (displayMap[asset.stage] || ['style-polish']).includes(stage))
  ).map((asset) => ({
    id: asset.id,
    title: asset.title,
    curatedCategory: 'style' as const,
    goal: asset.goal,
    successSignal: asset.successSignal,
    score: asset.score || 0,
    grade: asset.grade || 'B',
    sourceType: asset.sourceType || 'built-in',
    primaryCategory: asset.primaryCategory || 'style-reference',
    inputs: asset.inputs || ['content'],
    actionType: 'equip' as const,
    capabilityManifest: {
      id: asset.id,
      version: 'catalog',
      kind: 'technique' as const,
      stages: [stageMap[asset.stage] || 'writer'],
      input: 'text',
      output: 'configuration',
      action: 'use-technique',
      allowedScopes: ['project', 'chapter'],
      persistence: 'project',
      sideEffect: 'configuration',
      runtimeStatus: 'active',
      sourceType: asset.sourceType || 'built-in',
      displayStages: displayMap[asset.stage] || ['style-polish'],
    },
  }));
}

/** 004：待消毒卡（sanitize-required candidate）投影，只进"需解锁"分组。
 * Plan 210：已有生成侧消毒副本的候选不再进本分组——其副本已作为正式文风卡可选用。 */
export function getSanitizeRequiredAssets(): CuratedProductSkill[] {
  return SANITIZE_REQUIRED_CATALOG_ASSETS.map((asset) => ({
    id: asset.id,
    title: asset.title,
    curatedCategory: 'style' as const,
    goal: asset.goal,
    successSignal: asset.successSignal,
    score: asset.score || 0,
    grade: asset.grade || 'B',
    sourceType: (asset.sourceType || 'plaza') as 'built-in' | 'plaza' | 'licensed',
    primaryCategory: asset.primaryCategory || 'style-reference',
    inputs: asset.inputs || ['content'],
    actionType: 'equip' as const,
    capabilityManifest: {
      id: asset.id,
      version: 'catalog',
      kind: 'technique' as const,
      stages: ['writer'],
      input: 'text',
      output: 'configuration',
      action: 'use-technique',
      allowedScopes: ['project', 'chapter'],
      persistence: 'project',
      sideEffect: 'configuration',
      runtimeStatus: 'unavailable',
      sourceType: (asset.sourceType || 'plaza') as 'built-in' | 'plaza' | 'licensed',
      displayStages: ['style-polish'],
    },
  }));
}

/** 004：该资产是否为待消毒候选（决定货架卡是否展示"消毒并启用"）。
 * Plan 210：已有生成侧消毒副本的候选返回 false——不再展示运行时消毒入口。
 * Plan 220：O(1) 查询，模块加载时预计算。 */
export function isSanitizeRequiredAsset(assetId: string): boolean {
  return SANITIZE_REQUIRED_ASSET_IDS.has(assetId);
}

/** Plan 225 供给分区：官方规范 = 产品签字保修（随版本升级）；其余 = 社区配方（自带自验）。 */
export function isOfficialSupplyAsset(asset: CuratedProductSkill): boolean {
  return (asset.sourceType || asset.capabilityManifest?.sourceType) === 'built-in';
}

export function isSanitizedCopyAsset(asset: CuratedProductSkill): boolean {
  return asset.id.startsWith('sanitized-');
}

export function partitionShelfBySupply<T extends CuratedProductSkill>(
  assets: readonly T[]
): { official: T[]; community: T[] } {
  const official: T[] = [];
  const community: T[] = [];
  for (const asset of assets) {
    (isOfficialSupplyAsset(asset) ? official : community).push(asset);
  }
  return { official, community };
}
