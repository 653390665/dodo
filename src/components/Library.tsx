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
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  updateDoc,
  orderBy,
  getDocs
} from 'firebase/firestore';
import { db, OperationType, handleFirestoreError } from '../lib/firebase';
import { Novel, Chapter } from '../types';
import { motion, AnimatePresence } from 'motion/react';

interface LibraryProps {
  onSelectNovel: (novel: Novel) => void;
  userId: string;
}

export function Library({ onSelectNovel, userId }: LibraryProps) {
  const [novels, setNovels] = useState<Novel[]>([]);
  const [search, setSearch] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newNovelTitle, setNewNovelTitle] = useState('');

  useEffect(() => {
    const q = query(
      collection(db, 'novels'), 
      where('authorId', '==', userId),
      orderBy('updatedAt', 'desc')
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Novel));
      setNovels(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'novels');
    });

    return unsubscribe;
  }, [userId]);

  const handleCreateNovel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNovelTitle.trim()) return;

    try {
      await addDoc(collection(db, 'novels'), {
        title: newNovelTitle,
        authorId: userId,
        summary: '',
        status: 'ongoing',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      setNewNovelTitle('');
      setIsAdding(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'novels');
    }
  };

  const handleDeleteNovel = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('确定要删除这部作品吗？此操作不可逆。')) return;

    try {
      await deleteDoc(doc(db, 'novels', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `novels/${id}`);
    }
  };

  const handleExportNovel = async (e: React.MouseEvent, novel: Novel) => {
    e.stopPropagation();
    try {
      const q = query(
        collection(db, 'chapters'), 
        where('novelId', '==', novel.id),
        orderBy('order', 'asc')
      );
      const snapshot = await getDocs(q);
      const chapters = snapshot.docs.map(doc => doc.data() as Chapter);
      
      let exportText = `# ${novel.title}\n\n`;
      if (novel.summary) exportText += `【简介】\n${novel.summary}\n\n`;
      if (novel.globalOutline) exportText += `【大纲】\n${novel.globalOutline}\n\n`;
      
      exportText += `==============================\n\n`;
      
      chapters.forEach(ch => {
         exportText += `## ${ch.title}\n\n`;
         exportText += `${ch.content || ''}\n\n`;
      });
      
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
    <div className="h-full flex flex-col p-8 overflow-y-auto bg-sage-bg">
      {/* Search & Actions Header */}
      <div className="flex items-center justify-between mb-12">
        <h1 className="text-4xl font-serif font-semibold tracking-tight text-sage-accent">我的书库</h1>
        
        <div className="flex items-center gap-4">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-sage-muted group-focus-within:text-sage-accent transition-colors" size={18} />
            <input 
              type="text" 
              placeholder="搜索作品..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 bg-sage-sidebar/50 border border-transparent focus:bg-white focus:border-sage-border rounded-full text-sm outline-none transition-all w-64 shadow-sm text-sage-text placeholder:text-sage-muted"
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

      {/* Grid of Novels */}
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
                  className="p-2 bg-white/90 backdrop-blur rounded-full text-sage-muted hover:text-sage-text hover:bg-sage-sidebar transition-all shadow-md"
                  title="导出全本 (TXT)"
                >
                  <Download size={16} />
                </button>
                <button 
                  onClick={(e) => handleDeleteNovel(e, novel.id)}
                  className="p-2 bg-white/90 backdrop-blur rounded-full text-sage-muted hover:text-red-600 hover:bg-red-50 transition-all shadow-md"
                  title="删除作品"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              {/* Cover Placeholder */}
              <div className="w-full h-48 bg-sage-sidebar/30 rounded-xl mb-6 flex items-center justify-center relative overflow-hidden group-hover:scale-[1.02] transition-transform duration-500">
                <BookMarked size={48} className="text-sage-border" />
                <div className="absolute inset-0 bg-gradient-to-t from-sage-accent/5 to-transparent" />
              </div>

              <div className="flex flex-col h-[calc(100%-12rem)]">
                <h3 className="text-xl font-serif font-bold mb-2 group-hover:text-sage-accent transition-colors">{novel.title}</h3>
                <p className="text-sage-muted text-sm line-clamp-3 mb-auto italic">
                  {novel.summary || '暂无作品简介。点击开始创作，书写你的传奇。'}
                </p>
                
                <div className="flex items-center gap-3 mt-4 pt-4 border-t border-sage-border/30">
                  <div className="flex items-center gap-1.5 text-[10px] text-sage-muted uppercase tracking-wider font-bold">
                    <Clock size={12} />
                    <span>{new Date(novel.updatedAt).toLocaleDateString()}</span>
                  </div>
                  <span className="ml-auto px-2 py-0.5 bg-sage-sidebar/60 text-sage-muted rounded text-[10px] font-bold uppercase tracking-widest border border-sage-border/30">
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
            className="h-[400px] border-2 border-dashed border-sage-border rounded-2xl p-6 flex flex-col items-center justify-center text-center bg-sage-sidebar/10"
          >
            <form onSubmit={handleCreateNovel} className="w-full px-4">
              <input 
                autoFocus
                type="text" 
                placeholder="作品标题"
                value={newNovelTitle}
                onChange={(e) => setNewNovelTitle(e.target.value)}
                className="w-full text-center bg-transparent border-b-2 border-sage-accent py-2 text-xl font-serif mb-6 outline-none text-sage-text placeholder:text-sage-muted"
              />
              <div className="flex gap-3 justify-center">
                <button 
                  type="button" 
                  onClick={() => setIsAdding(false)}
                  className="px-4 py-2 text-sm text-sage-muted hover:text-sage-accent font-medium font-serif"
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
    </div>
  );
}
