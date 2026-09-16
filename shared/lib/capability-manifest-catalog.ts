import type { CapabilityManifestEntry } from '../types/capability-manifest.js';
import type { CapabilityUsageMode } from '../types/creative-artifacts.js';
import type { CapabilityStage } from '../types/capability-execution.js';
import type { DeconstructionCardType } from '../types/skills.js';
import { PROMPT_GOVERNANCE_CATALOG } from './prompt-governance-catalog.js';

type ManifestDefinition = Omit<CapabilityManifestEntry, 'id'>;

/** Normalizes legacy manifests and projects utility/guardrail scope metadata consistently. */
export function projectCapabilityManifest(entry: CapabilityManifestEntry): CapabilityManifestEntry {
  const legacyScope = entry.persistence;
  const allowedScopes =
    Array.isArray(entry.allowedScopes) && entry.allowedScopes.length > 0
      ? [...entry.allowedScopes]
      : legacyScope
        ? [legacyScope === 'chapter-session' ? 'chapter' : legacyScope]
        : [];
  const usageModes: CapabilityUsageMode[] = entry.usageModes
    ? [...entry.usageModes]
    : entry.persistence === 'project' || entry.persistence === 'chapter-session'
      ? ['persistent-rule']
      : entry.persistence === 'single-run'
        ? ['single-run']
        : entry.kind === 'flow'
          ? ['flow-step']
          : [];
  return {
    ...entry,
    allowedScopes,
    stages: [...entry.stages],
    ...(usageModes.length ? { usageModes } : {}),
  };
}

type TechniqueOptions = Pick<
  ManifestDefinition,
  | 'input'
  | 'output'
  | 'allowedScopes'
  | 'persistence'
  | 'sideEffect'
  | 'usageModes'
  | 'artifactContract'
>;

const technique = (
  stages: readonly CapabilityStage[],
  sourceType: CapabilityManifestEntry['sourceType'],
  options: TechniqueOptions,
  outputArtifact?: string
): ManifestDefinition => ({
  version: '3',
  kind: 'technique',
  stages,
  action: 'use-technique',
  runtimeStatus: 'active',
  sourceType,
  ...options,
  outputArtifact,
  displayStages:
    options.output === 'transform-preview'
      ? ['style-polish']
      : stages.includes('planner')
        ? ['creative-setup']
        : ['active-drafting'],
});
const skillCard = (
  stages: readonly CapabilityStage[],
  sourceType: CapabilityManifestEntry['sourceType'],
  deconstructionCardType: DeconstructionCardType
): ManifestDefinition => ({
  version: '3',
  kind: 'skill-card',
  stages,
  input: 'text',
  output: 'configuration',
  action: 'add-to-stack',
  allowedScopes: ['project', 'chapter'],
  persistence: 'project',
  sideEffect: 'configuration',
  runtimeStatus: 'active',
  sourceType,
  deconstructionCardType,
  displayStages: ['active-drafting', 'style-polish'],
});
const diagnostic = (
  stages: readonly CapabilityStage[],
  sourceType: CapabilityManifestEntry['sourceType']
): ManifestDefinition => ({
  version: '3',
  kind: 'diagnostic',
  stages,
  input: 'text',
  output: 'diagnostic',
  action: 'run-diagnostic',
  allowedScopes: ['single-run'],
  persistence: 'single-run',
  sideEffect: 'none',
  runtimeStatus: 'active',
  sourceType,
  displayStages: ['style-polish'],
});

const CURATED_DEFINITIONS: Readonly<Record<string, ManifestDefinition>> = {
  'opening-gold-three': technique(
    ['planner'],
    'built-in',
    {
      input: 'outline-source',
      output: 'artifact-candidate',
      allowedScopes: ['project'],
      persistence: 'project',
      sideEffect: 'configuration',
      usageModes: ['single-run', 'flow-step'],
      artifactContract: {
        artifactKinds: ['master-outline', 'volume-outline', 'chapter-outline'],
        operations: ['generate', 'restructure', 'optimize'],
        allowedScopes: ['project', 'single-run'],
        requiredInputs: ['master-outline'],
        output: 'artifact-candidate',
        canonEffect: 'candidate-only',
      },
    },
    'chapterPlan'
  ),
  'opening-novelty-hook': {
    ...diagnostic(['planner'], 'licensed'),
    displayStages: ['creative-setup'],
  },
  'bible-world-builder': technique(
    ['planner'],
    'licensed',
    {
      input: 'outline-source',
      output: 'artifact-candidate',
      allowedScopes: ['project'],
      persistence: 'project',
      sideEffect: 'configuration',
      usageModes: ['single-run', 'flow-step'],
      artifactContract: {
        artifactKinds: ['world'],
        operations: ['generate', 'restructure', 'optimize'],
        allowedScopes: ['project', 'single-run'],
        requiredInputs: [],
        output: 'artifact-candidate',
        canonEffect: 'candidate-only',
      },
    },
    'worldBibleCandidate'
  ),
  'bible-character-arc': technique(
    ['planner'],
    'built-in',
    {
      input: 'outline-source',
      output: 'artifact-candidate',
      allowedScopes: ['project'],
      persistence: 'project',
      sideEffect: 'configuration',
      usageModes: ['single-run', 'flow-step'],
      artifactContract: {
        artifactKinds: ['character'],
        operations: ['restructure'],
        allowedScopes: ['project', 'single-run'],
        requiredInputs: ['character'],
        output: 'artifact-candidate',
        canonEffect: 'candidate-only',
      },
    },
    'characterCardCandidate'
  ),
  // 重构模式（Plan 228）：来料加工——把用户既有资料当主输入，产物一律走候选。
  'refine-character-rebuild': technique(
    ['planner'],
    'built-in',
    {
      input: 'outline-source',
      output: 'artifact-candidate',
      allowedScopes: ['project'],
      persistence: 'project',
      sideEffect: 'configuration',
      usageModes: ['single-run', 'flow-step'],
      artifactContract: {
        artifactKinds: ['character'],
        operations: ['restructure'],
        allowedScopes: ['project', 'single-run'],
        requiredInputs: ['character'],
        output: 'artifact-candidate',
        canonEffect: 'candidate-only',
      },
    },
    'characterCardCandidate'
  ),
  'refine-outline-rebuild': technique(
    ['planner'],
    'built-in',
    {
      input: 'outline-source',
      output: 'outline-candidate',
      allowedScopes: ['project'],
      persistence: 'project',
      sideEffect: 'configuration',
      usageModes: ['single-run', 'flow-step'],
      artifactContract: {
        artifactKinds: ['master-outline', 'volume-outline', 'chapter-outline'],
        operations: ['restructure', 'optimize'],
        allowedScopes: ['project', 'single-run'],
        requiredInputs: ['master-outline'],
        output: 'outline-candidate',
        canonEffect: 'candidate-only',
      },
    },
    'outline-candidate'
  ),
  'prose-mouth-flavor': technique(
    ['writer'],
    'plaza',
    {
      input: 'text',
      output: 'configuration',
      allowedScopes: ['project', 'chapter', 'single-run'],
      persistence: 'chapter-session',
      sideEffect: 'configuration',
      usageModes: ['persistent-rule', 'single-run'],
    },
    'draft'
  ),
  'prose-action-booster': technique(
    ['writer'],
    'built-in',
    {
      input: 'text',
      output: 'configuration',
      allowedScopes: ['project', 'chapter', 'single-run'],
      persistence: 'chapter-session',
      sideEffect: 'configuration',
      usageModes: ['persistent-rule', 'single-run'],
    },
    'draft'
  ),
  'audit-logical-sanity': { ...diagnostic(['critic'], 'plaza'), runtimeStatus: 'unavailable' },
  'audit-cliche-detector': diagnostic(['critic'], 'built-in'),
  'de-ai-slop-shield': technique(
    ['writer', 'critic'],
    'built-in',
    {
      input: 'text',
      output: 'transform-preview',
      allowedScopes: ['chapter', 'single-run'],
      persistence: 'single-run',
      sideEffect: 'preview-only',
      usageModes: ['single-run'],
    },
    'transformPreview'
  ),
  'de-ai-rhythm-restorer': technique(
    ['writer', 'critic'],
    'plaza',
    {
      input: 'text',
      output: 'transform-preview',
      allowedScopes: ['chapter', 'single-run'],
      persistence: 'single-run',
      sideEffect: 'preview-only',
      usageModes: ['single-run'],
    },
    'transformPreview'
  ),
  'platform-tomato-scoring': {
    ...diagnostic(['critic'], 'licensed'),
    runtimeStatus: 'unavailable',
    displayStages: ['commercial-sign'],
  },
  'platform-webnovel-criteria': {
    ...diagnostic(['critic'], 'licensed'),
    runtimeStatus: 'unavailable',
    displayStages: ['commercial-sign'],
  },
  'style-cthulhu-mystique': skillCard(['writer'], 'licensed', 'style-card'),
  'style-ancient-elegance': skillCard(['writer'], 'plaza', 'style-card'),
  'deconstruct-golden-climax': skillCard(['planner', 'writer'], 'plaza', 'pacing-card'),
  'deconstruct-suspense-hook': skillCard(['planner', 'writer'], 'plaza', 'hook-card'),
};

const FLOW_IDS = new Set([
  'xiaofeiji-novel-flow',
  'generic-novel-flow',
  'tomato-platform-flow',
  'book-deconstruction-flow',
  'fenghua-short-flow',
  'tianma-outline-flow',
]);

export function getCatalogCapabilityManifest(assetId: string): CapabilityManifestEntry | undefined {
  const definition = CURATED_DEFINITIONS[assetId];
  if (definition) return projectCapabilityManifest({ id: assetId, ...definition });
  if (FLOW_IDS.has(assetId)) {
    return projectCapabilityManifest({
      id: assetId,
      version: '3',
      kind: 'flow',
      stages: ['planner', 'writer', 'critic'],
      input: 'outline-source',
      output: 'configuration',
      action: 'activate-flow',
      allowedScopes: ['project'],
      persistence: 'project',
      sideEffect: 'configuration',
      runtimeStatus: 'active',
      sourceType: 'built-in',
    });
  }
  // Plan 242：货架派生 manifest 兜底（散卡/消毒副本/题材模板等上架卡）。
  const derived = getShelfManifestIndex().get(assetId);
  if (derived) return derived;
  return undefined;
}

export function listCatalogCapabilityManifests(): CapabilityManifestEntry[] {
  return [...Object.keys(CURATED_DEFINITIONS), ...FLOW_IDS]
    .map((id) => getCatalogCapabilityManifest(id))
    .filter((entry): entry is CapabilityManifestEntry => Boolean(entry));
}

// ─── Plan 242：货架派生 manifest（CORR-02 家族收口）──────────────────────────
// 文风货架的散卡/消毒副本/题材模板此前不在 CURATED_DEFINITIONS 中，导致
// cloneAssetToSkill / launchTechnique 等治理链路查表失败 → 配置静默失败。
// 这里按源目录条目派生 technique manifest：只覆盖 runtime-active 的上架卡；
// sanitized-* 副本剥前缀取源条目、runtimeStatus 恒为 active（副本即运行态）。

type ShelfStage = string | undefined;

function shelfStages(stage: ShelfStage): CapabilityStage[] {
  if (stage === 'planning' || stage === 'foundation') return ['planner'];
  if (stage === 'review') return ['critic'];
  return ['writer'];
}

let shelfManifestIndex: Map<string, CapabilityManifestEntry> | null = null;

function getShelfManifestIndex(): Map<string, CapabilityManifestEntry> {
  if (shelfManifestIndex) return shelfManifestIndex;
  const index = new Map<string, CapabilityManifestEntry>();
  for (const asset of PROMPT_GOVERNANCE_CATALOG) {
    // 分支一：上架的 active 散卡（square-*/private-84系/creative-* 等）
    if (asset.runtimeStatus === 'active' && asset.placementTier === 'optional-style' && !CURATED_DEFINITIONS[asset.id]) {
      index.set(asset.id, {
        id: asset.id,
        version: '1',
        kind: 'technique',
        stages: shelfStages(asset.stage),
        input: 'text',
        output: 'configuration',
        action: 'use-technique',
        allowedScopes: ['project', 'chapter'],
        persistence: 'chapter-session',
        sideEffect: 'configuration',
        runtimeStatus: 'active',
        sourceType: asset.sourceType || 'plaza',
        usageModes: ['persistent-rule', 'single-run'],
      });
    }
    // 分支二：sanitize-required 候选 → 生成侧消毒副本（sanitized-*，运行态 active）
    if (asset.placementTier === 'sanitize-required' && asset.runtimeStatus === 'candidate' && asset.sourceGroup !== 'test-fixture') {
      index.set(`sanitized-${asset.id}`, {
        id: `sanitized-${asset.id}`,
        version: '1',
        kind: 'technique',
        stages: shelfStages(asset.stage),
        input: 'text',
        output: 'configuration',
        action: 'use-technique',
        allowedScopes: ['project', 'chapter'],
        persistence: 'chapter-session',
        sideEffect: 'configuration',
        runtimeStatus: 'active',
        sourceType: asset.sourceType || 'plaza',
        usageModes: ['persistent-rule', 'single-run'],
      });
    }
    if (asset.runtimeStatus === 'active' && asset.placementTier === 'optional-style') continue;
    if (asset.placementTier === 'sanitize-required' && asset.runtimeStatus === 'candidate') continue;
    index.set(asset.id, {
      id: asset.id,
      version: '1',
      kind: 'technique',
      stages: shelfStages(asset.stage),
      input: 'text',
      output: 'configuration',
      action: 'use-technique',
      allowedScopes: ['project', 'chapter'],
      persistence: 'chapter-session',
      sideEffect: 'configuration',
      runtimeStatus: 'active',
      sourceType: asset.sourceType || 'plaza',
      usageModes: ['persistent-rule', 'single-run'],
    });
    // 消毒副本：与源候选同 manifest（id 不同），运行态 active。
    index.set(`sanitized-${asset.id}`, { ...index.get(asset.id)!, id: `sanitized-${asset.id}` });
  }
  shelfManifestIndex = index;
  return index;
}
