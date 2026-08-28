import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { fingerprintCreativeArtifact } from '../shared/lib/creative-artifact-fingerprint.js';
import { buildArtifactDiff } from '../shared/lib/creative-artifact-diff.js';
import {
  closeDb,
  createChapterProductionRun,
  createChapterProductionRunVersion,
  createCharacter,
  createForeshadowing,
  createNovel,
  createOutlineArtifact,
  activateOutlineArtifact,
  getArtifactCore,
  getArtifactCandidate,
  initDb,
  saveArtifactVersion,
} from '../server/lib/db.js';
import { getDatabaseGeneration, getDb } from '../server/lib/db-instance.js';
import {
  characterImpactReport,
} from '../server/helpers/character-candidates.js';
import {
  acceptArtifactCandidate,
  previewArtifactCandidate,
  rejectArtifactCandidate,
} from '../server/helpers/creative-artifact-candidates.js';
import {
  previewManuscriptCandidate,
  previewOutlineCandidate,
  acceptOutlineCandidate,
} from '../server/helpers/creative-artifact-candidate-adapters.js';
import { getCanonFingerprint } from '../server/lib/db/canon-patches.js';
import { registerCreativeArtifactRoutes } from '../server/routes/creative-artifacts.js';

test('fingerprint is stable when object keys are inserted in a different order', () => {
  const first = fingerprintCreativeArtifact({
    kind: 'world',
    version: 2,
    core: { rules: { hard: true, soft: false }, title: 'Rules' },
    content: 'A world',
  });
  const second = fingerprintCreativeArtifact({
    content: 'A world',
    core: { title: 'Rules', rules: { soft: false, hard: true } },
    version: 2,
    kind: 'world',
  });

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('fingerprint differentiates kind, version, and content', () => {
  const input = { kind: 'world' as const, version: 1, core: { value: 'same' }, content: 'same' };
  const baseline = fingerprintCreativeArtifact(input);

  assert.notEqual(fingerprintCreativeArtifact({ ...input, kind: 'character' }), baseline);
  assert.notEqual(fingerprintCreativeArtifact({ ...input, version: 2 }), baseline);
  assert.notEqual(fingerprintCreativeArtifact({ ...input, content: 'changed' }), baseline);
});

test('structured diff reports nested additions, removals, changes, and arrays as field changes', () => {
  const base = {
    unchanged: 'same',
    nested: { keep: true, removed: 'gone', changed: 1 },
    tags: ['one', 'two'],
  };
  const proposed = {
    unchanged: 'same',
    nested: { keep: true, added: 'new', changed: 2 },
    tags: ['one', 'three'],
  };

  assert.deepEqual(buildArtifactDiff(base, proposed), {
    changed: true,
    fields: [
      { path: 'nested.added', after: 'new', kind: 'added' },
      { path: 'nested.changed', before: 1, after: 2, kind: 'changed' },
      { path: 'nested.removed', before: 'gone', kind: 'removed' },
      { path: 'tags', before: ['one', 'two'], after: ['one', 'three'], kind: 'changed' },
    ],
  });
});

test('structured diff does not mutate either input', () => {
  const base = { nested: { value: 1 }, list: ['a'] };
  const proposed = { nested: { value: 2 }, list: ['b'] };
  const baseBefore = structuredClone(base);
  const proposedBefore = structuredClone(proposed);

  buildArtifactDiff(base, proposed);

  assert.deepEqual(base, baseBefore);
  assert.deepEqual(proposed, proposedBefore);
});

test('structured diff treats distinct arrays with equal values as unchanged', () => {
  const base = { tags: ['one', { nested: true }] };
  const proposed = structuredClone(base);

  assert.deepEqual(buildArtifactDiff(base, proposed), { changed: false, fields: [] });
});

function createTestNovel(id: string): void {
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

function candidateInput(novelId: string, kind: 'world' | 'character' = 'world') {
  const baseFingerprint = fingerprintCreativeArtifact({
    kind,
    version: 0,
    core: undefined,
    content: undefined,
  });
  return {
    novelId,
    target: { kind, id: `${kind}-1`, version: 0 },
    operation: 'generate' as const,
    goal: 'Create a structured world',
    baseFingerprint,
    sourceCapabilityVersions: [{ capabilityId: 'world-builder', version: '1' }],
    proposedCore: { schemaVersion: 1, hardRules: [] },
    proposedContent: 'Readable world proposal',
    impactReport: {
      downstream: [],
      reviewRequired: [{ kind: 'character' as const, id: 'character-1', version: 1 }],
      manuscriptConflict: false,
      reasons: ['world rules changed'],
    },
  };
}

function countRows(table: string): number {
  return (getDb().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function routeCandidateInput(novelId: string, kind: 'world' | 'character' = 'world') {
  const { novelId: candidateNovelId, ...input } = candidateInput(novelId, kind);
  void candidateNovelId;
  return input;
}

test('character impact report includes only active outline references and linked narrative promises', () => {
  closeDb();
  initDb(':memory:');
  try {
    createTestNovel('novel-1');
    createCharacter({ id: 'character-1', novelId: 'novel-1', name: '主角', role: 'protagonist', summary: '', traits: [], bio: '', createdAt: 1, updatedAt: 1 });
    createOutlineArtifact({
      id: 'active-outline', novelId: 'novel-1', level: 'master', scope: {}, content: '主纲',
      core: { schemaVersion: 1, nodes: [{ id: 'character-node', type: 'premise', title: '主角', intent: '建立人物目标', order: 0, characterIds: ['character-1'], foreshadowingIds: [] }] },
    });
    activateOutlineArtifact('novel-1', 'active-outline');
    createOutlineArtifact({
      id: 'unrelated-outline', novelId: 'novel-1', level: 'volume', scope: { volumeName: '卷一' }, content: '卷纲',
      core: { schemaVersion: 1, nodes: [{ id: 'other-node', parentNodeId: 'character-node', type: 'premise', title: '旁支', intent: '建立旁支', order: 0, characterIds: [], foreshadowingIds: [] }] },
    });
    activateOutlineArtifact('novel-1', 'unrelated-outline');
    createForeshadowing({ id: 'promise-1', novelId: 'novel-1', title: '秘密', description: '秘密', status: 'planted', relatedCharacterIds: ['character-1'], createdAt: 1, updatedAt: 1 });

    const report = characterImpactReport('novel-1', 'character-1');
    assert.deepEqual(report.downstream, [{ kind: 'master-outline', id: 'active-outline', version: 1 }]);
    assert.deepEqual(report.reviewRequired, [
      { kind: 'master-outline', id: 'active-outline', version: 1 },
      { kind: 'narrative-promise', id: 'promise-1', version: 1 },
    ]);
  } finally {
    closeDb();
  }
});

test('world candidates preserve preview, generation, provenance, review, and idempotency contracts', async () => {
  closeDb();
  initDb(':memory:');
  try {
    createTestNovel('novel-1');
    const candidate = await previewArtifactCandidate(candidateInput('novel-1'));

    assert.equal(getArtifactCore('novel-1', 'world', 'world-1'), undefined);
    assert.equal(countRows('creative_artifact_candidates'), 1);
    await assert.rejects(
      previewArtifactCandidate({ ...candidateInput('novel-1'), proposedCore: [] as unknown as Record<string, unknown> }),
      { code: 'ARTIFACT_CANDIDATE_INVALID_OUTPUT' },
    );
    await assert.rejects(
      previewArtifactCandidate({ ...candidateInput('novel-1'), target: { kind: 'world', id: 'world-1', version: 1 } }),
      { code: 'ARTIFACT_CANDIDATE_VERSION_STALE' },
    );
    await assert.rejects(
      acceptArtifactCandidate({
        novelId: 'novel-1',
        candidateId: candidate.id,
        databaseGeneration: getDatabaseGeneration() + 1,
      }),
      { code: 'ARTIFACT_CANDIDATE_GENERATION_STALE' },
    );

    const accepted = await acceptArtifactCandidate({
      novelId: 'novel-1',
      candidateId: candidate.id,
      databaseGeneration: getDatabaseGeneration(),
    });
    assert.equal(accepted.core.version, 1);
    assert.equal(accepted.candidate.status, 'accepted');
    assert.deepEqual(accepted.core.provenance.sourceCapabilityVersions, candidate.sourceCapabilityVersions);
    assert.equal(accepted.reviewRequirements.length, 1);
    assert.equal(accepted.reviewRequirements[0].artifactId, 'character-1');

    const repeated = await acceptArtifactCandidate({
      novelId: 'novel-1',
      candidateId: candidate.id,
      databaseGeneration: getDatabaseGeneration(),
    });
    assert.equal(repeated.core.version, 1);
    assert.equal(countRows('creative_artifact_versions'), 1);
    await assert.rejects(
      acceptArtifactCandidate({ novelId: 'other-novel', candidateId: candidate.id, databaseGeneration: getDatabaseGeneration() }),
      { code: 'ARTIFACT_CANDIDATE_NOT_FOUND' },
    );

    const rejected = await previewArtifactCandidate({
      ...candidateInput('novel-1', 'character'),
      target: { kind: 'character', id: 'character-2', version: 0 },
    });
    rejectArtifactCandidate('novel-1', rejected.id);
    await assert.rejects(
      acceptArtifactCandidate({ novelId: 'novel-1', candidateId: rejected.id, databaseGeneration: getDatabaseGeneration() }),
      { code: 'ARTIFACT_CANDIDATE_REJECTED' },
    );

    const stale = await previewArtifactCandidate({
      ...candidateInput('novel-1', 'character'),
      target: { kind: 'character', id: 'character-3', version: 0 },
    });
    saveArtifactVersion({
      novelId: 'novel-1', artifactKind: 'character', artifactId: 'character-3',
      core: { schemaVersion: 1 }, provenance: { source: 'manual' },
    });
    await assert.rejects(
      acceptArtifactCandidate({ novelId: 'novel-1', candidateId: stale.id, databaseGeneration: getDatabaseGeneration() }),
      { code: 'ARTIFACT_CANDIDATE_FINGERPRINT_STALE' },
    );
    assert.equal(getArtifactCandidate('novel-1', stale.id)?.status, 'stale');
  } finally {
    closeDb();
  }
});

test('outline and manuscript adapters keep their authoritative stores and never write chapter content', async () => {
  closeDb();
  initDb(':memory:');
  try {
    createTestNovel('novel-1');
    const outline = await previewOutlineCandidate({
      novelId: 'novel-1',
      baseFingerprint: getCanonFingerprint('novel-1'),
      operations: [{ operation: 'create-master-outline', content: 'Master outline' }],
    });
    assert.equal(outline.status, 'pending');
    assert.equal((await acceptOutlineCandidate({
      novelId: 'novel-1', patchId: outline.id, databaseGeneration: getDatabaseGeneration(),
    })).status, 'accepted');
    assert.equal(countRows('creative_artifact_candidates'), 0);

    createChapterProductionRun({
      id: 'run-1', novelId: 'novel-1', status: 'review_required', userIntent: '',
      sceneBeats: 'beats', draftContent: 'draft', styleAudit: '',
      continuityReport: { issues: [], proposedPatch: { characterUpdates: [], itemUpdates: [], foreshadowingUpdates: [], timelineEventsToCreate: [], foreshadowingsToCreate: [] } }, createdAt: 1, updatedAt: 1,
    });
    createChapterProductionRunVersion({
      id: 'version-1', runId: 'run-1', novelId: 'novel-1', source: 'fallback',
      sceneBeats: 'beats', draftContent: 'draft', styleAudit: '',
      continuityReport: { issues: [], proposedPatch: { characterUpdates: [], itemUpdates: [], foreshadowingUpdates: [], timelineEventsToCreate: [], foreshadowingsToCreate: [] } }, contentHash: 'hash', createdAt: 1,
    });
    const before = countRows('chapters');
    const manuscript = previewManuscriptCandidate({ novelId: 'novel-1', runId: 'run-1', versionId: 'version-1' });
    assert.equal(manuscript.impactReport.manuscriptConflict, true);
    assert.equal(countRows('chapters'), before);
    assert.equal(countRows('creative_artifact_candidates'), 0);
  } finally {
    closeDb();
  }
});

test('candidate routes validate bodies and enforce novel isolation, generation, and terminal state', async () => {
  closeDb();
  initDb(':memory:');
  createTestNovel('novel-1');
  createTestNovel('novel-2');
  const app = express();
  app.use(express.json());
  registerCreativeArtifactRoutes(app);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const previewInput = routeCandidateInput('novel-1');
  const body = { ...previewInput, databaseGeneration: getDatabaseGeneration() };
  try {
    const invalid = await fetch(`${base}/api/novels/novel-1/artifacts/candidates/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, extra: true }),
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, 'ARTIFACT_CANDIDATE_INVALID_INPUT');

    const stale = await fetch(`${base}/api/novels/novel-1/artifacts/candidates/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, databaseGeneration: getDatabaseGeneration() + 1 }),
    });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, 'ARTIFACT_CANDIDATE_GENERATION_STALE');

    const preview = await fetch(`${base}/api/novels/novel-1/artifacts/candidates/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(preview.status, 201);
    const candidate = await preview.json() as { id: string; status: string };
    assert.equal(candidate.status, 'pending');
    assert.equal((await fetch(`${base}/api/novels/novel-1/artifacts/candidates/${candidate.id}`)).status, 200);
    assert.equal((await fetch(`${base}/api/novels/novel-2/artifacts/candidates/${candidate.id}`)).status, 404);
    const pendingList = await fetch(`${base}/api/novels/novel-1/artifacts?kind=world&status=pending`);
    assert.equal(pendingList.status, 200);
    assert.deepEqual((await pendingList.json()).candidates.map((item: { id: string }) => item.id), [candidate.id]);

    const accept = await fetch(`${base}/api/novels/novel-1/artifacts/candidates/${candidate.id}/accept`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ databaseGeneration: getDatabaseGeneration() }),
    });
    assert.equal(accept.status, 200);
    assert.equal((await accept.json()).candidate.status, 'accepted');
    const activeList = await fetch(`${base}/api/novels/novel-1/artifacts?kind=world&status=pending`);
    const activeBody = await activeList.json() as { cores: Array<{ artifactId: string; version: number }>; candidates: unknown[] };
    assert.deepEqual(activeBody.candidates, []);
    assert.deepEqual(activeBody.cores.map((item) => ({ artifactId: item.artifactId, version: item.version })), [{ artifactId: 'world-1', version: 1 }]);

    const characterInput = routeCandidateInput('novel-1', 'character');
    const next = await fetch(`${base}/api/novels/novel-1/artifacts/candidates/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...characterInput,
        target: { kind: 'character', id: 'character-route', version: 0 },
        databaseGeneration: getDatabaseGeneration(),
      }),
    });
    const rejected = await next.json() as { id: string };
    const reject = await fetch(`${base}/api/novels/novel-1/artifacts/candidates/${rejected.id}/reject`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ databaseGeneration: getDatabaseGeneration() }),
    });
    assert.equal(reject.status, 200);
    const rejectedAccept = await fetch(`${base}/api/novels/novel-1/artifacts/candidates/${rejected.id}/accept`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ databaseGeneration: getDatabaseGeneration() }),
    });
    assert.equal(rejectedAccept.status, 409);
    assert.equal((await rejectedAccept.json()).code, 'ARTIFACT_CANDIDATE_REJECTED');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    closeDb();
  }
});
