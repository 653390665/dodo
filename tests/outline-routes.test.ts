import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { closeDb, createNovel, initDb } from '../server/lib/db';
import { registerOutlineRoutes } from '../server/routes/outlines';
import { getDatabaseGeneration, getDb } from '../server/lib/db-instance';

function seed(...novelIds: string[]) {
  closeDb();
  initDb(':memory:');
  for (const id of novelIds)
    createNovel({ id, title: id, authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
}

async function start() {
  const app = express();
  app.use(express.json());
  registerOutlineRoutes(app);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

async function stop(server: import('node:http').Server) {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  closeDb();
}

test('outline routes complete create/list/detail/activate/archive journey with validation and isolation', async () => {
  seed('n1', 'n2');
  const { server, base } = await start();
  try {
    const create = await fetch(`${base}/api/novels/n1/outlines`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 'master', scope: {}, content: 'master', databaseGeneration: 0 }) });
    assert.equal(create.status, 201);
    const master = await create.json();
    const createVolume = await fetch(`${base}/api/novels/n1/outlines`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 'volume', scope: { volumeName: 'V' }, content: 'volume', databaseGeneration: 0 }) });
    assert.equal(createVolume.status, 201);
    const volume = await createVolume.json();
    const list = await fetch(`${base}/api/novels/n1/outlines?level=volume&status=candidate`);
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json()).map((a: { id: string }) => a.id), [volume.id]);
    assert.equal((await fetch(`${base}/api/novels/n1/outlines/${master.id}`)).status, 200);
    const crossNovel = await fetch(`${base}/api/novels/n2/outlines/${master.id}`);
    assert.equal(crossNovel.status, 404);
    const invalidBody = await fetch(`${base}/api/novels/n1/outlines`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 'master', scope: {}, content: '', extra: true }) });
    assert.equal(invalidBody.status, 400);
    const invalidQuery = await fetch(`${base}/api/novels/n1/outlines?status=wat`);
    assert.equal(invalidQuery.status, 400);
    const n2VolumeResponse = await fetch(`${base}/api/novels/n2/outlines`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 'volume', scope: { volumeName: 'V2' }, content: 'v2', databaseGeneration: 0 }) });
    const n2Volume = await n2VolumeResponse.json();
    const noMaster = await fetch(`${base}/api/novels/n2/outlines/${n2Volume.id}/activate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: 0 }) });
    assert.equal(noMaster.status, 409);
    const missingNovel = await fetch(`${base}/api/novels/missing/outlines`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 'master', scope: {}, content: 'x', databaseGeneration: 0 }) });
    assert.equal(missingNovel.status, 404);
    const activateMaster = await fetch(`${base}/api/novels/n1/outlines/${master.id}/activate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: 0 }) });
    assert.equal(activateMaster.status, 200);
    const activateVolume = await fetch(`${base}/api/novels/n1/outlines/${volume.id}/activate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: 0 }) });
    assert.equal(activateVolume.status, 200);
    const archive = await fetch(`${base}/api/novels/n1/outlines/${volume.id}/archive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: 0 }) });
    assert.equal(archive.status, 200);
    const noMasterAfter = await fetch(`${base}/api/novels/n2/outlines/${n2Volume.id}/activate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: 0 }) });
    assert.equal(noMasterAfter.status, 409);
  } finally {
    await stop(server);
  }
});

test('scoped activation without active master returns 409 and action body is strict', async () => {
  seed('n1');
  const { server, base } = await start();
  try {
    const created = await fetch(`${base}/api/novels/n1/outlines`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 'volume', scope: { volumeName: 'V' }, content: 'v', databaseGeneration: 0 }) });
    const artifact = await created.json();
    const noMaster = await fetch(`${base}/api/novels/n1/outlines/${artifact.id}/activate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: 0 }) });
    assert.equal(noMaster.status, 409);
    assert.equal((await noMaster.json()).code, 'OUTLINE_MASTER_REQUIRED');
    const invalidActionBody = await fetch(`${base}/api/novels/n1/outlines/${artifact.id}/activate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unexpected: true }) });
    assert.equal(invalidActionBody.status, 400);
  } finally {
    await stop(server);
  }
});

test('detail route maps corrupted scope data to stable 409 without leaking value', async () => {
  seed('n1');
  const { server, base } = await start();
  try {
    const created = await fetch(`${base}/api/novels/n1/outlines`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 'master', scope: {}, content: 'bad', databaseGeneration: 0 }) });
    const artifact = await created.json();
    const badScope = '{"leak":"SECRET_BAD_SCOPE"';
    getDb().prepare('UPDATE outline_artifacts SET scope = ? WHERE id = ?').run(badScope, artifact.id);
    const response = await fetch(`${base}/api/novels/n1/outlines/${artifact.id}`);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { code: 'OUTLINE_INVALID_DATA', error: 'OUTLINE_INVALID_DATA: outline scope data is invalid' });
  } finally {
    await stop(server);
  }
});

test('route returns stable 500 on unexpected database failure and concurrent masters leave one active', async () => {
  seed('n1');
  const { server, base } = await start();
  try {
    const created = await Promise.all(['a', 'b'].map((content) => fetch(`${base}/api/novels/n1/outlines`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 'master', scope: {}, content, databaseGeneration: 0 }) }).then((r) => r.json())));
    const results = await Promise.all(created.map((a) => fetch(`${base}/api/novels/n1/outlines/${a.id}/activate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ databaseGeneration: 0 }) }).then(async (r) => ({ status: r.status, body: await r.json() }))));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 200]);
    const active = getDb().prepare("SELECT id, content FROM outline_artifacts WHERE novel_id = 'n1' AND level = 'master' AND status = 'active'").all() as Array<{ id: string; content: string }>;
    assert.equal(active.length, 1);
    assert.equal((getDb().prepare("SELECT global_outline FROM novels WHERE id = 'n1'").get() as { global_outline: string }).global_outline, active[0].content);
    closeDb();
    const failed = await fetch(`${base}/api/novels/n1/outlines`);
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { code: 'OUTLINE_INTERNAL_ERROR', error: '大纲请求处理失败，请稍后重试。' });
  } finally {
    await stop(server);
  }
});

test('stale outline generation rejects read and create without leaking or writing', async () => {
  seed('n1');
  const { server, base } = await start();
  try {
    const staleGeneration = getDatabaseGeneration() + 1;
    const read = await fetch(`${base}/api/novels/n1/outlines?generation=${staleGeneration}`);
    assert.equal(read.status, 409);
    assert.deepEqual(await read.json(), { code: 'OUTLINE_GENERATION_STALE', error: '数据库已变化，请刷新大纲后重试。' });
    const create = await fetch(`${base}/api/novels/n1/outlines`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 'master', scope: {}, content: 'stale', databaseGeneration: staleGeneration }) });
    assert.equal(create.status, 409);
    assert.equal((await create.json()).code, 'OUTLINE_GENERATION_STALE');
    const row = getDb().prepare("SELECT COUNT(*) AS count FROM outline_artifacts WHERE novel_id = 'n1'").get() as { count: number };
    assert.equal(row.count, 0);
  } finally {
    await stop(server);
  }
});

test('direct capability outline writes are rejected until they are represented by a canon candidate', async () => {
  seed('n1');
  const { server, base } = await start();
  try {
    const response = await fetch(`${base}/api/novels/n1/outlines`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        level: 'master', scope: {}, content: 'proposal', source: 'ai-proposal',
        sourceCapabilityVersions: [{ capabilityId: 'opening-gold-three', version: '3' }],
        databaseGeneration: getDatabaseGeneration(),
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      code: 'OUTLINE_CAPABILITY_CANDIDATE_REQUIRED',
      error: '能力生成的大纲必须通过 Canon 候选确认。',
    });
  } finally {
    await stop(server);
  }
});

test('legacy AI outline proposals remain candidates without frozen capability provenance', async () => {
  seed('n1');
  const { server, base } = await start();
  try {
    const response = await fetch(`${base}/api/novels/n1/outlines`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        level: 'master', scope: {}, content: 'legacy proposal', source: 'ai-proposal',
        databaseGeneration: getDatabaseGeneration(),
      }),
    });
    assert.equal(response.status, 201);
    const proposal = await response.json() as { id: string; source: string; status: string; content: string };
    assert.equal(typeof proposal.id, 'string');
    assert.equal(proposal.source, 'ai-proposal');
    assert.equal(proposal.status, 'candidate');
    assert.equal(proposal.content, 'legacy proposal');
  } finally {
    await stop(server);
  }
});
