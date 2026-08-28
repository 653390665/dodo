import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { closeDb, createChapter, createNovel, getChapter, initDb } from '../server/lib/db.js';
import { getDatabaseGeneration } from '../server/lib/db-instance.js';
import { registerDbRoutes } from '../server/routes/db.js';

const app = express();
app.use(express.json());
registerDbRoutes(app);
const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
  const instance = app.listen(0, () => resolve(instance));
  instance.once('error', reject);
});
const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

async function updateChapterViaDb(chapterId: string, workflowMeta: unknown) {
  return fetch(`${baseUrl}/api/db`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'updateChapter', args: [chapterId, { workflowMeta }] }),
  });
}

test.before(() => {
  closeDb();
  initDb(':memory:');
  createNovel({ id: 'capability-meta-novel', title: 'Capability metadata', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  createChapter({ id: 'capability-meta-chapter', novelId: 'capability-meta-novel', title: '第一章', content: '', order: 1, wordCount: 0, createdAt: 1, updatedAt: 1 });
});

test.after(() => {
  closeDb();
  server.close();
});

test('updateChapter persists a valid capability state through the DB schema', async () => {
  const generation = getDatabaseGeneration();
  const workflowMeta = {
    version: 1,
    capabilityState: {
      novelId: 'capability-meta-novel',
      databaseGeneration: generation,
      techniqueIds: ['prose-action-booster'],
      overlayCardIds: [],
      techniqueVersions: { 'prose-action-booster': '3' },
      updatedAt: 2,
    },
  };
  const response = await updateChapterViaDb('capability-meta-chapter', workflowMeta);
  assert.equal(response.status, 200);
  assert.deepEqual(getChapter('capability-meta-chapter')?.workflowMeta, workflowMeta);
});

test('updateChapter still rejects invalid capability scope and generation', async () => {
  const generation = getDatabaseGeneration();
  const invalidScope = await updateChapterViaDb('capability-meta-chapter', {
    version: 1,
    capabilityState: {
      novelId: 'capability-meta-novel', databaseGeneration: generation,
      techniqueIds: ['opening-gold-three'], overlayCardIds: [], techniqueVersions: { 'opening-gold-three': '3' }, updatedAt: 3,
    },
  });
  assert.equal(invalidScope.status, 400);
  assert.equal((await invalidScope.json()).code, 'CAPABILITY_MANIFEST_INVALID');

  const invalidGeneration = await updateChapterViaDb('capability-meta-chapter', {
    version: 1,
    capabilityState: {
      novelId: 'capability-meta-novel', databaseGeneration: generation + 1,
      techniqueIds: [], overlayCardIds: [], updatedAt: 4,
    },
  });
  assert.equal(invalidGeneration.status, 409);
  assert.deepEqual(await invalidGeneration.json(), {
    code: 'DB_GENERATION_CONFLICT',
    message: '数据库已变化，请刷新后重试',
    error: '数据库已变化，请刷新后重试',
  });
});
