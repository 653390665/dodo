import X from 'lucide-react/dist/esm/icons/x.js';
import type { SetupTaskDraft, StoryIdeaCard } from '../../types';

interface SetupAssistantPanelProps {
  selectedTask?: SetupTaskDraft;
  summaryCard?: StoryIdeaCard;
  textareaValue: string;
  onTextareaChange: (value: string) => void;
  onSubmit: () => void;
  submitting?: boolean;
  onClose?: () => void;
}

export function SetupAssistantPanel({
  selectedTask,
  summaryCard,
  textareaValue,
  onTextareaChange,
  onSubmit,
  submitting = false,
  onClose,
}: SetupAssistantPanelProps) {
  return (
    <aside className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="shrink-0 p-6 border-b border-theme-border flex items-start justify-between bg-white sticky top-0 z-10">
        <div>
          <h3 className="text-xl font-serif font-bold text-theme-text">设定助手</h3>
          <p className="mt-1 text-sm text-theme-muted">一次只补当前这一项。先把骨架立住，再决定要不要扩写。</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-full p-2 text-theme-muted hover:bg-theme-sidebar/50 hover:text-theme-text transition-all"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {selectedTask ? (
          <div className="rounded-2xl border border-theme-border bg-theme-sidebar/20 p-4">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-theme-muted">当前设定项</div>
            <div className="mt-2 text-base font-bold text-theme-text">{selectedTask.title}</div>
            <p className="mt-2 text-sm leading-6 text-theme-muted">{selectedTask.summary}</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-theme-border bg-theme-bg/40 p-4 text-sm text-theme-muted">
            先从左侧选一项关键设定。
          </div>
        )}

        {summaryCard && (
          <div className="rounded-2xl border border-theme-border/80 bg-white p-4 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-theme-muted">故事方案</div>
            <div className="mt-2 text-base font-bold text-theme-text">{summaryCard.hook}</div>
            <p className="mt-2 text-sm text-theme-muted">主角：{summaryCard.protagonist}</p>
            <p className="mt-1 text-sm text-theme-muted">冲突：{summaryCard.coreConflict}</p>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-[0.16em] text-theme-muted">对话式干预</label>
          <textarea
            value={textareaValue}
            onChange={(e) => onTextareaChange(e.target.value)}
            placeholder="比如：主角不要太正统，关系里增加互相利用感，世界规则再残酷一点。"
            rows={6}
            className="w-full resize-none rounded-2xl border border-theme-border bg-white p-4 text-sm leading-6 text-theme-text outline-none placeholder:text-theme-muted focus:border-theme-accent shadow-inner"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 p-6 border-t border-theme-border bg-white sticky bottom-0 z-10">
        <button
          onClick={onSubmit}
          disabled={!selectedTask || !textareaValue.trim() || submitting}
          className="w-full rounded-full bg-theme-accent px-4 py-3 text-sm font-bold text-white shadow-lg hover:shadow-xl active:scale-95 transition-all disabled:opacity-60 disabled:shadow-none disabled:active:scale-100"
        >
          {submitting ? (
            <div className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>AI 精炼中...</span>
            </div>
          ) : '让 AI 精炼这项设定'}
        </button>
      </div>
    </aside>
  );
}
