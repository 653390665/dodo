import React, { useState, useEffect, useRef } from 'react';
import { 
  ChevronLeft, 
  Settings, 
  Save, 
  Plus, 
  Trash2,
  FileText,
  PanelRight,
  Maximize2,
  Minimize2,
  Cloud,
  Bot,
  Brain,
  MessageSquareWarning,
  Sparkles,
  Loader2,
  ListOrdered,
  Feather,
  History,
  Globe,
  Search
} from 'lucide-react';
import { Novel, Chapter, Character, Item, Location, ChapterVersion, Skill } from '../types';
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
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { editorAgentPhase, writerAgentPhase, criticAgentPhase, AgentContext, buildContextPrompt } from '../lib/agents';
import ReactMarkdown from 'react-markdown';


interface EditorViewProps {
  novel: Novel;
  onBack: () => void;
}

export function EditorView({ novel, onBack }: EditorViewProps) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [versions, setVersions] = useState<ChapterVersion[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAgentSidebarOpen, setIsAgentSidebarOpen] = useState(false);
  const [agentTab, setAgentTab] = useState<'planning' | 'quality' | 'trace' | 'bible'>('planning');
  const [bibleSearch, setBibleSearch] = useState('');
  const [isGeneratingBeats, setIsGeneratingBeats] = useState(false);
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const [isGeneratingCritique, setIsGeneratingCritique] = useState(false);
  const [userIntent, setUserIntent] = useState('');
  
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

  useEffect(() => {
    const qChars = query(collection(db, 'characters'), where('novelId', '==', novel.id));
    const unsubscribeChars = onSnapshot(qChars, (snapshot) => {
      setCharacters(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Character)));
    });

    const qLocs = query(collection(db, 'locations'), where('novelId', '==', novel.id));
    const unsubscribeLocs = onSnapshot(qLocs, (snapshot) => {
      setLocations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Location)));
    });

    const qItems = query(collection(db, 'items'), where('novelId', '==', novel.id));
    const unsubscribeItems = onSnapshot(qItems, (snapshot) => {
      setItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item)));
    });

    return () => {
      unsubscribeChars();
      unsubscribeLocs();
      unsubscribeItems();
    };
  }, [novel.id]);

  useEffect(() => {
    if (!currentChapter) {
      setVersions([]);
      return;
    }
    const qVersions = query(
      collection(db, `chapters/${currentChapter.id}/versions`),
      orderBy('createdAt', 'desc')
    );
    const unsubscribeVers = onSnapshot(qVersions, (snapshot) => {
      setVersions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ChapterVersion)));
    });
    return unsubscribeVers;
  }, [currentChapter?.id]);

  const handleSaveVersion = async (author: 'user' | 'writer-agent' | 'editor-agent' | 'auto') => {
    if (!currentChapter) return;
    try {
      const versionsRef = collection(db, `chapters/${currentChapter.id}/versions`);
      await addDoc(versionsRef, {
        chapterId: currentChapter.id,
        content: currentChapter.content,
        wordCount: currentChapter.wordCount,
        author,
        createdAt: Date.now()
      });
    } catch (e) {
      console.error('Failed to save version snapshot', e);
    }
  };

  const handleRestoreVersion = (version: ChapterVersion) => {
    if (!confirm('确定要回滚到此版本吗？这将覆盖当前正文内容！')) return;
    handleUpdateContent(version.content);
  };

  const handleGenerateBeats = async () => {
    if (!currentChapter) return;
    setIsGeneratingBeats(true);
    try {
      const context: AgentContext = { novel, characters, locations, items };
      const beats = await editorAgentPhase(userIntent || `关于章节「${currentChapter.title}」的大纲`, context);
      
      const updated = { ...currentChapter, sceneBeats: beats };
      setCurrentChapter(updated);
      await updateDoc(doc(db, 'chapters', currentChapter.id), { sceneBeats: beats });
      setUserIntent('');
    } catch (error) {
      console.error(error);
      alert('生成分镜失败：' + (error as Error).message);
    } finally {
      setIsGeneratingBeats(false);
    }
  };

  const handleGenerateContent = async () => {
    if (!currentChapter || !currentChapter.sceneBeats) return;
    setIsGeneratingContent(true);
    let originalWordCount = currentChapter.wordCount;
    const baseContent = currentChapter.content ? currentChapter.content + '\n\n' : '';
    let currentStreamedText = '';
    let lastCritique = '';

    try {
      // Fetch skills directly from Firestore
      const skillsSnap = await getDocs(collection(db, 'skills'));
      const activeSkills = skillsSnap.docs.map(d => d.data() as Skill);

      const context: AgentContext = { novel, characters, locations, items };
      const contextStr = buildContextPrompt(context);

      const response = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contextStr,
          sceneBeats: currentChapter.sceneBeats,
          skills: activeSkills,
          maxIterations: 2,
          draftContent: ""
        })
      });

      if (!response.body) throw new Error("No response body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunkStr = decoder.decode(value, { stream: true });
        
        // SSE responses can have multiple lines of "data: {...}\n\n"
        const messages = chunkStr.split('\\n\\n').filter(Boolean);
        for (const msg of messages) {
          if (msg.startsWith('data: ')) {
            const dataStr = msg.replace('data: ', '');
            try {
              const data = JSON.parse(dataStr);
              if (data.type === 'token') {
                currentStreamedText += data.content;
                const fullText = baseContent + currentStreamedText;
                
                // Optimistically update purely the UI so we see it appearing
                setCurrentChapter(prev => prev ? { 
                  ...prev, 
                  content: fullText,
                  wordCount: fullText.replace(/\\s/g, '').length
                } : null);

                // Scroll to bottom
                if (contentRef.current) {
                  contentRef.current.scrollTop = contentRef.current.scrollHeight;
                }
              } else if (data.type === 'critic_done') {
                console.log("Critic feedback:", data.feedback, "IsValid:", data.isValid);
                lastCritique = data.feedback;
                // Also save it locally to the chapter object so the side panel shows it
                setCurrentChapter(prev => prev ? { ...prev, critique: data.feedback } : null);
              } else if (data.type === 'error') {
                console.error("Orchestration error:", data.message);
              }
            } catch (e) {
              // Ignore incomplete JSON chunks boundary issues
            }
          }
        }
      }

      // Final save when done
      const fullText = baseContent + currentStreamedText;
      const finalWordCount = fullText.replace(/\\s/g, '').length;
      
      setCurrentChapter(prev => prev ? { 
        ...prev, 
        content: fullText,
        wordCount: finalWordCount,
        ...(lastCritique && { critique: lastCritique })
      } : null);

      await updateDoc(doc(db, 'chapters', currentChapter.id), { 
        content: fullText,
        wordCount: finalWordCount,
        ...(lastCritique && { critique: lastCritique })
      });
      
      // Save AI result as version
      const versionsRef = collection(db, `chapters/${currentChapter.id}/versions`);
      await addDoc(versionsRef, {
        chapterId: currentChapter.id,
        content: fullText,
        wordCount: finalWordCount,
        author: 'writer-agent',
        createdAt: Date.now()
      });

    } catch (error) {
      console.error(error);
      alert('生成正文失败：' + (error as Error).message);
    } finally {
      setIsGeneratingContent(false);
    }
  };

  const handleGenerateCritique = async () => {
    if (!currentChapter || !currentChapter.content.trim()) {
      alert("请先编写一些正文内容");
      return;
    }
    setIsGeneratingCritique(true);
    try {
      const context: AgentContext = { novel, characters, locations, items };
      const critique = await criticAgentPhase(currentChapter.content, context);
      
      const updated = { ...currentChapter, critique };
      setCurrentChapter(updated);
      await updateDoc(doc(db, 'chapters', currentChapter.id), { critique });
    } catch (error) {
      console.error(error);
      alert('生成批注失败：' + (error as Error).message);
    } finally {
      setIsGeneratingCritique(false);
    }
  };

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
              onClick={() => setIsAgentSidebarOpen(!isAgentSidebarOpen)}
              className={cn(
                "p-2 rounded-lg transition-colors",
                isAgentSidebarOpen 
                  ? "bg-sage-accent text-white" 
                  : "hover:bg-sage-border/50 text-sage-muted"
              )}
              title="智能助理"
            >
              <Bot size={18} />
            </button>
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

      {/* Agent Sidebar */}
      <AnimatePresence initial={false}>
        {!isFullscreen && isAgentSidebarOpen && (
          <motion.div 
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 340, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="flex flex-col border-l border-sage-border bg-gradient-to-b from-sage-bg to-white overflow-hidden shadow-[-10px_0_30px_rgba(0,0,0,0.02)] z-20"
          >
            {/* Tabs */}
            <div className="flex p-2 gap-1 border-b border-sage-border/50 bg-white/50 backdrop-blur sticky top-0 z-10 shrink-0">
              <button 
                onClick={() => setAgentTab('planning')}
                className={cn(
                  "flex-1 py-2 px-1 rounded-md text-[10px] font-bold transition-all flex items-center justify-center gap-1",
                  agentTab === 'planning' 
                    ? "bg-sage-accent text-white shadow-sm" 
                    : "text-sage-muted hover:bg-sage-sidebar/50 hover:text-sage-text"
                )}
              >
                <Brain size={12} /> 规划
              </button>
              <button 
                onClick={() => setAgentTab('quality')}
                className={cn(
                  "flex-1 py-2 px-1 rounded-md text-[10px] font-bold transition-all flex items-center justify-center gap-1",
                  agentTab === 'quality' 
                    ? "bg-sage-accent text-white shadow-sm" 
                    : "text-sage-muted hover:bg-sage-sidebar/50 hover:text-sage-text"
                )}
              >
                <MessageSquareWarning size={12} /> 质量
              </button>
              <button 
                onClick={() => setAgentTab('trace')}
                className={cn(
                  "flex-[0.8] py-2 px-1 rounded-md text-[10px] font-bold transition-all flex items-center justify-center gap-1",
                  agentTab === 'trace' 
                    ? "bg-sage-accent text-white shadow-sm" 
                    : "text-sage-muted hover:bg-sage-sidebar/50 hover:text-sage-text"
                )}
              >
                <History size={12} /> 追踪
              </button>
              <button 
                onClick={() => setAgentTab('bible')}
                className={cn(
                  "flex-1 py-2 px-1 rounded-md text-[10px] font-bold transition-all flex items-center justify-center gap-1",
                  agentTab === 'bible' 
                    ? "bg-sage-accent text-white shadow-sm" 
                    : "text-sage-muted hover:bg-sage-sidebar/50 hover:text-sage-text"
                )}
              >
                <Globe size={12} /> 记忆库
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 scroll-smooth">
              <AnimatePresence mode="wait">
                {agentTab === 'planning' ? (
                  <motion.div 
                    key="planning"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-6"
                  >
                    <div className="space-y-4">
                      <div className="bg-sage-sidebar/30 p-4 rounded-2xl border border-sage-border/50">
                        <h3 className="text-xs font-bold text-sage-text mb-2 flex items-center gap-2">
                          <ListOrdered size={14} className="text-sage-accent" />
                          创作意图
                        </h3>
                        <textarea
                          value={userIntent}
                          onChange={(e) => setUserIntent(e.target.value)}
                          placeholder="描述这一章你想写什么，比如：主角在酒馆偶遇了女二..."
                          className="w-full h-24 bg-white border border-sage-border/50 rounded-xl p-3 text-sm text-sage-text placeholder:text-sage-muted/60 outline-none focus:border-sage-accent transition-all resize-none shadow-sm"
                        />
                        <button 
                          onClick={handleGenerateBeats}
                          disabled={isGeneratingBeats || !currentChapter}
                          className="w-full mt-3 py-2.5 bg-sage-accent text-white rounded-xl text-sm font-bold shadow-sm hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {isGeneratingBeats ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                          {isGeneratingBeats ? '规划中...' : '生成场景分镜'}
                        </button>
                      </div>

                      {currentChapter?.sceneBeats && (
                        <div className="space-y-3">
                          <div className="prose prose-sm prose-sage prose-p:leading-relaxed max-w-none bg-white p-5 rounded-2xl border border-sage-border/40 shadow-sm relative overflow-hidden group">
                            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={handleGenerateContent}
                                disabled={isGeneratingContent}
                                className="p-2 bg-sage-accent text-white rounded-lg shadow-sm hover:opacity-90 disabled:opacity-50"
                                title="AI 扩写正文"
                              >
                                {isGeneratingContent ? <Loader2 size={14} className="animate-spin" /> : <Feather size={14} />}
                              </button>
                            </div>
                            <ReactMarkdown>{currentChapter.sceneBeats}</ReactMarkdown>
                          </div>
                          
                          {isGeneratingContent && (
                            <div className="flex items-center justify-center p-4 bg-sage-sidebar/20 rounded-xl border border-sage-border/30 text-xs text-sage-muted gap-2">
                              <Loader2 size={14} className="animate-spin" /> Writer Agent 正在执笔中...
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                ) : agentTab === 'quality' ? (
                  <motion.div 
                    key="quality"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-6"
                  >
                     <div className="bg-sage-sidebar/30 p-4 rounded-2xl border border-sage-border/50 flex flex-col items-center justify-center text-center">
                        <Bot size={32} className="text-sage-accent mb-3 opacity-80" />
                        <h3 className="text-sm font-bold text-sage-text mb-1">AI 批判性阅读</h3>
                        <p className="text-xs text-sage-muted mb-4 max-w-[200px]">审查当前章节的逻辑漏洞、人物OOC及节奏问题。</p>
                        <button 
                          onClick={handleGenerateCritique}
                          disabled={isGeneratingCritique || !currentChapter}
                          className="w-full py-2.5 bg-sage-accent text-white rounded-xl text-sm font-bold shadow-sm hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {isGeneratingCritique ? <Loader2 size={16} className="animate-spin" /> : <MessageSquareWarning size={16} />}
                          {isGeneratingCritique ? '审阅中...' : '开始全局审查'}
                        </button>
                     </div>

                     {currentChapter?.critique && (
                        <div className="prose prose-sm prose-sage prose-p:leading-relaxed max-w-none bg-red-50/50 p-5 rounded-2xl border border-red-100 shadow-sm">
                          <ReactMarkdown>{currentChapter.critique}</ReactMarkdown>
                        </div>
                      )}
                  </motion.div>
                ) : agentTab === 'bible' ? (
                  <motion.div 
                    key="bible"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-4"
                  >
                     <div className="sticky top-0 bg-white/50 backdrop-blur z-10 pb-2">
                       <div className="relative">
                         <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-sage-muted" size={14} />
                         <input 
                           type="text" 
                           placeholder="检索角色、地点、道具..." 
                           value={bibleSearch}
                           onChange={e => setBibleSearch(e.target.value)}
                           className="w-full pl-9 pr-4 py-2 bg-white border border-sage-border/50 rounded-xl text-sm placeholder:text-sage-muted/50 focus:border-sage-accent outline-none shadow-sm transition-all"
                         />
                       </div>
                     </div>
                     <div className="space-y-3 pb-8">
                       {/* Characters */}
                       {characters.filter(c => c.name.includes(bibleSearch) || c.summary.includes(bibleSearch)).map(char => (
                         <div key={char.id} className="bg-white p-4 rounded-xl border border-sage-border/40 shadow-sm transition-hover hover:border-sage-accent/50">
                           <div className="flex items-center gap-2 mb-1.5">
                             <div className="text-sm font-bold text-sage-text">{char.name}</div>
                             <div className="text-[10px] bg-sage-sidebar px-1.5 py-0.5 rounded text-sage-muted font-medium tracking-wide">角色 - {char.role}</div>
                           </div>
                           <div className="text-xs font-semibold text-sage-accent mb-2">{char.summary}</div>
                           {char.bio && <div className="text-xs text-sage-muted/80 leading-relaxed whitespace-pre-wrap">{char.bio}</div>}
                         </div>
                       ))}
                       {/* Locations */}
                       {locations.filter(l => l.name.includes(bibleSearch) || l.description.includes(bibleSearch)).map(loc => (
                         <div key={loc.id} className="bg-white p-4 rounded-xl border border-sage-border/40 shadow-sm transition-hover hover:border-sage-accent/50">
                           <div className="flex items-center gap-2 mb-1.5">
                             <div className="text-sm font-bold text-sage-text">{loc.name}</div>
                             <div className="text-[10px] bg-sage-sidebar px-1.5 py-0.5 rounded text-sage-muted font-medium tracking-wide">地点</div>
                           </div>
                           <div className="text-xs font-semibold text-sage-accent mb-2">{loc.region}</div>
                           {loc.description && <div className="text-xs text-sage-muted/80 leading-relaxed whitespace-pre-wrap">{loc.description}</div>}
                         </div>
                       ))}
                       {/* Items */}
                       {items.filter(i => i.name.includes(bibleSearch) || i.description.includes(bibleSearch)).map(item => (
                         <div key={item.id} className="bg-white p-4 rounded-xl border border-sage-border/40 shadow-sm transition-hover hover:border-sage-accent/50">
                           <div className="flex items-center gap-2 mb-1.5">
                             <div className="text-sm font-bold text-sage-text">{item.name}</div>
                             <div className="text-[10px] bg-sage-sidebar px-1.5 py-0.5 rounded text-sage-muted font-medium tracking-wide">道具</div>
                           </div>
                           <div className="text-xs font-semibold text-sage-accent mb-2">{item.type}</div>
                           {item.description && <div className="text-xs text-sage-muted/80 leading-relaxed whitespace-pre-wrap">{item.description}</div>}
                         </div>
                       ))}
                       {(characters.length === 0 && locations.length === 0 && items.length === 0) && (
                         <div className="text-center text-xs text-sage-muted opacity-60 p-4 border border-dashed border-sage-border/50 rounded-xl">
                           暂无设定数据，请前往书库添加
                         </div>
                       )}
                     </div>
                  </motion.div>
                ) : (
                   <motion.div 
                    key="trace"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-6"
                  >
                     <div className="bg-sage-sidebar/30 p-4 rounded-2xl border border-sage-border/50 flex flex-col items-center justify-center text-center">
                        <History size={32} className="text-sage-accent mb-3 opacity-80" />
                        <h3 className="text-sm font-bold text-sage-text mb-1">追踪台 (Trace)</h3>
                        <p className="text-xs text-sage-muted mb-4 max-w-[200px]">记录每一次写作与 AI 生成的历史快照。</p>
                        
                        <button 
                          onClick={() => handleSaveVersion('user')}
                          disabled={!currentChapter || !currentChapter.content}
                          className="w-full mb-6 py-2.5 bg-sage-text text-white rounded-xl text-sm font-bold shadow-md hover:bg-sage-text/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          <Save size={16} /> 保存当前快照
                        </button>
                        
                        <div className="w-full text-left space-y-3">
                          {versions.length === 0 ? (
                            <div className="text-center text-xs text-sage-muted opacity-60 p-4 border border-dashed border-sage-border/50 rounded-xl">
                              暂无快照记录
                            </div>
                          ) : (
                            versions.map(v => (
                              <div key={v.id} className="bg-white rounded-xl p-4 border border-sage-border/40 shadow-sm relative group">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-bold text-sage-text flex items-center gap-1.5">
                                    {v.author === 'writer-agent' ? <Bot size={12} className="text-sage-accent" /> : <Feather size={12} className="text-sage-muted" />}
                                    {v.author === 'writer-agent' ? 'AI 扩写版本' : '用户存档'}
                                  </span>
                                  <span className="text-[10px] text-sage-muted font-mono">{new Date(v.createdAt).toLocaleString()}</span>
                                </div>
                                <p className="text-xs text-sage-muted mb-2">字数：{v.wordCount}</p>
                                <div className="h-px w-full bg-sage-border/30 my-3" />
                                <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => handleRestoreVersion(v)} className="text-xs text-sage-accent hover:underline">一键回滚覆盖</button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                     </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
