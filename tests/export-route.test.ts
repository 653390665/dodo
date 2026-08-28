import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import express from 'express';
import JSZip from 'jszip';

import {
  captureEnv,
  createTestWorkspace,
  restoreEnv,
} from './helpers/test-environment';

const envSnapshot = captureEnv(['INKFLOW_DB_PATH']);
const workspace = createTestWorkspace('export-routes');
const dbPath = workspace.path('export-routes.test.db');
process.env.INKFLOW_DB_PATH = dbPath;

let baseUrl: string;
let server: ReturnType<express.Express['listen']>;
let db: typeof import('../server/lib/db');
let dbInstance: typeof import('../server/lib/db-instance');
let openReadOnlyDb: typeof import('../server/lib/db-init').openReadOnlyDb;

function removeDatabaseFiles(): void {
  for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    fs.rmSync(filePath, { force: true });
  }
  for (const name of fs.readdirSync(workspace.directory)) {
    if (name.endsWith('.temp-export')) {
      fs.rmSync(path.join(workspace.directory, name), { force: true });
    }
  }
}

function seedExportNovel(): void {
  const now = Date.now();
  db.createNovel({
    id: 'export-novel',
    title: '测试 & <小说>',
    authorId: 'export-author',
    summary: '',
    status: 'ongoing',
    createdAt: now,
    updatedAt: now,
  });
  db.createChapter({
    id: 'chapter-two',
    novelId: 'export-novel',
    volumeName: '第一卷',
    title: '第二章 <后>',
    content: '后写 & 内容',
    order: 2,
    wordCount: 6,
    sceneBeats: '',
    createdAt: now,
    updatedAt: now,
  });
  db.createChapter({
    id: 'chapter-one',
    novelId: 'export-novel',
    volumeName: '第一卷',
    title: '第一章 & 前',
    content: '先写 <内容>',
    order: 1,
    wordCount: 6,
    sceneBeats: '',
    createdAt: now,
    updatedAt: now,
  });
}

test.before(async () => {
  const [dbModule, dbInstanceModule, dbInitModule, exportRoutes, dbRoutes] = await Promise.all([
    import('../server/lib/db'),
    import('../server/lib/db-instance'),
    import('../server/lib/db-init'),
    import('../server/routes/export'),
    import('../server/routes/db'),
  ]);
  db = dbModule;
  dbInstance = dbInstanceModule;
  openReadOnlyDb = dbInitModule.openReadOnlyDb;

  const app = express();
  app.use(express.json());
  exportRoutes.registerExportRoutes(app);
  dbRoutes.registerDbRoutes(app);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.beforeEach(() => {
  db.closeDb();
  removeDatabaseFiles();
  db.initDb(dbPath);
  seedExportNovel();
});

test.afterEach(() => {
  db.closeDb();
  removeDatabaseFiles();
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  restoreEnv(envSnapshot);
  workspace.cleanup();
});

test('POST /api/export validates input and rejects missing novels', async () => {
  const invalid = await fetch(`${baseUrl}/api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ novelId: '', format: 'pdf' }),
  });
  assert.equal(invalid.status, 400);

  const missing = await fetch(`${baseUrl}/api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ novelId: 'missing-novel', format: 'txt' }),
  });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: '作品不存在，请刷新项目后重试。' });
});

test('POST /api/export returns chapters sorted by order in TXT', async () => {
  const response = await fetch(`${baseUrl}/api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ novelId: 'export-novel', format: 'txt' }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /^text\/plain/);
  const content = await response.text();
  assert.ok(content.indexOf('第一章 & 前') < content.indexOf('第二章 <后>'));
  assert.match(content, /先写 <内容>/);
  assert.match(content, /后写 & 内容/);
});

test('POST /api/export returns a valid EPUB with escaped XML', async () => {
  const response = await fetch(`${baseUrl}/api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ novelId: 'export-novel', format: 'epub' }),
  });
  assert.equal(response.status, 200);
  const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
  assert.equal(await zip.file('mimetype')?.async('string'), 'application/epub+zip');

  const opf = await zip.file('OEBPS/content.opf')?.async('string');
  assert.match(opf || '', /测试 &amp; &lt;小说&gt;/);
  const firstChapter = await zip.file('OEBPS/ch0.xhtml')?.async('string');
  assert.match(firstChapter || '', /第一章 &amp; 前/);
  assert.match(firstChapter || '', /先写 &lt;内容&gt;/);
});

test('GET /api/db/export-file creates a readable snapshot and removes the temp export', async () => {
  const response = await fetch(`${baseUrl}/api/db/export-file`);
  assert.equal(response.status, 200);
  const snapshotPath = workspace.path('downloaded-snapshot.db');
  fs.writeFileSync(snapshotPath, Buffer.from(await response.arrayBuffer()));

  const snapshot = openReadOnlyDb(snapshotPath);
  try {
    const row = snapshot.prepare('SELECT title FROM novels WHERE id = ?').get('export-novel') as { title: string };
    assert.equal(row.title, '测试 & <小说>');
    assert.equal(snapshot.pragma('quick_check', { simple: true }), 'ok');
  } finally {
    snapshot.close();
  }

  await new Promise<void>((resolve) => setImmediate(resolve));
  const tempExports = fs.readdirSync(workspace.directory).filter((name) => name.endsWith('.temp-export'));
  assert.deepEqual(tempExports, []);
});

test('GET /api/db/export-file falls back to an existing DB file when uninitialized', async () => {
  db.closeDb();
  assert.equal(dbInstance.isDbInitialized(), false);
  assert.equal(fs.existsSync(dbPath), true);

  const response = await fetch(`${baseUrl}/api/db/export-file`);
  assert.equal(response.status, 200);
  const fallbackPath = workspace.path('fallback-download.db');
  fs.writeFileSync(fallbackPath, Buffer.from(await response.arrayBuffer()));
  const fallback = openReadOnlyDb(fallbackPath);
  try {
    assert.equal(fallback.pragma('quick_check', { simple: true }), 'ok');
  } finally {
    fallback.close();
  }
});

test('GET /api/db/export-file returns 404 when no database file exists', async () => {
  db.closeDb();
  removeDatabaseFiles();
  const response = await fetch(`${baseUrl}/api/db/export-file`);
  assert.equal(response.status, 404);
});
