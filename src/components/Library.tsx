import React, { useState, useEffect, useRef } from 'react';
import { BookMarked, CheckCircle2, Clock, Download, FileText, Globe2, PenLine, Plus, Search, Trash2, Wand2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel } from './ui/alert-dialog';

import { listNovels, createNovelWithChapter, deleteNovel } from '../lib/novel-client';
import { listChapters, listChaptersMetadata } from '../lib/chapter-client';
import { callBatch } from '../lib/db-transport';
import { listContinuationPacks } from '../lib/continuation-client';
import { logger } from '../lib/client-logger';
import { subscribeToChanges } from '../lib/db-transport';
import { getProjectCapabilityCardCount } from '../lib/capability-card-count';
import { Novel, ViewType, ChapterMetadata, ContinuationPack } from '../../shared/types';
import { generateClientId } from '../lib/id';

interface LibraryProps {
  onSelectNovel: (novel: Novel) => void;
  onNavigate?: (view: ViewType) => void;
  userId: string;
}

export function Library({ onSelectNovel, onNavigate, userId }: LibraryProps) {
  const [novels, setNovels] = useState<Novel[]>([]);
  const [novelsToDelete, setNovelsToDelete] = useState<string[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedNovelIds, setSelectedNovelIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newNovelTitle, setNewNovelTitle] = useState('');

  const [chaptersMap, setChaptersMap] = useState<Record<string, ChapterMetadata[]>>({});
  const [packsMap, setPacksMap] = useState<Record<string, ContinuationPack[]>>({});
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const refreshRequestRef = useRef(0);
  const mountedRef = useRef(true);

  const loadMetadata = async (novelList: Novel[], requestId: number) => {
    const chaps: Record<string, ChapterMetadata[]> = {};
    const pks: Record<string, ContinuationPack[]> = {};
    let failed = false;

    try {
      const batch = await callBatch<{ chapters: Record<string, ChapterMetadata[]>; packs: Record<string, ContinuationPack[]> }>('listLibraryMetadata', novelList.map((novel) => novel.id));
      Object.assign(chaps, batch.chapters);
      Object.assign(pks, batch.packs);
    } catch {
      // Older servers and isolated browser fixtures may not expose the batch
      // method yet. Fall back without hiding existing metadata.
      await Promise.all(novelList.map(async (novel) => {
        try {
          const [chapterMetadata, packs] = await Promise.all([
            listChaptersMetadata(novel.id),
            listContinuationPacks(novel.id),
          ]);
          chaps[novel.id] = chapterMetadata;
          pks[novel.id] = packs;
        } catch {
          failed = true;
        }
      }));
    }

    if (!mountedRef.current || requestId !== refreshRequestRef.current) return;
    setChaptersMap((previous) => {
      const next = Object.fromEntries(novelList.map((novel) => [novel.id, previous[novel.id] || []]));
      return { ...next, ...chaps };
    });
    setPacksMap((previous) => {
      const next = Object.fromEntries(novelList.map((novel) => [novel.id, previous[novel.id] || []]));
      return { ...next, ...pks };
    });
    setMetadataError(failed ? '部分作品资料加载失败，已保留上次数据。' : null);
  };

  useEffect(() => {
    mountedRef.current = true;
    const refreshLibrary = async () => {
      const requestId = ++refreshRequestRef.current;
      try {
        const list = await listNovels();
        if (!mountedRef.current || requestId !== refreshRequestRef.current) return;
        setNovels(list);
        await loadMetadata(list, requestId);
      } catch (error) {
        if (!mountedRef.current || requestId !== refreshRequestRef.current) return;
        setMetadataError(error instanceof Error ? error.message : '书库刷新失败，请重试。');
      }
    };
    void refreshLibrary();
    const unsubscribe = subscribeToChanges(() => { void refreshLibrary(); });
    return () => {
      mountedRef.current = false;
      refreshRequestRef.current += 1;
      unsubscribe();
    };
  }, [refreshNonce]);

  const handleCreateNovel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNovelTitle.trim()) return;

    const novelId = generateClientId();
    const now = Date.now();
    const novel = {
      id: novelId,
      title: newNovelTitle,
      authorId: userId,
      summary: '',
      status: 'ongoing',
      createdAt: now,
      updatedAt: now,
    } as Novel;
    const newChapId = generateClientId();
    const firstChapter = {
      id: newChapId,
      title: '第一章',
      content: '',
      wordCount: 0,
      order: 0,
      volumeName: '默认卷',
      novelId,
      createdAt: now,
      updatedAt: now,
    };
    await createNovelWithChapter(novel, firstChapter);

    setNewNovelTitle('');
    setIsAdding(false);
    onSelectNovel(novel);
  };

  const handleDeleteNovel = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setNovelsToDelete([id]);
  };

  const handleCardClick = (novel: Novel) => {
    if (isSelectionMode) {
      setSelectedNovelIds(prev =>
        prev.includes(novel.id)
          ? prev.filter(id => id !== novel.id)
          : [...prev, novel.id]
      );
    } else {
      onSelectNovel(novel);
    }
  };

  const executeDeleteNovels = async () => {
    if (novelsToDelete.length > 0) {
      const requestId = ++refreshRequestRef.current;
      try {
        for (const id of novelsToDelete) {
          await deleteNovel(id);
        }
        const list = await listNovels();
        if (!mountedRef.current || requestId !== refreshRequestRef.current) return;
        setNovels(list);
        await loadMetadata(list, requestId);
        if (!mountedRef.current || requestId !== refreshRequestRef.current) return;
        setSelectedNovelIds([]);
        setIsSelectionMode(false);
      } catch (err) {
        logger.error('Failed to delete novels:', err);
        alert(`删除小说失败: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (mountedRef.current) setNovelsToDelete([]);
      }
    }
  };

  const handleExportNovel = async (e: React.MouseEvent, novel: Novel) => {
    e.stopPropagation();
    try {
      const chapters = await listChapters(novel.id);

      let exportText = `# ${novel.title}\n\n`;
      if (novel.summary) exportText += `【简介】\n${novel.summary}\n\n`;
      if (novel.globalOutline) exportText += `【大纲】\n${novel.globalOutline}\n\n`;

      exportText += `==============================\n\n`;

      chapters.forEach(ch => {
         exportText += `## ${ch.title}\n\n`;
         exportText += `${ch.content || ''}\n\n`;
      });

      if ('showDirectoryPicker' in window) {
        try {
          // @ts-expect-error showDirectoryPicker may not be in all TS lib types
          const dirHandle = await window.showDirectoryPicker();
          const fileHandle = await dirHandle.getFileHandle(`${novel.title}.txt`, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(exportText);
          await writable.close();
          alert(`已成功导出至选择的文件夹：${novel.title}.txt`);
          return;
        } catch (err) {
          // Fallback if user cancels or permission denied
          logger.warn('Directory picker failed or canceled, falling back to download', err);
        }
      }

      const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${novel.title}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('导出失败');
    }
  };

  const filteredNovels = novels.filter(n => n.title.toLowerCase().includes(search.toLowerCase()));
  const getReadinessItems = (novel: Novel) => {
    const capabilityCardCount = getProjectCapabilityCardCount(novel);
    return [
      { label: '简介', ready: Boolean(novel.summary?.trim()), icon: FileText },
      { label: '大纲', ready: Boolean(novel.globalOutline?.trim()), icon: CheckCircle2 },
      { label: '世界观', ready: Boolean(novel.worldRules?.trim()), icon: Globe2 },
      { label: `能力卡 ${capabilityCardCount}/3`, ready: capabilityCardCount > 0, icon: Wand2 },
    ];
  };

  return (
    <div className="h-full flex flex-col p-8 lg:p-12 overflow-y-auto bg-transparent">
      {/* Search & Actions Header */}
      <div className="flex items-center justify-between mb-12">
        <h1 className="text-3xl font-serif font-black tracking-tight text-theme-text">
          我的书库 <span className="text-theme-muted font-light px-2 hidden sm:inline">|</span>{' '}
          <span className="text-lg font-sans font-normal text-theme-muted hidden sm:inline">
            {isSelectionMode ? '批量管理模式' : 'Recent Works'}
          </span>
        </h1>

        <div className="flex items-center gap-4">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted group-focus-within:text-theme-accent transition-colors" size={18} />
            <input
              type="text"
              placeholder="搜索作品..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 bg-theme-sidebar border border-theme-border focus:bg-theme-sidebar focus:border-theme-accent rounded-lg text-sm outline-none transition-all w-64 shadow-sm text-theme-text placeholder:text-theme-muted"
            />
          </div>

          {isSelectionMode ? (
            /* Batch Selection controls band - Glassmorphism, beautiful round bar styling */
            <div className="flex items-center gap-3 bg-theme-sidebar/60 backdrop-blur-md border border-theme-border rounded-xl px-4 py-1.5 text-sm shadow-md animate-in fade-in duration-300">
              <span className="font-sans font-bold text-theme-text text-xs whitespace-nowrap">
                已选中 <span className="text-theme-accent font-serif text-sm px-0.5">{selectedNovelIds.length}</span> 部作品
              </span>
              <span className="text-theme-border/50">|</span>
              <button
                type="button"
                onClick={() => {
                  const allIds = filteredNovels.map((n) => n.id);
                  const allSelected = allIds.length > 0 && allIds.every((id) => selectedNovelIds.includes(id));
                  if (allSelected) {
                    setSelectedNovelIds([]);
                  } else {
                    setSelectedNovelIds(allIds);
                  }
                }}
                className="text-theme-accent hover:underline text-xs font-semibold whitespace-nowrap"
              >
                {filteredNovels.length > 0 && filteredNovels.every((n) => selectedNovelIds.includes(n.id)) ? '取消全选' : '一键全选'}
              </button>
              <span className="text-theme-border/50">|</span>
              <button
                type="button"
                disabled={selectedNovelIds.length === 0}
                onClick={() => setNovelsToDelete(selectedNovelIds)}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black transition-all",
                  selectedNovelIds.length > 0
                    ? "bg-red-500/10 hover:bg-red-500 hover:text-white text-red-500 border border-red-500/20 active:scale-95"
                    : "bg-theme-bg/20 text-theme-muted/50 border border-theme-border/30 cursor-not-allowed"
                )}
              >
                <Trash2 size={12} />
                <span>批量删除</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSelectionMode(false);
                  setSelectedNovelIds([]);
                }}
                className="px-2.5 py-1 rounded-lg text-xs font-bold border border-theme-border hover:bg-theme-sidebar text-theme-muted hover:text-theme-text transition-all active:scale-95"
              >
                退出
              </button>
            </div>
          ) : (
            <>
              {novels.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setIsSelectionMode(true);
                    setSelectedNovelIds([]);
                  }}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-theme-sidebar border border-theme-border hover:border-theme-accent rounded-xl text-sm font-bold text-theme-text hover:text-theme-accent transition-all shadow-sm active:scale-95"
                >
                  <span>批量管理</span>
                </button>
              )}
              <button
                onClick={() => setIsAdding(true)}
                className="natural-btn-primary flex items-center gap-2 px-5 py-2.5"
              >
                <Plus size={18} />
                <span>新作品</span>
              </button>
            </>
          )}
        </div>
      </div>

      {metadataError && (
        <div role="alert" className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span>{metadataError}</span>
          <button type="button" className="font-semibold underline" onClick={() => setRefreshNonce((value) => value + 1)}>重试刷新</button>
        </div>
      )}

      {/* Empty state */}
      {novels.length === 0 && !isAdding && (
        <div className="h-full flex flex-col items-center justify-center p-8 text-center -mt-16">
          <BookMarked size={48} className="text-theme-muted/20 mb-6" />
          <h3 className="text-xl font-serif font-bold text-theme-text mb-2">还没有作品</h3>
          <p className="text-sm text-theme-muted mb-8 max-w-sm">
            创建一本新书开始写作，或者去智能管家构思故事框架。
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setIsAdding(true)}
              className="rounded-xl bg-theme-text text-white px-5 py-2.5 text-sm font-bold hover:opacity-90 transition-opacity"
            >
              创建空白作品
            </button>
            <button
              onClick={() => onNavigate?.('welcome')}
              className="rounded-xl border border-theme-accent text-theme-accent px-5 py-2.5 text-sm font-bold hover:bg-theme-accent/5 transition-colors"
            >
              从灵感开始
            </button>
          </div>
        </div>
      )}

      {/* Grid of Novels */}
      {(novels.length > 0 || isAdding) && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {filteredNovels.map((novel) => {
            const hues = [
              'from-rose-100 to-teal-50',
              'from-amber-100 to-indigo-50',
              'from-emerald-100 to-fuchsia-50',
              'from-sky-100 to-orange-50',
              'from-violet-100 to-lime-50',
            ];
            const hueIndex = (parseInt(novel.id.slice(-3)) || 0) % hues.length;
            const gradientClass = hues[hueIndex];

            const novelChapters = chaptersMap[novel.id] || [];
            const latestCh = [...novelChapters].sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
            const chaptersCount = novelChapters.length;
            const novelPacks = packsMap[novel.id] || [];
            const firstPack = novelPacks[0] || null;

            const isSelected = selectedNovelIds.includes(novel.id);

            return (
              <div
                key={novel.id}
                onClick={() => handleCardClick(novel)}
                className={cn(
                  "group relative min-h-[440px] bg-theme-sidebar rounded-[2.5rem] border p-6 overflow-hidden transition-all duration-500 cursor-pointer",
                  isSelectionMode
                    ? isSelected
                      ? "border-theme-accent shadow-lg shadow-theme-accent/5 ring-1 ring-theme-accent/20 scale-[1.01]"
                      : "border-theme-border hover:border-theme-border/80 shadow-sm"
                    : "border-theme-border hover:shadow-2xl hover:shadow-theme-accent/10 hover:-translate-y-1"
                )}
              >
                {/* Individual Export/Delete hover panel - Disabled during selection mode */}
                {!isSelectionMode && (
                  <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-all duration-300 z-10 flex gap-2 translate-y-2 group-hover:translate-y-0">
                    <button
                      onClick={(e) => handleExportNovel(e, novel)}
                      className="p-2.5 bg-theme-sidebar/90 backdrop-blur rounded-xl text-theme-muted hover:text-theme-text hover:bg-theme-sidebar transition-all shadow-lg border border-theme-border/50"
                      title="导出全本 (TXT)"
                      aria-label={`导出《${novel.title}》`}
                    >
                      <Download size={16} />
                    </button>
                    <button
                      onClick={(e) => handleDeleteNovel(e, novel.id)}
                      className="p-2.5 bg-theme-sidebar/90 backdrop-blur rounded-xl text-theme-muted hover:text-red-600 hover:bg-red-50 transition-all shadow-lg border border-theme-border/50"
                      title="删除作品"
                      aria-label={`删除《${novel.title}》`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}

                {/* Enhanced Cover with Glassmorphism Selection overlay */}
                <div className={cn(
                  "w-full h-52 rounded-3xl mb-6 flex flex-col items-center justify-center relative overflow-hidden group-hover:scale-[1.03] transition-transform duration-700 bg-gradient-to-br shadow-inner",
                  gradientClass
                )}>
                  <BookMarked size={56} className="text-theme-text/10 mb-2" />
                  <div className="text-[10px] font-bold text-theme-text/20 uppercase tracking-[0.3em] font-serif">Inspiration Vault</div>
                  <div className="absolute inset-0 bg-gradient-to-t from-white/40 to-transparent" />

                  {/* Visual texture */}
                  <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, black 1px, transparent 0)', backgroundSize: '24px 24px' }} />

                  {/* Stateful Circle selection badge inside cover */}
                  {isSelectionMode && (
                    <div 
                      className={cn(
                        "absolute top-4 left-4 z-10 w-8 h-8 rounded-full flex items-center justify-center border backdrop-blur-sm transition-all duration-300 shadow-md",
                        isSelected
                          ? "bg-theme-accent border-theme-accent text-white scale-110"
                          : "bg-black/5 hover:bg-black/10 border-white/40 text-transparent"
                      )}
                    >
                      <CheckCircle2 size={16} className={cn("transition-transform duration-300", isSelected ? "scale-100" : "scale-0")} />
                    </div>
                  )}
                </div>

                <div className="flex flex-col min-h-[160px]">
                  <h3 className="text-2xl font-serif font-bold text-theme-text line-clamp-2 leading-tight group-hover:text-theme-accent transition-colors">
                    {novel.title}
                  </h3>
                  {firstPack && (
                    <div className="text-[10px] text-theme-muted mt-1 bg-theme-accent/5 border border-theme-accent/10 px-2 py-1 rounded-lg flex flex-wrap items-center gap-1 leading-4">
                      <span className="font-bold text-theme-accent truncate max-w-[150px]">包: {firstPack.title}</span>
                      <span>•</span>
                      <span>{new Date(firstPack.createdAt).toLocaleDateString()}</span>
                      <span>•</span>
                      <span>{(firstPack.sourceDocuments || []).length} 篇文档</span>
                    </div>
                  )}
                  <p className="mt-2 min-h-[40px] text-xs leading-5 text-theme-muted line-clamp-2">
                    {novel.summary?.trim() || '还没有简介。继续写作时可以补全故事方向和角色动机。'}
                  </p>

                  {/* Chapter details box */}
                  <div className="mt-3 p-3 rounded-2xl bg-theme-bg/30 border border-theme-border/40 text-xs space-y-1">
                    <div className="flex justify-between text-theme-muted text-[11px] font-bold">
                      <span>章节总数:</span>
                      <span className="text-theme-text font-semibold">{chaptersCount} 章</span>
                    </div>
                    <div className="flex justify-between text-theme-muted text-[11px] font-bold truncate gap-2">
                      <span>最近章节:</span>
                      <span className="text-theme-text font-semibold truncate" title={latestCh?.title || '无'}>
                        {latestCh?.title || '暂无章节'}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {getReadinessItems(novel).map((item) => {
                      const Icon = item.icon;
                      return (
                        <div
                          key={item.label}
                          className={cn(
                            'flex items-center gap-1.5 rounded-xl border px-2 py-1.5 text-[10px] font-bold',
                            item.ready
                              ? 'border-theme-accent/20 bg-theme-accent/5 text-theme-accent'
                              : 'border-theme-border bg-theme-bg/40 text-theme-muted',
                          )}
                        >
                          <Icon size={12} />
                          <span className="truncate">{item.label}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-3 mt-auto pt-5 border-t border-theme-border/30">
                    <div className="flex items-center gap-1.5 text-[10px] text-theme-muted uppercase tracking-widest font-bold">
                      <Clock size={12} className="opacity-50" />
                      <span>{new Date(novel.updatedAt).toLocaleDateString()}</span>
                    </div>

                    {(() => {
                      const configMap = {
                        ongoing: { label: '连载中', color: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
                        completed: { label: '已完结', color: 'bg-blue-50 text-blue-700 border-blue-100' },
                        hiatus: { label: '断更', color: 'bg-amber-50 text-amber-700 border-amber-100' }
                      };
                      const statusConfig = configMap[(novel.status as keyof typeof configMap) || 'ongoing'];

                      return (
                        <span className={cn(
                          "ml-auto px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-tighter border shadow-sm",
                          statusConfig.color
                        )}>
                          {statusConfig.label}
                        </span>
                      );
                    })()}
                  </div>

                  {/* Adaptive button: Selection Mode toggles card select state, Normal Mode proceeds to Editor */}
                  {isSelectionMode ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedNovelIds(prev =>
                          prev.includes(novel.id)
                            ? prev.filter(id => id !== novel.id)
                            : [...prev, novel.id]
                        );
                      }}
                      className={cn(
                        "mt-4 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold shadow-sm transition-all duration-300",
                        isSelected
                          ? "bg-theme-accent/10 border border-theme-accent/30 text-theme-accent hover:bg-theme-accent/20"
                          : "bg-transparent border border-dashed border-theme-border hover:border-theme-accent text-theme-muted hover:text-theme-accent"
                      )}
                    >
                      <CheckCircle2 size={15} className={cn("transition-transform duration-300", isSelected && "scale-110")} />
                      <span>{isSelected ? '取消选择' : '选择此书'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectNovel(novel);
                      }}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-theme-text px-4 py-3 text-sm font-bold text-theme-bg shadow-sm transition-opacity hover:opacity-90 animate-in fade-in duration-300"
                    >
                      <PenLine size={15} />
                      <span>继续写</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {isAdding && (
            <div
              className="h-[420px] border-2 border-dashed border-theme-border rounded-[2.5rem] p-6 flex flex-col items-center justify-center text-center bg-theme-sidebar/10 group hover:border-theme-accent transition-colors"
            >
              <form onSubmit={handleCreateNovel} className="w-full px-4">
                <div className="w-20 h-20 bg-theme-sidebar rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm border border-theme-border group-hover:scale-110 transition-transform">
                  <Plus size={32} className="text-theme-accent" />
                </div>
                <input
                  autoFocus
                  type="text"
                  placeholder="在此输入新书名..."
                  value={newNovelTitle}
                  onChange={(e) => setNewNovelTitle(e.target.value)}
                  className="w-full text-center bg-transparent border-b-2 border-theme-accent/30 focus:border-theme-accent py-2 text-2xl font-serif mb-8 outline-none text-theme-text placeholder:text-theme-muted/50 transition-colors"
                />
                <div className="flex gap-4 justify-center">
                  <button
                    type="button"
                    onClick={() => setIsAdding(false)}
                    className="px-5 py-2 text-sm text-theme-muted hover:text-theme-text font-bold transition-colors"
                  >
                    放弃
                  </button>
                  <button
                    type="submit"
                    className="bg-theme-text text-white px-8 py-2.5 rounded-xl text-sm font-bold shadow-lg hover:shadow-xl active:scale-95 transition-all"
                  >
                    立即创建
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Adaptive AlertDialog supporting both Single & Bulk deletes with unified queue handling */}
      <AlertDialog open={novelsToDelete.length > 0} onOpenChange={(open) => !open && setNovelsToDelete([])}>
        <AlertDialogContent className="bg-theme-sidebar border border-theme-border rounded-[2rem] p-6 max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-serif font-bold text-theme-text">
              {novelsToDelete.length > 1 
                ? `确定要批量删除选中的 ${novelsToDelete.length} 部作品吗？` 
                : "确定要删除这部作品吗？"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-theme-muted mt-2">
              {novelsToDelete.length > 1
                ? "此操作极其危险且不可逆！将会一次性物理抹除所选作品的全部卷章正文、大纲、设定记录及相关的全部本地数据。"
                : "此操作不可逆！将会永久删除该作品的全部卷章正文、大纲、世界观条目与创作记录。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-6 flex gap-3 justify-end">
            <AlertDialogCancel className="rounded-xl border border-theme-border hover:bg-theme-bg/50 px-4 py-2 text-sm font-bold text-theme-muted transition-colors">
              取消
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={executeDeleteNovels} 
              className="rounded-xl bg-red-600 hover:bg-red-700 text-white px-5 py-2 text-sm font-bold transition-colors"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
