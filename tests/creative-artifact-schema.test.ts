import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb, initDb } from '../server/lib/db.js';
import { getDb } from '../server/lib/db-instance.js';

const tempDirs = new Set<string>();

function makeDbPath(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.add(directory);
  return path.join(directory, 'data.db');
}

function columnNames(table: string): string[] {
  return (getDb().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(({ name }) => name);
}

function foreignKeys(table: string): Array<{ table: string; from: string; to: string; on_delete: string }> {
  return getDb().prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{
    table: string;
    from: string;
    to: string;
    on_delete: string;
  }>;
}

function foreignKeyContract(key: { table: string; from: string; to: string; on_delete: string } | undefined) {
  assert.ok(key);
  return { table: key.table, from: key.from, to: key.to, on_delete: key.on_delete };
}

function indexContract(name: string): { columns: string[]; unique: number } {
  const database = getDb();
  const row = database.prepare("SELECT tbl_name FROM sqlite_master WHERE type = 'index' AND name = ?").get(name) as { tbl_name: string } | undefined;
  assert.ok(row);
  const listEntry = (database.pragma(`index_list(${row.tbl_name})`) as Array<{ name: string; unique: number }>)
    .find((entry) => entry.name === name);
  assert.ok(listEntry);
  return {
    columns: (database.pragma(`index_info(${name})`) as Array<{ name: string }>).map((entry) => entry.name),
    unique: listEntry.unique,
  };
}

test.after(() => {
  closeDb();
  for (const directory of tempDirs) fs.rmSync(directory, { recursive: true, force: true });
});

test('initializes the four creative artifact tables with exact columns and indexes', () => {
  closeDb();
  initDb(makeDbPath('inkflow-artifact-schema-'));
  const database = getDb();
  const tables = [
    'creative_artifact_cores',
    'creative_artifact_versions',
    'creative_artifact_candidates',
    'artifact_review_requirements',
  ];
  for (const name of tables) {
    const row = database.prepare("SELECT type FROM sqlite_master WHERE name = ?").get(name) as { type: string } | undefined;
    assert.equal(row?.type, 'table');
  }

  assert.deepEqual(columnNames('creative_artifact_cores'), [
    'id', 'novel_id', 'artifact_kind', 'artifact_id', 'version', 'core_json',
    'readable_content', 'provenance_json', 'created_at', 'updated_at',
  ]);
  assert.deepEqual(columnNames('creative_artifact_versions'), [
    'id', 'novel_id', 'artifact_kind', 'artifact_id', 'version', 'core_json',
    'readable_content', 'provenance_json', 'created_at',
  ]);
  assert.deepEqual(columnNames('creative_artifact_candidates'), [
    'id', 'novel_id', 'artifact_kind', 'artifact_id', 'target_version', 'operation',
    'goal', 'base_fingerprint', 'source_capability_versions', 'proposed_core',
    'proposed_content', 'diff', 'impact_report', 'status', 'created_at', 'updated_at',
    'decided_at',
  ]);
  assert.deepEqual(columnNames('artifact_review_requirements'), [
    'id', 'novel_id', 'artifact_kind', 'artifact_id', 'artifact_version',
    'source_candidate_id', 'reason', 'status', 'created_at', 'updated_at', 'resolved_at',
  ]);

  assert.deepEqual(indexContract('idx_creative_artifact_cores_identity'), { columns: ['novel_id', 'artifact_kind', 'artifact_id'], unique: 1 });
  assert.deepEqual(indexContract('idx_creative_artifact_versions_identity'), { columns: ['novel_id', 'artifact_kind', 'artifact_id', 'version'], unique: 1 });
  assert.deepEqual(indexContract('idx_creative_artifact_versions_novel'), { columns: ['novel_id', 'artifact_kind', 'artifact_id'], unique: 0 });
  assert.deepEqual(indexContract('idx_creative_artifact_candidates_status'), { columns: ['novel_id', 'status', 'created_at'], unique: 0 });
  assert.deepEqual(indexContract('idx_creative_artifact_candidates_target'), { columns: ['novel_id', 'artifact_kind', 'artifact_id'], unique: 0 });
  assert.deepEqual(indexContract('idx_artifact_review_requirements_lookup'), { columns: ['novel_id', 'artifact_kind', 'artifact_id', 'status'], unique: 0 });
  assert.deepEqual(indexContract('idx_artifact_review_requirements_candidate'), { columns: ['source_candidate_id'], unique: 0 });

  const coreForeignKeys = foreignKeys('creative_artifact_cores');
  const versionForeignKeys = foreignKeys('creative_artifact_versions');
  const candidateForeignKeys = foreignKeys('creative_artifact_candidates');
  const reviewForeignKeys = foreignKeys('artifact_review_requirements');
  assert.deepEqual(foreignKeyContract(coreForeignKeys[0]), { table: 'novels', from: 'novel_id', to: 'id', on_delete: 'CASCADE' });
  assert.deepEqual(foreignKeyContract(versionForeignKeys[0]), { table: 'novels', from: 'novel_id', to: 'id', on_delete: 'CASCADE' });
  assert.deepEqual(foreignKeyContract(candidateForeignKeys[0]), { table: 'novels', from: 'novel_id', to: 'id', on_delete: 'CASCADE' });
  assert.deepEqual(foreignKeyContract(reviewForeignKeys.find((key) => key.from === 'novel_id')), { table: 'novels', from: 'novel_id', to: 'id', on_delete: 'CASCADE' });
  assert.deepEqual(foreignKeyContract(reviewForeignKeys.find((key) => key.from === 'source_candidate_id')), { table: 'creative_artifact_candidates', from: 'source_candidate_id', to: 'id', on_delete: 'SET NULL' });
});

test('initializes additive structured outline and canon provenance columns', () => {
  closeDb();
  initDb(makeDbPath('inkflow-outline-schema-'));
  assert.deepEqual(
    columnNames('outline_artifacts').filter((name) => ['core_json', 'source_capability_versions'].includes(name)).sort(),
    ['core_json', 'source_capability_versions'],
  );
  assert.deepEqual(
    columnNames('canon_patches').filter((name) => name === 'source_capability_versions'),
    ['source_capability_versions'],
  );
});

test('upgrading a legacy database preserves complete existing rows', () => {
  closeDb();
  const dbPath = makeDbPath('inkflow-artifact-legacy-');
  initDb(dbPath);
  const database = getDb();
  database.prepare("INSERT INTO novels (id, title, author_id, summary, cover_image, status, world_rules, global_outline, mounted_skill_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run('legacy-novel', 'Legacy', 'author', 'summary', 'cover', 'ongoing', 'rules', 'outline', '["skill"]', 1, 2);
  database.prepare("INSERT INTO characters (id, novel_id, name, role, summary, traits, bio, current_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run('legacy-character', 'legacy-novel', 'Hero', 'lead', 'summary', '["brave"]', 'bio', 'state', 3, 4);
  database.prepare("INSERT INTO foreshadowings (id, novel_id, title, description, status, planted_chapter_id, payoff_chapter_id, related_character_ids, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run('legacy-foreshadowing', 'legacy-novel', 'Hint', 'description', 'planted', 'chapter-1', null, '["legacy-character"]', 'notes', 5, 6);
  database.prepare("INSERT INTO outline_artifacts (id, novel_id, level, scope, content, source, status, base_fingerprint, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run('legacy-outline', 'legacy-novel', 'master', '{}', 'content', 'user', 'active', 'fingerprint', 7, 8);
  database.exec(`
    DROP TABLE artifact_review_requirements;
    DROP TABLE creative_artifact_candidates;
    DROP TABLE creative_artifact_versions;
    DROP TABLE creative_artifact_cores;
  `);
  const snapshots = new Map<string, unknown>();
  for (const table of ['novels', 'characters', 'foreshadowings', 'outline_artifacts']) {
    snapshots.set(table, database.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
  }
  closeDb();
  initDb(dbPath);
  for (const table of ['novels', 'characters', 'foreshadowings', 'outline_artifacts']) {
    assert.deepEqual(databaseForCurrentDb().prepare(`SELECT * FROM ${table} ORDER BY id`).all(), snapshots.get(table));
  }
});

function databaseForCurrentDb() {
  return getDb();
}
