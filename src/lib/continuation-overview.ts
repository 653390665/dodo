import type { ContinuationOverviewState, ContinuationPack } from '../types';

function sortByRecency(packs: ContinuationPack[]): ContinuationPack[] {
  return [...packs].sort((a, b) => b.updatedAt - a.updatedAt);
}

function hasHighRisk(pack: ContinuationPack | null): boolean {
  if (!pack) return false;
  return (
    pack.contradictions.some((item) => item.severity === 'high') ||
    (pack.continuationGaps || []).some((item) => item.severity === 'high')
  );
}

function buildWarnings(pack: ContinuationPack | null): string[] {
  if (!pack) return [];

  const contradictionWarnings = pack.contradictions
    .filter((item) => item.severity === 'high')
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

  if (draftPack) {
    return {
      kind: 'draft',
      primaryPack: draftPack,
      draftPack,
      approvedPack,
      contradictionCount: draftPack.contradictions.length,
      readingQuestionCount: draftPack.readingQuestions?.length || 0,
      continuationGapCount: draftPack.continuationGaps?.length || 0,
      highlightWarnings: buildWarnings(draftPack),
    };
  }

  if (approvedPack) {
    return {
      kind: hasHighRisk(approvedPack) ? 'risk' : 'ready',
      primaryPack: approvedPack,
      draftPack: null,
      approvedPack,
      contradictionCount: approvedPack.contradictions.length,
      readingQuestionCount: approvedPack.readingQuestions?.length || 0,
      continuationGapCount: approvedPack.continuationGaps?.length || 0,
      highlightWarnings: buildWarnings(approvedPack),
    };
  }

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
