import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROMPT_STAGE_ORDER,
  buildPromptAssetMap,
  getPromptAssetsByStage,
} from '../src/lib/prompt-assets';

test('prompt asset map exposes all six stages in stable order', () => {
  assert.deepEqual(PROMPT_STAGE_ORDER, [
    'discovery',
    'foundation',
    'planning',
    'drafting',
    'polish',
    'review',
  ]);
});

test('getPromptAssetsByStage groups existing templates into stage buckets', () => {
  const assets = buildPromptAssetMap();

  assert.equal(getPromptAssetsByStage(assets, 'discovery').some((asset) => asset.id === 'storyCards'), true);
  assert.equal(getPromptAssetsByStage(assets, 'foundation').some((asset) => asset.id === 'setupTaskRefine'), true);
  assert.equal(getPromptAssetsByStage(assets, 'planning').some((asset) => asset.id === 'editorAgent'), true);
  assert.equal(getPromptAssetsByStage(assets, 'drafting').some((asset) => asset.id === 'orchestrateWriter'), true);
  assert.equal(getPromptAssetsByStage(assets, 'polish').some((asset) => asset.id === 'manualAudit'), true);
  assert.equal(getPromptAssetsByStage(assets, 'review').some((asset) => asset.id === 'orchestrateCritic'), true);
});
