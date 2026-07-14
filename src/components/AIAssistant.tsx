import React, { useState, useEffect, useRef } from 'react';
import { toast } from '../lib/toast';

import { extractWorldSetupPhase } from '../lib/agents';
import { cn } from '../lib/utils';
import ReactMarkdown from 'react-markdown';
import { ArrowRight, BrainCircuit, Copy, FolderOpen, Globe, Lightbulb, Loader2, MoreVertical, Send, Sparkles, Terminal, X } from 'lucide-react';
import { listNovels } from '../lib/novel-client';
import { createChapter } from '../lib/chapter-client';
import { importWorldExtraction } from '../lib/world-client';
import { createIdeaFragment } from '../lib/idea-client';
import { subscribeToChanges } from '../lib/db-transport';
import { generateInspiration } from '../lib/prompt-client';
import { AssistantLaunchContext, AssistantSuggestionKind, Novel } from '../../shared/types';
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
  activeNovel?: Novel | null;
  onApplyToContent?: (text: string) => Promise<void> | void;
  onApplyToSceneBeats?: (text: string) => Promise<void> | void;
  onReplaceSelection?: (text: string) => Promise<void> | void;
  onClose?: () => void;
}

export function AIAssistant({ launchContext, activeNovel, onApplyToContent, onApplyToSceneBeats, onReplaceSelection, onClose }: AIAssistantProps) {
  const promptSurface = activeNovel ? 'workspace-draft' : 'welcome';
  const hasProjectContext = Boolean(launchContext || activeNovel);
  const assistantTitle = hasProjectContext ? '作品协作助手' : '灵感启动助手';
  const assistantSubtitle = hasProjectContext ? 'PROJECT COPILOT' : 'IDEA STARTER';
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: '这里是灵感启动助手。你可以先描述故事、角色或卡点；进入作品后，我会切换为读取当前章节上下文的协作助手。'
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState<string | null>(null);
  const [showExtractModal, setShowExtractModal] = useState<string | null>(null);
  const [userNovels, setUserNovels] = useState<Novel[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);
  const [extractStageText, setExtractStageText] = useState('正在读取资料并解包文本...');
  const [isSavingToNovel, setIsSavingToNovel] = useState(false);
  const extractionControllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => extractionControllerRef.current?.abort(), []);

  useEffect(() => {
    const refreshNovels = () => listNovels().then(setUserNovels);
    refreshNovels();
    return subscribeToChanges(refreshNovels);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showSaveModal) setShowSaveModal(null);
        if (showExtractModal) setShowExtractModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSaveModal, showExtractModal]);

  useEffect(() => {
    if (!launchContext) return;
    const seededPrompt = buildAssistantSeedPrompt(launchContext);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing props to state on context change
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

    // eslint-disable-next-line react-hooks/purity -- Date.now() in event handler, safe
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: prompt };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const result = await generateInspiration(prompt, promptSurface, activeNovel?.id);
      // eslint-disable-next-line react-hooks/purity -- Date.now() in event handler, safe
      const aiMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: result || '未能生成灵感，请重试。' };
      setMessages(prev => [...prev, aiMsg]);
    } catch {
      toast('生成灵感失败，请稍后重试', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveToNovel = async (novel: Novel, content: string) => {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      toast('当前没有可保存的灵感内容。', 'error');
      return;
    }

    setIsSavingToNovel(true);
    try {
      // eslint-disable-next-line react-hooks/purity -- Date.now() in event handler, safe
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
      toast(`已保存至《${novel.title}》灵感库`, 'success');
      setShowSaveModal(null);
    } catch {
      toast('保存失败，请稍后重试。', 'error');
    } finally {
      setIsSavingToNovel(false);
    }
  };

  const handleExtractToWorldBible = async (novel: Novel, content: string) => {
    setShowExtractModal(null);
    setIsExtracting(true);
    setExtractProgress(10);
    setExtractStageText('正在初始化后台解析引擎...');
    extractionControllerRef.current?.abort();
    const controller = new AbortController();
    extractionControllerRef.current = controller;
    try {
      const { result: extracted, databaseGeneration } = await extractWorldSetupPhase(content, novel.id, (progress, status) => {
        setExtractProgress(progress);
        setExtractStageText(status);
      }, controller.signal);
      const entityCollections = [
        extracted.characters,
        extracted.locations,
        extracted.items,
        extracted.factions,
        extracted.powerLevels,
        extracted.timelineEvents,
      ];
      const count = entityCollections.reduce((total, entries) => total + (entries?.length ?? 0), 0);

      // The server validates the entire extraction and commits outline, world
      // rules, and every supported entity collection in one SQLite transaction.
      // A single invalid entity therefore cannot leave a partial world bible.
      await importWorldExtraction({
        databaseGeneration,
        novelId: novel.id,
        globalOutline: extracted.globalOutline ?? novel.globalOutline ?? '',
        worldRules: extracted.worldRules ?? novel.worldRules ?? '',
        characters: extracted.characters ?? [],
        locations: extracted.locations ?? [],
        items: extracted.items ?? [],
        factions: extracted.factions ?? [],
        powerLevels: extracted.powerLevels ?? [],
        timelineEvents: extracted.timelineEvents ?? [],
      });

      toast(`已解析 ${count} 个设定项并存储至《${novel.title}》`, 'success');
    } catch {
      if (controller.signal.aborted) return;
      toast('提取设定失败，内容可能不包含明确的设定格式', 'error');
    } finally {
      if (extractionControllerRef.current === controller) {
        extractionControllerRef.current = null;
        setIsExtracting(false);
      }
    }
  };

  const handleSaveAsIdeaFragment = async (content: string) => {
    if (!launchContext?.novelId) {
      toast('请先绑定作品上下文', 'info');
      return;
    }
    const trimmed = content.trim();
    if (!trimmed) return;

    try {
      await createIdeaFragment(buildAssistantIdeaFragment(trimmed, launchContext));
      toast(`已保存到《${launchContext.novelTitle}》灵感库`, 'success');
    } catch {
      toast('保存失败，请稍后重试', 'error');
    }
  };

  const handleExtractToCurrentNovel = async (content: string) => {
    if (!launchContext?.novelId) {
      toast('请先绑定作品上下文', 'info');
      return;
    }
    const novel = userNovels.find((entry) => entry.id === launchContext.novelId);
    if (!novel) {
      toast('未找到对应作品', 'error');
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

  return (
    <div className="h-full flex flex-col bg-theme-sidebar">
      {/* Sticky Header */}
      <div className="shrink-0 p-4 border-b border-theme-border flex items-center justify-between bg-theme-sidebar sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-theme-sidebar/40 rounded-xl text-theme-accent">
            <Sparkles size={20} aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-serif font-bold text-theme-text leading-none">{assistantTitle}</h2>
            <p className="text-[10px] text-theme-muted mt-1 uppercase tracking-widest font-bold">{assistantSubtitle}</p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="关闭 AI 助手"
            className="p-2 rounded-full text-theme-muted hover:bg-theme-sidebar/50 hover:text-theme-text transition-all"
          >
            <X size={20} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-6">
        <div className="rounded-2xl border border-theme-accent/20 bg-theme-accent/5 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-bold text-theme-text">
            <Lightbulb size={14} className="text-theme-accent" aria-hidden="true" />
            当前 AI 上下文
          </div>
          <div className="mt-2 text-[11px] text-theme-muted flex flex-col gap-1">
            {launchContext ? (
              <>
                <p className="truncate">作品：{launchContext.novelTitle}</p>
                {launchContext.chapterTitle ? <p className="truncate">章节：{launchContext.chapterTitle}</p> : null}
                {launchContext.intent ? <p className="line-clamp-1">目标：{launchContext.intent}</p> : null}
              </>
            ) : activeNovel ? (
              <>
                <p className="truncate">作品：{activeNovel.title}</p>
                <p>还没有绑定具体章节，会按作品层面协作。</p>
              </>
            ) : (
              <>
                <p>未选择作品。当前适合做灵感发散、故事方向和设定草稿。</p>
                <p>进入作品后，可把建议应用到正文、分镜或设定。</p>
              </>
            )}
          </div>
        </div>

        {/* Quick Suggestions - Compact for Drawer */}
        <div className="grid grid-cols-2 gap-2">
          {suggestions.map((s) => (
            <button
              key={s.label}
              onClick={() => handleSubmit(undefined, s.prompt)}
              className="flex items-center gap-2 p-3 bg-theme-sidebar/20 rounded-xl border border-theme-border/30 hover:border-theme-accent hover:bg-theme-sidebar transition-all group text-left shadow-sm active:scale-95"
            >
              <s.icon size={14} className="text-theme-muted group-hover:text-theme-accent shrink-0" aria-hidden="true" />
              <span className="text-[11px] font-bold text-theme-muted group-hover:text-theme-text truncate">{s.label}</span>
            </button>
          ))}
        </div>

        {/* Chat Messages */}
        <div className="flex flex-col gap-4 pb-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex flex-col gap-2 p-4 rounded-2xl",
                msg.role === 'assistant'
                  ? "bg-theme-sidebar/10 border border-theme-border/40"
                  : "bg-theme-accent text-white shadow-md ml-4"
              )}
            >
              <div className="flex-1 min-w-0 overflow-hidden">
                {msg.role === 'assistant' ? (
                  <div className="flex flex-col gap-3">
                    {msg.id !== 'welcome' && launchContext ? (() => {
                      const suggestionKind = classifyAssistantSuggestion(msg.content, launchContext);
                      return (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center rounded-full bg-theme-accent/10 px-2 py-0.5 text-[9px] font-bold text-theme-accent border border-theme-accent/20">
                            {KIND_LABELS[suggestionKind]}
                          </span>
                        </div>
                      );
                    })() : null}
                    <div className="prose prose-xs max-w-none text-theme-text leading-relaxed font-serif">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 border-t border-theme-border/20 pt-2">
                      <button
                        onClick={() => navigator.clipboard.writeText(msg.content)}
                        className="p-1.5 rounded-lg border border-theme-border/40 bg-theme-sidebar text-theme-muted transition-colors hover:text-theme-accent"
                        title="复制"
                        aria-label="复制"
                      >
                        <Copy size={12} aria-hidden="true" />
                      </button>
                      
                      {msg.id !== 'welcome' && launchContext ? (
                        (() => {
                          const suggestionKind = classifyAssistantSuggestion(msg.content, launchContext);
                          const primaryAction = getPrimaryAssistantAction(suggestionKind, launchContext);

                          const ActionButton = ({ action, label, icon: Icon, primary }: { action: () => void, label: string, icon: React.ComponentType<{size?: number, className?: string}>, primary?: boolean }) => (
                            <button
                              onClick={action}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold transition-all",
                                primary 
                                  ? "bg-theme-accent text-white shadow-sm hover:opacity-90" 
                                  : "border border-theme-border/60 bg-theme-sidebar text-theme-muted hover:border-theme-accent hover:text-theme-accent"
                              )}
                              title={label}
                            >
                              <Icon size={10} aria-hidden="true" />
                              {label.replace('主动作：', '').replace('直接', '')}
                            </button>
                          );

                          return (
                            <>
                              {primaryAction === 'replace-selection' && launchContext.selectedText && (
                                <ActionButton primary action={() => onReplaceSelection?.(msg.content)} label="替换选区" icon={Sparkles} />
                              )}
                              {primaryAction === 'append-content' && (
                                <ActionButton primary action={() => onApplyToContent?.(msg.content)} label="插到末尾" icon={ArrowRight} />
                              )}
                              {primaryAction === 'append-scene-beat' && (
                                <ActionButton primary action={() => onApplyToSceneBeats?.(msg.content)} label="补分镜" icon={Globe} />
                              )}
                              {primaryAction === 'extract-setting' && (
                                <ActionButton primary action={() => handleExtractToCurrentNovel(msg.content)} label="提设定" icon={Globe} />
                              )}
                              {primaryAction === 'save-fragment' && (
                                <ActionButton primary action={() => handleSaveAsIdeaFragment(msg.content)} label="存碎片" icon={FolderOpen} />
                              )}

                              <details className="group relative">
                                <summary
                                  className="list-none cursor-pointer p-1.5 rounded-lg border border-theme-border/40 bg-theme-sidebar text-theme-muted transition-colors hover:text-theme-accent"
                                  aria-label="更多操作"
                                >
                                  <MoreVertical size={12} aria-hidden="true" />
                                </summary>
                                <div className="absolute bottom-full left-0 mb-2 w-48 bg-theme-sidebar rounded-xl shadow-xl border border-theme-border p-2 flex flex-col gap-1 z-30">
                                  <button onClick={() => setShowSaveModal(msg.id)} className="flex items-center gap-2 px-3 py-2 text-[10px] font-bold text-theme-muted hover:bg-theme-sidebar/50 rounded-lg">
                                    <FolderOpen size={12} aria-hidden="true" /> 保存到其他作品
                                  </button>
                                  <button onClick={() => setShowExtractModal(msg.id)} className="flex items-center gap-2 px-3 py-2 text-[10px] font-bold text-theme-muted hover:bg-theme-sidebar/50 rounded-lg">
                                    <Globe size={12} aria-hidden="true" /> 提取到其他作品
                                  </button>
                                  {primaryAction !== 'save-fragment' && (
                                    <button onClick={() => handleSaveAsIdeaFragment(msg.content)} className="flex items-center gap-2 px-3 py-2 text-[10px] font-bold text-theme-muted hover:bg-theme-sidebar/50 rounded-lg">
                                      <FolderOpen size={12} aria-hidden="true" /> 保存为灵感碎片
                                    </button>
                                  )}
                                </div>
                              </details>
                            </>
                          );
                        })()
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <p className="text-white m-0 text-xs leading-relaxed font-sans">{msg.content}</p>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-3 p-4 bg-theme-sidebar/10 border border-theme-border/20 rounded-2xl items-center">
              <div
                className="text-theme-accent"
              >
                <Sparkles size={16} aria-hidden="true" />
              </div>
              <span className="text-[11px] font-serif italic text-theme-muted">正在编织灵感...</span>
            </div>
          )}
        </div>
      </div>

      {/* Input Area - Compact for Drawer */}
      <div className="shrink-0 p-4 border-t border-theme-border bg-theme-sidebar/5 sticky bottom-0 z-20">
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 p-1.5 bg-theme-sidebar rounded-2xl border border-theme-border focus-within:border-theme-accent transition-all shadow-sm"
        >
          <input
            type="text"
            placeholder="创作困惑？"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 pl-3 py-2 bg-transparent outline-none text-xs text-theme-text placeholder:text-theme-muted"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="p-2.5 bg-theme-accent text-white rounded-xl transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100 shadow-sm"
            aria-label="发送消息"
          >
            <Send size={14} aria-hidden="true" />
          </button>
        </form>
      </div>

      {/* Save Modal */}
      {showSaveModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm"
            onClick={() => setShowSaveModal(null)}
          >
            <div
              onClick={e => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="save-modal-title"
              className="bg-theme-sidebar rounded-3xl p-6 shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col"
            >
              <h3 id="save-modal-title" className="text-xl font-bold font-serif mb-4 flex items-center gap-2">
                <FolderOpen size={20} className="text-theme-accent" aria-hidden="true" />
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
                        {isSavingToNovel ? <Loader2 size={14} className="animate-spin text-theme-accent" aria-hidden="true" /> : null}
                        <ArrowRight size={14} className="text-transparent group-hover:text-theme-accent transition-colors" aria-hidden="true" />
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
            </div>
          </div>
        )}
      {/* Extract Modal */}
      {showExtractModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm"
            onClick={() => !isExtracting && setShowExtractModal(null)}
          >
            <div
              onClick={e => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="extract-modal-title"
              className="bg-theme-sidebar rounded-3xl p-6 shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col relative overflow-hidden"
            >
              {isExtracting && (
                <div className="absolute inset-0 bg-theme-sidebar/90 backdrop-blur-md z-10 flex flex-col items-center justify-center p-6">
                  <div className="w-16 h-16 bg-theme-accent/10 rounded-full flex items-center justify-center mb-4 relative">
                    <Loader2 size={32} className="text-theme-accent animate-spin" aria-hidden="true" />
                    <span className="absolute text-[10px] font-bold text-theme-accent">{extractProgress}%</span>
                  </div>
                  <p className="font-bold text-theme-text font-serif text-center">{extractStageText || 'AI 正在结构化提取设定...'}</p>
                  
                  {/* Modern Glassmorphic Progress Bar */}
                  <div className="w-full max-w-[240px] bg-theme-border/50 h-1.5 rounded-full mt-4 overflow-hidden relative">
                    <div 
                      className="bg-gradient-to-r from-theme-accent/70 to-theme-accent h-full rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${extractProgress}%` }}
                    />
                  </div>
                  
                  <p className="text-xs text-theme-muted mt-3">深度计算解析中，后台异步守卫已激活</p>
                </div>
              )}
              <h3 id="extract-modal-title" className="text-xl font-bold font-serif mb-4 flex items-center gap-2">
                <Globe size={20} className="text-theme-accent" aria-hidden="true" />
                提取设定至作品
              </h3>
              <p className="text-xs text-theme-muted mb-4">选择一个作品，AI将自动提取当前卡片中的角色、地点、物品等结构化知识，并写入该作品的「设定集」库中。</p>

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
                      <ArrowRight size={14} className="text-transparent group-hover:text-theme-accent transition-colors" aria-hidden="true" />
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
            </div>
          </div>
        )}
    </div>
  );
}
