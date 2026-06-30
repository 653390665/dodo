import type { Novel, Character, Location, Item, Faction, PowerLevel, TimelineEvent, Chapter, ChapterVersion, Skill, IdeaFragment, Foreshadowing, SkillUsageRecord, ChapterProductionRun, EntityRelationship } from '../../shared/types';
import { calculateFeedbackScore, summarizeUsageStats } from '../../src/lib/skill-model';
import { buildImportedNovelDraft } from '../../src/lib/continuation-import-flow';
import { getDb, setDb, closeDb, subscribe, notify } from './db-instance.js';
import { rowToNovel, rowToCharacter, rowToLocation, rowToItem, rowToFaction, rowToPowerLevel, rowToTimelineEvent, rowToChapter, rowToChapterVersion, rowToSkill, rowToSkillUsageRecord, rowToIdeaFragment, rowToForeshadowing, rowToChapterProductionRun, novelToRow, characterToRow, locationToRow, itemToRow, factionToRow, powerLevelToRow, timelineEventToRow, chapterToRow, chapterVersionToRow, skillToRow, skillUsageRecordToRow, ideaFragmentToRow, foreshadowingToRow, chapterProductionRunToRow, mapContinuationPackRow, continuationPackToRow } from './db-mappers.js';
import { createCrudHelpers } from './db-crud.js';

export { initDb } from './db-init.js';




// closeDb — re-exported from db-instance.ts
export { closeDb } from './db-instance.js';

// subscribe / notify — re-exported from db-instance.ts
export { subscribe, notify } from './db-instance.js';































// --- Novel CRUD ---

const novelCrud = createCrudHelpers<Novel, any>({
  tableName: 'novels',
  rowToEntity: rowToNovel,
  entityToRow: novelToRow,
  insertColumns: [
    'id', 'title', 'author_id', 'summary', 'cover_image', 'status', 'world_rules',
    'global_outline', 'mounted_skill_ids', 'mounted_skill_loadout',
    'project_preference_profile', 'created_at', 'updated_at'
  ],
  updateColumns: [
    'title', 'author_id', 'summary', 'cover_image', 'status', 'world_rules',
    'global_outline', 'mounted_skill_ids', 'mounted_skill_loadout',
    'project_preference_profile', 'updated_at'
  ],
  listOrderBy: 'updated_at DESC'
});

export function listNovels(): Novel[] {
  return novelCrud.list();
}

export function getNovel(id: string): Novel | undefined {
  return novelCrud.get(id);
}

export function createNovel(novel: Novel): void {
  novelCrud.create(novel);
}

export function updateNovel(id: string, data: Partial<Novel>): void {
  novelCrud.update(id, data);
}

export function deleteNovel(id: string): void {
  novelCrud.delete(id);
}

// --- Chapter CRUD ---

const chapterCrud = createCrudHelpers<Chapter, any>({
  tableName: 'chapters',
  rowToEntity: rowToChapter,
  entityToRow: chapterToRow,
  insertColumns: ['id', 'novel_id', 'volume_name', 'title', 'content', '"order"', 'word_count', 'scene_beats', 'critique', 'created_at', 'updated_at'],
  updateColumns: ['novel_id', 'volume_name', 'title', 'content', '"order"', 'word_count', 'scene_beats', 'critique', 'updated_at'],
  listFilterKey: 'novel_id',
  listOrderBy: '"order" ASC'
});

export function listChapters(novelId: string): Chapter[] {
  return chapterCrud.list(novelId);
}

export function getChapter(id: string): Chapter | undefined {
  return chapterCrud.get(id);
}

export function createChapter(chapter: Chapter): void {
  chapterCrud.create(chapter);
}

export function updateChapter(id: string, data: Partial<Chapter>): void {
  chapterCrud.update(id, data);
}

export function deleteChapter(id: string): void {
  chapterCrud.delete(id);
}

// --- ChapterVersion CRUD ---

const chapterVersionCrud = createCrudHelpers<ChapterVersion, any>({
  tableName: 'chapter_versions',
  rowToEntity: rowToChapterVersion,
  entityToRow: chapterVersionToRow,
  insertColumns: ['id', 'chapter_id', 'content', 'word_count', 'author', 'created_at'],
  updateColumns: [],
  listFilterKey: 'chapter_id',
  listOrderBy: 'created_at DESC'
});

export function listChapterVersions(chapterId: string): ChapterVersion[] {
  return chapterVersionCrud.list(chapterId);
}

export function createChapterVersion(cv: ChapterVersion): void {
  chapterVersionCrud.create(cv);
}

// --- Character CRUD ---

const characterCrud = createCrudHelpers<Character, any>({
  tableName: 'characters',
  rowToEntity: rowToCharacter,
  entityToRow: characterToRow,
  insertColumns: ['id', 'novel_id', 'name', 'role', 'summary', 'traits', 'bio', 'created_at', 'updated_at'],
  updateColumns: ['novel_id', 'name', 'role', 'summary', 'traits', 'bio', 'updated_at'],
  listFilterKey: 'novel_id'
});

export function listCharacters(novelId: string): Character[] {
  return characterCrud.list(novelId);
}

export function getCharacter(id: string): Character | undefined {
  return characterCrud.get(id);
}

export function createCharacter(c: Character): void {
  characterCrud.create(c);
}

export function updateCharacter(id: string, data: Partial<Character>): void {
  characterCrud.update(id, data);
}

export function deleteCharacter(id: string): void {
  characterCrud.delete(id);
}

// --- Location CRUD ---

const locationCrud = createCrudHelpers<Location, any>({
  tableName: 'locations',
  rowToEntity: rowToLocation,
  entityToRow: locationToRow,
  insertColumns: ['id', 'novel_id', 'name', 'description', 'region', 'created_at', 'updated_at'],
  updateColumns: ['novel_id', 'name', 'description', 'region', 'updated_at'],
  listFilterKey: 'novel_id'
});

export function listLocations(novelId: string): Location[] {
  return locationCrud.list(novelId);
}

export function createLocation(loc: Location): void {
  locationCrud.create(loc);
}

export function updateLocation(id: string, data: Partial<Location>): void {
  locationCrud.update(id, data);
}

export function deleteLocation(id: string): void {
  locationCrud.delete(id);
}

// --- Item CRUD ---

const itemCrud = createCrudHelpers<Item, any>({
  tableName: 'items',
  rowToEntity: rowToItem,
  entityToRow: itemToRow,
  insertColumns: ['id', 'novel_id', 'name', 'description', 'type', 'created_at', 'updated_at'],
  updateColumns: ['novel_id', 'name', 'description', 'type', 'updated_at'],
  listFilterKey: 'novel_id'
});

export function listItems(novelId: string): Item[] {
  return itemCrud.list(novelId);
}

export function getItem(id: string): Item | undefined {
  return itemCrud.get(id);
}

export function createItem(item: Item): void {
  itemCrud.create(item);
}

export function updateItem(id: string, data: Partial<Item>): void {
  itemCrud.update(id, data);
}

export function deleteItem(id: string): void {
  itemCrud.delete(id);
}

// --- Faction CRUD ---

const factionCrud = createCrudHelpers<Faction, any>({
  tableName: 'factions',
  rowToEntity: rowToFaction,
  entityToRow: factionToRow,
  insertColumns: ['id', 'novel_id', 'name', 'description', 'leader', 'territory', 'created_at', 'updated_at'],
  updateColumns: ['novel_id', 'name', 'description', 'leader', 'territory', 'updated_at'],
  listFilterKey: 'novel_id'
});

export function listFactions(novelId: string): Faction[] {
  return factionCrud.list(novelId);
}

export function createFaction(f: Faction): void {
  factionCrud.create(f);
}

export function updateFaction(id: string, data: Partial<Faction>): void {
  factionCrud.update(id, data);
}

export function deleteFaction(id: string): void {
  factionCrud.delete(id);
}

// --- PowerLevel CRUD ---

const powerLevelCrud = createCrudHelpers<PowerLevel, any>({
  tableName: 'power_levels',
  rowToEntity: rowToPowerLevel,
  entityToRow: powerLevelToRow,
  insertColumns: ['id', 'novel_id', 'name', 'description', 'tier', 'characteristics', 'created_at', 'updated_at'],
  updateColumns: ['novel_id', 'name', 'description', 'tier', 'characteristics', 'updated_at'],
  listFilterKey: 'novel_id',
  listOrderBy: 'tier ASC'
});

export function listPowerLevels(novelId: string): PowerLevel[] {
  return powerLevelCrud.list(novelId);
}

export function createPowerLevel(p: PowerLevel): void {
  powerLevelCrud.create(p);
}

export function updatePowerLevel(id: string, data: Partial<PowerLevel>): void {
  powerLevelCrud.update(id, data);
}

export function deletePowerLevel(id: string): void {
  powerLevelCrud.delete(id);
}

// --- TimelineEvent CRUD ---

const timelineEventCrud = createCrudHelpers<TimelineEvent, any>({
  tableName: 'timeline_events',
  rowToEntity: rowToTimelineEvent,
  entityToRow: timelineEventToRow,
  insertColumns: ['id', 'novel_id', 'title', 'description', 'timestamp', 'status_tag', '"order"', 'created_at', 'updated_at'],
  updateColumns: ['novel_id', 'title', 'description', 'timestamp', 'status_tag', '"order"', 'updated_at'],
  listFilterKey: 'novel_id',
  listOrderBy: '"order" ASC'
});

export function listTimelineEvents(novelId: string): TimelineEvent[] {
  return timelineEventCrud.list(novelId);
}

export function createTimelineEvent(t: TimelineEvent): void {
  timelineEventCrud.create(t);
}

export function updateTimelineEvent(id: string, data: Partial<TimelineEvent>): void {
  timelineEventCrud.update(id, data);
}

export function deleteTimelineEvent(id: string): void {
  timelineEventCrud.delete(id);
}

// --- Skill CRUD ---

const skillCrud = createCrudHelpers<Skill, any>({
  tableName: 'skills',
  rowToEntity: rowToSkill,
  entityToRow: skillToRow,
  insertColumns: ['id', 'name', 'description', 'style', 'pacing', 'vocabulary', 'sentence_structure', 'imagery', 'banned_words', 'few_shots', 'character_traits', 'world_building', 'foreshadowing', 'plot_pattern', 'core_patterns', 'banned_elements', 'stability_score', 'evaluation_feedback', 'version', 'parent_skill_id', 'lineage_root_id', 'primary_dimension', 'dimension_tags', 'composition_profile', 'usage_stats', 'feedback_score', 'fusion_meta', 'method_chain', 'why_this_skill_works', 'source_badge', 'created_at', 'updated_at'],
  updateColumns: ['name', 'description', 'style', 'pacing', 'vocabulary', 'sentence_structure', 'imagery', 'banned_words', 'few_shots', 'character_traits', 'world_building', 'foreshadowing', 'plot_pattern', 'core_patterns', 'banned_elements', 'stability_score', 'evaluation_feedback', 'version', 'parent_skill_id', 'lineage_root_id', 'primary_dimension', 'dimension_tags', 'composition_profile', 'usage_stats', 'feedback_score', 'fusion_meta', 'method_chain', 'why_this_skill_works', 'source_badge', 'updated_at'],
  listOrderBy: 'created_at DESC'
});

export function listSkills(): Skill[] {
  return skillCrud.list();
}

export function getSkill(id: string): Skill | undefined {
  return skillCrud.get(id);
}

export function createSkill(s: Skill): void {
  skillCrud.create(s);
}

export function updateSkill(id: string, data: Partial<Skill>): void {
  skillCrud.update(id, data);
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
  skillCrud.delete(id);
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

const ideaFragmentCrud = createCrudHelpers<IdeaFragment, any>({
  tableName: 'idea_fragments',
  rowToEntity: rowToIdeaFragment,
  entityToRow: ideaFragmentToRow,
  insertColumns: ['id', 'novel_id', 'content', 'type', 'status', 'ai_expansion', 'target_chapter_id', 'created_at', 'updated_at'],
  updateColumns: ['novel_id', 'content', 'type', 'status', 'ai_expansion', 'target_chapter_id', 'updated_at'],
  listFilterKey: 'novel_id',
  listOrderBy: 'created_at DESC'
});

export function listIdeaFragments(novelId?: string): IdeaFragment[] {
  if (novelId) {
    return getDb().prepare('SELECT * FROM idea_fragments WHERE novel_id = ? OR novel_id IS NULL ORDER BY created_at DESC').all(novelId).map(rowToIdeaFragment);
  }
  return ideaFragmentCrud.list();
}

export function createIdeaFragment(f: IdeaFragment): void {
  ideaFragmentCrud.create(f);
}

export function updateIdeaFragment(id: string, data: Partial<IdeaFragment>): void {
  ideaFragmentCrud.update(id, data);
}

export function deleteIdeaFragment(id: string): void {
  ideaFragmentCrud.delete(id);
}

// --- Foreshadowing CRUD ---

const foreshadowingCrud = createCrudHelpers<Foreshadowing, any>({
  tableName: 'foreshadowings',
  rowToEntity: rowToForeshadowing,
  entityToRow: foreshadowingToRow,
  insertColumns: ['id', 'novel_id', 'title', 'description', 'status', 'planted_chapter_id', 'payoff_chapter_id', 'related_character_ids', 'notes', 'created_at', 'updated_at'],
  updateColumns: ['title', 'description', 'status', 'planted_chapter_id', 'payoff_chapter_id', 'related_character_ids', 'notes', 'updated_at'],
  listFilterKey: 'novel_id',
  listOrderBy: 'created_at ASC'
});

export function listForeshadowings(novelId: string): Foreshadowing[] {
  return foreshadowingCrud.list(novelId);
}

export function getForeshadowing(id: string): Foreshadowing | undefined {
  return foreshadowingCrud.get(id);
}

export function createForeshadowing(f: Foreshadowing): void {
  foreshadowingCrud.create(f);
}

export function updateForeshadowing(id: string, data: Partial<Foreshadowing>): void {
  foreshadowingCrud.update(id, data);
}

export function deleteForeshadowing(id: string): void {
  foreshadowingCrud.delete(id);
}

// --- ChapterProductionRun CRUD ---

const chapterProductionRunCrud = createCrudHelpers<ChapterProductionRun, any>({
  tableName: 'chapter_production_runs',
  rowToEntity: rowToChapterProductionRun,
  entityToRow: chapterProductionRunToRow,
  insertColumns: ['id', 'novel_id', 'target_chapter_id', 'status', 'user_intent', 'scene_beats', 'draft_content', 'style_audit', 'continuity_report', 'error_message', 'created_at', 'updated_at'],
  updateColumns: ['novel_id', 'target_chapter_id', 'status', 'user_intent', 'scene_beats', 'draft_content', 'style_audit', 'continuity_report', 'error_message', 'updated_at'],
  listFilterKey: 'novel_id',
  listOrderBy: 'created_at DESC'
});

export function listChapterProductionRuns(novelId: string): ChapterProductionRun[] {
  return chapterProductionRunCrud.list(novelId);
}

export function getChapterProductionRun(id: string): ChapterProductionRun | undefined {
  return chapterProductionRunCrud.get(id);
}

export function createChapterProductionRun(run: ChapterProductionRun): void {
  chapterProductionRunCrud.create(run);
}

export function updateChapterProductionRun(id: string, data: Partial<ChapterProductionRun>): void {
  chapterProductionRunCrud.update(id, data);
}

// ── Continuation Packs ──────────────────────────────────────────────

const continuationPackCrud = createCrudHelpers<import('../../shared/types').ContinuationPack, any>({
  tableName: 'continuation_packs',
  rowToEntity: mapContinuationPackRow,
  entityToRow: continuationPackToRow,
  insertColumns: ['id', 'novel_id', 'title', 'status', 'source_documents', 'canon_facts', 'character_states', 'plot_state', 'style_profile', 'contradictions', 'continuation_task', 'source_map', 'reading_questions', 'continuation_gaps', 'source_badge', 'created_at', 'updated_at'],
  updateColumns: ['novel_id', 'title', 'status', 'source_documents', 'canon_facts', 'character_states', 'plot_state', 'style_profile', 'contradictions', 'continuation_task', 'source_map', 'reading_questions', 'continuation_gaps', 'source_badge', 'updated_at'],
  listFilterKey: 'novel_id',
  listOrderBy: 'updated_at DESC'
});

export function listContinuationPacks(novelId: string): Array<import('../../shared/types').ContinuationPack> {
  return continuationPackCrud.list(novelId);
}

export function getContinuationPack(id: string): import('../../shared/types').ContinuationPack | undefined {
  return continuationPackCrud.get(id);
}

export function createContinuationPack(pack: import('../../shared/types').ContinuationPack): void {
  continuationPackCrud.create(pack);
}

export function updateContinuationPack(id: string, data: Partial<import('../../shared/types').ContinuationPack>): void {
  continuationPackCrud.update(id, data);
}

export function deleteContinuationPack(id: string): void {
  continuationPackCrud.delete(id);
}

export function runInTransaction<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}

export function listEntityRelationships(novelId: string): EntityRelationship[] {
  return getDb().prepare('SELECT * FROM entity_relationships WHERE novelId = ?').all(novelId) as EntityRelationship[];
}
export function createEntityRelationship(rel: any): void {
  const db = getDb();
  getDb().prepare('INSERT INTO entity_relationships (id, novelId, sourceType, sourceId, targetType, targetId, relationshipType, description, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(rel.id, rel.novelId, rel.sourceType, rel.sourceId, rel.targetType, rel.targetId, rel.relationshipType, rel.description || '', Date.now());
  notify();
}
const ENTITY_RELATIONSHIP_COLUMNS = new Set([
  'sourceType', 'sourceId', 'targetType', 'targetId', 'relationshipType', 'description'
]);

export function updateEntityRelationship(id: string, data: any): void {
  const db = getDb();
  const sets: string[] = []; const vals: any[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (!ENTITY_RELATIONSHIP_COLUMNS.has(k)) {
      throw new Error(`Invalid column name: ${k}`);
    }
    sets.push(k + ' = ?');
    vals.push(v);
  }
  if (sets.length === 0) return;
  vals.push(id);
  getDb().prepare('UPDATE entity_relationships SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
  notify();
}
export function deleteEntityRelationship(id: string): void {
  getDb().prepare('DELETE FROM entity_relationships WHERE id = ?').run(id);
  notify();
}
