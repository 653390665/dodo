import { ChevronRight, Sparkles } from 'lucide-react';
import type { CopilotActionKey, CopilotSuggestion } from '../../types';

interface CopilotStatusBarProps {
  suggestion: CopilotSuggestion;
  onPrimaryAction: (actionKey: CopilotActionKey) => void;
  onOpen: () => void;
}

export function CopilotStatusBar({ suggestion, onPrimaryAction, onOpen }: CopilotStatusBarProps) {
  return (
    <div className="border-b border-theme-border/70 bg-white/75 px-5 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.18em] text-theme-muted font-bold">
            当前建议 · {suggestion.stageLabel}
          </div>
          <div className="mt-1 text-sm font-medium text-theme-text">{suggestion.summary}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => onPrimaryAction(suggestion.primaryAction.key)}
            className="rounded-xl bg-theme-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-theme-accent/90 transition-colors"
          >
            {suggestion.primaryAction.label}
          </button>
          <button
            onClick={onOpen}
            className="rounded-xl border border-theme-border bg-white px-3.5 py-2 text-sm font-medium text-theme-text hover:bg-theme-sidebar/45 transition-colors"
          >
            查看副驾
          </button>
        </div>
      </div>
    </div>
  );
}
