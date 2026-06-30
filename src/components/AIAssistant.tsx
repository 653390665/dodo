import React, { useState, useEffect } from 'react';

import { extractWorldSetupPhase } from '../lib/agents';
import { cn } from '../lib/utils';
import ReactMarkdown from 'react-markdown';
import { ArrowRight, BrainCircuit, Copy, Eraser, FolderOpen, Globe, Lightbulb, Loader2, MoreVertical, Send, Sparkles, Terminal, X } from 'lucide-react';
import { listNovels } from '../lib/novel-client';
import { createChapter } from '../lib/chapter-client';
import { createCharacter, createLocation, createItem } from '../lib/world-client';
import { createIdeaFragment } from '../lib/idea-client';
import { subscribeToChanges } from '../lib/db-transport';
import { generateInspiration } from '../lib/prompt-client';
import { AssistantLaunchContext, AssistantPrimaryAction, AssistantSuggestionKind, Novel } from '../../shared/types';
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
  onClose?: () => void;
}

export function AIAssistant({ launchContext, onApplyToContent, onApplyToSceneBeats, onReplaceSelection, onClose }: AIAssistantProps) {
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
      const result = await generateInspiration(prompt, promptSurface);
      // eslint-disable-next-line react-hooks/purity -- Date.now() in event handler, safe
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
      alert(`已成功保存至《${novel.title}》的灵感碎片库！`);
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
      // eslint-disable-next-line react-hooks/purity -- Date.now() in event handler, safe
      const now = Date.now();

      let count = 0;
      if (extracted.characters) {
        for (const char of extracted.characters) {
           await createCharacter({
             // eslint-disable-next-line react-hooks/purity -- Date.now() in event handler, safe
             id: Date.now().toString(),
             novelId: novel.id,
             name: char.name || '',
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
             // eslint-disable-next-line react-hooks/purity -- Date.now() in event handler, safe
             id: Date.now().toString(),
             novelId: novel.id,
             name: loc.name || '',
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
             // eslint-disable-next-line react-hooks/purity -- Date.now() in event handler, safe
             id: Date.now().toString(),
             novelId: novel.id,
             name: item.name || '',
             type: item.type || '',
             description: item.description || '',
             createdAt: now,
             updatedAt: now
           });
           count++;
        }
      }

      alert(`AI 已成功解析出 ${count} 个设定项，并存储至《${novel.title}》的设定集库中！您可前往「设定记忆」界面查看。`);
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
    <div className="h-full flex flex-col bg-theme-sidebar">
      {/* Sticky Header */}
      <div className="shrink-0 p-4 border-b border-theme-border flex items-center justify-between bg-theme-sidebar sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-theme-sidebar/40 rounded-xl text-theme-accent">
            <Sparkles size={20} />
          </div>
          <div>
            <h2 className="text-lg font-serif font-bold text-theme-text leading-none">灵感助手</h2>
            <p className="text-[10px] text-theme-muted mt-1 uppercase tracking-widest font-bold">AI Inspiration Assistant</p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-2 rounded-full text-theme-muted hover:bg-theme-sidebar/50 hover:text-theme-text transition-all"
          >
            <X size={20} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-6">
        {launchContext && (
          <div className="rounded-2xl border border-theme-accent/20 bg-theme-accent/5 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-bold text-theme-text">
              <Lightbulb size={14} className="text-theme-accent" />
              当前创作上下文
            </div>
            <div className="mt-2 text-[11px] text-theme-muted flex flex-col gap-1">
              <p className="truncate">作品：{launchContext.novelTitle}</p>
              {launchContext.chapterTitle ? <p className="truncate">章节：{launchContext.chapterTitle}</p> : null}
              {launchContext.intent ? <p className="line-clamp-1">目标：{launchContext.intent}</p> : null}
            </div>
          </div>
        )}

        {/* Quick Suggestions - Compact for Drawer */}
        <div className="grid grid-cols-2 gap-2">
          {suggestions.map((s, idx) => (
            <button
              key={idx}
              onClick={() => handleSubmit(undefined, s.prompt)}
              className="flex items-center gap-2 p-3 bg-theme-sidebar/20 rounded-xl border border-theme-border/30 hover:border-theme-accent hover:bg-theme-sidebar transition-all group text-left shadow-sm active:scale-95"
            >
              <s.icon size={14} className="text-theme-muted group-hover:text-theme-accent shrink-0" />
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
                      const primaryAction = getPrimaryAssistantAction(suggestionKind, launchContext);
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
                      >
                        <Copy size={12} />
                      </button>
                      
                      {msg.id !== 'welcome' && launchContext ? (
                        (() => {
                          const suggestionKind = classifyAssistantSuggestion(msg.content, launchContext);
                          const primaryAction = getPrimaryAssistantAction(suggestionKind, launchContext);

                          const ActionButton = ({ action, label, icon: Icon, primary }: { action: () => void, label: string, icon: any, primary?: boolean }) => (
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
                              <Icon size={10} />
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
                                <summary className="list-none cursor-pointer p-1.5 rounded-lg border border-theme-border/40 bg-theme-sidebar text-theme-muted transition-colors hover:text-theme-accent">
                                  <MoreVertical size={12} />
                                </summary>
                                <div className="absolute bottom-full left-0 mb-2 w-48 bg-theme-sidebar rounded-xl shadow-xl border border-theme-border p-2 flex flex-col gap-1 z-30">
                                  <button onClick={() => setShowSaveModal(msg.id)} className="flex items-center gap-2 px-3 py-2 text-[10px] font-bold text-theme-muted hover:bg-theme-sidebar/50 rounded-lg">
                                    <FolderOpen size={12} /> 保存到其他作品
                                  </button>
                                  <button onClick={() => setShowExtractModal(msg.id)} className="flex items-center gap-2 px-3 py-2 text-[10px] font-bold text-theme-muted hover:bg-theme-sidebar/50 rounded-lg">
                                    <Globe size={12} /> 提取到其他作品
                                  </button>
                                  {primaryAction !== 'save-fragment' && (
                                    <button onClick={() => handleSaveAsIdeaFragment(msg.content)} className="flex items-center gap-2 px-3 py-2 text-[10px] font-bold text-theme-muted hover:bg-theme-sidebar/50 rounded-lg">
                                      <FolderOpen size={12} /> 保存为灵感碎片
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
                <Sparkles size={16} />
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
          >
            <Send size={14} />
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
              className="bg-theme-sidebar rounded-3xl p-6 shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col"
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
              className="bg-theme-sidebar rounded-3xl p-6 shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col relative overflow-hidden"
            >
              {isExtracting && (
                <div className="absolute inset-0 bg-theme-sidebar/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center">
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
            </div>
          </div>
        )}
    </div>
  );
}
