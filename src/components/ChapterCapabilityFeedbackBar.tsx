import { useState } from 'react';

import { createSkillUsageRecord, syncSkillFeedbackScores } from '../lib/skill-client';

/**
 * Plan 241：章节完成时点的轻量能力反馈条（唯一采集点）。
 * 单击即提交（👍/😐/👎 → accepted/revised/rejected 的 usage record），
 * 不弹窗、不阻断；提交或忽略后本章不再询问（localStorage 幂等）。
 */

const RATING_MAP = {
  helpful: { userAction: 'accepted' as const, fitScore: 85, label: '有帮助' },
  soso: { userAction: 'revised' as const, fitScore: 55, label: '一般' },
  unhelpful: { userAction: 'rejected' as const, fitScore: 15, label: '没帮上' },
} as const;

type RatingKey = keyof typeof RATING_MAP;

const doneKey = (chapterId: string) => `capability-feedback-done:${chapterId}`;
const dismissedKey = (chapterId: string) => `capability-feedback-dismissed:${chapterId}`;

function isCapabilityFeedbackSettled(chapterId: string): boolean {
  if (typeof window === 'undefined') return true;
  return Boolean(window.localStorage.getItem(doneKey(chapterId))) ||
    Boolean(window.localStorage.getItem(dismissedKey(chapterId)));
}

export function ChapterCapabilityFeedbackBar({
  novelId,
  chapterId,
  cardIds,
  onSettled,
}: {
  novelId: string;
  chapterId: string;
  cardIds: string[];
  onSettled?: () => void;
}) {
  // 章节切换由父级用 key 重挂载，initializer 即可拿到最新幂等状态。
    const [settled, setSettled] = useState(() => isCapabilityFeedbackSettled(chapterId));
  const [submitting, setSubmitting] = useState(false);
  // cardIds 为空或本章已提交/忽略：不渲染（唯一采集点，零打扰）。
  if (cardIds.length === 0 || settled) return null;

  const settle = (mode: 'done' | 'dismissed') => {
    window.localStorage.setItem(mode === 'done' ? doneKey(chapterId) : dismissedKey(chapterId), '1');
    setSettled(true);
    onSettled?.();
  };

  const submit = async (rating: RatingKey) => {
    setSubmitting(true);
    try {
      await createSkillUsageRecord({
        // eslint-disable-next-line react-hooks/purity -- 事件处理器内取提交时刻（227 先例）
        id: `feedback-${chapterId}-${Date.now()}`,
        novelId,
        chapterId,
        mountedSkillIds: cardIds,
        fitScore: RATING_MAP[rating].fitScore,
        userAction: RATING_MAP[rating].userAction,
        notes: '章节完成时点轻量反馈（plan 241）',
        // eslint-disable-next-line react-hooks/purity -- 事件处理器内取提交时刻
        createdAt: Date.now(),
      });
      // 反馈落库后立即聚合，让 feedbackScore/observedPerformance 当场生效。
      await syncSkillFeedbackScores();
      settle('done');
    } catch {
      // 失败不打断完成流程；未 settle，下次完成仍可反馈。
      setSubmitting(false);
    }
  };

  return (
    <div
      className="mx-3 mb-3 rounded-xl border border-theme-border/60 bg-theme-sidebar px-4 py-3 text-xs sm:mx-5"
      data-testid="capability-feedback-bar"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-bold text-theme-text">
          本章用了 {cardIds.length} 张能力卡，帮你了吗？
        </span>
        <div className="flex gap-2">
          {(Object.keys(RATING_MAP) as RatingKey[]).map((key) => (
            <button
              key={key}
              type="button"
              disabled={submitting}
              data-testid={`capability-feedback-${key}`}
              onClick={() => void submit(key)}
              className="rounded-lg border border-theme-border px-3 py-1.5 font-bold text-theme-text transition-colors hover:border-theme-accent disabled:opacity-50"
            >
              {RATING_MAP[key].label}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={submitting}
          data-testid="capability-feedback-dismiss"
          onClick={() => settle('dismissed')}
          className="ml-auto text-theme-muted underline-offset-2 hover:underline disabled:opacity-50"
        >
          不再询问
        </button>
      </div>
    </div>
  );
}
