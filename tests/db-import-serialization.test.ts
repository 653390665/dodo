import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-db-import-'));
const activeDbPath = path.join(testDir, 'active.test.db');
const importedDbPath = path.join(testDir, 'imported.test.db');
process.env.INKFLOW_DB_PATH = activeDbPath;

test('database import serialization and recovery', async (t) => {
  const { closeDb, initDb } = await import('../server/lib/db');
  const { getDb, runInSerializedWrite } = await import('../server/lib/db-instance');
  const { importDatabaseBuffer } = await import('../server/routes/db');

  try {
    await t.test('waits for old writes and prevents them from reaching the replacement', async () => {
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
    });

    await t.test('restores the original database and cleans temporary files when initialization fails', async () => {
      closeDb();
      for (const filePath of [
        activeDbPath,
        `${activeDbPath}-wal`,
        `${activeDbPath}-shm`,
        `${activeDbPath}.pre-import-bak`,
      ]) {
        fs.rmSync(filePath, { force: true });
      }

      initDb(activeDbPath);
      getDb().prepare(`
        INSERT INTO novels (id, title, author_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('original-novel', '原数据库作品', 'local-user', Date.now(), Date.now());
      closeDb();

      fs.writeFileSync(`${activeDbPath}-wal`, 'stale wal');
      fs.writeFileSync(`${activeDbPath}-shm`, 'stale shm');
      const importedBuffer = fs.readFileSync(importedDbPath);
      let initializeCalls = 0;

      await assert.rejects(
        importDatabaseBuffer(importedBuffer, () => {
          initializeCalls += 1;
          assert.equal(fs.existsSync(`${activeDbPath}-wal`), false);
          assert.equal(fs.existsSync(`${activeDbPath}-shm`), false);
          if (initializeCalls === 1) {
            throw new Error('injected initialization failure');
          }
          initDb(activeDbPath);
        }),
        /injected initialization failure/,
      );

      assert.equal(initializeCalls, 2, 'rollback must reinitialize the restored database');
      assert.ok(getDb().prepare('SELECT id FROM novels WHERE id = ?').get('original-novel'));
      assert.equal(
        getDb().prepare('SELECT id FROM novels WHERE id = ?').get('imported-novel'),
        undefined,
        'failed replacement data must not remain active after rollback',
      );
      assert.equal(fs.existsSync(`${activeDbPath}.pre-import-bak`), false);

      closeDb();
      assert.equal(fs.existsSync(`${activeDbPath}-wal`), false);
      assert.equal(fs.existsSync(`${activeDbPath}-shm`), false);
    });
  } finally {
    closeDb();
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});
