import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-db-import-'));
const activeDbPath = path.join(testDir, 'active.test.db');
const importedDbPath = path.join(testDir, 'imported.test.db');
process.env.INKFLOW_DB_PATH = activeDbPath;

test('database import waits for old writes and prevents them from reaching the replacement', async () => {
  const { closeDb, initDb } = await import('../server/lib/db');
  const { getDb, runInSerializedWrite } = await import('../server/lib/db-instance');
  const { importDatabaseBuffer } = await import('../server/routes/db');

  try {
    initDb(importedDbPath);
    getDb().prepare(`
      INSERT INTO novels (id, title, author_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('imported-novel', '导入库作品', 'local-user', Date.now(), Date.now());
    closeDb();
    const importedBuffer = fs.readFileSync(importedDbPath);

    initDb(activeDbPath);

    let releaseFirstWrite!: () => void;
    const firstWriteCanFinish = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const order: string[] = [];

    const firstWrite = runInSerializedWrite(async () => {
      order.push('first-started');
      await firstWriteCanFinish;
      order.push('first-finished');
    });
    const queuedOldWrite = runInSerializedWrite(() => {
      getDb().prepare(`
        INSERT INTO novels (id, title, author_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('queued-old-novel', '旧库排队写入', 'local-user', Date.now(), Date.now());
      order.push('old-write-finished');
    });
    const importPromise = importDatabaseBuffer(importedBuffer).then(() => {
      order.push('import-finished');
    });

    releaseFirstWrite();
    await Promise.all([firstWrite, queuedOldWrite, importPromise]);

    assert.deepEqual(order, [
      'first-started',
      'first-finished',
      'old-write-finished',
      'import-finished',
    ]);
    assert.ok(getDb().prepare('SELECT id FROM novels WHERE id = ?').get('imported-novel'));
    assert.equal(
      getDb().prepare('SELECT id FROM novels WHERE id = ?').get('queued-old-novel'),
      undefined,
      'a write queued against the old database must finish before replacement, not leak into it',
    );
  } finally {
    closeDb();
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});
