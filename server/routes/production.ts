import { logger } from '../logger';
import { createHash } from 'crypto';
import { rateLimit } from '../middleware/rate-limit';
import type { Express } from 'express';
import { generateId } from '../id';
import { governedGenerateText as generateText } from '../helpers/governed-llm';
import { getConfig } from '../lib/config';
import {
  buildChapterProductionTitle,
  buildProductionExecutionReceipt,
  buildProductionPlannerContext,
  buildProductionPromptContexts,
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
import { EmbeddingUnavailableError } from '../embedding';
import { summarizeChapterDecisions } from '../../shared/lib/preference-flywheel';
import { runProductionPipeline } from '../helpers/ai-production-pipeline';
import { finalizeContextReceipt } from '../../shared/lib/continuation-pack';
import { computeChapterWorkflowHash } from '../../shared/lib/chapter-workflow';
import { evaluateDraftAcceptance, resolveEffectiveMinDraftChars, semanticReviewFromContinuityReport, semanticReviewFromStructuredAudit, validateCompleteChapterDraftQuality } from '../../shared/lib/draft-quality';
import { convertFiveDimToStructured, parseAuditResponseWithDiagnostics } from '../../shared/lib/audit-structured';
import { continuityToReviewIssues, deriveReviewGate } from '../../shared/lib/review-issues';
import {
  applyChapterFactCandidate,
  buildChapterFactCandidate,
  ChapterFactCandidateError,
  previewChapterFactCandidate,
} from '../helpers/chapter-fact-candidates.js';
import * as db from '../lib/db';
import { validate, chapterProductionSchema, chapterProductionApplySchema } from '../validation';
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
import type { ChapterProductionRun, ChapterProductionRunVersion, ChapterProductionRunVersionSource } from '../../shared/types';
import {
  requireWritingStyleConfirmation,
  resolveWritingStyleRequest,
  WritingStyleRequestError,
  type ResolvedWritingStyleRequest,
} from '../helpers/writing-style-service.js';

function isResponseWritable(res: Express['response']): boolean {
  return !res.writableEnded && !res.destroyed;
}

function sseWrite(res: Express['response'], payload: Record<string, unknown>): boolean {
  if (!isResponseWritable(res)) return false;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  return true;
}

const PRODUCTION_RATE_LIMIT_ERROR = '正文生成请求过于频繁，请稍后再试。';
const PRODUCTION_NOVEL_REQUIRED_ERROR = '请先选择要生成正文的作品。';
const PRODUCTION_NOVEL_NOT_FOUND_ERROR = '作品不存在，请刷新项目后重试。';
const PRODUCTION_START_FAILED_ERROR = '正文生成服务暂时异常，请稍后重试。';
const PRODUCTION_APPLY_FAILED_ERROR = '应用正文版本时遇到异常，请稍后重试。';
const FALLBACK_REVIEW_REQUIRED_ERROR = '保底草稿未经过模型审稿，请重试生成模型版本后再接受。';
const FALLBACK_REVIEW_REQUIRED_CODE = 'FALLBACK_REVIEW_REQUIRED';
const PRODUCTION_SOURCE_UNKNOWN_ERROR = '正文版本来源未知，请重新生成后再接受。';
const PRODUCTION_SOURCE_UNKNOWN_CODE = 'PRODUCTION_SOURCE_UNKNOWN';

function productionVersionHash(snapshot: Pick<ChapterProductionRunVersion, 'sceneBeats' | 'draftContent' | 'styleAudit' | 'continuityReport'>): string {
  return createHash('sha256').update(JSON.stringify({
    sceneBeats: snapshot.sceneBeats,
    draftContent: snapshot.draftContent,
    styleAudit: snapshot.styleAudit,
    continuityReport: snapshot.continuityReport,
  })).digest('hex');
}

function createProductionVersion(run: ChapterProductionRun, source: ChapterProductionRunVersionSource): ChapterProductionRunVersion {
  const version: ChapterProductionRunVersion = {
    id: generateId(), runId: run.id, novelId: run.novelId, targetChapterId: run.targetChapterId,
    source, sceneBeats: run.sceneBeats, draftContent: run.draftContent, styleAudit: run.styleAudit,
    continuityReport: run.continuityReport, contentHash: productionVersionHash(run), createdAt: Date.now(),
  };
  db.createChapterProductionRunVersion(version);
  return version;
}

function attachReviewVersion(run: ChapterProductionRun | undefined): ChapterProductionRun | undefined {
  if (!run) return run;
  const version = db.listChapterProductionRunVersions(run.id)[0];
  return version ? { ...run, reviewVersionId: version.id, reviewVersionHash: version.contentHash, reviewVersionSource: version.source } : run;
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

function findProductionTargetChapterOwnershipIssue(
  novelId: string,
  targetChapterId?: string,
): ProductionOwnershipIssue | undefined {
  if (!targetChapterId) return undefined;
  const chapter = db.getChapter(targetChapterId);
  if (!chapter) return { status: 404, message: '目标章节不存在，请刷新后重试。' };
  if (chapter.novelId !== novelId) return { status: 409, message: '目标章节不属于当前作品，请返回项目后重试。' };
  return undefined;
}

function assertOwnedEntity(
  entity: { novelId: string } | undefined,
  novelId: string,
  entityLabel: string,
): void {
  if (!entity || entity.novelId !== novelId) {
    throw new ProductionDomainConflict(`${entityLabel}不属于当前作品，请刷新后重试。`);
  }
}

function assertApplyOwnership(run: ReturnType<typeof db.getChapterProductionRun>): void {
  if (!run) throw new ProductionDomainConflict('生成任务已不存在，请刷新后重试。');

  if (run.continuityReport.continuationPackId) {
    assertOwnedEntity(
      db.getContinuationPack(run.continuityReport.continuationPackId),
      run.novelId,
      '续写资料包',
    );
  }

  if (run.targetChapterId) {
    assertOwnedEntity(db.getChapter(run.targetChapterId), run.novelId, '目标章节');
  }

  const patch = run.continuityReport.proposedPatch;
  for (const update of patch.characterUpdates || []) {
    assertOwnedEntity(db.getCharacter(update.characterId), run.novelId, '连续性角色');
  }
  for (const update of patch.itemUpdates || []) {
    assertOwnedEntity(db.getItem(update.itemId), run.novelId, '连续性物品');
  }
  for (const update of patch.foreshadowingUpdates || []) {
    assertOwnedEntity(db.getForeshadowing(update.foreshadowingId), run.novelId, '连续性伏笔');
  }
  for (const candidate of patch.narrativePromiseCandidates || []) {
    if (candidate.targetType === 'existing' && candidate.foreshadowingId) {
      assertOwnedEntity(db.getForeshadowing(candidate.foreshadowingId), run.novelId, '叙事承诺');
    }
  }
  for (const entry of patch.foreshadowingsToCreate || []) {
    if (entry.plantedChapterId) {
      assertOwnedEntity(db.getChapter(entry.plantedChapterId), run.novelId, 'Foreshadowing planted chapter');
    }
  }
}

function buildProductionContinuityReport(continuationPackId?: string, targetChapterBaselineHash?: string) {
  return {
    ...buildEmptyContinuityReport(),
    ...(continuationPackId ? { continuationPackId } : {}),
    ...(targetChapterBaselineHash ? { targetChapterBaselineHash } : {}),
  };
}

function deriveProductionSemanticReview(run: Pick<ChapterProductionRun, 'styleAudit' | 'continuityReport'>) {
  const parsed = parseAuditResponseWithDiagnostics(run.styleAudit || '');
  if (parsed.structured) return semanticReviewFromStructuredAudit(parsed.structured);
  if (parsed.fiveDim) return semanticReviewFromStructuredAudit(convertFiveDimToStructured(parsed.fiveDim));
  return semanticReviewFromContinuityReport(run.continuityReport);
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
  writingStyle: ResolvedWritingStyleRequest,
  databaseGeneration: number,
  activeEntityNames?: string[],
) {
  const novel = db.getNovel(novelId);
  if (!novel) {
    return {
      ok: false as const,
      issue: { status: 404 as const, message: PRODUCTION_NOVEL_NOT_FOUND_ERROR },
    };
  }
  const ownershipIssue = findProductionTargetChapterOwnershipIssue(
    novelId,
    targetChapterId,
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
  const executionSnapshot = writingStyle.executionSnapshot;
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
    currentChapterOrder: targetChapterId
      ? chapters.find((chapter) => chapter.id === targetChapterId)?.order
      : getNextChapterOrder(chapters),
  });
  const intent = normalizeProductionIntent(userIntent);
  const rawPlannerContext = buildProductionPlannerContext(ledger);
  const rawWriterContext = buildProductionWriterContext(ledger);
  const executionReceipt = buildProductionExecutionReceipt(executionSnapshot, ledger);
  const packContext = executionSnapshot.canon.pack?.context || '';
  const promptContexts = buildProductionPromptContexts({
    layeredContext: '',
    plannerContext: rawPlannerContext,
    writerContext: rawWriterContext,
    criticContext: rawWriterContext,
    continuationPackContext: packContext,
  });
  const plannerContext = promptContexts.planner;
  const writerContext = promptContexts.writer;
  const criticContext = promptContexts.critic;
  const contextReceipt = executionSnapshot.canon.pack?.receipt;
  const targetChapterBaselineHash = targetChapterId
    ? (() => {
      const targetChapter = chapters.find((chapter) => chapter.id === targetChapterId);
      return targetChapter ? computeChapterWorkflowHash(targetChapter.content, targetChapter.sceneBeats) : undefined;
    })()
    : undefined;
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
    continuityReport: { ...buildProductionContinuityReport(continuationPackId, targetChapterBaselineHash), databaseGeneration, contextReceipt, executionReceipt },
    createdAt: now,
    updatedAt: now,
  });

  return {
    ok: true as const,
    runId,
    novel,
    chapters,
    characters,
    executionSnapshot,
    packContext,
    contextReceipt,
    executionReceipt,
    targetChapterBaselineHash,
    plannerContext,
    writerContext,
    criticContext,
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
      return res.status(429).json({ error: PRODUCTION_RATE_LIMIT_ERROR, retryAfter: 30 });
    }
    let runId: string | null = null;
    const { novelId = '', databaseGeneration: requestDatabaseGeneration } = req.body;
    let reservationId: string | undefined;
    try {
      const {
        targetChapterId = '',
        userIntent = '',
        continuationPackId = '',
        activeEntityNames,
        styleConfirmationFingerprint,
        writingStyleFingerprint,
        sessionCardIds,
        chapterId,
        databaseGeneration: requestedGeneration,
      } = req.body;
      const resolvedTargetChapterId = targetChapterId || chapterId;
      if (!novelId.trim()) {
        return res.status(400).json({ error: PRODUCTION_NOVEL_REQUIRED_ERROR });
      }
      if (requestDatabaseGeneration !== getDatabaseGeneration()) {
        return res.status(409).json({ code: 'DATABASE_GENERATION_MISMATCH', error: '数据库已变化，请刷新后重试' });
      }

      const novel = db.getNovel(novelId);
      if (!novel) {
        return res.status(404).json({ error: PRODUCTION_NOVEL_NOT_FOUND_ERROR });
      }
      let writingStyle;
      try {
        writingStyle = resolveWritingStyleRequest(novelId, { chapterId, databaseGeneration: requestedGeneration, continuationPackId: continuationPackId || undefined, sessionCardIds });
        requireWritingStyleConfirmation(writingStyle, styleConfirmationFingerprint ?? writingStyleFingerprint);
      } catch (error) {
        if (error instanceof WritingStyleRequestError) {
          return res.status(error.status).json({ code: error.code, error: error.message, ...(writingStyle ? { resolution: writingStyle.resolution, candidates: writingStyle.candidates } : {}) });
        }
        throw error;
      }
      const ownershipIssue = findProductionTargetChapterOwnershipIssue(
        novelId,
        resolvedTargetChapterId,
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
          resolvedTargetChapterId,
          continuationPackId,
          userIntent,
          writingStyle,
          requestDatabaseGeneration,
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
      runEvolutionReflexion(novelId, requestDatabaseGeneration, writingStyle.executionSnapshot).catch(err => logger.error('Reflexion background task error:', err));

      const { intent, writerContext, contextReceipt, executionReceipt, targetChapterBaselineHash } = initialization.result;

      const fallbackBeats = buildFallbackSceneBeats(intent);
      const fallbackDraft = buildFallbackDraft(fallbackBeats, writerContext, resolveEffectiveMinDraftChars(intent));
      const fallbackQuality = validateCompleteChapterDraftQuality(fallbackDraft, undefined, { minChars: resolveEffectiveMinDraftChars(intent) });
      if (!fallbackQuality.ok) {
        throw new Error(`DRAFT_QUALITY_GATE_FAILED:${fallbackQuality.violations.join('；')}`);
      }
      const fallbackAudit = '## 保底审计\n- 模型响应过慢，本次生产先生成可编辑草稿。\n- 建议稍后单独运行 AI 审计，检查人物一致性、分镜执行和节奏问题。';
      const fallbackContinuity = { ...buildProductionContinuityReport(continuationPackId, targetChapterBaselineHash), databaseGeneration: requestDatabaseGeneration, contextReceipt, executionReceipt, auditMeta: { status: 'not_run' as const, source: 'fallback' as const } };

      const fallbackWrite = await runInSerializedWriteForGeneration(
        requestDatabaseGeneration,
        () => {
          db.updateChapterProductionRun(runId!, { status: 'review_required', sceneBeats: fallbackBeats, draftContent: fallbackDraft, styleAudit: fallbackAudit, continuityReport: fallbackContinuity });
          createProductionVersion(db.getChapterProductionRun(runId!)!, 'fallback');
        },
      );
      if (!fallbackWrite.executed) {
        throw new Error('数据库已在生成期间切换，已丢弃旧生成任务');
      }

      // 成功生成 fallback，额度已在 reserve 时预占
      commitQuotaReservation(reservationId);

      return res.json({ run: attachReviewVersion(db.getChapterProductionRun(runId)) });
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
      const qualityFailure = e instanceof Error && message.startsWith('DRAFT_QUALITY_GATE_FAILED:')
        ? message.slice('DRAFT_QUALITY_GATE_FAILED:'.length).trim().split('；').filter(Boolean)
        : undefined;
      res.status(qualityFailure ? 422 : 500).json({
        code: qualityFailure ? 'DRAFT_QUALITY_GATE_FAILED' : 'PRODUCTION_START_FAILED',
        error: qualityFailure ? '正文候选未通过质量门禁，请重试或调整写法。' : PRODUCTION_START_FAILED_ERROR,
        ...(qualityFailure ? { violations: qualityFailure, retriable: true } : {}),
      });
    }
  });

  app.post('/api/chapter-production-runs/start-stream', validate(chapterProductionSchema), async (req, res) => {
    if (!rateLimit('chapter-production-stream')) {
      return res.status(429).json({ error: PRODUCTION_RATE_LIMIT_ERROR, retryAfter: 30 });
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
    const { novelId = '', databaseGeneration: requestDatabaseGeneration } = req.body;
    let reservationId: string | undefined;
    let contentDelivered = false;
    let fallbackPersisted = false;
    let streamDatabaseGeneration = requestDatabaseGeneration;

    try {
      const {
        targetChapterId = '',
        userIntent = '',
        continuationPackId = '',
        activeEntityNames,
        styleConfirmationFingerprint,
        writingStyleFingerprint,
        sessionCardIds,
        chapterId,
        databaseGeneration: requestedGeneration,
      } = req.body;
      const resolvedTargetChapterId = targetChapterId || chapterId;
      if (!novelId.trim()) {
        res.status(400).json({ error: PRODUCTION_NOVEL_REQUIRED_ERROR });
        return;
      }
      if (requestDatabaseGeneration !== getDatabaseGeneration()) {
        res.status(409).json({ code: 'DATABASE_GENERATION_MISMATCH', error: '数据库已变化，请刷新后重试' });
        return;
      }

      const novel = db.getNovel(novelId);
      if (!novel) {
        res.status(404).json({ error: PRODUCTION_NOVEL_NOT_FOUND_ERROR });
        return;
      }
      let writingStyle;
      try {
        writingStyle = resolveWritingStyleRequest(novelId, { chapterId, databaseGeneration: requestedGeneration, continuationPackId: continuationPackId || undefined, sessionCardIds });
        requireWritingStyleConfirmation(writingStyle, styleConfirmationFingerprint ?? writingStyleFingerprint);
      } catch (error) {
        if (error instanceof WritingStyleRequestError) {
          res.status(error.status).json({ code: error.code, error: error.message, ...(writingStyle ? { resolution: writingStyle.resolution, candidates: writingStyle.candidates } : {}) });
          return;
        }
        throw error;
      }
      const ownershipIssue = findProductionTargetChapterOwnershipIssue(
        novelId,
        resolvedTargetChapterId,
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
          resolvedTargetChapterId,
          continuationPackId,
          userIntent,
          writingStyle,
          requestDatabaseGeneration,
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
        executionSnapshot,
        executionReceipt,
        targetChapterBaselineHash,
        packContext,
        plannerContext,
        writerContext,
        intent,
      } = initialization.result;

      // Run Reflexion evolution in the background to learn from the previous chapter's edits
      runEvolutionReflexion(novelId, requestDatabaseGeneration, writingStyle.executionSnapshot).catch(err => logger.error('Reflexion background task error:', err));

      // SSE setup
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      req.socket.setTimeout(0);

      heartbeat = setInterval(() => {
        if (isResponseWritable(res)) {
          try {
            res.write(':ping\n\n');
          } catch {
            if (heartbeat) clearInterval(heartbeat);
          }
        }
      }, 30_000);

      disposeDisconnect = bindClientDisconnect(req, res, () => {
        clientAbortController.abort();
        __productionTestHooks.disconnectObservedHook?.();
        cleanupStream();
      });

      sseWrite(res, { type: 'run_created', runId });

      // ============================================================
      // Phase 1: Immediate fallback (synchronous, no model calls)
      // ============================================================
      sseWrite(res, { type: 'status', message: '正在准备保底草稿...' });

      const fallbackBeats = buildFallbackSceneBeats(intent);
      sseWrite(res, { type: 'fallback_beats', content: fallbackBeats });

      const fallbackDraft = buildFallbackDraft(fallbackBeats, writerContext, resolveEffectiveMinDraftChars(intent));
      const fallbackQuality = validateCompleteChapterDraftQuality(fallbackDraft, undefined, { minChars: resolveEffectiveMinDraftChars(intent) });
      const isTestEnv = process.env.NODE_ENV === 'test' || process.env.PLAYWRIGHT_TEST || getConfig().apiKey === '你的key' || !getConfig().apiKey;
      if (!fallbackQuality.ok) {
        // Keep the invalid fallback out of the manuscript and out of the
        // stream. The real pipeline may still produce a valid model draft.
        sseWrite(res, {
          type: 'status',
          code: 'DRAFT_QUALITY_GATE_FAILED',
          phase: 'fallback',
          message: '保底草稿未通过质量门禁，正在继续尝试模型正文。',
          violations: fallbackQuality.violations,
          retriable: true,
        });
      } else {
        await emitTextAsTokensWithType(
          res,
          fallbackDraft,
          'fallback_draft_token',
          clientAbortController.signal,
        );
        sseWrite(res, { type: 'fallback_draft_done' });
      }

      const fallbackAudit = '## 保底审计\n- 模型响应过慢，本次生产先生成可编辑草稿。\n- 建议稍后单独运行 AI 审计，检查人物一致性、分镜执行和节奏问题。';
      const contextReceipt = initialization.result.contextReceipt;
      const fallbackContinuity = { ...buildProductionContinuityReport(continuationPackId, targetChapterBaselineHash), databaseGeneration: requestDatabaseGeneration, contextReceipt, executionReceipt, auditMeta: { status: 'not_run' as const, source: 'fallback' as const } };
      // Audit and provenance are diagnostic events, not manuscript content;
      // emit them even when the fallback draft is rejected so clients can
      // render the failure and offer a retry without waiting for a missing
      // terminal event.
      sseWrite(res, { type: 'fallback_audit', content: fallbackAudit });
      sseWrite(res, { type: 'fallback_continuity', report: fallbackContinuity });

      // Test hook: allows deterministic simulation of queue delay + disconnect
      if (__productionTestHooks.preFallbackWriteHook) {
        await __productionTestHooks.preFallbackWriteHook();
      }

      // ── Disconnect guard: skip fallback write if client already gone ──
      if (clientAbortController.signal.aborted || !isResponseWritable(res)) {
        // Client disconnected while fallback was queued. Do NOT persist
        // content, do NOT set contentDelivered, let the outer catch refund.
        const abortError = new Error('Client disconnected before fallback write');
        abortError.name = 'AbortError';
        throw abortError;
      }

      // Offline/test mode has no provider that could replace an invalid
      // fallback. End explicitly instead of entering the 90s model pipeline
      // and leaving the client waiting on a result that cannot arrive.
      if (!fallbackQuality.ok && isTestEnv) {
        const qualityError = `DRAFT_QUALITY_GATE_FAILED:${fallbackQuality.violations.join('；')}`;
        await runInSerializedWriteForGeneration(streamDatabaseGeneration, () => {
          db.updateChapterProductionRun(runId!, { status: 'failed', errorMessage: qualityError });
        });
        await refundQuota(reservationId);
        sseWrite(res, {
          type: 'error',
          code: 'DRAFT_QUALITY_GATE_FAILED',
          message: '保底草稿未通过质量门禁，当前没有可用模型可重试。',
          violations: fallbackQuality.violations,
          retriable: true,
        });
        cleanupStream();
        res.end();
        return;
      }

      if (fallbackQuality.ok) {
        const fallbackWrite = await runInSerializedWriteForGeneration(
          streamDatabaseGeneration,
          () => {
            db.updateChapterProductionRun(runId!, { status: 'review_required', sceneBeats: fallbackBeats, draftContent: fallbackDraft, styleAudit: fallbackAudit, continuityReport: fallbackContinuity });
            createProductionVersion(db.getChapterProductionRun(runId!)!, 'fallback');
          },
        );
        if (!fallbackWrite.executed) {
          throw new Error('数据库已在生成期间切换，已丢弃旧生成任务');
        }

        // Re-check after the write queue drains — client may have disconnected
        // while we were waiting for our turn.
        if (clientAbortController.signal.aborted || !isResponseWritable(res)) {
          const abortError = new Error('Client disconnected after fallback persist');
          abortError.name = 'AbortError';
          throw abortError;
        }

        fallbackPersisted = true;
        contentDelivered = true;
        commitQuotaReservation(reservationId);

        sseWrite(res, { type: 'status', message: '草稿已就绪，可以先审阅或接受写入。' });
      }

      if (isTestEnv && fallbackQuality.ok) {
        sseWrite(res, { type: 'model_beats', content: fallbackBeats });
        // No model audit ran in test/fallback mode; never emit a fabricated score.
        const runData = db.getChapterProductionRun(runId!);
        sseWrite(res, { type: 'done', run: attachReviewVersion(runData) });
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
      const pipelineContextStr = plannerContext;

      // Load story contract
      const contract = productionNovel.projectPreferenceProfile?.contract;
      const contractStr = contract ? buildContractPrompt(contract) : '';

      // 汇总角色当前状态
      const characterStates = characters
        .filter(c => c.current_state)
        .map(c => `- ${c.name}：${c.current_state}`)
        .join('\n');
      const characterStateStr = characterStates
        ? `\n【角色当前状态】\n${characterStates}`
        : '';

      // 汇总历史决策中学习到的偏好
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
      const finalPipelineContext = [pipelineContextStr, characterStateStr, contractStr].filter(Boolean).join('\n\n');
      const stageContexts = {
        planner: [plannerContext, characterStateStr, contractStr].filter(Boolean).join('\n\n'),
        writer: [writerContext, characterStateStr, contractStr].filter(Boolean).join('\n\n'),
        critic: [initialization.result.criticContext, characterStateStr, contractStr].filter(Boolean).join('\n\n'),
      };
      const learnedContext = learnedPreferences.length > 0
        ? '\n\n【学习到的偏好 — 基于你之前的修改习惯】\n' + learnedPreferences.map((item) => `- ${item.pattern}（可信度：${Math.round(item.confidence * 100)}%）`).join('\n')
        : '';
      const stagePrompts = executionSnapshot.stagePrompts;
      const stagePromptLabels = {
        planner: '规划阶段能力卡与护栏',
        writer: '正文阶段能力卡与护栏',
        critic: '审稿阶段能力卡与护栏',
      } as const;
      const stagePromptSources = (['planner', 'writer', 'critic'] as const).map((stage) => {
        const roleSkillCount = executionSnapshot.roleSkills[stage].length;
        const overlayCount = executionSnapshot.overlays.filter((overlay) => overlay.stages.includes(stage)).length;
        const guardrailCount = executionSnapshot.guardrails.filter((guardrail) => guardrail.stage === stage).length;
        const flowStepCount = executionSnapshot.flowStep?.stage === stage ? 1 : 0;
        return {
          id: `stage-prompt-${stage}`,
          label: stagePromptLabels[stage],
          text: stagePrompts[stage],
          itemCount: roleSkillCount + overlayCount + guardrailCount + flowStepCount,
          version: 'execution-snapshot-v1',
        };
      });
      const receiptActualText = [
        finalPipelineContext,
        learnedContext,
        stagePrompts.planner,
        stagePrompts.writer,
        stagePrompts.critic,
        intent,
      ].filter(Boolean).join('\n\n');
      const finalContextReceipt = finalizeContextReceipt(contextReceipt, receiptActualText, [
        { id: 'continuation-pack', label: '资料包上下文', text: packContext, itemCount: contextReceipt?.itemCount || 0, version: contextReceipt?.packUpdatedAt ? String(contextReceipt.packUpdatedAt) : undefined },
        { id: 'planner', label: '规划上下文', text: plannerContext, itemCount: plannerContext ? 1 : 0, version: 'planner-v1' },
        { id: 'character-state', label: '角色当前状态', text: characterStateStr, itemCount: characterStates ? characterStates.split('\n').length : 0, version: 'character-state-v1' },
        { id: 'contract', label: '作品写作契约', text: contractStr, itemCount: contractStr ? 1 : 0, version: 'contract-v1' },
        ...stagePromptSources,
        { id: 'learned-preferences', label: '已学习偏好', text: learnedPreferences.map((item) => `- ${item.pattern}（可信度：${Math.round(item.confidence * 100)}%）`).join('\n'), itemCount: learnedPreferences.length, version: 'preferences-v1' },
        { id: 'intent', label: '续写意图', text: intent, itemCount: intent ? 1 : 0, version: 'intent-v1' },
      ]);
      const pipelineDatabaseGeneration = streamDatabaseGeneration;

      runProductionPipeline({
        novelId,
        userIntent: intent,
        contextStr: finalPipelineContext,
        stageContexts,
        stagePrompts,
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
          onCriticDone: (feedback, isValid, meta) => {
            if (isResponseWritable(res)) sseWrite(res, { type: 'model_audit', content: feedback, isValid, status: meta?.status, ...(meta?.score === undefined ? {} : { score: meta.score }) });
          },
          signal: clientAbortController.signal,
        },
      }).then(async (result) => {
        if (clientAbortController.signal.aborted || !isResponseWritable(res)) return;
        sseWrite(res, { type: 'model_beats', content: result.sceneBeats });
        if ((result.auditStatus === 'pass' || result.auditStatus === 'fail') && typeof result.score === 'number' && Number.isFinite(result.score)) sseWrite(res, { type: 'model_score', score: result.score, attempts: result.attempts, status: result.auditStatus });

        // ── Disconnect guard: skip model DB write if client already gone ──
        if (clientAbortController.signal.aborted || !isResponseWritable(res)) return;

        // Test hook: allows deterministic simulation of model queue delay + disconnect
        if (__productionTestHooks.preModelWriteHook) {
          await __productionTestHooks.preModelWriteHook();
        }

        const modelWrite = await runInSerializedWriteForGeneration(
          pipelineDatabaseGeneration,
          () => {
            // Disconnect guard inside the queue callback: if client left while
            // this write was queued, keep the persisted fallback and skip model.
            if (clientAbortController.signal.aborted || !isResponseWritable(res)) {
              return db.getChapterProductionRun(runId!);
            }
            const currentRun = db.getChapterProductionRun(runId!);
            if (currentRun && currentRun.status !== 'applied') {
              db.updateChapterProductionRun(runId!, {
                sceneBeats: result.sceneBeats,
                draftContent: result.draft,
                styleAudit: result.audit,
                continuityReport: { ...db.getChapterProductionRun(runId!)!.continuityReport, contextReceipt: finalContextReceipt, auditMeta: { status: result.auditStatus, source: result.source, ...((result.auditStatus === 'pass' || result.auditStatus === 'fail') && typeof result.score === 'number' && Number.isFinite(result.score) ? { score: result.score } : {}) } },
                status: 'review_required',
              });
              createProductionVersion(db.getChapterProductionRun(runId!)!, result.source);
            }
            return db.getChapterProductionRun(runId!);
          },
        );
        if (!modelWrite.executed) {
          throw new Error('数据库已在生成期间切换，已丢弃旧生成结果');
        }
        // An invalid fallback never reserved delivery. Commit only after the
        // validated model result has been persisted.
        if (!contentDelivered) {
          contentDelivered = true;
          commitQuotaReservation(reservationId);
        }
        // Post-queue disconnect: client left during model write queue wait.
        // A delivered fallback/model result is already committed; just clean
        // up without sending done.
        if (clientAbortController.signal.aborted || !isResponseWritable(res)) {
          cleanupStream();
          return;
        }
        sseWrite(res, { type: 'done', run: attachReviewVersion(modelWrite.result) });
        cleanupStream();
        res.end();
      }).catch(async (err) => {
        if (clientAbortController.signal.aborted || !isResponseWritable(res)) {
          if (!contentDelivered) {
            try {
              await runInSerializedWriteForGeneration(streamDatabaseGeneration, () => {
                db.updateChapterProductionRun(runId!, { status: 'failed', errorMessage: err instanceof Error ? err.message : String(err) });
              });
            } catch (writeError) {
              logger.error('Failed to mark aborted production run:', writeError);
            }
            await refundQuota(reservationId);
          }
          cleanupStream();
          return;
        }
        logger.error('AI pipeline error:', err);
        if (err instanceof Error && err.message.includes('数据库已在生成期间切换')) {
          sseWrite(res, { type: 'error', message: '数据库已切换，本次旧生成结果已丢弃。' });
          cleanupStream();
          res.end();
          return;
        }
        if (!fallbackPersisted) {
          await runInSerializedWriteForGeneration(streamDatabaseGeneration, () => {
            db.updateChapterProductionRun(runId!, { status: 'failed', errorMessage: err instanceof Error ? err.message : String(err) });
          });
          await refundQuota(reservationId);
          const qualityFailure = err instanceof Error && err.message.startsWith('DRAFT_QUALITY_GATE_FAILED:');
          const violations = qualityFailure && err instanceof Error
            ? err.message.slice('DRAFT_QUALITY_GATE_FAILED:'.length).trim().split('；').filter(Boolean)
            : undefined;
          sseWrite(res, {
            type: 'error',
            code: qualityFailure ? 'DRAFT_QUALITY_GATE_FAILED' : 'PRODUCTION_STREAM_FAILED',
            message: qualityFailure ? '模型正文也未通过质量门禁，请重试或调整写法。' : '正文生产暂不可用，请稍后重试。',
            retriable: true,
            ...(violations ? { violations } : {}),
          });
          cleanupStream();
          res.end();
          return;
        }
        // The fallback is already persisted and billable. A later model failure
        // is a warning, not a terminal stream error.
        sseWrite(res, { type: 'status', message: 'AI 精修失败，已保留完整保底草稿。' });
        sseWrite(res, { type: 'done', run: attachReviewVersion(db.getChapterProductionRun(runId!)) });
        cleanupStream();
        res.end();
      });

      // NOTE: stream stays open; heartbeat keeps connection alive until AI pipeline completes
      return;
    } catch (e) {
      cleanupStream();
      logger.error('Chapter production stream fatal error:', e);
      const message = e instanceof Error ? e.message : String(e);
      const qualityFailure = e instanceof Error && message.startsWith('DRAFT_QUALITY_GATE_FAILED:')
        ? message.slice('DRAFT_QUALITY_GATE_FAILED:'.length).trim().split('；').filter(Boolean)
        : undefined;
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
        res.status(qualityFailure ? 422 : 500).json({
          code: qualityFailure ? 'DRAFT_QUALITY_GATE_FAILED' : 'PRODUCTION_STREAM_FAILED',
          error: qualityFailure ? '正文候选未通过质量门禁，请重试或调整写法。' : '正文生产暂不可用，请稍后重试。',
          ...(qualityFailure ? { violations: qualityFailure, retriable: true } : {}),
        });
      } else if (isResponseWritable(res) && !clientAbortController.signal.aborted) {
        sseWrite(res, {
          type: 'error',
          code: qualityFailure ? 'DRAFT_QUALITY_GATE_FAILED' : 'PRODUCTION_STREAM_FAILED',
          message: qualityFailure ? '正文候选未通过质量门禁，请重试或调整写法。' : '正文生产暂不可用，请稍后重试。',
          ...(qualityFailure ? { violations: qualityFailure, retriable: true } : {}),
        });
        res.end();
      }
    }
  });

  app.post('/api/chapter-production-runs/:runId/fact-candidate/preview', (req, res) => {
    try {
      const { novelId, databaseGeneration } = req.body || {};
      if (typeof novelId !== 'string' || !Number.isInteger(databaseGeneration)) {
        return res.status(400).json({ code: 'CHAPTER_FACT_INVALID_INPUT', error: '候选预览参数无效' });
      }
      return res.json(previewChapterFactCandidate({ novelId, runId: req.params.runId, databaseGeneration }));
    } catch (error) {
      if (error instanceof ChapterFactCandidateError) {
        return res.status(error.code.includes('NOT_FOUND') ? 404 : 409).json({ code: error.code, error: error.message });
      }
      logger.error('Chapter fact candidate preview failed:', error);
      return res.status(500).json({ error: '事实候选预览失败，请稍后重试。' });
    }
  });

  app.post('/api/chapter-production-runs/:runId/fact-candidate/apply', async (req, res) => {
    try {
      const body = req.body || {};
      if (typeof body.novelId !== 'string' || !Number.isInteger(body.databaseGeneration)
        || typeof body.candidateId !== 'string' || typeof body.manuscriptContentHash !== 'string'
        || typeof body.storyMemoryFingerprint !== 'string'
        || (body.selectedFactIds !== undefined && !Array.isArray(body.selectedFactIds))
        || (body.selectedFactIds === undefined && body.factDecisions === undefined)
        || (body.rejectedFactIds !== undefined && !Array.isArray(body.rejectedFactIds))
        || (body.factDecisions !== undefined && (!body.factDecisions || typeof body.factDecisions !== 'object' || Array.isArray(body.factDecisions)))) {
        return res.status(400).json({ code: 'CHAPTER_FACT_INVALID_INPUT', error: '事实确认参数无效' });
      }
      const result = await applyChapterFactCandidate({
        novelId: body.novelId, runId: req.params.runId, databaseGeneration: body.databaseGeneration,
        candidateId: body.candidateId, manuscriptContentHash: body.manuscriptContentHash,
        storyMemoryFingerprint: body.storyMemoryFingerprint,
        ...(body.selectedFactIds === undefined ? {} : { selectedFactIds: body.selectedFactIds }),
        ...(body.rejectedFactIds === undefined ? {} : { rejectedFactIds: body.rejectedFactIds }),
        ...(body.factDecisions === undefined ? {} : { factDecisions: body.factDecisions }),
      });
      return res.json(result);
    } catch (error) {
      if (error instanceof ChapterFactCandidateError) {
        return res.status(error.code.includes('NOT_FOUND') ? 404 : 409).json({ code: error.code, error: error.message });
      }
      logger.error('Chapter fact candidate apply failed:', error);
      return res.status(500).json({ error: '事实确认失败，请稍后重试。' });
    }
  });

  app.post('/api/chapter-production-runs/:runId/apply', validate(chapterProductionApplySchema), async (req, res) => {
    try {
      const { novelId, chapterId: requestedChapterId, databaseGeneration } = req.body;
      const run = db.getChapterProductionRun(req.params.runId);
      if (!run) {
        return res.status(404).json({ error: '生成任务不存在，请刷新后重试。' });
      }
      if (run.novelId !== novelId || run.targetChapterId !== requestedChapterId) {
        return res.status(409).json({ code: 'PRODUCTION_SCOPE_MISMATCH', error: '生成任务与当前章节不匹配，请刷新后重试。' });
      }
      if (run.continuityReport.databaseGeneration !== databaseGeneration) {
        return res.status(409).json({ code: 'PRODUCTION_RUN_GENERATION_MISMATCH', error: '生成任务来自旧版本数据库，请刷新后重试。' });
      }
      if (databaseGeneration !== getDatabaseGeneration()) {
        return res.status(409).json({ code: 'DATABASE_GENERATION_MISMATCH', error: '数据库已变化，请刷新后重试' });
      }
      const hasReviewableDraft = Boolean(run.draftContent.trim());
      const canApplyRun = run.status === 'review_required' || (run.status === 'failed' && hasReviewableDraft);
      if (!canApplyRun) {
        return res.status(400).json({ error: '当前生成任务还不能应用，请等待生成完成后重试。' });
      }

      const requestedVersionId = req.body?.versionId;
      const requestedVersionHash = req.body?.versionHash;
      const availableVersions = db.listChapterProductionRunVersions(run.id);
      if (requestedVersionId === undefined && availableVersions.length > 0) {
        return res.status(409).json({ error: '检测到多个正文版本，请先选择要应用的版本。' });
      }
      if ((requestedVersionId === undefined) !== (requestedVersionHash === undefined)) {
        return res.status(400).json({ error: '请选择要应用的正文版本后再确认。' });
      }
      let applyRun = run;
      if (requestedVersionId !== undefined && requestedVersionHash !== undefined) {
        const version = db.getChapterProductionRunVersion(String(requestedVersionId));
        if (!version || version.runId !== run.id || version.novelId !== run.novelId || version.targetChapterId !== run.targetChapterId) {
          return res.status(409).json({ error: '所选正文版本不属于当前生成任务，请重新选择。' });
        }
        if (version.source === 'fallback') {
          return res.status(409).json({ code: FALLBACK_REVIEW_REQUIRED_CODE, error: FALLBACK_REVIEW_REQUIRED_ERROR, retriable: true });
        }
        if (version.source !== 'model') {
          return res.status(409).json({ error: '所选正文版本来源不可用，请重新生成。' });
        }
        const recomputedHash = productionVersionHash(version);
        if (version.contentHash !== String(requestedVersionHash) || recomputedHash !== version.contentHash) {
          return res.status(409).json({ error: '所选正文版本已变化，请重新确认。' });
        }
        applyRun = { ...run, sceneBeats: version.sceneBeats, draftContent: version.draftContent, styleAudit: version.styleAudit, continuityReport: version.continuityReport };
      }
      if (applyRun.continuityReport.databaseGeneration !== databaseGeneration) {
        return res.status(409).json({ code: 'PRODUCTION_RUN_GENERATION_MISMATCH', error: '正文版本来自旧版本数据库，请刷新后重试。' });
      }
      if (applyRun.continuityReport.auditMeta?.source === 'fallback') {
        return res.status(409).json({ code: FALLBACK_REVIEW_REQUIRED_CODE, error: FALLBACK_REVIEW_REQUIRED_ERROR, retriable: true });
      }
      // Resolve cross-novel references before content validation so forged
      // runs retain their domain-conflict response instead of being masked by
      // a manuscript quality error.
      assertApplyOwnership(applyRun);
      const auditStatus = applyRun.continuityReport.auditMeta?.status ?? 'not_run';
      const acceptUnreviewed = req.body?.acceptUnreviewed === true;
      const semanticReview = deriveProductionSemanticReview(applyRun);
      const candidateSource = applyRun.continuityReport.auditMeta?.source;
      if (candidateSource !== 'model') {
        return res.status(409).json({
          code: PRODUCTION_SOURCE_UNKNOWN_CODE,
          error: PRODUCTION_SOURCE_UNKNOWN_ERROR,
          retriable: true,
        });
      }
      const acceptance = evaluateDraftAcceptance(applyRun.draftContent, {
        // The explicit risk action is a user decision, while the run source
        // remains separately enforced above (fallback is never ordinary).
        source: acceptUnreviewed ? 'user' : candidateSource,
        operation: 'draft',
        semanticReview,
        allowRiskAcceptance: acceptUnreviewed,
      });
      if (!acceptance.accepted) {
        const draftQuality = acceptance.quality;
        if (acceptance.status === 'review-required') {
          // Preserve the existing response shape for clients that already
          // render the explicit risk-confirmation action.
          return res.status(409).json({
            error: '这版正文尚未完成审稿确认，请先确认风险后再应用。',
            code: 'AUDIT_CONFIRMATION_REQUIRED',
          });
        }
        return res.status(422).json({
          code: 'DRAFT_QUALITY_GATE_FAILED',
          error: `正文候选未通过质量门禁：${acceptance.reasons.join('；')}`,
          violations: draftQuality.violations,
          retriable: acceptance.source === 'fallback',
        });
      }

      const guarded = await runInSerializedWriteForGeneration(databaseGeneration, () => {
        const chapters = db.listChapters(run.novelId);
        const now = Date.now();
        let chapterId = run.targetChapterId;
        const resolvedAuditStatus = applyRun.continuityReport.auditMeta?.status ?? 'not_run';
        const existingChapter = chapterId ? db.getChapter(chapterId) : undefined;
        const baselineHash = applyRun.continuityReport.targetChapterBaselineHash;
        if (existingChapter && baselineHash) {
          const currentHash = computeChapterWorkflowHash(existingChapter.content, existingChapter.sceneBeats);
          if (currentHash !== baselineHash) {
            throw new ProductionDomainConflict('目标章节在生成期间已被修改，预览已失效，请重新生成。');
          }
        }
        const reviewContentHash = computeChapterWorkflowHash(applyRun.draftContent, applyRun.sceneBeats);
        const reviewIssues = continuityToReviewIssues(applyRun.continuityReport, reviewContentHash);
        assertApplyOwnership(applyRun);
        const factCandidate = buildChapterFactCandidate({
          novelId: run.novelId,
          runId: run.id,
          draftContent: applyRun.draftContent,
          sceneBeats: applyRun.sceneBeats,
          databaseGeneration,
          targetChapterId: chapterId || `${now}`,
          proposedPatch: applyRun.continuityReport.proposedPatch,
        });
        const workflowMeta = {
          ...(existingChapter?.workflowMeta || { version: 1 as const }),
          version: 1 as const,
          lastAudit: {
            status: resolvedAuditStatus as 'pass' | 'fail' | 'unknown' | 'not_run',
            contentHash: reviewContentHash,
            completedAt: now,
            source: candidateSource === 'model' ? 'model' as const : 'fallback' as const,
          },
          reviewState: {
            schemaVersion: 1 as const,
            contentHash: reviewContentHash,
            issues: reviewIssues,
            gate: acceptance.status === 'risk-accepted' ? 'accepted-risk' : deriveReviewGate(reviewIssues, resolvedAuditStatus),
            lastReviewedAt: now,
            semanticReview,
          },
          factCandidateId: factCandidate.id,
        };
        db.runInTransaction(() => {
        // Revalidate every cross-entity reference inside the same transaction
        // that performs the apply. A forged/imported run must fail before the
        // first chapter, version, entity, or preference write occurs.
        assertApplyOwnership(applyRun);

        if (chapterId && db.getChapter(chapterId)) {
          db.updateChapter(chapterId, {
            sceneBeats: applyRun.sceneBeats,
            content: applyRun.draftContent,
            critique: auditStatus === 'unknown' || auditStatus === 'not_run' ? (db.getChapter(chapterId)?.critique || '') : applyRun.styleAudit,
            wordCount: applyRun.draftContent.replace(/\s/g, '').length,
            workflowMeta,
          });
        } else {
          const nextOrder = getNextChapterOrder(chapters);
          chapterId = `${now}`;
          db.createChapter({
            id: chapterId,
            novelId: run.novelId,
            title: buildChapterProductionTitle(nextOrder),
            volumeName: chapters.at(-1)?.volumeName || '正文卷',
            content: applyRun.draftContent,
            order: nextOrder,
            wordCount: applyRun.draftContent.replace(/\s/g, '').length,
            sceneBeats: applyRun.sceneBeats,
            critique: auditStatus === 'unknown' || auditStatus === 'not_run' ? '' : applyRun.styleAudit,
            workflowMeta,
            createdAt: now,
            updatedAt: now,
          });
        }

        db.createChapterVersion({
          id: `${now + 1}`,
          chapterId,
          content: applyRun.draftContent,
          wordCount: applyRun.draftContent.replace(/\s/g, '').length,
          author: 'auto',
          createdAt: now,
        });

        db.updateNovel(run.novelId, { updatedAt: now });

        db.updateChapterProductionRun(run.id, {
          status: 'applied',
          targetChapterId: chapterId,
          sceneBeats: applyRun.sceneBeats,
          draftContent: applyRun.draftContent,
          styleAudit: applyRun.styleAudit,
          continuityReport: applyRun.continuityReport,
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
        return chapterId!;
      });
      if (!guarded.executed) {
        return res.status(409).json({ code: 'DATABASE_GENERATION_MISMATCH', error: '数据库已变化，请刷新后重试' });
      }
      const chapterId = guarded.result;

      // Background-index chapter for vector RAG (don't block the response)
      addChunk(run.novelId, chapterId!, 0, applyRun.draftContent).catch((e) => {
        if (e instanceof EmbeddingUnavailableError) {
          logger.warn('Semantic retrieval unavailable; chapter was saved without vector indexing');
          return;
        }
        if (e instanceof Error && e.name === 'VectorIndexGenerationMismatchError') {
          logger.warn('Semantic retrieval task discarded after database replacement');
          return;
        }
        logger.error('Failed to add chunk to vector store:', e);
      });

      res.json({
        chapterId,
        factCandidateId: db.getChapter(chapterId)?.workflowMeta?.factCandidateId,
        narrativePromiseCandidates: applyRun.continuityReport.proposedPatch.narrativePromiseCandidates || [],
      });
    } catch (e) {
      if (e instanceof ProductionDomainConflict) {
        return res.status(409).json({ error: e.message });
      }
      logger.error(String(e));
      res.status(500).json({ error: PRODUCTION_APPLY_FAILED_ERROR });
    }
  });
}

async function runEvolutionReflexion(
  novelId: string,
  databaseGeneration: number,
  executionSnapshot: ResolvedWritingStyleRequest['executionSnapshot'],
): Promise<void> {
  let reflexionKey: string | undefined;
  try {
    if (databaseGeneration !== getDatabaseGeneration()) return;

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
以下是本次反思所属 Critic 阶段的执行规则。仅遵循此阶段规则，不得使用 Planner 或 Writer 阶段规则：
${executionSnapshot.stagePrompts.critic}

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
      databaseGeneration,
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

/** @internal Test-only hooks for deterministic production concurrency coverage. */
export const __productionTestHooks = {
  runEvolutionReflexion,
  resetReflexionKeys(): void {
    completedReflexionKeys.clear();
  },
  /**
   * When set to a non-null function, the start-stream route calls it after
   * building the fallback content but BEFORE the fallback write queue.
   * The hook may return a Promise to simulate queue delay. The route waits
   * for it before proceeding to the disconnect guard and write queue.
   * Set to null to restore normal behavior.
   */
  preFallbackWriteHook: null as (() => Promise<void> | void) | null,
  /**
   * When set to a non-null function, the AI pipeline .then() callback calls
   * it AFTER emitting model_beats/score but BEFORE the model write queue.
   * Used to simulate disconnect during model write queue wait.
   */
  preModelWriteHook: null as (() => Promise<void> | void) | null,
  /** Called after the route has observed a real client disconnect. */
  disconnectObservedHook: null as (() => void) | null,
};
