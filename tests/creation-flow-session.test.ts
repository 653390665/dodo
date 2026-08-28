import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  closeDb,
  createNovel,
  getActiveCreationFlowSession,
  getCreationFlowReadiness,
  initDb,
  markArtifactReviewRequired,
  recordAcceptedFlowOutput,
  saveArtifactVersion,
  startCreationFlow,
  createOutlineArtifact,
  activateOutlineArtifact,
  getCanonFingerprint,
  getOutlineArtifact,
} from '../server/lib/db.js';
import { validateArtifactCapabilityExecutionRequest } from '../server/capabilities/manifest.js';
import { buildFlowMigrationCandidate } from '../server/lib/db/creation-flows.js';
import { getDatabaseGeneration, getDb } from '../server/lib/db-instance.js';
import { registerCreationFlowRoutes } from '../server/routes/creation-flows.js';
import { acceptOutlineCandidate, previewOutlineCandidate } from '../server/helpers/creative-artifact-candidate-adapters.js';
import type { CreationFlowDefinitionDraft } from '../shared/types/creation-flow.js';

const worldFlow = (): CreationFlowDefinitionDraft => ({
  id: 'world-flow',
  version: '1',
  steps: [{
    id: 'world',
    capabilityId: 'bible-world-builder',
    dependsOn: [],
    requiredArtifactKinds: [],
    producedArtifactKind: 'world',
    required: true,
  }],
});

const importedFlow = (): CreationFlowDefinitionDraft => ({
  id: 'import-flow',
  version: '1',
  steps: [
    {
      id: 'world',
      capabilityId: 'bible-world-builder',
      dependsOn: [],
      requiredArtifactKinds: [],
      producedArtifactKind: 'world',
      required: true,
    },
    {
      id: 'character',
      capabilityId: 'bible-character-arc',
      dependsOn: ['world'],
      requiredArtifactKinds: ['character'],
      producedArtifactKind: 'character',
      required: true,
    },
  ],
});

function createTestNovel(id = 'novel-1') {
  createNovel({
    id,
    title: id,
    authorId: 'local',
    summary: '',
    status: 'ongoing',
    createdAt: 1,
    updatedAt: 1,
  });
}

test.beforeEach(() => {
  closeDb();
  initDb(':memory:');
  createTestNovel();
});

test.after(() => closeDb());

test('starting a flow freezes capability versions without copying card payloads', () => {
  const session = startCreationFlow({
    novelId: 'novel-1',
    definition: worldFlow(),
    databaseGeneration: getDatabaseGeneration(),
  });

  assert.equal(session.definition.steps[0]?.capabilityVersion, '3');
  assert.equal(session.currentStepId, 'world');
  assert.equal(session.status, 'active');
  const stored = JSON.stringify(session.definition);
  assert.equal(stored.includes('template'), false);
  assert.equal(stored.includes('prompt'), false);
  assert.deepEqual(Object.keys(session.definition.steps[0] || {}).sort(), [
    'capabilityId', 'capabilityVersion', 'dependsOn', 'id', 'producedArtifactKind',
    'required', 'requiredArtifactKinds',
  ]);
});

test('freezing ignores undeclared step payload fields before persistence', () => {
  const definition = {
    ...worldFlow(),
    steps: [{
      ...worldFlow().steps[0],
      prompt: 'must not persist',
      template: { card: 'must not persist' },
    }],
  } as unknown as CreationFlowDefinitionDraft;

  const session = startCreationFlow({
    novelId: 'novel-1',
    definition,
    databaseGeneration: getDatabaseGeneration(),
  });
  const stored = getDb().prepare(`
    SELECT frozen_definition_json FROM creation_flow_sessions WHERE id = ?
  `).get(session.id) as { frozen_definition_json: string };

  assert.equal(stored.frozen_definition_json.includes('prompt'), false);
  assert.equal(stored.frozen_definition_json.includes('template'), false);
  assert.equal(JSON.stringify(getActiveCreationFlowSession('novel-1')).includes('prompt'), false);
  assert.equal(JSON.stringify(getActiveCreationFlowSession('novel-1')).includes('template'), false);
});

test('outline adapter acceptance advances flow only with exact frozen capability provenance', async () => {
  createOutlineArtifact({
    id: 'master-1', novelId: 'novel-1', level: 'master', scope: {}, content: 'Master',
    core: {
      schemaVersion: 1,
      nodes: [{ id: 'master-node', type: 'premise', title: '起点', intent: '建立', order: 0, characterIds: [], foreshadowingIds: [] }],
      promiseActions: [],
    },
  });
  activateOutlineArtifact('novel-1', 'master-1');
  const definition: CreationFlowDefinitionDraft = {
    id: 'outline-flow',
    version: '1',
    steps: [{
      id: 'volume-outline',
      capabilityId: 'opening-gold-three',
      dependsOn: [],
      requiredArtifactKinds: ['master-outline'],
      producedArtifactKind: 'volume-outline',
      required: true,
    }],
  };

  const session = startCreationFlow({ novelId: 'novel-1', definition, databaseGeneration: getDatabaseGeneration() });
  assert.equal(session.currentStepId, 'volume-outline');
  createOutlineArtifact({
    id: 'manual-volume', novelId: 'novel-1', level: 'volume', scope: { volumeName: '卷一' }, content: 'Manual',
    core: {
      schemaVersion: 1,
      nodes: [{ id: 'volume-node', parentNodeId: 'master-node', type: 'turn', title: '转折', intent: '推进', order: 0, characterIds: [], foreshadowingIds: [] }],
      promiseActions: [],
    },
  });
  activateOutlineArtifact('novel-1', 'manual-volume');
  assert.throws(
    () => recordAcceptedFlowOutput({
      novelId: 'novel-1', sessionId: session.id,
      artifact: { kind: 'volume-outline', id: 'manual-volume', version: 1 }, databaseGeneration: getDatabaseGeneration(),
    }),
    (error: unknown) => (error as { code?: string }).code === 'CREATION_FLOW_OUTPUT_CAPABILITY_MISMATCH',
  );

  const patch = await previewOutlineCandidate({
    novelId: 'novel-1', baseFingerprint: getCanonFingerprint('novel-1'),
    sourceCapabilityVersions: [{ capabilityId: 'opening-gold-three', version: '3' }],
    operations: [{
      operation: 'create-scoped-outline', level: 'volume', scope: { volumeName: '卷一' }, content: 'Generated',
      core: {
        schemaVersion: 1,
        nodes: [{ id: 'generated-volume-node', parentNodeId: 'master-node', type: 'turn', title: '转折', intent: '推进', order: 0, characterIds: [], foreshadowingIds: [] }],
        promiseActions: [],
      },
    }],
  });
  assert.deepEqual(patch.sourceCapabilityVersions, [{ capabilityId: 'opening-gold-three', version: '3' }]);
  const candidate = await acceptOutlineCandidate({
    novelId: 'novel-1', patchId: patch.id, databaseGeneration: getDatabaseGeneration(),
  });
  const acceptedRef = candidate.acceptedOutlineRefs![0]!;
  assert.deepEqual(getOutlineArtifact(acceptedRef.id, 'novel-1')?.sourceCapabilityVersions, [{ capabilityId: 'opening-gold-three', version: '3' }]);
  const accepted = recordAcceptedFlowOutput({
    novelId: 'novel-1', sessionId: session.id,
    artifact: acceptedRef, databaseGeneration: getDatabaseGeneration(),
  });
  assert.equal(accepted.status, 'completed');
});

test('atomic execution stays independent and flow readiness returns exact missing kinds', () => {
  assert.doesNotThrow(() => validateArtifactCapabilityExecutionRequest({
    capabilityId: 'opening-gold-three',
    capabilityVersion: '3',
    artifactKind: 'master-outline',
    operation: 'generate',
    scope: 'single-run',
    availableArtifacts: [{ kind: 'master-outline', id: 'outline-1', version: 1 }],
  }));

  const session = startCreationFlow({
    novelId: 'novel-1',
    definition: importedFlow(),
    databaseGeneration: getDatabaseGeneration(),
  });
  assert.deepEqual(getCreationFlowReadiness(session), { ready: true, missingArtifactKinds: [] });

  const unmet = {
    ...session,
    currentStepId: 'character',
    acceptedOutputRefs: [{ kind: 'world' as const, id: 'world-1', version: 1 }],
  };
  assert.deepEqual(getCreationFlowReadiness(unmet), {
    ready: false,
    missingArtifactKinds: ['character'],
  });
});

test('execution alone does not advance; accepting a compatible governed version does', () => {
  const session = startCreationFlow({
    novelId: 'novel-1',
    definition: worldFlow(),
    databaseGeneration: getDatabaseGeneration(),
  });

  validateArtifactCapabilityExecutionRequest({
    capabilityId: 'bible-world-builder',
    capabilityVersion: '3',
    artifactKind: 'world',
    operation: 'generate',
    scope: 'single-run',
    availableArtifacts: [],
  });
  assert.equal(getActiveCreationFlowSession('novel-1')?.currentStepId, 'world');

  const accepted = saveArtifactVersion({
    novelId: 'novel-1',
    artifactKind: 'world',
    artifactId: 'world-1',
    core: { schemaVersion: 1 },
    provenance: {
      sourceCapabilityVersions: [{ capabilityId: 'bible-world-builder', version: '3' }],
    },
  });
  const completed = recordAcceptedFlowOutput({
    novelId: 'novel-1',
    sessionId: session.id,
    artifact: { kind: 'world', id: accepted.artifactId, version: accepted.version },
    databaseGeneration: getDatabaseGeneration(),
  });

  assert.equal(completed.status, 'completed');
  assert.equal(completed.currentStepId, undefined);
  assert.deepEqual(completed.acceptedOutputRefs, [{ kind: 'world', id: 'world-1', version: 1 }]);
});

test('a mismatched capability receipt cannot complete a step', () => {
  const session = startCreationFlow({
    novelId: 'novel-1',
    definition: worldFlow(),
    databaseGeneration: getDatabaseGeneration(),
  });
  const accepted = saveArtifactVersion({
    novelId: 'novel-1',
    artifactKind: 'world',
    artifactId: 'world-1',
    core: { schemaVersion: 1 },
    provenance: {
      sourceCapabilityVersions: [{ capabilityId: 'other-capability', version: '3' }],
    },
  });

  assert.throws(
    () => recordAcceptedFlowOutput({
      novelId: 'novel-1',
      sessionId: session.id,
      artifact: { kind: 'world', id: accepted.artifactId, version: accepted.version },
      databaseGeneration: getDatabaseGeneration(),
    }),
    (error: unknown) => (error as { code?: string }).code === 'CREATION_FLOW_OUTPUT_CAPABILITY_MISMATCH',
  );
  assert.equal(getActiveCreationFlowSession('novel-1')?.currentStepId, 'world');
});

test('imported projects skip satisfied stages and stop at the first stale stage', () => {
  saveArtifactVersion({
    novelId: 'novel-1', artifactKind: 'world', artifactId: 'world-1',
    core: { schemaVersion: 1 }, provenance: { source: 'import' },
  });
  saveArtifactVersion({
    novelId: 'novel-1', artifactKind: 'character', artifactId: 'character-1',
    core: { schemaVersion: 1 }, provenance: { source: 'import' },
  });
  markArtifactReviewRequired({
    novelId: 'novel-1',
    artifact: { kind: 'character', id: 'character-1', version: 1 },
    reason: 'upstream changed',
  });

  const session = startCreationFlow({
    novelId: 'novel-1',
    definition: importedFlow(),
    databaseGeneration: getDatabaseGeneration(),
  });

  assert.equal(session.currentStepId, 'character');
  assert.deepEqual(session.acceptedOutputRefs, [{ kind: 'world', id: 'world-1', version: 1 }]);
  assert.deepEqual(getCreationFlowReadiness(session), {
    ready: false,
    missingArtifactKinds: ['character'],
  });
});

test('capability upgrades produce a migration candidate without mutating the active session', () => {
  const session = startCreationFlow({
    novelId: 'novel-1',
    definition: worldFlow(),
    databaseGeneration: getDatabaseGeneration(),
  });
  const proposed = {
    ...session.definition,
    steps: session.definition.steps.map((step) => ({ ...step, capabilityVersion: '4' })),
  };

  const candidate = buildFlowMigrationCandidate(session, proposed);

  assert.deepEqual(candidate.changedCapabilities, [{
    capabilityId: 'bible-world-builder', fromVersion: '3', toVersion: '4',
  }]);
  assert.equal(getActiveCreationFlowSession('novel-1')?.definition.steps[0]?.capabilityVersion, '3');
});

test('routes start and inspect a persisted version-frozen session', async () => {
  const app = express();
  app.use(express.json());
  registerCreationFlowRoutes(app);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const start = await fetch(`${base}/api/novels/novel-1/creation-flows/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ definition: worldFlow(), databaseGeneration: getDatabaseGeneration() }),
    });
    assert.equal(start.status, 201);
    const started = await start.json() as { id: string; definition: { steps: Array<{ capabilityVersion: string }> } };
    assert.equal(started.definition.steps[0]?.capabilityVersion, '3');

    const inspect = await fetch(`${base}/api/novels/novel-1/creation-flows/active?generation=${getDatabaseGeneration()}`);
    assert.equal(inspect.status, 200);
    assert.equal(((await inspect.json()) as { id: string }).id, started.id);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
