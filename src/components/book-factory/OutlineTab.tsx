import React from 'react';
import { FileText, Loader2, Sparkles } from 'lucide-react';
import type { Chapter, ChapterMetadata } from '../../../shared/types';
import { cn } from '../../lib/utils';

interface OutlineTabProps {
  expectedWordCount: number | '';
  setExpectedWordCount: (count: number | '') => void;
  onGenerateOutline: () => Promise<void>;
  isGeneratingOutline: boolean;
  globalOutline: string;
  onGlobalOutlineChange: (outline: string) => void;
  chapters: ChapterMetadata[];
  currentChapter: Chapter | null;
  setCurrentChapter: (chapter: Chapter | null) => void;
}

export function OutlineTab({
  expectedWordCount,
  setExpectedWordCount,
  onGenerateOutline,
  isGeneratingOutline,
  globalOutline,
  onGlobalOutlineChange,
  chapters,
  currentChapter,
  setCurrentChapter,
}: OutlineTabProps) {
  return (
    <div className="space-y-6">
      <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-xs font-bold text-theme-text flex items-center gap-2">
            <FileText size={14} className="text-theme-accent" />
            全局大纲 (Global Outline)
          </h3>
        </div>

        <div className="flex gap-2 mb-3">
          <div className="flex-1 relative">
            <input
              type="number"
              placeholder="预计总字数 (如: 1000000)"
              value={expectedWordCount}
              onChange={(e) => setExpectedWordCount(parseInt(e.target.value) || '')}
              className="w-full text-[10px] p-2 bg-theme-sidebar border border-theme-border rounded-lg pl-2 pr-6 transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20"
            />
            <span className="absolute right-2 top-[7px] text-[10px] text-theme-muted">字</span>
          </div>
          <button
            onClick={() => void onGenerateOutline()}
            disabled={!expectedWordCount || isGeneratingOutline}
            className="px-3 py-1.5 bg-theme-accent text-white text-[10px] font-bold rounded-lg hover:bg-theme-accent/90 disabled:opacity-50 transition-[background-color,opacity,box-shadow] duration-200 flex items-center gap-1.5"
          >
            {isGeneratingOutline ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} AI 智能排盘
          </button>
        </div>

        <textarea
          data-prompt-surface="workspace-draft"
          value={globalOutline}
          onChange={(e) => onGlobalOutlineChange(e.target.value)}
          placeholder="在此规划整本小说的核心冲突与路线图；也可以输入初始创意，点击“智能排盘”由 AI 为您生成卷轴级大纲..."
          className="w-full h-40 bg-theme-sidebar border border-theme-border rounded-xl p-3 text-xs text-theme-text placeholder:text-theme-muted/40 resize-none shadow-sm font-serif leading-relaxed transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20"
        />
      </div>

      <div className="space-y-3">
        <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider px-1">章节快速导航</h3>
        <div className="space-y-1.5 pb-8">
          {chapters.map((chapter, index) => (
            <button
              key={chapter.id}
              onClick={() => setCurrentChapter(chapter as unknown as Chapter)}
              className={cn(
                'w-full text-left p-3 rounded-xl border transition-[background-color,border-color,box-shadow,color] duration-200 flex flex-col gap-1',
                currentChapter?.id === chapter.id
                  ? 'bg-theme-accent/5 border-theme-accent shadow-sm'
                  : 'bg-theme-sidebar border-theme-border/40 hover:border-theme-accent/20',
              )}
            >
              <div className="flex justify-between items-center">
                <span className={cn('text-xs font-bold', currentChapter?.id === chapter.id ? 'text-theme-accent' : 'text-theme-text')}>
                  第 {index + 1} 章: {chapter.title}
                </span>
                <span className="text-[9px] text-theme-muted">{chapter.wordCount} 字</span>
              </div>
              {currentChapter?.id === chapter.id && currentChapter.sceneBeats ? (
                <p className="text-[9px] text-theme-muted line-clamp-1 opacity-70">
                  {currentChapter.sceneBeats.substring(0, 50)}
                </p>
              ) : (chapter as Partial<Chapter>).sceneBeats ? (
                <p className="text-[9px] text-theme-muted line-clamp-1 opacity-70">
                  {(chapter as Partial<Chapter>).sceneBeats?.substring(0, 50)}
                </p>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
