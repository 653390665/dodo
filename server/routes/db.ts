import { logger } from '../logger';
import type { Express, Request, Response } from 'express';
import * as db from '../lib/db';
import { validate, dbSchema } from '../validation';
import express from 'express';
import { existsSync, unlinkSync, writeFileSync, renameSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { DB_PATH, INKFLOW_SQLITE_APPLICATION_ID, initDb, openReadOnlyDb } from '../lib/db-init';
import {
  advanceDatabaseGeneration,
  closeDb,
  getDatabaseGeneration,
  getDb,
  isDbInitialized,
  runInSerializedWriteForGeneration,
} from '../lib/db-instance';
import { bindClientDisconnect } from '../helpers/stream-disconnect';
import { clearEmbeddingCache } from '../vector-store';
import { rebaseActiveQuotaReservationsAfterRollback } from '../helpers/quota-guard';
import { authMiddleware, issueDbEventToken } from '../middleware/auth';
import { CapabilityRoleAssignmentError } from '../capabilities/manifest';
import { preflightNovelEntity, DbEntitlementBoundaryError } from '../lib/db/novel-entity-preflight';
import { capabilityManifestFor, validateSkillCardForScope } from '../capabilities/manifest.js';

function validateChapterCapabilityUpdate(chapterId: string, workflowMeta: unknown): void {
  if (!workflowMeta || typeof workflowMeta !== 'object') return;
  const state = (workflowMeta as Record<string, unknown>).capabilityState;
  if (state === undefined) return;
  if (!state || typeof state !== 'object') throw new Error('SCOPED_CONTEXT_REQUIRED');
  const chapter = db.getChapter(chapterId);
  const value = state as Record<string, unknown>;
  if (!chapter) throw new Error('CHAPTER_SCOPE_MISMATCH');
  if (typeof value.novelId !== 'string' || value.novelId !== chapter.novelId) throw new Error('CHAPTER_SCOPE_MISMATCH');
  if (!Number.isInteger(value.databaseGeneration) || value.databaseGeneration !== getDatabaseGeneration()) {
    throw new Error('DATABASE_GENERATION_STALE');
  }
  const techniques = value.techniqueIds;
  const overlays = value.overlayCardIds;
  if (!Array.isArray(techniques) || !Array.isArray(overlays) || techniques.some((id) => typeof id !== 'string') || overlays.some((id) => typeof id !== 'string')) throw new Error('SCOPED_CONTEXT_REQUIRED');
  if (new Set([...techniques, ...overlays]).size !== techniques.length + overlays.length) throw new Error('CAPABILITY_MANIFEST_INVALID');
  const projectProfile = db.getNovel(chapter.novelId)?.projectPreferenceProfile?.capabilityProfile;
  const projectDeck = projectProfile?.projectSkillDeck;
  const projectCardCount = new Set([projectDeck?.mainCardId, ...(projectDeck?.supportCardIds || [])].filter((id): id is string => typeof id === 'string' && id.trim().length > 0)).size;
  if (projectCardCount + overlays.length > 6) throw new Error('CAPABILITY_STATE_TOO_LARGE');
  const versions = (value.techniqueVersions && typeof value.techniqueVersions === 'object' ? value.techniqueVersions : {}) as Record<string, unknown>;
  const overlayVersions = (value.overlayVersions && typeof value.overlayVersions === 'object' ? value.overlayVersions : {}) as Record<string, unknown>;
  for (const id of techniques) {
    const manifest = capabilityManifestFor(id);
    if (!manifest || manifest.kind !== 'technique' || !manifest.allowedScopes.includes('chapter') || manifest.runtimeStatus !== 'active') throw new Error('CAPABILITY_MANIFEST_INVALID');
    if (versions[id] === undefined || String(versions[id]) !== String(manifest.version)) throw new Error('DATABASE_GENERATION_STALE');
  }
  for (const id of overlays) {
    const manifest = capabilityManifestFor(id);
    const saved = db.getSkill(id);
    if (manifest) {
      if (manifest.kind !== 'skill-card' || !manifest.allowedScopes.includes('chapter') || manifest.runtimeStatus !== 'active') throw new Error('CAPABILITY_MANIFEST_INVALID');
      if (overlayVersions[id] === undefined || String(overlayVersions[id]) !== String(manifest.version)) throw new Error('DATABASE_GENERATION_STALE');
    } else {
      if (!saved) throw new Error('CAPABILITY_MANIFEST_INVALID');
      try { validateSkillCardForScope(saved, 'chapter'); } catch { throw new Error('CAPABILITY_MANIFEST_INVALID'); }
      if (overlayVersions[id] === undefined || String(overlayVersions[id]) !== String(saved.version)) throw new Error('DATABASE_GENERATION_STALE');
    }
  }
}

const DB_WHITELIST = new Set([
  'listNovels', 'getNovel', 'createNovel', 'updateNovel', 'deleteNovel',
  'createNovelWithChapter', 'createForeshadowingsBatch', 'createSkillsBatch',
  'listChapters', 'listChaptersMetadata', 'listLibraryMetadata', 'getChapter', 'createChapter', 'updateChapter', 'deleteChapter',
  'listChapterVersions', 'createChapterVersion', 'acceptChapterContentCandidate',
  'listCharacters', 'getCharacter', 'createCharacter', 'updateCharacter', 'deleteCharacter',
  'listLocations', 'createLocation', 'updateLocation', 'deleteLocation',
  'listItems', 'getItem', 'createItem', 'updateItem', 'deleteItem',
  'listFactions', 'createFaction', 'updateFaction', 'deleteFaction',
  'listPowerLevels', 'createPowerLevel', 'updatePowerLevel', 'deletePowerLevel',
  'listTimelineEvents', 'createTimelineEvent', 'updateTimelineEvent', 'deleteTimelineEvent',
  'listSkills', 'getSkill', 'createSkill', 'updateSkill', 'deleteSkill', 'listSkillVersions',
  'listSkillUsageRecords', 'syncSkillFeedbackScores', 'createSkillUsageRecord',
  'listIdeaFragments', 'createIdeaFragment', 'updateIdeaFragment', 'deleteIdeaFragment',
  'listForeshadowings', 'getForeshadowing', 'createForeshadowing', 'updateForeshadowing', 'deleteForeshadowing',
  'listChapterProductionRuns', 'getChapterProductionRun',
  'listContinuationPacks', 'getContinuationPack', 'updateContinuationPack', 'deleteContinuationPack',
  'listEntityRelationships', 'createEntityRelationship', 'updateEntityRelationship', 'deleteEntityRelationship',
]);

const DB_GENERATION_CONFLICT_CODE = 'DB_GENERATION_CONFLICT';
const DB_GENERATION_CONFLICT_MESSAGE = '数据库已变化，请刷新后重试';

function databaseGenerationConflict(res: Response, message = DB_GENERATION_CONFLICT_MESSAGE) {
  return res.status(409).json({ code: DB_GENERATION_CONFLICT_CODE, message, error: message });
}

import { subscribe, setCurrentInitiator, runInSerializedWrite } from '../lib/db-instance';

function removeDbSidecars(): void {
  for (const sidecarPath of [`${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    if (existsSync(sidecarPath)) {
      unlinkSync(sidecarPath);
    }
  }
}

export const DB_IMPORT_TEMP_MARKER = '.import-validation-';
export const DB_IMPORT_BACKUP_MARKER = '.pre-import-';
export const MAX_IMPORT_BACKUPS = 5;

/** Keep a small recovery window without retaining unlimited copies of novels. */
export function pruneImportBackups(maxBackups = MAX_IMPORT_BACKUPS): void {
  let backups: Array<{ filePath: string; modifiedAt: number }>;
  try {
    const directory = path.dirname(DB_PATH);
    const prefix = `${path.basename(DB_PATH)}${DB_IMPORT_BACKUP_MARKER}`;
    backups = readdirSync(directory)
      .filter((name) => name.startsWith(prefix) && name.endsWith('.bak'))
      .map((name) => {
        const filePath = path.join(directory, name);
        return { filePath, modifiedAt: statSync(filePath).mtimeMs };
      })
      .sort((left, right) => right.modifiedAt - left.modifiedAt);

  } catch (error) {
    logger.error('读取数据库导入备份列表失败:', error);
    return;
  }

  for (const backup of backups.slice(Math.max(0, maxBackups))) {
    try {
      unlinkSync(backup.filePath);
    } catch (error) {
      logger.error('清理过期数据库导入备份失败:', error);
    }
  }
}

export class DatabaseImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseImportValidationError';
  }
}

type TableColumn = {
  name: string;
  type: string;
  notnull: number;
  pk: number;
};

type TableXinfoColumn = TableColumn & {
  dflt_value: string | null;
  hidden: number;
};

type ForeignKeyDefinition = {
  table: string;
  from: string;
  to: string;
  on_delete: string;
  on_update: string;
  match: string;
};

type ImportColumnRequirement = {
  type: 'TEXT' | 'INTEGER';
  primaryKey?: boolean;
  notNull?: boolean;
  optional?: boolean;
};

const REQUIRED_IMPORT_SCHEMA: Record<string, Record<string, ImportColumnRequirement>> = {
  novels: {
    id: { type: 'TEXT', primaryKey: true },
    title: { type: 'TEXT', notNull: true },
    author_id: { type: 'TEXT', notNull: true },
    created_at: { type: 'INTEGER', notNull: true },
    updated_at: { type: 'INTEGER', notNull: true },
  },
  chapters: {
    id: { type: 'TEXT', primaryKey: true },
    novel_id: { type: 'TEXT', notNull: true },
    title: { type: 'TEXT' },
    content: { type: 'TEXT' },
    order: { type: 'INTEGER' },
    created_at: { type: 'INTEGER', notNull: true },
    updated_at: { type: 'INTEGER', notNull: true },
  },
  characters: {
    id: { type: 'TEXT', primaryKey: true },
    novel_id: { type: 'TEXT', notNull: true },
    name: { type: 'TEXT', notNull: true },
    bio: { type: 'TEXT' },
    created_at: { type: 'INTEGER', notNull: true },
    updated_at: { type: 'INTEGER', notNull: true },
  },
  chapter_versions: {
    id: { type: 'TEXT', primaryKey: true },
    chapter_id: { type: 'TEXT', notNull: true },
    content: { type: 'TEXT' },
    created_at: { type: 'INTEGER', notNull: true },
  },
};

const OPTIONAL_IMPORT_SCHEMA: Record<string, Record<string, ImportColumnRequirement>> = {
  capability_recommendation_dismissals: {
    novel_id: { type: 'TEXT', primaryKey: true, notNull: true },
    fingerprint: { type: 'TEXT', primaryKey: true, notNull: true },
    issue_fingerprint: { type: 'TEXT', notNull: true },
    artifact_version: { type: 'TEXT', notNull: true },
    upstream_version: { type: 'TEXT', notNull: true },
    capability_id: { type: 'TEXT', primaryKey: true, notNull: true },
    dismissed_at: { type: 'INTEGER', notNull: true },
  },
  chapter_completion_attempts: {
    id: { type: 'TEXT', primaryKey: true },
    novel_id: { type: 'TEXT', notNull: true },
    chapter_id: { type: 'TEXT', notNull: true },
    database_generation: { type: 'INTEGER', notNull: true },
    content_hash: { type: 'TEXT', notNull: true },
    plan_hash: { type: 'TEXT', notNull: true },
    phase: { type: 'TEXT', notNull: true },
    quality: { type: 'TEXT', notNull: true },
    issue_ids: { type: 'TEXT', notNull: true },
    unknown_checks: { type: 'TEXT', notNull: true },
    risk_accepted_at: { type: 'INTEGER' },
    fact_candidate_id: { type: 'TEXT' },
    result_json: { type: 'TEXT' },
    created_at: { type: 'INTEGER', notNull: true },
    updated_at: { type: 'INTEGER', notNull: true },
  },
  product_events: {
    id: { type: 'TEXT', primaryKey: true },
    event_name: { type: 'TEXT', notNull: true },
    stage: { type: 'TEXT', notNull: true },
    duration_ms: { type: 'INTEGER' },
    result: { type: 'TEXT', notNull: true },
    error_code: { type: 'TEXT' },
    novel_id: { type: 'TEXT' },
    chapter_id: { type: 'TEXT' },
    object_id: { type: 'TEXT' },
    quality_status: { type: 'TEXT' },
    created_at: { type: 'INTEGER', notNull: true },
  },
  chapter_production_run_versions: {
    id: { type: 'TEXT', primaryKey: true }, run_id: { type: 'TEXT', notNull: true }, novel_id: { type: 'TEXT', notNull: true },
    target_chapter_id: { type: 'TEXT' }, source: { type: 'TEXT', notNull: true }, scene_beats: { type: 'TEXT' }, draft_content: { type: 'TEXT' },
    style_audit: { type: 'TEXT' }, continuity_report: { type: 'TEXT' }, content_hash: { type: 'TEXT', notNull: true }, created_at: { type: 'INTEGER', notNull: true },
  },
  continuation_extraction_jobs: {
    id: { type: 'TEXT', primaryKey: true }, pack_id: { type: 'TEXT', notNull: true }, novel_id: { type: 'TEXT', notNull: true }, status: { type: 'TEXT', notNull: true },
    progress: { type: 'INTEGER' }, stage_text: { type: 'TEXT' }, batch_cursor: { type: 'INTEGER' }, total_batches: { type: 'INTEGER' }, result_json: { type: 'TEXT' }, checkpoint_json: { type: 'TEXT' },
    error_code: { type: 'TEXT' }, error_message: { type: 'TEXT' }, database_generation: { type: 'INTEGER', notNull: true }, created_at: { type: 'INTEGER', notNull: true }, updated_at: { type: 'INTEGER', notNull: true },
  },
  outline_artifacts: {
    id: { type: 'TEXT', primaryKey: true }, novel_id: { type: 'TEXT', notNull: true }, level: { type: 'TEXT', notNull: true },
    scope: { type: 'TEXT', notNull: true }, content: { type: 'TEXT', notNull: true }, source: { type: 'TEXT', notNull: true },
    status: { type: 'TEXT', notNull: true }, base_fingerprint: { type: 'TEXT' }, core_json: { type: 'TEXT', optional: true },
    source_capability_versions: { type: 'TEXT', optional: true }, created_at: { type: 'INTEGER', notNull: true }, updated_at: { type: 'INTEGER', notNull: true },
  },
  canon_patches: {
    id: { type: 'TEXT', primaryKey: true }, novel_id: { type: 'TEXT', notNull: true }, base_fingerprint: { type: 'TEXT', notNull: true },
    source_ability_id: { type: 'TEXT' }, operations: { type: 'TEXT', notNull: true }, status: { type: 'TEXT', notNull: true },
    result_fingerprint: { type: 'TEXT' }, result_json: { type: 'TEXT' }, decided_at: { type: 'INTEGER' },
    source_capability_versions: { type: 'TEXT', optional: true },
    created_at: { type: 'INTEGER', notNull: true }, updated_at: { type: 'INTEGER', notNull: true },
  },
  creative_artifact_cores: {
    id: { type: 'TEXT', primaryKey: true }, novel_id: { type: 'TEXT', notNull: true }, artifact_kind: { type: 'TEXT', notNull: true },
    artifact_id: { type: 'TEXT', notNull: true }, version: { type: 'INTEGER', notNull: true }, core_json: { type: 'TEXT', notNull: true },
    readable_content: { type: 'TEXT' }, provenance_json: { type: 'TEXT', notNull: true }, created_at: { type: 'INTEGER', notNull: true }, updated_at: { type: 'INTEGER', notNull: true },
  },
  creative_artifact_versions: {
    id: { type: 'TEXT', primaryKey: true }, novel_id: { type: 'TEXT', notNull: true }, artifact_kind: { type: 'TEXT', notNull: true },
    artifact_id: { type: 'TEXT', notNull: true }, version: { type: 'INTEGER', notNull: true }, core_json: { type: 'TEXT', notNull: true },
    readable_content: { type: 'TEXT' }, provenance_json: { type: 'TEXT', notNull: true }, created_at: { type: 'INTEGER', notNull: true },
  },
  creative_artifact_candidates: {
    id: { type: 'TEXT', primaryKey: true }, novel_id: { type: 'TEXT', notNull: true }, artifact_kind: { type: 'TEXT', notNull: true }, artifact_id: { type: 'TEXT', notNull: true },
    target_version: { type: 'INTEGER', notNull: true }, operation: { type: 'TEXT', notNull: true }, goal: { type: 'TEXT', notNull: true }, base_fingerprint: { type: 'TEXT', notNull: true },
    source_capability_versions: { type: 'TEXT', notNull: true }, proposed_core: { type: 'TEXT', notNull: true }, proposed_content: { type: 'TEXT' }, diff: { type: 'TEXT', notNull: true },
    impact_report: { type: 'TEXT', notNull: true }, status: { type: 'TEXT', notNull: true }, created_at: { type: 'INTEGER', notNull: true }, updated_at: { type: 'INTEGER', notNull: true },
    decided_at: { type: 'INTEGER' },
  },
  artifact_review_requirements: {
    id: { type: 'TEXT', primaryKey: true }, novel_id: { type: 'TEXT', notNull: true }, artifact_kind: { type: 'TEXT', notNull: true }, artifact_id: { type: 'TEXT', notNull: true },
    artifact_version: { type: 'INTEGER', notNull: true }, source_candidate_id: { type: 'TEXT' }, reason: { type: 'TEXT', notNull: true }, status: { type: 'TEXT', notNull: true },
    created_at: { type: 'INTEGER', notNull: true }, updated_at: { type: 'INTEGER', notNull: true }, resolved_at: { type: 'INTEGER' },
  },
  creation_flow_sessions: {
    id: { type: 'TEXT', primaryKey: true }, novel_id: { type: 'TEXT', notNull: true }, flow_id: { type: 'TEXT', notNull: true },
    frozen_definition_json: { type: 'TEXT', notNull: true }, current_step_id: { type: 'TEXT' }, accepted_output_refs_json: { type: 'TEXT', notNull: true },
    status: { type: 'TEXT', notNull: true }, database_generation: { type: 'INTEGER', notNull: true },
    created_at: { type: 'INTEGER', notNull: true }, updated_at: { type: 'INTEGER', notNull: true },
  },
};

const ALLOWED_IMPORT_TABLES = new Set([
  'capability_recommendation_dismissals',
  'chapter_completion_attempts',
  'product_events',
  'novels',
  'characters',
  'locations',
  'items',
  'factions',
  'power_levels',
  'timeline_events',
  'chapters',
  'chapter_versions',
  'skills',
  'skill_usage_records',
  'idea_fragments',
  'foreshadowings',
  'chapter_production_runs',
  'chapter_production_run_versions',
  'continuation_extraction_jobs',
  'continuation_packs',
  'vector_chunks',
  'entity_relationships',
  'outline_artifacts',
  'canon_patches',
  'creative_artifact_cores',
  'creative_artifact_versions',
  'creative_artifact_candidates',
  'artifact_review_requirements',
  'creation_flow_sessions',
]);

const ALLOWED_IMPORT_INDEXES = new Map<string, { tableName: string; columns: string[]; unique?: boolean; predicate?: string }>([
  ['idx_chapter_completion_attempts_novel_chapter', { tableName: 'chapter_completion_attempts', columns: ['novel_id', 'chapter_id', 'updated_at'] }],
  ['idx_product_events_created_at', { tableName: 'product_events', columns: ['created_at'] }],
  ['idx_product_events_event_name', { tableName: 'product_events', columns: ['event_name'] }],
  ['idx_characters_novel', { tableName: 'characters', columns: ['novel_id'] }],
  ['idx_locations_novel', { tableName: 'locations', columns: ['novel_id'] }],
  ['idx_items_novel', { tableName: 'items', columns: ['novel_id'] }],
  ['idx_factions_novel', { tableName: 'factions', columns: ['novel_id'] }],
  ['idx_power_levels_novel', { tableName: 'power_levels', columns: ['novel_id'] }],
  ['idx_timeline_events_novel', { tableName: 'timeline_events', columns: ['novel_id'] }],
  ['idx_chapters_novel', { tableName: 'chapters', columns: ['novel_id'] }],
  ['idx_chapter_versions_chapter', { tableName: 'chapter_versions', columns: ['chapter_id'] }],
  ['idx_idea_fragments_novel', { tableName: 'idea_fragments', columns: ['novel_id'] }],
  ['idx_foreshadowings_novel', { tableName: 'foreshadowings', columns: ['novel_id'] }],
  ['idx_chapter_production_runs_novel', { tableName: 'chapter_production_runs', columns: ['novel_id'] }],
  ['idx_production_run_versions_run', { tableName: 'chapter_production_run_versions', columns: ['run_id', 'created_at'] }],
  ['idx_production_run_versions_novel', { tableName: 'chapter_production_run_versions', columns: ['novel_id'] }],
  ['idx_continuation_extraction_jobs_pack', { tableName: 'continuation_extraction_jobs', columns: ['pack_id', 'updated_at'] }],
  ['idx_continuation_extraction_jobs_novel', { tableName: 'continuation_extraction_jobs', columns: ['novel_id'] }],
  ['idx_skill_usage_records_novel', { tableName: 'skill_usage_records', columns: ['novel_id'] }],
  ['idx_continuation_packs_novel', { tableName: 'continuation_packs', columns: ['novel_id'] }],
  ['idx_vector_chunks_novel', { tableName: 'vector_chunks', columns: ['novel_id'] }],
  ['idx_vector_chunks_chapter', { tableName: 'vector_chunks', columns: ['chapter_id'] }],
  ['idx_entity_relationships_novel', { tableName: 'entity_relationships', columns: ['novelId'] }],
  ['idx_entity_relationships_composite', { tableName: 'entity_relationships', columns: ['novelId', 'sourceId', 'targetId'] }],
  ['idx_outline_artifacts_one_active_master', { tableName: 'outline_artifacts', columns: ['novel_id'], unique: true, predicate: "level = 'master' AND status = 'active'" }],
  ['idx_creative_artifact_cores_identity', { tableName: 'creative_artifact_cores', columns: ['novel_id', 'artifact_kind', 'artifact_id'], unique: true }],
  ['idx_creative_artifact_versions_identity', { tableName: 'creative_artifact_versions', columns: ['novel_id', 'artifact_kind', 'artifact_id', 'version'], unique: true }],
  ['idx_creative_artifact_versions_novel', { tableName: 'creative_artifact_versions', columns: ['novel_id', 'artifact_kind', 'artifact_id'] }],
  ['idx_creative_artifact_candidates_status', { tableName: 'creative_artifact_candidates', columns: ['novel_id', 'status', 'created_at'] }],
  ['idx_creative_artifact_candidates_target', { tableName: 'creative_artifact_candidates', columns: ['novel_id', 'artifact_kind', 'artifact_id'] }],
  ['idx_artifact_review_requirements_lookup', { tableName: 'artifact_review_requirements', columns: ['novel_id', 'artifact_kind', 'artifact_id', 'status'] }],
  ['idx_artifact_review_requirements_candidate', { tableName: 'artifact_review_requirements', columns: ['source_candidate_id'] }],
  ['idx_creation_flow_sessions_novel', { tableName: 'creation_flow_sessions', columns: ['novel_id', 'created_at'] }],
  ['idx_creation_flow_sessions_one_active', { tableName: 'creation_flow_sessions', columns: ['novel_id'], unique: true, predicate: "status = 'active'" }],
]);

const COMPLETE_IMPORT_SCHEMA_GROUPS = [
  {
    tables: ['chapter_completion_attempts'],
    indexes: ['idx_chapter_completion_attempts_novel_chapter'],
  },
  {
    tables: ['outline_artifacts', 'canon_patches'],
    indexes: ['idx_outline_artifacts_one_active_master'],
  },
  {
    tables: ['creation_flow_sessions'],
    indexes: ['idx_creation_flow_sessions_novel', 'idx_creation_flow_sessions_one_active'],
  },
  {
    tables: [
      'creative_artifact_cores',
      'creative_artifact_versions',
      'creative_artifact_candidates',
      'artifact_review_requirements',
    ],
    indexes: [
      'idx_creative_artifact_cores_identity',
      'idx_creative_artifact_versions_identity',
      'idx_creative_artifact_versions_novel',
      'idx_creative_artifact_candidates_status',
      'idx_creative_artifact_candidates_target',
      'idx_artifact_review_requirements_lookup',
      'idx_artifact_review_requirements_candidate',
    ],
  },
] as const;

const EXPECTED_IMPORT_FOREIGN_KEYS = new Map<string, Array<{
  from: string;
  parentTable: string;
  to: string;
  onDelete: 'CASCADE' | 'SET NULL';
}>>([
  ['characters', [{ from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' }]],
  ['locations', [{ from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' }]],
  ['items', [{ from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' }]],
  ['factions', [{ from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' }]],
  ['power_levels', [{ from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' }]],
  ['timeline_events', [{ from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' }]],
  ['chapters', [{ from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' }]],
  ['chapter_versions', [{ from: 'chapter_id', parentTable: 'chapters', to: 'id', onDelete: 'CASCADE' }]],
  ['skill_usage_records', [
    { from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' },
    { from: 'chapter_id', parentTable: 'chapters', to: 'id', onDelete: 'SET NULL' },
  ]],
  ['idea_fragments', [{ from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' }]],
  ['foreshadowings', [{ from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' }]],
  ['chapter_production_runs', [
    { from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' },
    { from: 'target_chapter_id', parentTable: 'chapters', to: 'id', onDelete: 'SET NULL' },
  ]],
  ['chapter_production_run_versions', [
    { from: 'run_id', parentTable: 'chapter_production_runs', to: 'id', onDelete: 'CASCADE' },
    { from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' },
    { from: 'target_chapter_id', parentTable: 'chapters', to: 'id', onDelete: 'SET NULL' },
  ]],
  ['continuation_extraction_jobs', [
    { from: 'pack_id', parentTable: 'continuation_packs', to: 'id', onDelete: 'CASCADE' },
    { from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' },
  ]],
  ['entity_relationships', [{ from: 'novelId', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' }]],
  ['outline_artifacts', [{ from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' }]],
  ['canon_patches', [{ from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' }]],
  ['creative_artifact_cores', [{ from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' }]],
  ['creative_artifact_versions', [{ from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' }]],
  ['creative_artifact_candidates', [{ from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' }]],
  ['artifact_review_requirements', [
    { from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' },
    { from: 'source_candidate_id', parentTable: 'creative_artifact_candidates', to: 'id', onDelete: 'SET NULL' },
  ]],
  ['creation_flow_sessions', [{ from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' }]],
  ['chapter_completion_attempts', [
    { from: 'novel_id', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' },
    { from: 'chapter_id', parentTable: 'chapters', to: 'id', onDelete: 'CASCADE' },
  ]],
]);

function validateChapterCompletionConstraints(sql: string): void {
  const normalized = sql.replace(/\s+/g, ' ').trim();
  const qualityCheck = /CHECK\s*\(\s*quality\s+IN\s*\(\s*'pass'\s*,\s*'needs-action'\s*,\s*'unknown'\s*\)\s*\)/i;
  const phaseCheck = /CHECK\s*\(\s*phase\s+IN\s*\(\s*'writes-flushed'\s*,\s*'version-created'\s*,\s*'deterministic-checked'\s*,\s*'ai-reviewed'\s*,\s*'facts-proposed'\s*\)\s*\)/i;
  const uniqueConstraint = /UNIQUE\s*\(\s*novel_id\s*,\s*chapter_id\s*,\s*database_generation\s*,\s*content_hash\s*,\s*plan_hash\s*\)/i;
  if (!qualityCheck.test(normalized) || !phaseCheck.test(normalized) || !uniqueConstraint.test(normalized)) {
    throw new DatabaseImportValidationError('Chapter completion constraints do not match InkFlow schema');
  }
  if (
    /\bON\s+CONFLICT\b/i.test(normalized)
    || (normalized.match(/\bCHECK\s*\(/gi) || []).length !== 2
    || (normalized.match(/\bUNIQUE\s*\(/gi) || []).length !== 1
  ) {
    throw new DatabaseImportValidationError('Unexpected chapter completion constraints are not allowed');
  }
}

function hasSafeImportDefault(defaultValue: string | null): boolean {
  if (defaultValue === null) return true;
  let value = defaultValue.trim();
  while (value.startsWith('(') && value.endsWith(')')) {
    value = value.slice(1, -1).trim();
  }
  return /^(?:NULL|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?|'(?:''|[^'])*')$/i.test(value);
}

function schemaStructure(sql: string): string {
  return sql
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""')
    .replace(/`(?:``|[^`])*`/g, '``')
    .replace(/\[[^\]]*\]/g, '[]')
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function normalizeIndexPredicate(sql: string): string | null {
  const match = sql.match(/\bWHERE\s+(.+)$/i);
  return match?.[1].replace(/\s+/g, ' ').trim().replace(/"/g, "'").toLowerCase() || null;
}

function foreignKeySignature(foreignKey: ForeignKeyDefinition): string {
  return [
    foreignKey.from,
    foreignKey.table,
    foreignKey.to,
    foreignKey.on_delete.toUpperCase(),
    foreignKey.on_update.toUpperCase(),
    foreignKey.match.toUpperCase(),
  ].join('\u0000');
}

/**
 * Validate an uploaded database through a separate read-only connection.
 * Only the non-migratable core schema is required here; initDb remains
 * responsible for adding newer tables and optional columns to old backups.
 */
export function validateDatabaseImportFile(filePath: string, requireApplicationId = false): void {
  let candidate: ReturnType<typeof openReadOnlyDb> | undefined;
  try {
    candidate = openReadOnlyDb(filePath);

    const integrityRows = candidate.pragma('integrity_check') as Array<Record<string, unknown>>;
    if (
      integrityRows.length !== 1
      || String(Object.values(integrityRows[0] ?? {})[0]).toLowerCase() !== 'ok'
    ) {
      throw new DatabaseImportValidationError('SQLite integrity_check failed');
    }

    const applicationId = candidate.pragma('application_id', { simple: true }) as number;
    if (
      applicationId !== INKFLOW_SQLITE_APPLICATION_ID
      && (requireApplicationId || applicationId !== 0)
    ) {
      throw new DatabaseImportValidationError('SQLite application_id does not belong to InkFlow');
    }

    const foreignKeyRows = candidate.pragma('foreign_key_check') as Array<Record<string, unknown>>;
    if (foreignKeyRows.length > 0) {
      throw new DatabaseImportValidationError('SQLite foreign_key_check found violations');
    }

    const unsafeTableKinds = (candidate.pragma('table_list') as Array<{
      schema: string;
      name: string;
      type: string;
    }>).filter((table) => (
      table.schema === 'main'
      && !table.name.startsWith('sqlite_')
      && (table.type === 'virtual' || table.type === 'shadow')
    ));
    if (unsafeTableKinds.length > 0) {
      throw new DatabaseImportValidationError(`Virtual table is not allowed: ${unsafeTableKinds[0].name}`);
    }

    const allSchemaRows = candidate.prepare(`
      SELECT name, type, tbl_name AS tableName, sql
      FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%'
    `).all() as Array<{
      name: string;
      type: string;
      tableName: string;
      sql: string | null;
    }>;
    const existingTableNames = new Set(
      allSchemaRows.filter((row) => row.type === 'table').map((row) => row.name),
    );
    const existingIndexNames = new Set(
      allSchemaRows.filter((row) => row.type === 'index').map((row) => row.name),
    );
    for (const group of COMPLETE_IMPORT_SCHEMA_GROUPS) {
      const hasGovernanceSchema = group.tables.some((tableName) => existingTableNames.has(tableName))
        || group.indexes.some((indexName) => existingIndexNames.has(indexName));
      if (!hasGovernanceSchema) continue;
      const missingGovernanceObjects: string[] = group.tables.filter((tableName) => !existingTableNames.has(tableName));
      missingGovernanceObjects.push(...group.indexes.filter((indexName) => !existingIndexNames.has(indexName)));
      if (missingGovernanceObjects.length > 0) {
        throw new DatabaseImportValidationError(
          `Governance schema must be imported as a complete set: ${missingGovernanceObjects.join(', ')}`,
        );
      }
    }
    for (const row of allSchemaRows) {
      if (row.type === 'trigger' || row.type === 'view') {
        throw new DatabaseImportValidationError(`Executable schema object is not allowed: ${row.type} ${row.name}`);
      }
      if (row.type === 'table') {
        if (!ALLOWED_IMPORT_TABLES.has(row.name)) {
          throw new DatabaseImportValidationError(`Unexpected table is not allowed: ${row.name}`);
        }
        if (/^\s*CREATE\s+VIRTUAL\s+TABLE\b/i.test(row.sql || '')) {
          throw new DatabaseImportValidationError(`Virtual table is not allowed: ${row.name}`);
        }
        const structure = schemaStructure(row.sql || '');
        if (row.name === 'chapter_completion_attempts') {
          validateChapterCompletionConstraints(row.sql || '');
        } else if (/\bUNIQUE\b/i.test(structure) || /\bON\s+CONFLICT\b/i.test(structure)) {
          throw new DatabaseImportValidationError(`Unexpected table constraint is not allowed: ${row.name}`);
        }
        if (row.name !== 'chapter_completion_attempts' && /\bCHECK\s*\(/i.test(structure)) {
          throw new DatabaseImportValidationError(`Unexpected CHECK constraint is not allowed: ${row.name}`);
        }
        if (/\bDEFERRABLE\b/i.test(structure)) {
          throw new DatabaseImportValidationError(`Deferred foreign key is not allowed: ${row.name}`);
        }
        continue;
      }
      if (row.type === 'index') {
        const expectedIndex = ALLOWED_IMPORT_INDEXES.get(row.name);
        if (!expectedIndex || expectedIndex.tableName !== row.tableName) {
          throw new DatabaseImportValidationError(`Unexpected index is not allowed: ${row.name}`);
        }
        const indexList = candidate.pragma(`index_list(${expectedIndex.tableName})`) as Array<{
          name: string;
          unique: number;
          origin: string;
          partial: number;
        }>;
        const indexDefinition = indexList.find((index) => index.name === row.name);
        if (
          !indexDefinition
          || indexDefinition.unique !== (expectedIndex.unique ? 1 : 0)
          || indexDefinition.partial !== (expectedIndex.predicate ? 1 : 0)
          || indexDefinition.origin !== 'c'
          || (expectedIndex.predicate && normalizeIndexPredicate(row.sql || '') !== expectedIndex.predicate.toLowerCase())
        ) {
          throw new DatabaseImportValidationError(`Index has unsafe constraints: ${row.name}`);
        }
        const indexedColumns = (candidate.pragma(`index_xinfo(${row.name})`) as Array<{
          name: string | null;
          desc: number;
          coll: string;
          key: number;
        }>).filter((column) => column.key === 1);
        if (
          indexedColumns.length !== expectedIndex.columns.length
          || indexedColumns.some((column, index) => (
            column.name !== expectedIndex.columns[index]
            || column.desc !== 0
            || column.coll.toUpperCase() !== 'BINARY'
          ))
        ) {
          throw new DatabaseImportValidationError(`Index definition does not match InkFlow schema: ${row.name}`);
        }
        continue;
      }
      throw new DatabaseImportValidationError(`Unexpected schema object is not allowed: ${row.type} ${row.name}`);
    }

    // sqlite_autoindex_* rows are intentionally omitted by the sqlite_master
    // query above, but table-level UNIQUE/PRIMARY KEY constraints still create
    // them. Enumerate every table so an uploaded backup cannot smuggle in a
    // UNIQUE ... ON CONFLICT REPLACE constraint that changes later writes.
    for (const tableName of ALLOWED_IMPORT_TABLES) {
      if (!existingTableNames.has(tableName)) continue;
      const columns = candidate.pragma(`table_xinfo(${tableName})`) as TableXinfoColumn[];
      for (const column of columns) {
        if (column.hidden !== 0) {
          throw new DatabaseImportValidationError(`Generated or hidden column is not allowed: ${tableName}.${column.name}`);
        }
        if (!hasSafeImportDefault(column.dflt_value)) {
          throw new DatabaseImportValidationError(`Expression default is not allowed: ${tableName}.${column.name}`);
        }
      }

      const indexes = candidate.pragma(`index_list(${tableName})`) as Array<{
        name: string;
        unique: number;
        origin: string;
        partial: number;
      }>;
      for (const index of indexes) {
        if (ALLOWED_IMPORT_INDEXES.has(index.name)) continue;
        const isCapabilityRecommendationPrimaryKey = (
          tableName === 'capability_recommendation_dismissals'
          && index.name.startsWith(`sqlite_autoindex_${tableName}_`)
          && index.unique === 1
          && index.origin === 'pk'
          && index.partial === 0
        );
        if (isCapabilityRecommendationPrimaryKey) {
          const keyColumns = (candidate.pragma(`index_xinfo(${index.name})`) as Array<{
            name: string | null;
            desc: number;
            coll: string;
            key: number;
          }>).filter((column) => column.key === 1);
          if (
            keyColumns.length === 3
            && keyColumns.every((column, position) => (
              column.name === ['novel_id', 'fingerprint', 'capability_id'][position]
              && column.desc === 0
              && column.coll.toUpperCase() === 'BINARY'
            ))
          ) continue;
          throw new DatabaseImportValidationError(`Primary-key index does not match InkFlow schema: ${index.name}`);
        }
        if (
          tableName === 'chapter_completion_attempts'
          && index.name.startsWith(`sqlite_autoindex_${tableName}_`)
          && index.unique === 1
          && index.origin === 'u'
          && index.partial === 0
        ) {
          const keyColumns = (candidate.pragma(`index_xinfo(${index.name})`) as Array<{
            name: string | null;
            desc: number;
            coll: string;
            key: number;
          }>).filter((column) => column.key === 1);
          if (
            keyColumns.length === 5
            && keyColumns.every((column, position) => (
              column.name === ['novel_id', 'chapter_id', 'database_generation', 'content_hash', 'plan_hash'][position]
              && column.desc === 0
              && column.coll.toUpperCase() === 'BINARY'
            ))
          ) continue;
          throw new DatabaseImportValidationError(`Unique constraint does not match InkFlow schema: ${tableName}`);
        }
        if (
          !index.name.startsWith(`sqlite_autoindex_${tableName}_`)
          || index.unique !== 1
          || index.origin !== 'pk'
          || index.partial !== 0
        ) {
          throw new DatabaseImportValidationError(`Unexpected implicit index is not allowed: ${index.name}`);
        }
        const keyColumns = (candidate.pragma(`index_xinfo(${index.name})`) as Array<{
          name: string | null;
          desc: number;
          coll: string;
          key: number;
        }>).filter((column) => column.key === 1);
        if (
          keyColumns.length !== 1
          || keyColumns[0].name !== 'id'
          || keyColumns[0].desc !== 0
          || keyColumns[0].coll.toUpperCase() !== 'BINARY'
        ) {
          throw new DatabaseImportValidationError(`Primary-key index does not match InkFlow schema: ${index.name}`);
        }
      }
    }

    const schemaRows = candidate.prepare(`
      SELECT name, type
      FROM sqlite_master
      WHERE name IN ('novels', 'chapters', 'characters', 'chapter_versions')
    `).all() as Array<{ name: string; type: string }>;
    const tableTypes = new Map(schemaRows.map((row) => [row.name, row.type]));

    for (const [tableName, requiredColumns] of Object.entries(REQUIRED_IMPORT_SCHEMA)) {
      if (tableTypes.get(tableName) !== 'table') {
        throw new DatabaseImportValidationError(`Required table is missing or invalid: ${tableName}`);
      }

      const columns = candidate.pragma(`table_info(${tableName})`) as TableColumn[];
      const byName = new Map(columns.map((column) => [column.name, column]));
      for (const [columnName, requirement] of Object.entries(requiredColumns)) {
        const column = byName.get(columnName);
        if (!column) {
          throw new DatabaseImportValidationError(`Required column is missing: ${tableName}.${columnName}`);
        }
        if (column.type.toUpperCase() !== requirement.type) {
          throw new DatabaseImportValidationError(`Required column has an invalid type: ${tableName}.${columnName}`);
        }
        if (requirement.primaryKey && column.pk < 1) {
          throw new DatabaseImportValidationError(`Required primary key is missing: ${tableName}.${columnName}`);
        }
        if (requirement.notNull && column.notnull !== 1) {
          throw new DatabaseImportValidationError(`Required NOT NULL constraint is missing: ${tableName}.${columnName}`);
        }
      }
    }

    for (const [tableName, requiredColumns] of Object.entries(OPTIONAL_IMPORT_SCHEMA)) {
      if (!existingTableNames.has(tableName)) continue;
      const columns = candidate.pragma(`table_info(${tableName})`) as TableColumn[];
      const byName = new Map(columns.map((column) => [column.name, column]));
      for (const [columnName, requirement] of Object.entries(requiredColumns)) {
        const column = byName.get(columnName);
        if (!column) {
          if (requirement.optional) continue;
          throw new DatabaseImportValidationError(`Optional table column is missing: ${tableName}.${columnName}`);
        }
        if (column.type.toUpperCase() !== requirement.type) throw new DatabaseImportValidationError(`Optional table column has an invalid type: ${tableName}.${columnName}`);
        if (requirement.primaryKey && column.pk < 1) throw new DatabaseImportValidationError(`Optional table primary key is missing: ${tableName}.${columnName}`);
        if (requirement.notNull && column.notnull !== 1) throw new DatabaseImportValidationError(`Optional table NOT NULL constraint is missing: ${tableName}.${columnName}`);
      }
    }

    for (const tableName of ALLOWED_IMPORT_TABLES) {
      if (!existingTableNames.has(tableName)) continue;
      const actual = (candidate.pragma(`foreign_key_list(${tableName})`) as ForeignKeyDefinition[])
        .map(foreignKeySignature)
        .sort();
      const expected = (EXPECTED_IMPORT_FOREIGN_KEYS.get(tableName) || [])
        .map((foreignKey) => foreignKeySignature({
          table: foreignKey.parentTable,
          from: foreignKey.from,
          to: foreignKey.to,
          on_delete: foreignKey.onDelete,
          on_update: 'NO ACTION',
          match: 'NONE',
        }))
        .sort();
      if (actual.length !== expected.length || actual.some((signature, index) => signature !== expected[index])) {
        throw new DatabaseImportValidationError(`Foreign key definition does not match InkFlow schema: ${tableName}`);
      }
    }

    // Exercise the two critical read paths, including their relationship.
    candidate.prepare(`
      SELECT c.id, c.title, c.content, n.title AS novel_title
      FROM chapters c
      JOIN novels n ON n.id = c.novel_id
      ORDER BY c."order", c.created_at
      LIMIT 1
    `).all();
    candidate.prepare(`
      SELECT cv.id, cv.content, c.title, n.title AS novel_title
      FROM chapter_versions cv
      JOIN chapters c ON c.id = cv.chapter_id
      JOIN novels n ON n.id = c.novel_id
      ORDER BY cv.created_at DESC
      LIMIT 1
    `).all();
  } catch (error) {
    if (error instanceof DatabaseImportValidationError) throw error;
    throw new DatabaseImportValidationError(
      `Unable to validate SQLite backup: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    candidate?.close();
  }
}

function createImportTempPath(): string {
  return path.join(
    path.dirname(DB_PATH),
    `${path.basename(DB_PATH)}${DB_IMPORT_TEMP_MARKER}${randomUUID()}`,
  );
}

function removeImportTempFiles(importTempPath: string): void {
  for (const temporaryPath of [
    importTempPath,
    `${importTempPath}-wal`,
    `${importTempPath}-shm`,
    `${importTempPath}.rollback`,
  ]) {
    try {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    } catch (unlinkErr) {
      logger.error('删除数据库导入验证临时文件失败:', unlinkErr);
    }
  }
}

/**
 * Replace the active database without allowing a queued write to cross the
 * close/replace/reinitialize boundary. Entering the FIFO queue is itself the
 * wait for all writes that were already queued; draining from inside the task
 * would wait on the task's own promise and deadlock.
 */
export async function importDatabaseBuffer(
  buffer: Buffer,
  initialize: () => void = initDb,
): Promise<void> {
  const backupPath = `${DB_PATH}${DB_IMPORT_BACKUP_MARKER}${Date.now()}-${randomUUID()}.bak`;
  const importTempPath = createImportTempPath();

  try {
    // `flag: wx` guarantees that even an extremely unlikely UUID collision
    // cannot overwrite another in-flight import candidate.
    writeFileSync(importTempPath, buffer, { flag: 'wx', mode: 0o600 });
    validateDatabaseImportFile(importTempPath);

    await runInSerializedWrite(async () => {
      // Invalidate every async operation that started against the old file
      // before closing it. Rollback still represents a new mounted generation.
      const previousGeneration = getDatabaseGeneration();
      const replacementGeneration = advanceDatabaseGeneration();
      let backupReady = false;
      let hadExistingDatabase = false;
      try {
        hadExistingDatabase = existsSync(DB_PATH);
        if (hadExistingDatabase) {
          if (isDbInitialized()) {
            getDb().pragma('wal_checkpoint(TRUNCATE)');
            await getDb().backup(backupPath);
          } else {
            const existingDb = openReadOnlyDb(DB_PATH);
            try {
              await existingDb.backup(backupPath);
            } finally {
              existingDb.close();
            }
          }
          backupReady = true;
        }
        closeDb();

        removeDbSidecars();
        renameSync(importTempPath, DB_PATH);
        initialize();
        validateDatabaseImportFile(DB_PATH, true);
        clearEmbeddingCache();
        pruneImportBackups();
      } catch (err: unknown) {
        logger.error('还原数据库失败，正在执行自动容灾回滚:', err);
        try {
          closeDb();

          if (backupReady && existsSync(backupPath)) {
            const rollbackTempPath = `${importTempPath}.rollback`;
            const rollbackDb = openReadOnlyDb(backupPath);
            try {
              await rollbackDb.backup(rollbackTempPath);
            } finally {
              rollbackDb.close();
            }
            renameSync(rollbackTempPath, DB_PATH);
          } else if (!hadExistingDatabase && existsSync(DB_PATH)) {
            unlinkSync(DB_PATH);
          }

          removeDbSidecars();
          initialize();
          clearEmbeddingCache();
          rebaseActiveQuotaReservationsAfterRollback(previousGeneration, replacementGeneration);
        } catch (restoreErr) {
          logger.error('严重警告：数据库还原回滚失败！', restoreErr);
        }
        throw err;
      }
    });
  } finally {
    removeImportTempFiles(importTempPath);
  }
}

/**
 * Keep the database event stream alive until the client actually disconnects.
 * The returned cleanup is idempotent so setup failures and disconnect events
 * can safely share the same teardown path.
 */
export function startDbEventStream(
  req: Request,
  res: Response,
  heartbeatIntervalMs = 30_000,
): () => void {
  let cleanedUp = false;
  let disposeDisconnect = () => {};
  let unsubscribe = () => {};
  const isWritable = () => res.writable !== false && !res.writableEnded && !res.destroyed && !res.closed;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeatTimer);
    unsubscribe();
    disposeDisconnect();
  };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const heartbeatTimer = setInterval(() => {
    if (!isWritable()) {
      cleanup();
      return;
    }
    res.write(':ping\n\n');
  }, heartbeatIntervalMs);

  if (!isWritable()) return cleanup;
  res.write('retry: 3000\n\n');
  req.socket.setTimeout(0);

  unsubscribe = subscribe((initiatorId) => {
    if (!isWritable()) {
      cleanup();
      return;
    }
    res.write(`data: ${JSON.stringify({ initiator: initiatorId })}\n\n`);
  });
  disposeDisconnect = bindClientDisconnect(req, res, cleanup);
  return cleanup;
}

export function registerDbRoutes(app: Express) {
  app.post('/api/db/events-token', authMiddleware, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(issueDbEventToken());
  });

  app.get('/api/db/generation', (_req, res) => {
    res.json({ databaseGeneration: getDatabaseGeneration() });
  });
  app.post('/api/db', validate(dbSchema), async (req, res) => {
    const { method, args = [], databaseGeneration } = req.body;
    if (!DB_WHITELIST.has(method)) {
      return res.status(400).json({ error: `Unknown method: ${method}` });
    }
    if (method === 'updateContinuationPack' && args[1] && typeof args[1] === 'object' && 'status' in args[1]) {
      return res.status(400).json({ error: '状态变更请使用 /api/continuation-packs/approve-import' });
    }
    const fn = (db as unknown as Record<string, Function>)[method];
    if (typeof fn !== 'function') {
      return res.status(500).json({ error: `Method not a function: ${method}` });
    }
    try {
      // All proxy calls share the same FIFO boundary as database replacement.
      // This also keeps the module-level initiator scoped to exactly one call.
      const invoke = () => {
        const clientId = req.headers['x-client-id'] as string | undefined;
          setCurrentInitiator(clientId);
        try {
          if (method === 'updateChapter') validateChapterCapabilityUpdate(args[0] as string, (args[1] as Record<string, unknown> | undefined)?.workflowMeta);
          if (method === 'acceptChapterContentCandidate') {
            const candidate = args[0] as Record<string, unknown>;
            validateChapterCapabilityUpdate(candidate.chapterId as string, candidate.workflowMeta);
          }
          if (method === 'createNovel' || method === 'updateNovel' || method === 'createNovelWithChapter') {
            const entity = (method === 'createNovel' || method === 'createNovelWithChapter' ? args[0] : args[1]) as Record<string, unknown>;
            preflightNovelEntity(method, entity, method === 'updateNovel' ? args[0] as string : undefined, {
              getNovel: (id) => db.getNovel(id),
              getSkill: (id) => db.getSkill(id),
            });
          }
          return fn(...args);
        } finally {
          setCurrentInitiator(undefined);
        }
      };
      if (databaseGeneration !== undefined) {
        const guarded = await runInSerializedWriteForGeneration(databaseGeneration, invoke);
        if (!guarded.executed) {
          return databaseGenerationConflict(res);
        }
        return res.json({ result: guarded.result });
      }
      const result = await runInSerializedWrite(invoke);
      return res.json({ result });
    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'DATABASE_GENERATION_STALE') return databaseGenerationConflict(res);
      if (e instanceof Error && e.message === 'CHAPTER_CANDIDATE_STALE') {
        return res.status(409).json({ code: e.message, message: '正文已变化，候选已失效，请重新生成。', error: '正文已变化，候选已失效，请重新生成。' });
      }
      if (e instanceof Error && e.message === 'CHAPTER_CANDIDATE_SCOPE_MISMATCH') {
        return res.status(409).json({ code: e.message, message: '章节已切换，候选未应用。', error: '章节已切换，候选未应用。' });
      }
      if (e instanceof Error && e.message.startsWith('CHAPTER_CANDIDATE_QUALITY_FAILED:')) {
        const detail = e.message.slice('CHAPTER_CANDIDATE_QUALITY_FAILED:'.length);
        return res.status(422).json({ code: 'CHAPTER_CANDIDATE_QUALITY_FAILED', message: detail || '正文候选未通过质量门禁。', error: detail || '正文候选未通过质量门禁。' });
      }
      if (e instanceof Error && e.message === 'NOVEL_CHAPTER_SCOPE_MISMATCH') {
        return res.status(400).json({ code: e.message, message: '首章必须属于新建作品。', error: '首章必须属于新建作品。' });
      }
      if (e instanceof Error && ['SCOPED_CONTEXT_REQUIRED', 'CHAPTER_SCOPE_MISMATCH', 'CAPABILITY_MANIFEST_INVALID', 'CAPABILITY_STATE_TOO_LARGE'].includes(e.message)) {
        return res.status(e.message === 'CHAPTER_SCOPE_MISMATCH' ? 403 : 400).json({ error: '章节能力状态无效', code: e.message });
      }
      if (e instanceof CapabilityRoleAssignmentError) {
        return res.status(400).json({ error: e.message.replace(`${e.code}: `, ''), code: e.code });
      }
      if (e instanceof DbEntitlementBoundaryError) {
        return res.status(403).json({ error: e.message, code: 'DB_ENTITLEMENT_FORBIDDEN' });
      }
      if ((method === 'createSkill' || method === 'updateSkill') && e instanceof Error) {
        return res.status(400).json({ error: e.message, code: 'SKILL_FUSION_FORBIDDEN' });
      }
      logger.error("DB proxy error:", e);
      res.status(500).json({ error: '数据库操作失败，请稍后重试。' });
    }
  });

  app.get('/api/db/events', authMiddleware, (req, res) => {
    try {
      startDbEventStream(req, res);
    } catch (e) {
      logger.error('SSE events error:', e);
      if (!res.headersSent) res.status(500).json({ error: 'SSE connection failed' });
    }
  });

  // 一键冷备数据下载
  app.get('/api/db/export-file', async (req, res) => {
    try {
      const tempBackupPath = await runInSerializedWrite(async () => {
        if (!isDbInitialized()) return null;
        const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const backupPath = `${DB_PATH}-${uniqueId}.temp-export`;
        // 使用 better-sqlite3 提供的符合事务一致性快照的备份 API
        await getDb().backup(backupPath);
        return backupPath;
      });

      if (tempBackupPath) {
        res.download(tempBackupPath, 'inkflow-data.db', (err) => {
          try {
            if (existsSync(tempBackupPath)) {
              unlinkSync(tempBackupPath);
            }
          } catch (unlinkErr) {
            logger.error('删除临时导出数据库文件失败:', unlinkErr);
          }
          if (err && !res.headersSent) {
            logger.error('下载数据库备份文件失败:', err);
          }
        });
      } else if (existsSync(DB_PATH)) {
        res.download(DB_PATH, 'inkflow-data.db');
      } else {
        res.status(404).json({ error: '数据文件不存在，请先初始化系统。' });
      }
    } catch (e) {
      logger.error('导出数据库失败:', e);
      res.status(500).json({ error: '导出数据库失败' });
    }
  });

  // 导入还原备份，带安全容灾校验与原子回滚
  app.post(
    '/api/db/import-file',
    express.raw({ limit: '100mb', type: 'application/octet-stream' }),
    async (req, res) => {
      const buffer = req.body;
      if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
        return res.status(400).json({ error: '接收到的数据库文件为空' });
      }

      try {
        await importDatabaseBuffer(buffer);

        res.json({ success: true });
      } catch (err: unknown) {
        logger.error('数据库导入失败:', err);
        const status = err instanceof DatabaseImportValidationError ? 400 : 500;
        res.status(status).json({ error: '数据库导入失败，请确认备份文件有效' });
      }
    },
  );
}
