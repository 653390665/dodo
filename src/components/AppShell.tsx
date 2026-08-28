import { useCallback, useEffect, useRef, useState, Suspense, lazy } from 'react';
import { Sidebar } from './Sidebar';
import { PremiumUpgradeModal } from './commercial/PremiumUpgradeModal';
import { WelcomeView } from './WelcomeView';
import { ErrorBoundary } from './ErrorBoundary';
import { toast } from '../lib/toast';

const Library = lazy(() => import('./Library').then(m => ({ default: m.Library })));
const AIAssistantDrawer = lazy(() => import('./AIAssistantDrawer').then(m => ({ default: m.AIAssistantDrawer })));
const EditorView = lazy(() => import('./EditorView').then(m => ({ default: m.EditorView })));
const WorldBibleView = lazy(() => import('./WorldBibleView').then(m => ({ default: m.WorldBibleView })));
const ContinuationImportView = lazy(() => import('./ContinuationImportView').then(m => ({ default: m.ContinuationImportView })));
const SkillsStudioView = lazy(() => import('./SkillsStudioView').then(m => ({ default: m.SkillsStudioView })));
const BookFactoryView = lazy(() => import('./BookFactoryView').then(m => ({ default: m.BookFactoryView })));
const ProjectCockpitView = lazy(() => import('./ProjectCockpitView').then(m => ({ default: m.ProjectCockpitView })));

import { useShallow } from 'zustand/react/shallow';
import type { AssistantActionPlan, AssistantLaunchContext, AssistantMode, AssistantSurfaceContext, CapabilityLaunchState, ContinuationEditorLaunchState, ContinuationGap, SetupTaskKey, StoryIdeaCard, StoryPlanningInput, ViewType, Novel, WorkspaceNavKey, WorldCapabilityLaunchIntent } from '../../shared/types';
import { useAppStore } from '../stores/app-store';
import { isEditorCapabilityLaunchAction } from '../lib/capability-launch';
import { useAssistantSessionStore } from '../stores/assistant-session-store';
import { clearStoredSelectedNovelId, getStoredSelectedNovelId, useNovelStore } from '../stores/novel-store';
import { createCharacter, generateStoryCards, getNovel, listChapters, listSkills, refineSetupTask, updateChapter, updateNovel, updateCharacter } from '../lib/api';
import { createNovelWithChapter } from '../lib/novel-client';
import { listCharacters, listTimelineEvents } from '../lib/world-client';
import { listForeshadowings } from '../lib/foreshadowing-client';
import { buildProjectPreferenceProfileFromPlanning, buildSetupTasksFromStoryCard, countCompletedSetupTasks, recommendSkillsForStoryCard } from '../lib/onboarding-model';
const SettingsModal = lazy(() => import('./SettingsModal').then(m => ({ default: m.SettingsModal })));
import { deriveWorkspaceFocus, isWorkspaceFamilyView } from '../lib/workspace-nav';
import { appendAssistantTextToChapterContent, appendAssistantTextToSceneBeats, replaceAssistantTextInSelection } from '../lib/assistant-apply';
import { flushPendingEditorWrites } from '../lib/editor-write-queue';
import { BookOpen, BrainCircuit, Globe2, Layers3, PenLine, Sparkles, Wand2 } from 'lucide-react';
import { matchesShortcut, SHORTCUTS } from '../lib/keyboard-shortcuts';
import { recordProductEvent } from '../lib/product-events-client';
import type { CapabilityLaunchContext } from '../lib/capability-governance';
import { getDatabaseGenerationSnapshot } from '../lib/db-transport';
import { buildV3CapabilityProfile } from '../lib/skills-studio-governance';

const LOCAL_USER = { uid: 'local-user' };
type NavigationContext = { targetChapterId?: string; stage?: CapabilityLaunchContext['stage']; capabilityApplied?: boolean; targetFocus?: WorkspaceNavKey; worldCapabilityLaunch?: WorldCapabilityLaunchIntent };
const CAPABILITY_APPLIED_TOAST = '能力配置已应用：作品卡组与常用技法影响后续正文，本章使用规则只影响当前章。';

function WorkspacePreviewEmptyState({
  title,
  description,
  onGoLibrary,
  onCreateNovel,
  onImport,
}: {
  title: string;
  description: string;
  onGoLibrary: () => void;
  onCreateNovel: () => void;
  onImport: () => void;
}) {
  const previewItems = [
    { label: '章节写作', detail: '分镜、正文、审查反馈在同一条链路里推进。', icon: PenLine },
    { label: '世界观记忆', detail: '人物、地点、物品和规则跟作品绑定。', icon: Globe2 },
    { label: '作品能力中心', detail: '文风、节奏、人物滤镜会影响下一章生成。', icon: Wand2 },
    { label: 'AI 协作', detail: '助手会基于当前作品与章节上下文协作。', icon: BrainCircuit },
  ];

  return (
    <div className="h-full overflow-y-auto bg-theme-bg/30 p-8">
      <div className="mx-auto flex min-h-full max-w-6xl flex-col justify-center gap-8">
        <div className="text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl border border-theme-border bg-theme-sidebar text-theme-accent shadow-sm">
            <Layers3 size={24} />
          </div>
          <h2 className="text-3xl font-serif font-bold text-theme-text">{title}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-theme-muted">{description}</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
          <div className="rounded-3xl border border-theme-border bg-theme-sidebar p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-theme-muted">工作台预览</div>
                <div className="mt-1 text-lg font-serif font-bold text-theme-text">选择作品后，这里会成为创作驾驶舱</div>
              </div>
              <span className="rounded-full border border-theme-accent/20 bg-theme-accent/5 px-3 py-1 text-[11px] font-bold text-theme-accent">
                预览
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {previewItems.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="rounded-2xl border border-theme-border bg-theme-bg/50 p-4">
                    <div className="flex items-center gap-2">
                      <span className="flex size-8 items-center justify-center rounded-xl bg-theme-accent/10 text-theme-accent">
                        <Icon size={15} />
                      </span>
                      <div className="text-sm font-bold text-theme-text">{item.label}</div>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-theme-muted">{item.detail}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-theme-border bg-theme-sidebar p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles size={18} className="text-theme-accent" />
              <div className="text-sm font-bold text-theme-text">下一步</div>
            </div>
            <div className="space-y-3">
              <button
                onClick={onGoLibrary}
                className="w-full rounded-2xl bg-theme-text px-4 py-3 text-left text-sm font-bold text-theme-bg shadow-sm transition-opacity hover:opacity-90"
              >
                选择已有作品
                <span className="mt-1 block text-[11px] font-normal opacity-80">进入作品后可打开编辑器写作、整理设定和配置能力卡。</span>
              </button>
              <button
                onClick={onCreateNovel}
                className="w-full rounded-2xl border border-theme-border px-4 py-3 text-left text-sm font-bold text-theme-text transition-colors hover:border-theme-accent"
              >
                创建新作品
                <span className="mt-1 block text-[11px] font-normal text-theme-muted">先建项目，再补世界观和第一章。</span>
              </button>
              <button
                onClick={onImport}
                className="w-full rounded-2xl border border-theme-accent/30 bg-theme-accent/5 px-4 py-3 text-left text-sm font-bold text-theme-accent transition-colors hover:border-theme-accent"
              >
                导入资料续写
                <span className="mt-1 block text-[11px] font-normal text-theme-muted">把已有设定、大纲、正文整理成可写上下文。</span>
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-3 text-xs text-theme-muted md:grid-cols-3">
          <div className="rounded-2xl border border-theme-border bg-theme-sidebar/60 p-4">
            <BookOpen size={16} className="mb-2 text-theme-accent" />
            作品是所有写作上下文的容器。
          </div>
          <div className="rounded-2xl border border-theme-border bg-theme-sidebar/60 p-4">
            <Globe2 size={16} className="mb-2 text-theme-accent" />
            设定集会帮助 AI 记住人物与规则。
          </div>
          <div className="rounded-2xl border border-theme-border bg-theme-sidebar/60 p-4">
            <Wand2 size={16} className="mb-2 text-theme-accent" />
            能力卡会影响章节生成和打磨。
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppShell() {
  const {
    currentView, setCurrentView,
    workspaceFocus,
    setWorkspaceFocus,
    theme, setTheme,
    isSettingsOpen, setSettingsOpen,
    isAIAssistantOpen,
    assistantMode, assistantSurfaceContext, openAssistant, closeAssistant,
    aiDrawerTab, setAIDrawerTab,
  } = useAppStore(
    useShallow((state) => ({
      currentView: state.currentView,
      setCurrentView: state.setCurrentView,
      workspaceFocus: state.workspaceFocus,
      setWorkspaceFocus: state.setWorkspaceFocus,
      theme: state.theme,
      setTheme: state.setTheme,
      isSettingsOpen: state.isSettingsOpen,
      setSettingsOpen: state.setSettingsOpen,
      isAIAssistantOpen: state.isAIAssistantOpen,
      assistantMode: state.assistantMode,
      assistantSurfaceContext: state.assistantSurfaceContext,
      openAssistant: state.openAssistant,
      closeAssistant: state.closeAssistant,
      aiDrawerTab: state.aiDrawerTab,
      setAIDrawerTab: state.setAIDrawerTab,
    }))
  );

  const {
    selectedNovel, setSelectedNovel,
    onboardingDraft, setOnboardingDraft,
    activeSetupTaskKey, setActiveSetupTaskKey,
    batchCounter, incrementBatchCounter,
    assistantLaunchContext, setAssistantLaunchContext,
    continuationLaunchState, setContinuationLaunchState,
    capabilityLaunchState, setCapabilityLaunchState, consumeCapabilityLaunch,
  } = useNovelStore(
    useShallow((state) => ({
      selectedNovel: state.selectedNovel,
      setSelectedNovel: state.setSelectedNovel,
      onboardingDraft: state.onboardingDraft,
      setOnboardingDraft: state.setOnboardingDraft,
      activeSetupTaskKey: state.activeSetupTaskKey,
      setActiveSetupTaskKey: state.setActiveSetupTaskKey,
      batchCounter: state.batchCounter,
      incrementBatchCounter: state.incrementBatchCounter,
      assistantLaunchContext: state.assistantLaunchContext,
      setAssistantLaunchContext: state.setAssistantLaunchContext,
      continuationLaunchState: state.continuationLaunchState,
      setContinuationLaunchState: state.setContinuationLaunchState,
      capabilityLaunchState: state.capabilityLaunchState,
      setCapabilityLaunchState: state.setCapabilityLaunchState,
      consumeCapabilityLaunch: state.consumeCapabilityLaunch,
    }))
  );

  const [user] = useState(LOCAL_USER);
  const [loading, setLoading] = useState(false);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [capabilityLaunchContext, setCapabilityLaunchContext] = useState<CapabilityLaunchContext | null>(null);
  const [worldCapabilityLaunch, setWorldCapabilityLaunch] = useState<WorldCapabilityLaunchIntent | null>(null);
  const [skillsReturnTarget, setSkillsReturnTarget] = useState<{ view: 'editor' | 'workspace'; targetChapterId?: string }>({ view: 'workspace' });
  const [editorReturnTarget, setEditorReturnTarget] = useState<{ novelId: string; chapterId?: string } | null>(null);
  const [editorChapterContext, setEditorChapterContext] = useState<{
    novelId: string;
    chapterId?: string;
    writingStyleFingerprint?: string;
  } | null>(null);
  const [factoryGenerationContext, setFactoryGenerationContext] = useState<{
    novelId: string;
    chapterId: string;
    databaseGeneration: number;
  } | null>(null);
  const [continuationImportNovelId, setContinuationImportNovelId] = useState<string | undefined>();
  const [isRestoringSelectedNovel, setIsRestoringSelectedNovel] = useState(
    () => isWorkspaceFamilyView(currentView) && !selectedNovel,
  );
  const previousSelectedNovelIdRef = useRef(selectedNovel?.id);
  const previousEditorViewRef = useRef<ViewType | null>(null);
  const lastEditorEnterNovelIdRef = useRef<string | undefined>(undefined);

  const handleEditorChapterContextChange = useCallback((context: {
    chapterId?: string;
    writingStyleFingerprint?: string;
  }) => {
    if (!selectedNovel) return;
    setEditorChapterContext((previous) => {
      if (
        previous?.novelId === selectedNovel.id
        && previous.chapterId === context.chapterId
        && previous.writingStyleFingerprint === context.writingStyleFingerprint
      ) return previous;
      return { novelId: selectedNovel.id, ...context };
    });
  }, [selectedNovel]);

  useEffect(() => {
    if (
      currentView !== 'factory'
      || !selectedNovel
      || editorChapterContext?.novelId !== selectedNovel.id
      || !editorChapterContext.chapterId
    ) return;
    const controller = new AbortController();
    const novelId = selectedNovel.id;
    const chapterId = editorChapterContext.chapterId;
    void getDatabaseGenerationSnapshot(controller.signal)
      .then((databaseGeneration) => {
        if (controller.signal.aborted) return;
        setFactoryGenerationContext({ novelId, chapterId, databaseGeneration });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          toast('暂时无法读取数据库版本，拆书分析仍可继续，章节试跑暂不可用。', 'info');
        }
      });
    return () => controller.abort();
  }, [currentView, editorChapterContext?.chapterId, editorChapterContext?.novelId, selectedNovel]);

  useEffect(() => {
    if (currentView === 'editor' && selectedNovel && (
      previousEditorViewRef.current !== 'editor' || lastEditorEnterNovelIdRef.current !== selectedNovel.id
    )) {
      lastEditorEnterNovelIdRef.current = selectedNovel.id;
      void recordProductEvent({
        eventName: 'editor_enter',
        stage: 'drafting',
        result: 'success',
        novelId: selectedNovel.id,
      });
    }
    previousEditorViewRef.current = currentView;
  }, [currentView, selectedNovel]);

  useEffect(() => {
    const previousNovelId = previousSelectedNovelIdRef.current;
    const nextNovelId = selectedNovel?.id;
    if (previousNovelId && nextNovelId && previousNovelId !== nextNovelId) {
      closeAssistant();
      setAssistantLaunchContext(null);
      setCapabilityLaunchState(null);
      setWorldCapabilityLaunch(null);
    }
    previousSelectedNovelIdRef.current = nextNovelId;
  }, [closeAssistant, selectedNovel?.id, setAssistantLaunchContext, setCapabilityLaunchState]);

  useEffect(() => {
    const initialView = useAppStore.getState().currentView;
    if (!isWorkspaceFamilyView(initialView) || useNovelStore.getState().selectedNovel) return;

    const storedNovelId = getStoredSelectedNovelId();
    if (!storedNovelId) {
      queueMicrotask(() => {
        setCurrentView('library');
        setIsRestoringSelectedNovel(false);
      });
      return;
    }

    let cancelled = false;
    void getNovel(storedNovelId)
      .then((novel) => {
        if (cancelled) return;
        if (novel) {
          setSelectedNovel(novel);
          return;
        }
        clearStoredSelectedNovelId();
        setCurrentView('library');
      })
      .catch(() => {
        if (cancelled) return;
        toast('上次作品暂时无法恢复，请从书库重新选择', 'error');
        setCurrentView('library');
      })
      .finally(() => {
        if (!cancelled) setIsRestoringSelectedNovel(false);
      });

    return () => {
      cancelled = true;
    };
  }, [setCurrentView, setSelectedNovel]);

  const flushBeforeNavigation = useCallback(async (): Promise<boolean> => {
    try {
      await flushPendingEditorWrites();
      return true;
    } catch (error) {
      console.error('[AppShell] Failed to save before navigation:', error);
      toast('尚有写作内容保存失败，请重试后再切换', 'error');
      return false;
    }
  }, []);

  const navigateToEditor = async (novel: Novel) => {
    if (!await flushBeforeNavigation()) return;
    setContinuationLaunchState(null);
    setCapabilityLaunchState(null);
    setSelectedNovel(novel);
    setWorkspaceFocus('editor');
    setCurrentView('editor');
  };

  const navigateToEditorWithCockpitAction = async (
    novel: Novel,
    action: 'planning' | 'production' | 'resume' | 'audit' | 'polish' | 'complete-chapter' | 'resolve-issues' | 'confirm-facts' | 'next_chapter',
    targetChapterId?: string
  ) => {
    if (!await flushBeforeNavigation()) return;
    setContinuationLaunchState({
      approvedPackId: '',
      launchToken: Date.now(),
      shouldOpenProductionPanel: true,
      source: action === 'next_chapter' ? 'cockpit-next-chapter'
        : action === 'planning' ? 'cockpit-planning'
          : action === 'production' ? 'cockpit-production'
            : action === 'audit' ? 'cockpit-audit'
              : action === 'polish' ? 'cockpit-polish'
                : action === 'complete-chapter' ? 'cockpit-complete-chapter'
                  : action === 'resolve-issues' ? 'cockpit-resolve-issues'
                    : action === 'confirm-facts' ? 'cockpit-confirm-facts'
                      : 'cockpit-resume',
      targetChapterId,
    });
    setSelectedNovel(novel);
    setWorkspaceFocus('editor');
    setCurrentView('editor');
  };

  const navigateToEditorWithContinuation = async (
    novel: Novel,
    approvedPackId: string,
    source: ContinuationEditorLaunchState['source'],
    prefillIntent?: string,
  ) => {
    if (!await flushBeforeNavigation()) return;
    setContinuationLaunchState({
      approvedPackId,
      launchToken: Date.now(),
      shouldOpenProductionPanel: true,
      prefillIntent,
      source,
    });
    setSelectedNovel(novel);
    setWorkspaceFocus('editor');
    setCurrentView('editor');
  };

  const navigateToEditorWithCapability = async (launch: CapabilityLaunchState) => {
    if (!isEditorCapabilityLaunchAction(launch.action)) {
      toast('作品能力配置已保留在能力中心', 'info');
      return;
    }
    if (!selectedNovel || launch.novelId !== selectedNovel.id) {
      toast('该能力不属于当前作品，已阻止执行', 'error');
      return;
    }
    if (!await flushBeforeNavigation()) return;
    setContinuationLaunchState(null);
    setEditorReturnTarget({ novelId: selectedNovel.id, chapterId: launch.targetChapterId });
    setCapabilityLaunchState(launch);
    setWorkspaceFocus('editor');
    setCurrentView('editor');
  };

  const returnToEditorWithoutLaunch = async (novel: Novel, targetChapterId?: string, context?: NavigationContext) => {
    if (!await flushBeforeNavigation()) return;
    setContinuationLaunchState(null);
    setCapabilityLaunchState(null);
    setEditorReturnTarget({ novelId: novel.id, chapterId: targetChapterId });
    setSelectedNovel(novel);
    setWorkspaceFocus('editor');
    setCurrentView('editor');
    if (context?.capabilityApplied) toast(CAPABILITY_APPLIED_TOAST, 'success');
  };

  const handleStartContinuationImport = async (initialNovelId?: string) => {
    if (!await flushBeforeNavigation()) return;
    setContinuationImportNovelId(initialNovelId);
    setCurrentView('continuation-import');
  };

  const openFactoryCandidatesInCapabilityCenter = async (novel: Novel) => {
    if (!await flushBeforeNavigation()) return;
    closeAssistant();
    setSelectedNovel(novel);
    setSkillsReturnTarget({ view: 'workspace' });
    setCapabilityLaunchContext(null);
    setCurrentView('skills');
  };

  const handleNavigate = useCallback(async (view: ViewType, navKey?: WorkspaceNavKey, context?: NavigationContext) => {
    if (view === 'ai') {
      const surface = currentView === 'skills' || currentView === 'factory' || currentView === 'continuation-import'
        ? 'workspace'
        : currentView;
      openAssistant(
        'general',
        { surface, novelId: selectedNovel?.id },
      );
      return;
    }
    if (!await flushBeforeNavigation()) return;
    closeAssistant();
    const isEditorSurface = currentView === 'editor' || (currentView === 'workspace' && workspaceFocus === 'editor');
    if (view === 'skills' && currentView !== 'skills') {
      setSkillsReturnTarget(isEditorSurface
        ? { view: 'editor', targetChapterId: context?.targetChapterId }
        : { view: 'workspace' });
      setCapabilityLaunchContext(context?.stage ? { novelId: selectedNovel?.id, stage: context.stage } : null);
    }
    if (isEditorSurface && selectedNovel && context?.targetChapterId) {
      setEditorChapterContext((previous) => ({
        novelId: selectedNovel.id,
        chapterId: context.targetChapterId,
        writingStyleFingerprint: previous?.novelId === selectedNovel.id
          && previous.chapterId === context.targetChapterId
          ? previous.writingStyleFingerprint
          : undefined,
      }));
    }
    if (view !== 'skills') setCapabilityLaunchContext(null);
    if (view === 'world' && context?.worldCapabilityLaunch?.novelId === selectedNovel?.id) {
      setWorldCapabilityLaunch(context?.worldCapabilityLaunch ?? null);
    } else if (view !== 'world') {
      setWorldCapabilityLaunch(null);
    }
    setWorkspaceFocus(deriveWorkspaceFocus(view, context?.targetFocus || navKey, useAppStore.getState().workspaceFocus));
    setCurrentView(view);
    if (context?.capabilityApplied) toast(CAPABILITY_APPLIED_TOAST, 'success');
  }, [closeAssistant, currentView, flushBeforeNavigation, openAssistant, selectedNovel, setCurrentView, setWorkspaceFocus, workspaceFocus]);

  useEffect(() => {
    const viewMap: Record<string, { view: ViewType; navKey?: WorkspaceNavKey }> = {
      view1: { view: 'welcome' },
      view2: { view: 'library' },
      view3: { view: 'workspace', navKey: 'workspace-editor' },
      view4: { view: 'workspace', navKey: 'workspace-world' },
      view5: { view: 'ai' },
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement
        || event.target instanceof HTMLTextAreaElement
        || event.target instanceof HTMLSelectElement
      ) return;
      for (const [id, shortcut] of Object.entries(SHORTCUTS)) {
        if (id in viewMap && matchesShortcut(event, shortcut)) {
          event.preventDefault();
          const target = viewMap[id];
          void handleNavigate(target.view, target.navKey);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleNavigate]);

  const handleOpenAssistant = (modeOrContext: AssistantMode | AssistantLaunchContext, surfaceContext?: AssistantSurfaceContext) => {
    if (typeof modeOrContext === 'string') {
      if (surfaceContext) {
        openAssistant(modeOrContext, surfaceContext);
        const activeNovel = selectedNovel;
        if (!activeNovel) return;
        const source: AssistantLaunchContext['source'] = surfaceContext.surface === 'world'
          ? 'world'
          : surfaceContext.surface === 'workspace' ? 'workspace' : 'editor';
        const baseContext: AssistantLaunchContext = {
          source,
          novelId: activeNovel.id,
          novelTitle: activeNovel.title,
          novelSummary: activeNovel.summary,
          worldRules: activeNovel.worldRules,
          globalOutline: activeNovel.globalOutline,
          intent: surfaceContext.intent,
          chapterId: surfaceContext.chapterId,
          capabilitySnapshot: JSON.stringify(activeNovel.projectPreferenceProfile?.capabilityProfile || {}),
        };
        setAssistantLaunchContext(baseContext);
        void Promise.all([
          listCharacters(activeNovel.id),
          listForeshadowings(activeNovel.id),
          listTimelineEvents(activeNovel.id),
        ]).then(([characters, foreshadowings, timeline]) => {
          if (useNovelStore.getState().selectedNovel?.id !== activeNovel.id) return;
          setAssistantLaunchContext({
            ...baseContext,
            charactersContext: characters.slice(0, 8).map((character) => `${character.name}：${character.summary || character.bio || '无摘要'}`).join('\n'),
            foreshadowingsContext: foreshadowings.filter((item) => item.status !== 'payoff').slice(0, 8).map((item) => `${item.title}：${item.description}`).join('\n'),
            timelineContext: timeline.slice(-8).map((event) => `${event.title}：${event.description}`).join('\n'),
          });
        }).catch(() => {});
      }
      return;
    }
    const context = modeOrContext;
    setAssistantLaunchContext(context);
    openAssistant('general', {
      surface: 'editor',
      novelId: context.novelId,
      chapterId: context.chapterId,
      intent: context.intent,
      selectedText: context.selectedText,
      selectionStart: context.selectionStart,
      selectionEnd: context.selectionEnd,
    });
  };

  const handleOpenBibleAssistant = (prompt: string) => {
    if (!selectedNovel) return;
    useAssistantSessionStore.getState().setInput(selectedNovel.id, 'bible', prompt);
    openAssistant('bible', {
      surface: 'editor',
      novelId: selectedNovel.id,
      intent: 'continuation-gap',
    });
  };

  const handleOpenGapAssistant = (gap: ContinuationGap, packTitle: string, continuationPackId?: string) => {
    if (!selectedNovel) return;
    const relatedFacts = gap.relatedFacts.length > 0 ? gap.relatedFacts.join('；') : '暂无明确关联事实';
    const prompt = [
      `请处理资料包《${packTitle}》的一条续写缺口。`,
      `缺口等级：${gap.severity}`,
      `缺口描述：${gap.description}`,
      `建议方向：${gap.suggestedDirection}`,
      `资料包提取结果（待核对）：${relatedFacts}`,
      '请先生成可编辑的补充草稿，并明确区分原资料证据与创作推断；不要自动写入，也不要把推测当作原资料事实。只有我确认后，才写入设定。',
    ].join('\n');
    useAssistantSessionStore.getState().setInput(selectedNovel.id, 'bible', prompt);
    openAssistant('bible', {
      surface: 'world',
      novelId: selectedNovel.id,
      continuationPackId,
      worldBibleTab: 'pack-management',
      intent: 'continuation-gap',
    });
  };

  const handleOpenGapAssistantBatch = (gaps: ContinuationGap[], packTitle: string, continuationPackId?: string) => {
    if (!selectedNovel || gaps.length === 0) return;
    const prompt = [
      `请一次性处理资料包《${packTitle}》中的以下续写资料缺口：`,
      ...gaps.map((gap, index) => {
        const relatedFacts = gap.relatedFacts.length > 0 ? gap.relatedFacts.join('；') : '暂无明确关联事实';
        return [
          `缺口 ${index + 1}：`,
          `缺口等级：${gap.severity}`,
          `缺口描述：${gap.description}`,
          `建议方向：${gap.suggestedDirection}`,
          `资料包提取结果（待核对）：${relatedFacts}`,
        ].join('\n');
      }),
      '请为每条缺口分别生成可编辑的补充草稿，并明确区分原资料证据与创作推断；不要自动写入，也不要把推测当作原资料事实。只有我确认后，才写入设定。',
    ].join('\n');
    useAssistantSessionStore.getState().setInput(selectedNovel.id, 'bible', prompt);
    openAssistant('bible', {
      surface: 'world',
      novelId: selectedNovel.id,
      continuationPackId,
      worldBibleTab: 'pack-management',
      intent: 'continuation-gap',
    });
  };

  const handleApplyAssistantToContent = async (text: string) => {
    const context = assistantLaunchContext;
    if (!context?.chapterId || selectedNovel?.id !== context.novelId) return;
    if (!await flushBeforeNavigation()) return;
    if (useNovelStore.getState().selectedNovel?.id !== context.novelId) return;
    const chapters = await listChapters(context.novelId);
    if (useNovelStore.getState().selectedNovel?.id !== context.novelId) return;
    const target = chapters.find((chapter) => chapter.id === context.chapterId);
    if (!target) return;

    const nextContent = appendAssistantTextToChapterContent(target.content || '', text);
    const saved = await updateChapter(target.id, {
      content: nextContent,
      wordCount: nextContent.replace(/\s/g, '').length,
      updatedAt: Date.now(),
    });
    if (!saved) throw new Error('Chapter no longer exists');
    setCurrentView('editor');
    setWorkspaceFocus('editor');
  };

  const handleApplyAssistantToSceneBeats = async (text: string) => {
    const context = assistantLaunchContext;
    if (!context?.chapterId || selectedNovel?.id !== context.novelId) return;
    if (!await flushBeforeNavigation()) return;
    if (useNovelStore.getState().selectedNovel?.id !== context.novelId) return;
    const chapters = await listChapters(context.novelId);
    if (useNovelStore.getState().selectedNovel?.id !== context.novelId) return;
    const target = chapters.find((chapter) => chapter.id === context.chapterId);
    if (!target) return;

    const nextBeats = appendAssistantTextToSceneBeats(target.sceneBeats || '', text);
    const saved = await updateChapter(target.id, {
      sceneBeats: nextBeats,
      updatedAt: Date.now(),
    });
    if (!saved) throw new Error('Chapter no longer exists');
    setCurrentView('editor');
    setWorkspaceFocus('editor');
  };

  const handleReplaceAssistantSelection = async (text: string) => {
    const context = assistantLaunchContext;
    if (
      !context?.chapterId ||
      selectedNovel?.id !== context.novelId ||
      context.selectionStart === undefined ||
      context.selectionEnd === undefined ||
      !context.selectedText
    ) {
      return;
    }

    if (!await flushBeforeNavigation()) return;

    if (useNovelStore.getState().selectedNovel?.id !== context.novelId) return;
    const chapters = await listChapters(context.novelId);
    if (useNovelStore.getState().selectedNovel?.id !== context.novelId) return;
    const target = chapters.find((chapter) => chapter.id === context.chapterId);
    if (!target) return;

    const nextContent = replaceAssistantTextInSelection(
      target.content || '',
      {
        start: context.selectionStart,
        end: context.selectionEnd,
        selectedText: context.selectedText,
      },
      text,
    );

    const saved = await updateChapter(target.id, {
      content: nextContent,
      wordCount: nextContent.replace(/\s/g, '').length,
      updatedAt: Date.now(),
    });
    if (!saved) throw new Error('Chapter no longer exists');
    setCurrentView('editor');
    setWorkspaceFocus('editor');
  };

  const handleStartAssistantCreation = async (plan: AssistantActionPlan, seedText?: string) => {
    const novel = selectedNovel;
    if (!novel || plan.novelId !== novel.id) return;
    await navigateToEditorWithContinuation(
      novel,
      '',
      'cockpit-planning',
      seedText?.trim() || plan.userRequest.trim(),
    );
    if (useAppStore.getState().currentView === 'editor') closeAssistant();
  };

  const handleLaunchAssistantSettingCandidate = (plan: AssistantActionPlan, seedText: string) => {
    const novel = selectedNovel;
    if (!novel || plan.novelId !== novel.id || !plan.recommendedCapabilityId) return;
    void handleNavigate('world', undefined, {
      worldCapabilityLaunch: {
        novelId: novel.id,
        launchToken: Date.now(),
        capabilityId: plan.recommendedCapabilityId,
        artifactKind: 'world',
        seedText: seedText.trim(),
      },
    });
  };

  const handleCreateDraftFromIdea = async ({
    ideaSeed,
    chatContext,
    planning,
    isRefresh,
  }: {
    ideaSeed: string;
    chatContext: string;
    planning: StoryPlanningInput;
    isRefresh?: boolean;
  }) => {
    setLoading(true);
    const batch = isRefresh ? batchCounter + 1 : 0;
    const prevHooks = isRefresh ? (onboardingDraft?.cards || []).map(c => c.hook) : [];
    try {
      const { cards, source, jobId, warnings } = await generateStoryCards({
        ideaSeed, chatContext, planning, surface: 'welcome',
        batchIndex: batch,
        previousHookTexts: prevHooks,
      });
      if (isRefresh) incrementBatchCounter();
      setOnboardingDraft({
        ideaSeed,
        planning,
        cards,
        source,
        storyCardJobId: jobId,
        setupTasks: [],
        acceptedSkillIds: [],
        recommendedSkills: [],
        acceptedRecommendedSkills: false,
        warnings,
      });
      openAssistant('general', { surface: 'welcome' });
    } // eslint-disable-next-line no-useless-catch
    catch (e) {
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const handleSelectStoryCard = async (
    card: StoryIdeaCard,
    planning?: StoryPlanningInput,
    recommendedTags?: string[],
    targetView: ViewType = 'workspace',
    activeSeriesId?: string
  ) => {
    try {
      const activePlanning = planning || onboardingDraft?.planning;
      if (!activePlanning) {
        throw new Error('缺少创作规划，无法创建作品。');
      }
      const newNovelId = crypto.randomUUID();
      const now = Date.now();

      let initialProfile = buildProjectPreferenceProfileFromPlanning(activePlanning);
      if (recommendedTags && recommendedTags.length > 0) {
        const mergedTagsSet = new Set([...initialProfile.tags, ...recommendedTags]);
        initialProfile.tags = Array.from(mergedTagsSet);
      }
      if (activeSeriesId) {
        initialProfile = buildV3CapabilityProfile(
          { projectPreferenceProfile: { ...initialProfile, activeSeriesId } },
          { activeFlowId: activeSeriesId },
        );
      }

      const newNovel: Novel = {
        id: newNovelId,
        title: card.hook.slice(0, 18) || '新作品',
        authorId: 'local-user',
        summary: `${card.hook}\n\n${card.whyItWorks}`,
        globalOutline: `${card.coreConflict}\n\n${card.starterSeeds.chapterOneSeed}`,
        worldRules: card.starterSeeds.worldSeed,
        mountedSkillIds: [],
        mountedSkillLoadout: [],
        projectPreferenceProfile: initialProfile,
        status: 'ongoing',
        createdAt: now,
        updatedAt: now,
      };
      const firstChapter = {
        id: (now + 1).toString(),
        novelId: newNovelId,
        title: '第一章',
        content: '',
        order: 0,
        wordCount: 0,
        sceneBeats: card.starterSeeds.chapterOneSeed,
        volumeName: '默认卷',
        createdAt: now,
        updatedAt: now,
      };
      // Novel and first chapter are one user action. Persist them atomically so
      // a failed chapter insert cannot leave an empty/orphan project in Library.
      await createNovelWithChapter(newNovel, firstChapter);
      if (card.protagonist.trim()) {
        await createCharacter({
          id: (now + 2).toString(),
          novelId: newNovelId,
          name: '待命名主角',
          role: 'protagonist',
          summary: card.protagonist,
          traits: [],
          bio: '',
          createdAt: now,
          updatedAt: now,
        });
      }

      const setupTasks = buildSetupTasksFromStoryCard(card, activePlanning);
      const skills = await listSkills();
      const recommended = recommendSkillsForStoryCard(card, skills);
      const recommendedSkills = recommended.map((entry) => ({
        ...entry,
        skillName: skills.find((skill) => skill.id === entry.skillId)?.name || '未命名能力卡',
      }));
      setSelectedNovel(newNovel);
      setOnboardingDraft({
        ideaSeed: onboardingDraft?.ideaSeed || card.hook,
        planning: activePlanning,
        cards: onboardingDraft?.cards || [card],
        selectedCardId: card.id,
        setupTasks,
        acceptedSkillIds: [],
        recommendedSkills,
        acceptedRecommendedSkills: false,
      });
      setActiveSetupTaskKey(setupTasks[0]?.key ?? null);
      setAssistantInput('');
      setWorkspaceFocus(deriveWorkspaceFocus(targetView, targetView === 'workspace' ? 'workspace-editor' : undefined, useAppStore.getState().workspaceFocus));
      setCurrentView(targetView);
    } catch (error) {
      toast('创建作品失败，请稍后重试', 'error');
      throw error;
    }
  };

  const handleConfirmSetupTask = (taskKey: SetupTaskKey) => {
    setOnboardingDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        setupTasks: prev.setupTasks.map((task) =>
          task.key === taskKey ? { ...task, status: 'confirmed', source: 'user-edit' } : task,
        ),
      };
    });
  };

  const handleRefineSetupTask = async () => {
    if (!onboardingDraft || !selectedNovel || !activeSetupTaskKey) return;
    const task = onboardingDraft.setupTasks.find((entry) => entry.key === activeSetupTaskKey);
    if (!task || !assistantInput.trim()) return;

    const selectedCard = onboardingDraft.cards.find((card) => card.id === onboardingDraft.selectedCardId);
    setAssistantLoading(true);
    setAssistantError(null);
    try {
      const text = await refineSetupTask({
        novelId: selectedNovel.id,
        taskTitle: task.title,
        currentDraft: task.summary,
        userRequest: assistantInput,
        surface: 'world-onboarding',
        storyContext: [
          `故事方案：${selectedCard?.hook || selectedNovel.title}`,
          `故事梗概：${selectedNovel.summary || ''}`,
          `核心冲突：${selectedNovel.globalOutline || ''}`,
          `世界规则：${selectedNovel.worldRules || ''}`,
        ].join('\n'),
      });

      // A refinement is only useful if it enters the same canon consumed by
      // World Bible and the editor. Persist the affected canonical field before
      // updating the onboarding draft preview.
      if (activeSetupTaskKey === 'world-rules') {
        await updateNovel(selectedNovel.id, { worldRules: text });
      } else if (activeSetupTaskKey === 'core-conflict') {
        await updateNovel(selectedNovel.id, { globalOutline: text });
      } else if (activeSetupTaskKey === 'chapter-one') {
        const firstChapter = (await listChapters(selectedNovel.id)).sort((a, b) => a.order - b.order)[0];
        if (firstChapter) await updateChapter(firstChapter.id, { sceneBeats: text });
      } else if (activeSetupTaskKey === 'protagonist') {
        const protagonist = (await listCharacters(selectedNovel.id)).find((character) => character.role === 'protagonist');
        if (protagonist) await updateCharacter(protagonist.id, { summary: text });
      }

      setOnboardingDraft((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          setupTasks: prev.setupTasks.map((entry) =>
            entry.key === activeSetupTaskKey
              ? { ...entry, summary: text, status: 'drafted', source: 'ai-refine' }
              : entry,
          ),
        };
      });
      setAssistantInput('');
    } catch (error) {
      setAssistantError(error instanceof Error ? error.message : 'AI 精炼失败，请重试');
    } finally {
      setAssistantLoading(false);
    }
  };

  const handleAcceptRecommendedSkills = async () => {
    if (!selectedNovel || !onboardingDraft || !onboardingDraft.recommendedSkills.length) return;
    const acceptedSkillIds = onboardingDraft.recommendedSkills.map((entry) => entry.skillId).slice(0, 3);
    setOnboardingDraft((prev) =>
      prev
        ? {
            ...prev,
            acceptedSkillIds,
            acceptedRecommendedSkills: true,
          }
        : prev,
    );
  };

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-paper" data-testid="app-ready" data-ready-state="false">
        <div className="text-xl font-serif italic text-gray-400">
          InkFlow Starting...
        </div>
      </div>
    );
  }

  if (isRestoringSelectedNovel) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-paper text-sm text-theme-muted" data-testid="app-ready" data-ready-state="false">
        正在恢复上次作品...
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex bg-theme-bg text-theme-text overflow-hidden p-2 gap-2 sm:p-3 sm:gap-3" data-testid="app-ready" data-ready-state="true">
      <div className="shrink-0" data-testid="app-shell-sidebar" inert={isAIAssistantOpen}>
        <Sidebar
          currentView={currentView}
          onNavigate={handleNavigate}
          user={user}
          isAIAssistantOpen={isAIAssistantOpen}
        />
      </div>

      <main
        className="min-w-0 flex-1 relative overflow-hidden bg-paper rounded-2xl border border-theme-border shadow-sm flex flex-col"
        data-testid="app-shell-main"
        inert={isAIAssistantOpen}
      >
        <div key={currentView} className="flex-1 overflow-hidden h-full">
          <Suspense fallback={<div className="flex items-center justify-center h-full text-sm opacity-50">加载中...</div>}>
            {currentView === 'welcome' && (
              <ErrorBoundary>
                <WelcomeView
                  onSelectStoryCard={handleSelectStoryCard}
                  onJumpToLibrary={() => { void handleNavigate('library'); }}
                  onSelectNovel={navigateToEditor}
                  onStartContinuationImport={handleStartContinuationImport}
                  onNavigateToFactory={() => { void handleNavigate('factory'); }}
                />
              </ErrorBoundary>
            )}
            {currentView === 'continuation-import' && (
              <ErrorBoundary>
                <ContinuationImportView
                  onBack={() => { void handleNavigate('welcome'); }}
                  initialNovelId={continuationImportNovelId}
                  onEnterEditor={(novel, approvedPackId, prefillIntent) =>
                    navigateToEditorWithContinuation(novel, approvedPackId, 'continuation-import', prefillIntent)
                  }
                />
              </ErrorBoundary>
            )}
            {currentView === 'library' && (
              <ErrorBoundary>
                <Library onSelectNovel={navigateToEditor} onNavigate={(view) => { void handleNavigate(view); }} userId={'local-user'} />
              </ErrorBoundary>
            )}
            {currentView === 'workspace' && selectedNovel && workspaceFocus !== 'editor' && (
              <ErrorBoundary>
                <ProjectCockpitView
                  novel={selectedNovel}
                  onNavigate={(view) => {
                    if (view === 'editor') {
                      navigateToEditor(selectedNovel);
                    } else if (view === 'continuation-import') {
                      void handleStartContinuationImport();
                    } else {
                      void handleNavigate(view);
                    }
                  }}
                  onStartCockpitAction={(action, chapterId) => navigateToEditorWithCockpitAction(selectedNovel, action, chapterId)}
                  onOpenCapabilities={(context) => {
                    void handleNavigate('skills', undefined, context);
                  }}
                  onStartContinuationWriting={(packId) => navigateToEditorWithContinuation(selectedNovel, packId, 'world-overview')}
                  onEnterStoryboard={(packId) => navigateToEditorWithContinuation(selectedNovel, packId, 'storyboard')}
                  onOpenAssistant={handleOpenAssistant}
                />
              </ErrorBoundary>
            )}
            {(currentView === 'editor' || (currentView === 'workspace' && workspaceFocus === 'editor')) && selectedNovel && (
              <ErrorBoundary>
                <EditorView
                  key={`${selectedNovel.id}:${continuationLaunchState?.approvedPackId || 'default'}`}
                  novel={selectedNovel}
                  launchState={continuationLaunchState}
                  capabilityLaunchState={capabilityLaunchState}
                  onCapabilityLaunchConsumed={consumeCapabilityLaunch}
                  onLaunchConsumed={(launchToken) => {
                    if (useNovelStore.getState().continuationLaunchState?.launchToken === launchToken) {
                      setContinuationLaunchState(null);
                    }
                  }}
                  onBack={async () => {
                    if (!await flushBeforeNavigation()) return;
                    setCurrentView('library');
                  }}
                  onOpenAssistant={handleOpenAssistant}
                  onOpenBibleAssistant={handleOpenBibleAssistant}
                  initialChapterId={editorReturnTarget?.novelId === selectedNovel.id ? editorReturnTarget.chapterId : undefined}
                  onChapterContextChange={handleEditorChapterContextChange}
                  onNavigate={(view, context) => { void handleNavigate(view, undefined, context); }}
                />
              </ErrorBoundary>
            )}
            {currentView === 'world' && selectedNovel && (
              <ErrorBoundary>
                <WorldBibleView
                  novel={selectedNovel}
                  capabilityLaunchIntent={worldCapabilityLaunch?.novelId === selectedNovel.id
                    ? worldCapabilityLaunch
                    : null}
                  onCapabilityLaunchConsumed={(launchToken) => {
                    setWorldCapabilityLaunch((current) => current?.launchToken === launchToken ? null : current);
                  }}
                  onStartContinuationWriting={(packId, prefillIntent) =>
                    navigateToEditorWithContinuation(selectedNovel, packId, 'world-overview', prefillIntent)
                  }
                  onEnterStoryboard={(packId, continuationTask) =>
                    navigateToEditorWithContinuation(selectedNovel, packId, 'storyboard', continuationTask)
                  }
                  isGlobalAssistantOpen={isAIAssistantOpen}
                  onOpenGapAssistant={handleOpenGapAssistant}
                  onOpenGapAssistantBatch={handleOpenGapAssistantBatch}
                  onOpenCapabilityStore={() => { void handleNavigate('skills', undefined, { stage: 'creative-setup' }); }}
                  onboarding={
                    onboardingDraft?.setupTasks.length
                      ? {
                          card: onboardingDraft.cards.find((card) => card.id === onboardingDraft.selectedCardId),
                          tasks: onboardingDraft.setupTasks,
                          activeTask: onboardingDraft.setupTasks.find((task) => task.key === activeSetupTaskKey),
                          onSelectTask: (key) => setActiveSetupTaskKey(key),
                          onConfirmTask: handleConfirmSetupTask,
                          assistantInput,
                          onAssistantInputChange: setAssistantInput,
                          onAssistantSubmit: handleRefineSetupTask,
                          assistantLoading,
                          assistantError,
                          completedCount: countCompletedSetupTasks(onboardingDraft.setupTasks),
                          canEnterEditor: countCompletedSetupTasks(onboardingDraft.setupTasks) >= 3,
                          onEnterEditor: () => { void handleNavigate('editor'); },
                          acceptedSkillIds: onboardingDraft.acceptedSkillIds,
                          recommendedSkills: onboardingDraft.recommendedSkills,
                          acceptedRecommendedSkills: onboardingDraft.acceptedRecommendedSkills,
                          onAcceptRecommendedSkills: handleAcceptRecommendedSkills,
                        }
                      : undefined
                  }
                  onOpenAssistant={handleOpenAssistant}
                />
              </ErrorBoundary>
            )}
            {currentView === 'factory' && (
              <ErrorBoundary>
                <BookFactoryView
                  chapterId={editorChapterContext?.novelId === selectedNovel?.id ? editorChapterContext?.chapterId : undefined}
                  databaseGeneration={
                    factoryGenerationContext?.novelId === selectedNovel?.id
                    && factoryGenerationContext?.chapterId === editorChapterContext?.chapterId
                      ? factoryGenerationContext?.databaseGeneration
                      : undefined
                  }
                  writingStyleFingerprint={
                    editorChapterContext?.novelId === selectedNovel?.id
                      ? editorChapterContext?.writingStyleFingerprint
                      : undefined
                  }
                  onOpenCapabilityCenter={(novel) => { void openFactoryCandidatesInCapabilityCenter(novel); }}
                />
              </ErrorBoundary>
            )}
            {currentView === 'skills' && (
              <ErrorBoundary>
                <SkillsStudioView
                  selectedNovel={selectedNovel}
                  initialStage={capabilityLaunchContext?.stage}
                  returnView={skillsReturnTarget.view}
                  targetChapterId={skillsReturnTarget.targetChapterId}
                  onNovelUpdated={(novel) => setSelectedNovel(novel)}
                  onNavigate={(view, context) => {
                    if (view === 'editor' && selectedNovel) {
                      void returnToEditorWithoutLaunch(selectedNovel, skillsReturnTarget.targetChapterId, context);
                    } else {
                      void handleNavigate(view, undefined, context);
                    }
                  }}
                  onLaunchCapability={(launch) => { void navigateToEditorWithCapability(launch); }}
                />
              </ErrorBoundary>
            )}
            {currentView === 'editor' && !selectedNovel && (
              <WorkspacePreviewEmptyState
                title="创作舞台等待作品"
                description="选中作品后，编辑器会展示章节、分镜、世界观与能力卡配置，并用于正文生成、打磨与质量中心。"
                onGoLibrary={() => { void handleNavigate('library'); }}
                onCreateNovel={() => { void handleNavigate('library'); }}
                onImport={handleStartContinuationImport}
              />
            )}
            {currentView === 'workspace' && !selectedNovel && (
              <WorkspacePreviewEmptyState
                title="创作工作台暂未开启"
                description="工作台会把章节写作、设定记忆、能力卡配置和智能管家组织在一起。先选择或创建作品，就能开始协作。"
                onGoLibrary={() => { void handleNavigate('library'); }}
                onCreateNovel={() => { void handleNavigate('library'); }}
                onImport={handleStartContinuationImport}
              />
            )}
            {currentView === 'world' && !selectedNovel && (
              <WorkspacePreviewEmptyState
                title="设定集需要绑定作品"
                description="人物、地点、道具和世界规则都跟作品绑定。选中作品后，设定会成为后续写作和审查的上下文。"
                onGoLibrary={() => { void handleNavigate('library'); }}
                onCreateNovel={() => { void handleNavigate('library'); }}
                onImport={handleStartContinuationImport}
              />
            )}
          </Suspense>
        </div>
      </main>

      {/* Global AIAssistant Drawer */}
      <Suspense fallback={null}>
        <AIAssistantDrawer
          isOpen={isAIAssistantOpen}
          onClose={closeAssistant}
          onboardingDraft={onboardingDraft}
          aiDrawerTab={aiDrawerTab}
          setAIDrawerTab={setAIDrawerTab}
          handleSelectStoryCard={handleSelectStoryCard}
          handleCreateDraftFromIdea={handleCreateDraftFromIdea}
          assistantLaunchContext={assistantLaunchContext}
          continuationPackId={assistantSurfaceContext?.continuationPackId}
          handleApplyAssistantToContent={handleApplyAssistantToContent}
          handleApplyAssistantToSceneBeats={handleApplyAssistantToSceneBeats}
          handleReplaceAssistantSelection={handleReplaceAssistantSelection}
          handleLaunchAssistantSettingCandidate={handleLaunchAssistantSettingCandidate}
          handleStartAssistantCreation={handleStartAssistantCreation}
          selectedNovel={selectedNovel}
          assistantMode={assistantMode}
          onAssistantModeChange={(mode) => openAssistant(mode, assistantSurfaceContext)}
        />
      </Suspense>

      <Suspense fallback={null}>
        <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} theme={theme} onThemeChange={setTheme} selectedNovelId={selectedNovel?.id} />
      </Suspense>
      <Suspense fallback={null}>
        <PremiumUpgradeModal />
      </Suspense>
    </div>
  );
}
