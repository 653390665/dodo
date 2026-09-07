import React from 'react';
import { Download, FileText } from 'lucide-react';
import { exportChapterToPdf } from '../lib/pdf-export';
import { toast } from '../lib/toast';
import type { Chapter, ContinuationEditorLaunchState } from '../../shared/types';

export type EditorSaveStatus = 'loading' | 'pending' | 'saved' | 'failed' | 'unknown';

interface EditorStatusBarProps {
  currentChapter: Chapter | null;
  statusTimeFormatter: Intl.DateTimeFormat;
  isSyncing: boolean;
  syncSuccess?: boolean;
  syncFailed: boolean;
  saveStatus?: EditorSaveStatus;
  launchState?: ContinuationEditorLaunchState | null;
  novelId: string;
  novelTitle: string;
  embeddingStatus?: 'ready' | 'initializing' | 'fallback' | 'unavailable' | 'unknown';
}

export function EditorStatusBar({
  currentChapter,
  statusTimeFormatter,
  isSyncing,
  syncSuccess = false,
  syncFailed,
  saveStatus,
  launchState,
  novelId,
  novelTitle,
  embeddingStatus = 'unknown',
}: EditorStatusBarProps) {
  const resolvedSaveStatus: EditorSaveStatus = saveStatus
    || (syncFailed ? 'failed' : isSyncing ? 'pending' : syncSuccess ? 'saved' : 'unknown');
  const saveStatusLabel = resolvedSaveStatus === 'loading' ? '正在读取保存状态'
    : resolvedSaveStatus === 'pending' ? '正在保存'
      : resolvedSaveStatus === 'saved' ? '正文已保存'
        : resolvedSaveStatus === 'failed' ? '保存失败，请重试'
          : '尚未检测到保存结果';
  const saveStatusDot = resolvedSaveStatus === 'failed' ? 'bg-red-600'
    : resolvedSaveStatus === 'loading' || resolvedSaveStatus === 'pending' ? 'bg-amber-500'
      : resolvedSaveStatus === 'saved' ? 'bg-green-600'
        : 'bg-gray-400';
  const [exportMenuOpen, setExportMenuOpen] = React.useState(false);
  const exportMenuRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!exportMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExportMenuOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onClick);
    };
  }, [exportMenuOpen]);
  const handleExport = async (format: 'epub' | 'txt') => {
    setExportMenuOpen(false);
    if (!novelId) return;
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
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      toast('导出失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
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
        <span className={embeddingStatus === 'ready' ? 'text-emerald-600' : embeddingStatus === 'fallback' || embeddingStatus === 'initializing' || embeddingStatus === 'unknown' ? 'text-amber-600' : 'text-red-600'}>
          索引 {embeddingStatus === 'ready' ? '可用' : embeddingStatus === 'fallback' ? 'LLM 兜底' : embeddingStatus === 'initializing' ? '初始化中' : embeddingStatus === 'unavailable' ? '降级' : '未知'}
        </span>
        <span className="hidden sm:inline tabular-nums">更新 {currentChapter ? statusTimeFormatter.format(new Date(currentChapter.updatedAt)) : '-'}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-2" role="status" aria-live="polite" data-save-status={resolvedSaveStatus}>
          <div className={`w-1.5 h-1.5 rounded-full ${saveStatusDot}`} />
          <span className={resolvedSaveStatus === 'failed' ? 'text-red-600' : resolvedSaveStatus === 'unknown' ? 'text-theme-muted' : undefined}>
            {saveStatusLabel}
          </span>
        </div>
        <div className="hidden sm:block h-3 w-px bg-theme-border/50" />
        <div ref={exportMenuRef} className="relative">
          <button
            onClick={() => setExportMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={exportMenuOpen}
            className="flex items-center gap-1 text-[11px] font-medium text-theme-accent hover:opacity-80 transition-opacity"
          >
            <Download size={12} aria-hidden="true" /> 导出
          </button>
          {exportMenuOpen ? (
            <div role="menu" className="absolute bottom-full right-0 z-30 mb-1 min-w-[120px] rounded-xl border border-theme-border bg-theme-sidebar p-1 shadow-xl">
              <button
                type="button"
                role="menuitem"
                onClick={() => void handleExport('epub')}
                className="flex w-full items-center rounded-lg px-3 py-2 text-left text-[11px] text-theme-text hover:bg-theme-border/30"
              >
                导出 EPUB
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => void handleExport('txt')}
                className="flex w-full items-center rounded-lg px-3 py-2 text-left text-[11px] text-theme-text hover:bg-theme-border/30"
              >
                导出 TXT
              </button>
            </div>
          ) : null}
        </div>
        <button
          onClick={() => {
            if (currentChapter) exportChapterToPdf(currentChapter, novelTitle);
          }}
          className="flex items-center gap-1 text-[11px] font-medium text-theme-accent hover:opacity-80 transition-opacity"
        >
          <FileText size={12} aria-hidden="true" /> 导出 PDF
        </button>
      </div>
    </div>
  );
}
