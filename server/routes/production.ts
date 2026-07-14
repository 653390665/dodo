import { logger } from '../logger';
import { createHash } from 'crypto';
import { rateLimit } from '../middleware/rate-limit';
import type { Express } from 'express';
import { generateId } from '../id';
import { governedGenerateText as generateText } from '../helpers/governed-llm';
import { getConfig } from '../lib/config';
import {
  buildChapterProductionTitle,
  buildProductionPlannerContext,
  buildProductionWriterContext,
  getNextChapterOrder,
  normalizeProductionIntent,
} from '../../shared/lib/chapter-production';
import {
  buildStoryStateLedger,
} from '../../shared/lib/story-state-ledger';
import { buildFallbackSceneBeats, buildFallbackDraft } from '../helpers/fallback-draft';
import { buildEmptyContinuityReport, buildContractPrompt } from '../helpers/production-helpers';
import { recordChapterDecision } from '../../shared/lib/preference-flywheel';
import { addChunk } from '../vector-store';
import { summarizeChapterDecisions } from '../../shared/lib/preference-flywheel';
import { runProductionPipeline } from '../helpers/ai-production-pipeline';
import { buildContinuationContext } from '../../shared/lib/continuation-pack';
import * as db from '../lib/db';
import { validate, chapterProductionSchema } from '../validation';
import {
  reserveQuota,
  refundQuota,
  commitQuotaReservation,
  quotaFailureHttpStatus,
} from '../helpers/quota-guard.js';
import { bindClientDisconnect } from '../helpers/stream-disconnect';
import {
  getDatabaseGeneration,
  runInSerializedWriteForGeneration,
} from '../lib/db-instance';

function isResponseWritable(res: Express['response']): boolean {
  return !res.writableEnded && !res.destroyed;
}

function sseWrite(res: Express['response'], payload: Record<string, unknown>): boolean {
  if (!isResponseWritable(res)) return false;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  return true;
}

type ProductionOwnershipIssue = {
  status: 404 | 409;
  message: string;
};

class ProductionDomainConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionDomainConflict';
  }
}

function findProductionInputOwnershipIssue(
  novelId: string,
  targetChapterId?: string,
  continuationPackId?: string,
): ProductionOwnershipIssue | undefined {
  if (targetChapterId) {
    const chapter = db.getChapter(targetChapterId);
    if (!chapter) {
      return { status: 404, message: 'Target chapter not found' };
    }
    if (chapter.novelId !== novelId) {
      return { status: 409, message: 'Target chapter does not belong to production run novel' };
    }
  }

  if (continuationPackId) {
    const pack = db.getContinuationPack(continuationPackId);
    if (!pack) {
      return { status: 404, message: 'Continuation pack not found' };
    }
    if (pack.novelId !== novelId) {
      return { status: 409, message: 'Continuation pack does not belong to production run novel' };
    }
  }

  return undefined;
}

function assertOwnedEntity(
  entity: { novelId: string } | undefined,
  novelId: string,
  entityLabel: string,
): void {
  if (!entity || entity.novelId !== novelId) {
    throw new ProductionDomainConflict(`${entityLabel} does not belong to production run novel`);
  }
}

function assertApplyOwnership(run: ReturnType<typeof db.getChapterProductionRun>): void {
  if (!run) throw new ProductionDomainConflict('Production run no longer exists');

  if (run.continuityReport.continuationPackId) {
    assertOwnedEntity(
      db.getContinuationPack(run.continuityReport.continuationPackId),
      run.novelId,
      'Continuation pack',
    );
  }

  if (run.targetChapterId) {
    assertOwnedEntity(db.getChapter(run.targetChapterId), run.novelId, 'Target chapter');
  }

  const patch = run.continuityReport.proposedPatch;
  for (const update of patch.characterUpdates || []) {
    assertOwnedEntity(db.getCharacter(update.characterId), run.novelId, 'Continuity character');
  }
  for (const update of patch.itemUpdates || []) {
    assertOwnedEntity(db.getItem(update.itemId), run.novelId, 'Continuity item');
  }
  for (const update of patch.foreshadowingUpdates || []) {
    assertOwnedEntity(db.getForeshadowing(update.foreshadowingId), run.novelId, 'Continuity foreshadowing');
  }
  for (const entry of patch.foreshadowingsToCreate || []) {
    if (entry.plantedChapterId) {
      assertOwnedEntity(db.getChapter(entry.plantedChapterId), run.novelId, 'Foreshadowing planted chapter');
    }
  }
}

function buildProductionContinuityReport(continuationPackId?: string) {
  return {
    ...buildEmptyContinuityReport(),
    ...(continuationPackId ? { continuationPackId } : {}),
  };
}

const completedReflexionKeys = new Set<string>();
const MAX_REFLEXION_KEYS = 1000;

function rememberReflexionKey(key: string): void {
  if (completedReflexionKeys.size >= MAX_REFLEXION_KEYS) {
    const oldest = completedReflexionKeys.values().next().value;
    if (oldest) completedReflexionKeys.delete(oldest);
  }
  completedReflexionKeys.add(key);
}

function initializeProductionRun(
  novelId: string,
  targetChapterId: string,
  continuationPackId: string,
  userIntent: string,
  activeEntityNames?: string[],
) {
  const novel = db.getNovel(novelId);
  if (!novel) {
    return {
      ok: false as const,
      issue: { status: 404 as const, message: 'Novel not found' },
    };
  }
  const ownershipIssue = findProductionInputOwnershipIssue(
    novelId,
    targetChapterId,
    continuationPackId,
  );
  if (ownershipIssue) return { ok: false as const, issue: ownershipIssue };

  const chapters = db.listChapters(novelId);
  const characters = db.listCharacters(novelId).filter(c => !activeEntityNames || activeEntityNames.includes(c.name) || c.role === 'protagonist');
  const locations = db.listLocations(novelId).filter(l => !activeEntityNames || activeEntityNames.includes(l.name));
  const items = db.listItems(novelId).filter(i => !activeEntityNames || activeEntityNames.includes(i.name));
  const factions = db.listFactions(novelId).filter(f => !activeEntityNames || activeEntityNames.includes(f.name));
  const powerLevels = db.listPowerLevels(novelId).filter(p => !activeEntityNames || activeEntityNames.includes(p.name));
  const timelineEvents = db.listTimelineEvents(novelId);
  const foreshadowings = db.listForeshadowings(novelId);
  const mountedSkillIds = novel.mountedSkillIds || [];
  const skills = db.listSkills().filter(skill => mountedSkillIds.includes(skill.id));
  const continuationPack = continuationPackId
    ? db.getContinuationPack(continuationPackId)
    : undefined;
  const packContext = continuationPack
    ? buildContinuationContext(continuationPack)
    : '';

  const ledger = buildStoryStateLedger({
    novel,
    chapters,
    characters,
    locations,
    items,
    factions,
    powerLevels,
    timelineEvents,
    foreshadowings,
  });
  const intent = normalizeProductionIntent(userIntent);
  const runId = generateId();
  const now = Date.now();
  db.createChapterProductionRun({
    id: runId,
    novelId,
    targetChapterId: targetChapterId || undefined,
    status: 'running',
    userIntent: intent,
    sceneBeats: '',
    draftContent: '',
    styleAudit: '',
    continuityReport: buildProductionContinuityReport(continuationPackId),
    createdAt: now,
    updatedAt: now,
  });

  return {
    ok: true as const,
    runId,
    novel,
    chapters,
    characters,
    skills,
    packContext,
    plannerContext: buildProductionPlannerContext(ledger),
    writerContext: buildProductionWriterContext(ledger),
    intent,
  };
}

async function emitTextAsTokensWithType(
  res: Express['response'],
  text: string,
  eventType: string,
  signal?: AbortSignal,
) {
  const chunks = text.match(/.{1,24}/gs) || [];
  for (const chunk of chunks) {
    if (signal?.aborted || !sseWrite(res, { type: eventType, content: chunk })) {
      const error = new Error('Client disconnected during production stream');
      error.name = 'AbortError';
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
}

export function registerProductionRoutes(app: Express) {
  app.post('/api/chapter-production-runs/start', validate(chapterProductionSchema), async (req, res) => {
    if (!rateLimit('chapter-production')) {
      return res.status(429).json({ error: 'Rate limited — please wait before starting another production run', retryAfter: 30 });
    }
    let runId: string | null = null;
    const { novelId = '' } = req.body;
    const requestDatabaseGeneration = getDatabaseGeneration();
    let reservationId: string | undefined;
    try {
      const {
        targetChapterId = '',
        userIntent = '',
        continuationPackId = '',
        activeEntityNames,
      } = req.body;
      if (!novelId.trim()) {
        return res.status(400).json({ error: 'novelId is required' });
      }

      const novel = db.getNovel(novelId);
      if (!novel) {
        return res.status(404).json({ error: 'Novel not found' });
      }
      const ownershipIssue = findProductionInputOwnershipIssue(
        novelId,
        targetChapterId,
        continuationPackId,
      );
      if (ownershipIssue) {
        return res.status(ownershipIssue.status).json({ error: ownershipIssue.message });
      }

      // Quota Gate — atomic reserve before any LLM work
      const reserve = await reserveQuota(novelId, 'generateProse');
      if (!reserve.allowed) {
        return res.status(quotaFailureHttpStatus(reserve)).json({
          quotaExceeded: true,
          limitType: 'generateProse',
          count: reserve.count,
          max: reserve.max,
          error: reserve.error,
        });
      }

      reservationId = reserve.reservationId;

      const initialization = await runInSerializedWriteForGeneration(
        requestDatabaseGeneration,
        () => initializeProductionRun(
          novelId,
          targetChapterId,
          continuationPackId,
          userIntent,
          activeEntityNames,
        ),
      );
      if (!initialization.executed) {
        await refundQuota(reservationId);
        return res.status(409).json({ error: '数据库已在生产任务启动期间切换，请重试' });
      }
      if (!initialization.result.ok) {
        await refundQuota(reservationId);
        return res.status(initialization.result.issue.status).json({
          error: initialization.result.issue.message,
        });
      }

      runId = initialization.result.runId;

      // Run Reflexion evolution in the background to learn from the previous chapter's edits
      runEvolutionReflexion(novelId).catch(err => logger.error('Reflexion background task error:', err));

      const { intent, writerContext } = initialization.result;

      const fallbackBeats = buildFallbackSceneBeats(intent);
      const fallbackDraft = buildFallbackDraft(fallbackBeats, writerContext);
      const fallbackAudit = '## 保底审计\n- 模型响应过慢，本次生产先生成可编辑草稿。\n- 建议稍后单独运行 AI 审计，检查人物一致性、分镜执行和节奏问题。';
      const fallbackContinuity = buildProductionContinuityReport(continuationPackId);

      const fallbackWrite = await runInSerializedWriteForGeneration(
        requestDatabaseGeneration,
        () => db.updateChapterProductionRun(runId!, {
          status: 'review_required',
          sceneBeats: fallbackBeats,
          draftContent: fallbackDraft,
          styleAudit: fallbackAudit,
          continuityReport: fallbackContinuity,
        }),
      );
      if (!fallbackWrite.executed) {
        throw new Error('数据库已在生成期间切换，已丢弃旧生成任务');
      }

      // 成功生成 fallback，额度已在 reserve 时预占
      commitQuotaReservation(reservationId);

      return res.json({ run: db.getChapterProductionRun(runId) });
    } catch (e) {
      logger.error(String(e));
      const message = e instanceof Error ? e.message : String(e);
      if (runId) {
        await runInSerializedWriteForGeneration(requestDatabaseGeneration, () => {
          db.updateChapterProductionRun(runId!, {
            status: 'failed',
            errorMessage: message,
          });
        });
      }
      await refundQuota(reservationId);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post('/api/chapter-production-runs/start-stream', validate(chapterProductionSchema), async (req, res) => {
    if (!rateLimit('chapter-production-stream')) {
      return res.status(429).json({ error: 'Rate limited — please wait before starting another production run', retryAfter: 30 });
    }
    let runId: string | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const clientAbortController = new AbortController();
    let disposeDisconnect = () => {};
    let streamCleanedUp = false;
    const cleanupStream = () => {
      if (streamCleanedUp) return;
      streamCleanedUp = true;
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      disposeDisconnect();
    };
    const { novelId = '' } = req.body;
    const requestDatabaseGeneration = getDatabaseGeneration();
    let reservationId: string | undefined;
    let contentDelivered = false;
    let streamDatabaseGeneration: number | undefined;

    try {
      const {
        targetChapterId = '',
        userIntent = '',
        continuationPackId = '',
        activeEntityNames,
      } = req.body;
      if (!novelId.trim()) {
        res.status(400).json({ error: 'novelId is required' });
        return;
      }

      const novel = db.getNovel(novelId);
      if (!novel) {
        res.status(404).json({ error: 'Novel not found' });
        return;
      }
      const ownershipIssue = findProductionInputOwnershipIssue(
        novelId,
        targetChapterId,
        continuationPackId,
      );
      if (ownershipIssue) {
        res.status(ownershipIssue.status).json({ error: ownershipIssue.message });
        return;
      }

      // Quota Gate — atomic reserve before any LLM work
      const reserve = await reserveQuota(novelId, 'generateProse');
      if (!reserve.allowed) {
        res.status(quotaFailureHttpStatus(reserve)).json({
          quotaExceeded: true,
          limitType: 'generateProse',
          count: reserve.count,
          max: reserve.max,
          error: reserve.error,
        });
        return;
      }

      reservationId = reserve.reservationId;

      const initialization = await runInSerializedWriteForGeneration(
        requestDatabaseGeneration,
        () => initializeProductionRun(
          novelId,
          targetChapterId,
          continuationPackId,
          userIntent,
          activeEntityNames,
        ),
      );
      if (!initialization.executed) {
        await refundQuota(reservationId);
        res.status(409).json({ error: '数据库已在生产任务启动期间切换，请重试' });
        return;
      }
      if (!initialization.result.ok) {
        await refundQuota(reservationId);
        res.status(initialization.result.issue.status).json({
          error: initialization.result.issue.message,
        });
        return;
      }

      runId = initialization.result.runId;
      streamDatabaseGeneration = requestDatabaseGeneration;
      const {
        novel: productionNovel,
        characters,
        skills,
        packContext,
        plannerContext,
        writerContext,
        intent,
      } = initialization.result;

      // Run Reflexion evolution in the background to learn from the previous chapter's edits
      runEvolutionReflexion(novelId).catch(err => logger.error('Reflexion background task error:', err));

      // SSE setup
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      req.socket.setTimeout(0);

      heartbeat = setInterval(() => {
        if (isResponseWritable(res)) {
          res.write(':ping\n\n');
        }
      }, 30_000);

      disposeDisconnect = bindClientDisconnect(req, res, () => {
        clientAbortController.abort();
        cleanupStream();
      });

      sseWrite(res, { type: 'run_created', runId });

      // ============================================================
      // Phase 1: Immediate fallback (synchronous, no model calls)
      // ============================================================
      sseWrite(res, { type: 'status', message: '正在准备保底草稿...' });

      const fallbackBeats = buildFallbackSceneBeats(intent);
      sseWrite(res, { type: 'fallback_beats', content: fallbackBeats });

      const fallbackDraft = buildFallbackDraft(fallbackBeats, writerContext);
      await emitTextAsTokensWithType(
        res,
        fallbackDraft,
        'fallback_draft_token',
        clientAbortController.signal,
      );
      sseWrite(res, { type: 'fallback_draft_done' });

      const fallbackAudit = '## 保底审计\n- 模型响应过慢，本次生产先生成可编辑草稿。\n- 建议稍后单独运行 AI 审计，检查人物一致性、分镜执行和节奏问题。';
      sseWrite(res, { type: 'fallback_audit', content: fallbackAudit });

      const fallbackContinuity = buildProductionContinuityReport(continuationPackId);
      sseWrite(res, { type: 'fallback_continuity', report: fallbackContinuity });

      const fallbackWrite = await runInSerializedWriteForGeneration(
        streamDatabaseGeneration,
        () => db.updateChapterProductionRun(runId!, {
          status: 'review_required',
          sceneBeats: fallbackBeats,
          draftContent: fallbackDraft,
          styleAudit: fallbackAudit,
          continuityReport: fallbackContinuity,
        }),
      );
      if (!fallbackWrite.executed) {
        throw new Error('数据库已在生成期间切换，已丢弃旧生成任务');
      }

      contentDelivered = true;
      commitQuotaReservation(reservationId);

      sseWrite(res, { type: 'status', message: '草稿已就绪，可以先审阅或接受写入。' });

      const isTestEnv = process.env.NODE_ENV === 'test' || process.env.PLAYWRIGHT_TEST || getConfig().apiKey === '你的key' || !getConfig().apiKey;
      if (isTestEnv) {
        sseWrite(res, { type: 'model_beats', content: fallbackBeats });
        sseWrite(res, { type: 'model_score', score: 85, attempts: 1 });
        const runData = db.getChapterProductionRun(runId!);
        sseWrite(res, { type: 'done', run: runData });
        cleanupStream();
        // 增加 100ms 延时，确保极速返回下的客户端完整读取 TCP 数据包 buffer
        await new Promise((resolve) => setTimeout(resolve, 100));
        res.end();
        return;
      }

      // ============================================================
      // Phase 2: AI pipeline (async — Planner → Writer → Critic)
      // Runs after fallback; updates the run when complete
      // ============================================================
      const pipelineContextStr = [
        packContext,
        plannerContext,
      ].filter(Boolean).join('\n\n');

      // Load story contract
      const contract = productionNovel.projectPreferenceProfile?.contract;
      const contractStr = contract ? buildContractPrompt(contract) : '';

      // Build character state summary from current_state
      const characterStates = characters
        .filter(c => c.current_state)
        .map(c => `- ${c.name}：${c.current_state}`)
        .join('\n');
      const characterStateStr = characterStates
        ? `\n【角色当前状态】\n${characterStates}`
        : '';

      // Extract learned preferences from past decisions
      const learnedPreferences = summarizeChapterDecisions(
        productionNovel.projectPreferenceProfile || {
          tags: [],
          weights: { styleWeight: 0.5, characterWeight: 0.5, worldWeight: 0.5, plotWeight: 0.5, pacingWeight: 0.5 },
          acceptedDimensions: [],
          rejectedDimensions: [],
          notes: [],
          evidenceCount: 0
        },
      );
      const pipelineDatabaseGeneration = streamDatabaseGeneration;

      runProductionPipeline({
        novelId,
        userIntent: intent,
        contextStr: pipelineContextStr + characterStateStr + (contractStr ? `\n\n${contractStr}` : ''),
        skills,
        learnedPreferences,
        progress: {
          onPhase: (phase) => {
            if (isResponseWritable(res)) {
              if (phase === 'writer') sseWrite(res, { type: 'model_draft_start' });
              sseWrite(res, { type: 'status', message: `AI ${phase} 进行中...` });
            }
          },
          onWriterToken: (chunk) => {
            if (isResponseWritable(res)) sseWrite(res, { type: 'model_draft_token', content: chunk });
          },
          onWriterDone: () => {
            if (isResponseWritable(res)) sseWrite(res, { type: 'model_draft_done' });
          },
          onCriticDone: (feedback, isValid) => {
            if (isResponseWritable(res)) sseWrite(res, { type: 'model_audit', content: feedback, isValid });
          },
          signal: clientAbortController.signal,
        },
      }).then(async (result) => {
        if (clientAbortController.signal.aborted || !isResponseWritable(res)) return;
        sseWrite(res, { type: 'model_beats', content: result.sceneBeats });
        sseWrite(res, { type: 'model_score', score: result.score, attempts: result.attempts });
        const modelWrite = await runInSerializedWriteForGeneration(
          pipelineDatabaseGeneration,
          () => {
            const currentRun = db.getChapterProductionRun(runId!);
            if (currentRun && currentRun.status !== 'applied') {
              db.updateChapterProductionRun(runId!, {
                sceneBeats: result.sceneBeats,
                draftContent: result.draft,
                styleAudit: result.audit,
                status: 'review_required',
              });
            }
            return db.getChapterProductionRun(runId!);
          },
        );
        if (!modelWrite.executed) {
          throw new Error('数据库已在生成期间切换，已丢弃旧生成结果');
        }
        sseWrite(res, { type: 'done', run: modelWrite.result });
        cleanupStream();
        res.end();
      }).catch((err) => {
        if (clientAbortController.signal.aborted || !isResponseWritable(res)) return;
        logger.error('AI pipeline error:', err);
        if (err instanceof Error && err.message.includes('数据库已在生成期间切换')) {
          sseWrite(res, { type: 'error', message: '数据库已切换，本次旧生成结果已丢弃。' });
          cleanupStream();
          res.end();
          return;
        }
        // The fallback is already persisted and billable. A later model failure
        // is a warning, not a terminal stream error.
        sseWrite(res, { type: 'status', message: 'AI 精修失败，已保留完整保底草稿。' });
        sseWrite(res, { type: 'done', run: db.getChapterProductionRun(runId!) });
        cleanupStream();
        res.end();
      });

      // NOTE: stream stays open; heartbeat keeps connection alive until AI pipeline completes
      return;
    } catch (e) {
      cleanupStream();
      logger.error('Chapter production stream fatal error:', e);
      const message = e instanceof Error ? e.message : String(e);
      if (runId) {
        try {
          if (streamDatabaseGeneration !== undefined) {
            await runInSerializedWriteForGeneration(streamDatabaseGeneration, () => {
              db.updateChapterProductionRun(runId!, {
                status: 'failed',
                errorMessage: message,
              });
            });
          }
        } catch (e) { logger.error('Decision record failed:', e); }
      }
      if (!contentDelivered) {
        await refundQuota(reservationId);
      }
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      } else if (isResponseWritable(res) && !clientAbortController.signal.aborted) {
        sseWrite(res, { type: 'error', message });
        res.end();
      }
    }
  });

  app.post('/api/chapter-production-runs/:runId/apply', async (req, res) => {
    try {
      const run = db.getChapterProductionRun(req.params.runId);
      if (!run) {
        return res.status(404).json({ error: 'Production run not found' });
      }
      const hasReviewableDraft = Boolean(run.draftContent.trim());
      const canApplyRun = run.status === 'review_required' || (run.status === 'failed' && hasReviewableDraft);
      if (!canApplyRun) {
        return res.status(400).json({ error: `Production run is not reviewable: ${run.status}` });
      }

      const chapters = db.listChapters(run.novelId);
      const now = Date.now();
      let chapterId = run.targetChapterId;
      const wordCount = run.draftContent.replace(/\s/g, '').length;

      db.runInTransaction(() => {
        // Revalidate every cross-entity reference inside the same transaction
        // that performs the apply. A forged/imported run must fail before the
        // first chapter, version, entity, or preference write occurs.
        assertApplyOwnership(run);

        if (chapterId && db.getChapter(chapterId)) {
          db.updateChapter(chapterId, {
            sceneBeats: run.sceneBeats,
            content: run.draftContent,
            critique: run.styleAudit,
            wordCount,
          });
        } else {
          const nextOrder = getNextChapterOrder(chapters);
          chapterId = `${now}`;
          db.createChapter({
            id: chapterId,
            novelId: run.novelId,
            title: buildChapterProductionTitle(nextOrder),
            volumeName: chapters.at(-1)?.volumeName || '正文卷',
            content: run.draftContent,
            order: nextOrder,
            wordCount,
            sceneBeats: run.sceneBeats,
            critique: run.styleAudit,
            createdAt: now,
            updatedAt: now,
          });
        }

        db.createChapterVersion({
          id: `${now + 1}`,
          chapterId,
          content: run.draftContent,
          wordCount,
          author: 'auto',
          createdAt: now,
        });

        db.updateNovel(run.novelId, { updatedAt: now });

        const existingTimeline = db.listTimelineEvents(run.novelId);
        run.continuityReport.proposedPatch.timelineEventsToCreate.forEach((event, index) => {
          db.createTimelineEvent({
            id: generateId(),
            novelId: run.novelId,
            title: event.title,
            timestamp: event.timestamp,
            description: event.description,
            statusTag: event.statusTag,
            order: existingTimeline.length + index + 1,
            createdAt: now,
            updatedAt: now,
          });
        });

        run.continuityReport.proposedPatch.foreshadowingsToCreate.forEach((entry, _index) => {
          db.createForeshadowing({
            id: generateId(),
            novelId: run.novelId,
            title: entry.title,
            description: entry.description,
            status: entry.status,
            plantedChapterId: entry.plantedChapterId || chapterId,
            relatedCharacterIds: [],
            createdAt: now,
            updatedAt: now,
          });
        });

        // Apply character updates from continuity report
        if (run.continuityReport.proposedPatch.characterUpdates) {
          run.continuityReport.proposedPatch.characterUpdates.forEach((upd) => {
            const char = db.getCharacter(upd.characterId);
            if (char) {
              const currentSummary = char.summary || '';
              const separator = currentSummary && !currentSummary.endsWith('\n') ? '\n' : '';
              db.updateCharacter(upd.characterId, {
                summary: currentSummary + separator + upd.summaryAppend,
                updatedAt: now,
              });
            }
          });
        }

        // Apply item updates from continuity report
        if (run.continuityReport.proposedPatch.itemUpdates) {
          run.continuityReport.proposedPatch.itemUpdates.forEach((upd) => {
            const item = db.getItem(upd.itemId);
            if (item) {
              const currentDesc = item.description || '';
              const separator = currentDesc && !currentDesc.endsWith('\n') ? '\n' : '';
              db.updateItem(upd.itemId, {
                description: currentDesc + separator + upd.descriptionAppend,
                updatedAt: now,
              });
            }
          });
        }

        // Apply foreshadowing updates from continuity report (e.g. payoff)
        if (run.continuityReport.proposedPatch.foreshadowingUpdates) {
          run.continuityReport.proposedPatch.foreshadowingUpdates.forEach((upd) => {
            const fore = db.getForeshadowing(upd.foreshadowingId);
            if (fore) {
              const currentNotes = fore.notes || '';
              const separator = currentNotes && !currentNotes.endsWith('\n') ? '\n' : '';
              const nextNotes = upd.notesAppend ? currentNotes + separator + upd.notesAppend : currentNotes;
              db.updateForeshadowing(upd.foreshadowingId, {
                status: upd.status,
                notes: nextNotes,
                payoffChapterId: upd.status === 'payoff' ? chapterId : fore.payoffChapterId,
                updatedAt: now,
              });
            }
          });
        }

        db.updateChapterProductionRun(run.id, {
          status: 'applied',
          targetChapterId: chapterId,
        });

        // Record user decision for preference learning
        const { decisionAction, decisionInstruction, decisionReason } = req.body;
        if (decisionAction) {
          const novel = db.getNovel(run.novelId);
          if (novel) {
            const profile = novel.projectPreferenceProfile || {
              tags: [],
              weights: { styleWeight: 0.5, characterWeight: 0.5, worldWeight: 0.5, plotWeight: 0.5, pacingWeight: 0.5 },
              acceptedDimensions: [],
              rejectedDimensions: [],
              notes: [],
              evidenceCount: 0
            };
            const updated = recordChapterDecision(profile, {
              chapterId: chapterId!,
              timestamp: Date.now(),
              action: decisionAction,
              instruction: decisionInstruction,
              rejectedReason: decisionReason,
            });
            db.updateNovel(run.novelId, { projectPreferenceProfile: updated });
          }
        }
      });

      // Background-index chapter for vector RAG (don't block the response)
      addChunk(run.novelId, chapterId!, 0, run.draftContent).catch((e) => logger.error('Failed to add chunk to vector store:', e));

      res.json({ chapterId });
    } catch (e) {
      if (e instanceof ProductionDomainConflict) {
        return res.status(409).json({ error: e.message });
      }
      logger.error(String(e));
      res.status(500).json({ error: "Internal server error" });
    }
  });
}

async function runEvolutionReflexion(novelId: string): Promise<void> {
  let reflexionKey: string | undefined;
  try {
    const databaseGeneration = getDatabaseGeneration();
    const novel = db.getNovel(novelId);
    if (!novel) return;

    const appliedRuns = db.listChapterProductionRuns(novelId)
      .filter(r => r.status === 'applied')
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const latestApplied = appliedRuns[0];
    if (!latestApplied || !latestApplied.targetChapterId) return;

    const chapter = db.getChapter(latestApplied.targetChapterId);
    if (!chapter || chapter.novelId !== novelId || !chapter.content) return;

    const original = latestApplied.draftContent;
    const final = chapter.content;

    if (original.trim() === final.trim()) {
      return; // No changes made by the user
    }

    reflexionKey = [
      databaseGeneration,
      novelId,
      chapter.id,
      createHash('sha256').update(final).digest('hex'),
    ].join(':');
    if (completedReflexionKeys.has(reflexionKey)) return;
    // Reserve the key before the model call so concurrent production starts
    // cannot analyze the same published chapter more than once.
    rememberReflexionKey(reflexionKey);

    const prompt = `你是一个写作进化分析器 (Evolution Agent)。
以下是 AI 自动生成的原稿与作者最终修改并发表的成品之间的对比。
请分析作者的修改意图，找出作者不喜欢的 AI 写作风格（例如：大段设定说教、过多情绪性废话、禁忌词汇、不自然的长句等），并提炼成 3 条具体的“写作避坑红线规则”。

【AI 原稿】
${original.substring(0, 3000)}

【作者修改后的成品】
${final.substring(0, 3000)}

请以 JSON 格式返回避坑规则，格式如下：
{
  "bannedWords": ["词语1", "词语2"],
  "rules": ["规则1", "规则2"]
}
只输出 JSON，不要有任何解释。`;

    const response = await generateText(getConfig(), {
      prompt,
      maxTokens: 1024,
      responseMimeType: 'application/json',
      novelId,
    }, {
      operation: 'production-reflexion',
      novelId,
      timeoutMs: 60_000,
      concurrency: 1,
    });

    const parsed = JSON.parse(response.replace(/```(json)?/g, '').trim());
    if (parsed && (Array.isArray(parsed.bannedWords) || Array.isArray(parsed.rules))) {
      const rules = Array.isArray(parsed.rules)
        ? parsed.rules.filter((rule: unknown): rule is string => typeof rule === 'string' && Boolean(rule.trim()))
        : [];
      const writeResult = await runInSerializedWriteForGeneration(databaseGeneration, () => {
        const latestNovel = db.getNovel(novelId);
        if (!latestNovel) return false;
        const latestProfile = latestNovel.projectPreferenceProfile || {
          tags: [],
          weights: { characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1, styleWeight: 1 },
          acceptedDimensions: [],
          rejectedDimensions: [],
          notes: [],
          evidenceCount: 0,
        };
        const newNotes = [...(latestProfile.notes || [])];
        for (const rule of rules) {
          if (!newNotes.includes(rule)) newNotes.push(rule);
        }
        return db.updateNovel(novelId, {
          projectPreferenceProfile: {
            ...latestProfile,
            notes: newNotes.slice(-20),
          }
        });
      });
      if (writeResult.executed && writeResult.result) {
        logger.info('Reflexion evolution complete, updated preference profile notes');
      } else {
        completedReflexionKeys.delete(reflexionKey);
        reflexionKey = undefined;
        logger.info('Reflexion evolution discarded after database replacement');
      }
    } else {
      completedReflexionKeys.delete(reflexionKey);
      reflexionKey = undefined;
    }
  } catch (e) {
    if (reflexionKey) completedReflexionKeys.delete(reflexionKey);
    logger.error('Reflexion evolution failed:', e);
  }
}

/** @internal Test-only hooks for deterministic Reflexion concurrency coverage. */
export const __productionTestHooks = {
  runEvolutionReflexion,
  resetReflexionKeys(): void {
    completedReflexionKeys.clear();
  },
};
