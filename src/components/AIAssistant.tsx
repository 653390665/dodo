import React, { useState, useEffect } from 'react';
import {
  Send,
  Sparkles,
  BrainCircuit,
  Lightbulb,
  Eraser,
  Copy,
  Terminal,
  ArrowRight,
  FolderOpen,
  Globe,
  Loader2
} from 'lucide-react';
import { extractWorldSetupPhase } from '../lib/agents';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import ReactMarkdown from 'react-markdown';
import { listNovels, createChapter, createCharacter, createLocation, createItem, createIdeaFragment, subscribeToChanges, generateInspiration } from '../lib/api';
import { AssistantLaunchContext, AssistantPrimaryAction, AssistantSuggestionKind, Novel } from '../types';
import { buildAssistantSeedPrompt } from '../lib/assistant-context';
import { buildAssistantIdeaFragment } from '../lib/assistant-fragment';
import { classifyAssistantSuggestion, getPrimaryAssistantAction } from '../lib/assistant-suggestion';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface AIAssistantProps {
  launchContext?: AssistantLaunchContext | null;
  onApplyToContent?: (text: string) => Promise<void> | void;
  onApplyToSceneBeats?: (text: string) => Promise<void> | void;
  onReplaceSelection?: (text: string) => Promise<void> | void;
}

export function AIAssistant({ launchContext, onApplyToContent, onApplyToSceneBeats, onReplaceSelection }: AIAssistantProps) {
  const promptSurface = 'workspace-draft';
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: '这里是灵感助手。它服务于你正在写的作品：补桥段、扩场景、润台词、提设定，而不是替代新建作品入口。'
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState<string | null>(null);
  const [showExtractModal, setShowExtractModal] = useState<string | null>(null);
  const [userNovels, setUserNovels] = useState<Novel[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSavingToNovel, setIsSavingToNovel] = useState(false);
  const [savingFragmentId, setSavingFragmentId] = useState<string | null>(null);

  useEffect(() => {
    const refreshNovels = () => listNovels().then(setUserNovels);
    refreshNovels();
    return subscribeToChanges(refreshNovels);
  }, []);

  useEffect(() => {
    if (!launchContext) return;
    const seededPrompt = buildAssistantSeedPrompt(launchContext);
    setMessages((prev) => {
      const withoutSeed = prev.filter((message) => message.id !== 'workspace-seed');
      return [
        withoutSeed[0] || prev[0],
        {
          id: 'workspace-seed',
          role: 'user',
          content: seededPrompt,
        },
      ];
    });
    setInput(launchContext.intent || '');
  }, [launchContext]);

  const getMessageContent = (messageId: string | null) => {
    if (!messageId) return '';
    return messages.find(m => m.id === messageId)?.content ?? '';
  };

  const handleSubmit = async (e?: React.FormEvent, customPrompt?: string) => {
    e?.preventDefault();
    const prompt = customPrompt || input;
    if (!prompt.trim() || isLoading) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: prompt };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const result = await generateInspiration(prompt, promptSurface);
      const aiMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: result || '未能生成灵感，请重试。' };
      setMessages(prev => [...prev, aiMsg]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveToNovel = async (novel: Novel, content: string) => {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      alert('当前没有可保存的灵感内容。');
      return;
    }

    setIsSavingToNovel(true);
    try {
      const now = Date.now();
      await createChapter({
        id: now.toString(),
        title: '💡 灵感备忘录',
        content: trimmedContent,
        wordCount: trimmedContent.replace(/\s/g, '').length,
        order: 999,
        volumeName: '灵感碎片库',
        novelId: novel.id,
        createdAt: now,
        updatedAt: now
      });
      alert(`已成功保存至《${novel.title}》的灵感碎片卷！`);
      setShowSaveModal(null);
    } catch (error) {
      console.error(error);
      alert('保存失败，请稍后重试。');
    } finally {
      setIsSavingToNovel(false);
    }
  };

  const handleExtractToWorldBible = async (novel: Novel, content: string) => {
    setShowExtractModal(null);
    setIsExtracting(true);
    try {
      const extracted = await extractWorldSetupPhase(content);
      const now = Date.now();

      let count = 0;
      if (extracted.characters) {
        for (const char of extracted.characters) {
           await createCharacter({
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
           await createLocation({
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
           await createItem({
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

  const handleSaveAsIdeaFragment = async (content: string) => {
    if (!launchContext?.novelId) {
      alert('当前没有绑定作品上下文，暂时无法直接保存为灵感碎片。');
      return;
    }
    const trimmed = content.trim();
    if (!trimmed) return;

    setSavingFragmentId(content);
    try {
      await createIdeaFragment(buildAssistantIdeaFragment(trimmed, launchContext));
      alert(`已保存到《${launchContext.novelTitle}》的灵感碎片库。`);
    } catch (error) {
      console.error(error);
      alert('保存灵感碎片失败，请稍后重试。');
    } finally {
      setSavingFragmentId(null);
    }
  };

  const handleExtractToCurrentNovel = async (content: string) => {
    if (!launchContext?.novelId) {
      alert('当前没有绑定作品上下文，暂时无法直接提取到设定。');
      return;
    }
    const novel = userNovels.find((entry) => entry.id === launchContext.novelId);
    if (!novel) {
      alert('未找到当前上下文对应的作品，请稍后重试。');
      return;
    }
    await handleExtractToWorldBible(novel, content);
  };


  const suggestions = [
    { label: '先补正文', prompt: '基于当前章节，给我一段可以直接接上的正文候选。', icon: Sparkles },
    { label: '先补分镜', prompt: '基于当前章节目标，给我 3 条下一步场景分镜。', icon: BrainCircuit },
    { label: '先补设定', prompt: '只围绕当前卡点，补一条最关键的设定，不要发散。', icon: Lightbulb },
    { label: '先存碎片', prompt: '把我现在的想法整理成一条可回收的灵感碎片。', icon: Terminal },
  ];

  const KIND_LABELS: Record<AssistantSuggestionKind, string> = {
    prose: '正文候选',
    'scene-beat': '分镜候选',
    setting: '设定候选',
    fragment: '碎片候选',
  };

  const PRIMARY_ACTION_LABELS: Record<AssistantPrimaryAction, string> = {
    'replace-selection': '主动作：替换当前选区',
    'append-content': '主动作：插入正文末尾',
    'append-scene-beat': '主动作：追加到场景分镜',
    'extract-setting': '主动作：提取到当前作品设定',
    'save-fragment': '主动作：保存为灵感碎片',
  };

  return (
    <div className="h-full flex flex-col bg-transparent">
      <div className="flex-1 overflow-y-auto px-6 py-12">
        <div className="max-w-3xl mx-auto space-y-8" data-prompt-surface={promptSurface}>
          {/* Header */}
          <div className="text-center mb-16">
            <div className="inline-flex p-4 bg-white rounded-3xl shadow-lg mb-6 border border-theme-border/30">
              <Sparkles className="text-theme-accent animate-pulse" size={32} />
            </div>
            <h1 className="text-4xl font-serif font-bold tracking-tight mb-2 text-theme-accent">灵感助手</h1>
            <p className="text-theme-muted text-sm max-w-xl mx-auto">
              用于当前作品的续写补位。先处理眼前这一步，不在这里重新开很多方向。
            </p>
          </div>

          {launchContext && (
            <div className="rounded-2xl border border-theme-accent/20 bg-theme-accent/5 px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-bold text-theme-text">
                <Lightbulb size={16} className="text-theme-accent" />
                当前已带入创作上下文
              </div>
              <div className="mt-2 text-sm text-theme-muted space-y-1">
                <p>作品：{launchContext.novelTitle}</p>
                {launchContext.chapterTitle ? <p>章节：{launchContext.chapterTitle}</p> : null}
                {launchContext.intent ? <p>目标：{launchContext.intent}</p> : null}
                <p>建议顺序：先看主动作，再决定是否展开其他处理。</p>
              </div>
            </div>
          )}

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
                  "flex gap-4 p-6 rounded-[2rem]",
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
                <div className="flex-1 min-w-0 overflow-hidden">
                  {msg.role === 'assistant' ? (
                    <div className="space-y-4">
                      {msg.id !== 'welcome' && launchContext ? (() => {
                        const suggestionKind = classifyAssistantSuggestion(msg.content, launchContext);
                        const primaryAction = getPrimaryAssistantAction(suggestionKind, launchContext);
                        return (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center rounded-full bg-theme-accent/10 px-3 py-1 text-[11px] font-bold text-theme-accent border border-theme-accent/20">
                              {KIND_LABELS[suggestionKind]}
                            </span>
                            <span className="inline-flex items-center rounded-full bg-theme-sidebar/30 px-3 py-1 text-[11px] font-bold text-theme-muted border border-theme-border/50">
                              {PRIMARY_ACTION_LABELS[primaryAction]}
                            </span>
                          </div>
                        );
                      })() : null}
                      <div className="prose prose-sm max-w-none prose-sage text-theme-text leading-relaxed font-serif">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 border-t border-theme-border/40 pt-3">
                        <button
                          onClick={() => setShowExtractModal(msg.id)}
                          className="inline-flex items-center gap-2 rounded-full border border-theme-border/60 bg-theme-sidebar/20 px-3 py-2 text-xs font-bold text-theme-muted transition-colors hover:border-theme-accent hover:text-theme-accent"
                          title="AI解析设定并导入设定记忆"
                        >
                          <Globe size={14} />
                          提取设定
                        </button>
                        <button
                          onClick={() => setShowSaveModal(msg.id)}
                          className="inline-flex items-center gap-2 rounded-full border border-theme-border/60 bg-theme-sidebar/20 px-3 py-2 text-xs font-bold text-theme-muted transition-colors hover:border-theme-accent hover:text-theme-accent"
                          title="保存至已有作品的灵感碎片库"
                        >
                          <FolderOpen size={14} />
                          保存到作品
                        </button>
                        <button
                          onClick={() => navigator.clipboard.writeText(msg.content)}
                          className="inline-flex items-center gap-2 rounded-full border border-theme-border/60 bg-theme-sidebar/20 px-3 py-2 text-xs font-bold text-theme-muted transition-colors hover:border-theme-accent hover:text-theme-accent"
                          title="复制"
                        >
                          <Copy size={14} />
                          复制
                        </button>
                        {msg.id !== 'welcome' && msg.role === 'assistant' && launchContext ? (
                          (() => {
                            const suggestionKind = classifyAssistantSuggestion(msg.content, launchContext);
                            const primaryAction = getPrimaryAssistantAction(suggestionKind, launchContext);

                            const secondaryButtons = (
                              <>
                                {primaryAction !== 'save-fragment' ? (
                                  <button
                                    onClick={() => handleSaveAsIdeaFragment(msg.content)}
                                    disabled={savingFragmentId === msg.content}
                                    className="inline-flex items-center gap-2 rounded-full border border-theme-border/60 bg-theme-sidebar/20 px-3 py-2 text-xs font-bold text-theme-muted transition-colors hover:border-theme-accent hover:text-theme-accent disabled:opacity-50"
                                    title="保存到当前作品的灵感碎片库"
                                  >
                                    {savingFragmentId === msg.content ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                                    保存为灵感碎片
                                  </button>
                                ) : null}
                                {primaryAction !== 'extract-setting' ? (
                                  <button
                                    onClick={() => handleExtractToCurrentNovel(msg.content)}
                                    className="inline-flex items-center gap-2 rounded-full border border-theme-border/60 bg-theme-sidebar/20 px-3 py-2 text-xs font-bold text-theme-muted transition-colors hover:border-theme-accent hover:text-theme-accent"
                                    title="直接提取到当前作品设定"
                                  >
                                    <Globe size={14} />
                                    提取到当前作品设定
                                  </button>
                                ) : null}
                                {launchContext.selectedText && primaryAction !== 'replace-selection' ? (
                                  <button
                                    onClick={() => onReplaceSelection?.(msg.content)}
                                    className="inline-flex items-center gap-2 rounded-full border border-theme-border/60 bg-theme-sidebar/20 px-3 py-2 text-xs font-bold text-theme-muted transition-colors hover:border-theme-accent hover:text-theme-accent"
                                    title="替换当前已选中的正文片段"
                                  >
                                    <Sparkles size={14} />
                                    替换当前选区
                                  </button>
                                ) : null}
                                {primaryAction !== 'append-content' ? (
                                  <button
                                    onClick={() => onApplyToContent?.(msg.content)}
                                    className="inline-flex items-center gap-2 rounded-full border border-theme-border/60 bg-theme-sidebar/20 px-3 py-2 text-xs font-bold text-theme-muted transition-colors hover:border-theme-accent hover:text-theme-accent"
                                    title="追加到当前章节正文末尾"
                                  >
                                    <ArrowRight size={14} />
                                    插入正文末尾
                                  </button>
                                ) : null}
                                {primaryAction !== 'append-scene-beat' ? (
                                  <button
                                    onClick={() => onApplyToSceneBeats?.(msg.content)}
                                    className="inline-flex items-center gap-2 rounded-full border border-theme-border/60 bg-theme-sidebar/20 px-3 py-2 text-xs font-bold text-theme-muted transition-colors hover:border-theme-accent hover:text-theme-accent"
                                    title="追加到当前章节场景分镜"
                                  >
                                    <Globe size={14} />
                                    追加到场景分镜
                                  </button>
                                ) : null}
                              </>
                            );

                            const primaryButtonByAction: Record<AssistantPrimaryAction, React.ReactNode> = {
                              'replace-selection': launchContext.selectedText ? (
                                <button
                                  onClick={() => onReplaceSelection?.(msg.content)}
                                  className="inline-flex items-center gap-2 rounded-full border border-theme-accent bg-theme-accent px-3 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90"
                                  title="替换当前已选中的正文片段"
                                >
                                  <Sparkles size={14} />
                                  替换当前选区
                                </button>
                              ) : null,
                              'append-content': (
                                <button
                                  onClick={() => onApplyToContent?.(msg.content)}
                                  className="inline-flex items-center gap-2 rounded-full border border-theme-accent bg-theme-accent px-3 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90"
                                  title="追加到当前章节正文末尾"
                                >
                                  <ArrowRight size={14} />
                                  插入正文末尾
                                </button>
                              ),
                              'append-scene-beat': (
                                <button
                                  onClick={() => onApplyToSceneBeats?.(msg.content)}
                                  className="inline-flex items-center gap-2 rounded-full border border-theme-accent bg-theme-accent px-3 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90"
                                  title="追加到当前章节场景分镜"
                                >
                                  <Globe size={14} />
                                  追加到场景分镜
                                </button>
                              ),
                              'extract-setting': (
                                <button
                                  onClick={() => handleExtractToCurrentNovel(msg.content)}
                                  className="inline-flex items-center gap-2 rounded-full border border-theme-accent bg-theme-accent px-3 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90"
                                  title="直接提取到当前作品设定"
                                >
                                  <Globe size={14} />
                                  提取到当前作品设定
                                </button>
                              ),
                              'save-fragment': (
                                <button
                                  onClick={() => handleSaveAsIdeaFragment(msg.content)}
                                  disabled={savingFragmentId === msg.content}
                                  className="inline-flex items-center gap-2 rounded-full border border-theme-accent bg-theme-accent px-3 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                                  title="保存到当前作品的灵感碎片库"
                                >
                                  {savingFragmentId === msg.content ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                                  保存为灵感碎片
                                </button>
                              ),
                            };

                            return (
                              <>
                                {primaryButtonByAction[primaryAction]}
                                <details className="group">
                                  <summary className="list-none cursor-pointer rounded-full border border-theme-border/60 bg-theme-sidebar/20 px-3 py-2 text-xs font-bold text-theme-muted transition-colors hover:border-theme-accent hover:text-theme-accent">
                                    更多落地方式
                                  </summary>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {secondaryButtons}
                                  </div>
                                </details>
                              </>
                            );
                          })()
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p className="text-white m-0 leading-relaxed font-sans">{msg.content}</p>
                  )}
                </div>
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
              <div className="mb-4 rounded-2xl border border-theme-border/40 bg-theme-sidebar/15 px-4 py-3 text-sm leading-relaxed text-theme-text">
                {getMessageContent(showSaveModal)}
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 mb-4">
                {userNovels.length === 0 ? (
                  <div className="text-center p-8 text-sm text-theme-muted/50 border border-dashed rounded-xl">
                    你还没有创建过作品
                  </div>
                ) : (
                  userNovels.map(novel => (
                    <button
                      key={novel.id}
                      onClick={() => handleSaveToNovel(novel, getMessageContent(showSaveModal))}
                      className="w-full flex items-center justify-between p-4 bg-theme-sidebar/30 hover:bg-theme-sidebar rounded-xl border border-theme-border/50 hover:border-theme-accent transition-all text-left group disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isSavingToNovel}
                    >
                      <span className="font-bold text-sm text-theme-text group-hover:text-theme-accent transition-colors">{novel.title}</span>
                      <span className="flex items-center gap-2">
                        {isSavingToNovel ? <Loader2 size={14} className="animate-spin text-theme-accent" /> : null}
                        <ArrowRight size={14} className="text-transparent group-hover:text-theme-accent transition-colors" />
                      </span>
                    </button>
                  ))
                )}
              </div>

              <button
                onClick={() => setShowSaveModal(null)}
                className="w-full py-3 bg-theme-sidebar/80 text-theme-muted font-bold rounded-xl hover:bg-theme-sidebar transition-colors disabled:opacity-60"
                disabled={isSavingToNovel}
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
                      onClick={() => handleExtractToWorldBible(novel, getMessageContent(showExtractModal))}
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
