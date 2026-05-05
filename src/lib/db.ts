import Database from 'better-sqlite3';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import os from 'os';
import type { Novel, Character, Location, Item, Faction, PowerLevel, TimelineEvent, Chapter, ChapterVersion, Skill } from '../types';

const DB_DIR = path.join(os.homedir(), '.inkflow');
const DB_PATH = path.join(DB_DIR, 'data.db');

let db: Database.Database | undefined;

// --- Init ---

export function initDb(dbPath?: string): void {
  if (db) return;

  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });

  db = new Database(dbPath || DB_PATH);
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
      created_at INTEGER NOT NULL
    );
  `);
}

function getDb(): Database.Database {
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
    createdAt: row.created_at,
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
    created_at: s.createdAt,
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
    INSERT INTO novels (id, title, author_id, summary, cover_image, status, world_rules, global_outline, mounted_skill_ids, created_at, updated_at)
    VALUES (@id, @title, @author_id, @summary, @cover_image, @status, @world_rules, @global_outline, @mounted_skill_ids, @created_at, @updated_at)
  `).run(novelToRow(novel));
  notify();
}

export function updateNovel(id: string, data: Partial<Novel>): void {
  const existing = getDb().prepare('SELECT * FROM novels WHERE id = ?').get(id);
  if (!existing) return;
  const merged = { ...rowToNovel(existing as any), ...data, id, updatedAt: Date.now() };
  getDb().prepare(`
    UPDATE novels SET title=@title, author_id=@author_id, summary=@summary, cover_image=@cover_image, status=@status, world_rules=@world_rules, global_outline=@global_outline, mounted_skill_ids=@mounted_skill_ids, updated_at=@updated_at
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
    INSERT INTO skills (id, name, description, style, pacing, vocabulary, sentence_structure, imagery, banned_words, few_shots, character_traits, world_building, foreshadowing, plot_pattern, core_patterns, banned_elements, stability_score, evaluation_feedback, version, created_at)
    VALUES (@id, @name, @description, @style, @pacing, @vocabulary, @sentence_structure, @imagery, @banned_words, @few_shots, @character_traits, @world_building, @foreshadowing, @plot_pattern, @core_patterns, @banned_elements, @stability_score, @evaluation_feedback, @version, @created_at)
  `).run(skillToRow(s));
  notify();
}

export function updateSkill(id: string, data: Partial<Skill>): void {
  const existing = getDb().prepare('SELECT * FROM skills WHERE id = ?').get(id);
  if (!existing) return;
  const s = { ...rowToSkill(existing), ...data, id };
  getDb().prepare(`
    UPDATE skills SET name=@name, description=@description, style=@style, pacing=@pacing, vocabulary=@vocabulary, sentence_structure=@sentence_structure, imagery=@imagery, banned_words=@banned_words, few_shots=@few_shots, character_traits=@character_traits, world_building=@world_building, foreshadowing=@foreshadowing, plot_pattern=@plot_pattern, core_patterns=@core_patterns, banned_elements=@banned_elements, stability_score=@stability_score, evaluation_feedback=@evaluation_feedback, version=@version
    WHERE id=@id
  `).run(skillToRow(s));
  notify();
}

export function deleteSkill(id: string): void {
  getDb().prepare('DELETE FROM skills WHERE id = ?').run(id);
  notify();
}
