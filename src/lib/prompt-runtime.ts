import { mergePromptTemplates, type PromptTemplates } from '../config/prompt-templates';
import type { PromptSurface, PromptStage } from './prompt-stage-routing';
import { selectPromptStageForSurface } from './prompt-stage-routing';
import { buildPromptAssetMap, getPromptAssetsByStage } from './prompt-assets';
import type { PromptAsset, PromptTemplateKey } from '../types';

const DEFAULT_TEMPLATE_BY_STAGE_AND_SURFACE: Partial<
  Record<PromptSurface, Partial<Record<PromptStage, PromptTemplateKey>>>
> = {
  welcome: {
    discovery: 'storyCards',
  },
  'world-onboarding': {
    foundation: 'setupTaskRefine',
  },
  'workspace-beats': {
    planning: 'editorAgent',
  },
  'workspace-draft': {
    drafting: 'orchestrateWriter',
  },
  'chapter-polish': {
    polish: 'manualAudit',
  },
  'chapter-review': {
    review: 'orchestrateCritic',
  },
};

export interface ResolvePromptAssetOptions {
  surface: PromptSurface;
  promptTemplates?: Partial<PromptTemplates>;
  preferredTemplateKey?: PromptTemplateKey;
}

export function resolvePromptAssetForSurface({
  surface,
  promptTemplates,
  preferredTemplateKey,
}: ResolvePromptAssetOptions): PromptAsset {
  const stage = selectPromptStageForSurface(surface);
  const assets = buildPromptAssetMap();
  const templates = mergePromptTemplates(promptTemplates);
  const stageAssets = getPromptAssetsByStage(assets, stage);

  const resolvedTemplateKey =
    preferredTemplateKey ?? DEFAULT_TEMPLATE_BY_STAGE_AND_SURFACE[surface]?.[stage];

  const asset =
    (resolvedTemplateKey
      ? stageAssets.find((entry) => entry.id === resolvedTemplateKey)
      : undefined) ?? stageAssets[0];

  if (!asset) {
    throw new Error(`No prompt asset configured for surface "${surface}" at stage "${stage}"`);
  }

  return {
    ...asset,
    template: templates[asset.id],
  };
}
