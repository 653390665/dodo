import assert from 'node:assert/strict';
import test from 'node:test';
import type { ArtifactCandidate, CreativeArtifactKind } from '../shared/types.js';
import {
  applyArtifactCandidateDecision,
  closeDb,
  createArtifactCandidate,
  createNovel,
  getArtifactCandidate,
  getArtifactCore,
  initDb,
  listArtifactCandidates,
  markArtifactReviewRequired,
  saveArtifactVersion,
} from '../server/lib/db.js';
import { getDb } from '../server/lib/db-instance.js';

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

function candidateInput(
  id: string,
  novelId: string,
  kind: CreativeArtifactKind = 'world',
): Omit<ArtifactCandidate<Record<string, unknown>>, 'status'> {
  return {
    id,
    novelId,
    target: { kind, id: `${kind}-1`, version: 0 },
    operation: 'generate',
    goal: 'Build governed core',
    baseFingerprint: 'fingerprint-1',
    sourceCapabilityVersions: [{ capabilityId: 'world-builder', version: '1' }],
    proposedCore: { schemaVersion: 1 },
    proposedContent: 'Readable proposal',
    diff: {
      changed: true,
      fields: [{ path: 'schemaVersion', before: 0, after: 1, kind: 'changed' }],
    },
    impactReport: {
      downstream: [{ kind: 'character', id: 'character-1', version: 1 }],
      reviewRequired: [],
      manuscriptConflict: false,
      reasons: ['world changed'],
    },
  };
}

function assertCode(code: string): (error: unknown) => boolean {
  return (error) => {
    assert.equal((error as { code?: string }).code, code);
    return true;
  };
}

function rowCount(table: string): number {
  return (getDb().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

test.beforeEach(() => {
  closeDb();
  initDb(':memory:');
});

test.after(() => closeDb());

test('saveArtifactVersion creates current core and immutable versions transactionally', () => {
  createTestNovel('novel-1');

  const first = saveArtifactVersion({
    novelId: 'novel-1',
    artifactKind: 'world',
    artifactId: 'world-1',
    core: { schemaVersion: 1, hardRules: [] },
    readableContent: 'World v1',
    provenance: { source: 'manual' },
  });
  assert.equal(first.version, 1);
  assert.deepEqual(getArtifactCore('novel-1', 'world', 'world-1'), first);

  const second = saveArtifactVersion({
    novelId: 'novel-1',
    artifactKind: 'world',
    artifactId: 'world-1',
    expectedVersion: 1,
    core: { schemaVersion: 1, hardRules: [{ id: 'rule-1', statement: 'No flight' }] },
    readableContent: 'World v2',
    provenance: { source: 'manual', revision: 2 },
  });
  assert.equal(second.id, first.id);
  assert.equal(second.version, 2);
  assert.deepEqual(
    getDb().prepare('SELECT version, readable_content FROM creative_artifact_versions ORDER BY version').all(),
    [
      { version: 1, readable_content: 'World v1' },
      { version: 2, readable_content: 'World v2' },
    ],
  );
});

test('stale or omitted expected version rolls back without writing', () => {
  createTestNovel('novel-1');
  saveArtifactVersion({
    novelId: 'novel-1', artifactKind: 'character', artifactId: 'character-1',
    core: { schemaVersion: 1 }, provenance: { source: 'manual' },
  });

  for (const expectedVersion of [undefined, 0, 2]) {
    assert.throws(
      () => saveArtifactVersion({
        novelId: 'novel-1', artifactKind: 'character', artifactId: 'character-1',
        ...(expectedVersion === undefined ? {} : { expectedVersion }),
        core: { schemaVersion: 2 }, provenance: { source: 'manual' },
      }),
      assertCode('CREATIVE_ARTIFACT_VERSION_STALE'),
    );
  }
  assert.equal(getArtifactCore('novel-1', 'character', 'character-1')?.version, 1);
  assert.equal(rowCount('creative_artifact_versions'), 1);
});

test('writes reject missing novels and invalid input without rows', () => {
  assert.throws(
    () => saveArtifactVersion({
      novelId: 'missing', artifactKind: 'world', artifactId: 'world-1',
      core: {}, provenance: {},
    }),
    assertCode('CREATIVE_ARTIFACT_NOVEL_NOT_FOUND'),
  );
  assert.equal(rowCount('creative_artifact_cores'), 0);
});

test('candidate creation accepts world and character only', () => {
  createTestNovel('novel-1');
  for (const kind of ['world', 'character'] as const) {
    const candidate = createArtifactCandidate(candidateInput(`candidate-${kind}`, 'novel-1', kind));
    assert.equal(candidate.target.kind, kind);
    assert.equal(candidate.status, 'pending');
  }

  for (const kind of ['master-outline', 'volume-outline', 'chapter-outline', 'scene-beats'] as const) {
    assert.throws(
      () => createArtifactCandidate(candidateInput(`candidate-${kind}`, 'novel-1', kind)),
      assertCode('CREATIVE_ARTIFACT_INVALID_KIND'),
    );
  }
  assert.equal(rowCount('creative_artifact_candidates'), 2);
});

test('candidate decision permits one terminal transition and is idempotent for the same decision', () => {
  createTestNovel('novel-1');
  for (const decision of ['accepted', 'rejected', 'stale'] as const) {
    const id = `candidate-${decision}`;
    createArtifactCandidate(candidateInput(id, 'novel-1'));
    assert.equal(applyArtifactCandidateDecision('novel-1', id, decision).status, decision);
    assert.equal(applyArtifactCandidateDecision('novel-1', id, decision).status, decision);
    const other = decision === 'accepted' ? 'rejected' : 'accepted';
    assert.throws(
      () => applyArtifactCandidateDecision('novel-1', id, other),
      assertCode('CREATIVE_ARTIFACT_CANDIDATE_TERMINAL'),
    );
  }
  assert.throws(
    () => applyArtifactCandidateDecision('novel-1', 'missing', 'accepted'),
    assertCode('CREATIVE_ARTIFACT_CANDIDATE_NOT_FOUND'),
  );
});

test('candidate get and list isolate novels and apply filters', () => {
  createTestNovel('novel-1');
  createTestNovel('novel-2');
  createArtifactCandidate(candidateInput('candidate-world', 'novel-1', 'world'));
  createArtifactCandidate(candidateInput('candidate-character', 'novel-1', 'character'));
  createArtifactCandidate(candidateInput('candidate-other', 'novel-2', 'world'));
  applyArtifactCandidateDecision('novel-1', 'candidate-character', 'rejected');

  assert.equal(getArtifactCandidate('novel-2', 'candidate-world'), undefined);
  assert.deepEqual(listArtifactCandidates('novel-1').map(({ id }) => id).sort(), ['candidate-character', 'candidate-world']);
  assert.deepEqual(
    listArtifactCandidates('novel-1', { artifactKind: 'character', status: 'rejected' }).map(({ id }) => id),
    ['candidate-character'],
  );
});

test('review requirement validates source candidate ownership', () => {
  createTestNovel('novel-1');
  createTestNovel('novel-2');
  createArtifactCandidate(candidateInput('candidate-1', 'novel-1'));

  const requirement = markArtifactReviewRequired({
    novelId: 'novel-1',
    artifact: { kind: 'character', id: 'character-1', version: 1 },
    sourceCandidateId: 'candidate-1',
    reason: 'World dependency changed',
  });
  assert.equal(requirement.status, 'review-required');
  assert.equal(requirement.sourceCandidateId, 'candidate-1');

  for (const sourceCandidateId of ['missing', 'candidate-1']) {
    assert.throws(
      () => markArtifactReviewRequired({
        novelId: 'novel-2',
        artifact: { kind: 'character', id: 'character-2', version: 1 },
        sourceCandidateId,
        reason: 'Invalid source',
      }),
      assertCode('CREATIVE_ARTIFACT_SOURCE_CANDIDATE_NOT_FOUND'),
    );
  }
  assert.equal(rowCount('artifact_review_requirements'), 1);
});

test('corrupt core JSON never falls back to accepted defaults', () => {
  createTestNovel('novel-1');
  saveArtifactVersion({
    novelId: 'novel-1', artifactKind: 'world', artifactId: 'world-1',
    core: { schemaVersion: 1 }, provenance: { source: 'manual' },
  });
  const database = getDb();

  for (const column of ['core_json', 'provenance_json'] as const) {
    database.prepare(`UPDATE creative_artifact_cores SET ${column} = ?`).run('not-json');
    assert.throws(
      () => getArtifactCore('novel-1', 'world', 'world-1'),
      assertCode('CREATIVE_ARTIFACT_INVALID_DATA'),
    );
    database.prepare(`UPDATE creative_artifact_cores SET ${column} = ?`).run('{}');
  }
});

test('corrupt candidate JSON never falls back to accepted defaults', () => {
  createTestNovel('novel-1');
  createArtifactCandidate(candidateInput('candidate-1', 'novel-1'));
  const database = getDb();
  const original = database.prepare('SELECT * FROM creative_artifact_candidates WHERE id = ?').get('candidate-1') as Record<string, string>;

  for (const column of ['source_capability_versions', 'proposed_core', 'diff', 'impact_report'] as const) {
    database.prepare(`UPDATE creative_artifact_candidates SET ${column} = ? WHERE id = ?`).run('not-json', 'candidate-1');
    assert.throws(
      () => getArtifactCandidate('novel-1', 'candidate-1'),
      assertCode('CREATIVE_ARTIFACT_INVALID_DATA'),
    );
    database.prepare(`UPDATE creative_artifact_candidates SET ${column} = ? WHERE id = ?`).run(original[column], 'candidate-1');
  }
});
