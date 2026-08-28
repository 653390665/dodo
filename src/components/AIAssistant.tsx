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
import { useAssistantSessionStore } from '../stores/assistant-session-store';
import { AssistantActionPlan, AssistantLaunchContext, AssistantSuggestionKind, Novel } from '../../shared/types';
import { buildAssistantSeedPrompt } from '../lib/assistant-context';
import { buildAssistantIdeaFragment } from '../lib/assistant-fragment';
import { classifyAssistantSuggestion, getPrimaryAssistantAction } from '../lib/assistant-suggestion';
import { recordProductEvent } from '../lib/product-events-client';
import { buildAssistantActionPlan, getAssistantQuickActions } from '../lib/assistant-action-plan';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actionPlan?: AssistantActionPlan;
}

interface AIAssistantProps {
  launchContext?: AssistantLaunchContext | null;
  activeNovel?: Novel | null;
  onApplyToContent?: (text: string) => Promise<void> | void;
  onApplyToSceneBeats?: (text: string) => Promise<void> | void;
  onReplaceSelection?: (text: string) => Promise<void> | void;
  onLaunchSettingCandidate?: (plan: AssistantActionPlan, seedText: string) => Promise<void> | void;
  onStartCreation?: (plan: AssistantActionPlan, seedText?: string) => Promise<void> | void;
  onClose?: () => void;
}

export function AIAssistant({ launchContext, activeNovel, onApplyToContent, onApplyToSceneBeats, onReplaceSelection, onLaunchSettingCandidate, onStartCreation, onClose }: AIAssistantProps) {
  const sessionKey = activeNovel?.id ?? 'welcome';
  const sessionState = useAssistantSessionStore();
  const session = sessionState.getSession(sessionKey, 'general');
  const sessionStore = useAssistantSessionStore.getState();
  const promptSurface = activeNovel ? 'workspace-draft' : 'welcome';
  const hasProjectContext = Boolean(launchContext || activeNovel);
  const assistantTitle = hasProjectContext ? '作品协作助手' : '灵感启动助手';
  const assistantSubtitle = hasProjectContext ? 'PROJECT COPILOT' : 'IDEA STARTER';
  const messages: Message[] = session.messages.map((message) => ({
    id: message.id,
    role: message.sender === 'user' ? 'user' : 'assistant',
    content: message.text,
    actionPlan: message.actionPlan,
  }));
  const input = session.input;
  const [showSaveModal, setShowSaveModal] = useState<string | null>(null);
  const [showExtractModal, setShowExtractModal] = useState<string | null>(null);
  const [userNovels, setUserNovels] = useState<Novel[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);
  const [extractStageText, setExtractStageText] = useState('正在读取资料并解包文本...');
  const [isSavingToNovel, setIsSavingToNovel] = useState(false);
  const [pendingCandidate, setPendingCandidate] = useState<{ plan: AssistantActionPlan; content: string } | null>(null);
  const extractionControllerRef = useRef<AbortController | null>(null);
  const extractionEpochRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (session.messages.length === 0) {
      useAssistantSessionStore.getState().setMessages(sessionKey, 'general', [{
        id: 'welcome',
        sender: 'assistant',
        text: '这里是灵感启动助手。你可以先描述故事、角色或卡点；进入作品后，我会基于已打开的作品与章节资料辅助你整理候选。',
      }]);
    }
  }, [sessionKey, session.messages.length]);

  useEffect(() => () => requestControllerRef.current?.abort(), [sessionKey]);
  useEffect(() => () => {
    extractionEpochRef.current += 1;
    extractionControllerRef.current?.abort();
  }, [sessionKey]);

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
    const current = useAssistantSessionStore.getState().getSession(sessionKey, 'general');
    const existingSeed = current.messages.find((message) => message.id === 'workspace-seed');
    if (existingSeed?.text === seededPrompt) return;
    const withoutSeed = current.messages.filter((message) => message.id !== 'workspace-seed');
    useAssistantSessionStore.getState().setMessages(sessionKey, 'general', [
      withoutSeed[0] || { id: 'welcome', sender: 'assistant', text: '这里是灵感启动助手。你可以先描述故事、角色或卡点；进入作品后，我会基于已打开的作品与章节资料辅助你整理候选。' },
      { id: 'workspace-seed', sender: 'user', text: seededPrompt },
    ]);
    useAssistantSessionStore.getState().setInput(sessionKey, 'general', launchContext.intent || '');
  }, [launchContext, sessionKey]);

  const getMessageContent = (messageId: string | null) => {
    if (!messageId) return '';
    return messages.find(m => m.id === messageId)?.content ?? '';
  };

  const handleSubmit = async (e?: React.FormEvent, customPrompt?: string, isRetry = false, explicitPlan?: AssistantActionPlan) => {
    e?.preventDefault();
    const prompt = customPrompt || input;
    if (!prompt.trim() || sessionStore.getSession(sessionKey, 'general').isLoading) return;

    // eslint-disable-next-line react-hooks/purity -- Date.now() in event handler, safe
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: prompt };
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const requestId = sessionStore.startRequest(sessionKey, 'general');
    const failedRequest = sessionStore.getSession(sessionKey, 'general').failure;
    sessionStore.clearFailure(sessionKey, 'general');
    void recordProductEvent({ eventName: 'assistant_request', stage: 'assistant', result: 'success', novelId: activeNovel?.id, chapterId: launchContext?.chapterId, objectId: requestId });
    if (failedRequest) void recordProductEvent({ eventName: 'assistant_retry', stage: 'assistant', result: 'success', novelId: activeNovel?.id, chapterId: launchContext?.chapterId, objectId: failedRequest.requestId });
    if (!isRetry) {
      sessionStore.appendMessage(sessionKey, 'general', { id: userMsg.id, sender: 'user', text: userMsg.content });
      sessionStore.setInput(sessionKey, 'general', '');
    }

    try {
      const result = await generateInspiration(prompt, promptSurface, activeNovel?.id, controller.signal);
      if (controller.signal.aborted || useAssistantSessionStore.getState().getSession(sessionKey, 'general').activeRequestId !== requestId) return;
      if (!result.trim()) {
        sessionStore.setInput(sessionKey, 'general', prompt);
        throw Object.assign(new Error('模型未返回内容，请重试。'), {
          code: 'empty_response', reason: 'no_content' as const, retriable: true,
        });
      }
      const actionPlan = explicitPlan || buildAssistantActionPlan(
        launchContext?.chapterId ? 'draft-prose' : 'save-fragment',
        prompt,
        { novelId: activeNovel?.id, chapterId: launchContext?.chapterId },
      );
      sessionStore.applyResponse(sessionKey, 'general', requestId, result, actionPlan);
      void recordProductEvent({ eventName: 'assistant_success', stage: 'assistant', result: 'success', novelId: activeNovel?.id, chapterId: launchContext?.chapterId, objectId: requestId });
      // eslint-disable-next-line react-hooks/purity -- Date.now in event handler, safe
      if (failedRequest) void recordProductEvent({ eventName: 'assistant_recovered', stage: 'assistant', result: 'success', novelId: activeNovel?.id, chapterId: launchContext?.chapterId, objectId: failedRequest.requestId, durationMs: Math.max(0, Date.now() - failedRequest.failedAt) });
      sessionStore.clearFailure(sessionKey, 'general');
    } catch (error) {
      if (controller.signal.aborted || useAssistantSessionStore.getState().getSession(sessionKey, 'general').activeRequestId !== requestId) return;
      sessionStore.setInput(sessionKey, 'general', prompt);
      const code = typeof (error as { code?: unknown })?.code === 'string'
        ? String((error as { code: string }).code)
        : 'assistant_failure';
      const message = error instanceof Error && error.message.trim() ? error.message : '请求未完成，请检查网络或模型配置后重试。';
      const retriable = typeof (error as { retriable?: unknown })?.retriable === 'boolean'
        ? Boolean((error as { retriable: boolean }).retriable)
        : !['configuration', 'authentication', 'billing'].includes(code);
      // eslint-disable-next-line react-hooks/purity -- Date.now in event handler, safe
      const failedAt = Date.now();
      const reason = (error as { reason?: unknown })?.reason;
      const finishReason = typeof (error as { finishReason?: unknown })?.finishReason === 'string'
        ? String((error as { finishReason: string }).finishReason) : undefined;
      const traceId = typeof (error as { traceId?: unknown })?.traceId === 'string'
        ? String((error as { traceId: string }).traceId) : undefined;
      sessionStore.setFailure(sessionKey, 'general', {
        code,
        message,
        prompt,
        failedAt,
        requestId,
        retriable,
        reason: reason === 'no_content' || reason === 'reasoning_only' || reason === 'length_exhausted' ? reason : undefined,
        finishReason,
        traceId,
      });
      void recordProductEvent({ eventName: code === 'empty_response' ? 'assistant_empty_response' : 'assistant_failure', stage: 'assistant', result: 'failure', novelId: activeNovel?.id, chapterId: launchContext?.chapterId, objectId: requestId, errorCode: code });
      toast('生成灵感失败，请稍后重试', 'error');
    } finally {
      if (useAssistantSessionStore.getState().getSession(sessionKey, 'general').activeRequestId === requestId) {
        sessionStore.finishRequest(sessionKey, 'general', requestId);
      }
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    }
  };

  const failureReasonText = session.failure?.reason === 'no_content'
    ? '模型未返回内容'
    : session.failure?.reason === 'reasoning_only'
      ? '模型只返回了推理过程'
      : session.failure?.reason === 'length_exhausted'
        ? '输出因长度限制结束'
        : null;

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
    const epoch = extractionEpochRef.current + 1;
    extractionEpochRef.current = epoch;
    const controller = new AbortController();
    extractionControllerRef.current = controller;
    const isCurrentExtraction = () => (
      extractionEpochRef.current === epoch
      && extractionControllerRef.current === controller
      && !controller.signal.aborted
    );
    try {
      const { result: extracted, databaseGeneration } = await extractWorldSetupPhase(content, novel.id, (progress, status) => {
        if (!isCurrentExtraction()) return;
        setExtractProgress(progress);
        setExtractStageText(status);
      }, controller.signal);
      if (!isCurrentExtraction()) return;
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
      if (!isCurrentExtraction()) return;
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
      if (!isCurrentExtraction()) return;

      toast(`已解析 ${count} 个设定项并存储至《${novel.title}》`, 'success');
    } catch {
      if (!isCurrentExtraction()) return;
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

  const iconByIntent = {
    'draft-prose': Sparkles,
    'plan-scene': BrainCircuit,
    'build-setting': Lightbulb,
    'plan-structure': BrainCircuit,
    'save-fragment': Terminal,
  } as const;
  const suggestions = getAssistantQuickActions({
    hasNovel: Boolean(activeNovel),
    hasChapter: Boolean(launchContext?.chapterId),
  }).map((action) => ({ ...action, icon: iconByIntent[action.intent] }));

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
            aria-label="关闭智能管家"
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
               onClick={() => handleSubmit(
                undefined,
                s.prompt,
                false,
                 buildAssistantActionPlan(s.intent, s.prompt, { novelId: activeNovel?.id, chapterId: launchContext?.chapterId }),
               )}
               title={s.intent === 'draft-prose' ? '给我一段可编辑的正文候选' : s.label}
               className="flex items-center gap-2 p-3 bg-theme-sidebar/20 rounded-xl border border-theme-border/30 hover:border-theme-accent hover:bg-theme-sidebar transition-all group text-left shadow-sm active:scale-95"
             >
              <s.icon size={14} className="text-theme-muted group-hover:text-theme-accent shrink-0" aria-hidden="true" />
              <span className="text-[11px] font-bold text-theme-muted group-hover:text-theme-text truncate">{s.label}</span>
            </button>
          ))}
        </div>
        {activeNovel && !launchContext?.chapterId ? (
          <button
            type="button"
            onClick={() => onStartCreation?.(
              buildAssistantActionPlan(
                'start-creation',
                launchContext?.intent || '创建第一章并开始创作',
                { novelId: activeNovel.id },
              ),
              undefined,
            )}
            className="w-full rounded-md bg-theme-text px-3 py-2.5 text-xs font-bold text-theme-bg"
          >
            创建第一章并开始创作
          </button>
        ) : null}

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
                      const suggestionKind: AssistantSuggestionKind = msg.actionPlan?.intent === 'plan-scene'
                        ? 'scene-beat'
                        : msg.actionPlan?.intent === 'build-setting'
                          ? 'setting'
                          : msg.actionPlan?.intent === 'save-fragment'
                            ? 'fragment'
                            : msg.actionPlan ? 'prose' : classifyAssistantSuggestion(msg.content, launchContext);
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
                          const actionPlan = msg.actionPlan;
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
                              {actionPlan?.intent === 'draft-prose' && launchContext.selectedText && (
                                <ActionButton primary action={() => setPendingCandidate({ plan: actionPlan, content: msg.content })} label="预览选区候选" icon={Sparkles} />
                              )}
                              {actionPlan?.intent === 'draft-prose' && !launchContext.selectedText && (
                                <ActionButton primary action={() => setPendingCandidate({ plan: actionPlan, content: msg.content })} label="预览正文候选" icon={ArrowRight} />
                              )}
                              {actionPlan?.intent === 'plan-scene' && (
                                <ActionButton primary action={() => setPendingCandidate({ plan: actionPlan, content: msg.content })} label="预览分镜候选" icon={Globe} />
                              )}
                              {actionPlan?.intent === 'build-setting' && (
                                <ActionButton primary action={() => onLaunchSettingCandidate?.(actionPlan, msg.content)} label="使用推荐能力生成设定候选" icon={Globe} />
                              )}
                              {actionPlan?.intent === 'plan-structure' && (
                                <ActionButton primary action={() => onStartCreation?.(actionPlan, msg.content)} label="进入完整创作流程" icon={BrainCircuit} />
                              )}
                              {!actionPlan && primaryAction === 'extract-setting' && (
                                <ActionButton primary action={() => handleExtractToCurrentNovel(msg.content)} label="提设定" icon={Globe} />
                              )}
                              {(actionPlan?.intent === 'save-fragment' || (!actionPlan && primaryAction === 'save-fragment')) && (
                                <ActionButton primary action={() => handleSaveAsIdeaFragment(msg.content)} label="存碎片" icon={FolderOpen} />
                              )}
                              {!actionPlan && primaryAction === 'replace-selection' && launchContext.selectedText && (
                                <ActionButton primary action={() => onReplaceSelection?.(msg.content)} label="替换选区" icon={Sparkles} />
                              )}
                              {!actionPlan && primaryAction === 'append-content' && (
                                <ActionButton primary action={() => onApplyToContent?.(msg.content)} label="插到末尾" icon={ArrowRight} />
                              )}
                              {!actionPlan && primaryAction === 'append-scene-beat' && (
                                <ActionButton primary action={() => onApplyToSceneBeats?.(msg.content)} label="补分镜" icon={Globe} />
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

          {session.isLoading && (
            <div className="flex gap-3 p-4 bg-theme-sidebar/10 border border-theme-border/20 rounded-2xl items-center">
              <div
                className="text-theme-accent"
              >
                <Sparkles size={16} aria-hidden="true" />
              </div>
              <span className="text-[11px] font-serif italic text-theme-muted">正在编织灵感...</span>
            </div>
          )}
          {session.failure && (
            <div role="alert" aria-label="助手请求失败" className="flex flex-col gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <div>{failureReasonText || session.failure.message}</div>
              {session.failure.reason && <div className="text-[10px]">原因：{session.failure.reason}</div>}
              {session.failure.finishReason && <div className="text-[10px]">finishReason: {session.failure.finishReason}</div>}
              {session.failure.traceId && <div className="text-[10px]">诊断编号：{session.failure.traceId}</div>}
              <div className="flex flex-wrap gap-3">
                {(session.failure.retriable || session.failure.code === 'empty_response') && (
                  <button type="button" onClick={() => void handleSubmit(undefined, session.failure?.prompt, true)} className="font-bold underline">
                    重试本次请求
                  </button>
                )}
                {['configuration', 'authentication', 'billing'].includes(session.failure.code) && (
                  <button type="button" onClick={() => window.dispatchEvent(new Event('open-settings'))} className="font-bold underline">
                    打开设置
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {pendingCandidate ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 p-4" onClick={() => setPendingCandidate(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="确认应用创作候选"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md rounded-lg border border-theme-border bg-theme-sidebar p-4 shadow-xl"
          >
            <div className="text-sm font-bold text-theme-text">确认应用创作候选</div>
            <div className="mt-2 text-[11px] text-theme-muted">
              {pendingCandidate.plan.scope === 'chapter' ? '本章使用' : '作品范围'} · 推荐能力 {pendingCandidate.plan.recommendedCapabilityId}
            </div>
            <div className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-6 text-theme-text">{pendingCandidate.content}</div>
            <div className="mt-4 flex justify-end gap-2 border-t border-theme-border pt-3">
              <button type="button" onClick={() => setPendingCandidate(null)} className="rounded-md border border-theme-border px-3 py-2 text-xs">取消</button>
              <button
                type="button"
                onClick={() => {
                  if (pendingCandidate.plan.intent === 'plan-scene') void onApplyToSceneBeats?.(pendingCandidate.content);
                  else if (launchContext?.selectedText) void onReplaceSelection?.(pendingCandidate.content);
                  else void onApplyToContent?.(pendingCandidate.content);
                  setPendingCandidate(null);
                }}
                className="rounded-md bg-theme-text px-3 py-2 text-xs font-bold text-theme-bg"
              >
                {pendingCandidate.plan.intent === 'plan-scene' ? '确认写入分镜' : launchContext?.selectedText ? '确认替换选区' : '确认写入正文'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
            onChange={(e) => sessionStore.setInput(sessionKey, 'general', e.target.value)}
            className="flex-1 pl-3 py-2 bg-transparent outline-none text-xs text-theme-text placeholder:text-theme-muted"
          />
          <button
            type="submit"
            disabled={session.isLoading}
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
              <p className="text-xs text-theme-muted mb-4">选择一个作品，AI 会先提取当前卡片中的角色、地点、物品等结构化知识；确认提取结果后再写入该作品的「设定集」。</p>

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
                      disabled={isExtracting}
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
