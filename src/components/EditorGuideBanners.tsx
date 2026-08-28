import { Sparkles } from 'lucide-react';
import type { Chapter } from '../../shared/types';
import { deriveProjectWorkflowState, type WorkflowSyncState } from '../lib/workflow-state';

interface EditorGuideBannersProps {
  currentChapter: Chapter | null;
  isChapterEmpty: boolean;
  showEmptyChapterGuide: boolean;
  showHasContentGuide: boolean;
  onCloseEmptyGuide: () => void;
  onCloseContentGuide: () => void;
  onRestoreEmptyGuide: () => void;
  onRestoreContentGuide: () => void;
  packStatus?: 'approved' | 'draft' | 'none';
  syncState?: WorkflowSyncState;
}

export function EditorGuideBanners({
  currentChapter,
  isChapterEmpty,
  showEmptyChapterGuide,
  showHasContentGuide,
  onCloseEmptyGuide,
  onCloseContentGuide,
  onRestoreEmptyGuide,
  onRestoreContentGuide,
  packStatus = 'none',
  syncState = 'not-required',
}: EditorGuideBannersProps) {
  const workflow = deriveProjectWorkflowState({ loading: false, chapter: currentChapter, packStatus, syncState });
  const nextAction = workflow.phase === 'planning'
    ? '生成本章分镜'
    : workflow.phase === 'drafting'
      ? '根据分镜扩写正文'
      : workflow.phase === 'audit'
        ? '启动本章质量审计'
        : workflow.phase === 'polish'
          ? '按审计意见局部润色'
          : workflow.phase === 'sync'
            ? '接入本章上下文'
            : workflow.phase === 'review'
              ? '审核资料包'
              : workflow.phase === 'next_chapter'
                ? '创建下一章'
                : '开始本章写作';
  return (
    <>
      {currentChapter && isChapterEmpty && !showEmptyChapterGuide && (
        <div className="mx-6 mt-3 flex justify-end">
          <button
            type="button"
            onClick={onRestoreEmptyGuide}
            className="text-[11px] font-semibold text-theme-muted underline decoration-theme-border underline-offset-4 hover:text-theme-text"
          >
            重新显示章节指引
          </button>
        </div>
      )}
      {currentChapter && isChapterEmpty && showEmptyChapterGuide && (
        <div className="mx-6 mt-4 relative rounded-lg border border-amber-500/20 bg-gradient-to-r from-amber-500/10 to-theme-accent/5 p-4 text-left shadow-sm backdrop-blur-md animate-fade-in">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-2.5">
              <Sparkles size={16} className="text-amber-500 shrink-0 mt-0.5 animate-pulse" />
              <div className="space-y-1">
                <h4 className="text-xs font-bold text-amber-600 dark:text-amber-400 font-sans">
                  空章节指引
                </h4>
                <p className="text-xs text-theme-text/85 leading-relaxed font-sans">
                  当前阶段主动作：{nextAction}。也可以直接在编辑器中起笔。
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onCloseEmptyGuide}
              className="text-theme-muted hover:text-theme-text transition-colors text-xs p-1 font-bold font-mono"
              aria-label="关闭提示"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {currentChapter && (currentChapter.wordCount || 0) > 100 && !showHasContentGuide && (
        <div className="mx-6 mt-3 flex justify-end">
          <button
            type="button"
            onClick={onRestoreContentGuide}
            className="text-[11px] font-semibold text-theme-muted underline decoration-theme-border underline-offset-4 hover:text-theme-text"
          >
            重新显示章节指引
          </button>
        </div>
      )}

      {currentChapter && (currentChapter.wordCount || 0) > 100 && showHasContentGuide && (
        <div className="mx-6 mt-4 relative rounded-lg border border-amber-500/20 bg-gradient-to-r from-amber-500/10 to-theme-accent/5 p-4 text-left shadow-sm backdrop-blur-md animate-fade-in">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-2.5">
              <Sparkles size={16} className="text-amber-500 shrink-0 mt-0.5 animate-pulse" />
              <div className="space-y-1">
                <h4 className="text-xs font-bold text-amber-600 dark:text-amber-400 font-sans">
                  章节打磨与审计指引
                </h4>
                <p className="text-xs text-theme-text/85 leading-relaxed font-sans">
                  当前阶段主动作：{nextAction}。完成后再继续编辑正文。
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onCloseContentGuide}
              className="text-theme-muted hover:text-theme-text transition-colors text-xs p-1 font-bold font-mono"
              aria-label="关闭提示"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
