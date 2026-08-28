import React, { useState } from 'react';
import type { ChapterCompletionResult } from '../../shared/lib/chapter-completion';
import type { ReviewIssue } from '../../shared/types/novel';

interface ChapterCompletionReviewProps {
  result: ChapterCompletionResult;
  onReturnToEditing: () => void;
  onRetryUnavailable?: () => void;
  onAcceptRisk?: () => void | boolean | Promise<boolean | void>;
  onPreviewRevision?: (issueId: string) => void;
  reviewIssues?: ReviewIssue[];
}

export function ChapterCompletionReview({ result, onReturnToEditing, onRetryUnavailable, onAcceptRisk, onPreviewRevision, reviewIssues = [] }: ChapterCompletionReviewProps) {
  const issues = result.gate.deterministicIssues;
  const reviewIssueById = new Map(reviewIssues.map((issue) => [issue.id, issue]));
  const incomplete = result.quality === 'unknown' || result.gate.unknownChecks.length > 0;
  const passed = result.quality === 'pass' && !incomplete;
  const confirmationKey = `${result.gate.contentHash}:${result.gate.planHash}`;
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const [submittedKey, setSubmittedKey] = useState<string | null>(null);
  const [isAcceptingRisk, setIsAcceptingRisk] = useState(false);
  const canAcceptUnreviewed = confirmedKey === confirmationKey && submittedKey !== confirmationKey;

  const handleAcceptRisk = async () => {
    if (!onAcceptRisk || !canAcceptUnreviewed || isAcceptingRisk) return;
    setIsAcceptingRisk(true);
    try {
      const outcome = onAcceptRisk();
      const accepted = outcome instanceof Promise ? await outcome : outcome !== false;
      if (accepted !== false) setSubmittedKey(confirmationKey);
    } catch {
      // The parent callback owns user-facing error reporting; keep this result retryable.
    } finally {
      setIsAcceptingRisk(false);
    }
  };
  return (
    <section aria-label="章节完成审阅" className="mx-3 mb-3 rounded-xl border border-theme-border bg-theme-sidebar/20 p-4 text-sm text-theme-text sm:mx-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold">章节完成审阅</h2>
        <span className={passed ? 'text-emerald-700' : issues.length ? 'text-amber-700' : 'text-amber-700'}>
          {passed ? '检查通过' : issues.length ? '发现问题' : '格式检查通过，语义审阅未完成'}
        </span>
        {incomplete && issues.length > 0 ? <span className="text-amber-700">AI 检查未完成</span> : null}
      </div>
      {issues.length > 0 ? (
        <ul className="mt-3 space-y-2 text-xs text-theme-muted">
          {issues.map((issueId) => (
            <li key={issueId} className="flex items-center justify-between gap-2">
              <span>{reviewIssueById.get(issueId)?.explanation || issueId}</span>
              {onPreviewRevision && result.gate.canAcceptLocalRevision && reviewIssueById.has(issueId)
                ? <button type="button" className="text-theme-accent" onClick={() => onPreviewRevision(issueId)}>预览局部修订</button>
                : null}
            </li>
          ))}
        </ul>
      ) : null}
      {incomplete ? <p className="mt-3 text-xs text-amber-700">部分 AI 检查暂不可用，不代表正文已获得虚构评分。</p> : null}
      {incomplete && onAcceptRisk ? (
        <label className="mt-3 flex items-start gap-2 text-xs text-theme-muted">
          <input
            type="checkbox"
            aria-label="确认接受未审阅风险"
            checked={confirmedKey === confirmationKey}
            disabled={submittedKey === confirmationKey || isAcceptingRisk}
            onChange={(event) => setConfirmedKey(event.target.checked ? confirmationKey : null)}
          />
          <span>我确认当前正文尚未完成语义审阅，并接受由此产生的风险。</span>
        </label>
      ) : null}
      <details className="mt-3 text-xs text-theme-muted">
        <summary className="cursor-pointer">查看证据</summary>
        <div className="mt-2 space-y-2">
          <div>内容校验：{result.gate.contentHash}</div>
          <div>计划校验：{result.gate.planHash}</div>
          {issues.map((issueId) => {
            const issue = reviewIssueById.get(issueId);
            return issue ? <div key={issueId}>{issue.snippet || '无正文摘录'}{issue.suggestedFix ? ` · ${issue.suggestedFix}` : ''}</div> : null;
          })}
        </div>
      </details>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="rounded-lg border border-theme-border px-3 py-2 text-xs" onClick={onReturnToEditing}>返回编辑</button>
        {onRetryUnavailable && incomplete ? <button type="button" className="rounded-lg border border-theme-border px-3 py-2 text-xs" onClick={onRetryUnavailable}>重试不可用检查</button> : null}
        {onAcceptRisk && incomplete ? (
          <button
            type="button"
            className="rounded-lg bg-amber-600 px-3 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canAcceptUnreviewed || isAcceptingRisk}
            onClick={() => void handleAcceptRisk()}
          >{isAcceptingRisk ? '正在接受…' : '接受未审阅风险'}</button>
        ) : null}
      </div>
    </section>
  );
}
