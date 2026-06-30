import { logger } from '../logger';
import type { Express } from 'express';
import * as db from '../lib/db';
import { validate, dbSchema } from '../validation';

const DB_WHITELIST = new Set([
  'listNovels', 'getNovel', 'createNovel', 'updateNovel', 'deleteNovel',
  'listChapters', 'getChapter', 'createChapter', 'updateChapter', 'deleteChapter', 'reorderChapters',
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

import { subscribe, setCurrentInitiator } from '../lib/db-instance';

/** Log real error, return generic message to client */
function serverError(res: any, e: unknown, context: string): void {
  logger.error(`${context}:`, e);
  res.status(500).json({ error: 'Internal server error' });
}

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
    } catch (e: any) {
      logger.error("DB proxy error:", e);
      res.status(500).json({ error: e.message });
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
}
