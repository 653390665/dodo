import { randomUUID } from 'node:crypto';
import { logger } from '../logger';
import type { Express, Request, Response } from 'express';
import * as db from '../lib/db';
import { validate, dbSchema } from '../validation';
import express from 'express';
import { existsSync, unlinkSync } from 'fs';
import { DB_PATH } from '../lib/db-init';
import {
  getDatabaseGeneration,
  getDb,
  isDbInitialized,
  runInSerializedWriteForGeneration,
} from '../lib/db-instance';
import { openSseStream } from '../helpers/sse';
import { authMiddleware, issueDbEventToken } from '../middleware/auth';
import { CapabilityRoleAssignmentError } from '../capabilities/manifest';
import { preflightNovelEntity, DbEntitlementBoundaryError } from '../lib/db/novel-entity-preflight';
import { capabilityManifestFor, validateSkillCardForScope } from '../capabilities/manifest.js';
import { DatabaseImportValidationError, importDatabaseBuffer } from '../lib/db-import';

export {
  DB_IMPORT_BACKUP_MARKER,
  DB_IMPORT_TEMP_MARKER,
  MAX_IMPORT_BACKUPS,
  DatabaseImportValidationError,
  importDatabaseBuffer,
  pruneImportBackups,
  validateDatabaseImportFile,
} from '../lib/db-import';

function validateChapterCapabilityUpdate(chapterId: string, workflowMeta: unknown): void {
  if (!workflowMeta || typeof workflowMeta !== 'object') return;
  const state = (workflowMeta as Record<string, unknown>).capabilityState;
  if (state === undefined) return;
  if (!state || typeof state !== 'object') throw new Error('SCOPED_CONTEXT_REQUIRED');
  const chapter = db.getChapter(chapterId);
  const value = state as Record<string, unknown>;
  if (!chapter) throw new Error('CHAPTER_SCOPE_MISMATCH');
  if (typeof value.novelId !== 'string' || value.novelId !== chapter.novelId)
    throw new Error('CHAPTER_SCOPE_MISMATCH');
  if (
    !Number.isInteger(value.databaseGeneration) ||
    value.databaseGeneration !== getDatabaseGeneration()
  ) {
    throw new Error('DATABASE_GENERATION_STALE');
  }
  const techniques = value.techniqueIds;
  const overlays = value.overlayCardIds;
  if (
    !Array.isArray(techniques) ||
    !Array.isArray(overlays) ||
    techniques.some((id) => typeof id !== 'string') ||
    overlays.some((id) => typeof id !== 'string')
  )
    throw new Error('SCOPED_CONTEXT_REQUIRED');
  if (new Set([...techniques, ...overlays]).size !== techniques.length + overlays.length)
    throw new Error('CAPABILITY_MANIFEST_INVALID');
  const projectProfile = db.getNovel(chapter.novelId)?.projectPreferenceProfile?.capabilityProfile;
  const projectDeck = projectProfile?.projectSkillDeck;
  const projectCardCount = new Set(
    [projectDeck?.mainCardId, ...(projectDeck?.supportCardIds || [])].filter(
      (id): id is string => typeof id === 'string' && id.trim().length > 0
    )
  ).size;
  if (projectCardCount + overlays.length > 6) throw new Error('CAPABILITY_STATE_TOO_LARGE');
  const versions = (
    value.techniqueVersions && typeof value.techniqueVersions === 'object'
      ? value.techniqueVersions
      : {}
  ) as Record<string, unknown>;
  const overlayVersions = (
    value.overlayVersions && typeof value.overlayVersions === 'object' ? value.overlayVersions : {}
  ) as Record<string, unknown>;
  for (const id of techniques) {
    const manifest = capabilityManifestFor(id);
    if (
      !manifest ||
      manifest.kind !== 'technique' ||
      !manifest.allowedScopes.includes('chapter') ||
      manifest.runtimeStatus !== 'active'
    )
      throw new Error('CAPABILITY_MANIFEST_INVALID');
    if (versions[id] === undefined || String(versions[id]) !== String(manifest.version))
      throw new Error('DATABASE_GENERATION_STALE');
  }
  for (const id of overlays) {
    const manifest = capabilityManifestFor(id);
    const saved = db.getSkill(id);
    if (manifest) {
      if (
        manifest.kind !== 'skill-card' ||
        !manifest.allowedScopes.includes('chapter') ||
        manifest.runtimeStatus !== 'active'
      )
        throw new Error('CAPABILITY_MANIFEST_INVALID');
      if (
        overlayVersions[id] === undefined ||
        String(overlayVersions[id]) !== String(manifest.version)
      )
        throw new Error('DATABASE_GENERATION_STALE');
    } else {
      if (!saved) throw new Error('CAPABILITY_MANIFEST_INVALID');
      try {
        validateSkillCardForScope(saved, 'chapter');
      } catch {
        throw new Error('CAPABILITY_MANIFEST_INVALID');
      }
      if (
        overlayVersions[id] === undefined ||
        String(overlayVersions[id]) !== String(saved.version)
      )
        throw new Error('DATABASE_GENERATION_STALE');
    }
  }
}

const DB_WHITELIST = new Set([
  'listNovels',
  'getNovel',
  'createNovel',
  'updateNovel',
  'deleteNovel',
  'createNovelWithChapter',
  'createForeshadowingsBatch',
  'createSkillsBatch',
  'listChapters',
  'listChaptersMetadata',
  'listLibraryMetadata',
  'getChapter',
  'createChapter',
  'updateChapter',
  'deleteChapter',
  'listChapterVersions',
  'listChapterVersionMetas',
  'getChapterVersion',
  'createChapterVersion',
  'acceptChapterContentCandidate',
  'listCharacters',
  'getCharacter',
  'createCharacter',
  'updateCharacter',
  'deleteCharacter',
  'listLocations',
  'createLocation',
  'updateLocation',
  'deleteLocation',
  'listItems',
  'getItem',
  'createItem',
  'updateItem',
  'deleteItem',
  'listFactions',
  'createFaction',
  'updateFaction',
  'deleteFaction',
  'listPowerLevels',
  'createPowerLevel',
  'updatePowerLevel',
  'deletePowerLevel',
  'listTimelineEvents',
  'createTimelineEvent',
  'updateTimelineEvent',
  'deleteTimelineEvent',
  'listSkills',
  'getSkill',
  'createSkill',
  'updateSkill',
  'deleteSkill',
  'listSkillVersions',
  'listSkillUsageRecords',
  'syncSkillFeedbackScores',
  'createSkillUsageRecord',
  'listIdeaFragments',
  'createIdeaFragment',
  'updateIdeaFragment',
  'deleteIdeaFragment',
  'listForeshadowings',
  'getForeshadowing',
  'createForeshadowing',
  'updateForeshadowing',
  'deleteForeshadowing',
  'listChapterProductionRuns',
  'listChapterProductionRunBadges',
  'getChapterProductionRun',
  'listContinuationPacks',
  'getContinuationPack',
  'updateContinuationPack',
  'deleteContinuationPack',
  'listEntityRelationships',
  'createEntityRelationship',
  'updateEntityRelationship',
  'deleteEntityRelationship',
]);

const DB_GENERATION_CONFLICT_CODE = 'DB_GENERATION_CONFLICT';
const DB_GENERATION_CONFLICT_MESSAGE = '数据库已变化，请刷新后重试';

function databaseGenerationConflict(res: Response, message = DB_GENERATION_CONFLICT_MESSAGE) {
  return res.status(409).json({ code: DB_GENERATION_CONFLICT_CODE, message, error: message });
}

import { subscribe, setCurrentInitiator, runInSerializedWrite } from '../lib/db-instance';

/**
 * Keep the database event stream alive until the client actually disconnects.
 * The returned cleanup is idempotent so setup failures and disconnect events
 * can safely share the same teardown path.
 */
export function startDbEventStream(
  req: Request,
  res: Response,
  heartbeatIntervalMs = 30_000
): () => void {
  let cleanedUp = false;
  let unsubscribe = () => {};
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    unsubscribe();
  };
  const send = openSseStream(req, res, {
    heartbeatMs: heartbeatIntervalMs,
    onCleanup: cleanup,
  });
  unsubscribe = subscribe((initiatorId) => {
    if (!send({ initiator: initiatorId })) cleanup();
  });
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
    if (
      method === 'updateContinuationPack' &&
      args[1] &&
      typeof args[1] === 'object' &&
      'status' in args[1]
    ) {
      return res
        .status(400)
        .json({ error: '状态变更请使用 /api/continuation-packs/approve-import' });
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
          if (method === 'updateChapter')
            validateChapterCapabilityUpdate(
              args[0] as string,
              (args[1] as Record<string, unknown> | undefined)?.workflowMeta
            );
          if (method === 'acceptChapterContentCandidate') {
            const candidate = args[0] as Record<string, unknown>;
            validateChapterCapabilityUpdate(candidate.chapterId as string, candidate.workflowMeta);
          }
          if (
            method === 'createNovel' ||
            method === 'updateNovel' ||
            method === 'createNovelWithChapter'
          ) {
            const entity = (
              method === 'createNovel' || method === 'createNovelWithChapter' ? args[0] : args[1]
            ) as Record<string, unknown>;
            preflightNovelEntity(
              method,
              entity,
              method === 'updateNovel' ? (args[0] as string) : undefined,
              {
                getNovel: (id) => db.getNovel(id),
                getSkill: (id) => db.getSkill(id),
              }
            );
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
      if (e instanceof Error && e.message === 'DATABASE_GENERATION_STALE')
        return databaseGenerationConflict(res);
      if (e instanceof Error && e.message === 'CHAPTER_CANDIDATE_STALE') {
        return res.status(409).json({
          code: e.message,
          message: '正文已变化，候选已失效，请重新生成。',
          error: '正文已变化，候选已失效，请重新生成。',
        });
      }
      if (e instanceof Error && e.message === 'CHAPTER_CANDIDATE_SCOPE_MISMATCH') {
        return res.status(409).json({
          code: e.message,
          message: '章节已切换，候选未应用。',
          error: '章节已切换，候选未应用。',
        });
      }
      if (e instanceof Error && e.message.startsWith('CHAPTER_CANDIDATE_QUALITY_FAILED:')) {
        const detail = e.message.slice('CHAPTER_CANDIDATE_QUALITY_FAILED:'.length);
        return res.status(422).json({
          code: 'CHAPTER_CANDIDATE_QUALITY_FAILED',
          message: detail || '正文候选未通过质量门禁。',
          error: detail || '正文候选未通过质量门禁。',
        });
      }
      if (e instanceof Error && e.message === 'NOVEL_CHAPTER_SCOPE_MISMATCH') {
        return res.status(400).json({
          code: e.message,
          message: '首章必须属于新建作品。',
          error: '首章必须属于新建作品。',
        });
      }
      if (
        e instanceof Error &&
        [
          'SCOPED_CONTEXT_REQUIRED',
          'CHAPTER_SCOPE_MISMATCH',
          'CAPABILITY_MANIFEST_INVALID',
          'CAPABILITY_STATE_TOO_LARGE',
        ].includes(e.message)
      ) {
        return res
          .status(e.message === 'CHAPTER_SCOPE_MISMATCH' ? 403 : 400)
          .json({ error: '章节能力状态无效', code: e.message });
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
      logger.error('DB proxy error:', e);
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
        // 与导入侧 createImportTempPath（server/lib/db-import.ts）保持同一随机源策略
        const uniqueId = randomUUID();
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
    }
  );
}
