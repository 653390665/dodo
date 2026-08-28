/* eslint-disable @typescript-eslint/no-explicit-any */
import { logger } from '../logger';
import { createHash } from 'node:crypto';
import type {
  Novel, Character, Location, Item, Faction, PowerLevel, TimelineEvent,
  Chapter, ChapterVersion, Skill, SkillUsageRecord, IdeaFragment,
  Foreshadowing, ChapterProductionRun, ChapterProductionRunVersion, ContinuationPack, ContinuationSyncState, ContinuationExtractionJob,
  SkillCompositionProfile, SkillFusionMeta, SkillMethodChain, SkillUsageStats,
  ContinuityReport, ContinuationCanonFact, ContinuationCharacterState, ContinuationContradiction,
  ContinuationGap, ContinuationPlotState, ContinuationReadingQuestion, ContinuationSourceDocument,
  ContinuationSourceMap, ContinuationStyleProfile
} from '../../shared/types';
import { normalizeProjectPreferenceProfile } from '../../shared/lib/project-preference-profile.js';

/**
 * Safely parse a JSON string from a DB column, returning a fallback value
 * if the string is null, undefined, empty, or contains malformed JSON.
 * Logs a warning when malformed JSON is encountered so corruption is detectable.
 */
function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    logger.warn(`[db-mappers] Malformed JSON in column, using fallback. Value starts with: ${raw.slice(0, 80)}`);
    return fallback;
  }
}

type SafeAny = any;
/** @deprecated Use typed row interfaces (NovelRow, ChapterRow, etc.) for new code */
export type DbRow = SafeAny;

export interface NovelRow {
  id: string; title: string; author_id: string; summary: string;
  cover_image: string | null; status: string; world_rules: string | null;
  global_outline: string | null; mounted_skill_ids: string;
  mounted_skill_loadout: string | null; project_preference_profile: string | null;
  created_at: number; updated_at: number;
}

export interface CharacterRow {
  id: string; novel_id: string; name: string; role: string;
  summary: string; traits: string; bio: string; current_state: string;
  created_at: number; updated_at: number;
}

export interface ChapterRow {
  id: string; novel_id: string; volume_name: string | null; title: string;
  content: string; order: number; word_count: number;
  scene_beats: string | null; critique: string | null;
  workflow_meta: string | null;
  created_at: number; updated_at: number;
}

export interface SkillRow {
  id: string; name: string; description: string | null; style: string | null;
  pacing: string | null; vocabulary: string | null; sentence_structure: string | null;
  imagery: string | null; banned_words: string | null; few_shots: string | null;
  character_traits: string | null; world_building: string | null;
  foreshadowing: string | null; plot_pattern: string | null;
  core_patterns: string | null; banned_elements: string | null;
  stability_score: number | null; evaluation_feedback: string | null;
  version: number | null; parent_skill_id: string | null;
  lineage_root_id: string | null; primary_dimension: Skill['primaryDimension'] | null;
  dimension_tags: string | null; composition_profile: string | null;
  usage_stats: string | null; feedback_score: number | null;
  fusion_meta: string | null; method_chain: string | null;
  why_this_skill_works: string | null; source_badge: Skill['sourceBadge'] | null;
  created_at: number; updated_at: number | null;
}

export function rowToNovel(row: DbRow): Novel {
  return {
    ...row,
    authorId: row.author_id,
    coverImage: row.cover_image,
    worldRules: row.world_rules,
    globalOutline: row.global_outline,
    mountedSkillIds: safeJsonParse(row.mounted_skill_ids, []),
    mountedSkillLoadout: safeJsonParse(row.mounted_skill_loadout, []),
    projectPreferenceProfile: normalizeProjectPreferenceProfile(safeJsonParse(row.project_preference_profile, {})),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToCharacter(row: DbRow): Character {
  return {
    ...row,
    novelId: row.novel_id,
    traits: safeJsonParse(row.traits, []),
    current_state: row.current_state || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToLocation(row: DbRow): Location {
  return { ...row, novelId: row.novel_id, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function rowToItem(row: DbRow): Item {
  return { ...row, novelId: row.novel_id, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function rowToFaction(row: DbRow): Faction {
  return { ...row, novelId: row.novel_id, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function rowToPowerLevel(row: DbRow): PowerLevel {
  return { ...row, novelId: row.novel_id, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function rowToTimelineEvent(row: DbRow): TimelineEvent {
  return { ...row, novelId: row.novel_id, statusTag: row.status_tag, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function rowToChapter(row: DbRow): Chapter {
  let workflowMeta;
  try { workflowMeta = row.workflow_meta ? JSON.parse(row.workflow_meta) : undefined; } catch { logger.warn('[db-mappers] Malformed JSON in workflow_meta, using empty state'); }
  return { ...row, novelId: row.novel_id, volumeName: row.volume_name, wordCount: row.word_count, sceneBeats: row.scene_beats, workflowMeta, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function rowToChapterVersion(row: DbRow): ChapterVersion {
  return { ...row, chapterId: row.chapter_id, wordCount: row.word_count, createdAt: row.created_at };
}

export function rowToSkill(row: SkillRow): Skill {
  const fusionMeta = safeJsonParse<SkillFusionMeta | undefined>(row.fusion_meta, undefined);
  const envelope = fusionMeta as (SkillFusionMeta & Record<string, unknown>) | undefined;
  return {
    ...row,
    description: row.description || '',
    style: row.style || '',
    pacing: row.pacing || '',
    sentenceStructure: row.sentence_structure || undefined,
    bannedWords: safeJsonParse<string[]>(row.banned_words, []),
    fewShots: safeJsonParse<string[]>(row.few_shots, []),
    vocabulary: safeJsonParse<string[]>(row.vocabulary, []),
    imagery: safeJsonParse<string[]>(row.imagery, []),
    characterTraits: row.character_traits || undefined,
    worldBuilding: row.world_building || undefined,
    plotPattern: row.plot_pattern || undefined,
    foreshadowing: row.foreshadowing || undefined,
    corePatterns: safeJsonParse<string[]>(row.core_patterns, []),
    bannedElements: safeJsonParse<string[]>(row.banned_elements, []),
    stabilityScore: row.stability_score ?? 0,
    evaluationFeedback: row.evaluation_feedback || '',
    version: row.version ?? 1,
    parentSkillId: row.parent_skill_id || undefined,
    lineageRootId: row.lineage_root_id || undefined,
    primaryDimension: row.primary_dimension || undefined,
    dimensionTags: safeJsonParse<Skill['dimensionTags']>(row.dimension_tags, []),
    compositionProfile: safeJsonParse<SkillCompositionProfile>(row.composition_profile, {} as SkillCompositionProfile),
    usageStats: safeJsonParse<SkillUsageStats>(row.usage_stats, {} as SkillUsageStats),
    feedbackScore: row.feedback_score ?? undefined,
    fusionMeta,
    deconstructionCardType: fusionMeta?.deconstructionCardType || undefined,
    executionScore: fusionMeta?.executionScore || undefined,
    accessTier: fusionMeta?.accessTier || undefined,
    methodChain: safeJsonParse<SkillMethodChain | undefined>(row.method_chain, undefined),
    whyThisSkillWorks: row.why_this_skill_works || undefined,
    sourceBadge: row.source_badge || undefined,
    sourceType: envelope?.sourceType,
    isRuntimeReady: envelope?.isRuntimeReady,
    sanitizationStatus: envelope?.sanitizationStatus,
    runtimeStatus: envelope?.runtimeStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
  } as Skill;
}

export function rowToSkillUsageRecord(row: DbRow): SkillUsageRecord {
  return {
    ...row,
    novelId: row.novel_id,
    chapterId: row.chapter_id || undefined,
    mountedSkillIds: safeJsonParse(row.mounted_skill_ids, []),
    fitScore: row.fit_score,
    auditScore: row.audit_score ?? undefined,
    userAction: row.user_action,
    notes: row.notes || undefined,
    createdAt: row.created_at,
  };
}

export function rowToIdeaFragment(row: DbRow): IdeaFragment {
  return {
    ...row,
    novelId: row.novel_id,
    aiExpansion: row.ai_expansion,
    targetChapterId: row.target_chapter_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToForeshadowing(row: DbRow): Foreshadowing {
  return {
    ...row,
    novelId: row.novel_id,
    plantedChapterId: row.planted_chapter_id,
    payoffChapterId: row.payoff_chapter_id,
    relatedCharacterIds: safeJsonParse(row.related_character_ids, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToChapterProductionRun(row: DbRow): ChapterProductionRun {
  return {
    id: row.id,
    novelId: row.novel_id,
    targetChapterId: row.target_chapter_id || undefined,
    status: row.status,
    userIntent: row.user_intent || '',
    sceneBeats: row.scene_beats || '',
    draftContent: row.draft_content || '',
    styleAudit: row.style_audit || '',
    continuityReport: safeJsonParse<ContinuityReport>(row.continuity_report, {} as ContinuityReport),
    errorMessage: row.error_message || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToChapterProductionRunVersion(row: DbRow): ChapterProductionRunVersion {
  return { id: row.id, runId: row.run_id, novelId: row.novel_id, targetChapterId: row.target_chapter_id || undefined, source: row.source, sceneBeats: row.scene_beats || '', draftContent: row.draft_content || '', styleAudit: row.style_audit || '', continuityReport: safeJsonParse<ContinuityReport>(row.continuity_report, {} as ContinuityReport), contentHash: row.content_hash || '', createdAt: row.created_at };
}

export function chapterProductionRunVersionToRow(version: ChapterProductionRunVersion): DbRow {
  return { id: version.id, run_id: version.runId, novel_id: version.novelId, target_chapter_id: version.targetChapterId || null, source: version.source, scene_beats: version.sceneBeats, draft_content: version.draftContent, style_audit: version.styleAudit, continuity_report: JSON.stringify(version.continuityReport), content_hash: version.contentHash, created_at: version.createdAt };
}

export function rowToContinuationExtractionJob(row: DbRow): ContinuationExtractionJob {
  const statuses = new Set(['queued', 'running', 'completed', 'failed', 'interrupted', 'cancelled']);
  const validStatus = statuses.has(row.status) ? row.status as ContinuationExtractionJob['status'] : 'failed';
  const invalidStatus = validStatus === 'failed' && !statuses.has(row.status);
  return { id: row.id, packId: row.pack_id, novelId: row.novel_id, status: validStatus, progress: row.progress || 0, stageText: row.stage_text || '', batchCursor: row.batch_cursor || 0, totalBatches: row.total_batches || 0, resultJson: row.result_json || undefined, checkpointJson: row.checkpoint_json || undefined, errorCode: row.error_code || (invalidStatus ? 'INVALID_JOB_STATUS' : undefined), errorMessage: row.error_message || (invalidStatus ? `非法提取任务状态：${String(row.status)}` : undefined), databaseGeneration: row.database_generation, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function continuationExtractionJobToRow(job: ContinuationExtractionJob): DbRow {
  return { id: job.id, pack_id: job.packId, novel_id: job.novelId, status: job.status, progress: job.progress, stage_text: job.stageText, batch_cursor: job.batchCursor, total_batches: job.totalBatches, result_json: job.resultJson || null, checkpoint_json: job.checkpointJson || null, error_code: job.errorCode || null, error_message: job.errorMessage || null, database_generation: job.databaseGeneration, created_at: job.createdAt, updated_at: job.updatedAt };
}


// --- Serializers: TS → DB row ---

export function novelToRow(novel: Novel): DbRow {
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

export function characterToRow(c: Character): DbRow {
  return {
    id: c.id,
    novel_id: c.novelId,
    name: c.name,
    role: c.role,
    summary: c.summary,
    traits: JSON.stringify(c.traits || []),
    bio: c.bio,
    current_state: c.current_state || '',
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

export function locationToRow(l: Location): DbRow {
  return { id: l.id, novel_id: l.novelId, name: l.name, description: l.description, region: l.region, created_at: l.createdAt, updated_at: l.updatedAt };
}

export function itemToRow(i: Item): DbRow {
  return { id: i.id, novel_id: i.novelId, name: i.name, description: i.description, type: i.type, created_at: i.createdAt, updated_at: i.updatedAt };
}

export function factionToRow(f: Faction): DbRow {
  return { id: f.id, novel_id: f.novelId, name: f.name, description: f.description, leader: f.leader, territory: f.territory, created_at: f.createdAt, updated_at: f.updatedAt };
}

export function powerLevelToRow(p: PowerLevel): DbRow {
  return { id: p.id, novel_id: p.novelId, name: p.name, description: p.description, tier: p.tier, characteristics: p.characteristics, created_at: p.createdAt, updated_at: p.updatedAt };
}

export function timelineEventToRow(t: TimelineEvent): DbRow {
  return { id: t.id, novel_id: t.novelId, title: t.title, description: t.description, timestamp: t.timestamp, status_tag: t.statusTag, order: t.order, created_at: t.createdAt, updated_at: t.updatedAt };
}

export function chapterToRow(c: Chapter): DbRow {
  return { id: c.id, novel_id: c.novelId, volume_name: c.volumeName, title: c.title, content: c.content, order: c.order, word_count: c.wordCount, scene_beats: c.sceneBeats, critique: c.critique, workflow_meta: JSON.stringify(c.workflowMeta || {}), created_at: c.createdAt, updated_at: c.updatedAt };
}

export function chapterVersionToRow(cv: ChapterVersion): DbRow {
  return { id: cv.id, chapter_id: cv.chapterId, content: cv.content, word_count: cv.wordCount, author: cv.author, created_at: cv.createdAt };
}

export function skillToRow(s: Skill): DbRow {
  const fusionMeta: Record<string, unknown> = s.fusionMeta ? { ...s.fusionMeta } : {};
  if (s.deconstructionCardType) {
    fusionMeta.deconstructionCardType = s.deconstructionCardType;
  }
  if (s.executionScore !== undefined) {
    fusionMeta.executionScore = s.executionScore;
  }
  if (s.accessTier) {
    fusionMeta.accessTier = s.accessTier;
  }
  const extended = s as Skill & Record<string, unknown>;
  for (const key of ['sourceType', 'isRuntimeReady', 'sanitizationStatus', 'runtimeStatus']) {
    if (extended[key] !== undefined) fusionMeta[key] = extended[key];
  }
  const serializedFusionMeta = Object.keys(fusionMeta).length > 0 ? JSON.stringify(fusionMeta) : null;

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
    fusion_meta: serializedFusionMeta,
    method_chain: s.methodChain ? JSON.stringify(s.methodChain) : null,
    why_this_skill_works: s.whyThisSkillWorks || null,
    source_badge: s.sourceBadge || null,
    created_at: s.createdAt,
    updated_at: s.updatedAt || null,
  };
}

export function skillUsageRecordToRow(record: SkillUsageRecord): DbRow {
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

export function ideaFragmentToRow(f: IdeaFragment): DbRow {
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

export function foreshadowingToRow(f: Foreshadowing): DbRow {
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

export function chapterProductionRunToRow(run: ChapterProductionRun): DbRow {
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

export function mapContinuationPackRow(row: DbRow): ContinuationPack {
  const styleProfile = safeJsonParse<Partial<ContinuationStyleProfile>>(row.style_profile, {});
  styleProfile.proseTraits = styleProfile.proseTraits || [];
  styleProfile.avoidTraits = styleProfile.avoidTraits || [];
  styleProfile.pov = styleProfile.pov || '';
  styleProfile.pacing = styleProfile.pacing || '';
  styleProfile.dialogueDensity = styleProfile.dialogueDensity || '';

  const characterStates = safeJsonParse<ContinuationCharacterState[]>(row.character_states, []);
  for (const cs of characterStates) {
    cs.relationshipNotes = cs.relationshipNotes || [];
  }

  const plotState = safeJsonParse<Partial<ContinuationPlotState>>(row.plot_state, {});
  plotState.unresolvedHooks = plotState.unresolvedHooks || [];

  const rawSyncState = safeJsonParse<Partial<ContinuationSyncState>>(row.sync_state, {});
  const syncState: ContinuationSyncState = {
    status: rawSyncState.status === 'partial' || rawSyncState.status === 'synced' || rawSyncState.status === 'stale'
      ? rawSyncState.status
      : 'not_started',
    contentHash: typeof rawSyncState.contentHash === 'string' ? rawSyncState.contentHash : '',
    lastSyncedAt: typeof rawSyncState.lastSyncedAt === 'number' ? rawSyncState.lastSyncedAt : undefined,
    pendingRelationshipCount: typeof rawSyncState.pendingRelationshipCount === 'number' ? rawSyncState.pendingRelationshipCount : 0,
    summary: {
      characters: Number(rawSyncState.summary?.characters) || 0,
      locations: Number(rawSyncState.summary?.locations) || 0,
      items: Number(rawSyncState.summary?.items) || 0,
      factions: Number(rawSyncState.summary?.factions) || 0,
      powerLevels: Number(rawSyncState.summary?.powerLevels) || 0,
      timelineEvents: Number(rawSyncState.summary?.timelineEvents) || 0,
      relationships: Number(rawSyncState.summary?.relationships) || 0,
    },
  };

  return {
    id: row.id,
    novelId: row.novel_id,
    title: row.title,
    status: row.status,
    sourceDocuments: safeJsonParse<ContinuationSourceDocument[]>(row.source_documents, []),
    canonFacts: safeJsonParse<ContinuationCanonFact[]>(row.canon_facts, []),
    characterStates,
    plotState: plotState as ContinuationPlotState,
    styleProfile: styleProfile as ContinuationStyleProfile,
    contradictions: safeJsonParse<ContinuationContradiction[]>(row.contradictions, []),
    continuationTask: row.continuation_task,
    sourceMap: safeJsonParse<ContinuationSourceMap>(row.source_map, {} as ContinuationSourceMap),
    readingQuestions: safeJsonParse<ContinuationReadingQuestion[]>(row.reading_questions, []),
    continuationGaps: safeJsonParse<ContinuationGap[]>(row.continuation_gaps, []),
    sourceBadge: row.source_badge || undefined,
    syncState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computeContinuationPackContentHash(pack: ContinuationPack): string {
  const content = {
    sourceDocuments: pack.sourceDocuments,
    canonFacts: pack.canonFacts,
    characterStates: pack.characterStates,
    plotState: pack.plotState,
    styleProfile: pack.styleProfile,
    contradictions: pack.contradictions,
    continuationTask: pack.continuationTask,
    sourceMap: pack.sourceMap || {},
    readingQuestions: pack.readingQuestions || [],
    continuationGaps: pack.continuationGaps || [],
  };
  return createHash('sha256').update(stableJson(content)).digest('hex');
}

export function continuationPackToRow(pack: ContinuationPack): DbRow {
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
    sync_state: JSON.stringify(pack.syncState || {}),
    created_at: pack.createdAt,
    updated_at: pack.updatedAt,
  };
}
