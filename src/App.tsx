/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, Suspense, lazy } from 'react';
import X from 'lucide-react/dist/esm/icons/x.js';
import { Sidebar } from './components/Sidebar';
import { WelcomeView } from './components/WelcomeView';
import { AIAssistant } from './components/AIAssistant';
import { StoryCardDeck } from './components/onboarding/StoryCardDeck';
import { ErrorBoundary } from './components/ErrorBoundary';

// 按需加载：仅在用户切换到对应视图时才下载
const Library = lazy(() => import('./components/Library').then(m => ({ default: m.Library })));
const SplitWorkspace = lazy(() => import('./components/SplitWorkspace').then(m => ({ default: m.SplitWorkspace })));
const EditorView = lazy(() => import('./components/EditorView').then(m => ({ default: m.EditorView })));
const WorldBibleView = lazy(() => import('./components/WorldBibleView').then(m => ({ default: m.WorldBibleView })));
const ContinuationImportView = lazy(() => import('./components/ContinuationImportView').then(m => ({ default: m.ContinuationImportView })));
const SkillsStudioView = lazy(() => import('./components/SkillsStudioView').then(m => ({ default: m.SkillsStudioView })));
const BookFactoryView = lazy(() => import('./components/BookFactoryView').then(m => ({ default: m.BookFactoryView })));
import { AssistantLaunchContext, ContinuationEditorLaunchState, OnboardingDraftState, SetupTaskKey, StoryIdeaCard, StoryPlanningInput, ViewType, Novel, WorkspaceFocus, WorkspaceNavKey } from './types';
import { motion, AnimatePresence } from './lib/motion';
import { useAppStore } from './stores/app-store';
import { useNovelStore } from './stores/novel-store';
import { createChapter, createCharacter, createNovel, generateStoryCards, listChapters, listSkills, refineSetupTask, updateChapter, updateNovel } from './lib/api';
import { buildProjectPreferenceProfileFromPlanning, buildSetupTasksFromStoryCard, countCompletedSetupTasks, recommendSkillsForStoryCard } from './lib/onboarding-model';
import { coerceMountedSkillLoadout } from './lib/skill-model';
import { SettingsModal } from './components/SettingsModal';
import { matchesShortcut, SHORTCUTS } from './lib/keyboard-shortcuts';
import { deriveWorkspaceFocus } from './lib/workspace-nav';
import { appendAssistantTextToChapterContent, appendAssistantTextToSceneBeats, replaceAssistantTextInSelection } from './lib/assistant-apply';

const LOCAL_USER = { uid: 'local-user' };

export default function App() {
  const {
    currentView, setCurrentView,
    workspaceFocus, setWorkspaceFocus,
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

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (theme === 'system') setTheme('system'); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme, setTheme]);

  useEffect(() => {
    const handleOpenSettings = () => setSettingsOpen(true);
    window.addEventListener('open-settings', handleOpenSettings);
    return () => window.removeEventListener('open-settings', handleOpenSettings);
  }, []);

  useEffect(() => {
    if (currentView === 'editor') setWorkspaceFocus('editor');
    if (currentView === 'world') setWorkspaceFocus('world');
  }, [currentView]);

  useEffect(() => {
    const viewMap: Record<string, { view: ViewType; navKey?: WorkspaceNavKey }> = {
      view1: { view: 'welcome' },
      view2: { view: 'library' },
      view3: { view: 'workspace', navKey: 'workspace-editor' },
      view4: { view: 'workspace', navKey: 'workspace-world' },
      view5: { view: 'ai' },
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      for (const [id, shortcut] of Object.entries(SHORTCUTS)) {
        if (id in viewMap && matchesShortcut(e, shortcut)) {
          e.preventDefault();
          const target = viewMap[id];
          if (target.view === 'ai') {
             setAIAssistantOpen(true);
             return;
          }
          setWorkspaceFocus(deriveWorkspaceFocus(target.view, target.navKey, useAppStore.getState().workspaceFocus));
          setCurrentView(target.view);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const navigateToEditor = (novel: Novel) => {
    setContinuationLaunchState(null);
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
    setWorkspaceFocus(deriveWorkspaceFocus(view, navKey, useAppStore.getState().workspaceFocus));
    setCurrentView(view);
  };

  useEffect(() => {
    if (currentView !== 'editor' && currentView !== 'workspace' && continuationLaunchState) {
      setContinuationLaunchState(null);
    }
  }, [currentView, continuationLaunchState]);

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
    setCurrentView('workspace');
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
    setCurrentView('workspace');
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
    setCurrentView('workspace');
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
      setCurrentView('ai');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectStoryCard = async (card: StoryIdeaCard, planning?: StoryPlanningInput) => {
    const activePlanning = planning || onboardingDraft?.planning;
    if (!activePlanning) {
      throw new Error('缺少创作规划，无法创建作品。');
    }
    const newNovelId = Date.now().toString();
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
    setCurrentView('world');
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
    if (!selectedNovel || !onboardingDraft.recommendedSkills.length) return;
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
        <motion.div
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="text-xl font-serif italic text-gray-400"
        >
          InkFlow Starting...
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex bg-theme-bg text-theme-text overflow-hidden p-3 gap-3">
      <div className="shrink-0">
        <Sidebar
          currentView={currentView}
          onNavigate={handleNavigate}
          user={user}
          isAIAssistantOpen={isAIAssistantOpen}
        />
      </div>

      <main className="flex-1 relative overflow-hidden bg-paper rounded-2xl border border-theme-border shadow-sm flex flex-col">
        <AnimatePresence mode="sync">
          <motion.div
            key={currentView}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-hidden h-full"
          >
            <Suspense fallback={<div className="flex items-center justify-center h-full text-sm opacity-50">加载中...</div>}>
            {currentView === 'welcome' && (
              <ErrorBoundary>
                <WelcomeView
                  onSelectStoryCard={handleSelectStoryCard}
                  onJumpToLibrary={() => setCurrentView('library')}
                  onSelectNovel={navigateToEditor}
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
                <Library onSelectNovel={navigateToEditor} onNavigate={setCurrentView} userId={'local-user'} />
              </ErrorBoundary>
            )}
            {currentView === 'workspace' && selectedNovel && (
              <ErrorBoundary>
                <SplitWorkspace
                novel={selectedNovel}
                focus={workspaceFocus}
                onFocusChange={setWorkspaceFocus}
                continuationLaunchState={continuationLaunchState}
                onStartContinuationWriting={(packId, prefillIntent) => {
                  navigateToEditorWithContinuation(selectedNovel, packId, 'world-overview', prefillIntent);
                }}
                onEnterStoryboard={(packId, continuationTask) => {
                  navigateToEditorWithContinuation(selectedNovel, packId, 'storyboard', continuationTask);
                }}
                onOpenAssistant={handleOpenAssistant}
                onboarding={
                  onboardingDraft?.setupTasks.length
                    ? {
                        card: onboardingDraft.cards.find((card) => card.id === onboardingDraft.selectedCardId),
                        tasks: onboardingDraft.setupTasks,
                        activeTask: onboardingDraft.setupTasks.find((task) => task.key === activeSetupTaskKey),
                        onSelectTask: (key: SetupTaskKey) => setActiveSetupTaskKey(key),
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
                onBack={() => setCurrentView('library')}
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
                <SkillsStudioView />
              </ErrorBoundary>
            )}
            {currentView === 'editor' && !selectedNovel && (
              <div className="h-full flex flex-col items-center justify-center p-12 text-gray-400 bg-theme-bg/30 relative">
                <div className="w-32 h-32 bg-theme-sidebar/50 rounded-full flex items-center justify-center mb-6 border border-theme-border shadow-inner">
                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-theme-muted"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
                </div>
                <h2 className="text-3xl font-serif font-bold text-theme-text mb-4">创作舞台暂未开启</h2>
                <p className="text-theme-muted mb-8 text-center max-w-md">您似乎还没有选择要编辑的作品。<br/>不同的作品对应独立的写作空间，请先前往「书库」创建或加载您的灵感结晶。</p>
                <button
                  onClick={() => setCurrentView('library')}
                  className="px-8 py-4 bg-theme-accent text-white font-bold rounded-2xl hover:bg-theme-accent/90 transition-[transform,background-color,box-shadow] duration-200 shadow-lg hover:shadow-xl hover:-translate-y-1 flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 16 16 12 12 8"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                  前往书库
                </button>
              </div>
            )}
            {currentView === 'workspace' && !selectedNovel && (
              <div className="h-full flex flex-col items-center justify-center p-12 text-gray-400 bg-theme-bg/30 relative">
                <div className="w-32 h-32 bg-theme-sidebar/50 rounded-full flex items-center justify-center mb-6 border border-theme-border shadow-inner">
                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-theme-muted"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
                </div>
                <h2 className="text-3xl font-serif font-bold text-theme-text mb-4">创作工作台暂未开启</h2>
                <p className="text-theme-muted mb-8 text-center max-w-md">您似乎还没有选择要进入的作品。<br/>请先前往「书库」创建或加载作品，再回到工作台进行写作与设定联动。</p>
                <button
                  onClick={() => setCurrentView('library')}
                  className="px-8 py-4 bg-theme-accent text-white font-bold rounded-2xl hover:bg-theme-accent/90 transition-[transform,background-color,box-shadow] duration-200 shadow-lg hover:shadow-xl hover:-translate-y-1 flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 16 16 12 12 8"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                  前往书库
                </button>
              </div>
            )}
            {currentView === 'world' && !selectedNovel && (
              <div className="h-full flex flex-col items-center justify-center p-12 text-gray-400 bg-theme-bg/30 relative text-center">
                <div className="w-32 h-32 bg-theme-sidebar/50 rounded-full flex items-center justify-center mb-6 border border-theme-border shadow-inner">
                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-theme-muted"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
                </div>
                <h2 className="text-3xl font-serif font-bold text-theme-text mb-4">设定集未关联</h2>
                <p className="text-theme-muted mb-8 max-w-md text-center">人物与设定集是与作品深度绑定的「数据库」。<br/>请先在书库中选择并进入一部作品，以开启其专属的世界圣经。</p>
                <button
                  onClick={() => setCurrentView('library')}
                  className="px-8 py-4 bg-white border-2 border-theme-border text-theme-text font-bold rounded-2xl hover:border-theme-accent transition-[transform,border-color,box-shadow] duration-200 shadow-sm hover:shadow active:scale-95"
                >
                  返回书库选择作品
                </button>
              </div>
            )}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Global AIAssistant Drawer */}
      <AnimatePresence>
        {isAIAssistantOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAIAssistantOpen(false)}
              className="fixed inset-0 z-[60] bg-black/10 backdrop-blur-[2px]"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 z-[70] h-full w-[420px] max-w-[90vw] border-l border-theme-border bg-white shadow-2xl"
            >
              {onboardingDraft ? (
                <div className="h-full flex flex-col">
                  <div className="shrink-0 p-4 border-b border-theme-border flex items-center justify-between bg-white">
                    <div className="flex gap-2">
                      <button onClick={() => setAIDrawerTab('cards')} className={`px-3 py-1.5 rounded-full text-xs font-bold ${aiDrawerTab === 'cards' ? 'bg-theme-text text-white' : 'text-theme-muted hover:bg-theme-sidebar'}`}>方案卡</button>
                      <button onClick={() => setAIDrawerTab('chat')} className={`px-3 py-1.5 rounded-full text-xs font-bold ${aiDrawerTab === 'chat' ? 'bg-theme-text text-white' : 'text-theme-muted hover:bg-theme-sidebar'}`}>灵感对话</button>
                    </div>
                    <button onClick={() => setAIAssistantOpen(false)} className="p-2 rounded-full text-theme-muted hover:bg-theme-sidebar/50 transition-all">
                      <X size={20} />
                    </button>
                  </div>
                  {aiDrawerTab === 'cards' ? (
                    <div className="flex-1 overflow-y-auto px-6 py-8 bg-theme-bg/30">
                      <StoryCardDeck
                        cards={onboardingDraft.cards}
                        selectedCardId={onboardingDraft.selectedCardId}
                        source={onboardingDraft.source}
                        onSelectCard={handleSelectStoryCard}
                        onMixCard={() => {
                          if (onboardingDraft.cards.length >= 2) {
                            const other = onboardingDraft.cards.find(c => c.id !== onboardingDraft.selectedCardId);
                            if (other) {
                              handleCreateDraftFromIdea({
                                ideaSeed: `${onboardingDraft.cards[0].hook} + ${other.hook}`,
                                chatContext: onboardingDraft.ideaSeed,
                                planning: onboardingDraft.planning,
                              });
                            }
                          }
                        }}
                        onRefreshBatch={() =>
                          handleCreateDraftFromIdea({
                            ideaSeed: onboardingDraft.ideaSeed,
                            chatContext: onboardingDraft.ideaSeed,
                            planning: onboardingDraft.planning,
                            isRefresh: true,
                          })
                        }
                      />
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto">
                      <ErrorBoundary>
                        <AIAssistant
                          launchContext={assistantLaunchContext}
                          onApplyToContent={handleApplyAssistantToContent}
                          onApplyToSceneBeats={handleApplyAssistantToSceneBeats}
                          onReplaceSelection={handleReplaceAssistantSelection}
                          onClose={() => setAIAssistantOpen(false)}
                        />
                      </ErrorBoundary>
                    </div>
                  )}
                </div>
              ) : (
                <ErrorBoundary>
                  <AIAssistant
                    launchContext={assistantLaunchContext}
                    onApplyToContent={handleApplyAssistantToContent}
                    onApplyToSceneBeats={handleApplyAssistantToSceneBeats}
                    onReplaceSelection={handleReplaceAssistantSelection}
                    onClose={() => setAIAssistantOpen(false)}
                  />
                </ErrorBoundary>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} theme={theme} onThemeChange={setTheme} />
    </div>
  );
}
