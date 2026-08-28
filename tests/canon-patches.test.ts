import assert from 'node:assert/strict';
import test from 'node:test';
import { closeDb, createCanonPatch, createNovel, getCanonFingerprint, getCanonPatch, getOutlineArtifact, initDb, acceptCanonPatch, rejectCanonPatch } from '../server/lib/db';
import { getDb, getDatabaseGeneration, subscribe } from '../server/lib/db-instance';
import { outlineMasterBaseFingerprint } from '../server/helpers/outline-fingerprint';
import { createOutlineArtifact, activateOutlineArtifact } from '../server/lib/db/outlines';

function setup(id = 'n1') { closeDb(); initDb(':memory:'); createNovel({ id, title: id, authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 }); }
function master(id = 'm') { const a = createOutlineArtifact({ id, novelId: 'n1', level: 'master', scope: {}, content: 'M' }); activateOutlineArtifact('n1', id); return a; }

test('canon patch accepts master, scoped and replace operations atomically', async () => {
  setup(); const base = getCanonFingerprint('n1');
  const p = createCanonPatch({ id: 'p1', novelId: 'n1', baseFingerprint: base, operations: [{ operation: 'create-master-outline', content: 'M' }, { operation: 'create-scoped-outline', level: 'volume', scope: { volumeName: 'V' }, content: 'V' }] });
  assert.equal(p.status, 'pending'); assert.equal((await acceptCanonPatch('n1', 'p1')).status, 'accepted');
  const active = getDb().prepare("SELECT id FROM outline_artifacts WHERE novel_id='n1' AND status='active'").all(); assert.equal(active.length, 2);
  const replacement = createCanonPatch({ id: 'p2', novelId: 'n1', baseFingerprint: getCanonFingerprint('n1'), operations: [{ operation: 'replace-outline', targetArtifactId: 'p1-master', content: 'M2' }] });
  assert.equal((await acceptCanonPatch('n1', replacement.id)).status, 'accepted');
  assert.equal((getDb().prepare("SELECT global_outline FROM novels WHERE id='n1'").get() as { global_outline: string }).global_outline, 'M2');
  assert.equal((getDb().prepare("SELECT status FROM outline_artifacts WHERE id='p1-volume-1'").get() as { status: string }).status, 'candidate');
  assert.equal((getDb().prepare("SELECT status FROM outline_artifacts WHERE id='p2-p1-master'").get() as { status: string }).status, 'active');
});

test('accept is notification and artifact idempotent, scoped base is master base, and ownership is enforced', async () => {
  setup(); master('m1'); createNovel({ id: 'n2', title: 'n2', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  const masterRow = getDb().prepare("SELECT id, level, scope, content FROM outline_artifacts WHERE id='m1'").get() as { id: string; level: 'master'; scope: string; content: string };
  const expected = outlineMasterBaseFingerprint('n1', '', { ...masterRow, scope: JSON.parse(masterRow.scope) });
  let notifications = 0; const off = subscribe(() => { notifications++; });
  const p = createCanonPatch({ id: 'scope-fp', novelId: 'n1', baseFingerprint: getCanonFingerprint('n1'), operations: [{ operation: 'create-scoped-outline', level: 'volume', scope: { volumeName: ' V ' }, content: 'V' }] });
  const first = await acceptCanonPatch('n1', p.id); const countAfter = notifications; const second = await acceptCanonPatch('n1', p.id); off();
  assert.deepEqual(second, first); assert.equal(notifications, countAfter); assert.equal((getDb().prepare("SELECT base_fingerprint FROM outline_artifacts WHERE id='scope-fp-volume-0'").get() as { base_fingerprint: string }).base_fingerprint, expected);
  const cross = createCanonPatch({ id: 'cross', novelId: 'n2', baseFingerprint: getCanonFingerprint('n2'), operations: [{ operation: 'replace-outline', targetArtifactId: 'm1', content: 'bad' }] });
  await assert.rejects(() => acceptCanonPatch('n2', cross.id, getDatabaseGeneration()), /CANON_PATCH_CONFLICT/); assert.equal((getDb().prepare("SELECT content FROM outline_artifacts WHERE id='m1'").get() as { content: string }).content, 'M');
});

test('stale persists, reject is terminal/idempotent, and failed operation rolls back', async () => {
  setup(); master(); const stale = createCanonPatch({ id: 'stale', novelId: 'n1', baseFingerprint: 'wrong', operations: [{ operation: 'create-scoped-outline', level: 'volume', scope: { volumeName: 'V' }, content: 'V' }] });
  assert.equal((await acceptCanonPatch('n1', stale.id)).status, 'stale'); assert.equal(getCanonPatch('stale', 'n1')?.status, 'stale');
  const p = createCanonPatch({ id: 'bad', novelId: 'n1', baseFingerprint: getCanonFingerprint('n1'), operations: [{ operation: 'create-scoped-outline', level: 'volume', scope: { volumeName: 'V' }, content: 'V' }, { operation: 'replace-outline', targetArtifactId: 'missing', content: 'x' }] });
  await assert.rejects(() => acceptCanonPatch('n1', p.id)); assert.equal(getCanonPatch('bad', 'n1')?.status, 'pending'); assert.equal((getDb().prepare("SELECT COUNT(*) AS n FROM outline_artifacts WHERE novel_id='n1' AND status='active' AND level='volume'").get() as { n: number }).n, 0);
  const r = createCanonPatch({ id: 'reject', novelId: 'n1', baseFingerprint: getCanonFingerprint('n1'), operations: [{ operation: 'create-master-outline', content: 'x' }] }); assert.equal(rejectCanonPatch('n1', r.id).status, 'rejected'); assert.equal(rejectCanonPatch('n1', r.id).status, 'rejected'); await assert.rejects(() => acceptCanonPatch('n1', r.id));
});

test('schema includes canon result columns and generation mismatch does not write', async () => {
  setup(); const columns = getDb().prepare('PRAGMA table_info(canon_patches)').all() as Array<{ name: string }>; assert.deepEqual(columns.map((c) => c.name).filter((n) => n.startsWith('result') || n === 'decided_at').sort(), ['decided_at', 'result_fingerprint', 'result_json']);
  const p = createCanonPatch({ id: 'gen', novelId: 'n1', baseFingerprint: getCanonFingerprint('n1'), operations: [{ operation: 'create-master-outline', content: 'x' }] }); await assert.rejects(() => acceptCanonPatch('n1', p.id, getDatabaseGeneration() - 1)); assert.equal(getCanonPatch('gen', 'n1')?.status, 'pending');
});

test('capability canon acceptance persists frozen outline provenance and returns versioned refs', async () => {
  setup();
  const patch = createCanonPatch({
    id: 'capability-patch', novelId: 'n1', baseFingerprint: getCanonFingerprint('n1'),
    sourceCapabilityVersions: [{ capabilityId: 'opening-gold-three', version: '3' }],
    operations: [{
      operation: 'create-master-outline', content: 'M', core: {
        schemaVersion: 1,
        nodes: [{ id: 'master-node', type: 'premise', title: '起点', intent: '建立', order: 0, characterIds: [], foreshadowingIds: [] }],
        promiseActions: [],
      },
    }],
  });

  const accepted = await acceptCanonPatch('n1', patch.id);
  assert.deepEqual(accepted.acceptedOutlineRefs, [{ kind: 'master-outline', id: 'capability-patch-master', version: 1 }]);
  assert.deepEqual(getCanonPatch(patch.id, 'n1')?.sourceCapabilityVersions, [{ capabilityId: 'opening-gold-three', version: '3' }]);
  assert.deepEqual(getOutlineArtifact('capability-patch-master', 'n1')?.sourceCapabilityVersions, [{ capabilityId: 'opening-gold-three', version: '3' }]);
  assert.equal(getOutlineArtifact('capability-patch-master', 'n1')?.version, 1);
});
