import type {
  Novel, Character, Location, Item, Faction, PowerLevel, TimelineEvent,
  Chapter, ChapterVersion, Skill, SkillUsageRecord, IdeaFragment,
  Foreshadowing, ChapterProductionRun, ContinuationPack
} from '../../shared/types';

type SafeAny = any;
export type DbRow = SafeAny;

export function rowToNovel(row: DbRow): Novel {
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

export function rowToCharacter(row: DbRow): Character {
  return {
    ...row,
    novelId: row.novel_id,
    traits: JSON.parse(row.traits || '[]'),
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
  return { ...row, novelId: row.novel_id, volumeName: row.volume_name, wordCount: row.word_count, sceneBeats: row.scene_beats, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function rowToChapterVersion(row: DbRow): ChapterVersion {
  return { ...row, chapterId: row.chapter_id, wordCount: row.word_count, createdAt: row.created_at };
}

export function rowToSkill(row: DbRow): Skill {
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

export function rowToSkillUsageRecord(row: DbRow): SkillUsageRecord {
  return {
    ...row,
    novelId: row.novel_id,
    chapterId: row.chapter_id || undefined,
    mountedSkillIds: JSON.parse(row.mounted_skill_ids || '[]'),
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
    relatedCharacterIds: JSON.parse(row.related_character_ids || '[]'),
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
    continuityReport: JSON.parse(row.continuity_report || '{}'),
    errorMessage: row.error_message || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
  return { id: c.id, novel_id: c.novelId, volume_name: c.volumeName, title: c.title, content: c.content, order: c.order, word_count: c.wordCount, scene_beats: c.sceneBeats, critique: c.critique, created_at: c.createdAt, updated_at: c.updatedAt };
}

export function chapterVersionToRow(cv: ChapterVersion): DbRow {
  return { id: cv.id, chapter_id: cv.chapterId, content: cv.content, word_count: cv.wordCount, author: cv.author, created_at: cv.createdAt };
}

export function skillToRow(s: Skill): DbRow {
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
  const styleProfile = JSON.parse(row.style_profile || '{}');
  styleProfile.proseTraits = styleProfile.proseTraits || [];
  styleProfile.avoidTraits = styleProfile.avoidTraits || [];
  styleProfile.pov = styleProfile.pov || '';
  styleProfile.pacing = styleProfile.pacing || '';
  styleProfile.dialogueDensity = styleProfile.dialogueDensity || '';

  const characterStates = JSON.parse(row.character_states || '[]');
  for (const cs of characterStates) {
    cs.relationshipNotes = cs.relationshipNotes || [];
  }

  const plotState = JSON.parse(row.plot_state || '{}');
  plotState.unresolvedHooks = plotState.unresolvedHooks || [];

  return {
    id: row.id,
    novelId: row.novel_id,
    title: row.title,
    status: row.status,
    sourceDocuments: JSON.parse(row.source_documents || '[]'),
    canonFacts: JSON.parse(row.canon_facts || '[]'),
    characterStates,
    plotState,
    styleProfile,
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
    created_at: pack.createdAt,
    updated_at: pack.updatedAt,
  };
}
