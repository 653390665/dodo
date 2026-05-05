import React, { useState, useEffect } from 'react';
import { 
  Send, 
  Sparkles, 
  BrainCircuit, 
  Lightbulb,
  Eraser,
  Copy,
  Terminal,
  BookPlus,
  ArrowRight,
  FolderOpen,
  Globe,
  Loader2
} from 'lucide-react';
import { generateInspiration } from '../lib/gemini';
import { extractWorldSetupPhase } from '../lib/agents';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import ReactMarkdown from 'react-markdown';
import { listNovels, createChapter, createCharacter, createLocation, createItem } from '../lib/db';
import { Novel } from '../types';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface AIAssistantProps {
  onCreateNovel?: (idea: string) => void;
}

export function AIAssistant({ onCreateNovel }: AIAssistantProps = {}) {
  const [messages, setMessages] = useState<Message[]>([
    { 
      id: 'welcome', 
      role: 'assistant', 
      content: '你好，创作者！我是你的灵感助手。无论是想构思一个新的角色、设计一个意外的剧情转折，还是需要对现有片段进行润色，我都在这里随时待命。' 
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState<string | null>(null);
  const [showExtractModal, setShowExtractModal] = useState<string | null>(null);
  const [userNovels, setUserNovels] = useState<Novel[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);

  useEffect(() => {
    setUserNovels(listNovels());
  }, []);

  const handleSubmit = async (e?: React.FormEvent, customPrompt?: string) => {
    e?.preventDefault();
    const prompt = customPrompt || input;
    if (!prompt.trim() || isLoading) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: prompt };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const result = await generateInspiration(prompt);
      const aiMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: result || '未能生成灵感，请重试。' };
      setMessages(prev => [...prev, aiMsg]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveToNovel = (novel: Novel, content: string) => {
    const newChapId = Date.now().toString();
    createChapter({
      id: newChapId,
      title: '💡 灵感备忘录',
      content: content,
      wordCount: content.replace(/\s/g, '').length,
      order: 999,
      volumeName: '灵感碎片库',
      novelId: novel.id,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    alert(`已成功保存至《${novel.title}》的灵感碎片卷！`);
    setShowSaveModal(null);
  };

  const handleExtractToWorldBible = async (novel: Novel, content: string) => {
    setShowExtractModal(null);
    setIsExtracting(true);
    try {
      let extractedStr = await extractWorldSetupPhase(content);
      // Clean up markdown block if present
      extractedStr = extractedStr.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      const extracted = JSON.parse(extractedStr);
      const now = Date.now();

      let count = 0;
      if (extracted.characters) {
        for (const char of extracted.characters) {
           createCharacter({
             id: Date.now().toString(),
             novelId: novel.id,
             name: char.name,
             role: char.role || 'supporting',
             summary: char.summary || '',
             traits: char.traits || [],
             bio: char.bio || '',
             createdAt: now,
             updatedAt: now
           });
           count++;
        }
      }
      if (extracted.locations) {
        for (const loc of extracted.locations) {
           createLocation({
             id: Date.now().toString(),
             novelId: novel.id,
             name: loc.name,
             region: loc.region || '',
             description: loc.description || '',
             createdAt: now,
             updatedAt: now
           });
           count++;
        }
      }
      if (extracted.items) {
        for (const item of extracted.items) {
           createItem({
             id: Date.now().toString(),
             novelId: novel.id,
             name: item.name,
             type: item.type || '',
             description: item.description || '',
             createdAt: now,
             updatedAt: now
           });
           count++;
        }
      }

      alert(`AI 已成功解析出 ${count} 个设定项，并存储至《${novel.title}》的设定记忆中！您可前往「设定记忆」界面查看。`);
    } catch (e) {
      console.error(e);
      alert('提取设定失败，可能是内容不包含明确的角色/地点/物品设定格式，或者大语言模型返回了异常。');
    } finally {
      setIsExtracting(false);
    }
  };


  const suggestions = [
    { label: '脑洞风暴', prompt: '帮我构思三个独特的小说世界观背景。', icon: BrainCircuit },
    { label: '反转设计', prompt: '为一个侦探小说设计两个令人意想不到的结局大反转。', icon: Lightbulb },
    { label: '角色深度', prompt: '如何给一个性格孤僻的中年医生增加反差萌？', icon: Terminal },
    { label: '描写润色', prompt: '帮我润色一下这段描写：深夜的雨落在窗台上，他感到非常孤独。', icon: Sparkles },
  ];

  return (
    <div className="h-full flex flex-col bg-transparent">
      <div className="flex-1 overflow-y-auto px-6 py-12">
        <div className="max-w-3xl mx-auto space-y-8">
          {/* Header */}
          <div className="text-center mb-16">
            <div className="inline-flex p-4 bg-white rounded-3xl shadow-lg mb-6 border border-theme-border/30">
              <Sparkles className="text-theme-accent animate-pulse" size={32} />
            </div>
            <h1 className="text-4xl font-serif font-bold tracking-tight mb-2 text-theme-accent">灵感助手</h1>
            <p className="text-theme-muted text-[10px] tracking-[0.2em] uppercase font-bold">由 Gemini 3 系列旗舰模型驱动</p>
          </div>

          {/* Quick Suggestions */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
            {suggestions.map((s, idx) => (
              <button
                key={idx}
                onClick={() => handleSubmit(undefined, s.prompt)}
                className="flex flex-col items-center gap-3 p-6 bg-white rounded-3xl border border-theme-border/30 hover:border-theme-accent hover:shadow-xl transition-all group text-center active:scale-95 shadow-sm"
              >
                <div className="p-3 bg-theme-sidebar/30 group-hover:bg-theme-sidebar rounded-2xl transition-colors">
                  <s.icon size={20} className="text-theme-muted group-hover:text-theme-accent transition-colors" />
                </div>
                <span className="text-xs font-bold text-theme-muted group-hover:text-theme-text leading-tight">{s.label}</span>
              </button>
            ))}
          </div>

          {/* Chat Messages */}
          <div className="space-y-6 pb-12">
            {messages.map((msg) => (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                key={msg.id}
                className={cn(
                  "flex gap-4 p-6 rounded-[2rem] relative group",
                  msg.role === 'assistant' 
                    ? "bg-white shadow-sm border border-theme-border/40" 
                    : "bg-theme-accent text-white shadow-xl ml-auto max-w-[85%]"
                )}
              >
                {msg.role === 'assistant' && (
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 bg-theme-sidebar/40 text-theme-accent rounded-2xl flex items-center justify-center border border-theme-border/30">
                      <Sparkles size={20} />
                    </div>
                  </div>
                )}
                <div className="flex-1 overflow-hidden prose prose-sm max-w-none prose-sage">
                  {msg.role === 'assistant' ? (
                    <div className="text-theme-text leading-relaxed font-serif">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-white m-0 leading-relaxed font-sans">{msg.content}</p>
                  )}
                </div>
                {msg.role === 'assistant' && (
                  <div className="absolute top-4 right-4 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => setShowExtractModal(msg.id)}
                      className="p-2 text-theme-muted hover:text-theme-accent hover:bg-theme-sidebar/30 rounded-xl transition-all shadow-sm bg-white"
                      title="AI解析设定并导入世设定记忆"
                    >
                      <Globe size={14} />
                    </button>
                    <button 
                      onClick={() => setShowSaveModal(msg.id)}
                      className="p-2 text-theme-muted hover:text-theme-accent hover:bg-theme-sidebar/30 rounded-xl transition-all shadow-sm bg-white"
                      title="保存至作已有作品的灵感碎片库"
                    >
                      <FolderOpen size={14} />
                    </button>
                    {onCreateNovel && (
                      <button 
                        onClick={() => onCreateNovel(msg.content)}
                        className="p-2 text-theme-muted hover:text-theme-accent hover:bg-theme-sidebar/30 rounded-xl transition-all shadow-sm bg-white"
                        title="将此灵感转化为新作品"
                      >
                        <BookPlus size={14} />
                      </button>
                    )}
                    <button 
                      onClick={() => navigator.clipboard.writeText(msg.content)}
                      className="p-2 text-theme-muted hover:text-theme-accent hover:bg-theme-sidebar/30 rounded-xl transition-all shadow-sm bg-white"
                      title="复制"
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                )}
              </motion.div>
            ))}
            
            {isLoading && (
              <div className="flex gap-4 p-6 bg-white/50 border border-theme-border/30 rounded-[2rem] items-center">
                <div className="w-10 h-10 bg-theme-sidebar/40 rounded-2xl flex items-center justify-center">
                  <motion.div 
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  >
                    <Sparkles size={18} className="text-theme-accent" />
                  </motion.div>
                </div>
                <span className="text-sm font-serif italic text-theme-muted">正在编织灵感...</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Input Area */}
      <div className="p-8 bg-gradient-to-t from-theme-sidebar/20 to-transparent">
        <div className="max-w-3xl mx-auto relative group">
          <form 
            onSubmit={handleSubmit}
            className="flex items-center gap-2 p-2 bg-white rounded-full border-2 border-theme-border/30 focus-within:border-theme-accent transition-all shadow-xl"
          >
            <input 
              type="text" 
              placeholder="输入你的启发式问题或创作困惑..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="flex-1 pl-6 py-3 bg-transparent outline-none text-sm text-theme-text placeholder:text-theme-muted"
            />
            <button 
              type="button" 
              onClick={() => setMessages([messages[0]])}
              className="p-3 text-theme-muted hover:text-red-500 transition-colors"
              title="清空建议"
            >
              <Eraser size={20} />
            </button>
            <button 
              type="submit"
              disabled={isLoading}
              className="p-4 bg-theme-accent text-white rounded-full transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100 shadow-md"
            >
              <Send size={20} />
            </button>
          </form>
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 text-[10px] text-theme-muted font-bold uppercase tracking-widest opacity-0 group-focus-within:opacity-100 transition-opacity">
            按 Enter 发送，或 Shift+Enter 换行
          </div>
        </div>
      </div>

      {/* Save Modal */}
      <AnimatePresence>
        {showSaveModal && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm"
            onClick={() => setShowSaveModal(null)}
          >
            <motion.div 
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-3xl p-6 shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col"
            >
              <h3 className="text-xl font-bold font-serif mb-4 flex items-center gap-2">
                <FolderOpen size={20} className="text-theme-accent" />
                保存至作品
              </h3>
              <p className="text-xs text-theme-muted mb-4">选择一个作品，该灵感将作为「💡 灵感备忘录」新增至对应作品的灵感碎片库中。</p>
              
              <div className="flex-1 overflow-y-auto space-y-2 mb-4">
                {userNovels.length === 0 ? (
                  <div className="text-center p-8 text-sm text-theme-muted/50 border border-dashed rounded-xl">
                    你还没有创建过作品
                  </div>
                ) : (
                  userNovels.map(novel => (
                    <button
                      key={novel.id}
                      onClick={() => handleSaveToNovel(novel, messages.find(m => m.id === showSaveModal)?.content || '')}
                      className="w-full flex items-center justify-between p-4 bg-theme-sidebar/30 hover:bg-theme-sidebar rounded-xl border border-theme-border/50 hover:border-theme-accent transition-all text-left group"
                    >
                      <span className="font-bold text-sm text-theme-text group-hover:text-theme-accent transition-colors">{novel.title}</span>
                      <ArrowRight size={14} className="text-transparent group-hover:text-theme-accent transition-colors" />
                    </button>
                  ))
                )}
              </div>
              
              <button 
                onClick={() => setShowSaveModal(null)}
                className="w-full py-3 bg-theme-sidebar/80 text-theme-muted font-bold rounded-xl hover:bg-theme-sidebar transition-colors"
              >
                取消
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Extract Modal */}
      <AnimatePresence>
        {showExtractModal && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm"
            onClick={() => !isExtracting && setShowExtractModal(null)}
          >
            <motion.div 
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-3xl p-6 shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col relative overflow-hidden"
            >
              {isExtracting && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center">
                  <div className="w-16 h-16 bg-theme-accent/10 rounded-full flex items-center justify-center mb-4">
                    <Loader2 size={32} className="text-theme-accent animate-spin" />
                  </div>
                  <p className="font-bold text-theme-text font-serif">AI 正在结构化提取设定...</p>
                  <p className="text-xs text-theme-muted mt-2">预计需要 5~15 秒</p>
                </div>
              )}
              <h3 className="text-xl font-bold font-serif mb-4 flex items-center gap-2">
                <Globe size={20} className="text-theme-accent" />
                提取设定至作品
              </h3>
              <p className="text-xs text-theme-muted mb-4">选择一个作品，AI将自动提取当前卡片中的角色、地点、物品等结构化知识，并写入该作品的「设定记忆」库中。</p>
              
              <div className="flex-1 overflow-y-auto space-y-2 mb-4">
                {userNovels.length === 0 ? (
                  <div className="text-center p-8 text-sm text-theme-muted/50 border border-dashed rounded-xl">
                    你还没有创建过作品
                  </div>
                ) : (
                  userNovels.map(novel => (
                    <button
                      key={novel.id}
                      onClick={() => handleExtractToWorldBible(novel, messages.find(m => m.id === showExtractModal)?.content || '')}
                      className="w-full flex items-center justify-between p-4 bg-theme-sidebar/30 hover:bg-theme-sidebar rounded-xl border border-theme-border/50 hover:border-theme-accent transition-all text-left group"
                    >
                      <span className="font-bold text-sm text-theme-text group-hover:text-theme-accent transition-colors">{novel.title}</span>
                      <ArrowRight size={14} className="text-transparent group-hover:text-theme-accent transition-colors" />
                    </button>
                  ))
                )}
              </div>
              
              <button 
                onClick={() => setShowExtractModal(null)}
                className="w-full py-3 bg-theme-sidebar/80 text-theme-muted font-bold rounded-xl hover:bg-theme-sidebar transition-colors disabled:opacity-50"
                disabled={isExtracting}
              >
                取消
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
