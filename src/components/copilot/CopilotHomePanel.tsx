import type { CopilotActionKey, CopilotSuggestion } from '../../types';

interface CopilotHomePanelProps {
  suggestion: CopilotSuggestion;
  onAction: (actionKey: CopilotActionKey) => void;
}

export function CopilotHomePanel({ suggestion, onAction }: CopilotHomePanelProps) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-theme-border bg-theme-sidebar/25 px-4 py-3 text-[11px] text-theme-muted leading-relaxed">
        <div className="text-xs font-bold text-theme-text mb-2">当前阶段</div>
        <div className="text-sm font-medium text-theme-text">{suggestion.stageLabel}</div>
        <div className="mt-2">{suggestion.summary}</div>
      </div>

      <div className="rounded-2xl border border-theme-border bg-white p-4 shadow-sm">
        <div className="text-xs font-bold text-theme-text mb-1">主建议</div>
        <div className="text-base font-serif font-bold text-theme-text">{suggestion.title}</div>
        <p className="mt-2 text-sm text-theme-muted">{suggestion.summary}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => onAction(suggestion.primaryAction.key)}
            className="rounded-xl bg-theme-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-theme-accent/90 transition-colors"
          >
            {suggestion.primaryAction.label}
          </button>
          {suggestion.secondaryActions.map((action) => (
            <button
              key={action.key}
              onClick={() => onAction(action.key)}
              className="rounded-xl border border-theme-border bg-white px-3.5 py-2 text-sm font-medium text-theme-text hover:bg-theme-sidebar/45 transition-colors"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-theme-border bg-white p-4 shadow-sm">
          <div className="text-xs font-bold text-theme-text mb-2">已具备</div>
          <div className="space-y-1 text-xs text-theme-muted">
            {suggestion.reasons.ready.length > 0
              ? suggestion.reasons.ready.map((item) => <div key={item}>{item}</div>)
              : <div>暂无</div>}
          </div>
        </div>
        <div className="rounded-2xl border border-theme-border bg-white p-4 shadow-sm">
          <div className="text-xs font-bold text-theme-text mb-2">当前缺失</div>
          <div className="space-y-1 text-xs text-theme-muted">
            {suggestion.reasons.missing.length > 0
              ? suggestion.reasons.missing.map((item) => <div key={item}>{item}</div>)
              : <div>暂无</div>}
          </div>
        </div>
        <div className="rounded-2xl border border-theme-border bg-white p-4 shadow-sm">
          <div className="text-xs font-bold text-theme-text mb-2">潜在风险</div>
          <div className="space-y-1 text-xs text-theme-muted">
            {suggestion.reasons.risks.length > 0
              ? suggestion.reasons.risks.map((item) => <div key={item}>{item}</div>)
              : <div>暂无</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
