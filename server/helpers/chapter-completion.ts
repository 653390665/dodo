import { randomUUID } from 'node:crypto';
import { getConfig } from '../lib/config.js';
import { governedGenerateText } from './governed-llm.js';
import { parseAuditResponseWithDiagnostics } from '../../shared/lib/audit-structured.js';
import { buildAuditWindow } from '../helpers/prompt-helpers.js';
import { computeChapterWorkflowHash } from '../../shared/lib/chapter-workflow.js';
import { deriveReviewGate, structuredAuditToReviewIssues } from '../../shared/lib/review-issues.js';
import { semanticReviewFromStructuredAudit } from '../../shared/lib/draft-quality.js';
import type { ChapterReviewState } from '../../shared/types/novel.js';
import { acceptChapterRisk as deriveRisk, chapterCompletionHashes, deriveChapterCompletionGate, type CompleteChapterInput, type AcceptChapterRiskInput, type ChapterCompletionResult } from '../../shared/lib/chapter-completion.js';
import * as db from '../lib/db.js';
import { getDatabaseGeneration, runInSerializedWriteForGeneration, runInTransaction } from '../lib/db-instance.js';
import { buildChapterFactCandidate, previewChapterFactCandidate } from './chapter-fact-candidates.js';

type ReviewStatus = 'pass' | 'fail' | 'unknown' | 'unavailable';
type ReviewResult = { status: ReviewStatus; proposedPatch?: unknown; reviewState?: ChapterReviewState };
type CompletionDeps = {
  deterministic?: (content: string, sceneBeats: string) => string[];
  review?: (content: string, sceneBeats: string) => Promise<ReviewStatus | ReviewResult>;
  reviewProvider?: typeof governedGenerateText;
  proposedPatch?: unknown;
  afterPhase?: (phase: Phase) => void;
};
type Phase = 'writes-flushed' | 'version-created' | 'deterministic-checked' | 'ai-reviewed' | 'facts-proposed';
type StoredState = {
  versionId?: string;
  aiStatus?: ReviewStatus;
  reviewState?: ChapterReviewState;
  proposedPatch?: unknown;
  factCandidate?: ReturnType<typeof buildChapterFactCandidate>;
  completionResult?: ChapterCompletionResult;
};

const PHASE_ORDER: Phase[] = ['writes-flushed', 'version-created', 'deterministic-checked', 'ai-reviewed', 'facts-proposed'];
function phaseAtLeast(current: Phase | undefined, target: Phase): boolean {
  return current ? PHASE_ORDER.indexOf(current) >= PHASE_ORDER.indexOf(target) : false;
}
function readState(value: unknown): StoredState {
  return value && typeof value === 'object' ? value as StoredState : {};
}

async function persist(
  input: Parameters<typeof db.upsertChapterCompletionAttempt>[0],
  phase: Phase,
  state: StoredState,
  extra: Partial<Parameters<typeof db.upsertChapterCompletionAttempt>[0]> = {},
): Promise<void> {
  const guarded = await runInSerializedWriteForGeneration(input.databaseGeneration, () => db.upsertChapterCompletionAttempt({
    ...input, ...extra, phase, result: state, updatedAt: Date.now(),
  }));
  if (!guarded.executed) throw new Error('DATABASE_GENERATION_STALE');
}

async function defaultReview(novelId: string, content: string, sceneBeats: string, reviewProvider = governedGenerateText): Promise<ReviewResult> {
  const config = getConfig();
  if (reviewProvider === governedGenerateText && (!config.apiKey || config.apiKey === '你的key')) return { status: 'unavailable' };
  try {
    const raw = await reviewProvider(config, {
      prompt: `你是章节完成审稿器。只审查以下已接受正文与场景节拍，严格输出 JSON：{"score":0-100,"fatalIssues":[],"sceneChecks":[],"surgerySuggestions":[]}。不要改写正文，不要写 Canon。\n场景节拍：${sceneBeats.slice(0, 4000)}\n正文：${buildAuditWindow(content)}`,
      outputMode: 'audit-json',
      responseMimeType: 'application/json',
    }, { operation: 'chapter-completion-review', novelId, timeoutMs: 60_000, concurrency: 1, databaseGeneration: getDatabaseGeneration() });
    const parsed = parseAuditResponseWithDiagnostics(raw);
    const audit = parsed.structured;
    if (parsed.diagnostic || !audit || !Number.isFinite(audit.score) || audit.score < 0 || audit.score > 100) return { status: 'unknown' };
    const contentHash = computeChapterWorkflowHash(content, sceneBeats);
    const issues = structuredAuditToReviewIssues(audit, contentHash);
    const status = audit.score >= 60 && !audit.fatalIssues.some((issue) => issue.severity === 'critical') ? 'pass' : 'fail';
    return {
      status, proposedPatch: {}, reviewState: {
        schemaVersion: 1, contentHash, issues, gate: deriveReviewGate(issues, status), lastReviewedAt: Date.now(), semanticReview: semanticReviewFromStructuredAudit(audit),
      },
    };
  } catch {
    return { status: 'unknown' };
  }
}

export async function completeChapter(input: CompleteChapterInput, deps: CompletionDeps = {}): Promise<ChapterCompletionResult> {
  const chapter = db.getChapter(input.chapterId);
  const novel = db.getNovel(input.novelId);
  if (!novel || !chapter || chapter.novelId !== input.novelId) throw new Error('CHAPTER_NOT_FOUND_OR_NOT_OWNED');
  if (!Number.isInteger(input.databaseGeneration) || input.databaseGeneration !== getDatabaseGeneration()) throw new Error('DATABASE_GENERATION_STALE');
  const hashes = chapterCompletionHashes(chapter);
  const existing = db.findChapterCompletionAttempt({ novelId: input.novelId, chapterId: input.chapterId, databaseGeneration: input.databaseGeneration, ...hashes });
  const state = readState(existing?.result);
  let retryingUnavailable = false;
  if (existing?.phase === 'facts-proposed' && state.completionResult) {
    if (input.retryUnavailable && state.completionResult.gate.unknownChecks.length > 0) {
      delete state.aiStatus;
      delete state.reviewState;
      delete state.factCandidate;
      delete state.completionResult;
      retryingUnavailable = true;
    } else {
      return state.completionResult;
    }
  }

  const deterministicIssues = deps.deterministic ? deps.deterministic(chapter.content, chapter.sceneBeats || '') : (chapter.content.trim() ? [] : ['empty-manuscript']);
  const trustedReview = !retryingUnavailable && chapter.workflowMeta?.reviewState?.contentHash === hashes.contentHash ? chapter.workflowMeta.reviewState : undefined;
  let reviewState = trustedReview || (state.reviewState && state.reviewState.contentHash === hashes.contentHash ? state.reviewState : undefined);
  let gate = deriveChapterCompletionGate({ content: chapter.content, sceneBeats: chapter.sceneBeats, reviewState, deterministicIssues });
  const now = Date.now();
  const attempt = existing || { id: randomUUID(), novelId: input.novelId, chapterId: input.chapterId, databaseGeneration: input.databaseGeneration, contentHash: hashes.contentHash, planHash: hashes.planHash, phase: 'writes-flushed' as const, quality: gate.quality, issueIds: gate.deterministicIssues, unknownChecks: gate.unknownChecks, createdAt: now, updatedAt: now };

  if (!phaseAtLeast(existing?.phase, 'writes-flushed')) {
    await persist(attempt, 'writes-flushed', state, { quality: gate.quality, issueIds: gate.deterministicIssues, unknownChecks: gate.unknownChecks });
    deps.afterPhase?.('writes-flushed');
  }

  if (!phaseAtLeast(existing?.phase, 'version-created')) {
    const versionId = state.versionId || randomUUID();
    const guarded = await runInSerializedWriteForGeneration(input.databaseGeneration, () => runInTransaction(() => {
      db.createChapterVersion({ id: versionId, chapterId: chapter.id, content: chapter.content, wordCount: chapter.wordCount, author: 'user', createdAt: Date.now() });
      db.upsertChapterCompletionAttempt({ ...attempt, phase: 'version-created', quality: gate.quality, issueIds: gate.deterministicIssues, unknownChecks: gate.unknownChecks, result: { ...state, versionId }, updatedAt: Date.now() });
    }));
    if (!guarded.executed) throw new Error('DATABASE_GENERATION_STALE');
    state.versionId = versionId;
    deps.afterPhase?.('version-created');
  }

  if (!phaseAtLeast(existing?.phase, 'deterministic-checked')) {
    await persist(attempt, 'deterministic-checked', state, { quality: gate.quality, issueIds: gate.deterministicIssues, unknownChecks: gate.unknownChecks });
    deps.afterPhase?.('deterministic-checked');
  }

  let aiStatus: ReviewStatus;
  if (retryingUnavailable || !phaseAtLeast(existing?.phase, 'ai-reviewed')) {
    if (reviewState) aiStatus = reviewState.gate === 'pass' ? 'pass' : reviewState.gate === 'needs-action' ? 'fail' : 'unknown';
    else {
      const review = deps.review ? await deps.review(chapter.content, chapter.sceneBeats || '') : await defaultReview(input.novelId, chapter.content, chapter.sceneBeats || '', deps.reviewProvider);
      const normalized = typeof review === 'string' ? { status: review } : review;
      aiStatus = normalized.status;
      state.proposedPatch = normalized.proposedPatch;
      reviewState = normalized.reviewState;
      if (reviewState) state.reviewState = reviewState;
    }
    gate = deriveChapterCompletionGate({ content: chapter.content, sceneBeats: chapter.sceneBeats, reviewState, deterministicIssues, aiStatus });
    state.aiStatus = aiStatus;
    await persist(attempt, retryingUnavailable ? 'facts-proposed' : 'ai-reviewed', state, {
      quality: gate.quality,
      issueIds: gate.deterministicIssues,
      unknownChecks: gate.unknownChecks,
      ...(retryingUnavailable ? { factCandidateId: undefined } : {}),
    });
    deps.afterPhase?.('ai-reviewed');
  } else {
    aiStatus = state.aiStatus || 'unknown';
    gate = deriveChapterCompletionGate({ content: chapter.content, sceneBeats: chapter.sceneBeats, reviewState, deterministicIssues, aiStatus });
  }

  if (retryingUnavailable || !phaseAtLeast(existing?.phase, 'facts-proposed') || !state.completionResult) {
    // The review may take long enough for the author to edit this chapter.
    // Re-read the row before publishing review metadata so an old conclusion
    // can never be attached to newer prose.
    const currentBeforeWrite = db.getChapter(chapter.id);
    if (!currentBeforeWrite || currentBeforeWrite.novelId !== input.novelId) throw new Error('CHAPTER_NOT_FOUND_OR_NOT_OWNED');
    const currentHashes = chapterCompletionHashes(currentBeforeWrite);
    if (currentHashes.contentHash !== hashes.contentHash || currentHashes.planHash !== hashes.planHash) {
      throw new Error('CHAPTER_COMPLETION_STALE');
    }
    const sourceRun = db.listChapterProductionRuns(input.novelId).find((run) => run.targetChapterId === chapter.id && run.status === 'applied' && run.continuityReport.databaseGeneration === input.databaseGeneration && run.draftContent === chapter.content && run.sceneBeats === (chapter.sceneBeats || ''));
    const factCandidate = sourceRun
      ? previewChapterFactCandidate({ novelId: input.novelId, runId: sourceRun.id, databaseGeneration: input.databaseGeneration })
      : buildChapterFactCandidate({
        novelId: input.novelId, runId: attempt.id, draftContent: chapter.content, sceneBeats: chapter.sceneBeats || '',
        databaseGeneration: input.databaseGeneration, targetChapterId: chapter.id, proposedPatch: deps.proposedPatch || state.proposedPatch || {},
      });
    const pendingFactCandidate = sourceRun && factCandidate.facts.length > 0 ? factCandidate : undefined;
    state.factCandidate = pendingFactCandidate;
    state.proposedPatch = sourceRun?.continuityReport.proposedPatch || deps.proposedPatch || state.proposedPatch || {};
    state.completionResult = {
      quality: gate.quality, gate, phase: 'facts-proposed', attemptId: attempt.id,
      ...(pendingFactCandidate ? { factCandidateId: pendingFactCandidate.id, factCandidateRunId: pendingFactCandidate.runId } : {}),
    };
    const baseWorkflowMeta = { ...(chapter.workflowMeta || { version: 1 as const }) };
    delete baseWorkflowMeta.factCandidateId;
    delete baseWorkflowMeta.factCandidateRunId;
    const workflowMeta = {
      ...baseWorkflowMeta, version: 1 as const, completionGate: gate.completionGate, completionContentHash: gate.contentHash,
      ...(gate.completionGate === 'ready' ? { completionDecisionAt: Date.now() } : {}),
      ...(reviewState ? { reviewState } : {}),
      ...(pendingFactCandidate ? { factCandidateId: pendingFactCandidate.id, factCandidateRunId: pendingFactCandidate.runId } : {}),
    };
    const guarded = await runInSerializedWriteForGeneration(input.databaseGeneration, () => runInTransaction(() => {
      const current = db.getChapter(chapter.id);
      if (!current || current.novelId !== input.novelId) throw new Error('CHAPTER_NOT_FOUND_OR_NOT_OWNED');
      const currentHashes = chapterCompletionHashes(current);
      if (currentHashes.contentHash !== hashes.contentHash || currentHashes.planHash !== hashes.planHash) {
        throw new Error('CHAPTER_COMPLETION_STALE');
      }
      db.updateChapter(chapter.id, { workflowMeta });
      db.upsertChapterCompletionAttempt({ ...attempt, phase: 'facts-proposed', quality: gate.quality, issueIds: gate.deterministicIssues, unknownChecks: gate.unknownChecks, factCandidateId: pendingFactCandidate?.id, result: state, updatedAt: Date.now() });
    }));
    if (!guarded.executed) throw new Error('DATABASE_GENERATION_STALE');
    deps.afterPhase?.('facts-proposed');
  }
  return state.completionResult!;
}

export async function acceptChapterRisk(input: AcceptChapterRiskInput & { novelId: string; chapterId: string; databaseGeneration: number }): Promise<ChapterCompletionResult> {
  if (!Number.isInteger(input.databaseGeneration) || input.databaseGeneration !== getDatabaseGeneration()) throw new Error('DATABASE_GENERATION_STALE');
  const chapter = db.getChapter(input.chapterId);
  if (!chapter || chapter.novelId !== input.novelId) throw new Error('CHAPTER_NOT_FOUND_OR_NOT_OWNED');
  const hashes = chapterCompletionHashes(chapter);
  if (hashes.contentHash !== input.contentHash || hashes.planHash !== input.planHash) throw new Error('RISK_DECISION_STALE');
  const attempt = db.findChapterCompletionAttempt({ novelId: input.novelId, chapterId: input.chapterId, databaseGeneration: input.databaseGeneration, ...hashes });
  if (!attempt) throw new Error('COMPLETION_ATTEMPT_NOT_FOUND');
  const result = deriveRisk(input);
  const state = readState(attempt.result);
  state.completionResult = { ...(state.completionResult || result), quality: result.quality, gate: result.gate, riskAccepted: true };
  const workflowMeta = {
    ...(chapter.workflowMeta || { version: 1 as const }), version: 1 as const, completionGate: 'accepted-risk' as const,
    completionContentHash: result.gate.contentHash,
    completionDecisionAt: input.authorDecisionAt || Date.now(), factCandidateId: attempt.factCandidateId,
    ...(state.factCandidate?.runId ? { factCandidateRunId: state.factCandidate.runId } : {}),
  };
  const guarded = await runInSerializedWriteForGeneration(input.databaseGeneration, () => runInTransaction(() => {
    db.updateChapter(chapter.id, { workflowMeta });
    db.upsertChapterCompletionAttempt({ ...attempt, riskAcceptedAt: input.authorDecisionAt || Date.now(), issueIds: input.unresolvedIssueIds, unknownChecks: input.unknownChecks, result: state, updatedAt: Date.now() });
  }));
  if (!guarded.executed) throw new Error('DATABASE_GENERATION_STALE');
  return state.completionResult;
}
