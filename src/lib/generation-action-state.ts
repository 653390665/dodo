import type { DraftAcceptanceSource, DraftQualityReport } from '../../shared/lib/draft-quality';

export type AiActionStatus = 'idle' | 'running' | 'success' | 'error';
export type AiActionOperation = 'outline' | 'beats' | 'draft' | 'audit' | 'polish' | 'rewrite';

export interface AiContentCandidate {
  id: string;
  operation: Extract<AiActionOperation, 'draft' | 'rewrite' | 'polish'>;
  novelId: string;
  chapterId: string;
  databaseGeneration: number;
  createdAt: number;
  baselineHash: string;
  baselineContent: string;
  content: string;
  reviewIssueIds?: string[];
  reviewRecheck?: boolean;
  selectionStart?: number;
  selectionEnd?: number;
  instruction?: string;
  workflowMeta?: import('../../shared/types').ChapterWorkflowMeta;
  /** Structured audit feedback kept with the candidate until it is accepted. */
  auditFeedback?: string;
  quality?: DraftQualityReport;
  /** Provider provenance; fallback candidates must never be treated as model output. */
  source?: DraftAcceptanceSource;
}

/** Internal name used by the editor workflow contract. Candidates stay in memory. */
export type ManuscriptCandidate = AiContentCandidate;

export interface AiRetryContext {
  operation: Extract<AiActionOperation, 'rewrite' | 'polish'>;
  input?: { start: number; end: number; instruction: string; fingerprint?: string };
  fingerprint?: string;
}

export interface AiActionState {
  status: AiActionStatus;
  operation?: AiActionOperation;
  message?: string;
  startedAt?: number;
  elapsedMs?: number;
  retryable?: boolean;
  errorCode?: string;
}

const RUNNING_COPY: Record<AiActionOperation, string> = {
  outline: '正在生成全书大纲…',
  beats: '正在生成场景分镜…',
  draft: '正在生成正文…',
  audit: '正在审稿…',
  polish: '正在精修正文…',
  rewrite: '正在改写选中内容…',
};

export function idleAiAction(): AiActionState {
  return { status: 'idle' };
}

export function createAiActionRunning(
  operation: AiActionOperation,
  startedAt = Date.now(),
  message = RUNNING_COPY[operation],
): AiActionState {
  return { status: 'running', operation, startedAt, elapsedMs: 0, retryable: false, message };
}

export function createAiActionSuccess(
  current: AiActionState,
  message: string,
  finishedAt = Date.now(),
): AiActionState {
  return {
    ...current,
    status: 'success',
    message,
    elapsedMs: Math.max(0, finishedAt - (current.startedAt ?? finishedAt)),
    retryable: false,
    errorCode: undefined,
  };
}

export function createAiActionError(
  current: AiActionState,
  message: string,
  finishedAt = Date.now(),
  retryable = true,
  errorCode?: string,
): AiActionState {
  return {
    ...current,
    status: 'error',
    message,
    elapsedMs: Math.max(0, finishedAt - (current.startedAt ?? finishedAt)),
    retryable,
    ...(errorCode ? { errorCode } : {}),
  };
}
