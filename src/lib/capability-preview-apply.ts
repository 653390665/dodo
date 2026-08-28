import { computeChapterWorkflowHash } from '../../shared/lib/chapter-workflow';
import { validateCandidateDraftQuality } from '../../shared/lib/draft-quality';

export function buildCapabilityPreviewApplication(input: {
  content: string;
  sceneBeats?: string;
  selection?: { start: number; end: number };
  baselineHash: string;
  preview: string;
}): { ok: true; nextContent: string } | { ok: false; code: 'CAPABILITY_PREVIEW_STALE' | 'CAPABILITY_PREVIEW_INVALID_SELECTION' | 'CAPABILITY_PREVIEW_NO_CHANGES' | 'CAPABILITY_PREVIEW_EMPTY_CHAPTER' | 'CAPABILITY_PREVIEW_QUALITY_GATE_FAILED'; violations?: string[] } {
  if (
    input.selection
    && (!Number.isInteger(input.selection.start)
      || !Number.isInteger(input.selection.end)
      || input.selection.start < 0
      || input.selection.end <= input.selection.start
      || input.selection.end > input.content.length)
  ) {
    return { ok: false, code: 'CAPABILITY_PREVIEW_INVALID_SELECTION' };
  }
  const baselineContent = input.selection
    ? input.content.slice(input.selection.start, input.selection.end)
    : input.content;
  if (computeChapterWorkflowHash(baselineContent, input.sceneBeats) !== input.baselineHash) {
    return { ok: false, code: 'CAPABILITY_PREVIEW_STALE' };
  }
  if (!input.selection && input.preview.trim().length === 0) {
    return { ok: false, code: 'CAPABILITY_PREVIEW_EMPTY_CHAPTER' };
  }
  if (input.preview === baselineContent) {
    return { ok: false, code: 'CAPABILITY_PREVIEW_NO_CHANGES' };
  }
  const nextContent = input.selection
    ? `${input.content.slice(0, input.selection.start)}${input.preview}${input.content.slice(input.selection.end)}`
    : input.preview;
  const wholeChapter = !input.selection || (input.selection.start === 0 && input.selection.end === input.content.length);
  const quality = validateCandidateDraftQuality(nextContent, wholeChapter ? input.content : baselineContent);
  if (!quality.ok) {
    return {
      ok: false,
      code: 'CAPABILITY_PREVIEW_QUALITY_GATE_FAILED',
      violations: quality.violations,
    };
  }
  return { ok: true, nextContent };
}
