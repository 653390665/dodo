import React, { useState } from 'react';
import { 
  Send, 
  Sparkles, 
  BrainCircuit, 
  MessageCircle, 
  Lightbulb,
  Eraser,
  Copy,
  Terminal
} from 'lucide-react';
import { generateInspiration } from '../lib/gemini';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  type?: 'brainstorm' | 'critique' | 'detail';
}

export function AIAssistant() {
  const [messages, setMessages] = useState<Message[]>([
    { 
      id: 'welcome', 
      role: 'assistant', 
      content: '你好，创作者！我是你的灵感助手。无论是想构思一个新的角色、设计一个意外的剧情转折，还是需要对现有片段进行润色，我都在这里随时待命。' 
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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

  const suggestions = [
    { label: '脑洞风暴', prompt: '帮我构思三个独特的小说世界观背景。', icon: BrainCircuit },
    { label: '反转设计', prompt: '为一个侦探小说设计两个令人意想不到的结局大反转。', icon: Lightbulb },
    { label: '角色深度', prompt: '如何给一个性格孤僻的中年医生增加反差萌？', icon: Terminal },
    { label: '描写润色', prompt: '帮我润色一下这段描写：深夜的雨落在窗台上，他感到非常孤独。', icon: Sparkles },
  ];

  return (
    <div className="h-full flex flex-col bg-sage-bg shadow-inner">
      <div className="flex-1 overflow-y-auto px-6 py-12">
        <div className="max-w-3xl mx-auto space-y-8">
          {/* Header */}
          <div className="text-center mb-16">
            <div className="inline-flex p-4 bg-white rounded-3xl shadow-lg mb-6 border border-sage-border/30">
              <Sparkles className="text-sage-accent animate-pulse" size={32} />
            </div>
            <h1 className="text-4xl font-serif font-bold tracking-tight mb-2 text-sage-accent">灵感助手</h1>
            <p className="text-sage-muted text-[10px] tracking-[0.2em] uppercase font-bold">由 Gemini 3 系列旗舰模型驱动</p>
          </div>

          {/* Quick Suggestions */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
            {suggestions.map((s, idx) => (
              <button
                key={idx}
                onClick={() => handleSubmit(undefined, s.prompt)}
                className="flex flex-col items-center gap-3 p-6 bg-white rounded-3xl border border-sage-border/30 hover:border-sage-accent hover:shadow-xl transition-all group text-center active:scale-95 shadow-sm"
              >
                <div className="p-3 bg-sage-sidebar/30 group-hover:bg-sage-sidebar rounded-2xl transition-colors">
                  <s.icon size={20} className="text-sage-muted group-hover:text-sage-accent transition-colors" />
                </div>
                <span className="text-xs font-bold text-sage-muted group-hover:text-sage-text leading-tight">{s.label}</span>
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
                  "flex gap-4 p-6 rounded-[2rem] relative",
                  msg.role === 'assistant' 
                    ? "bg-white shadow-sm border border-sage-border/40" 
                    : "bg-sage-accent text-white shadow-xl ml-auto max-w-[85%]"
                )}
              >
                {msg.role === 'assistant' && (
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 bg-sage-sidebar/40 text-sage-accent rounded-2xl flex items-center justify-center border border-sage-border/30">
                      <Sparkles size={20} />
                    </div>
                  </div>
                )}
                <div className="flex-1 overflow-hidden prose prose-sm max-w-none prose-sage">
                  {msg.role === 'assistant' ? (
                    <div className="text-sage-text leading-relaxed font-serif">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-white m-0 leading-relaxed font-sans">{msg.content}</p>
                  )}
                </div>
                {msg.role === 'assistant' && (
                  <button 
                    onClick={() => navigator.clipboard.writeText(msg.content)}
                    className="absolute top-4 right-4 p-2 text-sage-muted hover:text-sage-accent hover:bg-sage-sidebar/30 rounded-xl transition-all"
                  >
                    <Copy size={12} />
                  </button>
                )}
              </motion.div>
            ))}
            
            {isLoading && (
              <div className="flex gap-4 p-6 bg-white/50 border border-sage-border/30 rounded-[2rem] items-center">
                <div className="w-10 h-10 bg-sage-sidebar/40 rounded-2xl flex items-center justify-center">
                  <motion.div 
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  >
                    <Sparkles size={18} className="text-sage-accent" />
                  </motion.div>
                </div>
                <span className="text-sm font-serif italic text-sage-muted">正在编织灵感...</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Input Area */}
      <div className="p-8 bg-gradient-to-t from-sage-sidebar/20 to-transparent">
        <div className="max-w-3xl mx-auto relative group">
          <form 
            onSubmit={handleSubmit}
            className="flex items-center gap-2 p-2 bg-white rounded-full border-2 border-sage-border/30 focus-within:border-sage-accent transition-all shadow-xl"
          >
            <input 
              type="text" 
              placeholder="输入你的启发式问题或创作困惑..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="flex-1 pl-6 py-3 bg-transparent outline-none text-sm text-sage-text placeholder:text-sage-muted"
            />
            <button 
              type="button" 
              onClick={() => setMessages([messages[0]])}
              className="p-3 text-sage-muted hover:text-red-500 transition-colors"
              title="清空建议"
            >
              <Eraser size={20} />
            </button>
            <button 
              type="submit"
              disabled={isLoading}
              className="p-4 bg-sage-accent text-white rounded-full transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100 shadow-md"
            >
              <Send size={20} />
            </button>
          </form>
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 text-[10px] text-sage-muted font-bold uppercase tracking-widest opacity-0 group-focus-within:opacity-100 transition-opacity">
            按 Enter 发送，或 Shift+Enter 换行
          </div>
        </div>
      </div>
    </div>
  );
}
