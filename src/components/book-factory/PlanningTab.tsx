import React from 'react';
import { Feather, ListOrdered, Loader2, Plus, Sparkles } from 'lucide-react';
import type { Chapter } from '../../../shared/types';
import { cn } from '../../lib/utils';

interface PlanningTabProps {
  renderContextReceipt: () => React.ReactNode;
  userIntent: string;
  setUserIntent: (intent: string) => void;
  currentChapter: Chapter | null;
  onCreateChapter?: () => Promise<void>;
  onGenerateBeats: () => Promise<void>;
  isGeneratingBeats: boolean;
  onGenerateContent: () => Promise<void>;
  isGeneratingContent: boolean;
  onRewriteSelectedText: () => Promise<void>;
  onUpdateChapterBeats: (beats: string) => void;
  generationStatus: string | null;
}

export function PlanningTab({
  renderContextReceipt,
  userIntent,
  setUserIntent,
  currentChapter,
  onCreateChapter,
  onGenerateBeats,
  isGeneratingBeats,
  onGenerateContent,
  isGeneratingContent,
  onRewriteSelectedText,
  onUpdateChapterBeats,
  generationStatus,
}: PlanningTabProps) {
  return (
    <div className="space-y-6">
      {renderContextReceipt()}
      <div className="space-y-4">
        <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
          <h3 className="text-xs font-bold text-theme-text mb-2 flex items-center gap-2">
            <ListOrdered size={14} className="text-theme-accent" />
            创作意图
          </h3>
          <textarea
            data-prompt-surface="workspace-beats"
            value={userIntent}
            onChange={(e) => setUserIntent(e.target.value)}
            placeholder="请描述本章创作意图，例如：从当前剧情位置续写，推进XX冲突，或主角在酒馆偶遇了女二..."
            className="w-full h-24 bg-theme-sidebar border border-theme-border rounded-xl p-3 text-sm text-theme-text placeholder:text-theme-muted/60 resize-none shadow-sm transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20"
          />
          {!currentChapter ? (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-theme-muted">
                当前还没有章节上下文。创建第一章后即可开始生成分镜。
              </p>
              {onCreateChapter && (
                <button
                  onClick={() => void onCreateChapter()}
                  className="w-full py-2.5 bg-theme-accent text-white rounded-xl text-sm font-bold shadow-sm hover:opacity-90 transition-[background-color,opacity,box-shadow] duration-200 flex items-center justify-center gap-2"
                >
                  <Plus size={16} /> 创建第一章并开始分镜
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={() => void onGenerateBeats()}
              disabled={isGeneratingBeats}
              className="w-full mt-3 py-2.5 bg-theme-accent text-white rounded-xl text-sm font-bold shadow-sm hover:opacity-90 transition-[background-color,opacity,box-shadow] duration-200 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isGeneratingBeats ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {isGeneratingBeats ? '规划中...' : '生成场景分镜'}
            </button>
          )}
        </div>

        {currentChapter ? (
          <div className="space-y-3">
            <div
              className={cn(
                'bg-theme-sidebar p-5 rounded-2xl border border-theme-border/40 shadow-sm relative overflow-hidden group',
                !currentChapter.sceneBeats && 'opacity-50',
              )}
            >
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">当前场景分镜规划</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => void onGenerateContent()}
                    disabled={isGeneratingContent || !currentChapter.sceneBeats}
                    className="flex items-center gap-1.5 px-3 py-1 bg-theme-accent text-white rounded-lg text-[10px] font-bold shadow-sm hover:opacity-90 disabled:opacity-50 transition-[background-color,opacity,box-shadow] duration-200"
                  >
                    {isGeneratingContent ? <Loader2 size={10} className="animate-spin" /> : <Feather size={10} />}
                    {isGeneratingContent ? '扩写中…' : 'AI 扩写正文'}
                  </button>
                  <button
                    onClick={() => void onRewriteSelectedText()}
                    disabled={isGeneratingContent}
                    className="flex items-center gap-1.5 px-3 py-1 bg-theme-sidebar text-theme-text rounded-lg text-[10px] font-bold shadow-sm border border-theme-border hover:bg-theme-border/50 disabled:opacity-50 transition-[background-color,border-color,opacity,box-shadow] duration-200"
                  >
                    <Sparkles size={10} />
                    选中改写
                  </button>
                </div>
              </div>
              <textarea
                data-prompt-surface="workspace-beats"
                value={currentChapter.sceneBeats || ''}
                onChange={(e) => onUpdateChapterBeats(e.target.value)}
                placeholder="点击上方按钮生成分镜，或在此手动规划情节重点..."
                className="w-full h-64 bg-theme-sidebar/10 border-none p-0 text-sm text-theme-text placeholder:text-theme-muted/40 resize-none scrollbar-none font-serif leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/20 rounded-lg"
              />
            </div>

            {isGeneratingContent ? (
              <div className="flex items-center justify-center p-4 bg-theme-sidebar/20 rounded-xl border border-theme-border/30 text-xs text-theme-muted gap-2">
                <Loader2 size={14} className="animate-spin" /> Writer Agent 正在执笔中...
              </div>
            ) : null}
            {generationStatus ? (
              <div className="rounded-xl border border-theme-border/40 bg-theme-sidebar/20 px-3 py-2 text-xs text-theme-muted">
                {generationStatus}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
