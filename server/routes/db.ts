import type { Express } from 'express';
import * as db from '../../src/lib/db';

const DB_WHITELIST = new Set([
  'listNovels', 'getNovel', 'createNovel', 'updateNovel', 'deleteNovel',
  'listChapters', 'getChapter', 'createChapter', 'updateChapter', 'deleteChapter',
  'listChapterVersions', 'createChapterVersion',
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
  'listChapterProductionRuns', 'getChapterProductionRun', 'createChapterProductionRun', 'updateChapterProductionRun',
  'listContinuationPacks', 'getContinuationPack', 'createContinuationPack', 'updateContinuationPack', 'deleteContinuationPack',
]);

export function registerDbRoutes(app: Express) {
  app.post('/api/db', (req, res) => {
    const { method, args = [] } = req.body;
    if (!DB_WHITELIST.has(method)) {
      return res.status(400).json({ error: `Unknown method: ${method}` });
    }
    const fn = (db as Record<string, Function>)[method];
    if (typeof fn !== 'function') {
      return res.status(500).json({ error: `Method not a function: ${method}` });
    }
    try {
      const result = fn(...args);
      res.json({ result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/db/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write('retry: 3000\n\n');
    req.socket.setTimeout(0);

    const unsub = db.subscribe(() => {
      res.write('data: {}\n\n');
    });

    const heartbeat = setInterval(() => {
      res.write(':ping\n\n');
    }, 30_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsub();
    });
  });
}
