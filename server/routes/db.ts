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
  getDb,
  isDbInitialized,
} from '../lib/db-instance';
import { bindClientDisconnect } from '../helpers/stream-disconnect';
import { clearEmbeddingCache } from '../vector-store';

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
  'listChapterProductionRuns', 'getChapterProductionRun', 'createChapterProductionRun', 'updateChapterProductionRun',
  'listContinuationPacks', 'getContinuationPack', 'createContinuationPack', 'updateContinuationPack', 'deleteContinuationPack',
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

type ForeignKeyDefinition = {
  table: string;
  from: string;
  to: string;
  on_delete: string;
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

    const requiredForeignKeys = [
      { table: 'chapters', from: 'novel_id', parentTable: 'novels', to: 'id' },
      { table: 'characters', from: 'novel_id', parentTable: 'novels', to: 'id' },
      { table: 'chapter_versions', from: 'chapter_id', parentTable: 'chapters', to: 'id' },
    ];
    for (const requirement of requiredForeignKeys) {
      const foreignKeys = candidate.pragma(`foreign_key_list(${requirement.table})`) as ForeignKeyDefinition[];
      const hasRequiredForeignKey = foreignKeys.some((foreignKey) => (
        foreignKey.table === requirement.parentTable
        && foreignKey.from === requirement.from
        && foreignKey.to === requirement.to
        && foreignKey.on_delete.toUpperCase() === 'CASCADE'
      ));
      if (!hasRequiredForeignKey) {
        throw new DatabaseImportValidationError(`Required foreign key is missing: ${requirement.table}.${requirement.from}`);
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
      advanceDatabaseGeneration();
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
  app.post('/api/db', validate(dbSchema), async (req, res) => {
    const { method, args = [] } = req.body;
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
      const result = await runInSerializedWrite(() => {
        const clientId = req.headers['x-client-id'] as string | undefined;
        setCurrentInitiator(clientId);
        try {
          return fn(...args);
        } finally {
          setCurrentInitiator(undefined);
        }
      });
      res.json({ result });
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
