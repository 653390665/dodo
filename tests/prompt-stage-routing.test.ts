import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPromptStageForSurface } from '../src/lib/prompt-stage-routing';

test('selectPromptStageForSurface routes onboarding to discovery or foundation', () => {
  assert.equal(selectPromptStageForSurface('welcome'), 'discovery');
  assert.equal(selectPromptStageForSurface('world-onboarding'), 'foundation');
});

test('selectPromptStageForSurface routes active chapter work to planning or drafting', () => {
  assert.equal(selectPromptStageForSurface('workspace-beats'), 'planning');
  assert.equal(selectPromptStageForSurface('workspace-draft'), 'drafting');
});

test('selectPromptStageForSurface routes cleanup tasks to polish and review', () => {
  assert.equal(selectPromptStageForSurface('chapter-polish'), 'polish');
  assert.equal(selectPromptStageForSurface('chapter-review'), 'review');
});
