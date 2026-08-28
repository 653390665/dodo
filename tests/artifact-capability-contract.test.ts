import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composeArtifactCapabilities,
  validateArtifactCapabilityExecution,
} from '../shared/lib/artifact-capability-contract.js';
import { getCatalogCapabilityManifest } from '../shared/lib/capability-manifest-catalog.js';
import {
  ArtifactCapabilityExecutionError,
  validateArtifactCapabilityExecutionRequest,
} from '../server/capabilities/manifest.js';

test('artifact catalog contracts distinguish target, operation, and usage semantics', () => {
  const character = getCatalogCapabilityManifest('bible-character-arc');
  assert.deepEqual(character?.usageModes, ['single-run', 'flow-step']);
  assert.deepEqual(character?.artifactContract, {
    artifactKinds: ['character'],
    operations: ['restructure'],
    allowedScopes: ['project', 'single-run'],
    requiredInputs: ['character'],
    output: 'artifact-candidate',
    canonEffect: 'candidate-only',
  });

  const world = getCatalogCapabilityManifest('bible-world-builder');
  assert.deepEqual(world?.artifactContract?.artifactKinds, ['world']);
  assert.equal(world?.output, 'artifact-candidate');
  assert.equal(world?.outputArtifact, 'worldBibleCandidate');

  const opening = getCatalogCapabilityManifest('opening-gold-three');
  assert.deepEqual(opening?.artifactContract?.artifactKinds, ['master-outline', 'volume-outline', 'chapter-outline']);
  assert.deepEqual(opening?.artifactContract?.operations, ['generate', 'restructure', 'optimize']);

  assert.deepEqual(getCatalogCapabilityManifest('prose-mouth-flavor')?.usageModes, ['persistent-rule', 'single-run']);
  assert.deepEqual(getCatalogCapabilityManifest('de-ai-slop-shield')?.usageModes, ['single-run']);
});

test('artifact execution rejects incompatible scope, operation, runtime, version, and missing prerequisites', () => {
  const manifest = getCatalogCapabilityManifest('bible-character-arc')!;
  const input = {
    manifest,
    capabilityVersion: manifest.version,
    artifactKind: 'character' as const,
    operation: 'restructure' as const,
    scope: 'project' as const,
    availableArtifacts: [{ kind: 'character' as const, id: 'hero', version: 1 }],
  };
  assert.deepEqual(validateArtifactCapabilityExecution(input), { ok: true });
  assert.deepEqual(validateArtifactCapabilityExecution({ ...input, scope: 'chapter' }), {
    ok: false, code: 'ARTIFACT_CAPABILITY_SCOPE_UNSUPPORTED',
  });
  assert.deepEqual(validateArtifactCapabilityExecution({ ...input, operation: 'generate' }), {
    ok: false, code: 'ARTIFACT_CAPABILITY_OPERATION_UNSUPPORTED',
  });
  assert.deepEqual(validateArtifactCapabilityExecution({ ...input, capabilityVersion: 'stale' }), {
    ok: false, code: 'ARTIFACT_CAPABILITY_VERSION_STALE',
  });
  assert.deepEqual(validateArtifactCapabilityExecution({ ...input, availableArtifacts: [] }), {
    ok: false, code: 'ARTIFACT_CAPABILITY_GAP', missingArtifactKinds: ['character'],
  });
});

test('server artifact gate preserves exact gap details before execution', () => {
  assert.throws(
    () => validateArtifactCapabilityExecutionRequest({
      capabilityId: 'bible-character-arc', capabilityVersion: '3', artifactKind: 'character',
      operation: 'restructure', scope: 'project', availableArtifacts: [],
    }),
    (error: unknown) => error instanceof ArtifactCapabilityExecutionError
      && error.code === 'ARTIFACT_CAPABILITY_GAP'
      && JSON.stringify(error.missingArtifactKinds) === JSON.stringify(['character']),
  );
});

test('composition freezes compatible ordered capabilities and returns explicit conflicts', () => {
  const world = getCatalogCapabilityManifest('bible-world-builder')!;
  const character = getCatalogCapabilityManifest('bible-character-arc')!;
  const compatible = composeArtifactCapabilities({
    manifests: [character, world],
    diagnosedGoal: '补齐角色动机',
    authorGoal: '强化主角的恐惧与抉择',
  });
  assert.equal(compatible.ok, true);
  if (compatible.ok) {
    assert.equal(compatible.goal, '强化主角的恐惧与抉择');
    assert.deepEqual(compatible.snapshot.map((entry) => entry.capabilityId), ['bible-character-arc', 'bible-world-builder']);
    assert.deepEqual(compatible.snapshot.map((entry) => entry.version), ['3', '3']);
  }

  const conflict = composeArtifactCapabilities({
    manifests: [world, { ...world, id: 'world-override', version: '9' }],
    diagnosedGoal: '构建世界观',
    rulesByCapability: {
      'bible-world-builder': { 'world.hardRules': '严格限制' },
      'world-override': { 'world.hardRules': '完全开放' },
    },
  });
  assert.deepEqual(conflict, {
    ok: false,
    conflicts: [{
      field: 'world.hardRules',
      capabilityIds: ['bible-world-builder', 'world-override'],
      rules: ['严格限制', '完全开放'],
      resolution: 'author-choice-required',
    }],
  });
});
