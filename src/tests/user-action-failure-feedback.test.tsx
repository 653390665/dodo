// Plan 180: 用户动作失败反馈——删章节、建书、刷一批三处静默失败。
// 三个用例共用一个文件：Library（真实组件）、useEditorPersistence（renderHook）、
// AppShell + 真实 AIAssistantDrawer + 真实 StoryCardDeck。toast 用真实模块，
// 通过 document.querySelector('[data-inkflow-toasts]') 断言 DOM 反馈。
// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Chapter, Novel, StoryIdeaCard } from '../../shared/types';

const mocks = vi.hoisted(() => ({
  // chapter-client
  createChapter: vi.fn(),
  createChapterVersion: vi.fn(),
  deleteChapter: vi.fn(),
  listChapters: vi.fn(),
  listChaptersMetadata: vi.fn(),
  updateChapter: vi.fn(),
  // novel-client
  listNovels: vi.fn(),
  createNovelWithChapter: vi.fn(),
  deleteNovel: vi.fn(),
  updateNovel: vi.fn(),
  // lib
  generateStoryCards: vi.fn(),
  recordProductEvent: vi.fn(),
  flushPendingEditorWrites: vi.fn(),
  callBatch: vi.fn(),
  subscribeToChanges: vi.fn((_callback: () => void) => () => {}),
}));

vi.mock('../lib/chapter-client', () => ({
  createChapter: mocks.createChapter,
  createChapterVersion: mocks.createChapterVersion,
  deleteChapter: mocks.deleteChapter,
  listChapters: mocks.listChapters,
  listChaptersMetadata: mocks.listChaptersMetadata,
  updateChapter: mocks.updateChapter,
}));
vi.mock('../lib/novel-client', () => ({
  listNovels: mocks.listNovels,
  createNovelWithChapter: mocks.createNovelWithChapter,
  deleteNovel: mocks.deleteNovel,
  updateNovel: mocks.updateNovel,
}));
vi.mock('../lib/product-events-client', () => ({ recordProductEvent: mocks.recordProductEvent }));
vi.mock('../lib/editor-write-queue', () => ({
  flushPendingEditorWrites: mocks.flushPendingEditorWrites,
  hasFailedEditorWrites: vi.fn().mockReturnValue(false),
  hasPendingEditorWrites: vi.fn().mockReturnValue(false),
  queueEditorWrite: vi.fn(),
  subscribeToEditorWrites: vi.fn().mockReturnValue(() => {}),
}));
vi.mock('../lib/continuation-client', () => ({ listContinuationPacks: vi.fn().mockResolvedValue([]) }));
vi.mock('../lib/db-transport', () => ({
  call: vi.fn().mockResolvedValue(undefined),
  callBatch: mocks.callBatch,
  subscribeToChanges: mocks.subscribeToChanges,
  getDatabaseGenerationSnapshot: vi.fn().mockResolvedValue(17),
}));
vi.mock('../lib/client-logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('../lib/api', () => ({
  createChapter: vi.fn(),
  createCharacter: vi.fn(),
  createNovel: vi.fn(),
  generateStoryCards: mocks.generateStoryCards,
  getNovel: vi.fn(),
  listChapters: vi.fn().mockResolvedValue([]),
  listSkills: vi.fn().mockResolvedValue([]),
  refineSetupTask: vi.fn(),
  updateChapter: vi.fn(),
  updateCharacter: vi.fn(),
  updateNovel: vi.fn(),
}));
vi.mock('../lib/world-client', () => ({
  listCharacters: vi.fn().mockResolvedValue([]),
  listTimelineEvents: vi.fn().mockResolvedValue([]),
}));
vi.mock('../lib/foreshadowing-client', () => ({ listForeshadowings: vi.fn().mockResolvedValue([]) }));

// AppShell 周边重组件全部替换为轻桩；Library 与 AIAssistantDrawer 保持真实（被测对象）。
vi.mock('../components/Sidebar', () => ({ Sidebar: () => <aside /> }));
vi.mock('../components/WelcomeView', () => ({ WelcomeView: () => <div /> }));
vi.mock('../components/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../components/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../components/commercial/PremiumUpgradeModal', () => ({ PremiumUpgradeModal: () => null }));
vi.mock('../components/ProjectCockpitView', () => ({ ProjectCockpitView: () => <div /> }));
vi.mock('../components/ContinuationImportView', () => ({ ContinuationImportView: () => <div /> }));
vi.mock('../components/SkillsStudioView', () => ({ SkillsStudioView: () => <div /> }));
vi.mock('../components/BookFactoryView', () => ({ BookFactoryView: () => <div /> }));
vi.mock('../components/EditorView', () => ({ EditorView: () => <div /> }));
vi.mock('../components/WorldBibleView', () => ({ WorldBibleView: () => <div /> }));
vi.mock('../components/AIAssistant', () => ({ AIAssistant: () => <div>作品助手内容</div> }));
vi.mock('../components/WorldBibleAssistant', () => ({ WorldBibleAssistant: () => <div>设定助手内容</div> }));

import { AppShell } from '../components/AppShell';
import { Library } from '../components/Library';
import { useEditorPersistence } from '../lib/hooks/useEditorPersistence';
import { useAppStore } from '../stores/app-store';
import { useNovelStore } from '../stores/novel-store';

const novel: Novel = { id: 'novel-1', title: '测试作品', authorId: 'local-user', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 };
const chapter: Chapter = {
  id: 'chapter-1', novelId: novel.id, title: '第一章', volumeName: '正文卷', content: '原文', sceneBeats: '',
  order: 1, wordCount: 2, createdAt: 1, updatedAt: 1,
};

function getToastText(): string {
  return document.querySelector('[data-inkflow-toasts]')?.textContent ?? '';
}

describe('user action failure feedback (plan 180)', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.flushPendingEditorWrites.mockResolvedValue(undefined);
    mocks.recordProductEvent.mockResolvedValue(undefined);
    mocks.subscribeToChanges.mockImplementation(() => () => {});
    mocks.listNovels.mockResolvedValue([]);
    mocks.callBatch.mockRejectedValue(new Error('batch metadata unsupported'));
  });

  test('Library: create novel failure shows error toast and keeps the input for retry', async () => {
    mocks.createNovelWithChapter.mockRejectedValue(new Error('db down'));

    render(<Library userId="local-user" onSelectNovel={vi.fn()} />);
    await waitFor(() => expect(mocks.listNovels).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '创建空白作品' }));
    const input = screen.getByPlaceholderText('在此输入新书名...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '失败之书' } });
    fireEvent.click(screen.getByRole('button', { name: '立即创建' }));

    await waitFor(() => expect(mocks.createNovelWithChapter).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getToastText()).toContain('创建作品失败'));

    // 保留输入与展开状态，用户可直接重试
    expect(input.value).toBe('失败之书');
    expect(screen.getByRole('button', { name: '立即创建' })).toBeDefined();
    expect(screen.queryByText('测试作品')).toBeNull();
  });

  test('useEditorPersistence: delete chapter rejection toasts and does not mutate chapter list', async () => {
    mocks.deleteChapter.mockRejectedValue(new Error('db down'));
    const setChapters = vi.fn();
    const setCurrentChapter = vi.fn();
    const unhandled: unknown[] = [];
    const onUnhandled = (event: PromiseRejectionEvent) => { unhandled.push(event.reason); };
    window.addEventListener('unhandledrejection', onUnhandled);

    const { result } = renderHook(() => useEditorPersistence({
      novel,
      chapters: [chapter],
      currentChapter: chapter,
      isContentLockedRef: { current: false },
      contentRef: { current: null },
      setChapters,
      setCurrentChapter,
      selectChapter: vi.fn().mockResolvedValue(chapter),
      setMountedSkillLoadout: vi.fn(),
      setProjectPreferenceProfile: vi.fn(),
      setGlobalOutline: vi.fn(),
      setExpandedVolumes: vi.fn(),
      pushToUndoHistory: vi.fn(),
    }));

    // 不抛出即证明 rejection 已在 hook 内被接住（无 unhandled rejection）。
    await act(async () => { await result.current.handleDeleteChapter('chapter-1'); });
    window.removeEventListener('unhandledrejection', onUnhandled);

    expect(mocks.deleteChapter).toHaveBeenCalledWith('chapter-1');
    expect(getToastText()).toContain('删除章节失败');
    expect(setChapters).not.toHaveBeenCalled();
    expect(setCurrentChapter).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  });

  test('AppShell: story card refresh failure toasts without swapping the whole window for the loading screen', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.generateStoryCards.mockRejectedValue(new Error('llm down'));

    const storyCard: StoryIdeaCard = {
      id: 'story-card-1',
      hook: '方案卡钩子',
      protagonist: '主角候选',
      coreConflict: '核心冲突',
      tone: '爽文',
      whyItWorks: '节奏明确',
      starterSeeds: { worldSeed: '世界种子', relationshipSeed: '关系种子', chapterOneSeed: '第一章种子' },
      planningFit: { recommendedLength: '30万字', recommendedFocus: '剧情推进', recommendedPacing: '紧推进', reason: '适合平台节奏' },
      riskNote: '',
      mixTags: [],
      signals: { tone: '爽文', conflictType: '升级', worldWeight: 0.3, characterWeight: 0.5, pacingPreference: 'tight' },
    };
    useNovelStore.setState({
      selectedNovel: null,
      assistantLaunchContext: null,
      onboardingDraft: {
        ideaSeed: '一句灵感',
        planning: { expectedWordCount: 100_000, pacingPreference: 'balanced', storyFocus: 'plot' },
        cards: [storyCard],
        setupTasks: [],
        acceptedSkillIds: [],
        recommendedSkills: [],
        acceptedRecommendedSkills: false,
      },
    });
    useAppStore.setState({
      currentView: 'welcome',
      isAIAssistantOpen: true,
      assistantMode: 'general',
      aiDrawerTab: 'cards',
      assistantSurfaceContext: null,
    });

    render(<AppShell />);

    // 真实 AIAssistantDrawer → 真实 StoryCardDeck 中的「继续刷一批」按钮。
    const refreshButton = await screen.findByRole('button', { name: '继续刷一批' });
    fireEvent.click(refreshButton);

    await waitFor(() => expect(mocks.generateStoryCards).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getToastText()).toContain('生成方案卡失败'));

    // 主界面仍是 app-ready（data-ready-state="true"），没有被全屏 loading 分支替换。
    const appReady = document.querySelector('[data-testid="app-ready"]');
    expect(appReady?.getAttribute('data-ready-state')).toBe('true');
    expect(screen.queryByText('正在启动 InkFlow…')).toBeNull();
    // 方案卡仍然在抽屉中，按钮恢复可点击。
    await waitFor(() => expect(screen.getByRole('button', { name: '继续刷一批' })).toBeDefined());
    expect(screen.getByText('方案卡钩子')).toBeDefined();
    consoleError.mockRestore();
  });
});
