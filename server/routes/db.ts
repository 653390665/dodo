import { logger } from '../logger';
import type { Express } from 'express';
import * as db from '../lib/db';
import { validate, dbSchema } from '../validation';
import express from 'express';
import { existsSync, unlinkSync, copyFileSync, writeFileSync } from 'fs';
import { DB_PATH, initDb } from '../lib/db-init';
import { closeDb, getDb, isDbInitialized } from '../lib/db-instance';

const DB_WHITELIST = new Set([
  'listNovels', 'getNovel', 'createNovel', 'updateNovel', 'deleteNovel',
  'listChapters', 'listChaptersMetadata', 'getChapter', 'createChapter', 'updateChapter', 'deleteChapter', 'reorderChapters',
  'listChapterVersions', 'getChapterVersion', 'createChapterVersion', 'deleteChapterVersion',
  'listScenes', 'getScene', 'createScene', 'updateScene', 'deleteScene',
  'listCharacters', 'createCharacter', 'updateCharacter', 'deleteCharacter',
  'listLocations', 'createLocation', 'updateLocation', 'deleteLocation',
  'listItems', 'createItem', 'updateItem', 'deleteItem',
  'listFactions', 'createFaction', 'updateFaction', 'deleteFaction',
  'listPowerLevels', 'createPowerLevel', 'updatePowerLevel', 'deletePowerLevel',
  'listTimelineEvents', 'createTimelineEvent', 'updateTimelineEvent', 'deleteTimelineEvent',
  'listSkills', 'getSkill', 'createSkill', 'updateSkill', 'deleteSkill', 'listSkillVersions',
  'listSkillUsageRecords', 'syncSkillFeedbackScores', 'createSkillUsageRecord',
  'listIdeaFragments', 'createIdeaFragment', 'updateIdeaFragment', 'deleteIdeaFragment',
  'listForeshadowings', 'createForeshadowing', 'updateForeshadowing', 'deleteForeshadowing',
  'listChapterProductionRuns', 'getChapterProductionRun', 'createChapterProductionRun', 'updateChapterProductionRun', 'deleteChapterProductionRun',
  'listContinuationPacks', 'getContinuationPack', 'createContinuationPack', 'updateContinuationPack', 'deleteContinuationPack',
  'listEntityRelationships', 'createEntityRelationship', 'updateEntityRelationship', 'deleteEntityRelationship',
]);

import { subscribe, setCurrentInitiator, runInSerializedWrite, drainWriteQueue } from '../lib/db-instance';

export function registerDbRoutes(app: Express) {
  app.post('/api/db', validate(dbSchema), (req, res) => {
    const { method, args = [] } = req.body;
    if (!DB_WHITELIST.has(method)) {
      return res.status(400).json({ error: `Unknown method: ${method}` });
    }
    const fn = (db as unknown as Record<string, Function>)[method];
    if (typeof fn !== 'function') {
      return res.status(500).json({ error: `Method not a function: ${method}` });
    }
    const clientId = req.headers['x-client-id'] as string | undefined;
    if (clientId) {
      setCurrentInitiator(clientId);
    }
    try {
      const result = fn(...args);
      res.json({ result });
    } catch (e: unknown) {
      logger.error("DB proxy error:", e);
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      if (clientId) {
        setCurrentInitiator(undefined);
      }
    }
  });

  app.get('/api/db/events', (req, res) => {
    try {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      res.write('retry: 3000\n\n');
      req.socket.setTimeout(0);

      const unsub = subscribe((initiatorId) => {
        res.write(`data: ${JSON.stringify({ initiator: initiatorId })}\n\n`);
      });

      const heartbeat = setInterval(() => {
        res.write(':ping\n\n');
      }, 30_000);

      req.on('close', () => {
        clearInterval(heartbeat);
        unsub();
      });
    } catch (e) {
      logger.error('SSE events error:', e);
      if (!res.headersSent) res.status(500).json({ error: 'SSE connection failed' });
    }
  });

  // 一键冷备数据下载
  app.get('/api/db/export-file', async (req, res) => {
    try {
      if (isDbInitialized()) {
        const activeDb = getDb();
        const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const tempBackupPath = `${DB_PATH}-${uniqueId}.temp-export`;
        // 使用 better-sqlite3 提供的符合事务一致性快照的备份 API
        await activeDb.backup(tempBackupPath);

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

      const magic = buffer.toString('utf8', 0, 15);
      if (magic !== 'SQLite format 3') {
        return res.status(400).json({ error: '无效的 SQLite 数据库文件格式' });
      }

      const backupPath = DB_PATH + '.pre-import-bak';

      try {
        await runInSerializedWrite(async () => {
          await drainWriteQueue();
          closeDb();

          if (existsSync(DB_PATH)) {
            copyFileSync(DB_PATH, backupPath);
          }

          const walPath = DB_PATH + '-wal';
          const shmPath = DB_PATH + '-shm';
          if (existsSync(walPath)) {
            unlinkSync(walPath);
          }
          if (existsSync(shmPath)) {
            unlinkSync(shmPath);
          }

          writeFileSync(DB_PATH, buffer);
          initDb();
        });

        res.json({ success: true });
      } catch (err: unknown) {
        logger.error('还原数据库失败，正在执行自动容灾回滚:', err);
        try {
          await runInSerializedWrite(async () => {
            await drainWriteQueue();
            closeDb();

            if (existsSync(backupPath)) {
              copyFileSync(backupPath, DB_PATH);
            }

            const walPath = DB_PATH + '-wal';
            const shmPath = DB_PATH + '-shm';
            if (existsSync(walPath)) {
              unlinkSync(walPath);
            }
            if (existsSync(shmPath)) {
              unlinkSync(shmPath);
            }

            initDb();
          });
        } catch (restoreErr) {
          logger.error('严重警告：数据库还原回滚失败！', restoreErr);
        }
        res.status(500).json({ error: err instanceof Error ? err.message : '还原数据失败，已自动回撤恢复旧数据' });
      } finally {
        try {
          if (existsSync(backupPath)) {
            unlinkSync(backupPath);
          }
        } catch (unlinkErr) {
          logger.error('删除导入临时备份文件失败:', unlinkErr);
        }
      }
    },
  );
}
