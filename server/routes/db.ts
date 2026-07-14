import { logger } from '../logger';
import type { Express, Request, Response } from 'express';
import * as db from '../lib/db';
import { validate, dbSchema } from '../validation';
import express from 'express';
import { existsSync, unlinkSync, copyFileSync, writeFileSync, renameSync, readdirSync, statSync } from 'fs';
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

const DB_WHITELIST = new Set([
  'listNovels', 'getNovel', 'createNovel', 'updateNovel', 'deleteNovel',
  'listChapters', 'listChaptersMetadata', 'getChapter', 'createChapter', 'updateChapter', 'deleteChapter',
  'listChapterVersions', 'createChapterVersion',
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

const REQUIRED_IMPORT_SCHEMA: Record<string, Record<string, {
  type: 'TEXT' | 'INTEGER';
  primaryKey?: boolean;
  notNull?: boolean;
}>> = {
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

const ALLOWED_IMPORT_TABLES = new Set([
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
  'continuation_packs',
  'vector_chunks',
  'entity_relationships',
]);

const ALLOWED_IMPORT_INDEXES = new Map<string, { tableName: string; columns: string[] }>([
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
  ['idx_skill_usage_records_novel', { tableName: 'skill_usage_records', columns: ['novel_id'] }],
  ['idx_continuation_packs_novel', { tableName: 'continuation_packs', columns: ['novel_id'] }],
  ['idx_vector_chunks_novel', { tableName: 'vector_chunks', columns: ['novel_id'] }],
  ['idx_vector_chunks_chapter', { tableName: 'vector_chunks', columns: ['chapter_id'] }],
  ['idx_entity_relationships_novel', { tableName: 'entity_relationships', columns: ['novelId'] }],
  ['idx_entity_relationships_composite', { tableName: 'entity_relationships', columns: ['novelId', 'sourceId', 'targetId'] }],
]);

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
  ['entity_relationships', [{ from: 'novelId', parentTable: 'novels', to: 'id', onDelete: 'CASCADE' }]],
]);

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
        if (/\bUNIQUE\b/i.test(structure) || /\bON\s+CONFLICT\b/i.test(structure)) {
          throw new DatabaseImportValidationError(`Unexpected table constraint is not allowed: ${row.name}`);
        }
        if (/\bCHECK\s*\(/i.test(structure)) {
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
          || indexDefinition.unique !== 0
          || indexDefinition.partial !== 0
          || indexDefinition.origin !== 'c'
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
        if (isDbInitialized()) {
          getDb().pragma('wal_checkpoint(TRUNCATE)');
        }
        closeDb();

        hadExistingDatabase = existsSync(DB_PATH);
        if (hadExistingDatabase) {
          copyFileSync(DB_PATH, backupPath);
          backupReady = true;
        }

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
            copyFileSync(backupPath, rollbackTempPath);
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
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write('retry: 3000\n\n');
  req.socket.setTimeout(0);

  let cleanedUp = false;
  let disposeDisconnect = () => {};
  const unsubscribe = subscribe((initiatorId) => {
    res.write(`data: ${JSON.stringify({ initiator: initiatorId })}\n\n`);
  });
  const heartbeat = setInterval(() => {
    res.write(':ping\n\n');
  }, heartbeatIntervalMs);

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    unsubscribe();
    disposeDisconnect();
  };

  disposeDisconnect = bindClientDisconnect(req, res, cleanup);
  return cleanup;
}

export function registerDbRoutes(app: Express) {
  app.get('/api/db/generation', (_req, res) => {
    res.json({ databaseGeneration: getDatabaseGeneration() });
  });
  app.post('/api/db', validate(dbSchema), async (req, res) => {
    const { method, args = [], databaseGeneration } = req.body;
    if (!DB_WHITELIST.has(method)) {
      return res.status(400).json({ error: `Unknown method: ${method}` });
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
          return fn(...args);
        } finally {
          setCurrentInitiator(undefined);
        }
      };
      if (databaseGeneration !== undefined) {
        const guarded = await runInSerializedWriteForGeneration(databaseGeneration, invoke);
        if (!guarded.executed) {
          return res.status(409).json({ error: '数据库已切换，旧页面写入已拒绝' });
        }
        return res.json({ result: guarded.result });
      }
      const result = await runInSerializedWrite(invoke);
      return res.json({ result });
    } catch (e: unknown) {
      logger.error("DB proxy error:", e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/db/events', (req, res) => {
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
