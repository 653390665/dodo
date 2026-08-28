import assert from 'node:assert/strict';
import test from 'node:test';
import { closeDb, createNovel, initDb, subscribe } from '../server/lib/db';
import {
  createOutlineArtifact,
  getOutlineArtifact,
  listOutlineArtifacts,
  activateOutlineArtifact,
  archiveOutlineArtifact,
  OutlineError,
} from '../server/lib/db/outlines';
import { getDb } from '../server/lib/db-instance';
import { outlineMasterBaseFingerprint } from '../server/helpers/outline-fingerprint';
import type { StructuredOutlineCore } from '../shared/types/outline-governance';

function structuredCore(nodes: StructuredOutlineCore['nodes']): StructuredOutlineCore {
  return { schemaVersion: 1, nodes, promiseActions: [] };
}

function setup() {
  closeDb();
  initDb(':memory:');
  createNovel({ id: 'n1', title: 'N1', authorId: 'local', summary: '', status: 'ongoing', worldRules: ' 火\r\n水  ', createdAt: 1, updatedAt: 1 });
  createNovel({ id: 'n2', title: 'N2', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
}

function notificationCount(run: () => unknown): number {
  let count = 0;
  const unsubscribe = subscribe(() => {
    assert.equal(getDb().inTransaction, false);
    count += 1;
  });
  try { run(); } finally { unsubscribe(); }
  return count;
}

test('create validates scopes, trims volume names, and always persists candidate', () => {
  setup();
  const volume = createOutlineArtifact({ id: 'v1', novelId: 'n1', level: 'volume', scope: { volumeName: '  卷一  ' }, content: 'v', status: 'active' } as never);
  assert.deepEqual(volume.scope, { volumeName: '卷一' });
  assert.equal(volume.status, 'candidate');
  const chapter = createOutlineArtifact({ id: 'c1', novelId: 'n1', level: 'chapter', scope: { chapterStart: 2, chapterEnd: 2 }, content: 'c' });
  assert.deepEqual(chapter.scope, { chapterStart: 2, chapterEnd: 2 });
  assert.throws(() => createOutlineArtifact({ id: 'bad', novelId: 'n1', level: 'master', scope: { unknown: 1 } as never, content: 'x' }), /OUTLINE_INVALID_SCOPE/);
  assert.throws(() => createOutlineArtifact({ id: 'bad2', novelId: 'n1', level: 'volume', scope: { volumeName: 'x', chapterStart: 1 }, content: 'x' }), /OUTLINE_INVALID_SCOPE/);
  assert.throws(() => createOutlineArtifact({ id: 'bad3', novelId: 'n1', level: 'chapter', scope: { chapterStart: 2, chapterEnd: 1 }, content: 'x' }), /OUTLINE_INVALID_SCOPE/);
});

test('fingerprint locks version and normalizes equivalent text and object key order', () => {
  setup();
  const a = outlineMasterBaseFingerprint('n1', 'a\r\nb  ', { id: 'm', level: 'master', scope: { chapterEnd: 2, chapterStart: 1 }, content: 'e\u0301\r\n尾  ' });
  const b = outlineMasterBaseFingerprint('n1', 'a\nb', { id: 'm', level: 'master', scope: { chapterStart: 1, chapterEnd: 2 }, content: 'é\n尾' });
  assert.equal(a, b);
  assert.equal(outlineMasterBaseFingerprint('n1', ' 火\r\n水  ', { id: 'm1', level: 'master', scope: {}, content: '主纲' }), 'af121aee244f347c6fe6e7c0f29eca35469787538abd3f6fa3f452f52d0aa594');
  assert.notEqual(a, outlineMasterBaseFingerprint('n1', 'a\nb', { id: 'm', level: 'master', scope: { chapterStart: 1, chapterEnd: 2 }, content: 'other' }));
});

test('list filters by level and status and isolates novels', () => {
  setup();
  createOutlineArtifact({ id: 'm', novelId: 'n1', level: 'master', scope: {}, content: 'm' });
  createOutlineArtifact({ id: 'v', novelId: 'n1', level: 'volume', scope: { volumeName: 'v' }, content: 'v' });
  createOutlineArtifact({ id: 'n2m', novelId: 'n2', level: 'master', scope: {}, content: 'n2' });
  activateOutlineArtifact('n1', 'm');
  assert.deepEqual(listOutlineArtifacts('n1', { level: 'master', status: 'active' }).map((a) => a.id), ['m']);
  assert.deepEqual(listOutlineArtifacts('n1', { level: 'volume', status: 'candidate' }).map((a) => a.id), ['v']);
  assert.deepEqual(listOutlineArtifacts('n2').map((a) => a.id), ['n2m']);
  assert.equal(getOutlineArtifact('n2m', 'n1'), undefined);
});

test('get and list reject corrupted scope data with a stable error', () => {
  setup();
  createOutlineArtifact({ id: 'bad-get', novelId: 'n1', level: 'master', scope: {}, content: 'bad' });
  getDb().prepare('UPDATE outline_artifacts SET scope = ? WHERE id = ?').run('{"leak":"SECRET_BAD_SCOPE"', 'bad-get');
  assert.throws(
    () => getOutlineArtifact('bad-get', 'n1'),
    (error: unknown) =>
      error instanceof OutlineError &&
      error.code === 'OUTLINE_INVALID_DATA' &&
      error.message === 'OUTLINE_INVALID_DATA: outline scope data is invalid' &&
      !error.message.includes('SECRET_BAD_SCOPE')
  );

  createOutlineArtifact({ id: 'bad-list', novelId: 'n1', level: 'master', scope: {}, content: 'bad' });
  getDb().prepare('UPDATE outline_artifacts SET scope = ? WHERE id = ?').run('[]', 'bad-list');
  assert.throws(
    () => listOutlineArtifacts('n1'),
    (error: unknown) => error instanceof OutlineError && error.code === 'OUTLINE_INVALID_DATA' && error.message === 'OUTLINE_INVALID_DATA: outline scope data is invalid'
  );
});

test('get normalizes persisted volume scope before returning it', () => {
  setup();
  createOutlineArtifact({ id: 'volume-normalize', novelId: 'n1', level: 'volume', scope: { volumeName: '卷一' }, content: 'v' });
  getDb().prepare('UPDATE outline_artifacts SET scope = ? WHERE id = ?').run('{"volumeName":"  卷一  "}', 'volume-normalize');
  assert.deepEqual(getOutlineArtifact('volume-normalize', 'n1')?.scope, { volumeName: '卷一' });
});

test('master activation mirrors global outline, demotes only stale base fingerprints, and is idempotent', () => {
  setup();
  createOutlineArtifact({ id: 'm1', novelId: 'n1', level: 'master', scope: {}, content: '一' });
  createOutlineArtifact({ id: 'm2', novelId: 'n1', level: 'master', scope: {}, content: '二' });
  createOutlineArtifact({ id: 'vkeep', novelId: 'n1', level: 'volume', scope: { volumeName: 'keep' }, content: 'k' });
  createOutlineArtifact({ id: 'vstale', novelId: 'n1', level: 'volume', scope: { volumeName: 'stale' }, content: 's' });
  activateOutlineArtifact('n1', 'm1');
  const fp = outlineMasterBaseFingerprint('n1', ' 火\r\n水  ', { id: 'm2', level: 'master', scope: {}, content: '二' });
  getDb().prepare('UPDATE outline_artifacts SET status = \'active\', base_fingerprint = ? WHERE id = ?').run(fp, 'vkeep');
  getDb().prepare('UPDATE outline_artifacts SET status = \'active\', base_fingerprint = ? WHERE id = ?').run('old', 'vstale');
  const notifications = notificationCount(() => {
    const result = activateOutlineArtifact('n1', 'm2');
    assert.deepEqual(result.archivedIds, ['m1']);
    assert.deepEqual(result.demotedIds, ['vstale']);
  });
  assert.equal(notifications, 1);
  assert.equal((getDb().prepare('SELECT global_outline FROM novels WHERE id = ?').get('n1') as { global_outline: string }).global_outline, '二');
  assert.equal(getOutlineArtifact('vkeep', 'n1')?.status, 'active');
  assert.equal(getOutlineArtifact('vstale', 'n1')?.status, 'candidate');
  assert.equal(notificationCount(() => assert.deepEqual(activateOutlineArtifact('n1', 'm2'), { archivedIds: [], demotedIds: [] })), 0);
});

test('scoped activation requires master, archives same scope only, and records current fingerprint', () => {
  setup();
  createOutlineArtifact({ id: 'v0', novelId: 'n1', level: 'volume', scope: { volumeName: 'v' }, content: 'v' });
  assert.throws(() => activateOutlineArtifact('n1', 'v0'), /OUTLINE_MASTER_REQUIRED/);
  createOutlineArtifact({ id: 'm', novelId: 'n1', level: 'master', scope: {}, content: 'm' });
  activateOutlineArtifact('n1', 'm');
  createOutlineArtifact({ id: 'v1', novelId: 'n1', level: 'volume', scope: { volumeName: 'v' }, content: 'v1' });
  createOutlineArtifact({ id: 'v2', novelId: 'n1', level: 'volume', scope: { volumeName: 'v' }, content: 'v2' });
  createOutlineArtifact({ id: 'vOther', novelId: 'n1', level: 'volume', scope: { volumeName: 'other' }, content: 'o' });
  const result = activateOutlineArtifact('n1', 'v1');
  assert.deepEqual(result.archivedIds, []);
  activateOutlineArtifact('n1', 'v2');
  assert.equal(getOutlineArtifact('v1', 'n1')?.status, 'archived');
  assert.equal(getOutlineArtifact('vOther', 'n1')?.status, 'candidate');
  assert.equal(getOutlineArtifact('v2', 'n1')?.baseFingerprint, outlineMasterBaseFingerprint('n1', ' 火\r\n水  ', { id: 'm', level: 'master', scope: {}, content: 'm' }));
});

test('archive clears active master global outline and is idempotent with notifications', () => {
  setup();
  createOutlineArtifact({ id: 'm', novelId: 'n1', level: 'master', scope: {}, content: 'm' });
  activateOutlineArtifact('n1', 'm');
  assert.equal(notificationCount(() => assert.deepEqual(archiveOutlineArtifact('n1', 'm'), { archived: true })), 1);
  assert.equal((getDb().prepare('SELECT global_outline FROM novels WHERE id = ?').get('n1') as { global_outline: string }).global_outline, '');
  assert.equal(notificationCount(() => assert.deepEqual(archiveOutlineArtifact('n1', 'm'), { archived: false })), 0);
});

test('structured activation validates scope overlap, hierarchy prerequisites, and marks linked stale refs', () => {
  setup();
  const masterCore = structuredCore([{
    id: 'master-node', type: 'premise', title: '起点', intent: '建立', order: 0, characterIds: [], foreshadowingIds: [],
  }]);
  createOutlineArtifact({ id: 'm1', novelId: 'n1', level: 'master', scope: {}, content: 'M1', core: masterCore });
  activateOutlineArtifact('n1', 'm1');
  createOutlineArtifact({
    id: 'v1', novelId: 'n1', level: 'volume', scope: { volumeName: '卷一' }, content: 'V1',
    core: structuredCore([{
      id: 'volume-node', parentNodeId: 'master-node', type: 'turn', title: '转折', intent: '推进', order: 0, characterIds: [], foreshadowingIds: [],
    }]),
  });
  activateOutlineArtifact('n1', 'v1');
  createOutlineArtifact({ id: 'c1', novelId: 'n1', level: 'chapter', scope: { chapterStart: 1, chapterEnd: 3 }, content: 'C1' });
  activateOutlineArtifact('n1', 'c1');
  createOutlineArtifact({ id: 'c2', novelId: 'n1', level: 'chapter', scope: { chapterStart: 3, chapterEnd: 4 }, content: 'C2' });
  assert.throws(() => activateOutlineArtifact('n1', 'c2'), (error: unknown) => (error as { code?: string }).code === 'OUTLINE_SCOPE_OVERLAP');

  createOutlineArtifact({
    id: 'm2', novelId: 'n1', level: 'master', scope: {}, content: 'M2',
    core: structuredCore([{
      id: 'replacement-node', type: 'premise', title: '替换', intent: '建立', order: 0, characterIds: [], foreshadowingIds: [],
    }]),
  });
  const targetFingerprint = outlineMasterBaseFingerprint('n1', ' 火\r\n水  ', {
    id: 'm2', level: 'master', scope: {}, content: 'M2', core: getOutlineArtifact('m2', 'n1')?.core,
  });
  getDb().prepare("UPDATE outline_artifacts SET base_fingerprint = ? WHERE id = 'v1'").run(targetFingerprint);
  activateOutlineArtifact('n1', 'm2');

  assert.equal(getOutlineArtifact('v1', 'n1')?.status, 'active');
  assert.deepEqual(getDb().prepare(`
    SELECT artifact_kind, artifact_id, artifact_version, status
    FROM artifact_review_requirements
    WHERE novel_id = ? AND artifact_id = ?
  `).all('n1', 'v1'), [{ artifact_kind: 'volume-outline', artifact_id: 'v1', artifact_version: 1, status: 'review-required' }]);
});

test('structured chapters require an active volume and mirror divergence is diagnosed', () => {
  setup();
  createOutlineArtifact({
    id: 'm', novelId: 'n1', level: 'master', scope: {}, content: 'M',
    core: structuredCore([{
      id: 'master-node', type: 'premise', title: '起点', intent: '建立', order: 0, characterIds: [], foreshadowingIds: [],
    }]),
  });
  activateOutlineArtifact('n1', 'm');
  createOutlineArtifact({
    id: 'chapter', novelId: 'n1', level: 'chapter', scope: { chapterStart: 1, chapterEnd: 1 }, content: 'C',
    core: structuredCore([{
      id: 'chapter-node', parentNodeId: 'volume-node', type: 'turn', title: '转折', intent: '推进', order: 0, characterIds: [], foreshadowingIds: [],
    }]),
  });
  assert.throws(() => activateOutlineArtifact('n1', 'chapter'), (error: unknown) => (error as { code?: string }).code === 'OUTLINE_VOLUME_REQUIRED');

  getDb().prepare("UPDATE novels SET global_outline = 'diverged' WHERE id = 'n1'").run();
  assert.throws(() => activateOutlineArtifact('n1', 'm'), (error: unknown) => (error as { code?: string }).code === 'OUTLINE_MIRROR_DIVERGED');
});

test('missing novel takes precedence over missing promise validation', () => {
  closeDb();
  initDb(':memory:');
  try {
    assert.throws(
      () => createOutlineArtifact({
        id: 'missing-novel-outline', novelId: 'missing-novel', level: 'master', scope: {}, content: 'M',
        core: {
          schemaVersion: 1,
          nodes: [{ id: 'node', type: 'premise', title: '起点', intent: '建立', order: 0, characterIds: [], foreshadowingIds: ['missing-promise'] }],
          promiseActions: [],
        },
      }),
      (error: unknown) => error instanceof OutlineError && error.code === 'OUTLINE_NOVEL_NOT_FOUND',
    );
  } finally {
    closeDb();
  }
});

test('existing novel rejects structured outlines that reference a missing promise', () => {
  closeDb();
  initDb(':memory:');
  createNovel({ id: 'n1', title: 'N1', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  try {
    assert.throws(
      () => createOutlineArtifact({
        id: 'invalid-promise-outline', novelId: 'n1', level: 'master', scope: {}, content: 'M',
        core: {
          schemaVersion: 1,
          nodes: [{ id: 'node', type: 'premise', title: '起点', intent: '建立', order: 0, characterIds: [], foreshadowingIds: ['missing-promise'] }],
          promiseActions: [],
        },
      }),
      (error: unknown) => error instanceof OutlineError && error.code === 'OUTLINE_INVALID_INPUT',
    );
  } finally {
    closeDb();
  }
});
