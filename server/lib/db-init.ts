import type BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import os from 'os';
import { createRequire } from 'module';
import { getDb, setDb, isDbInitialized } from './db-instance.js';
import { mapContinuationPackRow } from './db-mappers.js';
import { buildImportedNovelDraft } from '../../shared/lib/continuation-import-flow.js';

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

  // WAL 模式下事务安全的一致性启动自动快照冷备 (测试环境和临时测试数据库跳过，避免测试中生成未追踪的 .bak 文件并防范连接被快速关闭报错)
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

  if (!isTestEnv) {
    _db.backup(targetPath + '.bak')
      .then(() => {
        console.log(`[db-init] 启动自动快照一致性冷备成功: ${targetPath}.bak`);
      })
      .catch((err: unknown) => {
        // 优雅容灾：如果因为快速关闭数据库连接导致备份失败，温和记录即可
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('connection is not open')) {
          console.log(`[db-init] 启动自动冷备在连接断开时静默退出: ${errMsg}`);
        } else {
          console.error(`[db-init] 启动自动快照一致性冷备失败:`, err);
        }
      });
  }

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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
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
  `);

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
  ensureColumn('characters', 'current_state', "TEXT DEFAULT ''");
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
    CREATE INDEX IF NOT EXISTS idx_idea_fragments_novel ON idea_fragments(novel_id);
    CREATE INDEX IF NOT EXISTS idx_foreshadowings_novel ON foreshadowings(novel_id);
    CREATE INDEX IF NOT EXISTS idx_chapter_production_runs_novel ON chapter_production_runs(novel_id);
    CREATE INDEX IF NOT EXISTS idx_skill_usage_records_novel ON skill_usage_records(novel_id);
    CREATE INDEX IF NOT EXISTS idx_continuation_packs_novel ON continuation_packs(novel_id);
    CREATE INDEX IF NOT EXISTS idx_vector_chunks_novel ON vector_chunks(novel_id);
    CREATE INDEX IF NOT EXISTS idx_vector_chunks_chapter ON vector_chunks(chapter_id);
    CREATE INDEX IF NOT EXISTS idx_entity_relationships_novel ON entity_relationships(novelId);
    CREATE INDEX IF NOT EXISTS idx_entity_relationships_composite ON entity_relationships(novelId, sourceId, targetId);
  `);
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
