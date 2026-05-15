import type BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import os from 'os';
import { createRequire } from 'module';
import type { Novel, Character, Location, Item, Faction, PowerLevel, TimelineEvent, Chapter, ChapterVersion, Skill, IdeaFragment, Foreshadowing, SkillUsageRecord, ChapterProductionRun } from '../types';
import { calculateFeedbackScore, summarizeUsageStats } from './skill-model';

declare var __CJS_BUNDLE__: boolean | undefined;

const req = typeof __CJS_BUNDLE__ !== 'undefined'
  // @ts-ignore - require is a CJS global, available when __CJS_BUNDLE__ is defined
  ? require
  : createRequire(import.meta.url);
const { Database, nativeBindingPath } = req('./better-sqlite3-shim.cjs') as {
  Database: typeof BetterSqlite3;
  nativeBindingPath: string;
};

const DB_DIR = path.join(os.homedir(), '.inkflow');
const DB_PATH = path.join(DB_DIR, 'data.db');

let db: BetterSqlite3.Database | undefined;

function ensureColumn(table: string, column: string, definition: string) {
  const database = getDb();
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// --- Init ---

export function initDb(dbPath?: string): void {
  if (db) return;

  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });

  db = new Database(dbPath || DB_PATH, { nativeBinding: nativeBindingPath });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
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

  // Indexes for foreign-key columns to avoid full table scans
  db.exec(`
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
  `);
}

function getDb(): BetterSqlite3.Database {
  if (!db) initDb();
  return db!;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}

// --- Change Subscription ---

const listeners = new Set<() => void>();

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch (e) {
      console.error('db: listener error', e);
    }
  }
}

// --- Row mapping helpers ---

function rowToNovel(row: any): Novel {
  return {
    ...row,
    authorId: row.author_id,
    coverImage: row.cover_image,
    worldRules: row.world_rules,
    globalOutline: row.global_outline,
    mountedSkillIds: JSON.parse(row.mounted_skill_ids || '[]'),
    mountedSkillLoadout: JSON.parse(row.mounted_skill_loadout || '[]'),
    projectPreferenceProfile: JSON.parse(row.project_preference_profile || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function novelToRow(novel: Novel): any {
  return {
    id: novel.id,
    title: novel.title,
    author_id: novel.authorId,
    summary: novel.summary,
    cover_image: novel.coverImage,
    status: novel.status,
    world_rules: novel.worldRules,
    global_outline: novel.globalOutline,
    mounted_skill_ids: JSON.stringify(novel.mountedSkillIds || []),
    mounted_skill_loadout: JSON.stringify(novel.mountedSkillLoadout || []),
    project_preference_profile: JSON.stringify(novel.projectPreferenceProfile || {}),
    created_at: novel.createdAt,
    updated_at: novel.updatedAt,
  };
}

function rowToCharacter(row: any): Character {
  return {
    ...row,
    novelId: row.novel_id,
    traits: JSON.parse(row.traits || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function characterToRow(c: Character): any {
  return {
    id: c.id,
    novel_id: c.novelId,
    name: c.name,
    role: c.role,
    summary: c.summary,
    traits: JSON.stringify(c.traits || []),
    bio: c.bio,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

function rowToLocation(row: any): Location {
  return { ...row, novelId: row.novel_id, createdAt: row.created_at, updatedAt: row.updated_at };
}

function locationToRow(l: Location): any {
  return { id: l.id, novel_id: l.novelId, name: l.name, description: l.description, region: l.region, created_at: l.createdAt, updated_at: l.updatedAt };
}

function rowToItem(row: any): Item {
  return { ...row, novelId: row.novel_id, createdAt: row.created_at, updatedAt: row.updated_at };
}

function itemToRow(i: Item): any {
  return { id: i.id, novel_id: i.novelId, name: i.name, description: i.description, type: i.type, created_at: i.createdAt, updated_at: i.updatedAt };
}

function rowToFaction(row: any): Faction {
  return { ...row, novelId: row.novel_id, createdAt: row.created_at, updatedAt: row.updated_at };
}

function factionToRow(f: Faction): any {
  return { id: f.id, novel_id: f.novelId, name: f.name, description: f.description, leader: f.leader, territory: f.territory, created_at: f.createdAt, updated_at: f.updatedAt };
}

function rowToPowerLevel(row: any): PowerLevel {
  return { ...row, novelId: row.novel_id, createdAt: row.created_at, updatedAt: row.updated_at };
}

function powerLevelToRow(p: PowerLevel): any {
  return { id: p.id, novel_id: p.novelId, name: p.name, description: p.description, tier: p.tier, characteristics: p.characteristics, created_at: p.createdAt, updated_at: p.updatedAt };
}

function rowToTimelineEvent(row: any): TimelineEvent {
  return { ...row, novelId: row.novel_id, statusTag: row.status_tag, createdAt: row.created_at, updatedAt: row.updated_at };
}

function timelineEventToRow(t: TimelineEvent): any {
  return { id: t.id, novel_id: t.novelId, title: t.title, description: t.description, timestamp: t.timestamp, status_tag: t.statusTag, order: t.order, created_at: t.createdAt, updated_at: t.updatedAt };
}

function rowToChapter(row: any): Chapter {
  return { ...row, novelId: row.novel_id, volumeName: row.volume_name, wordCount: row.word_count, sceneBeats: row.scene_beats, createdAt: row.created_at, updatedAt: row.updated_at };
}

function chapterToRow(c: Chapter): any {
  return { id: c.id, novel_id: c.novelId, volume_name: c.volumeName, title: c.title, content: c.content, order: c.order, word_count: c.wordCount, scene_beats: c.sceneBeats, critique: c.critique, created_at: c.createdAt, updated_at: c.updatedAt };
}

function rowToChapterVersion(row: any): ChapterVersion {
  return { ...row, chapterId: row.chapter_id, wordCount: row.word_count, createdAt: row.created_at };
}

function chapterVersionToRow(cv: ChapterVersion): any {
  return { id: cv.id, chapter_id: cv.chapterId, content: cv.content, word_count: cv.wordCount, author: cv.author, created_at: cv.createdAt };
}

function rowToSkill(row: any): Skill {
  return {
    ...row,
    sentenceStructure: row.sentence_structure,
    bannedWords: JSON.parse(row.banned_words || '[]'),
    fewShots: JSON.parse(row.few_shots || '[]'),
    vocabulary: JSON.parse(row.vocabulary || '[]'),
    imagery: JSON.parse(row.imagery || '[]'),
    characterTraits: row.character_traits,
    worldBuilding: row.world_building,
    plotPattern: row.plot_pattern,
    foreshadowing: row.foreshadowing,
    corePatterns: JSON.parse(row.core_patterns || '[]'),
    bannedElements: JSON.parse(row.banned_elements || '[]'),
    stabilityScore: row.stability_score,
    evaluationFeedback: row.evaluation_feedback,
    parentSkillId: row.parent_skill_id || undefined,
    lineageRootId: row.lineage_root_id || undefined,
    primaryDimension: row.primary_dimension || undefined,
    dimensionTags: JSON.parse(row.dimension_tags || '[]'),
    compositionProfile: JSON.parse(row.composition_profile || '{}'),
    usageStats: JSON.parse(row.usage_stats || '{}'),
    feedbackScore: row.feedback_score ?? undefined,
    fusionMeta: row.fusion_meta ? JSON.parse(row.fusion_meta) : undefined,
    methodChain: row.method_chain ? JSON.parse(row.method_chain) : undefined,
    whyThisSkillWorks: row.why_this_skill_works || undefined,
    sourceBadge: row.source_badge || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
  };
}

function skillToRow(s: Skill): any {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    style: s.style,
    pacing: s.pacing,
    vocabulary: JSON.stringify(s.vocabulary || []),
    sentence_structure: s.sentenceStructure,
    imagery: JSON.stringify(s.imagery || []),
    banned_words: JSON.stringify(s.bannedWords || []),
    few_shots: JSON.stringify(s.fewShots || []),
    character_traits: s.characterTraits,
    world_building: s.worldBuilding,
    foreshadowing: s.foreshadowing,
    plot_pattern: s.plotPattern,
    core_patterns: JSON.stringify(s.corePatterns || []),
    banned_elements: JSON.stringify(s.bannedElements || []),
    stability_score: s.stabilityScore,
    evaluation_feedback: s.evaluationFeedback,
    version: s.version,
    parent_skill_id: s.parentSkillId || null,
    lineage_root_id: s.lineageRootId || null,
    primary_dimension: s.primaryDimension || null,
    dimension_tags: JSON.stringify(s.dimensionTags || []),
    composition_profile: JSON.stringify(s.compositionProfile || {}),
    usage_stats: JSON.stringify(s.usageStats || {}),
    feedback_score: s.feedbackScore ?? 0,
    fusion_meta: s.fusionMeta ? JSON.stringify(s.fusionMeta) : null,
    method_chain: s.methodChain ? JSON.stringify(s.methodChain) : null,
    why_this_skill_works: s.whyThisSkillWorks || null,
    source_badge: s.sourceBadge || null,
    created_at: s.createdAt,
    updated_at: s.updatedAt || null,
  };
}

function rowToSkillUsageRecord(row: any): SkillUsageRecord {
  return {
    ...row,
    novelId: row.novel_id,
    chapterId: row.chapter_id || undefined,
    mountedSkillIds: JSON.parse(row.mounted_skill_ids || '[]'),
    fitScore: row.fit_score,
    auditScore: row.audit_score ?? undefined,
    userAction: row.user_action,
    createdAt: row.created_at,
  };
}

function skillUsageRecordToRow(record: SkillUsageRecord): any {
  return {
    id: record.id,
    novel_id: record.novelId,
    chapter_id: record.chapterId || null,
    mounted_skill_ids: JSON.stringify(record.mountedSkillIds || []),
    fit_score: record.fitScore,
    audit_score: record.auditScore ?? null,
    user_action: record.userAction,
    notes: record.notes || null,
    created_at: record.createdAt,
  };
}

function rowToIdeaFragment(row: any): IdeaFragment {
  return {
    ...row,
    novelId: row.novel_id,
    aiExpansion: row.ai_expansion,
    targetChapterId: row.target_chapter_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ideaFragmentToRow(f: IdeaFragment): any {
  return {
    id: f.id,
    novel_id: f.novelId || null,
    content: f.content,
    type: f.type,
    status: f.status,
    ai_expansion: f.aiExpansion || null,
    target_chapter_id: f.targetChapterId || null,
    created_at: f.createdAt,
    updated_at: f.updatedAt,
  };
}

function rowToForeshadowing(row: any): Foreshadowing {
  return {
    ...row,
    novelId: row.novel_id,
    plantedChapterId: row.planted_chapter_id,
    payoffChapterId: row.payoff_chapter_id,
    relatedCharacterIds: JSON.parse(row.related_character_ids || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function foreshadowingToRow(f: Foreshadowing): any {
  return {
    id: f.id,
    novel_id: f.novelId,
    title: f.title,
    description: f.description,
    status: f.status,
    planted_chapter_id: f.plantedChapterId || null,
    payoff_chapter_id: f.payoffChapterId || null,
    related_character_ids: JSON.stringify(f.relatedCharacterIds || []),
    notes: f.notes || null,
    created_at: f.createdAt,
    updated_at: f.updatedAt,
  };
}

function rowToChapterProductionRun(row: any): ChapterProductionRun {
  return {
    id: row.id,
    novelId: row.novel_id,
    targetChapterId: row.target_chapter_id || undefined,
    status: row.status,
    userIntent: row.user_intent || '',
    sceneBeats: row.scene_beats || '',
    draftContent: row.draft_content || '',
    styleAudit: row.style_audit || '',
    continuityReport: JSON.parse(row.continuity_report || '{}'),
    errorMessage: row.error_message || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function chapterProductionRunToRow(run: ChapterProductionRun): any {
  return {
    id: run.id,
    novel_id: run.novelId,
    target_chapter_id: run.targetChapterId || null,
    status: run.status,
    user_intent: run.userIntent,
    scene_beats: run.sceneBeats,
    draft_content: run.draftContent,
    style_audit: run.styleAudit,
    continuity_report: JSON.stringify(run.continuityReport),
    error_message: run.errorMessage || null,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
  };
}

// --- Novel CRUD ---

export function listNovels(): Novel[] {
  const rows = getDb().prepare('SELECT * FROM novels ORDER BY updated_at DESC').all();
  return rows.map(rowToNovel);
}

export function getNovel(id: string): Novel | undefined {
  const row = getDb().prepare('SELECT * FROM novels WHERE id = ?').get(id);
  return row ? rowToNovel(row) : undefined;
}

export function createNovel(novel: Novel): void {
  getDb().prepare(`
    INSERT INTO novels (id, title, author_id, summary, cover_image, status, world_rules, global_outline, mounted_skill_ids, mounted_skill_loadout, project_preference_profile, created_at, updated_at)
    VALUES (@id, @title, @author_id, @summary, @cover_image, @status, @world_rules, @global_outline, @mounted_skill_ids, @mounted_skill_loadout, @project_preference_profile, @created_at, @updated_at)
  `).run(novelToRow(novel));
  notify();
}

export function updateNovel(id: string, data: Partial<Novel>): void {
  const existing = getDb().prepare('SELECT * FROM novels WHERE id = ?').get(id);
  if (!existing) return;
  const merged = { ...rowToNovel(existing as any), ...data, id, updatedAt: Date.now() };
  getDb().prepare(`
    UPDATE novels SET title=@title, author_id=@author_id, summary=@summary, cover_image=@cover_image, status=@status, world_rules=@world_rules, global_outline=@global_outline, mounted_skill_ids=@mounted_skill_ids, mounted_skill_loadout=@mounted_skill_loadout, project_preference_profile=@project_preference_profile, updated_at=@updated_at
    WHERE id=@id
  `).run(novelToRow(merged));
  notify();
}

export function deleteNovel(id: string): void {
  getDb().prepare('DELETE FROM novels WHERE id = ?').run(id);
  notify();
}

// --- Chapter CRUD ---

export function listChapters(novelId: string): Chapter[] {
  const rows = getDb().prepare('SELECT * FROM chapters WHERE novel_id = ? ORDER BY "order" ASC').all(novelId);
  return rows.map(rowToChapter);
}

export function getChapter(id: string): Chapter | undefined {
  const row = getDb().prepare('SELECT * FROM chapters WHERE id = ?').get(id);
  return row ? rowToChapter(row) : undefined;
}

export function createChapter(chapter: Chapter): void {
  getDb().prepare(`
    INSERT INTO chapters (id, novel_id, volume_name, title, content, "order", word_count, scene_beats, critique, created_at, updated_at)
    VALUES (@id, @novel_id, @volume_name, @title, @content, @order, @word_count, @scene_beats, @critique, @created_at, @updated_at)
  `).run(chapterToRow(chapter));
  notify();
}

export function updateChapter(id: string, data: Partial<Chapter>): void {
  const existing = getDb().prepare('SELECT * FROM chapters WHERE id = ?').get(id);
  if (!existing) return;
  const merged = { ...rowToChapter(existing as any), ...data, id, updatedAt: Date.now() };
  getDb().prepare(`
    UPDATE chapters SET novel_id=@novel_id, volume_name=@volume_name, title=@title, content=@content, "order"=@order, word_count=@word_count, scene_beats=@scene_beats, critique=@critique, updated_at=@updated_at
    WHERE id=@id
  `).run(chapterToRow(merged));
  notify();
}

export function deleteChapter(id: string): void {
  getDb().prepare('DELETE FROM chapters WHERE id = ?').run(id);
  notify();
}

// --- ChapterVersion CRUD ---

export function listChapterVersions(chapterId: string): ChapterVersion[] {
  const rows = getDb().prepare('SELECT * FROM chapter_versions WHERE chapter_id = ? ORDER BY created_at DESC').all(chapterId);
  return rows.map(rowToChapterVersion);
}

export function createChapterVersion(cv: ChapterVersion): void {
  getDb().prepare(`
    INSERT INTO chapter_versions (id, chapter_id, content, word_count, author, created_at)
    VALUES (@id, @chapter_id, @content, @word_count, @author, @created_at)
  `).run(chapterVersionToRow(cv));
  notify();
}

// --- Character CRUD ---

export function listCharacters(novelId: string): Character[] {
  const rows = getDb().prepare('SELECT * FROM characters WHERE novel_id = ?').all(novelId);
  return rows.map(rowToCharacter);
}

export function createCharacter(c: Character): void {
  getDb().prepare(`
    INSERT INTO characters (id, novel_id, name, role, summary, traits, bio, created_at, updated_at)
    VALUES (@id, @novel_id, @name, @role, @summary, @traits, @bio, @created_at, @updated_at)
  `).run(characterToRow(c));
  notify();
}

export function updateCharacter(id: string, data: Partial<Character>): void {
  const existing = getDb().prepare('SELECT * FROM characters WHERE id = ?').get(id);
  if (!existing) return;
  const c = { ...rowToCharacter(existing), ...data, id, updatedAt: Date.now() };
  getDb().prepare(`
    UPDATE characters SET novel_id=@novel_id, name=@name, role=@role, summary=@summary, traits=@traits, bio=@bio, updated_at=@updated_at
    WHERE id=@id
  `).run(characterToRow(c));
  notify();
}

export function deleteCharacter(id: string): void {
  getDb().prepare('DELETE FROM characters WHERE id = ?').run(id);
  notify();
}

// --- Location CRUD ---

export function listLocations(novelId: string): Location[] {
  const rows = getDb().prepare('SELECT * FROM locations WHERE novel_id = ?').all(novelId);
  return rows.map(rowToLocation);
}

export function createLocation(loc: Location): void {
  getDb().prepare(`
    INSERT INTO locations (id, novel_id, name, description, region, created_at, updated_at)
    VALUES (@id, @novel_id, @name, @description, @region, @created_at, @updated_at)
  `).run(locationToRow(loc));
  notify();
}

export function updateLocation(id: string, data: Partial<Location>): void {
  const existing = getDb().prepare('SELECT * FROM locations WHERE id = ?').get(id);
  if (!existing) return;
  const l = { ...rowToLocation(existing), ...data, id, updatedAt: Date.now() };
  getDb().prepare(`
    UPDATE locations SET novel_id=@novel_id, name=@name, description=@description, region=@region, updated_at=@updated_at
    WHERE id=@id
  `).run(locationToRow(l));
  notify();
}

export function deleteLocation(id: string): void {
  getDb().prepare('DELETE FROM locations WHERE id = ?').run(id);
  notify();
}

// --- Item CRUD ---

export function listItems(novelId: string): Item[] {
  const rows = getDb().prepare('SELECT * FROM items WHERE novel_id = ?').all(novelId);
  return rows.map(rowToItem);
}

export function createItem(item: Item): void {
  getDb().prepare(`
    INSERT INTO items (id, novel_id, name, description, type, created_at, updated_at)
    VALUES (@id, @novel_id, @name, @description, @type, @created_at, @updated_at)
  `).run(itemToRow(item));
  notify();
}

export function updateItem(id: string, data: Partial<Item>): void {
  const existing = getDb().prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!existing) return;
  const i = { ...rowToItem(existing), ...data, id, updatedAt: Date.now() };
  getDb().prepare(`
    UPDATE items SET novel_id=@novel_id, name=@name, description=@description, type=@type, updated_at=@updated_at
    WHERE id=@id
  `).run(itemToRow(i));
  notify();
}

export function deleteItem(id: string): void {
  getDb().prepare('DELETE FROM items WHERE id = ?').run(id);
  notify();
}

// --- Faction CRUD ---

export function listFactions(novelId: string): Faction[] {
  const rows = getDb().prepare('SELECT * FROM factions WHERE novel_id = ?').all(novelId);
  return rows.map(rowToFaction);
}

export function createFaction(f: Faction): void {
  getDb().prepare(`
    INSERT INTO factions (id, novel_id, name, description, leader, territory, created_at, updated_at)
    VALUES (@id, @novel_id, @name, @description, @leader, @territory, @created_at, @updated_at)
  `).run(factionToRow(f));
  notify();
}

export function updateFaction(id: string, data: Partial<Faction>): void {
  const existing = getDb().prepare('SELECT * FROM factions WHERE id = ?').get(id);
  if (!existing) return;
  const f = { ...rowToFaction(existing), ...data, id, updatedAt: Date.now() };
  getDb().prepare(`
    UPDATE factions SET novel_id=@novel_id, name=@name, description=@description, leader=@leader, territory=@territory, updated_at=@updated_at
    WHERE id=@id
  `).run(factionToRow(f));
  notify();
}

export function deleteFaction(id: string): void {
  getDb().prepare('DELETE FROM factions WHERE id = ?').run(id);
  notify();
}

// --- PowerLevel CRUD ---

export function listPowerLevels(novelId: string): PowerLevel[] {
  const rows = getDb().prepare('SELECT * FROM power_levels WHERE novel_id = ? ORDER BY tier ASC').all(novelId);
  return rows.map(rowToPowerLevel);
}

export function createPowerLevel(p: PowerLevel): void {
  getDb().prepare(`
    INSERT INTO power_levels (id, novel_id, name, description, tier, characteristics, created_at, updated_at)
    VALUES (@id, @novel_id, @name, @description, @tier, @characteristics, @created_at, @updated_at)
  `).run(powerLevelToRow(p));
  notify();
}

export function updatePowerLevel(id: string, data: Partial<PowerLevel>): void {
  const existing = getDb().prepare('SELECT * FROM power_levels WHERE id = ?').get(id);
  if (!existing) return;
  const p = { ...rowToPowerLevel(existing), ...data, id, updatedAt: Date.now() };
  getDb().prepare(`
    UPDATE power_levels SET novel_id=@novel_id, name=@name, description=@description, tier=@tier, characteristics=@characteristics, updated_at=@updated_at
    WHERE id=@id
  `).run(powerLevelToRow(p));
  notify();
}

export function deletePowerLevel(id: string): void {
  getDb().prepare('DELETE FROM power_levels WHERE id = ?').run(id);
  notify();
}

// --- TimelineEvent CRUD ---

export function listTimelineEvents(novelId: string): TimelineEvent[] {
  const rows = getDb().prepare('SELECT * FROM timeline_events WHERE novel_id = ? ORDER BY "order" ASC').all(novelId);
  return rows.map(rowToTimelineEvent);
}

export function createTimelineEvent(t: TimelineEvent): void {
  getDb().prepare(`
    INSERT INTO timeline_events (id, novel_id, title, description, timestamp, status_tag, "order", created_at, updated_at)
    VALUES (@id, @novel_id, @title, @description, @timestamp, @status_tag, @order, @created_at, @updated_at)
  `).run(timelineEventToRow(t));
  notify();
}

export function updateTimelineEvent(id: string, data: Partial<TimelineEvent>): void {
  const existing = getDb().prepare('SELECT * FROM timeline_events WHERE id = ?').get(id);
  if (!existing) return;
  const t = { ...rowToTimelineEvent(existing), ...data, id, updatedAt: Date.now() };
  getDb().prepare(`
    UPDATE timeline_events SET novel_id=@novel_id, title=@title, description=@description, timestamp=@timestamp, status_tag=@status_tag, "order"=@order, updated_at=@updated_at
    WHERE id=@id
  `).run(timelineEventToRow(t));
  notify();
}

export function deleteTimelineEvent(id: string): void {
  getDb().prepare('DELETE FROM timeline_events WHERE id = ?').run(id);
  notify();
}

// --- Skill CRUD ---

export function listSkills(): Skill[] {
  const rows = getDb().prepare('SELECT * FROM skills ORDER BY created_at DESC').all();
  return rows.map(rowToSkill);
}

export function getSkill(id: string): Skill | undefined {
  const row = getDb().prepare('SELECT * FROM skills WHERE id = ?').get(id);
  return row ? rowToSkill(row) : undefined;
}

export function createSkill(s: Skill): void {
  getDb().prepare(`
    INSERT INTO skills (id, name, description, style, pacing, vocabulary, sentence_structure, imagery, banned_words, few_shots, character_traits, world_building, foreshadowing, plot_pattern, core_patterns, banned_elements, stability_score, evaluation_feedback, version, parent_skill_id, lineage_root_id, primary_dimension, dimension_tags, composition_profile, usage_stats, feedback_score, fusion_meta, method_chain, why_this_skill_works, source_badge, created_at, updated_at)
    VALUES (@id, @name, @description, @style, @pacing, @vocabulary, @sentence_structure, @imagery, @banned_words, @few_shots, @character_traits, @world_building, @foreshadowing, @plot_pattern, @core_patterns, @banned_elements, @stability_score, @evaluation_feedback, @version, @parent_skill_id, @lineage_root_id, @primary_dimension, @dimension_tags, @composition_profile, @usage_stats, @feedback_score, @fusion_meta, @method_chain, @why_this_skill_works, @source_badge, @created_at, @updated_at)
  `).run(skillToRow(s));
  notify();
}

export function updateSkill(id: string, data: Partial<Skill>): void {
  const existing = getDb().prepare('SELECT * FROM skills WHERE id = ?').get(id);
  if (!existing) return;
  const s = { ...rowToSkill(existing), ...data, id, updatedAt: Date.now() };
  getDb().prepare(`
    UPDATE skills SET name=@name, description=@description, style=@style, pacing=@pacing, vocabulary=@vocabulary, sentence_structure=@sentence_structure, imagery=@imagery, banned_words=@banned_words, few_shots=@few_shots, character_traits=@character_traits, world_building=@world_building, foreshadowing=@foreshadowing, plot_pattern=@plot_pattern, core_patterns=@core_patterns, banned_elements=@banned_elements, stability_score=@stability_score, evaluation_feedback=@evaluation_feedback, version=@version, parent_skill_id=@parent_skill_id, lineage_root_id=@lineage_root_id, primary_dimension=@primary_dimension, dimension_tags=@dimension_tags, composition_profile=@composition_profile, usage_stats=@usage_stats, feedback_score=@feedback_score, fusion_meta=@fusion_meta, method_chain=@method_chain, why_this_skill_works=@why_this_skill_works, source_badge=@source_badge, updated_at=@updated_at
    WHERE id=@id
  `).run(skillToRow(s));
  notify();
}

export function listSkillVersions(skillId: string): Skill[] {
  const skill = getSkill(skillId);
  if (!skill) return [];
  const rootId = skill.lineageRootId || skill.id;
  const rows = getDb()
    .prepare('SELECT * FROM skills WHERE lineage_root_id = ? OR id = ? ORDER BY version ASC, created_at ASC')
    .all(rootId, rootId);
  return rows.map(rowToSkill);
}

export function deleteSkill(id: string): void {
  getDb().prepare('DELETE FROM skills WHERE id = ?').run(id);
  notify();
}

export function listSkillUsageRecords(skillId?: string): SkillUsageRecord[] {
  if (!skillId) {
    return getDb()
      .prepare('SELECT * FROM skill_usage_records ORDER BY created_at DESC')
      .all()
      .map(rowToSkillUsageRecord);
  }

  const rows = getDb()
    .prepare(`
      SELECT sur.*
      FROM skill_usage_records sur
      WHERE EXISTS (
        SELECT 1
        FROM json_each(sur.mounted_skill_ids)
        WHERE value = ?
      )
      ORDER BY sur.created_at DESC
    `)
    .all(skillId);
  return rows.map(rowToSkillUsageRecord);
}

export function syncSkillFeedbackScores(): Skill[] {
  const skills = listSkills();
  const usageRecords = listSkillUsageRecords();
  const updates = skills
    .map((skill) => {
      const relatedRecords = usageRecords.filter((record) => record.mountedSkillIds.includes(skill.id));
      const usageStats = summarizeUsageStats(relatedRecords);
      const feedbackScore = calculateFeedbackScore(usageStats);
      const usageStatsJson = JSON.stringify(usageStats);
      const existingStatsJson = JSON.stringify(skill.usageStats || {});
      return {
        skill,
        usageStats,
        feedbackScore,
        needsUpdate:
          existingStatsJson !== usageStatsJson ||
          (skill.feedbackScore ?? 50) !== feedbackScore,
      };
    });

  const dirtyUpdates = updates.filter((entry) => entry.needsUpdate);
  if (dirtyUpdates.length > 0) {
    const now = Date.now();
    const statement = getDb().prepare(`
      UPDATE skills
      SET usage_stats = @usage_stats, feedback_score = @feedback_score, updated_at = @updated_at
      WHERE id = @id
    `);

    const transaction = getDb().transaction((entries: typeof dirtyUpdates) => {
      for (const entry of entries) {
        statement.run({
          id: entry.skill.id,
          usage_stats: JSON.stringify(entry.usageStats),
          feedback_score: entry.feedbackScore,
          updated_at: now,
        });
      }
    });

    transaction(dirtyUpdates);
    notify();
  }

  return updates.map(({ skill, usageStats, feedbackScore }) => ({
    ...skill,
    usageStats,
    feedbackScore,
  }));
}

export function createSkillUsageRecord(record: SkillUsageRecord): void {
  getDb().prepare(`
    INSERT INTO skill_usage_records (id, novel_id, chapter_id, mounted_skill_ids, fit_score, audit_score, user_action, notes, created_at)
    VALUES (@id, @novel_id, @chapter_id, @mounted_skill_ids, @fit_score, @audit_score, @user_action, @notes, @created_at)
  `).run(skillUsageRecordToRow(record));
  notify();
}

// --- IdeaFragment CRUD ---

export function listIdeaFragments(novelId?: string): IdeaFragment[] {
  if (novelId) {
    return getDb().prepare('SELECT * FROM idea_fragments WHERE novel_id = ? OR novel_id IS NULL ORDER BY created_at DESC').all(novelId).map(rowToIdeaFragment);
  }
  return getDb().prepare('SELECT * FROM idea_fragments ORDER BY created_at DESC').all().map(rowToIdeaFragment);
}
export function createIdeaFragment(f: IdeaFragment): void {
  getDb().prepare(`
    INSERT INTO idea_fragments (id, novel_id, content, type, status, ai_expansion, target_chapter_id, created_at, updated_at)
    VALUES (@id, @novel_id, @content, @type, @status, @ai_expansion, @target_chapter_id, @created_at, @updated_at)
  `).run(ideaFragmentToRow(f));
  notify();
}
export function updateIdeaFragment(id: string, data: Partial<IdeaFragment>): void {
  const existing = getDb().prepare('SELECT * FROM idea_fragments WHERE id = ?').get(id);
  if (!existing) return;
  const merged = { ...rowToIdeaFragment(existing as any), ...data, id, updatedAt: Date.now() };
  getDb().prepare(`
    UPDATE idea_fragments SET novel_id=@novel_id, content=@content, type=@type, status=@status, ai_expansion=@ai_expansion, target_chapter_id=@target_chapter_id, updated_at=@updated_at
    WHERE id=@id
  `).run(ideaFragmentToRow(merged));
  notify();
}
export function deleteIdeaFragment(id: string): void {
  getDb().prepare('DELETE FROM idea_fragments WHERE id = ?').run(id);
  notify();
}

// --- Foreshadowing CRUD ---

export function listForeshadowings(novelId: string): Foreshadowing[] {
  return getDb().prepare('SELECT * FROM foreshadowings WHERE novel_id = ? ORDER BY created_at ASC').all(novelId).map(rowToForeshadowing);
}
export function createForeshadowing(f: Foreshadowing): void {
  getDb().prepare(`
    INSERT INTO foreshadowings (id, novel_id, title, description, status, planted_chapter_id, payoff_chapter_id, related_character_ids, notes, created_at, updated_at)
    VALUES (@id, @novel_id, @title, @description, @status, @planted_chapter_id, @payoff_chapter_id, @related_character_ids, @notes, @created_at, @updated_at)
  `).run(foreshadowingToRow(f));
  notify();
}
export function updateForeshadowing(id: string, data: Partial<Foreshadowing>): void {
  const existing = getDb().prepare('SELECT * FROM foreshadowings WHERE id = ?').get(id);
  if (!existing) return;
  const merged = { ...rowToForeshadowing(existing as any), ...data, id, updatedAt: Date.now() };
  getDb().prepare(`
    UPDATE foreshadowings SET title=@title, description=@description, status=@status, planted_chapter_id=@planted_chapter_id, payoff_chapter_id=@payoff_chapter_id, related_character_ids=@related_character_ids, notes=@notes, updated_at=@updated_at
    WHERE id=@id
  `).run(foreshadowingToRow(merged));
  notify();
}
export function deleteForeshadowing(id: string): void {
  getDb().prepare('DELETE FROM foreshadowings WHERE id = ?').run(id);
  notify();
}

// --- ChapterProductionRun CRUD ---

export function listChapterProductionRuns(novelId: string): ChapterProductionRun[] {
  const rows = getDb()
    .prepare('SELECT * FROM chapter_production_runs WHERE novel_id = ? ORDER BY created_at DESC')
    .all(novelId);
  return rows.map(rowToChapterProductionRun);
}

export function getChapterProductionRun(id: string): ChapterProductionRun | undefined {
  const row = getDb().prepare('SELECT * FROM chapter_production_runs WHERE id = ?').get(id);
  return row ? rowToChapterProductionRun(row) : undefined;
}

export function createChapterProductionRun(run: ChapterProductionRun): void {
  getDb().prepare(`
    INSERT INTO chapter_production_runs (
      id, novel_id, target_chapter_id, status, user_intent, scene_beats, draft_content,
      style_audit, continuity_report, error_message, created_at, updated_at
    )
    VALUES (
      @id, @novel_id, @target_chapter_id, @status, @user_intent, @scene_beats, @draft_content,
      @style_audit, @continuity_report, @error_message, @created_at, @updated_at
    )
  `).run(chapterProductionRunToRow(run));
  notify();
}

export function updateChapterProductionRun(id: string, data: Partial<ChapterProductionRun>): void {
  const existing = getDb().prepare('SELECT * FROM chapter_production_runs WHERE id = ?').get(id);
  if (!existing) return;
  const merged = { ...rowToChapterProductionRun(existing as any), ...data, id, updatedAt: Date.now() };
  getDb().prepare(`
    UPDATE chapter_production_runs
    SET novel_id=@novel_id,
        target_chapter_id=@target_chapter_id,
        status=@status,
        user_intent=@user_intent,
        scene_beats=@scene_beats,
        draft_content=@draft_content,
        style_audit=@style_audit,
        continuity_report=@continuity_report,
        error_message=@error_message,
        updated_at=@updated_at
    WHERE id=@id
  `).run(chapterProductionRunToRow(merged));
  notify();
}

// ── Continuation Packs ──────────────────────────────────────────────

function mapContinuationPackRow(row: any): import('../types').ContinuationPack {
  return {
    id: row.id,
    novelId: row.novel_id,
    title: row.title,
    status: row.status,
    sourceDocuments: JSON.parse(row.source_documents || '[]'),
    canonFacts: JSON.parse(row.canon_facts || '[]'),
    characterStates: JSON.parse(row.character_states || '[]'),
    plotState: JSON.parse(row.plot_state || '{}'),
    styleProfile: JSON.parse(row.style_profile || '{}'),
    contradictions: JSON.parse(row.contradictions || '[]'),
    continuationTask: row.continuation_task,
    sourceMap: JSON.parse(row.source_map || '{}'),
    readingQuestions: JSON.parse(row.reading_questions || '[]'),
    continuationGaps: JSON.parse(row.continuation_gaps || '[]'),
    sourceBadge: row.source_badge || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function continuationPackToRow(pack: import('../types').ContinuationPack) {
  return {
    id: pack.id,
    novel_id: pack.novelId,
    title: pack.title,
    status: pack.status,
    source_documents: JSON.stringify(pack.sourceDocuments),
    canon_facts: JSON.stringify(pack.canonFacts),
    character_states: JSON.stringify(pack.characterStates),
    plot_state: JSON.stringify(pack.plotState),
    style_profile: JSON.stringify(pack.styleProfile),
    contradictions: JSON.stringify(pack.contradictions),
    continuation_task: pack.continuationTask,
    source_map: JSON.stringify(pack.sourceMap || {}),
    reading_questions: JSON.stringify(pack.readingQuestions || []),
    continuation_gaps: JSON.stringify(pack.continuationGaps || []),
    source_badge: pack.sourceBadge || null,
    created_at: pack.createdAt,
    updated_at: pack.updatedAt,
  };
}

export function listContinuationPacks(novelId: string): Array<import('../types').ContinuationPack> {
  return getDb().prepare('SELECT * FROM continuation_packs WHERE novel_id = ? ORDER BY updated_at DESC')
    .all(novelId)
    .map(mapContinuationPackRow);
}

export function getContinuationPack(id: string): import('../types').ContinuationPack | undefined {
  const row = getDb().prepare('SELECT * FROM continuation_packs WHERE id = ?').get(id);
  return row ? mapContinuationPackRow(row) : undefined;
}

export function createContinuationPack(pack: import('../types').ContinuationPack): void {
  getDb().prepare(`
    INSERT INTO continuation_packs (
      id, novel_id, title, status, source_documents, canon_facts, character_states,
      plot_state, style_profile, contradictions, continuation_task, source_map,
      reading_questions, continuation_gaps, source_badge, created_at, updated_at
    ) VALUES (@id, @novel_id, @title, @status, @source_documents, @canon_facts,
      @character_states, @plot_state, @style_profile, @contradictions,
      @continuation_task, @source_map, @reading_questions, @continuation_gaps,
      @source_badge, @created_at, @updated_at)
  `).run(continuationPackToRow(pack));
  notify();
}

export function updateContinuationPack(id: string, data: Partial<import('../types').ContinuationPack>): void {
  const existing = getContinuationPack(id);
  if (!existing) return;
  const merged = { ...existing, ...data, id, updatedAt: Date.now() };
  getDb().prepare(`
    UPDATE continuation_packs SET
      title=@title, status=@status, source_documents=@source_documents,
      canon_facts=@canon_facts, character_states=@character_states,
      plot_state=@plot_state, style_profile=@style_profile,
      contradictions=@contradictions, continuation_task=@continuation_task,
      source_map=@source_map, reading_questions=@reading_questions,
      continuation_gaps=@continuation_gaps, source_badge=@source_badge,
      updated_at=@updated_at
    WHERE id=@id
  `).run(continuationPackToRow(merged));
  notify();
}

export function deleteContinuationPack(id: string): void {
  getDb().prepare('DELETE FROM continuation_packs WHERE id = ?').run(id);
  notify();
}
