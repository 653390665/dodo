import React, { useState, useEffect, useRef } from 'react';
import { 
  ChevronLeft, 
  MoreHorizontal, 
  Settings, 
  Save, 
  Plus, 
  Trash2,
  FileText,
  PanelRight,
  Maximize2,
  Minimize2,
  Cloud
} from 'lucide-react';
import { Novel, Chapter } from '../types';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  updateDoc,
  orderBy
} from 'firebase/firestore';
import { db, OperationType, handleFirestoreError } from '../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface EditorViewProps {
  novel: Novel;
  onBack: () => void;
}

export function EditorView({ novel, onBack }: EditorViewProps) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'chapters'), 
      where('novelId', '==', novel.id),
      orderBy('order', 'asc')
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Chapter));
      setChapters(data);
      if (!currentChapter && data.length > 0) {
        setCurrentChapter(data[0]);
      }
    });

    return unsubscribe;
  }, [novel.id]);

  const handleAddChapter = async () => {
    const newOrder = chapters.length + 1;
    try {
      const docRef = await addDoc(collection(db, 'chapters'), {
        novelId: novel.id,
        title: `第 ${newOrder} 章`,
        content: '',
        order: newOrder,
        wordCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Optionally switch to new chapter immediately
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'chapters');
    }
  };

  const handleUpdateContent = (newContent: string) => {
    if (!currentChapter) return;
    
    // Optimistic update for UI
    const updatedChapter = { ...currentChapter, content: newContent };
    setCurrentChapter(updatedChapter);
    
    // Debounced sync to Firebase
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    
    setIsSyncing(true);
    syncTimeoutRef.current = setTimeout(async () => {
      try {
        await updateDoc(doc(db, 'chapters', currentChapter.id), {
          content: newContent,
          updatedAt: Date.now(),
          wordCount: newContent.replace(/\s/g, '').length
        });
        setIsSyncing(false);
      } catch (error) {
        setIsSyncing(false);
        handleFirestoreError(error, OperationType.UPDATE, `chapters/${currentChapter.id}`);
      }
    }, 1000);
  };

  const handleDeleteChapter = async (id: string) => {
    if (!confirm('确定要删除这一章吗？')) return;
    try {
      await deleteDoc(doc(db, 'chapters', id));
      if (currentChapter?.id === id) {
        setCurrentChapter(chapters.find(c => c.id !== id) || null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `chapters/${id}`);
    }
  };

  return (
    <div className={cn(
      "h-full flex overflow-hidden transition-all duration-700",
      isFullscreen ? "fixed inset-0 z-[100] bg-parchment" : "bg-white"
    )}>
      {/* Chapter List Sidebar */}
      <AnimatePresence initial={false}>
        {!isFullscreen && isSidebarOpen && (
          <motion.div 
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="flex flex-col border-r border-sage-border bg-sage-sidebar/30 overflow-hidden"
          >
            <div className="p-4 border-b border-sage-border bg-white/50 backdrop-blur sticky top-0 z-10 flex items-center justify-between">
              <button 
                onClick={onBack}
                className="p-2 hover:bg-sage-border rounded-lg text-sage-muted transition-colors"
                title="返回书库"
              >
                <ChevronLeft size={18} />
              </button>
              <h2 className="text-sm font-bold uppercase tracking-widest text-sage-muted truncate max-w-[120px]">{novel.title}</h2>
              <button 
                onClick={handleAddChapter}
                className="p-2 hover:opacity-90 bg-sage-accent text-white rounded-lg transition-all"
                title="新建章节"
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {chapters.map((chapter) => (
                <div 
                  key={chapter.id}
                  onClick={() => setCurrentChapter(chapter)}
                  className={cn(
                    "group px-4 py-3 rounded-xl cursor-pointer transition-all flex items-center justify-between",
                    currentChapter?.id === chapter.id 
                      ? "bg-white shadow-sm border border-sage-border text-sage-text" 
                      : "text-sage-muted hover:bg-sage-border/40"
                  )}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium truncate">{chapter.title}</span>
                    <span className="text-[10px] opacity-60 uppercase tracking-tighter">
                      {chapter.wordCount} 字 · {new Date(chapter.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleDeleteChapter(chapter.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-600 transition-opacity"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Editor Content Area */}
      <div className={cn(
        "flex-1 flex flex-col relative overflow-hidden transition-colors duration-500",
        isFullscreen ? "bg-parchment" : "bg-paper"
      )}>
        {/* Editor Toolbar */}
        <div className={cn(
          "h-14 px-6 border-b flex items-center justify-between transition-all duration-500 z-10",
          isFullscreen 
            ? "bg-transparent border-transparent opacity-0 hover:opacity-100" 
            : "bg-white/80 backdrop-blur border-sage-border/50"
        )}>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-sage-border/50 rounded-lg text-sage-muted"
            >
              <PanelRight size={18} className={cn(!isSidebarOpen && "rotate-180")} />
            </button>
            <div className="h-4 w-px bg-sage-border/50" />
            <input 
              type="text"
              value={currentChapter?.title || ''}
              onChange={(e) => {
                if (!currentChapter) return;
                const newTitle = e.target.value;
                setCurrentChapter({ ...currentChapter, title: newTitle });
                updateDoc(doc(db, 'chapters', currentChapter.id), { title: newTitle });
              }}
              className="bg-transparent border-none outline-none font-serif text-lg font-medium focus:ring-0 w-64 text-sage-text"
              placeholder="章节标题"
            />
          </div>

          <div className="flex items-center gap-3">
            <AnimatePresence>
              {isSyncing && (
                <motion.div 
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 text-xs text-sage-muted mr-2 font-mono"
                >
                  <Cloud size={14} className="animate-pulse" />
                  保存中...
                </motion.div>
              )}
            </AnimatePresence>
            <button 
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 hover:bg-sage-border/50 rounded-lg text-sage-muted transition-colors"
              title="全屏模式"
            >
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            <button className="p-2 hover:bg-sage-border/50 rounded-lg text-sage-muted">
              <Settings size={18} />
            </button>
          </div>
        </div>

        {/* Writing Surface */}
        <div className="flex-1 overflow-y-auto px-4 md:px-12 py-16 scroll-smooth">
          <div className="max-w-4xl mx-auto min-h-full">
            {currentChapter ? (
              <textarea
                ref={contentRef}
                value={currentChapter.content}
                onChange={(e) => handleUpdateContent(e.target.value)}
                placeholder="在此开始书写..."
                className="w-full h-full min-h-[70vh] bg-transparent border-none outline-none resize-none writing-surface text-sage-text placeholder:text-sage-muted/50 transition-all font-serif"
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-sage-muted opacity-30">
                <FileText size={64} strokeWidth={1} className="mb-4" />
                <p>点击左侧“+”号创建新章节开始创作</p>
              </div>
            )}
          </div>
        </div>

        {/* Word Counter & Status */}
        <div className="h-10 px-6 border-t border-sage-border/50 flex items-center justify-between bg-white text-[10px] font-bold uppercase tracking-widest text-sage-muted">
          <div className="flex items-center gap-6">
            <span>字数: {currentChapter?.wordCount || 0}</span>
            <span>更新: {currentChapter ? new Date(currentChapter.updatedAt).toLocaleTimeString() : '-'}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-600 shadow-[0_0_5px_rgba(22,163,74,0.3)]" />
            云同步已就绪
          </div>
        </div>
      </div>
    </div>
  );
}
