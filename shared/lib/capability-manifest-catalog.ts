import type { CapabilityManifestEntry } from '../types/capability-manifest.js';
import type { CapabilityUsageMode } from '../types/creative-artifacts.js';
import type { CapabilityStage } from '../types/capability-execution.js';
import type { DeconstructionCardType } from '../types/skills.js';

type ManifestDefinition = Omit<CapabilityManifestEntry, 'id'>;

/** Normalizes legacy manifests and projects utility/guardrail scope metadata consistently. */
export function projectCapabilityManifest(entry: CapabilityManifestEntry): CapabilityManifestEntry {
  const legacyScope = entry.persistence;
  const allowedScopes = Array.isArray(entry.allowedScopes) && entry.allowedScopes.length > 0
    ? [...entry.allowedScopes]
    : legacyScope ? [legacyScope === 'chapter-session' ? 'chapter' : legacyScope] : [];
  const usageModes: CapabilityUsageMode[] = entry.usageModes
    ? [...entry.usageModes]
    : entry.persistence === 'project' || entry.persistence === 'chapter-session'
      ? ['persistent-rule']
      : entry.persistence === 'single-run'
        ? ['single-run']
        : entry.kind === 'flow'
          ? ['flow-step']
          : [];
  return { ...entry, allowedScopes, stages: [...entry.stages], ...(usageModes.length ? { usageModes } : {}) };
}

type TechniqueOptions = Pick<ManifestDefinition, 'input' | 'output' | 'allowedScopes' | 'persistence' | 'sideEffect' | 'usageModes' | 'artifactContract'>;

const technique = (
  stages: readonly CapabilityStage[],
  sourceType: CapabilityManifestEntry['sourceType'],
  options: TechniqueOptions,
  outputArtifact?: string,
): ManifestDefinition => ({
  version: '3', kind: 'technique', stages,
  action: 'use-technique', runtimeStatus: 'active', sourceType,
  ...options,
  outputArtifact,
  displayStages: options.output === 'transform-preview'
    ? ['style-polish']
    : stages.includes('planner') ? ['creative-setup'] : ['active-drafting'],
});
const skillCard = (
  stages: readonly CapabilityStage[],
  sourceType: CapabilityManifestEntry['sourceType'],
  deconstructionCardType: DeconstructionCardType,
): ManifestDefinition => ({
  version: '3', kind: 'skill-card', stages, input: 'text', output: 'configuration',
  action: 'add-to-stack', allowedScopes: ['project', 'chapter'],
  persistence: 'project', sideEffect: 'configuration', runtimeStatus: 'active', sourceType,
  deconstructionCardType,
  displayStages: ['active-drafting', 'style-polish'],
});
const diagnostic = (stages: readonly CapabilityStage[], sourceType: CapabilityManifestEntry['sourceType']): ManifestDefinition => ({
  version: '3', kind: 'diagnostic', stages, input: 'text', output: 'diagnostic',
  action: 'run-diagnostic', allowedScopes: ['single-run'],
  persistence: 'single-run', sideEffect: 'none', runtimeStatus: 'active', sourceType,
  displayStages: ['style-polish'],
});

const CURATED_DEFINITIONS: Readonly<Record<string, ManifestDefinition>> = {
  'opening-gold-three': technique(['planner'], 'built-in', {
    input: 'outline-source', output: 'artifact-candidate', allowedScopes: ['project'], persistence: 'project', sideEffect: 'configuration', usageModes: ['single-run', 'flow-step'],
    artifactContract: { artifactKinds: ['master-outline', 'volume-outline', 'chapter-outline'], operations: ['generate', 'restructure', 'optimize'], allowedScopes: ['project', 'single-run'], requiredInputs: ['master-outline'], output: 'artifact-candidate', canonEffect: 'candidate-only' },
  }, 'chapterPlan'),
  'opening-novelty-hook': { ...diagnostic(['planner'], 'licensed'), displayStages: ['creative-setup'] },
  'bible-world-builder': technique(['planner'], 'licensed', {
    input: 'outline-source', output: 'artifact-candidate', allowedScopes: ['project'], persistence: 'project', sideEffect: 'configuration', usageModes: ['single-run', 'flow-step'],
    artifactContract: { artifactKinds: ['world'], operations: ['generate', 'restructure', 'optimize'], allowedScopes: ['project', 'single-run'], requiredInputs: [], output: 'artifact-candidate', canonEffect: 'candidate-only' },
  }, 'worldBibleCandidate'),
  'bible-character-arc': technique(['planner'], 'built-in', {
    input: 'outline-source', output: 'artifact-candidate', allowedScopes: ['project'], persistence: 'project', sideEffect: 'configuration', usageModes: ['single-run', 'flow-step'],
    artifactContract: { artifactKinds: ['character'], operations: ['restructure'], allowedScopes: ['project', 'single-run'], requiredInputs: ['character'], output: 'artifact-candidate', canonEffect: 'candidate-only' },
  }, 'characterCardCandidate'),
  'prose-mouth-flavor': technique(['writer'], 'plaza', {
    input: 'text', output: 'configuration', allowedScopes: ['project', 'chapter', 'single-run'], persistence: 'chapter-session', sideEffect: 'configuration', usageModes: ['persistent-rule', 'single-run'],
  }, 'draft'),
  'prose-action-booster': technique(['writer'], 'built-in', {
    input: 'text', output: 'configuration', allowedScopes: ['project', 'chapter', 'single-run'], persistence: 'chapter-session', sideEffect: 'configuration', usageModes: ['persistent-rule', 'single-run'],
  }, 'draft'),
  'audit-logical-sanity': { ...diagnostic(['critic'], 'plaza'), runtimeStatus: 'unavailable' },
  'audit-cliche-detector': diagnostic(['critic'], 'built-in'),
  'de-ai-slop-shield': technique(['writer', 'critic'], 'built-in', {
    input: 'text', output: 'transform-preview', allowedScopes: ['chapter', 'single-run'], persistence: 'single-run', sideEffect: 'preview-only', usageModes: ['single-run'],
  }, 'transformPreview'),
  'de-ai-rhythm-restorer': technique(['writer', 'critic'], 'plaza', {
    input: 'text', output: 'transform-preview', allowedScopes: ['chapter', 'single-run'], persistence: 'single-run', sideEffect: 'preview-only', usageModes: ['single-run'],
  }, 'transformPreview'),
  'platform-tomato-scoring': { ...diagnostic(['critic'], 'licensed'), runtimeStatus: 'unavailable', displayStages: ['commercial-sign'] },
  'platform-webnovel-criteria': { ...diagnostic(['critic'], 'licensed'), runtimeStatus: 'unavailable', displayStages: ['commercial-sign'] },
  'style-cthulhu-mystique': skillCard(['writer'], 'licensed', 'style-card'),
  'style-ancient-elegance': skillCard(['writer'], 'plaza', 'style-card'),
  'deconstruct-golden-climax': skillCard(['planner', 'writer'], 'plaza', 'pacing-card'),
  'deconstruct-suspense-hook': skillCard(['planner', 'writer'], 'plaza', 'hook-card'),
};

const FLOW_IDS = new Set([
  'xiaofeiji-novel-flow', 'generic-novel-flow', 'tomato-platform-flow',
  'book-deconstruction-flow', 'fenghua-short-flow', 'tianma-outline-flow',
]);

export function getCatalogCapabilityManifest(assetId: string): CapabilityManifestEntry | undefined {
  const definition = CURATED_DEFINITIONS[assetId];
  if (definition) return projectCapabilityManifest({ id: assetId, ...definition });
  if (FLOW_IDS.has(assetId)) {
    return projectCapabilityManifest({
      id: assetId, version: '3', kind: 'flow', stages: ['planner', 'writer', 'critic'],
      input: 'outline-source', output: 'configuration', action: 'activate-flow',
      allowedScopes: ['project'],
      persistence: 'project', sideEffect: 'configuration', runtimeStatus: 'active', sourceType: 'built-in',
    });
  }
  return undefined;
}

export function listCatalogCapabilityManifests(): CapabilityManifestEntry[] {
  return [...Object.keys(CURATED_DEFINITIONS), ...FLOW_IDS]
    .map((id) => getCatalogCapabilityManifest(id))
    .filter((entry): entry is CapabilityManifestEntry => Boolean(entry));
}
