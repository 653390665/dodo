import React from 'react';
import { ChevronLeft, Folder, FolderOpen, Plus, Trash2 } from 'lucide-react';

import { Chapter, ChapterMetadata, Novel } from '../../shared/types';
import { cn } from '../lib/utils';

interface ChapterSidebarProps {
  novel: Novel;
  chapters: ChapterMetadata[];
  currentChapter: Chapter | null;
  onSelectChapter: (chapter: ChapterMetadata) => void | Promise<void>;
  onAddChapter: (volumeName?: string) => void;
  onDeleteChapter: (id: string) => void;
  isSidebarOpen: boolean;
  isFullscreen: boolean;
  onBack: () => void;
  expandedVolumes: string[];
  onToggleVolume: (volumeName: string) => void;
}

export const ChapterSidebar = React.memo(function ChapterSidebar({
  novel,
  chapters,
  currentChapter,
  onSelectChapter,
  onAddChapter,
  onDeleteChapter,
  isSidebarOpen,
  isFullscreen,
  onBack,
  expandedVolumes,
  onToggleVolume,
}: ChapterSidebarProps) {

  const groupedChapters = React.useMemo(() => {
    const groups: { volumeName: string; chapters: ChapterMetadata[] }[] = [];
    const volMap = new Map<string, ChapterMetadata[]>();

    chapters.forEach(c => {
      const vName = c.volumeName || '正文卷';
      if (!volMap.has(vName)) {
        volMap.set(vName, []);
        groups.push({ volumeName: vName, chapters: volMap.get(vName)! });
      }
      volMap.get(vName)!.push(c);
    });
    return groups;
  }, [chapters]);

  return (
    <>
      {!isFullscreen && isSidebarOpen && (
        <div
          id="chapter-sidebar-panel"
          className="flex flex-col border-r border-theme-border bg-transparent overflow-hidden"
        >
          <div className="p-4 border-b border-theme-border bg-transparent sticky top-0 z-10 flex items-center justify-between">
            <button
              onClick={onBack}
              className="p-2 hover:bg-theme-border rounded-lg text-theme-muted transition-colors"
              title="返回书库"
              aria-label="返回书库"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <h2 className="text-sm font-bold uppercase tracking-widest text-theme-muted truncate max-w-[120px]">{novel.title}</h2>
            <button
              onClick={() => onAddChapter()}
              className="p-2 hover:opacity-90 bg-theme-accent text-white rounded-lg transition-[background-color,opacity,box-shadow] duration-200"
              title="新建章节"
              aria-label="新建章节"
            >
              <Plus size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {groupedChapters.map(group => (
              <div key={group.volumeName} className="space-y-1">
                {/* Volume Header */}
                <div className="group/vol flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onToggleVolume(group.volumeName)}
                    aria-expanded={expandedVolumes.includes(group.volumeName)}
                    aria-controls={`chapter-volume-${encodeURIComponent(group.volumeName)}`}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-theme-border/30 rounded-lg text-theme-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/50"
                  >
                    {expandedVolumes.includes(group.volumeName) ? (
                      <FolderOpen size={14} className="text-theme-muted" aria-hidden="true" />
                    ) : (
                      <Folder size={14} className="text-theme-muted" aria-hidden="true" />
                    )}
                    <span className="text-xs font-bold truncate flex-1 text-left">{group.volumeName}</span>
                    <span className="text-[10px] text-theme-muted opacity-0 group-hover/vol:opacity-100 group-focus-within/vol:opacity-100 transition-opacity">
                      {group.chapters.length}章
                    </span>
                  </button>
                  <button
                    onClick={() => onAddChapter(group.volumeName)}
                    className="opacity-0 group-hover/vol:opacity-100 focus-visible:opacity-100 p-1 hover:text-theme-accent transition-opacity shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/50 rounded"
                    aria-label={`在${group.volumeName}中添加章节`}
                  >
                    <Plus size={12} aria-hidden="true" />
                  </button>
                </div>

                {/* Volume Chapters */}
                {expandedVolumes.includes(group.volumeName) && (
                  <div id={`chapter-volume-${encodeURIComponent(group.volumeName)}`} className="pl-3 relative before:absolute before:left-3.5 before:top-0 before:bottom-0 before:w-px before:bg-theme-border/50 space-y-1">
                    {group.chapters.map((chapter) => (
                      <div key={chapter.id} className="relative">
                        <div
                          className={cn(
                            "group px-3 py-2.5 rounded-xl cursor-pointer transition-[background-color,border-color,box-shadow,color] duration-200 flex items-center justify-between ml-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/50",
                            currentChapter?.id === chapter.id
                              ? "bg-theme-sidebar shadow-sm border border-theme-border text-theme-text relative before:absolute before:-left-3.5 before:top-1/2 before:-mt-px before:w-3 before:h-0.5 before:bg-theme-accent z-10"
                              : "text-theme-muted hover:bg-theme-border/40 z-10"
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => onSelectChapter(chapter)}
                            aria-current={currentChapter?.id === chapter.id ? 'page' : undefined}
                            aria-label={`打开章节：${chapter.title}`}
                            className="flex min-w-0 flex-1 flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/50 rounded"
                          >
                            <span className="text-sm font-medium truncate">{chapter.title}</span>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); onDeleteChapter(chapter.id); }}
                            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 hover:text-red-600 transition-opacity ml-2 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 rounded"
                            aria-label={`删除章节：${chapter.title}`}
                          >
                            <Trash2 size={12} aria-hidden="true" />
                          </button>
                        </div>

                        {/* Third Level: Beats */}
                        {currentChapter?.id === chapter.id && currentChapter?.sceneBeats && (
                          <div className="pl-7 mt-0.5 space-y-1 mb-2 relative before:absolute before:left-[17px] before:top-0 before:-bottom-2 before:w-px before:bg-theme-border/30">
                            {currentChapter.sceneBeats.split('\n').filter(b => b.trim().length > 0).slice(0, 4).map((beat, i) => (
                              <div key={`${currentChapter.id}-beat-${beat.trim().slice(0, 15)}-${i}`} className="text-[10px] text-theme-muted truncate relative before:absolute before:-left-2.5 before:top-1/2 before:-mt-px before:w-2 before:h-px before:bg-theme-border/30">
                                {beat.replace(/^[-* 0-9.]+\s*/, '').trim() || beat}
                              </div>
                            ))}
                            {currentChapter.sceneBeats.split('\n').filter(b => b.trim().length > 0).length > 4 && (
                              <div className="text-[9px] text-theme-muted/50 pl-0.5">...</div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
});
