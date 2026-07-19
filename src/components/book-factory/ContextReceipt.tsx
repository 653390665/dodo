import React from 'react';
import type { Chapter, ContinuationPack } from '../../../shared/types';

interface ContextReceiptProps {
  currentChapter: Chapter | null;
  selectedContinuationPack: ContinuationPack | null;
  activeSkillsCount: number;
  bibleEntitiesCount: number;
}

export function ContextReceipt({
  currentChapter,
  selectedContinuationPack,
  activeSkillsCount,
  bibleEntitiesCount,
}: ContextReceiptProps) {
  return (
    <div className="bg-theme-sidebar/40 rounded-xl border border-theme-border/60 p-3.5 space-y-2 mb-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">
          生成上下文凭证 (Context Receipt)
        </span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold scale-90 origin-right">
          已就绪
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-1.5 text-theme-muted">
          <div className="w-1.5 h-1.5 rounded-full bg-theme-accent" />
          <span className="truncate">
            目标章节: <strong className="text-theme-text">{currentChapter?.title || '未选择'}</strong>
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-theme-muted">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          <span className="truncate">
            资料包: <strong className="text-theme-text">{selectedContinuationPack?.title || '未绑定'}</strong>
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-theme-muted">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className="truncate">
            装配技能: <strong className="text-theme-text">{activeSkillsCount}/3 个</strong>
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-theme-muted">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
          <span className="truncate">
            世界观条目: <strong className="text-theme-text">{bibleEntitiesCount} 条</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
