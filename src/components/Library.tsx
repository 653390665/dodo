import React, { useState, useEffect } from 'react';
import {
  Plus,
  Search,
  MoreVertical,
  Trash2,
  BookMarked,
  Clock,
  Download
} from 'lucide-react';
import { listNovels, createNovel, deleteNovel, createChapter, listChapters, subscribeToChanges } from '../lib/api';
import { Novel, Chapter, ViewType } from '../types';
import { motion, AnimatePresence } from 'motion/react';

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
        <AnimatePresence mode="popLayout">
          {filteredNovels.map((novel) => (
            <motion.div
              layout
              key={novel.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={() => onSelectNovel(novel)}
              className="group relative h-[400px] natural-card p-6 overflow-hidden"
            >
              <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity z-10 flex gap-2">
                <button
                  onClick={(e) => handleExportNovel(e, novel)}
                  className="p-2 bg-white/90 backdrop-blur rounded-full text-theme-muted hover:text-theme-text hover:bg-theme-sidebar transition-all shadow-md"
                  title="导出全本 (TXT)"
                >
                  <Download size={16} />
                </button>
                <button
                  onClick={(e) => handleDeleteNovel(e, novel.id)}
                  className="p-2 bg-white/90 backdrop-blur rounded-full text-theme-muted hover:text-red-600 hover:bg-red-50 transition-all shadow-md"
                  title="删除作品"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              {/* Cover Placeholder */}
              <div className="w-full h-48 bg-theme-bg rounded-xl mb-6 flex items-center justify-center relative overflow-hidden group-hover:scale-[1.02] transition-transform duration-500">
                <BookMarked size={48} className="text-theme-border" />
                <div className="absolute inset-0 bg-gradient-to-t from-theme-accent/5 to-transparent" />
              </div>

              <div className="flex flex-col h-[calc(100%-12rem)]">
                <h3 className="text-xl font-serif font-bold mb-2 group-hover:text-theme-accent transition-colors">{novel.title}</h3>

                <div className="flex items-center gap-3 mt-auto pt-4 border-t border-theme-border/30">
                  <div className="flex items-center gap-1.5 text-[10px] text-theme-muted uppercase tracking-wider font-bold">
                    <Clock size={12} />
                    <span>{new Date(novel.updatedAt).toLocaleDateString()}</span>
                  </div>
                  <span className="ml-auto px-2 py-0.5 bg-theme-sidebar/60 text-theme-muted rounded text-[10px] font-bold uppercase tracking-widest border border-theme-border/30">
                    {novel.status === 'ongoing' ? '连载中' : novel.status === 'completed' ? '已完结' : '断更'}
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isAdding && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="h-[400px] border-2 border-dashed border-theme-border rounded-2xl p-6 flex flex-col items-center justify-center text-center bg-theme-sidebar/10"
          >
            <form onSubmit={handleCreateNovel} className="w-full px-4">
              <input
                autoFocus
                type="text"
                placeholder="作品标题"
                value={newNovelTitle}
                onChange={(e) => setNewNovelTitle(e.target.value)}
                className="w-full text-center bg-transparent border-b-2 border-theme-accent py-2 text-xl font-serif mb-6 outline-none text-theme-text placeholder:text-theme-muted"
              />
              <div className="flex gap-3 justify-center">
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="px-4 py-2 text-sm text-theme-muted hover:text-theme-accent font-medium font-serif"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="natural-btn-primary px-6"
                >
                  创建作品
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </div>
      )}
    </div>
  );
}
