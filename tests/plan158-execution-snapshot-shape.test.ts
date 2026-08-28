import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExecutionFlowStep, ExecutionOverlay } from '../shared/types.js';

test('Plan 158 freezes the active flow identity and reproducible card metadata', () => {
    const flow: ExecutionFlowStep = {
      activeFlowId: 'generic-novel-flow',
      currentStep: 'draft',
      name: '正文',
      input: 'sceneBeats',
      output: 'draft',
      stage: 'writer',
      assetId: 'prose-action-booster',
      qualityGate: '可读',
      prompt: 'rules',
    };
    const card: ExecutionOverlay = {
      id: 'card-1',
      version: 3,
      source: 'book-extracted',
      position: 'project-main',
      type: 'style-card',
      stages: ['writer'],
      prompt: 'frozen rules',
      dimensionOwners: { style: 'card-1' },
      resolvedRules: { style: { sentenceLength: 'short' } },
      lineage: { rootId: 'card-root', components: [{ skillId: 'source-1', version: 2 }] },
    };

  assert.equal(flow.activeFlowId, 'generic-novel-flow');
  assert.equal(card.position, 'project-main');
  assert.deepEqual(card.resolvedRules, { style: { sentenceLength: 'short' } });
});
