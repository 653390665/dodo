import React, { useState, useEffect } from 'react';
import { cn } from '../lib/utils';import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import MoreVertical from 'lucide-react/dist/esm/icons/more-vertical.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import BookMarked from 'lucide-react/dist/esm/icons/book-marked.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Download from 'lucide-react/dist/esm/icons/download.js';
import { listNovels, createNovel, deleteNovel } from '../lib/novel-client';
import { createChapter, listChapters } from '../lib/chapter-client';
import { subscribeToChanges } from '../lib/db-transport';
import { Novel, Chapter, ViewType } from '../types';

interface LibraryProps {
  onSelectNovel: (novel: Novel) => void;
  onNavigate?: (view: ViewType) => void;
  userId: string;
}

export function Library({ onSelectNovel, onNavigate, userId }: LibraryProps) {
  const [novels, setNovels] = useState<Novel[]>([]);
  const [search, setSearch] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newNovelTitle, setNewNovelTitle] = useState('');

  useEffect(() => {
    listNovels().then(setNovels);
    return subscribeToChanges(() => listNovels().then(setNovels));
  }, []);

  const handleCreateNovel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNovelTitle.trim()) return;

    const novelId = Date.now().toString();
    await createNovel({
      id: novelId,
      title: newNovelTitle,
      authorId: userId,
      summary: '',
      status: 'ongoing',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const newChapId = Date.now().toString();
    await createChapter({
      id: newChapId,
      title: '第一章',
      content: '',
      wordCount: 0,
      order: 0,
      volumeName: '默认卷',
      novelId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    setNewNovelTitle('');
    setIsAdding(false);
    onSelectNovel({
      id: novelId,
      title: newNovelTitle,
      authorId: userId,
      summary: '',
      status: 'ongoing',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  };

  const handleDeleteNovel = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('确定要删除这部作品吗？此操作不可逆。')) return;

    await deleteNovel(id);
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
          // @ts-ignore
          const dirHandle = await window.showDirectoryPicker();
          const fileHandle = await dirHandle.getFileHandle(`${novel.title}.txt`, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(exportText);
          await writable.close();
          alert(`已成功导出至选择的文件夹：${novel.title}.txt`);
          return;
        } catch (err) {
          // Fallback if user cancels or permission denied
          console.warn("Directory picker failed or canceled, falling back to download", err);
        }
      }

      const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${novel.title}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      alert('导出失败');
    }
  };

  const filteredNovels = novels.filter(n => n.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="h-full flex flex-col p-8 lg:p-12 overflow-y-auto bg-transparent">
      {/* Search & Actions Header */}
      <div className="flex items-center justify-between mb-12">
        <h1 className="text-3xl font-serif font-black tracking-tight text-theme-text">我的书库 <span className="text-theme-muted font-light px-2 hidden sm:inline">|</span> <span className="text-lg font-sans font-normal text-theme-muted hidden sm:inline">Recent Works</span></h1>

        <div className="flex items-center gap-4">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted group-focus-within:text-theme-accent transition-colors" size={18} />
            <input
              type="text"
              placeholder="搜索作品..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 bg-theme-sidebar border border-theme-border focus:bg-white focus:border-theme-accent rounded-lg text-sm outline-none transition-all w-64 shadow-sm text-theme-text placeholder:text-theme-muted"
            />
          </div>
          <button
            onClick={() => setIsAdding(true)}
            className="natural-btn-primary flex items-center gap-2 px-5 py-2.5"
          >
            <Plus size={18} />
            <span>新作品</span>
          </button>
        </div>
      </div>

      {/* Empty state */}
      {novels.length === 0 && !isAdding && (
        <div className="h-full flex flex-col items-center justify-center p-8 text-center -mt-16">
          <BookMarked size={48} className="text-theme-muted/20 mb-6" />
          <h3 className="text-xl font-serif font-bold text-theme-text mb-2">还没有作品</h3>
          <p className="text-sm text-theme-muted mb-8 max-w-sm">
            创建一本新书开始写作，或者去灵感助手让 AI 帮你构思故事框架。
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
      {novels.length > 0 && (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
        {filteredNovels.map((novel) => {
            // Generate a deterministic gradient based on novel id
            const hues = [
              'from-rose-100 to-teal-50',
              'from-amber-100 to-indigo-50',
              'from-emerald-100 to-fuchsia-50',
              'from-sky-100 to-orange-50',
              'from-violet-100 to-lime-50'
            ];
            const hueIndex = (parseInt(novel.id.slice(-3)) || 0) % hues.length;
            const gradientClass = hues[hueIndex];

            return (
            <div
              key={novel.id}
              onClick={() => onSelectNovel(novel)}
              className="group relative h-[420px] bg-white rounded-[2.5rem] border border-theme-border p-6 overflow-hidden transition-all duration-500 hover:shadow-2xl hover:shadow-theme-accent/10 hover:-translate-y-1 cursor-pointer"
            >
              <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-all duration-300 z-10 flex gap-2 translate-y-2 group-hover:translate-y-0">
                <button
                  onClick={(e) => handleExportNovel(e, novel)}
                  className="p-2.5 bg-white/90 backdrop-blur rounded-xl text-theme-muted hover:text-theme-text hover:bg-white transition-all shadow-lg border border-theme-border/50"
                  title="导出全本 (TXT)"
                >
                  <Download size={16} />
                </button>
                <button
                  onClick={(e) => handleDeleteNovel(e, novel.id)}
                  className="p-2.5 bg-white/90 backdrop-blur rounded-xl text-theme-muted hover:text-red-600 hover:bg-red-50 transition-all shadow-lg border border-theme-border/50"
                  title="删除作品"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              {/* Enhanced Cover */}
              <div className={cn(
                "w-full h-52 rounded-3xl mb-6 flex flex-col items-center justify-center relative overflow-hidden group-hover:scale-[1.03] transition-transform duration-700 bg-gradient-to-br shadow-inner",
                gradientClass
              )}>
                <BookMarked size={56} className="text-theme-text/10 mb-2" />
                <div className="text-[10px] font-bold text-theme-text/20 uppercase tracking-[0.3em] font-serif">Inspiration Vault</div>
                <div className="absolute inset-0 bg-gradient-to-t from-white/40 to-transparent" />
                
                {/* Visual texture */}
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, black 1px, transparent 0)', backgroundSize: '24px 24px' }} />
              </div>

              <div className="flex flex-col h-[calc(100%-14.5rem)]">
                <h3 className="text-2xl font-serif font-bold text-theme-text line-clamp-2 leading-tight group-hover:text-theme-accent transition-colors">
                  {novel.title}
                </h3>

                <div className="flex items-center gap-3 mt-auto pt-5 border-t border-theme-border/30">
                  <div className="flex items-center gap-1.5 text-[10px] text-theme-muted uppercase tracking-widest font-bold">
                    <Clock size={12} className="opacity-50" />
                    <span>{new Date(novel.updatedAt).toLocaleDateString()}</span>
                  </div>
                  
                  {(() => {
                    const statusConfig = {
                      ongoing: { label: '连载中', color: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
                      completed: { label: '已完结', color: 'bg-blue-50 text-blue-700 border-blue-100' },
                      hiatus: { label: '断更', color: 'bg-amber-50 text-amber-700 border-amber-100' }
                    }[novel.status as keyof typeof statusConfig || 'ongoing'];
                    
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
              </div>
            </div>
            );
          })}

        {isAdding && (
          <div
            className="h-[420px] border-2 border-dashed border-theme-border rounded-[2.5rem] p-6 flex flex-col items-center justify-center text-center bg-theme-sidebar/10 group hover:border-theme-accent transition-colors"
          >
            <form onSubmit={handleCreateNovel} className="w-full px-4">
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm border border-theme-border group-hover:scale-110 transition-transform">
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
    </div>
  );
}
