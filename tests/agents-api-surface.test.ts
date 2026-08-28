import assert from 'node:assert/strict';
import test from 'node:test';

import * as agents from '../src/lib/agents';

test('agents module exposes only active helpers for the current frontend flow', () => {
  assert.equal(typeof agents.buildContextPrompt, 'function');
  assert.equal(typeof agents.extractWorldSetupPhase, 'function');
  assert.equal(typeof agents.editorAgentPhase, 'function');
  assert.equal('writerAgentPhase' in agents, false);
  assert.equal('criticAgentPhase' in agents, false);
});
