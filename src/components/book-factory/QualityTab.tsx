import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Bot, Loader2, MessageSquareWarning, Wand2 } from 'lucide-react';
import type { Chapter } from '../../../shared/types';

interface QualityTabProps {
  currentChapter: Chapter | null;
  onRunAudit: () => Promise<void>;
  isGeneratingCritique: boolean;
  onPolishChapterFromAudit: () => Promise<void>;
  isGeneratingContent: boolean;
}

export function QualityTab({
  currentChapter,
  onRunAudit,
  isGeneratingCritique,
  onPolishChapterFromAudit,
  isGeneratingContent,
}: QualityTabProps) {
  return (
    <div className="space-y-6">
      <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm flex flex-col items-center justify-center text-center">
        <Bot size={32} className="text-theme-accent mb-3 opacity-80" />
        <h3 className="text-sm font-bold text-theme-text mb-1">AI 批判性阅读</h3>
        <p className="text-xs text-theme-muted mb-4 max-w-[200px]">审查当前章节的逻辑漏洞、人物OOC及节奏问题。</p>
        <div className="w-full space-y-2">
          <button
            onClick={() => void onRunAudit()}
            disabled={isGeneratingCritique || !currentChapter}
            className="w-full py-2.5 bg-theme-accent text-white rounded-xl text-sm font-bold shadow-sm hover:opacity-90 transition-[background-color,opacity,box-shadow] duration-200 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isGeneratingCritique ? <Loader2 size={16} className="animate-spin" /> : <MessageSquareWarning size={16} />}
            {isGeneratingCritique ? '审计中...\n(这可能需要1分钟)' : 'AI 审计'}
          </button>
          <button
            data-prompt-surface="chapter-polish"
            onClick={() => void onPolishChapterFromAudit()}
            disabled={isGeneratingContent || !currentChapter?.critique || !currentChapter?.content}
            className="w-full py-2.5 bg-theme-sidebar text-theme-text rounded-xl text-sm font-bold shadow-sm border border-theme-border hover:bg-theme-border/50 disabled:opacity-50 transition-[background-color,border-color,opacity,box-shadow] duration-200 flex items-center justify-center gap-2"
          >
            {isGeneratingContent ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
            {isGeneratingContent ? '精修中…' : '按审计精修正文'}
          </button>
        </div>
      </div>

      {currentChapter?.critique ? (
        <div className="prose prose-sm prose-slate prose-p:leading-relaxed max-w-none bg-red-50/50 p-5 rounded-2xl border border-red-100 shadow-sm">
          <div data-prompt-surface="chapter-review">
            <ReactMarkdown>{currentChapter.critique}</ReactMarkdown>
          </div>
        </div>
      ) : null}
    </div>
  );
}
