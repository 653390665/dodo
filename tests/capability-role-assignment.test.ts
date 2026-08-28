import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { closeDb, createNovel, getNovel, initDb } from '../server/lib/db.js';
import { registerDbRoutes } from '../server/routes/db.js';

const app = express();
app.use(express.json());
registerDbRoutes(app);
const server = app.listen(0);
await new Promise<void>((resolve) => server.once('listening', resolve));
const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

async function update(novelId: string, mountedSkillLoadout: unknown[]) {
  return fetch(`${baseUrl}/api/db`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'updateNovel', args: [novelId, { mountedSkillLoadout }] }),
  });
}

test.before(() => {
  closeDb();
  initDb(':memory:');
  createNovel({ id: 'role-assignment', title: 'Role assignment', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
});

test.after(() => {
  closeDb();
  server.close();
});

test('legacy role loadout remains readable, while reclassified catalog assets are not role skills', async () => {
  const response = await update('role-assignment', [
    { slot: 0, skillId: 'legacy-planner-skill', weight: 1, lockedDimensions: [] },
    { slot: 1, skillId: 'legacy-writer-skill', weight: 1, lockedDimensions: [] },
    { slot: 2, skillId: 'legacy-critic-skill', weight: 1, lockedDimensions: [] },
  ]);
  assert.equal(response.status, 200);
  assert.equal(getNovel('role-assignment')?.mountedSkillLoadout?.length, 3);
});

test('reclassified technique is rejected from legacy role slots without changing DB', async () => {
  const before = getNovel('role-assignment')?.mountedSkillLoadout;
  const response = await update('role-assignment', [
    { slot: 0, skillId: 'prose-mouth-flavor', weight: 1, lockedDimensions: [] },
  ]);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, 'CAPABILITY_ROLE_KIND_UNSUPPORTED');
  assert.equal(body.error, '该能力卡不能放入旧职责位');
  assert.deepEqual(getNovel('role-assignment')?.mountedSkillLoadout, before);
});

test('unknown historical skill IDs remain assignable', async () => {
  const response = await update('role-assignment', [
    { slot: 0, skillId: 'legacy-manual-skill', weight: 1, lockedDimensions: [] },
  ]);
  assert.equal(response.status, 200);
});

test('unknown skills with an invalid slot are rejected without changing DB', async () => {
  const before = getNovel('role-assignment')?.mountedSkillLoadout;
  const response = await update('role-assignment', [
    { slot: 9, skillId: 'legacy-manual-skill', weight: 1, lockedDimensions: [] },
  ]);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, 'CAPABILITY_ROLE_SLOT_INVALID');
  assert.equal(body.error, '能力卡职责位无效');
  assert.deepEqual(getNovel('role-assignment')?.mountedSkillLoadout, before);
});
