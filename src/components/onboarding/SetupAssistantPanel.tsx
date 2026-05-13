import type { SetupTaskDraft, StoryIdeaCard } from '../../types';

interface SetupAssistantPanelProps {
  selectedTask?: SetupTaskDraft;
  summaryCard?: StoryIdeaCard;
  textareaValue: string;
  onTextareaChange: (value: string) => void;
  onSubmit: () => void;
  submitting?: boolean;
}

export function SetupAssistantPanel({
  selectedTask,
  summaryCard,
  textareaValue,
  onTextareaChange,
  onSubmit,
  submitting = false,
}: SetupAssistantPanelProps) {
  return (
    <aside className="rounded-3xl border border-theme-border bg-white p-6 shadow-sm">
      <div className="mb-5">
        <h3 className="text-xl font-serif font-bold text-theme-text">设定助手</h3>
        <p className="mt-1 text-sm text-theme-muted">一次只补当前这一项。先把骨架立住，再决定要不要扩写。</p>
      </div>

      {selectedTask ? (
        <div className="mb-4 rounded-2xl border border-theme-border bg-theme-sidebar/20 p-4">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-theme-muted">当前设定项</div>
          <div className="mt-2 text-base font-bold text-theme-text">{selectedTask.title}</div>
          <p className="mt-2 text-sm leading-6 text-theme-muted">{selectedTask.summary}</p>
        </div>
      ) : (
        <div className="mb-4 rounded-2xl border border-dashed border-theme-border bg-theme-bg/40 p-4 text-sm text-theme-muted">
          先从左侧选一项关键设定。
        </div>
      )}

      {summaryCard && (
        <div className="mb-4 rounded-2xl border border-theme-border/80 bg-white p-4">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-theme-muted">故事方案</div>
          <div className="mt-2 text-base font-bold text-theme-text">{summaryCard.hook}</div>
          <p className="mt-2 text-sm text-theme-muted">主角：{summaryCard.protagonist}</p>
          <p className="mt-1 text-sm text-theme-muted">冲突：{summaryCard.coreConflict}</p>
        </div>
      )}

      <textarea
        value={textareaValue}
        onChange={(e) => onTextareaChange(e.target.value)}
        placeholder="比如：主角不要太正统，关系里增加互相利用感，世界规则再残酷一点。"
        rows={6}
        className="w-full resize-none rounded-2xl border border-theme-border bg-white p-4 text-sm leading-6 text-theme-text outline-none placeholder:text-theme-muted focus:border-theme-accent"
      />

      <button
        onClick={onSubmit}
        disabled={!selectedTask || !textareaValue.trim() || submitting}
        className="mt-4 w-full rounded-full bg-theme-accent px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
      >
        {submitting ? 'AI 精炼中...' : '让 AI 精炼这项设定'}
      </button>
    </aside>
  );
}
