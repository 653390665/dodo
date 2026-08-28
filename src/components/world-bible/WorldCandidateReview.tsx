import { Check, Loader2, RefreshCw, X } from 'lucide-react';
import type { ArtifactCandidate, StructuredWorldCore } from '../../../shared/types/creative-artifacts';

function formatCandidateValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '未设置';
  return JSON.stringify(value);
}

export function WorldCandidateReview({
  candidate,
  activeVersion,
  isGenerating,
  error,
  onGenerate,
  onAccept,
  onReject,
}: {
  candidate?: ArtifactCandidate<StructuredWorldCore> | null;
  activeVersion?: number;
  isGenerating: boolean;
  error?: string | null;
  onGenerate: () => void;
  onAccept: (candidate: ArtifactCandidate<StructuredWorldCore>) => void;
  onReject: (candidate: ArtifactCandidate<StructuredWorldCore>) => void;
}) {
  return (
    <section role="region" aria-label="世界观候选审阅" className="border-y border-theme-border bg-theme-sidebar/40 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-theme-text">世界观结构候选</h2>
          {candidate ? <p className="mt-1 text-xs text-theme-muted">{candidate.goal || '待确认的世界规则变更'}</p> : null}
          {!candidate && activeVersion !== undefined ? <p className="mt-1 text-xs text-theme-muted">当前结构版本 v{activeVersion}</p> : null}
        </div>
        {!candidate ? (
          <button
            type="button"
            disabled={isGenerating}
            onClick={onGenerate}
            className="inline-flex min-h-9 items-center gap-2 rounded-md bg-theme-text px-3 py-2 text-xs font-bold text-theme-bg disabled:opacity-50"
          >
            {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {isGenerating ? '正在生成候选' : '生成世界观结构候选'}
          </button>
        ) : null}
      </div>

      {error ? <p role="alert" className="mt-3 text-xs text-amber-700">{error}</p> : null}

      {candidate ? (
        <div className="mt-4 space-y-4">
          <div>
            <h3 className="text-xs font-bold text-theme-text">结构差异</h3>
            <ul className="mt-2 space-y-1 text-xs text-theme-muted">
              {candidate.diff.fields.map((field) => (
                <li key={`${field.path}:${field.kind}`}>
                  <span className="font-mono text-theme-text">{field.path}</span>：{field.kind}
                  {field.after !== undefined ? ` -> ${formatCandidateValue(field.after)}` : ''}
                </li>
              ))}
            </ul>
          </div>

          {candidate.proposedContent ? (
            <div>
              <h3 className="text-xs font-bold text-theme-text">候选说明</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-theme-text">{candidate.proposedContent}</p>
            </div>
          ) : null}

          {candidate.impactReport.reasons.length > 0 || candidate.impactReport.reviewRequired.length > 0 ? (
            <div>
              <h3 className="text-xs font-bold text-theme-text">影响与复核</h3>
              <ul className="mt-2 space-y-1 text-xs text-theme-muted">
                {candidate.impactReport.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                {candidate.impactReport.reviewRequired.map((ref) => (
                  <li key={`${ref.kind}:${ref.id}`}>{ref.kind} · {ref.id} · v{ref.version}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-theme-border pt-3">
            <button
              type="button"
              onClick={() => onReject(candidate)}
              className="inline-flex min-h-9 items-center gap-2 rounded-md border border-theme-border px-3 py-2 text-xs font-bold text-theme-text"
            >
              <X size={14} />
              拒绝世界观候选
            </button>
            <button
              type="button"
              onClick={() => onAccept(candidate)}
              className="inline-flex min-h-9 items-center gap-2 rounded-md bg-theme-text px-3 py-2 text-xs font-bold text-theme-bg"
            >
              <Check size={14} />
              接受世界观候选
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
