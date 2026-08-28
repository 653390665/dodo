import type BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'fs';
import os from 'os';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';
import { getDb, setDb, isDbInitialized } from './db-instance.js';
import { mapContinuationPackRow } from './db-mappers.js';
import { buildImportedNovelDraft } from '../../shared/lib/continuation-import-flow.js';
import { ensureCapabilityRecommendationSchema } from './db/capability-recommendations.js';

declare const __CJS_BUNDLE__: boolean | undefined;

const indirectEval = eval;
let metaUrl: string;
try {
  metaUrl = indirectEval('import.meta.url');
} catch {
  metaUrl = typeof __filename !== 'undefined' ? __filename : path.join(process.cwd(), 'server/lib/db-init.ts');
}

const req = typeof __CJS_BUNDLE__ !== 'undefined'
  ? require
  : createRequire(metaUrl);
const { Database, nativeBindingPath } = req('./better-sqlite3-shim.cjs') as {
  Database: typeof BetterSqlite3;
  nativeBindingPath: string;
};

/** ASCII "INKF". New databases carry this marker; legacy zero-marker backups remain migratable. */
export const INKFLOW_SQLITE_APPLICATION_ID = 0x494e4b46;

/** Open an isolated read-only connection without touching the active singleton. */
export function openReadOnlyDb(dbPath: string): BetterSqlite3.Database {
  return new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
    nativeBinding: nativeBindingPath,
  });
}

const REQUIRED_STARTUP_BACKUP_SCHEMA = [
  ['table', 'novels'],
  ['table', 'chapters'],
  ['table', 'skills'],
  ['table', 'continuation_packs'],
  ['index', 'idx_chapters_novel'],
] as const;

function validateStartupBackup(snapshotPath: string): void {
  const snapshot = openReadOnlyDb(snapshotPath);
  try {
    const readProbe = snapshot.prepare('SELECT 1 AS ok').get() as { ok?: number } | undefined;
    if (readProbe?.ok !== 1) {
      throw new Error('startup snapshot read probe failed');
    }

    const applicationId = snapshot.pragma('application_id', { simple: true });
    if (applicationId !== INKFLOW_SQLITE_APPLICATION_ID) {
      throw new Error('startup snapshot application_id mismatch');
    }

    const findSchemaObject = snapshot.prepare(
      'SELECT 1 AS present FROM sqlite_master WHERE type = ? AND name = ?',
    );
    for (const [type, name] of REQUIRED_STARTUP_BACKUP_SCHEMA) {
      if (!findSchemaObject.get(type, name)) {
        throw new Error(`startup snapshot missing required ${type}: ${name}`);
      }
    }
  } finally {
    snapshot.close();
  }
}

/** Create, validate, and atomically publish a WAL-consistent startup snapshot. */
export async function createValidatedStartupBackup(
  database: BetterSqlite3.Database,
  targetPath: string,
): Promise<string> {
  const backupPath = `${targetPath}.bak`;
  const tempBackupPath = `${backupPath}.${process.pid}-${randomUUID()}.temp`;
  const removeTempBackupFiles = () => {
    for (const candidate of [tempBackupPath, `${tempBackupPath}-wal`, `${tempBackupPath}-shm`]) {
      try {
        if (existsSync(candidate)) unlinkSync(candidate);
      } catch {
        // Best effort: never remove or replace the last known-good backup here.
      }
    }
  };
  const removeTempBackupSidecars = () => {
    for (const candidate of [`${tempBackupPath}-wal`, `${tempBackupPath}-shm`]) {
      if (existsSync(candidate)) unlinkSync(candidate);
    }
  };
  try {
    await database.backup(tempBackupPath);
    validateStartupBackup(tempBackupPath);
    removeTempBackupSidecars();
    renameSync(tempBackupPath, backupPath);
    return backupPath;
  } catch (error) {
    removeTempBackupFiles();
    throw error;
  }
}

// Allow tests / e2e / tooling to redirect the database to an isolated path.
// Default behavior is unchanged (no env var → ~/.inkflow/data.db).
const DB_PATH_ENV = process.env.INKFLOW_DB_PATH;
export const DB_PATH = DB_PATH_ENV && DB_PATH_ENV.length > 0
  ? DB_PATH_ENV
  : path.join(os.homedir(), '.inkflow', 'data.db');
const DB_DIR = path.dirname(DB_PATH);

function ensureColumn(table: string, column: string, definition: string) {
  const database = getDb();
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// --- Init ---

// Export-route backups (`${basename}-<id>.temp-export`) are unlinked in the
// res.download callback; if the process dies mid-transfer they linger in the
// data directory. Sweep them on the next startup.
function cleanupOrphanExportBackups(targetPath: string): void {
  const dir = path.dirname(targetPath);
  const prefix = `${path.basename(targetPath)}-`;
  try {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(prefix) && entry.endsWith('.temp-export')) {
        try {
          unlinkSync(path.join(dir, entry));
        } catch {
          // best effort — retried on the next startup
        }
      }
    }
  } catch {
    // best effort — a stale export file must never block startup
  }
}

export function initDb(dbPath?: string): void {
  if (isDbInitialized()) return;

  const targetPath = dbPath || DB_PATH;

  if (targetPath !== ':memory:') {
    const targetDir = path.dirname(targetPath);
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
  } else if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  const _db = new Database(targetPath, { nativeBinding: nativeBindingPath });
  setDb(_db);
  getDb().pragma('journal_mode = WAL');
  getDb().pragma('foreign_keys = ON');
  getDb().pragma('busy_timeout = 5000');
  cleanupOrphanExportBackups(targetPath);

  const baseName = path.basename(targetPath);
  const isTestEnv =
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    targetPath === ':memory:' ||
    baseName.startsWith('test-') ||
    baseName.startsWith('inkflow-') ||
    baseName.endsWith('.test.db') ||
    targetPath.includes('/tests/') ||
    targetPath.includes('test-results/');

  getDb().exec(`
    CREATE TABLE IF NOT EXISTS novels (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '未命名作品',
      author_id TEXT NOT NULL DEFAULT 'local-user',
      summary TEXT DEFAULT '',
      cover_image TEXT,
      status TEXT DEFAULT 'ongoing',
      world_rules TEXT,
      global_outline TEXT,
      mounted_skill_ids TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'supporting',
      summary TEXT DEFAULT '',
      traits TEXT DEFAULT '[]',
      bio TEXT DEFAULT '',
      current_state TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      region TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS factions (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      leader TEXT DEFAULT '',
      territory TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS power_levels (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      tier INTEGER DEFAULT 0,
      characteristics TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS timeline_events (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      timestamp TEXT DEFAULT '',
      status_tag TEXT,
      "order" INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      volume_name TEXT,
      title TEXT DEFAULT '',
      content TEXT DEFAULT '',
      "order" INTEGER DEFAULT 0,
      word_count INTEGER DEFAULT 0,
      scene_beats TEXT,
      critique TEXT,
      workflow_meta TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chapter_completion_attempts (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      database_generation INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      plan_hash TEXT NOT NULL,
      phase TEXT NOT NULL,
      quality TEXT NOT NULL CHECK (quality IN ('pass', 'needs-action', 'unknown')),
      issue_ids TEXT NOT NULL DEFAULT '[]',
      unknown_checks TEXT NOT NULL DEFAULT '[]',
      risk_accepted_at INTEGER,
      fact_candidate_id TEXT,
      result_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK (phase IN ('writes-flushed', 'version-created', 'deterministic-checked', 'ai-reviewed', 'facts-proposed')),
      UNIQUE(novel_id, chapter_id, database_generation, content_hash, plan_hash),
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chapter_versions (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL,
      content TEXT DEFAULT '',
      word_count INTEGER DEFAULT 0,
      author TEXT DEFAULT 'user',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      style TEXT DEFAULT '',
      pacing TEXT DEFAULT '',
      vocabulary TEXT DEFAULT '[]',
      sentence_structure TEXT,
      imagery TEXT DEFAULT '[]',
      banned_words TEXT DEFAULT '[]',
      few_shots TEXT DEFAULT '[]',
      character_traits TEXT,
      world_building TEXT,
      foreshadowing TEXT,
      plot_pattern TEXT,
      core_patterns TEXT DEFAULT '[]',
      banned_elements TEXT DEFAULT '[]',
      stability_score REAL DEFAULT 0,
      evaluation_feedback TEXT DEFAULT '',
      version INTEGER DEFAULT 1,
      fusion_meta TEXT DEFAULT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skill_usage_records (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      chapter_id TEXT,
      mounted_skill_ids TEXT NOT NULL DEFAULT '[]',
      fit_score REAL DEFAULT 0,
      audit_score REAL,
      user_action TEXT NOT NULL DEFAULT 'accepted',
      notes TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS idea_fragments (
      id TEXT PRIMARY KEY,
      novel_id TEXT,
      content TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'scene',
      status TEXT NOT NULL DEFAULT 'raw',
      ai_expansion TEXT,
      target_chapter_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS foreshadowings (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'planted',
      planted_chapter_id TEXT,
      payoff_chapter_id TEXT,
      related_character_ids TEXT DEFAULT '[]',
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chapter_production_runs (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      target_chapter_id TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      user_intent TEXT DEFAULT '',
      scene_beats TEXT DEFAULT '',
      draft_content TEXT DEFAULT '',
      style_audit TEXT DEFAULT '',
      continuity_report TEXT DEFAULT '{}',
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
      FOREIGN KEY (target_chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS continuation_packs (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      source_documents TEXT NOT NULL,
      canon_facts TEXT NOT NULL,
      character_states TEXT NOT NULL,
      plot_state TEXT NOT NULL,
      style_profile TEXT NOT NULL,
      contradictions TEXT NOT NULL,
      continuation_task TEXT NOT NULL,
      source_map TEXT DEFAULT '{}',
      reading_questions TEXT DEFAULT '[]',
      continuation_gaps TEXT DEFAULT '[]',
      source_badge TEXT,
      sync_state TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chapter_production_run_versions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      novel_id TEXT NOT NULL,
      target_chapter_id TEXT,
      source TEXT NOT NULL,
      scene_beats TEXT DEFAULT '',
      draft_content TEXT DEFAULT '',
      style_audit TEXT DEFAULT '',
      continuity_report TEXT DEFAULT '{}',
      content_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES chapter_production_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
      FOREIGN KEY (target_chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS continuation_extraction_jobs (
      id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL,
      novel_id TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER DEFAULT 0,
      stage_text TEXT DEFAULT '',
      batch_cursor INTEGER DEFAULT 0,
      total_batches INTEGER DEFAULT 0,
      result_json TEXT,
      checkpoint_json TEXT,
      error_code TEXT,
      error_message TEXT,
      database_generation INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (pack_id) REFERENCES continuation_packs(id) ON DELETE CASCADE,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS outline_artifacts (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      level TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT '{}',
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      base_fingerprint TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS creative_artifact_cores (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      artifact_kind TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      core_json TEXT NOT NULL,
      readable_content TEXT,
      provenance_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS creative_artifact_versions (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      artifact_kind TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      core_json TEXT NOT NULL,
      readable_content TEXT,
      provenance_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS creative_artifact_candidates (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      artifact_kind TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      target_version INTEGER NOT NULL,
      operation TEXT NOT NULL,
      goal TEXT NOT NULL,
      base_fingerprint TEXT NOT NULL,
      source_capability_versions TEXT NOT NULL,
      proposed_core TEXT NOT NULL,
      proposed_content TEXT,
      diff TEXT NOT NULL,
      impact_report TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      decided_at INTEGER,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS artifact_review_requirements (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      artifact_kind TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      artifact_version INTEGER NOT NULL,
      source_candidate_id TEXT,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      resolved_at INTEGER,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
      FOREIGN KEY (source_candidate_id) REFERENCES creative_artifact_candidates(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS creation_flow_sessions (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      flow_id TEXT NOT NULL,
      frozen_definition_json TEXT NOT NULL,
      current_step_id TEXT,
      accepted_output_refs_json TEXT NOT NULL,
      status TEXT NOT NULL,
      database_generation INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS canon_patches (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      base_fingerprint TEXT NOT NULL,
      source_ability_id TEXT,
      operations TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS vector_chunks (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entity_relationships (
      id TEXT PRIMARY KEY,
      novelId TEXT NOT NULL,
      sourceType TEXT NOT NULL,
      sourceId TEXT NOT NULL,
      targetType TEXT NOT NULL,
      targetId TEXT NOT NULL,
      relationshipType TEXT NOT NULL,
      description TEXT DEFAULT '',
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (novelId) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS product_events (
      id TEXT PRIMARY KEY,
      event_name TEXT NOT NULL,
      stage TEXT NOT NULL,
      duration_ms INTEGER,
      result TEXT NOT NULL,
      error_code TEXT,
      novel_id TEXT,
      chapter_id TEXT,
      object_id TEXT,
      quality_status TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  ensureCapabilityRecommendationSchema();

  ensureColumn('novels', 'mounted_skill_loadout', "TEXT DEFAULT '[]'");
  ensureColumn('novels', 'project_preference_profile', "TEXT DEFAULT '{}'");
  ensureColumn('skills', 'parent_skill_id', 'TEXT');
  ensureColumn('skills', 'lineage_root_id', 'TEXT');
  ensureColumn('skills', 'primary_dimension', 'TEXT');
  ensureColumn('skills', 'dimension_tags', "TEXT DEFAULT '[]'");
  ensureColumn('skills', 'composition_profile', "TEXT DEFAULT '{}'");
  ensureColumn('skills', 'usage_stats', "TEXT DEFAULT '{}'");
  ensureColumn('skills', 'feedback_score', 'REAL DEFAULT 0');
  ensureColumn('skills', 'updated_at', 'INTEGER');
  ensureColumn('skills', 'fusion_meta', 'TEXT DEFAULT NULL');
  ensureColumn('skills', 'method_chain', "TEXT DEFAULT NULL");
  ensureColumn('skills', 'why_this_skill_works', 'TEXT');
  ensureColumn('skills', 'source_badge', 'TEXT');
  ensureColumn('continuation_packs', 'source_map', "TEXT DEFAULT '{}'");
  ensureColumn('continuation_packs', 'reading_questions', "TEXT DEFAULT '[]'");
  ensureColumn('continuation_packs', 'continuation_gaps', "TEXT DEFAULT '[]'");
  ensureColumn('continuation_packs', 'source_badge', 'TEXT');
  ensureColumn('continuation_packs', 'sync_state', "TEXT DEFAULT '{}'");
  ensureColumn('characters', 'current_state', "TEXT DEFAULT ''");
  ensureColumn('chapters', 'workflow_meta', "TEXT DEFAULT '{}'");
  ensureColumn('product_events', 'quality_status', 'TEXT');
  ensureColumn('outline_artifacts', 'core_json', 'TEXT');
  ensureColumn('outline_artifacts', 'source_capability_versions', 'TEXT');
  ensureColumn('canon_patches', 'result_fingerprint', 'TEXT');
  ensureColumn('canon_patches', 'result_json', 'TEXT');
  ensureColumn('canon_patches', 'decided_at', 'INTEGER');
  ensureColumn('canon_patches', 'source_capability_versions', 'TEXT');
  repairImportedContinuationPackNovelLinks();

  // Indexes for foreign-key columns to avoid full table scans
  getDb().exec(`
    CREATE INDEX IF NOT EXISTS idx_characters_novel ON characters(novel_id);
    CREATE INDEX IF NOT EXISTS idx_locations_novel ON locations(novel_id);
    CREATE INDEX IF NOT EXISTS idx_items_novel ON items(novel_id);
    CREATE INDEX IF NOT EXISTS idx_factions_novel ON factions(novel_id);
    CREATE INDEX IF NOT EXISTS idx_power_levels_novel ON power_levels(novel_id);
    CREATE INDEX IF NOT EXISTS idx_timeline_events_novel ON timeline_events(novel_id);
    CREATE INDEX IF NOT EXISTS idx_chapters_novel ON chapters(novel_id);
    CREATE INDEX IF NOT EXISTS idx_chapter_versions_chapter ON chapter_versions(chapter_id);
    CREATE INDEX IF NOT EXISTS idx_chapter_completion_attempts_novel_chapter ON chapter_completion_attempts(novel_id, chapter_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_idea_fragments_novel ON idea_fragments(novel_id);
    CREATE INDEX IF NOT EXISTS idx_foreshadowings_novel ON foreshadowings(novel_id);
    CREATE INDEX IF NOT EXISTS idx_chapter_production_runs_novel ON chapter_production_runs(novel_id);
    CREATE INDEX IF NOT EXISTS idx_skill_usage_records_novel ON skill_usage_records(novel_id);
    CREATE INDEX IF NOT EXISTS idx_continuation_packs_novel ON continuation_packs(novel_id);
    CREATE INDEX IF NOT EXISTS idx_production_run_versions_run ON chapter_production_run_versions(run_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_production_run_versions_novel ON chapter_production_run_versions(novel_id);
    CREATE INDEX IF NOT EXISTS idx_continuation_extraction_jobs_pack ON continuation_extraction_jobs(pack_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_continuation_extraction_jobs_novel ON continuation_extraction_jobs(novel_id);
    CREATE INDEX IF NOT EXISTS idx_vector_chunks_novel ON vector_chunks(novel_id);
    CREATE INDEX IF NOT EXISTS idx_vector_chunks_chapter ON vector_chunks(chapter_id);
    CREATE INDEX IF NOT EXISTS idx_entity_relationships_novel ON entity_relationships(novelId);
    CREATE INDEX IF NOT EXISTS idx_entity_relationships_composite ON entity_relationships(novelId, sourceId, targetId);
    CREATE INDEX IF NOT EXISTS idx_product_events_created_at ON product_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_product_events_event_name ON product_events(event_name);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_outline_artifacts_one_active_master
      ON outline_artifacts(novel_id)
      WHERE level = 'master' AND status = 'active';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_creative_artifact_cores_identity
      ON creative_artifact_cores(novel_id, artifact_kind, artifact_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_creative_artifact_versions_identity
      ON creative_artifact_versions(novel_id, artifact_kind, artifact_id, version);
    CREATE INDEX IF NOT EXISTS idx_creative_artifact_versions_novel
      ON creative_artifact_versions(novel_id, artifact_kind, artifact_id);
    CREATE INDEX IF NOT EXISTS idx_creative_artifact_candidates_status
      ON creative_artifact_candidates(novel_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_creative_artifact_candidates_target
      ON creative_artifact_candidates(novel_id, artifact_kind, artifact_id);
    CREATE INDEX IF NOT EXISTS idx_artifact_review_requirements_lookup
      ON artifact_review_requirements(novel_id, artifact_kind, artifact_id, status);
    CREATE INDEX IF NOT EXISTS idx_artifact_review_requirements_candidate
      ON artifact_review_requirements(source_candidate_id);
    CREATE INDEX IF NOT EXISTS idx_creation_flow_sessions_novel
      ON creation_flow_sessions(novel_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_creation_flow_sessions_one_active
      ON creation_flow_sessions(novel_id)
      WHERE status = 'active';
  `);

  const legacyOutlineIdConflict = getDb().prepare(`
    SELECT artifact.id
    FROM novels
    JOIN outline_artifacts artifact ON artifact.id = 'legacy-outline-' || novels.id
    WHERE novels.global_outline IS NOT NULL AND length(trim(novels.global_outline)) > 0
      AND NOT EXISTS (
        SELECT 1 FROM outline_artifacts active_artifact
        WHERE active_artifact.novel_id = novels.id
          AND active_artifact.level = 'master' AND active_artifact.status = 'active'
      )
    LIMIT 1
  `).get() as { id?: string } | undefined;
  if (legacyOutlineIdConflict?.id) {
    throw new Error(`legacy outline artifact id is already occupied: ${legacyOutlineIdConflict.id}`);
  }

  getDb().prepare(`
    INSERT INTO outline_artifacts
      (id, novel_id, level, scope, content, source, status, created_at, updated_at)
    SELECT 'legacy-outline-' || id, id, 'master', '{}', global_outline, 'user', 'active', created_at, updated_at
    FROM novels
    WHERE global_outline IS NOT NULL AND length(trim(global_outline)) > 0
      AND NOT EXISTS (
        SELECT 1 FROM outline_artifacts artifact
        WHERE artifact.novel_id = novels.id
          AND artifact.level = 'master' AND artifact.status = 'active'
      )
  `).run();

  getDb().pragma(`application_id = ${INKFLOW_SQLITE_APPLICATION_ID}`);

  // Back up only after schema creation, additive migrations, and indexes are complete.
  // Validation happens against the temporary snapshot before atomic publication.
  if (!isTestEnv) {
    createValidatedStartupBackup(_db, targetPath)
      .then((backupPath) => {
        console.log(`[db-init] 启动自动快照一致性冷备成功: ${backupPath}`);
      })
      .catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('connection is not open')) {
          console.log(`[db-init] 启动自动冷备在连接断开时静默退出: ${errMsg}`);
        } else {
          console.error('[db-init] 启动自动快照一致性冷备失败:', err);
        }
      });
  }
}

function repairImportedContinuationPackNovelLinks() {
  const database = getDb();
  const orphanRows = database
    .prepare("SELECT * FROM continuation_packs WHERE novel_id LIKE 'continuation-import-draft-%'")
    .all() as Array<Record<string, unknown>>;

  if (orphanRows.length === 0) return;

  const selectNovelByTitle = database.prepare(`
    SELECT id
    FROM novels
    WHERE title = ?
    ORDER BY ABS(updated_at - ?) ASC, updated_at DESC
    LIMIT 1
  `);
  const updateNovelLink = database.prepare('UPDATE continuation_packs SET novel_id = ? WHERE id = ?');

  for (const row of orphanRows) {
    const pack = mapContinuationPackRow(row);
    const targetTitle = buildImportedNovelDraft(pack.title).title;
    const targetNovel = selectNovelByTitle.get(targetTitle, pack.updatedAt) as { id: string } | undefined;
    if (!targetNovel) continue;
    updateNovelLink.run(targetNovel.id, pack.id);
  }
}
