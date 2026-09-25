import type { Skill } from '../../shared/types';
import { PROMPT_GOVERNANCE_CATALOG } from '../../shared/lib/prompt-governance-catalog.js';
import { CURATED_PRODUCT_SKILLS } from '../../shared/lib/curated-product-skills.js';
import { getCatalogCapabilityManifest } from '../../shared/lib/capability-manifest-catalog';
import { resolveCuratedTechniquePrompt } from './curated-skill-runtime';
import * as db from '../lib/db';
import { isRuntimeReadyAsset } from '../../shared/lib/capability-runtime-readiness.js';

/**
 * 拆书指导卡信任解析（capability-sanitize 不变式的服务端落点）。
 * /api/extract-skill 的 skills 入参只读 id：客户端传入的卡正文一律不进拆书
 * prompt，指导卡内容由服务端按以下可信源解析——
 * 1) 服务端私表（官方内置卡，前端只持占位符）；
 * 2) skills 表（消毒克隆与历史拆书产出，落库前已过白标清洗）；
 * 3) 治理目录 runtime-ready 白标卡。
 */

function hasExecutableRule(skill: Skill): boolean {
  return (
    [
      skill.style,
      skill.pacing,
      skill.characterTraits,
      skill.worldBuilding,
      skill.plotPattern,
      skill.foreshadowing,
    ].some((value) => typeof value === 'string' && value.trim().length > 0) ||
    Boolean(skill.corePatterns?.length) ||
    Boolean(skill.fewShots?.length)
  );
}

function isTrustedSavedDeconstructCard(skill: Skill): boolean {
  return Boolean(
    skill.deconstructionCardType &&
      skill.version > 0 &&
      isRuntimeReadyAsset(skill) &&
      hasExecutableRule(skill)
  );
}

function buildGuidanceSkill(input: {
  id: string;
  name: string;
  description: string;
  style: string;
  pacing: string;
  deconstructionCardType: NonNullable<Skill['deconstructionCardType']>;
  sourceType: Skill['sourceType'];
}): Skill {
  const now = Date.now();
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    style: input.style,
    pacing: input.pacing,
    vocabulary: [],
    imagery: [],
    fewShots: [],
    corePatterns: [],
    bannedWords: [],
    bannedElements: [],
    stabilityScore: 0,
    evaluationFeedback: '',
    version: 1,
    lineageRootId: input.id,
    dimensionTags: ['style'],
    primaryDimension: 'style',
    createdAt: now,
    updatedAt: now,
    deconstructionCardType: input.deconstructionCardType,
    sourceType: input.sourceType,
    isRuntimeReady: true,
    sanitizationStatus: 'runtime-ready',
    runtimeStatus: 'active',
  } as Skill;
}

function resolveTrustedDeconstructSkillById(id: string): Skill | null {
  const privateTemplate = resolveCuratedTechniquePrompt(id);
  const manifest = getCatalogCapabilityManifest(id);
  if (
    privateTemplate &&
    manifest?.kind === 'skill-card' &&
    manifest.runtimeStatus === 'active' &&
    manifest.deconstructionCardType
  ) {
    const curated = CURATED_PRODUCT_SKILLS.find((asset) => asset.id === id);
    return buildGuidanceSkill({
      id,
      name: curated?.title || id,
      description: curated?.goal || '',
      style: privateTemplate,
      pacing: curated?.successSignal || '',
      deconstructionCardType: manifest.deconstructionCardType,
      sourceType: 'built-in',
    });
  }

  const saved = db.getSkill(id);
  if (saved && isTrustedSavedDeconstructCard(saved)) return saved;

  const asset = PROMPT_GOVERNANCE_CATALOG.find((entry) => entry.id === id);
  if (
    asset?.deconstructionCardType &&
    isRuntimeReadyAsset(asset) &&
    typeof asset.template === 'string' &&
    asset.template.trim().length > 0
  ) {
    return buildGuidanceSkill({
      id,
      name: asset.title,
      description: asset.goal || '',
      style: asset.template,
      pacing: asset.successSignal || '',
      deconstructionCardType: asset.deconstructionCardType,
      sourceType: asset.sourceType || 'plaza',
    });
  }
  return null;
}

/** 只按 id 解析可信拆书指导卡；id 之外的一切客户端字段都被忽略。 */
export function resolveTrustedDeconstructSkills(candidates: unknown[], maxCards = 3): Skill[] {
  const resolved: Skill[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(candidates) ? candidates : []) {
    const id =
      entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string'
        ? (entry as { id: string }).id.trim()
        : '';
    if (!id || seen.has(id)) continue;
    const skill = resolveTrustedDeconstructSkillById(id);
    if (skill) {
      seen.add(id);
      resolved.push(skill);
      if (resolved.length >= maxCards) break;
    }
  }
  return resolved;
}
