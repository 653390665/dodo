import type {
  ContinuationConflictResolution,
  ContinuationContradiction,
  ContinuationImportTargetMode,
  ContinuationPack,
  Novel,
} from '../types';

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

  const hasHighContradiction = pack.contradictions.some(
    (contradiction) => contradiction.severity === 'high' && !isContinuationContradictionResolved(contradiction),
  );

  return !hasHighContradiction;
}

export function isContinuationContradictionResolved(contradiction: ContinuationContradiction): boolean {
  return Boolean(contradiction.acceptedResolution?.trim())
    && typeof contradiction.resolvedAt === 'number'
    && Number.isFinite(contradiction.resolvedAt);
}

export function applyContinuationConflictResolutions(
  pack: ContinuationPack,
  resolutions: ContinuationConflictResolution[],
  resolvedAt = Date.now(),
): ContinuationPack {
  const resolutionById = new Map<string, string>();
  for (const item of resolutions) {
    if (resolutionById.has(item.contradictionId)) {
      throw new Error(`重复的冲突裁决 ID: ${item.contradictionId}`);
    }
    const resolution = item.resolution.trim();
    if (!resolution || resolution.length > 1_000) {
      throw new Error(`冲突裁决内容无效: ${item.contradictionId}`);
    }
    resolutionById.set(item.contradictionId, resolution);
  }

  const contradictionIds = new Set(pack.contradictions.map((item) => item.id));
  for (const contradictionId of resolutionById.keys()) {
    if (!contradictionIds.has(contradictionId)) {
      throw new Error(`未知的冲突裁决 ID: ${contradictionId}`);
    }
  }

  return {
    ...pack,
    contradictions: pack.contradictions.map((contradiction) => {
      const acceptedResolution = resolutionById.get(contradiction.id);
      return acceptedResolution === undefined
        ? contradiction
        : { ...contradiction, acceptedResolution, resolvedAt };
    }),
  };
}
