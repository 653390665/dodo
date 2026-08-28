import type { Chapter, ChapterReviewState } from '../types/novel.js';
import type { ChapterCompletionGate as CompletionGate } from '../types/creative-artifacts.js';
import { computeChapterWorkflowHash } from './chapter-workflow.js';

export type ChapterCompletionPhase = 'writes-flushed' | 'version-created' | 'deterministic-checked' | 'ai-reviewed' | 'facts-proposed';
export type ChapterCompletionQuality = 'pass' | 'needs-action' | 'unknown';
export interface ChapterCompletionInput { content: string; sceneBeats?: string; reviewState?: ChapterReviewState; deterministicIssues?: string[]; aiStatus?: 'pass' | 'fail' | 'unknown' | 'unavailable'; planHash?: string; }
export interface ChapterCompletionGate {
  contentHash: string;
  planHash: string;
  quality: ChapterCompletionQuality;
  completionGate: CompletionGate;
  deterministicIssues: string[];
  unknownChecks: string[];
  reviewRequired: boolean;
  canAcceptLocalRevision: boolean;
}
export interface CompleteChapterInput extends Partial<ChapterCompletionInput> { novelId: string; chapterId: string; databaseGeneration: number; retryUnavailable?: boolean; }
export interface AcceptChapterRiskInput { unresolvedIssueIds: string[]; unknownChecks: string[]; contentHash: string; planHash: string; authorDecisionAt?: number; }
export interface ChapterCompletionResult { quality: ChapterCompletionQuality; gate: ChapterCompletionGate; phase: ChapterCompletionPhase; attemptId?: string; factCandidateId?: string; factCandidateRunId?: string; riskAccepted?: boolean; }

export function deriveChapterCompletionGate(input: ChapterCompletionInput): ChapterCompletionGate {
  const contentHash = computeChapterWorkflowHash(input.content, input.sceneBeats);
  const planHash = input.planHash || computeChapterWorkflowHash(input.sceneBeats || '');
  const deterministicIssues = [...(input.deterministicIssues || [])];
  const review = input.reviewState && input.reviewState.contentHash === contentHash ? input.reviewState : undefined;
  const reviewIssues = review?.issues.filter((issue) => ['open', 'previewed', 'applied'].includes(issue.status) && ['critical', 'major', 'high'].includes(issue.severity)).map((issue) => issue.id) || [];
  const allIssues = [...new Set([...deterministicIssues, ...reviewIssues])];
  let quality: ChapterCompletionQuality = allIssues.length ? 'needs-action' : 'unknown';
  if (input.aiStatus === 'pass' || review?.gate === 'pass') quality = allIssues.length ? 'needs-action' : 'pass';
  if (input.aiStatus === 'fail' || review?.gate === 'needs-action') quality = 'needs-action';
  const aiUnknown = input.aiStatus === 'unknown' || input.aiStatus === 'unavailable' || (!input.aiStatus && !review);
  if (aiUnknown && allIssues.length === 0) quality = 'unknown';
  const reviewIssuesHaveEvidence = Boolean(review?.issues.some((issue) => allIssues.includes(issue.id) && Boolean(issue.snippet?.trim()) && Boolean(issue.suggestedFix?.trim())));
  const completionGate: CompletionGate = quality === 'pass' ? 'ready' : quality === 'needs-action' ? 'needs-action' : 'review-required';
  return {
    contentHash, planHash, quality, completionGate, deterministicIssues: allIssues,
    unknownChecks: aiUnknown ? ['ai-review'] : [],
    reviewRequired: !review && !input.aiStatus,
    canAcceptLocalRevision: reviewIssuesHaveEvidence,
  };
}

export function completeChapter(input: CompleteChapterInput): ChapterCompletionResult {
  const gate = deriveChapterCompletionGate({ content: input.content || '', sceneBeats: input.sceneBeats, reviewState: input.reviewState, deterministicIssues: input.deterministicIssues, aiStatus: input.aiStatus, planHash: input.planHash });
  return { quality: gate.quality, gate, phase: 'facts-proposed' };
}

export function acceptChapterRisk(input: AcceptChapterRiskInput): ChapterCompletionResult {
  const gate: ChapterCompletionGate = {
    contentHash: input.contentHash, planHash: input.planHash, quality: 'unknown', completionGate: 'accepted-risk',
    deterministicIssues: input.unresolvedIssueIds, unknownChecks: input.unknownChecks, reviewRequired: false, canAcceptLocalRevision: false,
  };
  return { quality: 'unknown', gate, phase: 'ai-reviewed', riskAccepted: true };
}

export function chapterCompletionHashes(chapter: Pick<Chapter, 'content' | 'sceneBeats'>, planHash?: string): { contentHash: string; planHash: string } {
  return { contentHash: computeChapterWorkflowHash(chapter.content, chapter.sceneBeats), planHash: planHash || computeChapterWorkflowHash(chapter.sceneBeats || '') };
}
