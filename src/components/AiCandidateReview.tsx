import { Check, X } from 'lucide-react';
import type { AiContentCandidate } from '../lib/generation-action-state';
import { DRAFT_QUALITY_SEMANTIC_LABELS } from '../../shared/lib/quality-contract';
import { getCandidateQualityState } from '../lib/candidate-quality';
import { WORKFLOW_ACTION_LABELS } from '../lib/workflow-copy';
import { cn } from '../lib/utils';

/**
 * 007 T5：AI 正文候选确认的单一实现。
 *
 * 编辑器（全局助手产出）与智能管家工作台共用：同一套质量门判定、
 * 同一组语义审阅/机械审查/硬性证据展开、同一组接受/精修/放弃动作。
 * 表面差异只通过 props 表达（标题、精修动作、可选的工作台跳转）。
 */
export function AiCandidateReview({
  candidate,
  variant = 'editor',
  isAccepting = false,
  onAccept,
  onDiscard,
  onPolish,
  onWorkbenchJump,
  className,
}: {
  candidate: AiContentCandidate;
  /** editor：标题带操作名（扩写/改写/精修）；workbench：智能管家措辞。 */
  variant?: 'editor' | 'workbench';
  isAccepting?: boolean;
  onAccept: () => void | Promise<unknown>;
  onDiscard: () => void;
  /** 质量未达标时的处理动作（打开精修卡 / 触发修复流）。缺省则不渲染该按钮。 */
  onPolish?: () => void | Promise<unknown>;
  /** 008：编辑器专属——一跳到工作台质量页签。 */
  onWorkbenchJump?: () => void;
  className?: string;
}) {
  const qualityState = getCandidateQualityState(candidate);
  const canAccept = qualityState.status === 'eligible';
  const operationLabel = candidate.operation === 'draft' ? '正文扩写' : candidate.operation === 'rewrite' ? '选中改写' : '审稿精修';
  const run = (pending: void | Promise<unknown>) => {
    if (pending) void Promise.resolve(pending).catch(() => undefined);
  };

  return (
    <section
      aria-label={variant === 'workbench' ? '智能管家正文候选' : 'AI 正文候选'}
      className={cn('flex flex-wrap items-center gap-2 border border-theme-accent/40 bg-theme-accent/5 text-xs', className)}
    >
      <span className="font-bold text-theme-text">
        {variant === 'workbench' ? '正文候选待确认' : `AI ${operationLabel}候选`}
      </span>
      <span className="min-w-0 flex-1 text-theme-muted">正文尚未修改，接受后才会保存。</span>
      <span
        className={cn(
          'rounded border px-2 py-0.5 text-[10px] font-bold',
          qualityState.status === 'eligible' ? 'rounded border-emerald-200 bg-emerald-50 text-emerald-700' : qualityState.status === 'fallback' ? 'alert-warning' : qualityState.status === 'blocked' ? 'alert-danger' : 'border',
        )}
        role="status"
      >
        {qualityState.label}
      </span>
      <span className="basis-full text-[10px] text-theme-muted">{qualityState.detail}</span>
      {candidate.quality?.semanticReview.status === 'unknown' ? (
        <span className="basis-full text-[10px] text-amber-700" role="status">
          硬性格式检查已通过；人物、世界规则和章节目标仍需语义审阅。
        </span>
      ) : null}
      {candidate.quality && candidate.quality.findings.some((finding) => finding.severity === 'P2') ? (
        <span className="basis-full text-[10px] text-amber-700" role="status">
          还有 {candidate.quality.findings.filter((finding) => finding.severity === 'P2').length} 项文风建议，可在审稿后精修。
        </span>
      ) : null}
      {candidate.quality?.mechanicalReview?.status === 'needs-action' ? (
        <span className="basis-full text-[10px] text-red-700" role="alert">
          机械审查 {candidate.quality.mechanicalReview.score.toFixed(1)}/{candidate.quality.mechanicalReview.threshold}：{candidate.quality.mechanicalReview.summary}，需精修后才能写入。
        </span>
      ) : null}
      {candidate.quality?.semanticReview ? (
        <details className="basis-full rounded border border-theme-border/70 bg-theme-sidebar/50 px-2 py-1">
          <summary className="cursor-pointer text-[10px] font-semibold text-theme-text">
            语义审阅：{candidate.quality.semanticReview.status === 'pass' ? '已通过' : candidate.quality.semanticReview.status === 'needs-action' ? '需要处理' : '尚未运行'}
          </summary>
          <ul className="mt-1 grid gap-1 text-[10px] text-theme-muted sm:grid-cols-2">
            {candidate.quality.semanticReview.checks.map((check) => (
              <li key={check.id} className={check.status === 'needs-action' ? 'text-amber-700' : undefined}>
                <div>{DRAFT_QUALITY_SEMANTIC_LABELS[check.id]}：{check.status === 'pass' ? '通过' : check.status === 'needs-action' ? '需处理' : '未知'}。{check.reason}</div>
                {check.evidence?.map((evidence) => (
                  <div key={`${check.id}:${evidence.quote}`} className="mt-1 border-l-2 border-theme-border pl-2 text-[10px] leading-5 text-theme-muted">
                    “{evidence.quote}”{evidence.location ? `（${evidence.location}）` : ''}：{evidence.explanation} 建议：{evidence.suggestedFix}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {candidate.quality?.findings.length ? (
        <details className="basis-full rounded border border-theme-border/70 bg-theme-sidebar/50 px-2 py-1">
          <summary className="cursor-pointer text-[10px] font-semibold text-theme-text">硬性检查证据（{candidate.quality.findings.length}）</summary>
          <ul className="mt-1 grid gap-1 text-[10px] text-theme-muted">
            {candidate.quality.findings.map((finding) => (
              <li key={finding.code}>
                <div>[{finding.severity}] {finding.message}</div>
                {finding.evidence?.map((evidence, index) => (
                  <div key={`${finding.code}:${index}`} className="mt-1 border-l-2 border-theme-border pl-2 text-theme-muted">
                    {evidence.line ? `第 ${evidence.line} 行：` : ''}“{evidence.snippet}”{evidence.suggestion ? ` 建议：${evidence.suggestion}` : ''}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <button
        type="button"
        disabled={isAccepting || !canAccept}
        onClick={() => run(onAccept())}
        className="inline-flex h-7 items-center gap-1 border border-theme-accent px-2 font-bold text-theme-text hover:bg-theme-accent/10 disabled:opacity-50"
      >
        <Check size={14} aria-hidden="true" />接受并写入
      </button>
      {!canAccept && onPolish ? (
        <button
          type="button"
          disabled={isAccepting}
          onClick={() => run(onPolish())}
          className="inline-flex h-7 items-center border border-theme-accent px-2 text-theme-accent hover:bg-theme-accent/10 disabled:opacity-50"
        >
          {qualityState.status === 'fallback' ? '重新审阅' : '前往精修'}
        </button>
      ) : null}
      {!canAccept && onWorkbenchJump ? (
        <button
          type="button"
          disabled={isAccepting}
          onClick={() => onWorkbenchJump()}
          className="inline-flex h-7 items-center border border-theme-border px-2 text-theme-muted hover:text-theme-text hover:bg-theme-border/30 disabled:opacity-50"
        >
          {WORKFLOW_ACTION_LABELS.handleInWorkbench}
        </button>
      ) : null}
      <button
        type="button"
        disabled={isAccepting}
        onClick={() => run(onDiscard())}
        className="inline-flex h-7 items-center gap-1 border border-theme-border px-2 text-theme-muted hover:bg-theme-border/30 disabled:opacity-50"
      >
        <X size={14} aria-hidden="true" />放弃预览
      </button>
      <details className="basis-full rounded-lg border border-theme-border/70 bg-theme-sidebar/60">
        <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-semibold text-theme-text">查看候选正文预览</summary>
        <div role="region" aria-label={variant === 'workbench' ? '智能管家正文候选预览' : 'AI 正文候选预览'} className="grid max-h-64 gap-2 overflow-y-auto border-t border-theme-border/60 p-2 text-[11px] leading-5 md:grid-cols-2">
          <div className="min-w-0">
            <div className="mb-1 font-bold text-theme-muted">当前正文（未修改）</div>
            <pre className="whitespace-pre-wrap break-words font-sans text-theme-muted">{candidate.baselineContent}</pre>
          </div>
          <div className="min-w-0">
            <div className="mb-1 font-bold text-theme-text">候选正文</div>
            <pre className="whitespace-pre-wrap break-words font-sans text-theme-text">{candidate.content}</pre>
          </div>
        </div>
      </details>
    </section>
  );
}
