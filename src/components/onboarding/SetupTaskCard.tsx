import type { SetupTaskDraft } from '../../../shared/types';

interface SetupTaskCardProps {
  task: SetupTaskDraft;
  active: boolean;
  onSelect: () => void;
  onConfirm: () => void;
}

const STATUS_LABEL: Record<SetupTaskDraft['status'], string> = {
  empty: '待补全',
  drafted: '已起草',
  confirmed: '已确认',
  'needs-work': '待调整',
};

const STATUS_CLASS: Record<SetupTaskDraft['status'], string> = {
  empty: 'bg-theme-sidebar text-theme-muted',
  drafted: 'bg-theme-accent/10 text-theme-accent',
  confirmed: 'bg-green-50 text-green-700',
  'needs-work': 'bg-amber-50 text-amber-700',
};

export function SetupTaskCard({ task, active, onSelect, onConfirm }: SetupTaskCardProps) {
  return (
    <article
      className={`rounded-3xl border p-5 shadow-sm transition-colors ${
        active ? 'border-theme-accent bg-theme-sidebar/20' : 'border-theme-border bg-theme-sidebar'
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h3 className="text-base font-serif font-bold text-theme-text">{task.title}</h3>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_CLASS[task.status]}`}>
          {STATUS_LABEL[task.status]}
        </span>
      </div>
      <p className="min-h-16 text-sm leading-6 text-theme-muted">{task.summary || '这项还没有稳定设定。'}</p>
      <div className="mt-4 flex gap-2">
        <button
          onClick={onSelect}
          className="rounded-full border border-theme-border px-4 py-2 text-xs font-bold text-theme-text"
        >
          继续聊这项
        </button>
        <button
          onClick={onConfirm}
          className="rounded-full bg-theme-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
          disabled={task.status === 'confirmed'}
        >
          {task.status === 'confirmed' ? '已确认' : '确认这项'}
        </button>
      </div>
    </article>
  );
}
