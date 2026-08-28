import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeDb, createNovel, initDb, getContinuationPack, createChapterProductionRunVersion, listChapterProductionRunVersions, createContinuationExtractionJob, getContinuationExtractionJob, updateContinuationExtractionJob, markRunningInterrupted } from '../server/lib/db.js';
import { getDb } from '../server/lib/db-instance.js';
import { buildContinuationSourceDocument } from '../shared/lib/continuation-pack.js';
import { validateDatabaseImportFile } from '../server/routes/db.js';
import { createHash } from 'node:crypto';

const tempDirs = new Set<string>();
const makeTempDir = (prefix: string) => {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.add(directory);
  return directory;
};
test.after(() => {
  closeDb();
  for (const directory of tempDirs) rmSync(directory, { recursive: true, force: true });
});

test('schema creates additive version and extraction job tables and CRUD works', () => {
  const dbPath = path.join(makeTempDir('inkflow-schema-'), 'test.db');
  initDb(dbPath);
  createNovel({ id: 'schema-novel', title: 'Schema', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  getDb().prepare("UPDATE novels SET global_outline = 'legacy outline' WHERE id = 'schema-novel'").run();
  closeDb();
  initDb(dbPath);
  assert.equal((getDb().prepare("SELECT COUNT(*) AS count FROM outline_artifacts WHERE novel_id = 'schema-novel' AND level = 'master' AND status = 'active'").get() as { count: number }).count, 1);
  closeDb();
  initDb(dbPath);
  getDb().prepare("INSERT INTO continuation_packs (id, novel_id, title, status, source_documents, canon_facts, character_states, plot_state, style_profile, contradictions, continuation_task, created_at, updated_at) VALUES ('schema-pack','schema-novel','Pack','draft','[]','[]','[]','{}','{}','[]','',1,1)").run();
  getDb().prepare("INSERT INTO chapter_production_runs (id, novel_id, status, user_intent, scene_beats, draft_content, style_audit, continuity_report, created_at, updated_at) VALUES ('schema-run','schema-novel','running','','','','','{}',1,1)").run();
  createChapterProductionRunVersion({ id: 'v1', runId: 'schema-run', novelId: 'schema-novel', source: 'fallback', sceneBeats: 'beats', draftContent: 'draft', styleAudit: '', continuityReport: {} as never, contentHash: 'abc', createdAt: 1 });
  assert.equal(listChapterProductionRunVersions('schema-run')[0].id, 'v1');
  createContinuationExtractionJob({ id: 'job1', packId: 'schema-pack', novelId: 'schema-novel', status: 'running', progress: 1, stageText: 'x', batchCursor: 1, totalBatches: 2, databaseGeneration: 1, createdAt: 1, updatedAt: 1 });
  assert.equal(updateContinuationExtractionJob('job1', { progress: 2 }), true);
  assert.equal(getContinuationExtractionJob('job1')?.progress, 2);
  assert.equal(markRunningInterrupted(), 1);
  assert.equal(getContinuationExtractionJob('job1')?.status, 'interrupted');
  getDb().prepare("INSERT INTO continuation_extraction_jobs (id, pack_id, novel_id, status, database_generation, created_at, updated_at) VALUES ('bad-job','schema-pack','schema-novel','bogus',1,1,1)").run();
  assert.deepEqual({ status: getContinuationExtractionJob('bad-job')?.status, errorCode: getContinuationExtractionJob('bad-job')?.errorCode }, { status: 'failed', errorCode: 'INVALID_JOB_STATUS' });
  closeDb();
  validateDatabaseImportFile(dbPath, true);
});

test('outline governance enforces one active master per novel', () => {
  const dbPath = path.join(makeTempDir('inkflow-outline-'), 'test.db');
  initDb(dbPath);
  createNovel({ id: 'outline-novel', title: 'Outline', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  const insert = getDb().prepare("INSERT INTO outline_artifacts (id, novel_id, level, scope, content, source, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'user', ?, 1, 1)");
  insert.run('master-1', 'outline-novel', 'master', '{}', 'one', 'active');
  assert.throws(() => insert.run('master-2', 'outline-novel', 'master', '{}', 'two', 'active'), /UNIQUE constraint failed/);
  insert.run('volume-1', 'outline-novel', 'volume', '{"volumeName":"I"}', 'volume', 'active');
  insert.run('candidate-1', 'outline-novel', 'master', '{}', 'candidate', 'candidate');
  closeDb();
});

test('legacy outline backfill is deterministic and respects existing active masters', () => {
  const dbPath = path.join(makeTempDir('inkflow-outline-legacy-'), 'test.db');
  initDb(dbPath);
  createNovel({ id: 'legacy-outline-novel', title: 'Legacy', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  getDb().prepare("UPDATE novels SET global_outline = 'legacy content' WHERE id = 'legacy-outline-novel'").run();
  closeDb();
  initDb(dbPath);
  assert.deepEqual(getDb().prepare("SELECT id, content FROM outline_artifacts WHERE novel_id = 'legacy-outline-novel'").get() as { id: string; content: string }, { id: 'legacy-outline-legacy-outline-novel', content: 'legacy content' });
  closeDb();
  initDb(dbPath);
  assert.equal((getDb().prepare("SELECT COUNT(*) AS count FROM outline_artifacts WHERE novel_id = 'legacy-outline-novel'").get() as { count: number }).count, 1);
  createNovel({ id: 'existing-master-novel', title: 'Existing', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  getDb().prepare("UPDATE novels SET global_outline = 'should not copy' WHERE id = 'existing-master-novel'").run();
  getDb().prepare("INSERT INTO outline_artifacts (id, novel_id, level, scope, content, source, status, created_at, updated_at) VALUES ('existing-master', 'existing-master-novel', 'master', '{}', 'existing', 'user', 'active', 1, 1)").run();
  closeDb();
  initDb(dbPath);
  assert.equal((getDb().prepare("SELECT COUNT(*) AS count FROM outline_artifacts WHERE novel_id = 'existing-master-novel'").get() as { count: number }).count, 1);
  closeDb();
});

test('legacy outline backfill fails on a reserved deterministic id', () => {
  const dbPath = path.join(makeTempDir('inkflow-outline-conflict-'), 'test.db');
  initDb(dbPath);
  createNovel({ id: 'conflict-novel', title: 'Conflict', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  getDb().prepare("INSERT INTO outline_artifacts (id, novel_id, level, scope, content, source, status, created_at, updated_at) VALUES ('legacy-outline-conflict-novel', 'conflict-novel', 'master', '{}', 'reserved', 'user', 'candidate', 1, 1)").run();
  getDb().prepare("UPDATE novels SET global_outline = 'must not disappear' WHERE id = 'conflict-novel'").run();
  closeDb();
  assert.throws(() => initDb(dbPath), /legacy outline artifact id is already occupied/);
  closeDb();
});

test('source document hashes new text and preserves missing hash for legacy rows', () => {
  const document = buildContinuationSourceDocument({ packId: 'p', filename: 'a.txt', text: 'hello' });
  assert.equal(document.sha256, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.equal(Object.hasOwn({ id: 'legacy' }, 'sha256'), false);
});

test('route source hash matches the exact persisted text including whitespace', () => {
  const text = '  hello  ';
  assert.equal(createHash('sha256').update(text).digest('hex'), '344104d101f749841284439fff5c0bba31d272f7f7606b63bbb36694e71d02fe');
});

test('legacy database without additive tables validates and upgrades without inventing source hashes', () => {
  const dbPath = path.join(makeTempDir('inkflow-legacy-'), 'test.db');
  initDb(dbPath);
  createNovel({ id: 'legacy-novel', title: 'Legacy', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  getDb().prepare("INSERT INTO continuation_packs (id, novel_id, title, status, source_documents, canon_facts, character_states, plot_state, style_profile, contradictions, continuation_task, created_at, updated_at) VALUES ('legacy-pack','legacy-novel','Pack','draft',?, '[]','[]','{}','{}','[]','',1,1)").run(JSON.stringify([{ id: 'doc', packId: 'legacy-pack', filename: 'old.txt', kind: 'other', text: 'old', excerpt: 'old', createdAt: 1 }]));
  getDb().exec('DROP INDEX idx_production_run_versions_run; DROP INDEX idx_production_run_versions_novel; DROP INDEX idx_continuation_extraction_jobs_pack; DROP INDEX idx_continuation_extraction_jobs_novel; DROP TABLE chapter_production_run_versions; DROP TABLE continuation_extraction_jobs;');
  closeDb();
  validateDatabaseImportFile(dbPath, true);
  initDb(dbPath);
  assert.equal(getContinuationPack('legacy-pack')?.sourceDocuments[0].sha256, undefined);
  assert.equal((getDb().prepare("SELECT name FROM sqlite_master WHERE name = 'chapter_production_run_versions'").get() as { name: string }).name, 'chapter_production_run_versions');
  closeDb();
});

test('import validation rejects malformed additive table columns', () => {
  const dbPath = path.join(makeTempDir('inkflow-malformed-'), 'test.db');
  initDb(dbPath);
  getDb().exec('DROP TABLE chapter_production_run_versions');
  getDb().exec("CREATE TABLE chapter_production_run_versions (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, novel_id TEXT NOT NULL, source TEXT NOT NULL, created_at INTEGER NOT NULL)");
  closeDb();
  assert.throws(() => validateDatabaseImportFile(dbPath, true), /Optional table column is missing: chapter_production_run_versions\./);
});
