import type { ChapterWorkflowMeta } from '../../shared/types/novel';
import { computeChapterWorkflowHash } from '../../shared/lib/chapter-workflow';
export type WorkflowPhase = 'import' | 'review' | 'sync' | 'planning' | 'drafting' | 'audit' | 'polish' | 'next_chapter';
export type WorkflowAction = 'import' | 'review' | 'sync' | 'planning' | 'drafting' | 'audit' | 'polish' | 'next_chapter' | 'resume'
  | 'generate-plan' | 'generate-prose' | 'complete-chapter' | 'resolve-issues' | 'confirm-facts' | 'create-next-chapter';
export type WorkflowSyncState = 'synced' | 'not_started' | 'partial' | 'stale' | 'unknown' | 'not-required';

export interface WorkflowChapterState {
  content?: string | null;
  sceneBeats?: string | null;
  critique?: string | null;
  workflowMeta?: ChapterWorkflowMeta;
}

export interface WorkflowStateInput {
  loading: boolean;
  chapter?: WorkflowChapterState | null;
  packStatus?: 'approved' | 'draft' | 'none' | null;
  syncState?: WorkflowSyncState | null;
}

export interface WorkflowState {
  phase: WorkflowPhase;
  primaryAction: WorkflowAction | null;
  secondaryAction: WorkflowAction | null;
  hasContent: boolean;
  hasBeats: boolean;
  hasCritique: boolean;
  needsPackSync: boolean;
}

export function deriveProjectWorkflowState(input: WorkflowStateInput): WorkflowState {
  const hasContent = Boolean(input.chapter?.content?.trim());
  const hasBeats = Boolean(input.chapter?.sceneBeats?.trim());
  const hasCritique = Boolean(input.chapter?.critique?.trim());
  const hash = input.chapter ? computeChapterWorkflowHash(input.chapter.content || '', input.chapter.sceneBeats || '') : '';
  const needsPackSync = input.packStatus === 'approved'
    && (input.syncState === 'not_started' || input.syncState === 'partial' || input.syncState === 'stale');

  if (input.loading) {
    return { phase: 'import', primaryAction: null, secondaryAction: null, hasContent, hasBeats, hasCritique, needsPackSync };
  }

  if (needsPackSync) {
    return {
      phase: 'sync',
      primaryAction: 'sync',
      secondaryAction: hasBeats ? (hasContent ? 'audit' : 'drafting') : 'planning',
      hasContent,
      hasBeats,
      hasCritique,
      needsPackSync,
    };
  }

  if (input.packStatus === 'draft') {
    return {
      phase: 'review',
      primaryAction: 'review',
      secondaryAction: hasBeats ? (hasContent ? 'audit' : 'drafting') : 'planning',
      hasContent,
      hasBeats,
      hasCritique,
      needsPackSync,
    };
  }

  if (!input.chapter) {
    return { phase: 'import', primaryAction: null, secondaryAction: null, hasContent, hasBeats, hasCritique, needsPackSync };
  }

  const lastAudit = input.chapter?.workflowMeta?.lastAudit;
  const auditValid = Boolean(lastAudit && lastAudit.completedAt && lastAudit.contentHash === hash);
  const reviewState = input.chapter?.workflowMeta?.reviewState;
  const reviewStateCurrent = Boolean(reviewState && reviewState.contentHash === hash);
  const lastPolish = input.chapter?.workflowMeta?.lastPolish;
  const phase: WorkflowPhase = !hasBeats
    ? 'planning'
    : !hasContent
      ? 'drafting'
      : reviewState && !reviewStateCurrent
        ? 'audit'
          : reviewStateCurrent && (reviewState?.gate === 'unknown' || reviewState?.gate === 'review-required')
          ? 'audit'
          : reviewStateCurrent && reviewState?.gate === 'needs-action'
            ? 'polish'
            : reviewStateCurrent && (reviewState?.gate === 'pass' || reviewState?.gate === 'accepted-risk')
              ? 'next_chapter'
      : lastPolish?.outputHash === hash
        ? 'next_chapter'
        : !auditValid || lastAudit?.status === 'unknown' || lastAudit?.status === 'not_run'
        ? 'audit'
        : lastAudit?.status === 'fail'
          ? 'polish'
          : 'next_chapter';
  const completionGate = input.chapter.workflowMeta?.completionContentHash === hash
    ? input.chapter.workflowMeta.completionGate
    : undefined;
  const hasPendingFacts = Boolean(
    input.chapter.workflowMeta?.factCandidateId
    && input.chapter.workflowMeta?.factCandidateRunId,
  );
  const hasBlockingIssues = Boolean(reviewStateCurrent && reviewState?.gate === 'needs-action')
    || Boolean(lastAudit && auditValid && lastAudit.status === 'fail');

  let primaryAction: WorkflowAction;
  if (!hasBeats) primaryAction = 'generate-plan';
  else if (!hasContent) primaryAction = 'generate-prose';
  else if (completionGate === 'ready' || completionGate === 'accepted-risk') {
    primaryAction = hasPendingFacts ? 'confirm-facts' : 'create-next-chapter';
  } else if (hasBlockingIssues) primaryAction = 'resolve-issues';
  else primaryAction = 'complete-chapter';

  return { phase, primaryAction, secondaryAction: phase === 'next_chapter' ? 'audit' : 'resume', hasContent, hasBeats, hasCritique, needsPackSync };
}

export const deriveWorkflowState = deriveProjectWorkflowState;
