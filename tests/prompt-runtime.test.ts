import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePromptAssetForSurface } from '../src/lib/prompt-runtime';

test('resolvePromptAssetForSurface maps welcome to the story card discovery asset', () => {
  const asset = resolvePromptAssetForSurface({
    surface: 'welcome',
  });

  assert.equal(asset.stage, 'discovery');
  assert.equal(asset.id, 'storyCards');
  assert.equal(asset.outputShape, 'json');
});

test('resolvePromptAssetForSurface maps world onboarding to the setup refine foundation asset', () => {
  const asset = resolvePromptAssetForSurface({
    surface: 'world-onboarding',
  });

  assert.equal(asset.stage, 'foundation');
  assert.equal(asset.id, 'setupTaskRefine');
  assert.equal(asset.outputShape, 'plain-text');
});

test('resolvePromptAssetForSurface maps workspace beats to the planning asset', () => {
  const asset = resolvePromptAssetForSurface({
    surface: 'workspace-beats',
  });

  assert.equal(asset.stage, 'planning');
  assert.equal(asset.id, 'editorAgent');
});

test('resolvePromptAssetForSurface maps workspace draft to the drafting asset', () => {
  const asset = resolvePromptAssetForSurface({
    surface: 'workspace-draft',
  });

  assert.equal(asset.stage, 'drafting');
  assert.equal(asset.id, 'orchestrateWriter');
});

test('resolvePromptAssetForSurface maps chapter polish to the audit asset', () => {
  const asset = resolvePromptAssetForSurface({
    surface: 'chapter-polish',
  });

  assert.equal(asset.stage, 'polish');
  assert.equal(asset.id, 'manualAudit');
  assert.equal(asset.outputShape, 'json');
});

test('resolvePromptAssetForSurface maps chapter review to the critic asset', () => {
  const asset = resolvePromptAssetForSurface({
    surface: 'chapter-review',
  });

  assert.equal(asset.stage, 'review');
  assert.equal(asset.id, 'orchestrateCritic');
});

test('resolvePromptAssetForSurface allows a stage-specific override inside one surface', () => {
  const asset = resolvePromptAssetForSurface({
    surface: 'workspace-beats',
    preferredTemplateKey: 'generateOutline',
  });

  assert.equal(asset.stage, 'planning');
  assert.equal(asset.id, 'generateOutline');
});
