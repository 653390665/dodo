import type { AiContentCandidate } from './generation-action-state';
import { MIN_COMPLETE_CHAPTER_CHARS } from '../../shared/lib/draft-quality';

export type CandidateQualityStatus = 'eligible' | 'blocked' | 'review-required' | 'fallback';

/** 007 T5：AI 正文候选质量门判定的唯一实现。 */
export function getCandidateQualityState(candidate: AiContentCandidate): {
  status: CandidateQualityStatus;
  label: string;
  detail: string;
} {
  const quality = candidate.quality;
  const source = candidate.source;
  if (source === 'fallback') return { status: 'fallback', label: '保底结果', detail: '当前结果来自保底流程，不能冒充模型审阅结果。' };
  if (!quality) return { status: 'review-required', label: '待复核', detail: '尚未取得完整质量报告，暂不能写入。' };
  if (!quality.ok || quality.mechanicalReview?.status === 'needs-action') return { status: 'blocked', label: '质量阻断', detail: '存在硬性或机械质量问题，需精修后重新审阅。' };
  if (candidate.operation === 'rewrite' && candidate.content.replace(/\s/g, '').length < MIN_COMPLETE_CHAPTER_CHARS) return { status: 'eligible', label: '可写入片段', detail: '局部改写通过确定性检查，可写入选区；整章质量仍需单独审阅。' };
  if (quality.semanticReview.status !== 'pass') return { status: 'review-required', label: '待复核', detail: quality.semanticReview.status === 'needs-action' ? '语义审阅发现问题，需处理后重新审阅。' : '语义审阅尚未完成，暂不能确认写入。' };
  return { status: 'eligible', label: '可写入', detail: '硬性、机械和语义审阅均已通过。' };
}
