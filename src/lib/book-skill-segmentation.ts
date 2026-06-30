import type { BookEvidenceSegment, BookEvidenceStage } from '../../shared/types';

const STAGE_WINDOWS: Array<{ stage: BookEvidenceStage; label: string; startRatio: number; endRatio: number }> = [
  { stage: 'opening', label: '开篇信号', startRatio: 0, endRatio: 0.18 },
  { stage: 'early-mid', label: '前中段信号', startRatio: 0.18, endRatio: 0.38 },
  { stage: 'mid', label: '中段信号', startRatio: 0.38, endRatio: 0.62 },
  { stage: 'late-mid', label: '后中段信号', startRatio: 0.62, endRatio: 0.82 },
  { stage: 'climax', label: '高潮与收束信号', startRatio: 0.82, endRatio: 1 },
];

const MIN_SEGMENT_CHARS = 300;
const SINGLE_SEGMENT_MAX_CHARS = 2000;

export function buildBookEvidenceSegments(text: string): BookEvidenceSegment[] {
  const normalized = text.trim();
  if (!normalized) return [];

  const length = normalized.length;

  // Short texts: single full-text segment avoids expensive multi-LLM calls
  if (length < SINGLE_SEGMENT_MAX_CHARS) {
    return [{
      id: 'segment-1',
      stage: 'opening',
      label: '全文分析',
      excerpt: normalized,
      startRatio: 0,
      endRatio: 1,
    }];
  }

  // Long texts: 5-stage segmentation with minimum content per segment
  return STAGE_WINDOWS.map((window, index) => {
    const start = Math.floor(length * window.startRatio);
    const end = Math.max(start + 1, Math.floor(length * window.endRatio));
    return {
      id: `segment-${index + 1}`,
      stage: window.stage,
      label: window.label,
      excerpt: normalized.slice(start, end).trim(),
      startRatio: window.startRatio,
      endRatio: window.endRatio,
    };
  }).filter((segment) => segment.excerpt.length >= MIN_SEGMENT_CHARS);
}
