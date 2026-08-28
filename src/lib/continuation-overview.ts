import type { ContinuationOverviewState, ContinuationPack } from '../../shared/types';
import { isContinuationContradictionResolved } from '../../shared/lib/continuation-import-flow';

function sortByRecency(packs: ContinuationPack[]): ContinuationPack[] {
  return [...packs].sort((a, b) => b.updatedAt - a.updatedAt);
}

function hasHighRisk(pack: ContinuationPack | null): boolean {
  if (!pack) return false;
  return (
    pack.contradictions.some((item) => item.severity === 'high' && !isContinuationContradictionResolved(item)) ||
    (pack.continuationGaps || []).some((item) => item.severity === 'high')
  );
}

function buildWarnings(pack: ContinuationPack | null): string[] {
  if (!pack) return [];

  const contradictionWarnings = pack.contradictions
    .filter((item) => item.severity === 'high' && !isContinuationContradictionResolved(item))
    .slice(0, 1)
    .map((item) => item.summary);

  const gapWarnings = (pack.continuationGaps || [])
    .filter((item) => item.severity === 'high')
    .slice(0, 1)
    .map((item) => item.description);

  return [...contradictionWarnings, ...gapWarnings].filter(Boolean).slice(0, 2);
}

export function buildContinuationOverviewState(packs: ContinuationPack[]): ContinuationOverviewState {
  const draftPack = sortByRecency(packs.filter((pack) => pack.status === 'draft'))[0] || null;
  const approvedPack = sortByRecency(packs.filter((pack) => pack.status === 'approved'))[0] || null;

  const primaryPack = approvedPack || draftPack;

  if (!primaryPack) {
    return {
      kind: 'empty',
      primaryPack: null,
      draftPack: null,
      approvedPack: null,
      contradictionCount: 0,
      readingQuestionCount: 0,
      continuationGapCount: 0,
      highlightWarnings: [],
    };
  }

  const isDraftOnly = !approvedPack && primaryPack === draftPack;

  return {
    kind: isDraftOnly ? 'draft' : hasHighRisk(primaryPack) ? 'risk' : 'ready',
    primaryPack,
    draftPack,
    approvedPack,
    contradictionCount: primaryPack.contradictions.filter((item) => !isContinuationContradictionResolved(item)).length,
    readingQuestionCount: primaryPack.readingQuestions?.length || 0,
    continuationGapCount: primaryPack.continuationGaps?.length || 0,
    highlightWarnings: buildWarnings(primaryPack),
  };
}
