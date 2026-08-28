import type { Chapter, ChapterReviewGate, ChapterReviewState, ContinuityReport, ReviewIssue, ReviewIssueStatus } from '../types/novel.js';
import type { StructuredAudit, StructuredAuditIssue } from './audit-structured.js';
import { extractStructuredAudit } from './audit-structured.js';
import { DEFAULT_SEMANTIC_REVIEW } from './quality-contract.js';
import { semanticReviewFromStructuredAudit } from './draft-quality.js';

function stableText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function stableIssueId(issue: Pick<ReviewIssue, 'source' | 'category' | 'issueType' | 'issueSubtype' | 'snippet' | 'explanation' | 'contentHash'>): string {
  const input = [issue.source, issue.category, issue.contentHash, issue.issueType, issue.issueSubtype || '', issue.snippet, issue.explanation].join('|');
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `review-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function fromStructuredIssue(issue: StructuredAuditIssue, contentHash = ''): ReviewIssue {
  const now = Date.now();
  const base = {
    source: 'chapter-audit' as const,
    category: issue.dimension || issue.issueType,
    issueType: issue.issueType,
    issueSubtype: issue.issueSubtype,
    severity: issue.severity,
    snippet: issue.snippet,
    explanation: issue.explanation,
    suggestedFix: issue.patchHint,
    recommendedCapabilityIds: recommendCapabilities(issue.dimension || issue.issueType, issue.issueType), contentHash,
  } as const;
  return { id: stableIssueId(base), ...base, createdAt: now, updatedAt: now, status: 'open' };
}

function fromStructuredEvidence(audit: NonNullable<StructuredAudit['evidence']>[number], contentHash = ''): ReviewIssue {
  const now = Date.now();
  const base = {
    source: 'chapter-audit' as const,
    category: audit.category,
    issueType: `semantic-${audit.category}`,
    issueSubtype: audit.category,
    severity: audit.severity === 'high' ? 'major' as const : audit.severity === 'medium' ? 'moderate' as const : 'low' as const,
    snippet: audit.quote,
    explanation: audit.explanation,
    suggestedFix: audit.suggestedFix,
    location: audit.location,
    recommendedCapabilityIds: recommendCapabilities(audit.category, `semantic-${audit.category}`),
    contentHash,
  } as const;
  return { id: stableIssueId(base), ...base, createdAt: now, updatedAt: now, status: 'open' };
}

export function structuredAuditToReviewIssues(audit: StructuredAudit | null | undefined, contentHash = ''): ReviewIssue[] {
  const issues = (audit?.fatalIssues || []).map((issue) => fromStructuredIssue(issue, contentHash));
  for (const evidence of audit?.evidence || []) {
    const duplicateIndex = issues.findIndex((issue) => (
      stableText(issue.snippet) === stableText(evidence.quote)
      && stableText(issue.explanation) === stableText(evidence.explanation)
    ));
    if (duplicateIndex >= 0) {
      if (!issues[duplicateIndex].location && evidence.location) {
        issues[duplicateIndex] = { ...issues[duplicateIndex], location: evidence.location };
      }
      continue;
    }
    issues.push(fromStructuredEvidence(evidence, contentHash));
  }
  const seen = new Set<string>();
  return issues.filter((issue) => {
    if (seen.has(issue.id)) return false;
    seen.add(issue.id);
    return true;
  });
}

export function continuityToReviewIssues(report: ContinuityReport | null | undefined, contentHash = ''): ReviewIssue[] {
  return (report?.issues || []).map((issue) => {
    const now = Date.now();
    const base = {
      source: 'production-audit' as const, category: issue.category, issueType: `continuity-${issue.category}`,
      issueSubtype: issue.category,
      severity: issue.severity,
      snippet: stableText(issue.evidence) || issue.message,
      explanation: issue.message,
      suggestedFix: issue.suggestedFix || '', recommendedCapabilityIds: recommendCapabilities(issue.category, `continuity-${issue.category}`), contentHash,
    } as const;
    return { id: stableIssueId(base), ...base, createdAt: now, updatedAt: now, status: 'open' };
  });
}

const ACTIVE_STATUSES = new Set<ReviewIssueStatus>(['open', 'previewed', 'applied']);

export function deriveReviewGate(issues: readonly ReviewIssue[], fallback: 'pass' | 'fail' | 'unknown' | 'not_run' = 'not_run'): ChapterReviewGate {
  if (fallback === 'unknown') return 'unknown';
  if (fallback === 'not_run') return 'review-required';
  const blocking = issues.some((issue) => ACTIVE_STATUSES.has(issue.status) && (issue.severity === 'critical' || issue.severity === 'major' || issue.severity === 'high'));
  if (blocking) return 'needs-action';
  if (issues.some((issue) => issue.status === 'accepted-risk')) return 'accepted-risk';
  return fallback === 'fail' && issues.length === 0 ? 'needs-action' : 'pass';
}

function recommendCapabilities(category = '', issueType = ''): string[] {
  const key = `${category} ${issueType}`.toLowerCase();
  if (/style|slop|syntax|ai-cliche|pacing/.test(key)) return ['de-ai-slop-shield', 'de-ai-rhythm-restorer'];
  if (/scene|action|dialogue|character/.test(key)) return ['prose-action-booster'];
  if (/hook|foreshadow/.test(key)) return ['deconstruct-suspense-hook'];
  if (/platform/.test(key)) return ['platform-tomato-scoring', 'platform-webnovel-criteria'];
  if (/canon|setting|timeline|logic|power|location|item/.test(key)) return ['bible-world-builder', 'opening-gold-three'];
  return [];
}

export interface ReviewRemediationContext {
  activeCapabilityIds?: readonly string[];
  availableCapabilityIds?: readonly string[];
}

export interface ReviewRemediationResolution {
  issueId: string;
  capabilityId?: string;
  candidateCapabilityIds: string[];
  stage: 'planner' | 'writer' | 'critic';
  scope: 'project' | 'chapter' | 'selection' | 'single-run';
  usesSystemDefault: boolean;
}

export function resolveReviewRemediation(issue: ReviewIssue, context: ReviewRemediationContext = {}): ReviewRemediationResolution {
  const candidates = issue.recommendedCapabilityIds.length ? issue.recommendedCapabilityIds : recommendCapabilities(issue.category, issue.issueType);
  const available = new Set(context.availableCapabilityIds || candidates);
  const active = new Set(context.activeCapabilityIds || []);
  const capabilityId = candidates.find((id) => active.has(id) && available.has(id)) || candidates.find((id) => available.has(id));
  const planner = /canon|setting|timeline|logic|foreshadow|platform/.test(`${issue.category || ''} ${issue.issueType || ''}`.toLowerCase());
  const scope = planner ? 'project' : issue.snippet ? 'selection' : 'chapter';
  return { issueId: issue.id, capabilityId, candidateCapabilityIds: candidates, stage: planner ? 'planner' : 'writer', scope, usesSystemDefault: !capabilityId };
}

export function deriveChapterReviewState(
  chapter: Pick<Chapter, 'content' | 'sceneBeats' | 'critique' | 'workflowMeta'>,
  contentHash: string,
): ChapterReviewState | undefined {
  const saved = chapter.workflowMeta?.reviewState;
  if (saved) {
    if (saved.contentHash === contentHash) return { ...saved, issues: saved.issues || [] };
    return {
      ...saved,
      gate: 'review-required',
      semanticReview: DEFAULT_SEMANTIC_REVIEW,
      issues: (saved.issues || []).map((issue) => ({ ...issue, status: 'stale', updatedAt: Date.now() })),
    };
  }
  const audit = chapter.critique ? extractStructuredAudit(chapter.critique) : null;
  if (!audit) return undefined;
  const status = audit.score >= 60 && !audit.fatalIssues.some((issue) => issue.severity === 'critical') ? 'pass' : 'fail';
  const lastReviewedAt = chapter.workflowMeta?.lastAudit?.completedAt || 0;
  const issues = structuredAuditToReviewIssues(audit, contentHash);
  return {
    schemaVersion: 1,
    contentHash,
    gate: deriveReviewGate(issues, status),
    lastReviewedAt,
    issues,
    semanticReview: semanticReviewFromStructuredAudit(audit),
  };
}

export function isReviewStateStale(state: Pick<ChapterReviewState, 'contentHash'> | undefined, currentContentHash: string): boolean {
  return Boolean(state && state.contentHash !== currentContentHash);
}
