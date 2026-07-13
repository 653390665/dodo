import { Download } from 'lucide-react';
import type { Chapter, ContinuationEditorLaunchState } from '../../shared/types';

interface EditorStatusBarProps {
  currentChapter: Chapter | null;
  statusTimeFormatter: Intl.DateTimeFormat;
  isSyncing: boolean;
  launchState?: ContinuationEditorLaunchState | null;
  novelId: string;
  novelTitle: string;
}

export function EditorStatusBar({
  currentChapter,
  statusTimeFormatter,
  isSyncing,
  launchState,
  novelId,
  novelTitle,
}: EditorStatusBarProps) {
  const handleExport = async () => {
    if (!novelId) return;
    const format = confirm('导出为 EPUB？（确定=EPUB，取消=TXT）') ? 'epub' : 'txt';
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novelId, format }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${novelTitle}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('导出失败: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div className="h-9 bg-theme-sidebar border-t border-theme-border px-4 flex items-center justify-between shrink-0 text-[11px] text-theme-muted overflow-hidden">
      <div className="flex items-center gap-3 min-w-0 overflow-hidden">
        {launchState?.approvedPackId && (
          <span className="inline-flex items-center rounded-full bg-theme-accent/10 px-2 py-1 text-[10px] font-bold text-theme-accent">
            当前模式：资料包续写
          </span>
        )}
        <span className="font-medium tabular-nums">字数 {currentChapter?.wordCount || 0}</span>
        <span className="hidden sm:inline tabular-nums">更新 {currentChapter ? statusTimeFormatter.format(new Date(currentChapter.updatedAt)) : '-'}</span>
        <span className="hidden lg:inline">预计 token <span className="text-theme-text font-semibold tabular-nums">~2.4k</span></span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-green-600 shadow-[0_0_5px_rgba(22,163,74,0.3)]" />
          <span className="hidden sm:inline">{isSyncing ? '保存中…' : '本地已保存'}</span>
        </div>
        <div className="hidden sm:block h-3 w-px bg-theme-border/50" />
        <button
          onClick={handleExport}
          className="flex items-center gap-1 text-[11px] font-medium text-theme-accent hover:opacity-80 transition-opacity"
        >
          <Download size={12} aria-hidden="true" /> 导出
        </button>
      </div>
    </div>
  );
}