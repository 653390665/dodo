import { CARD_STAGE_MAP } from '../../shared/types/capability-execution.js';
import type { CapabilityManifestEntry } from '../../shared/types/capability-manifest.js';
import { CAPABILITY_KINDS } from '../../shared/types/capability-manifest.js';
import type { CapabilityStage } from '../../shared/types/capability-execution.js';
import type { ArtifactOperation, CreativeArtifactKind, CreativeArtifactRef } from '../../shared/types/creative-artifacts.js';
import { validateArtifactCapabilityExecution } from '../../shared/lib/artifact-capability-contract.js';
import { getCatalogCapabilityManifest, listCatalogCapabilityManifests, projectCapabilityManifest } from '../../shared/lib/capability-manifest-catalog.js';
import { PROMPT_GOVERNANCE_CATALOG } from '../../shared/lib/prompt-governance-catalog.js';
import type { Skill } from '../../shared/types/skills.js';

export { CAPABILITY_KINDS };

const BUILT_IN_MANIFESTS: Readonly<Record<string, CapabilityManifestEntry>> = {
  'text-diagnostics': {
    id: 'text-diagnostics', version: '1', kind: 'utility', stages: ['critic'], input: 'text', output: 'diagnostic',
    action: 'run-diagnostic', persistence: 'single-run', sideEffect: 'none', runtimeStatus: 'active', sourceType: 'built-in',
    allowedScopes: ['single-run'],
  },
  'text-normalize-preview': {
    id: 'text-normalize-preview', version: '1', kind: 'utility', stages: ['writer', 'critic'], input: 'text', output: 'transform-preview',
    action: 'preview-transform', persistence: 'single-run', sideEffect: 'preview-only', runtimeStatus: 'active', sourceType: 'built-in',
    allowedScopes: ['single-run'],
  },
  'default-guardrail': {
    id: 'default-guardrail', version: '1', kind: 'guardrail', stages: ['planner', 'writer', 'critic'], input: 'text', output: 'diagnostic',
    action: 'run-diagnostic', persistence: 'system', sideEffect: 'none', runtimeStatus: 'active', sourceType: 'built-in',
    allowedScopes: ['system'],
  },
};

function getRuntimeOverlayManifest(id: string): CapabilityManifestEntry | undefined {
  const asset = PROMPT_GOVERNANCE_CATALOG.find((item) => item.id === id);
  if (!asset?.deconstructionCardType || asset.runtimeStatus !== 'active' || !asset.isRuntimeReady) return undefined;
  return {
    id: asset.id,
    version: 'catalog',
    kind: 'skill-card',
    stages: [...CARD_STAGE_MAP[asset.deconstructionCardType]],
    input: 'text',
    output: 'configuration',
    action: 'add-to-stack',
    persistence: 'chapter-session',
    sideEffect: 'configuration',
    runtimeStatus: 'active',
    sourceType: asset.sourceType || 'built-in',
    allowedScopes: ['chapter'],
  };
}

function normalizeManifest(entry: CapabilityManifestEntry): CapabilityManifestEntry {
  return projectCapabilityManifest(entry);
}

export function capabilityManifestFor(id: string): CapabilityManifestEntry | undefined {
  const manifest = BUILT_IN_MANIFESTS[id] || getCatalogCapabilityManifest(id) || getRuntimeOverlayManifest(id);
  return manifest ? normalizeManifest(manifest) : undefined;
}

export function listCapabilityManifests(): CapabilityManifestEntry[] {
  const runtimeOverlays = PROMPT_GOVERNANCE_CATALOG
    .map((asset) => getRuntimeOverlayManifest(asset.id))
    .filter((entry): entry is CapabilityManifestEntry => Boolean(entry));
  const unique = new Map<string, CapabilityManifestEntry>();
  [...Object.values(BUILT_IN_MANIFESTS), ...listCatalogCapabilityManifests(), ...runtimeOverlays]
    .forEach((entry) => { if (!unique.has(entry.id)) unique.set(entry.id, entry); });
  return [...unique.values()].map(normalizeManifest);
}

export class CapabilityInvocationError extends Error {
  constructor(
    public readonly code: 'CAPABILITY_NOT_FOUND' | 'CAPABILITY_STAGE_UNSUPPORTED' | 'CAPABILITY_SCOPE_UNSUPPORTED' | 'CAPABILITY_NOT_EXECUTABLE',
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

export class ArtifactCapabilityExecutionError extends Error {
  constructor(
    public readonly code: 'ARTIFACT_CAPABILITY_NOT_FOUND' | 'ARTIFACT_CAPABILITY_RUNTIME_UNAVAILABLE' | 'ARTIFACT_CAPABILITY_NOT_DECLARED' | 'ARTIFACT_CAPABILITY_VERSION_STALE' | 'ARTIFACT_CAPABILITY_KIND_UNSUPPORTED' | 'ARTIFACT_CAPABILITY_OPERATION_UNSUPPORTED' | 'ARTIFACT_CAPABILITY_SCOPE_UNSUPPORTED' | 'ARTIFACT_CAPABILITY_GAP',
    message: string,
    public readonly missingArtifactKinds?: CreativeArtifactKind[],
  ) {
    super(`${code}: ${message}`);
  }
}

export class CapabilityRoleAssignmentError extends Error {
  constructor(
    public readonly code: 'CAPABILITY_ROLE_KIND_UNSUPPORTED' | 'CAPABILITY_ROLE_STAGE_UNSUPPORTED' | 'CAPABILITY_ROLE_SLOT_INVALID',
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

export class SkillCardValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
  }
}

/** Single server-side gate for persisted/project/chapter capability cards. */
export function validateSkillCardForScope(skill: Skill, scope: 'project' | 'chapter' | 'fusion-source'): void {
  const value = skill as Skill & Record<string, unknown>;
  const manifest = capabilityManifestFor(skill.id);
  if (manifest && (manifest.kind !== 'skill-card' || manifest.runtimeStatus !== 'active')) {
    throw new SkillCardValidationError('SKILL_CARD_KIND_INVALID', '资产不是可运行的能力卡');
  }
  if (!skill.deconstructionCardType || !(skill.deconstructionCardType in CARD_STAGE_MAP)) {
    throw new SkillCardValidationError('SKILL_CARD_TYPE_INVALID', '缺少有效 deconstructionCardType');
  }
  if (manifest && scope !== 'fusion-source' && !manifest.allowedScopes.includes(scope)) {
    throw new SkillCardValidationError('SKILL_CARD_SCOPE_INVALID', '能力卡不允许用于当前作用域');
  }
  if (!Number.isInteger(skill.version) || skill.version <= 0) {
    throw new SkillCardValidationError('SKILL_CARD_VERSION_INVALID', '能力卡版本无效');
  }
  if (!['built-in', 'licensed', 'plaza', 'book-extracted'].includes(String(skill.sourceType))) {
    throw new SkillCardValidationError('SKILL_CARD_SOURCE_INVALID', 'sourceType 缺失或未授权');
  }
  if (skill.accessTier === 'paid' && skill.sourceType !== 'licensed') {
    throw new SkillCardValidationError('SKILL_CARD_UNAUTHORIZED', '付费能力卡来源未授权');
  }
  if (value.isRuntimeReady !== true || value.sanitizationStatus !== 'runtime-ready' || value.runtimeStatus !== 'active') {
    throw new SkillCardValidationError('SKILL_CARD_NOT_RUNTIME_READY', '能力卡尚未达到 runtime-ready');
  }
  const hasRules = [skill.style, skill.pacing, skill.vocabulary, skill.sentenceStructure, skill.imagery, skill.bannedWords,
    skill.fewShots, skill.characterTraits, skill.worldBuilding, skill.foreshadowing, skill.plotPattern, skill.corePatterns, skill.bannedElements]
    .some((value) => Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim().length > 0);
  if (!hasRules) throw new SkillCardValidationError('SKILL_CARD_RULES_MISSING', '能力卡缺少可执行规则');
}

const ROLE_SLOT_STAGES: Readonly<Record<number, CapabilityStage>> = {
  0: 'planner',
  1: 'writer',
  2: 'critic',
};

/** Validate governed IDs while preserving unknown historical manual skills. */
export function validateMountedSkillLoadout(input: unknown): void {
  if (!Array.isArray(input)) return;
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const slot = record.slot;
    const skillId = typeof record.skillId === 'string' ? record.skillId : undefined;
    if (!skillId || typeof slot !== 'number') continue;
    if (!Number.isInteger(slot) || !(slot in ROLE_SLOT_STAGES)) {
      throw new CapabilityRoleAssignmentError('CAPABILITY_ROLE_SLOT_INVALID', '能力卡职责位无效');
    }
    const manifestId = typeof record.parentSkillId === 'string' ? record.parentSkillId : skillId;
    const manifest = capabilityManifestFor(manifestId);
    if (!manifest) continue;
    if (manifest.kind !== 'role-skill') {
      throw new CapabilityRoleAssignmentError('CAPABILITY_ROLE_KIND_UNSUPPORTED', '该能力卡不能放入旧职责位');
    }
    const stage = ROLE_SLOT_STAGES[slot];
    if (!manifest.stages.includes(stage)) {
      throw new CapabilityRoleAssignmentError('CAPABILITY_ROLE_STAGE_UNSUPPORTED', '能力卡不支持当前职责位');
    }
  }
}

export function validateCapabilityInvocation(id: string, stage: CapabilityStage): CapabilityManifestEntry {
  const manifest = capabilityManifestFor(id);
  if (!manifest || manifest.runtimeStatus !== 'active') {
    throw new CapabilityInvocationError('CAPABILITY_NOT_FOUND', 'capability is not active');
  }
  if (!manifest.stages.includes(stage)) {
    throw new CapabilityInvocationError('CAPABILITY_STAGE_UNSUPPORTED', 'stage is not supported by capability');
  }
  if (!manifest.allowedScopes.includes('single-run')) {
    throw new CapabilityInvocationError('CAPABILITY_SCOPE_UNSUPPORTED', 'capability is not executable as a single run');
  }
  const isPreviewOnlyTransform = manifest.output === 'transform-preview' && manifest.sideEffect === 'preview-only';
  if (manifest.kind !== 'utility' && manifest.kind !== 'diagnostic' && !isPreviewOnlyTransform) {
    throw new CapabilityInvocationError('CAPABILITY_NOT_EXECUTABLE', 'capability is not a one-shot diagnostic or preview utility');
  }
  return manifest;
}

/** Server-side pre-execution gate for candidate-producing capabilities. */
export function validateArtifactCapabilityExecutionRequest(input: {
  capabilityId: string;
  capabilityVersion: string;
  artifactKind: CreativeArtifactKind;
  operation: ArtifactOperation;
  scope: 'project' | 'volume' | 'chapter' | 'selection' | 'single-run';
  availableArtifacts: readonly CreativeArtifactRef[];
}): CapabilityManifestEntry {
  const manifest = capabilityManifestFor(input.capabilityId);
  if (!manifest) throw new ArtifactCapabilityExecutionError('ARTIFACT_CAPABILITY_NOT_FOUND', 'capability does not exist');
  if (manifest.runtimeStatus !== 'active') {
    throw new ArtifactCapabilityExecutionError('ARTIFACT_CAPABILITY_RUNTIME_UNAVAILABLE', 'capability is not runtime active');
  }
  const result = validateArtifactCapabilityExecution({ ...input, manifest });
  if (!result.ok) {
    throw new ArtifactCapabilityExecutionError(
      result.code,
      result.code === 'ARTIFACT_CAPABILITY_GAP' ? 'required artifact inputs are missing' : 'artifact execution is not allowed',
      result.missingArtifactKinds,
    );
  }
  return manifest;
}
