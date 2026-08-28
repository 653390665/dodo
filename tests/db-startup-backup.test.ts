import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-startup-backup-'));
const dbPath = path.join(workspace, 'isolated.db');
const backupPath = `${dbPath}.bak`;

function cleanFiles(): void {
  for (const name of fs.readdirSync(workspace)) {
    fs.rmSync(path.join(workspace, name), { force: true });
  }
}

test.after(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('startup backup validates the readonly snapshot before atomic publication', async (t) => {
  const { closeDb, initDb } = await import('../server/lib/db');
  const { getDb } = await import('../server/lib/db-instance');
  const { createValidatedStartupBackup, INKFLOW_SQLITE_APPLICATION_ID, openReadOnlyDb } = await import('../server/lib/db-init');

  await t.test('publishes a valid snapshot with schema and application marker', async () => {
    closeDb();
    cleanFiles();
    initDb(dbPath);
    try {
      const publishedPath = await createValidatedStartupBackup(getDb(), dbPath);
      assert.equal(publishedPath, backupPath);
      assert.equal(fs.existsSync(backupPath), true);
      const snapshot = openReadOnlyDb(backupPath);
      try {
        assert.equal(snapshot.pragma('application_id', { simple: true }), INKFLOW_SQLITE_APPLICATION_ID);
        const probe = snapshot.prepare('SELECT 1 AS ok').get() as { ok: number };
        assert.equal(probe.ok, 1);
        assert.ok(snapshot.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chapters'").get());
      } finally {
        snapshot.close();
      }
      assert.deepEqual(fs.readdirSync(workspace).filter((name) => name.includes('.temp')), []);
    } finally {
      closeDb();
    }
  });

  await t.test('validation failure removes temp and preserves the previous backup', async () => {
    closeDb();
    cleanFiles();
    initDb(dbPath);
    fs.writeFileSync(backupPath, 'previous-good-backup');
    try {
      getDb().pragma('application_id = 0');
      await assert.rejects(
        createValidatedStartupBackup(getDb(), dbPath),
        /application_id mismatch/,
      );
      assert.equal(fs.readFileSync(backupPath, 'utf8'), 'previous-good-backup');
      assert.deepEqual(fs.readdirSync(workspace).filter((name) => name.includes('.temp')), []);
    } finally {
      closeDb();
    }
  });
});
