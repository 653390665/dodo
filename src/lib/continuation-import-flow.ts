import type { ContinuationImportTargetMode, ContinuationPack, Novel } from '../../shared/types';

const IMPORTED_NOVEL_FALLBACK_TITLE = '导入续写作品';
const CONTINUATION_PACK_SUFFIX = '资料包';

export function resolveContinuationImportTargetMode(novels: Novel[]): ContinuationImportTargetMode {
  return novels.length > 0 ? 'existing' : 'new';
}

export function buildImportedNovelDraft(packTitle: string): Pick<Novel, 'title' | 'summary'> {
  const normalizedTitle = packTitle.trim();
  const titleWithoutSuffix = normalizedTitle.endsWith(CONTINUATION_PACK_SUFFIX)
    ? normalizedTitle.slice(0, -CONTINUATION_PACK_SUFFIX.length).trim()
    : normalizedTitle;
  const derivedTitle = titleWithoutSuffix || IMPORTED_NOVEL_FALLBACK_TITLE;

  return {
    title: derivedTitle,
    summary: titleWithoutSuffix
      ? `由资料包「${titleWithoutSuffix}」导入创建，用于资料驱动续写。`
      : '由资料包导入创建，用于资料驱动续写。',
  };
}

export function canApproveContinuationImportPack(pack: ContinuationPack | null): boolean {
  if (!pack) {
    return false;
  }

  const hasCanonFacts = pack.canonFacts.length > 0;
  const hasHighContradiction = pack.contradictions.some((contradiction) => contradiction.severity === 'high');

  return hasCanonFacts && !hasHighContradiction;
}
