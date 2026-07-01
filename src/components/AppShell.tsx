import { useState, Suspense, lazy } from 'react';
import { Sidebar } from './Sidebar';
import { WelcomeView } from './WelcomeView';
import { AIAssistantDrawer } from './AIAssistantDrawer';
import { ErrorBoundary } from './ErrorBoundary';
import { toast } from '../lib/toast';

const Library = lazy(() => import('./Library').then(m => ({ default: m.Library })));
const EditorView = lazy(() => import('./EditorView').then(m => ({ default: m.EditorView })));
const WorldBibleView = lazy(() => import('./WorldBibleView').then(m => ({ default: m.WorldBibleView })));
const ContinuationImportView = lazy(() => import('./ContinuationImportView').then(m => ({ default: m.ContinuationImportView })));
const SkillsStudioView = lazy(() => import('./SkillsStudioView').then(m => ({ default: m.SkillsStudioView })));
const BookFactoryView = lazy(() => import('./BookFactoryView').then(m => ({ default: m.BookFactoryView })));
import { ProjectCockpitView } from './ProjectCockpitView';

import type { AssistantLaunchContext, ContinuationEditorLaunchState, SetupTaskKey, StoryIdeaCard, StoryPlanningInput, ViewType, Novel, WorkspaceNavKey } from '../../shared/types';
import { useAppStore } from '../stores/app-store';
import { useNovelStore } from '../stores/novel-store';
import { createChapter, createCharacter, createNovel, generateStoryCards, listChapters, listSkills, refineSetupTask, updateChapter, updateNovel } from '../lib/api';
import { buildProjectPreferenceProfileFromPlanning, buildSetupTasksFromStoryCard, countCompletedSetupTasks, recommendSkillsForStoryCard } from '../lib/onboarding-model';
import { coerceMountedSkillLoadout } from '../lib/skill-model';
import { SettingsModal } from './SettingsModal';
import { deriveWorkspaceFocus } from '../lib/workspace-nav';
import { appendAssistantTextToChapterContent, appendAssistantTextToSceneBeats, replaceAssistantTextInSelection } from '../lib/assistant-apply';
import { BookOpen, BrainCircuit, Globe2, Layers3, PenLine, Sparkles, Wand2 } from 'lucide-react';

const LOCAL_USER = { uid: 'local-user' };

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
    { label: '技能卡', detail: '文风、节奏、人物滤镜会影响下一章生成。', icon: Wand2 },
    { label: 'AI 协作', detail: '助手会读取当前作品与章节上下文。', icon: BrainCircuit },
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
                <span className="mt-1 block text-[11px] font-normal opacity-80">进入作品后可直接写作、设定和挂载技能。</span>
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
            技能卡会影响章节生成和审查。
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppShell() {
  const {
    currentView, setCurrentView,
    setWorkspaceFocus,
    theme, setTheme,
    isSettingsOpen, setSettingsOpen,
    isAIAssistantOpen, setAIAssistantOpen,
    aiDrawerTab, setAIDrawerTab,
  } = useAppStore();

  const {
    selectedNovel, setSelectedNovel,
    onboardingDraft, setOnboardingDraft,
    activeSetupTaskKey, setActiveSetupTaskKey,
    batchCounter, incrementBatchCounter,
    assistantLaunchContext, setAssistantLaunchContext,
    continuationLaunchState, setContinuationLaunchState,
  } = useNovelStore();

  const [user] = useState(LOCAL_USER);
  const [loading, setLoading] = useState(false);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);

  const navigateToEditor = (novel: Novel) => {
    setContinuationLaunchState(null);
    setSelectedNovel(novel);
    setWorkspaceFocus('editor');
    setCurrentView('editor');
  };

  const navigateToCockpit = (novel: Novel) => {
    setContinuationLaunchState(null);
    setSelectedNovel(novel);
    setCurrentView('workspace');
  };

  const navigateToEditorWithCockpitAction = (
    novel: Novel,
    action: 'planning' | 'production'
  ) => {
    setContinuationLaunchState({
      approvedPackId: '',
      launchToken: Date.now(),
      shouldOpenProductionPanel: true,
      source: action === 'planning' ? 'cockpit-planning' : 'cockpit-production',
    });
    setSelectedNovel(novel);
    setWorkspaceFocus('editor');
    setCurrentView('editor');
  };

  const navigateToEditorWithContinuation = (
    novel: Novel,
    approvedPackId: string,
    source: ContinuationEditorLaunchState['source'],
    prefillIntent?: string,
  ) => {
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

  const handleStartContinuationImport = () => {
    setCurrentView('continuation-import');
  };

  const handleNavigate = (view: ViewType, navKey?: WorkspaceNavKey) => {
    if (view === 'ai') {
      setAIAssistantOpen(true);
      return;
    }
    setAIAssistantOpen(false);
    setWorkspaceFocus(deriveWorkspaceFocus(view, navKey, useAppStore.getState().workspaceFocus));
    setCurrentView(view);
  };

  const handleOpenAssistant = (context: AssistantLaunchContext) => {
    setAssistantLaunchContext(context);
    setAIAssistantOpen(true);
  };

  const handleApplyAssistantToContent = async (text: string) => {
    if (!assistantLaunchContext?.chapterId) return;
    const chapters = await listChapters(assistantLaunchContext.novelId);
    const target = chapters.find((chapter) => chapter.id === assistantLaunchContext.chapterId);
    if (!target) return;

    const nextContent = appendAssistantTextToChapterContent(target.content || '', text);
    await updateChapter(target.id, {
      content: nextContent,
      wordCount: nextContent.replace(/\s/g, '').length,
      updatedAt: Date.now(),
    });
    setCurrentView('editor');
    setWorkspaceFocus('editor');
  };

  const handleApplyAssistantToSceneBeats = async (text: string) => {
    if (!assistantLaunchContext?.chapterId) return;
    const chapters = await listChapters(assistantLaunchContext.novelId);
    const target = chapters.find((chapter) => chapter.id === assistantLaunchContext.chapterId);
    if (!target) return;

    const nextBeats = appendAssistantTextToSceneBeats(target.sceneBeats || '', text);
    await updateChapter(target.id, {
      sceneBeats: nextBeats,
      updatedAt: Date.now(),
    });
    setCurrentView('editor');
    setWorkspaceFocus('editor');
  };

  const handleReplaceAssistantSelection = async (text: string) => {
    if (
      !assistantLaunchContext?.chapterId ||
      assistantLaunchContext.selectionStart === undefined ||
      assistantLaunchContext.selectionEnd === undefined ||
      !assistantLaunchContext.selectedText
    ) {
      return;
    }

    const chapters = await listChapters(assistantLaunchContext.novelId);
    const target = chapters.find((chapter) => chapter.id === assistantLaunchContext.chapterId);
    if (!target) return;

    const nextContent = replaceAssistantTextInSelection(
      target.content || '',
      {
        start: assistantLaunchContext.selectionStart,
        end: assistantLaunchContext.selectionEnd,
        selectedText: assistantLaunchContext.selectedText,
      },
      text,
    );

    await updateChapter(target.id, {
      content: nextContent,
      wordCount: nextContent.replace(/\s/g, '').length,
      updatedAt: Date.now(),
    });
    setCurrentView('editor');
    setWorkspaceFocus('editor');
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
      setAIAssistantOpen(true);
    } // eslint-disable-next-line no-useless-catch
    catch (e) {
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const handleSelectStoryCard = async (card: StoryIdeaCard, planning?: StoryPlanningInput) => {
    try {
      const activePlanning = planning || onboardingDraft?.planning;
      if (!activePlanning) {
        throw new Error('缺少创作规划，无法创建作品。');
      }
      const newNovelId = crypto.randomUUID();
      const now = Date.now();
      const newNovel: Novel = {
        id: newNovelId,
        title: card.hook.slice(0, 18) || '新作品',
        authorId: 'local-user',
        summary: `${card.hook}\n\n${card.whyItWorks}`,
        globalOutline: `${card.coreConflict}\n\n${card.starterSeeds.chapterOneSeed}`,
        worldRules: card.starterSeeds.worldSeed,
        mountedSkillIds: [],
        mountedSkillLoadout: [],
        projectPreferenceProfile: buildProjectPreferenceProfileFromPlanning(activePlanning),
        status: 'ongoing',
        createdAt: now,
        updatedAt: now,
      };
      await createNovel(newNovel);
      await createChapter({
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
      });
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
        skillName: skills.find((skill) => skill.id === entry.skillId)?.name || '未命名 Skill',
      }));
      setSelectedNovel(newNovel);
      setOnboardingDraft({
        ideaSeed: onboardingDraft?.ideaSeed || card.hook,
        planning: activePlanning,
        cards: onboardingDraft?.cards || [card],
        selectedCardId: card.id,
        setupTasks,
        acceptedSkillIds: recommended.map((entry) => entry.skillId),
        recommendedSkills,
        acceptedRecommendedSkills: false,
      });
      setActiveSetupTaskKey(setupTasks[0]?.key ?? null);
      setAssistantInput('');
      setCurrentView('workspace');
    } catch {
      toast('创建作品失败，请稍后重试', 'error');
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
    try {
      const text = await refineSetupTask({
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
    } finally {
      setAssistantLoading(false);
    }
  };

  const handleAcceptRecommendedSkills = async () => {
    if (!selectedNovel || !onboardingDraft || !onboardingDraft.recommendedSkills.length) return;
    const mountedSkillIds = onboardingDraft.recommendedSkills.map((entry) => entry.skillId).slice(0, 3);
    const mountedSkillLoadout = coerceMountedSkillLoadout(mountedSkillIds);
    await updateNovel(selectedNovel.id, { mountedSkillIds, mountedSkillLoadout });
    setSelectedNovel((prev) =>
      prev
        ? {
            ...prev,
            mountedSkillIds,
            mountedSkillLoadout,
          }
        : prev,
    );
    setOnboardingDraft((prev) =>
      prev
        ? {
            ...prev,
            acceptedSkillIds: mountedSkillIds,
            acceptedRecommendedSkills: true,
          }
        : prev,
    );
  };

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-paper">
        <div className="text-xl font-serif italic text-gray-400">
          InkFlow Starting...
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex bg-theme-bg text-theme-text overflow-hidden p-2 gap-2 sm:p-3 sm:gap-3">
      <div className="shrink-0">
        <Sidebar
          currentView={currentView}
          onNavigate={handleNavigate}
          user={user}
          isAIAssistantOpen={isAIAssistantOpen}
        />
      </div>

      <main className="min-w-0 flex-1 relative overflow-hidden bg-paper rounded-2xl border border-theme-border shadow-sm flex flex-col">
        <div key={currentView} className="flex-1 overflow-hidden h-full">
          <Suspense fallback={<div className="flex items-center justify-center h-full text-sm opacity-50">加载中...</div>}>
            {currentView === 'welcome' && (
              <ErrorBoundary>
                <WelcomeView
                  onSelectStoryCard={handleSelectStoryCard}
                  onJumpToLibrary={() => setCurrentView('library')}
                  onSelectNovel={navigateToCockpit}
                  onStartContinuationImport={handleStartContinuationImport}
                />
              </ErrorBoundary>
            )}
            {currentView === 'continuation-import' && (
              <ErrorBoundary>
                <ContinuationImportView
                  onBack={() => setCurrentView('welcome')}
                  onEnterEditor={(novel, approvedPackId, prefillIntent) =>
                    navigateToEditorWithContinuation(novel, approvedPackId, 'continuation-import', prefillIntent)
                  }
                />
              </ErrorBoundary>
            )}
            {currentView === 'library' && (
              <ErrorBoundary>
                <Library onSelectNovel={navigateToCockpit} onNavigate={setCurrentView} userId={'local-user'} />
              </ErrorBoundary>
            )}
            {currentView === 'workspace' && selectedNovel && (
              <ErrorBoundary>
                <ProjectCockpitView
                  novel={selectedNovel}
                  onNavigate={(view) => {
                    if (view === 'editor') {
                      navigateToEditor(selectedNovel);
                    } else {
                      setCurrentView(view);
                    }
                  }}
                  onStartCockpitAction={(action) => navigateToEditorWithCockpitAction(selectedNovel, action)}
                />
              </ErrorBoundary>
            )}
            {currentView === 'editor' && selectedNovel && (
              <ErrorBoundary>
                <EditorView
                  key={`${selectedNovel.id}:${continuationLaunchState?.approvedPackId || 'default'}`}
                  novel={selectedNovel}
                  launchState={continuationLaunchState}
                  onBack={() => setCurrentView('library')}
                  onOpenAssistant={handleOpenAssistant}
                />
              </ErrorBoundary>
            )}
            {currentView === 'world' && selectedNovel && (
              <ErrorBoundary>
                <WorldBibleView
                  novel={selectedNovel}
                  onStartContinuationWriting={(packId, prefillIntent) =>
                    navigateToEditorWithContinuation(selectedNovel, packId, 'world-overview', prefillIntent)
                  }
                  onEnterStoryboard={(packId, continuationTask) =>
                    navigateToEditorWithContinuation(selectedNovel, packId, 'storyboard', continuationTask)
                  }
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
                          completedCount: countCompletedSetupTasks(onboardingDraft.setupTasks),
                          canEnterEditor: countCompletedSetupTasks(onboardingDraft.setupTasks) >= 3,
                          onEnterEditor: () => setCurrentView('editor'),
                          recommendedSkills: onboardingDraft.recommendedSkills,
                          acceptedRecommendedSkills: onboardingDraft.acceptedRecommendedSkills,
                          onAcceptRecommendedSkills: handleAcceptRecommendedSkills,
                        }
                      : undefined
                  }
                />
              </ErrorBoundary>
            )}
            {currentView === 'factory' && (
              <ErrorBoundary>
                <BookFactoryView />
              </ErrorBoundary>
            )}
            {currentView === 'skills' && (
              <ErrorBoundary>
                <SkillsStudioView selectedNovel={selectedNovel} onNavigate={setCurrentView} />
              </ErrorBoundary>
            )}
            {currentView === 'editor' && !selectedNovel && (
              <WorkspacePreviewEmptyState
                title="创作舞台等待作品"
                description="选中作品后，编辑器会读取章节、分镜、世界观和技能卡，让正文生成、审查和打磨连成一条线。"
                onGoLibrary={() => setCurrentView('library')}
                onCreateNovel={() => setCurrentView('library')}
                onImport={handleStartContinuationImport}
              />
            )}
            {currentView === 'workspace' && !selectedNovel && (
              <WorkspacePreviewEmptyState
                title="创作工作台暂未开启"
                description="工作台会把章节写作、设定记忆、技能卡和 AI 助手组织在一起。先选择或创建作品，就能开始协作。"
                onGoLibrary={() => setCurrentView('library')}
                onCreateNovel={() => setCurrentView('library')}
                onImport={handleStartContinuationImport}
              />
            )}
            {currentView === 'world' && !selectedNovel && (
              <WorkspacePreviewEmptyState
                title="设定集需要绑定作品"
                description="人物、地点、道具和世界规则都跟作品绑定。选中作品后，设定会成为后续写作和审查的上下文。"
                onGoLibrary={() => setCurrentView('library')}
                onCreateNovel={() => setCurrentView('library')}
                onImport={handleStartContinuationImport}
              />
            )}
          </Suspense>
        </div>
      </main>

      {/* Global AIAssistant Drawer */}
      <AIAssistantDrawer
        isOpen={isAIAssistantOpen}
        onClose={() => setAIAssistantOpen(false)}
        onboardingDraft={onboardingDraft}
        aiDrawerTab={aiDrawerTab}
        setAIDrawerTab={setAIDrawerTab}
        handleSelectStoryCard={handleSelectStoryCard}
        handleCreateDraftFromIdea={handleCreateDraftFromIdea}
        assistantLaunchContext={assistantLaunchContext}
        handleApplyAssistantToContent={handleApplyAssistantToContent}
        handleApplyAssistantToSceneBeats={handleApplyAssistantToSceneBeats}
        handleReplaceAssistantSelection={handleReplaceAssistantSelection}
        selectedNovel={selectedNovel}
      />

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} theme={theme} onThemeChange={setTheme} />
    </div>
  );
}
