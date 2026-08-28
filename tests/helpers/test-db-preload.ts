import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Keep each Node test worker away from the application's default database.
const ownerPid = String(process.pid);
const inheritedOwnerPid = process.env.INKFLOW_TEST_DB_OWNER_PID;
const needsIsolatedDatabase = !process.env.INKFLOW_DB_PATH
  || (inheritedOwnerPid !== undefined && inheritedOwnerPid !== ownerPid);

if (needsIsolatedDatabase) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `inkflow-test-${process.pid}-`));
  process.env.INKFLOW_DB_PATH = path.join(directory, 'data.db');
  process.env.INKFLOW_TEST_DB_OWNER_PID = ownerPid;
  process.once('exit', () => {
    fs.rmSync(directory, { force: true, recursive: true });
  });
}
