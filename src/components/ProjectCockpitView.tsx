import React, { useState, useEffect, useRef } from 'react';
import {
  BookOpen, Sparkles, BrainCircuit,
  User,
  AlertCircle, Database, RefreshCw
} from 'lucide-react';
import { Novel, Chapter, ChapterMetadata, Character, Location, Item, Faction, ContinuationPack, AssistantMode, AssistantSurfaceContext } from '../../shared/types';
import {
  listChaptersMetadata, getChapter, listCharacters, listLocations, listItems,
  listFactions, listContinuationPacks, getNovel
} from '../lib/api';
import { ScrollArea } from './ui/scroll-area';
import { deriveProjectWorkflowState, type WorkflowAction } from '../lib/workflow-state';
import { writeContinuationSyncIntent } from '../lib/continuation-sync-intent';
import { recordProductEvent } from '../lib/product-events-client';
import { getCapabilityManifest, getGovernanceStageForWorkflowPhase, getGovernedStageRecommendations, type CapabilityLaunchContext, type GovernanceCapabilityType } from '../lib/capability-governance';
import { sanitizeWhiteLabelText, SKILL_SERIES_FLOWS } from '../../shared/lib/public-skill-catalog';
import { getWorkflowDisplay } from '../lib/workflow-display-registry';
import type { CuratedProductSkill } from '../../shared/types/prompt-assets-governed';
import { deriveLlmAvailability, LLM_AVAILABILITY_COPY, type LlmAvailabilityState } from '../lib/llm-availability';

interface ProjectCockpitViewProps {
  novel: Novel;
  onNavigate: (view: 'welcome' | 'library' | 'editor' | 'world' | 'skills' | 'factory' | 'continuation-import') => void;
  onOpenCapabilities?: (context: CapabilityLaunchContext) => void;
  onStartCockpitAction?: (action: 'planning' | 'production' | 'resume' | 'audit' | 'polish' | 'complete-chapter' | 'resolve-issues' | 'confirm-facts' | 'next_chapter', targetChapterId?: string) => void;
  onSelectChapter?: (chapter: Chapter | null) => void;
  onStartContinuationWriting?: (packId: string) => void;
  onEnterStoryboard?: (packId: string) => void;
  onOpenAssistant?: (mode: AssistantMode, context: AssistantSurfaceContext) => void;
}

function getStageRecommendationLabel(capability: GovernanceCapabilityType, asset: CuratedProductSkill): string {
  if (capability === 'flow') return '创作流程';
  if (capability === 'skill-card') return '拆书卡';
  if (capability === 'diagnostic') return '审稿卡';
  if (capability === 'utility') return '辅助动作';
  if (capability === 'guardrail') return '系统护栏';
  if (capability === 'overlay') return '本章使用';
  if (capability === 'technique') return getCapabilityManifest(asset).output === 'transform-preview' ? '精修卡' : '写作技法';
  return '能力卡';
}

export function ProjectCockpitView({
  novel: initialNovel,
  onNavigate,
  onOpenCapabilities,
  onStartCockpitAction,
  onSelectChapter,
  onStartContinuationWriting,
  onEnterStoryboard,
  onOpenAssistant,
}: ProjectCockpitViewProps) {
  const [novel, setNovel] = useState<Novel>(initialNovel);
  const [chapters, setChapters] = useState<ChapterMetadata[]>([]);
  const [latestFullChapter, setLatestFullChapter] = useState<Chapter | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [factions, setFactions] = useState<Faction[]>([]);
  const [packs, setPacks] = useState<ContinuationPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [llmAvailability, setLlmAvailability] = useState<LlmAvailabilityState>('unknown');
  const requestSeqRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);

  const fetchProjectData = async () => {
    const requestSeq = ++requestSeqRef.current;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const [
        freshNovel,
        freshChapters,
        freshCharacters,
        freshLocations,
        freshItems,
        freshFactions,
        freshPacks
      ] = await Promise.all([
        getNovel(initialNovel.id),
        listChaptersMetadata(initialNovel.id),
        listCharacters(initialNovel.id),
        listLocations(initialNovel.id),
        listItems(initialNovel.id),
        listFactions(initialNovel.id),
        listContinuationPacks(initialNovel.id)
      ]);

      if (controller.signal.aborted || requestSeqRef.current !== requestSeq) return;

      if (freshNovel) {
        setNovel(freshNovel);
      }
      setChapters(freshChapters);
      setCharacters(freshCharacters);
      setLocations(freshLocations);
      setItems(freshItems);
      setFactions(freshFactions);
      setPacks(freshPacks);

      const latestMeta = [...freshChapters].sort((a, b) => b.order - a.order)[0] || null;
      const fullChapter = latestMeta ? await getChapter(latestMeta.id) : null;
      if (controller.signal.aborted || requestSeqRef.current !== requestSeq) return;
      setLatestFullChapter(fullChapter || null);
    } catch (err) {
      if (controller.signal.aborted || requestSeqRef.current !== requestSeq) return;
      setError(err instanceof Error ? err.message : '获取数据失败，请重试');
    } finally {
      if (requestSeqRef.current === requestSeq) {
        setLoading(false);
        if (requestControllerRef.current === controller) requestControllerRef.current = null;
      }
    }
  };

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    fetchProjectData();
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount or initialNovel change
  }, [initialNovel.id]);

  useEffect(() => () => {
    requestSeqRef.current += 1;
    requestControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/config', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) setLlmAvailability(deriveLlmAvailability(data));
      })
      .catch((reason) => {
        if (!(reason instanceof Error && reason.name === 'AbortError')) setLlmAvailability('unknown');
      });
    return () => controller.abort();
  }, []);

  // Compute stats
  const worldEntitiesCount = characters.length + locations.length + items.length + factions.length;
  const capabilityProfile = novel.projectPreferenceProfile?.capabilityProfile;
  const configuredCapabilityCount = new Set([
    capabilityProfile?.projectSkillDeck?.mainCardId,
    ...(capabilityProfile?.projectSkillDeck?.supportCardIds || []),
    ...(capabilityProfile?.favoriteTechniqueIds || []),
    ...(capabilityProfile?.guardrailIds || []),
    ...(capabilityProfile?.capabilityMemberships || []).map((entry) => entry.persistedSkillId || entry.sourceId),
  ].filter(Boolean)).size;

  const latestChapter = [...chapters].sort((a, b) => b.order - a.order)[0] || null;
  const latestFullChapterMatches = !!latestChapter && latestFullChapter?.id === latestChapter.id;
  const latestHasBeats = latestFullChapterMatches && !!latestFullChapter?.sceneBeats?.trim();
  const approvedPacks = packs.filter((pack) => pack.status === 'approved');
  const draftPackCount = packs.length - approvedPacks.length;
  const approvedContinuationPack = [...approvedPacks]
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;

  const workflowState = deriveProjectWorkflowState({
    loading: loading || Boolean(latestChapter && !latestFullChapterMatches),
    chapter: latestFullChapterMatches ? latestFullChapter : null,
    packStatus: approvedContinuationPack ? 'approved' : 'none',
    syncState: approvedContinuationPack?.syncState?.status || 'unknown',
  });
  const capabilityStage = getGovernanceStageForWorkflowPhase(workflowState.phase);
  const stageRecommendations = getGovernedStageRecommendations(capabilityStage);
  const activeFlowId = novel.projectPreferenceProfile?.capabilityProfile?.activeFlowId
    || novel.projectPreferenceProfile?.activeSeriesId
    || 'generic-novel-flow';
  const activeFlow = SKILL_SERIES_FLOWS.find((flow) => flow.id === activeFlowId) || SKILL_SERIES_FLOWS.find((flow) => flow.id === 'generic-novel-flow');

  const primaryActionLabel = workflowState.primaryAction ? getWorkflowDisplay(workflowState.primaryAction).primaryAction : '继续编辑';
  const primaryActionDescription = workflowState.primaryAction === 'sync' ? '接入本章上下文是推荐准备动作；也可以先打开编辑器手写正文。'
    : workflowState.primaryAction === 'generate-plan' ? '先建立本章分镜，或先打开编辑器手写正文。'
      : workflowState.primaryAction === 'generate-prose' ? '分镜已就绪，可以生成正文，也可以继续手写。'
        : workflowState.primaryAction === 'complete-chapter' ? '完成本章会编排保存、审阅与事实确认；内容变化后会重新检查。'
          : workflowState.primaryAction === 'resolve-issues' ? '审阅发现问题，可回到正文或按证据预览局部修订。'
            : workflowState.primaryAction === 'confirm-facts' ? '确认正文产生的事实后再进入下一章。'
              : workflowState.primaryAction === 'create-next-chapter' ? '本章审阅和事实决定均已完成，可以进入下一章。'
                : '继续当前创作步骤。';
  const llmCopy = LLM_AVAILABILITY_COPY[llmAvailability];
  const llmStatusClass = llmAvailability === 'connected'
    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700'
    : llmAvailability === 'missing'
      ? 'border-amber-500/40 bg-amber-500/5 text-amber-800'
      : 'border-amber-500/40 bg-amber-500/5 text-amber-800';


  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-paper p-8">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-theme-accent border-t-transparent" />
          <div className="text-sm font-bold text-theme-muted">正在装载创作工作台...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-paper p-8">
        <div className="max-w-md text-center space-y-4">
          <AlertCircle className="mx-auto text-red-600" size={40} />
          <h3 className="text-lg font-bold text-theme-text">装载数据出错</h3>
          <p className="text-xs text-theme-muted leading-relaxed">{error}</p>
          <button
            onClick={fetchProjectData}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-theme-bg bg-theme-text rounded-lg hover:bg-theme-text/90 transition-colors"
          >
            <RefreshCw size={14} />
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-paper flex flex-col min-h-0 relative select-none">
      {/* Cockpit Header */}
      <div className="shrink-0 border-b border-theme-border/60 bg-theme-bg/30 px-4 py-4 sm:px-6 sm:py-6 space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="w-full sm:w-auto min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-theme-accent/15 text-theme-accent border border-theme-accent/25 uppercase tracking-wide">作品总览</span>
              <h1 className="text-2xl font-serif font-black text-theme-text leading-tight">{novel.title}</h1>
            </div>
            <p className="text-xs text-theme-muted max-w-3xl leading-relaxed mt-1 line-clamp-3 sm:line-clamp-none">
              {novel.summary || '暂无作品简介。可以在「我的书库」或编辑器中修改简介。'}
            </p>
          </div>
          <div className="flex w-full sm:w-auto flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              aria-label="打开智能管家"
              onClick={() => onOpenAssistant?.('general', { surface: 'workspace', novelId: novel.id })}
              className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-theme-accent/40 text-xs text-theme-accent hover:bg-theme-accent/10 transition-colors font-medium cursor-pointer"
            >
              <Sparkles size={14} />
              智能管家
            </button>
            <button
              type="button"
              onClick={() => onNavigate('library')}
              className="flex-1 sm:flex-none px-3 py-1.5 rounded-lg border border-theme-border text-xs text-theme-muted hover:text-theme-text hover:bg-theme-border/30 transition-colors font-medium cursor-pointer"
            >
              切换作品
            </button>
          </div>
        </div>

        {/* Global Outline Insight */}
        {novel.globalOutline && (
          <div className="rounded-xl border border-theme-border bg-theme-sidebar/20 p-3 text-xs leading-relaxed text-theme-muted/80 line-clamp-3 sm:line-clamp-none">
            <span className="font-bold text-theme-text">核心主线/大纲：</span>
            {novel.globalOutline.length > 150 ? `${novel.globalOutline.slice(0, 150)}...` : novel.globalOutline}
          </div>
        )}
      </div>

      {/* Grid Dashboard Content */}
      <div className="flex-1 min-h-0 relative">
        <ScrollArea className="h-full px-4 py-4 sm:px-6 sm:py-6">
          <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-6 pb-6 items-start">

            {/* Left Column: Stats & Operations */}
            <div className="space-y-6">
              {chapters.length > 0 && latestChapter && latestFullChapterMatches && workflowState.primaryAction && (
                <div className="rounded-xl border border-theme-accent/30 bg-theme-sidebar/10 p-4 sm:p-5 space-y-4 transition-colors hover:border-theme-accent/50">
                  <div className="flex items-center justify-between border-b border-theme-border/30 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold text-theme-accent uppercase tracking-widest">
                        当前创作阶段
                      </span>
                    </div>
                    <span className="px-2 py-0.5 text-[9px] font-mono font-bold rounded bg-theme-accent/15 text-theme-accent border border-theme-accent/20 uppercase tracking-wider">
                      {getWorkflowDisplay(workflowState.phase).stage}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-sm sm:text-base font-serif font-black text-theme-text leading-relaxed tracking-wide">
                      「{latestChapter.title}」 · {primaryActionLabel}
                    </h3>
                    <p className="text-[11px] text-theme-muted/90 leading-relaxed max-w-[70ch] font-sans">
                      {primaryActionDescription}
                    </p>
                  </div>

                  <div data-testid="cockpit-llm-availability" className={`rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${llmStatusClass}`}>
                    <span className="font-bold">AI 状态：{llmCopy.label}</span>
                    <span className="ml-2">{llmCopy.helper}</span>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 pt-1.5">
                    <button
                      data-testid="cockpit-primary-action"
                      onClick={() => {
                        if (workflowState.primaryAction === 'sync' && approvedContinuationPack) {
                          writeContinuationSyncIntent({ intentId: '', createdAt: 0, novelId: novel.id, packId: approvedContinuationPack.id });
                          onNavigate('world');
                          return;
                        }
                        if (onSelectChapter && latestFullChapterMatches) {
                          onSelectChapter(latestFullChapter);
                        }
                        if (onStartCockpitAction && latestChapter && workflowState.primaryAction) {
                          const action = workflowState.primaryAction as WorkflowAction;
                          const launchAction = action === 'generate-plan' ? 'planning'
                            : action === 'generate-prose' ? 'production'
                              : action === 'complete-chapter' ? 'complete-chapter'
                                : action === 'resolve-issues' ? 'resolve-issues'
                                  : action === 'confirm-facts' ? 'confirm-facts'
                                    : action === 'create-next-chapter' ? 'next_chapter'
                                      : action === 'drafting' ? 'production' : action as 'planning' | 'resume' | 'audit' | 'polish' | 'next_chapter';
                          onStartCockpitAction(launchAction, latestChapter.id);
                        } else {
                          onNavigate('editor');
                        }
                      }}
                      className="px-4 py-2.5 bg-theme-text text-theme-bg hover:bg-theme-text/90 text-xs font-black rounded-lg transition-colors flex items-center justify-center gap-2 shadow-md font-sans cursor-pointer tracking-wider"
                    >
                      <BookOpen size={14} className="text-theme-accent" />
                      {primaryActionLabel}
                    </button>

                    <button
                      onClick={() => {
                        if (onSelectChapter && latestFullChapterMatches) {
                          onSelectChapter(latestFullChapter);
                        }
                        if (workflowState.phase === 'sync') {
                          void recordProductEvent({
                            eventName: 'continuation_skip',
                            stage: 'sync',
                            result: 'success',
                            novelId: novel.id,
                            chapterId: latestChapter.id,
                            objectId: approvedContinuationPack?.id,
                          });
                        }
                        if (onStartCockpitAction && latestChapter) {
                          onStartCockpitAction('resume', latestChapter.id);
                        } else {
                          onNavigate('editor');
                        }
                      }}
                      className="px-4 py-2.5 border border-theme-border/80 text-theme-muted hover:text-theme-text hover:bg-theme-border/30 hover:border-theme-accent/30 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer font-sans"
                    >
                      <Sparkles size={14} className="text-theme-muted" />
                      进入正文编辑
                    </button>
                  </div>
                  <p className="text-[10px] text-theme-muted">手动正文编辑始终可用。</p>
                </div>
              )}

              {chapters.length === 0 && (
                <div className="rounded-xl border border-theme-accent/30 bg-theme-sidebar/10 p-4 sm:p-5 space-y-4 transition-colors hover:border-theme-accent/50">
                  <div className="space-y-2">
                    <span className="text-[10px] font-mono font-bold text-theme-accent uppercase tracking-widest">开始创作</span>
                    <p className="text-[11px] text-theme-muted/90 leading-relaxed">还没有章节，创建第一章后即可进入正文编辑。</p>
                  </div>
                  <button
                    data-testid="cockpit-first-chapter-action"
                    onClick={() => {
                      if (onStartCockpitAction) {
                        onStartCockpitAction('resume');
                      } else {
                        onNavigate('editor');
                      }
                    }}
                    className="px-4 py-2.5 bg-theme-text text-theme-bg hover:bg-theme-text/90 text-xs font-black rounded-lg transition-colors flex items-center justify-center gap-2 shadow-md font-sans cursor-pointer tracking-wider"
                  >
                    <BookOpen size={14} className="text-theme-accent" />
                    创建第一章并开始写作
                  </button>
                </div>
              )}

            </div>

            {/* Right Column: Read-only project overview */}
            <div className="space-y-6">
              <div className="border border-theme-border/40 bg-theme-sidebar/10 rounded-xl p-5 space-y-4">
                <div className="border-b border-theme-border/40 pb-3">
                  <h3 className="text-xs font-bold text-theme-text uppercase tracking-wider font-mono">作品资料概览 / 已配置</h3>
                  <p className="mt-1 text-[10px] text-theme-muted leading-relaxed">仅展示当前作品已保存的资料数量，不代表运行时注入、同步或模型读取证明。</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                  <div><span className="block text-[10px] text-theme-muted">章节</span><span className="font-bold text-theme-text">{chapters.length}</span></div>
                  <div><span className="block text-[10px] text-theme-muted">设定条目</span><span className="font-bold text-theme-text">{worldEntitiesCount}</span></div>
                  <div><span className="block text-[10px] text-theme-muted">能力卡</span><span className="font-bold text-theme-text">{configuredCapabilityCount} 项</span></div>
                  <div><span className="block text-[10px] text-theme-muted">审核状态</span><span className="font-bold text-theme-text">已确认 {approvedPacks.length} · 待审核 {draftPackCount}</span></div>
                  <div><span className="block text-[10px] text-theme-muted">本章接入状态</span><span className="font-bold text-theme-text">{approvedContinuationPack?.syncState?.status === 'synced' ? '已接入' : approvedContinuationPack ? '待接入' : '无资料'}</span></div>
                  <div><span className="block text-[10px] text-theme-muted">最新章节分镜</span><span className="font-bold text-theme-text">{latestHasBeats ? '已配置' : '未配置'}</span></div>
                  <div><span className="block text-[10px] text-theme-muted">全局大纲</span><span className="font-bold text-theme-text">{novel.globalOutline?.trim() ? '已配置' : '未配置'}</span></div>
                </div>
              </div>

              {/* Read-only v3 capability summary */}
              <div className="border border-theme-border/40 bg-theme-sidebar/10 rounded-xl p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-theme-text uppercase tracking-wider font-mono flex items-center gap-1">
                    <BrainCircuit size={12} className="text-theme-accent" />
                    当前作品能力卡
                  </span>
                  <span className="text-[10px] font-mono text-theme-muted">只读摘要</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded border border-theme-accent/30 bg-theme-accent/5 px-2 py-1 text-[10px] text-theme-text">
                    流程 · {activeFlow?.name || '通用创作流程'}
                  </span>
                  {stageRecommendations.filter(({ capability }) => capability !== 'role-skill').map(({ capability, asset }) => (
                    <span key={`${capability}:${asset.id}`} className="rounded border border-theme-border/40 bg-theme-bg/40 px-2 py-1 text-[10px] text-theme-muted">
                      {getStageRecommendationLabel(capability, asset)} · {sanitizeWhiteLabelText(asset.title)}
                    </span>
                  ))}
                </div>
                <div className="border-t border-theme-border/25 pt-2.5 flex items-center justify-between gap-3">
                  <p className="text-[10px] text-theme-muted leading-relaxed">
                    当前阶段：<span className="font-bold text-theme-text">{getWorkflowDisplay(workflowState.phase).stage}</span> · 能力配置请在中心查看
                  </p>
                  <button
                    type="button"
                    onClick={() => onOpenCapabilities?.({ novelId: novel.id, stage: capabilityStage })}
                    className="shrink-0 px-2.5 py-1.5 rounded-md border border-theme-accent/40 text-[10px] font-bold text-theme-accent hover:bg-theme-accent/10 transition-colors"
                  >
                    管理能力
                  </button>
                </div>
              </div>

              {/* Continuation Packs Detail */}
              <div className="border border-theme-border/40 bg-theme-sidebar/10 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-theme-text uppercase tracking-wider font-mono flex items-center gap-1">
                    <Database size={12} className="text-theme-accent" />
                    Continuation Packs / 资料包
                  </span>
                  <span className="text-[10px] font-mono text-theme-muted">审核状态：已确认 {approvedPacks.length} · 待审核 {draftPackCount}</span>
                </div>
                <div className="space-y-1.5">
                  {packs.map(p => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between p-2 rounded border border-theme-border/40 bg-theme-bg/20 text-xs gap-3 group"
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="truncate font-medium text-theme-text text-[11px]">{p.title}</span>
                        <span className="text-[9px] font-mono text-theme-muted mt-0.5">{p.status === 'approved' ? '审核通过' : '待审核'} · 本章接入：{p.syncState?.status === 'synced' ? '已接入' : '未接入'}</span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                        {p.status === 'approved' && onEnterStoryboard && (
                          <button
                            onClick={() => onEnterStoryboard(p.id)}
                            className="px-1.5 py-0.5 rounded text-[9px] font-bold border border-theme-border bg-theme-sidebar hover:bg-theme-border/40 text-theme-text transition-colors cursor-pointer"
                            title="将此资料包接入章节分镜规划"
                          >
                            接入分镜
                          </button>
                        )}
                        {p.status === 'approved' && onStartContinuationWriting && (
                          <button
                            onClick={() => onStartContinuationWriting(p.id)}
                            className="px-1.5 py-0.5 rounded text-[9px] font-bold text-theme-bg bg-theme-text hover:opacity-90 transition-colors cursor-pointer"
                            title="将此资料包接入正文续写"
                          >
                            接入续写
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {packs.length === 0 && (
                    <div className="text-[10px] text-theme-muted/80 italic py-0.5">暂无资料包。</div>
                  )}
                </div>
              </div>

              {/* World Bible Entities Summary */}
              <div className="border border-theme-border/40 bg-theme-sidebar/10 rounded-xl p-4 space-y-3">
                <span className="text-[10px] font-bold text-theme-text uppercase tracking-wider font-mono flex items-center gap-1">
                  <User size={12} className="text-theme-accent" />
                  World Bible / 设定集总览
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 rounded border border-theme-border/30 bg-theme-bg/20 space-y-0.5">
                    <div className="text-[9px] font-mono font-bold text-theme-muted uppercase tracking-wider">Characters / 核心人物</div>
                    <div className="text-sm font-mono font-bold text-theme-text">{characters.length} <span className="text-[9px] font-sans font-normal text-theme-muted">人</span></div>
                  </div>
                  <div className="p-2.5 rounded border border-theme-border/30 bg-theme-bg/20 space-y-0.5">
                    <div className="text-[9px] font-mono font-bold text-theme-muted uppercase tracking-wider">Locations / 场景与组织</div>
                    <div className="text-sm font-mono font-bold text-theme-text">{locations.length + factions.length} <span className="text-[9px] font-sans font-normal text-theme-muted">个</span></div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
