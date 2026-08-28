import { useState } from 'react';
import type { ChapterFactCandidate } from '../../shared/types/chapter-facts';

export interface ChapterFactCandidateReviewProps {
  candidate: ChapterFactCandidate;
  canConfirm: boolean;
  submitting: boolean;
  onConfirm: (selection: { factDecisions: Record<string, 'accepted' | 'pending' | 'rejected'> }) => void;
}

const KIND_LABELS: Record<string, string> = {
  character: '角色', item: '物品', timeline: '时间线', location: '地点', power: '力量体系', 'narrative-promise': '叙事承诺',
};

export function ChapterFactCandidateReview({ candidate, canConfirm, submitting, onConfirm }: ChapterFactCandidateReviewProps) {
  const defaultDecisions = Object.fromEntries(candidate.facts.map((fact) => [
    fact.id,
    fact.selectable && !fact.destructive && !fact.ambiguous ? 'accepted' : 'pending',
  ])) as Record<string, 'accepted' | 'pending' | 'rejected'>;
  const candidateKey = `${candidate.id}:${candidate.facts.map((fact) => fact.id).join(',')}`;
  const [selection, setSelection] = useState<{ candidateKey: string; decisions: Record<string, 'accepted' | 'pending' | 'rejected'> }>({ candidateKey: '', decisions: {} });
  const decisions = selection.candidateKey === candidateKey ? selection.decisions : defaultDecisions;

  const groups = candidate.facts.reduce<Record<string, typeof candidate.facts>>((all, fact) => {
    (all[fact.kind] ||= []).push(fact);
    return all;
  }, {});

  return (
    <section aria-label="章节事实确认" className="mt-4 rounded-xl border border-theme-border bg-theme-sidebar/20 p-3">
      <div className="text-xs font-bold text-theme-text">章节事实候选</div>
      <div className="mt-1 text-xs text-theme-muted">正文证据：{candidate.manuscript.evidence}</div>
      <div className="mt-3 space-y-3">
        {Object.entries(groups).map(([kind, facts]) => (
          <div key={kind}>
            <div className="text-[10px] font-bold text-theme-muted">{KIND_LABELS[kind] || kind}</div>
            <div className="mt-1 space-y-2">
              {facts.map((fact) => {
                const decision = decisions[fact.id];
                return (
                  <label key={fact.id} className="block rounded-lg border border-theme-border px-2 py-2 text-xs text-theme-text">
                    <div className="flex items-start gap-2">
                      <select
                        aria-label={`${fact.title} 决定`}
                        value={decision}
                        disabled={!fact.selectable || submitting}
                        onChange={(event) => setSelection((current) => {
                          const currentDecisions = current.candidateKey === candidateKey ? current.decisions : defaultDecisions;
                          return { candidateKey, decisions: { ...currentDecisions, [fact.id]: event.target.value as 'accepted' | 'pending' | 'rejected' } };
                        })}
                      >
                        <option value="accepted">接受</option>
                        <option value="pending">待确认</option>
                        <option value="rejected">拒绝</option>
                      </select>
                      <span className="font-bold">{fact.title}</span>
                      {(fact.ambiguous || fact.destructive || !fact.selectable) ? <span className="text-amber-700">{fact.selectable ? '需确认' : '待关联'}</span> : null}
                    </div>
                    <div className="mt-1 text-theme-muted">目标记录：{fact.target.label}</div>
                    <div className="mt-1 whitespace-pre-wrap text-theme-muted">正文证据：{fact.evidence}</div>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={!canConfirm || submitting}
        className="mt-3 rounded-lg bg-theme-accent px-3 py-2 text-xs font-bold text-white"
        onClick={() => onConfirm({ factDecisions: decisions })}
      >
        {submitting ? '提交中...' : canConfirm ? '确认事实并写入' : '接受正文后确认事实'}
      </button>
    </section>
  );
}
