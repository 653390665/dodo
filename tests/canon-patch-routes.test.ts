import assert from 'node:assert/strict'; import test from 'node:test'; import express from 'express';
import { closeDb, createNovel, initDb, getCanonFingerprint, getCanonPatch, listCanonPatches } from '../server/lib/db'; import { getDatabaseGeneration } from '../server/lib/db-instance'; import { registerCanonPatchRoutes } from '../server/routes/canon-patches';
test('canon patch routes expose stable 404/409 codes', async () => { closeDb(); initDb(':memory:'); createNovel({ id: 'n1', title: 'n1', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 }); const app = express(); app.use(express.json()); registerCanonPatchRoutes(app); const server = app.listen(0); await new Promise<void>((r) => server.once('listening', r)); const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; try { const missing = await fetch(`${base}/api/novels/no/canon-patches`); assert.equal(missing.status, 404); assert.equal((await missing.json()).code, 'CANON_PATCH_NOVEL_NOT_FOUND'); const invalid = await fetch(`${base}/api/novels/n1/canon-patches`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseFingerprint: 'x', operations: [], databaseGeneration: 0 }) }); assert.equal(invalid.status, 400); const forged = await fetch(`${base}/api/novels/n1/canon-patches`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseFingerprint: 'x', sourceAbilityId: 'forged', operations: [{ operation: 'create-master-outline', content: 'x' }], databaseGeneration: 0 }) }); assert.equal(forged.status, 400); assert.equal((await forged.json()).code, 'CANON_PATCH_INVALID_INPUT'); assert.equal(listCanonPatches('n1').length, 0); const staleCreate = await fetch(`${base}/api/novels/n1/canon-patches`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseFingerprint: 'wrong', operations: [{ operation: 'create-master-outline', content: 'x' }], databaseGeneration: 0 }) }); const stalePatch = await staleCreate.json(); const stale = await fetch(`${base}/api/novels/n1/canon-patches/${stalePatch.id}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: 0 }) }); assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'CANON_PATCH_STALE'); assert.equal(getCanonPatch(stalePatch.id, 'n1')?.status, 'stale'); const create = await fetch(`${base}/api/novels/n1/canon-patches`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseFingerprint: getCanonFingerprint('n1'), operations: [{ operation: 'create-master-outline', content: 'x' }], databaseGeneration: 0 }) }); const patch = await create.json(); await fetch(`${base}/api/novels/n1/canon-patches/${patch.id}/reject`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: 0 }) }); const terminal = await fetch(`${base}/api/novels/n1/canon-patches/${patch.id}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: 0 }) }); assert.equal(terminal.status, 409); assert.equal((await terminal.json()).code, 'CANON_PATCH_TERMINAL'); const absent = await fetch(`${base}/api/novels/n1/canon-patches/missing/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: 0 }) }); assert.equal(absent.status, 404); } finally { await new Promise<void>((r, j) => server.close((e) => e ? j(e) : r())); closeDb(); } });

test('stale canon generation rejects create and reject without writing', async () => { closeDb(); initDb(':memory:'); createNovel({ id: 'n1', title: 'n1', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 }); const app = express(); app.use(express.json()); registerCanonPatchRoutes(app); const server = app.listen(0); await new Promise<void>((r) => server.once('listening', r)); const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; try { const staleGeneration = getDatabaseGeneration() + 1; const create = await fetch(`${base}/api/novels/n1/canon-patches`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseFingerprint: getCanonFingerprint('n1'), operations: [{ operation: 'create-master-outline', content: 'stale' }], databaseGeneration: staleGeneration }) }); assert.equal(create.status, 409); assert.equal((await create.json()).code, 'CANON_PATCH_GENERATION_STALE'); assert.equal(listCanonPatches('n1').length, 0); const valid = await fetch(`${base}/api/novels/n1/canon-patches`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseFingerprint: getCanonFingerprint('n1'), operations: [{ operation: 'create-master-outline', content: 'pending' }], databaseGeneration: getDatabaseGeneration() }) }); const patch = await valid.json(); const reject = await fetch(`${base}/api/novels/n1/canon-patches/${patch.id}/reject`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: staleGeneration }) }); assert.equal(reject.status, 409); assert.equal((await reject.json()).code, 'CANON_PATCH_GENERATION_STALE'); assert.equal(getCanonPatch(patch.id, 'n1')?.status, 'pending'); } finally { await new Promise<void>((r, j) => server.close((e) => e ? j(e) : r())); closeDb(); } });

test('canon patch route accepts frozen capability provenance and returns accepted outline refs', async () => {
  closeDb();
  initDb(':memory:');
  createNovel({ id: 'n1', title: 'n1', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  const app = express();
  app.use(express.json());
  registerCanonPatchRoutes(app);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const create = await fetch(`${base}/api/novels/n1/canon-patches`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseFingerprint: getCanonFingerprint('n1'),
        sourceCapabilityVersions: [{ capabilityId: 'opening-gold-three', version: '3' }],
        operations: [{
          operation: 'create-master-outline', content: 'master', core: {
            schemaVersion: 1,
            nodes: [{ id: 'master-node', type: 'premise', title: '起点', intent: '建立', order: 0, characterIds: [], foreshadowingIds: [] }],
            promiseActions: [],
          },
        }],
        databaseGeneration: getDatabaseGeneration(),
      }),
    });
    assert.equal(create.status, 201);
    const patch = await create.json() as { id: string; sourceCapabilityVersions: Array<{ capabilityId: string; version: string }> };
    assert.deepEqual(patch.sourceCapabilityVersions, [{ capabilityId: 'opening-gold-three', version: '3' }]);
    const accept = await fetch(`${base}/api/novels/n1/canon-patches/${patch.id}/accept`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ databaseGeneration: getDatabaseGeneration() }),
    });
    assert.equal(accept.status, 200);
    assert.deepEqual((await accept.json()).acceptedOutlineRefs, [{ kind: 'master-outline', id: `${patch.id}-master`, version: 1 }]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    closeDb();
  }
});
