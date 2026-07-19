import React from 'react';
import { FileText, Loader2, Sparkles, Package, CheckCircle2 } from 'lucide-react';
import type { Chapter, ChapterMetadata, ContinuationPack, ContinuationSourceKind } from '../../../shared/types';
import { cn } from '../../lib/utils';

const SOURCE_KIND_LABELS: Record<ContinuationSourceKind, string> = {
  world: '世界设定',
  outline: '大纲资料',
  characters: '人物资料',
  manuscript: '正文资料',
  style_sample: '风格样本',
  other: '其他资料',
};

interface OutlineTabProps {
  expectedWordCount: number | '';
  setExpectedWordCount: (count: number | '') => void;
  onGenerateOutline: () => Promise<void>;
  isGeneratingOutline: boolean;
  globalOutline: string;
  onGlobalOutlineChange: (outline: string) => void;
  chapters: ChapterMetadata[];
  currentChapter: Chapter | null;
  onSelectChapter: (chapter: ChapterMetadata) => void | Promise<void>;
  selectedContinuationPack: ContinuationPack | null;
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
  onSelectChapter,
  selectedContinuationPack,
}: OutlineTabProps) {
  const hasOutline = globalOutline.trim().length > 0;
  const hasApprovedPack = selectedContinuationPack?.status === 'approved';

  const sourceDocumentCounts = React.useMemo(() => {
    if (!selectedContinuationPack) return null;
    const counts: Partial<Record<ContinuationSourceKind, number>> = {};
    for (const doc of selectedContinuationPack.sourceDocuments) {
      counts[doc.kind] = (counts[doc.kind] || 0) + 1;
    }
    return counts;
  }, [selectedContinuationPack]);

  const hasManuscriptDocs = React.useMemo(() => {
    if (!sourceDocumentCounts) return false;
    return (sourceDocumentCounts.manuscript || 0) > 0;
  }, [sourceDocumentCounts]);

  const isButtonDisabled = !expectedWordCount || isGeneratingOutline;

  return (
    <div className="space-y-6">
      <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-xs font-bold text-theme-text flex items-center gap-2">
            <FileText size={14} className="text-theme-accent" aria-hidden="true" />
            全局大纲 (Global Outline)
          </h3>
        </div>

        {hasApprovedPack && !hasOutline && sourceDocumentCounts && (
          <div className="mb-3 p-3 bg-theme-accent/5 border border-theme-accent/20 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Package size={12} className="text-theme-accent" aria-hidden="true" />
              <span className="text-[10px] font-bold text-theme-accent">
                资料已读取，尚未生成作品大纲
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(sourceDocumentCounts).map(([kind, count]) => (
                <span
                  key={kind}
                  className="inline-flex items-center gap-1 text-[9px] px-2 py-0.5 bg-theme-sidebar border border-theme-border rounded-full"
                >
                  <CheckCircle2 size={8} className="text-green-500" aria-hidden="true" />
                  {SOURCE_KIND_LABELS[kind as ContinuationSourceKind]}: {count} 份
                </span>
              ))}
            </div>
            {hasManuscriptDocs && (
              <p className="text-[9px] text-theme-muted mt-2">
                导入正文仅作为续写参考，尚未拆分成章节。点击下方按钮可基于资料生成大纲。
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2 mb-3">
          <div className="flex-1 relative">
            <input
              type="number"
              placeholder="预计总字数 (如: 1000000)"
              value={expectedWordCount}
              onChange={(e) => setExpectedWordCount(parseInt(e.target.value) || '')}
              disabled={isGeneratingOutline}
              className="w-full text-[10px] p-2 bg-theme-sidebar border border-theme-border rounded-lg pl-2 pr-6 transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20 disabled:opacity-50"
            />
            <span className="absolute right-2 top-[7px] text-[10px] text-theme-muted">字</span>
          </div>
          <button
            onClick={() => void onGenerateOutline()}
            disabled={isButtonDisabled}
            title={!expectedWordCount ? '请先填写预计总字数' : undefined}
            className="px-3 py-1.5 bg-theme-accent text-white text-[10px] font-bold rounded-lg hover:bg-theme-accent/90 disabled:opacity-50 transition-[background-color,opacity,box-shadow] duration-200 flex items-center gap-1.5"
          >
            {isGeneratingOutline ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Sparkles size={12} aria-hidden="true" />} {hasApprovedPack ? '根据导入资料生成大纲' : 'AI 智能排盘'}
          </button>
        </div>

        <textarea
          data-prompt-surface="workspace-draft"
          value={globalOutline}
          onChange={(e) => onGlobalOutlineChange(e.target.value)}
          disabled={isGeneratingOutline}
          placeholder={'在此规划整本小说的核心冲突与路线图；也可以输入初始创意，点击"智能排盘"由 AI 为您生成卷轴级大纲...'}
          className="w-full h-40 bg-theme-sidebar border border-theme-border rounded-xl p-3 text-xs text-theme-text placeholder:text-theme-muted/40 resize-none shadow-sm font-serif leading-relaxed transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20 disabled:opacity-50"
        />
      </div>

      <div className="space-y-3">
        <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider px-1">章节快速导航</h3>
        <div className="space-y-1.5 pb-8">
          {chapters.map((chapter, index) => (
            <button
              key={chapter.id}
              onClick={() => void onSelectChapter(chapter)}
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
