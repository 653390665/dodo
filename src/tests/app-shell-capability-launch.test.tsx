import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { CapabilityLaunchState, Novel, StoryIdeaCard, StoryPlanningInput, ViewType, WorldCapabilityLaunchIntent } from '../../shared/types';

const recommendedSkill = vi.hoisted(() => ({
  id: 'recommended-card',
  name: '推荐能力卡',
  description: '',
  style: '',
  pacing: '',
  stabilityScore: 80,
  evaluationFeedback: '',
  version: 1,
  dimensionTags: ['plot', 'pacing'],
  compositionProfile: {
    styleWeight: 0.5,
    characterWeight: 0.5,
    worldWeight: 0.5,
    powerWeight: 0,
    plotWeight: 0.9,
    pacingWeight: 0.9,
    conflictTags: [],
    blendHints: [],
  },
  createdAt: 1,
}));

vi.mock('../lib/api', () => ({
  createChapter: vi.fn(), createCharacter: vi.fn(), createNovel: vi.fn(),
  generateStoryCards: vi.fn(), getNovel: vi.fn(), listChapters: vi.fn(),
  listSkills: vi.fn().mockResolvedValue([recommendedSkill]), refineSetupTask: vi.fn(),
  updateChapter: vi.fn(), updateNovel: vi.fn(),
}));
vi.mock('../lib/editor-write-queue', () => ({ flushPendingEditorWrites: vi.fn().mockResolvedValue(undefined) }));
const dbCallMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../lib/db-transport', () => ({
  call: dbCallMock,
  getDatabaseGenerationSnapshot: vi.fn().mockResolvedValue(17),
}));
const toastMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/toast', () => ({ toast: toastMock }));
vi.mock('../lib/product-events-client', () => ({ recordProductEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../components/Sidebar', () => ({ Sidebar: () => <aside /> }));
vi.mock('../components/WelcomeView', () => ({
  WelcomeView: ({ onSelectStoryCard }: {
    onSelectStoryCard: (
      card: StoryIdeaCard,
      planning?: StoryPlanningInput,
      recommendedTags?: string[],
      targetView?: ViewType,
      activeSeriesId?: string,
    ) => Promise<void>;
  }) => {
    const planning: StoryPlanningInput = { expectedWordCount: 300000, pacingPreference: 'tight', storyFocus: 'plot' };
    const card: StoryIdeaCard = {
      id: 'story-card-1',
      hook: '番茄开书测试',
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
    return (
      <>
        <button type="button" onClick={() => void onSelectStoryCard(card, planning, ['番茄'], 'workspace', 'tomato-platform-flow')}>
          用番茄流程开书
        </button>
        <button type="button" onClick={() => void onSelectStoryCard(card, planning, ['番茄'], 'world', 'tomato-platform-flow')}>
          用番茄流程开书并补设定
        </button>
      </>
    );
  },
}));
vi.mock('../components/AIAssistantDrawer', () => ({ AIAssistantDrawer: () => null }));
vi.mock('../components/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../components/ProjectCockpitView', () => ({ ProjectCockpitView: () => null }));
vi.mock('../components/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../components/Library', () => ({ Library: () => null }));
vi.mock('../components/WorldBibleView', () => ({
  WorldBibleView: ({ onboarding, capabilityLaunchIntent, onCapabilityLaunchConsumed }: {
    onboarding?: { acceptedRecommendedSkills: boolean; acceptedSkillIds: string[]; onAcceptRecommendedSkills: () => void; recommendedSkills: Array<{ skillName: string }> };
    capabilityLaunchIntent?: WorldCapabilityLaunchIntent | null;
    onCapabilityLaunchConsumed?: (launchToken: number) => void;
  }) => (
    <div>
      WORLD_BIBLE
      <div>WORLD_CAPABILITY:{capabilityLaunchIntent?.capabilityId || 'none'}:{capabilityLaunchIntent?.artifactKind || 'none'}:{capabilityLaunchIntent?.launchToken || 'none'}</div>
      {capabilityLaunchIntent ? (
        <button type="button" onClick={() => onCapabilityLaunchConsumed?.(capabilityLaunchIntent.launchToken)}>确认启动意图已接收</button>
      ) : null}
      {onboarding?.recommendedSkills.length ? (
        <>
          <div>ONBOARDING_RECOMMENDED:{onboarding.recommendedSkills.map((skill) => skill.skillName).join(',')}</div>
          <div>ONBOARDING_ACCEPTED:{String(onboarding.acceptedRecommendedSkills)}</div>
          <div>ONBOARDING_ACCEPTED_IDS:{onboarding.acceptedSkillIds.join(',') || 'none'}</div>
          <button type="button" onClick={() => onboarding.onAcceptRecommendedSkills()}>加入待确认配置</button>
        </>
      ) : null}
    </div>
  ),
}));
vi.mock('../components/ContinuationImportView', () => ({ ContinuationImportView: () => null }));
vi.mock('../components/BookFactoryView', () => ({
  BookFactoryView: ({ chapterId, databaseGeneration, writingStyleFingerprint, onOpenCapabilityCenter }: { chapterId?: string; databaseGeneration?: number; writingStyleFingerprint?: string; onOpenCapabilityCenter?: (novel: Novel) => void }) => (
    <div>
      FACTORY:CHAPTER:{chapterId}:GEN:{databaseGeneration}:STYLE:{writingStyleFingerprint}
      <button type="button" onClick={() => onOpenCapabilityCenter?.({
        id: 'novel-2', title: '拆书目标作品', authorId: 'local-user', summary: '', status: 'ongoing', createdAt: 2, updatedAt: 2,
      })}>提交拆书卡候选</button>
    </div>
  ),
}));
vi.mock('../components/SkillsStudioView', () => ({
  SkillsStudioView: ({ onLaunchCapability, onNavigate, onNovelUpdated, returnView, targetChapterId, initialStage }: { onLaunchCapability?: (state: CapabilityLaunchState) => void; onNavigate?: (view: 'editor' | 'workspace' | 'world', context?: { capabilityApplied?: boolean; targetFocus?: 'workspace-world'; worldCapabilityLaunch?: WorldCapabilityLaunchIntent }) => void; onNovelUpdated?: (novel: Novel) => void; returnView?: string; targetChapterId?: string; initialStage?: string }) => (
    <div>
      <div>SKILLS_RETURN:{returnView}</div>
      <div>SKILLS_TARGET:{targetChapterId}</div>
      <div>SKILLS_STAGE:{initialStage}</div>
      <button type="button" onClick={() => onLaunchCapability?.({ novelId: 'novel-1', launchToken: 101, action: 'use-overlay', assetId: 'overlay-1', targetChapterId, sessionCardIds: ['persisted-card-1'] })}>
        本次使用测试卡
      </button>
      <button type="button" onClick={() => onLaunchCapability?.({ novelId: 'novel-1', launchToken: 102, action: 'open-loadout', assetId: 'project-config' })}>
        错误发送项目配置
      </button>
      <button type="button" onClick={() => onLaunchCapability?.({ novelId: 'novel-1', launchToken: 103, action: 'run-diagnostic', assetId: 'diagnostic-1', targetChapterId })}>
        运行章节诊断
      </button>
      <button type="button" onClick={() => onNavigate?.('editor')}>返回能力来源</button>
      <button type="button" onClick={() => onNavigate?.('editor', { capabilityApplied: true })}>应用后返回能力来源</button>
      <button type="button" onClick={() => onNavigate?.('workspace', { capabilityApplied: true })}>应用后返回工作台</button>
      <button type="button" onClick={() => onNavigate?.('world', {
        capabilityApplied: true,
        targetFocus: 'workspace-world',
        worldCapabilityLaunch: {
          novelId: 'novel-1',
          launchToken: 104,
          capabilityId: 'bible-world-builder',
          artifactKind: 'world',
        },
      })}>打开世界观设定</button>
      <button
        type="button"
        onClick={() => onNovelUpdated?.({
          ...novel,
          projectPreferenceProfile: {
            ...novel.projectPreferenceProfile!,
            tags: novel.projectPreferenceProfile!.tags,
            weights: novel.projectPreferenceProfile!.weights,
            acceptedDimensions: novel.projectPreferenceProfile!.acceptedDimensions,
            rejectedDimensions: novel.projectPreferenceProfile!.rejectedDimensions,
            notes: novel.projectPreferenceProfile!.notes,
            evidenceCount: novel.projectPreferenceProfile!.evidenceCount,
            capabilityProfile: {
              version: 3,
              activeFlowId: 'applied-flow',
              projectSkillDeck: { mainCardId: 'applied-main-card', supportCardIds: [], updatedAt: 2 },
              favoriteTechniqueIds: [],
            },
          },
        })}
      >
        模拟应用能力配置
      </button>
    </div>
  ),
}));
vi.mock('../components/EditorView', () => ({
  EditorView: ({ capabilityLaunchState, launchState, initialChapterId, onNavigate, onChapterContextChange }: {
    capabilityLaunchState?: CapabilityLaunchState | null;
    launchState?: { source?: string; targetChapterId?: string } | null;
    initialChapterId?: string;
    onNavigate?: (view: 'skills' | 'factory', context: { targetChapterId: string; stage?: string }) => void;
    onChapterContextChange?: (context: { chapterId?: string; writingStyleFingerprint?: string }) => void;
  }) => {
    React.useEffect(() => {
      onChapterContextChange?.({ chapterId: 'chapter-2', writingStyleFingerprint: 'style-fingerprint-2' });
    }, [onChapterContextChange]);
    return (
      <div>
        <div>EDITOR:{capabilityLaunchState?.action}:{capabilityLaunchState?.assetId}:SOURCE:{launchState?.source || 'none'}:TARGET:{launchState?.targetChapterId}:INITIAL:{initialChapterId}:CAP_TARGET:{capabilityLaunchState?.targetChapterId}:CARDS:{capabilityLaunchState?.sessionCardIds?.join(',') || 'none'}</div>
        <button type="button" onClick={() => onNavigate?.('skills', { targetChapterId: 'chapter-2' })}>打开作品能力中心</button>
        <button type="button" onClick={() => onNavigate?.('skills', { targetChapterId: 'chapter-2', stage: 'style-polish' })}>打开精修能力卡</button>
        <button type="button" onClick={() => onNavigate?.('factory', { targetChapterId: 'chapter-2' })}>从当前章节拆书</button>
        <button type="button" onClick={() => onNavigate?.('factory', { targetChapterId: 'chapter-3' })}>从其它章节拆书</button>
      </div>
    );
  },
}));

import { AppShell } from '../components/AppShell';
import * as api from '../lib/api';
import { useAppStore } from '../stores/app-store';
import { useNovelStore } from '../stores/novel-store';

const novel: Novel = {
  id: 'novel-1', title: '能力测试作品', authorId: 'local-user', summary: '',
  status: 'ongoing', createdAt: 1, updatedAt: 1,
  projectPreferenceProfile: {
    tags: [],
    weights: { styleWeight: 0.5, characterWeight: 0.5, worldWeight: 0.5, plotWeight: 0.5, pacingWeight: 0.5 },
    acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
    writingStyleConfirmation: { mode: 'skill-deck', fingerprint: 'style-fingerprint-2', confirmedAt: 1 },
  },
};

describe('AppShell capability launch', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    toastMock.mockClear();
    useNovelStore.setState({
      selectedNovel: novel,
      continuationLaunchState: null,
      capabilityLaunchState: null,
    });
    useAppStore.setState({ currentView: 'skills', workspaceFocus: 'editor' });
  });

  test('creates onboarding novels with v3 active flow configuration', async () => {
    useAppStore.setState({ currentView: 'welcome', workspaceFocus: 'world' });
    render(<AppShell />);

    fireEvent.click(await screen.findByRole('button', { name: '用番茄流程开书' }));

    await waitFor(() => expect(dbCallMock).toHaveBeenCalledWith(
      'createNovelWithChapter',
      expect.any(Object),
      expect.objectContaining({ title: '第一章', order: 0 }),
    ));
    const createdNovel = dbCallMock.mock.calls.find(([method]) => method === 'createNovelWithChapter')?.[1] as Novel;
    expect(createdNovel.projectPreferenceProfile?.activeSeriesId).toBe('tomato-platform-flow');
    expect(createdNovel.projectPreferenceProfile?.capabilityModelVersion).toBe(3);
    expect(createdNovel.projectPreferenceProfile?.capabilityProfile?.activeFlowId).toBe('tomato-platform-flow');
    expect(createdNovel.projectPreferenceProfile?.capabilityProfile?.projectSkillDeck.supportCardIds).toEqual([]);
    expect(createdNovel.projectPreferenceProfile?.capabilityProfile?.favoriteTechniqueIds).toEqual([]);
    await waitFor(() => expect(screen.getByText(/EDITOR:/)).toBeDefined());
    expect(useAppStore.getState().currentView).toBe('workspace');
    expect(useAppStore.getState().workspaceFocus).toBe('editor');
  });

  test('opens the capability center for the work targeted by book-factory candidates', async () => {
    useAppStore.setState({ currentView: 'factory', workspaceFocus: 'editor' });
    render(<AppShell />);

    fireEvent.click(await screen.findByRole('button', { name: '提交拆书卡候选' }));

    await waitFor(() => expect(screen.getByText('SKILLS_RETURN:workspace')).toBeDefined());
    expect(useNovelStore.getState().selectedNovel?.id).toBe('novel-2');
    expect(useAppStore.getState().currentView).toBe('skills');
  });

  test('onboarding recommended capability cards stay pending instead of writing legacy mounted slots', async () => {
    useAppStore.setState({ currentView: 'welcome', workspaceFocus: 'world' });
    render(<AppShell />);

    fireEvent.click(await screen.findByRole('button', { name: '用番茄流程开书并补设定' }));
    await waitFor(() => expect(screen.getByText(/ONBOARDING_RECOMMENDED:推荐能力卡/)).toBeDefined());
    expect(screen.getByText('ONBOARDING_ACCEPTED_IDS:none')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '加入待确认配置' }));
    await waitFor(() => expect(screen.getByText('ONBOARDING_ACCEPTED:true')).toBeDefined());
    expect(screen.getByText('ONBOARDING_ACCEPTED_IDS:recommended-card')).toBeDefined();

    expect(vi.mocked(api.updateNovel)).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        mountedSkillIds: expect.any(Array),
      }),
    );
    expect(useNovelStore.getState().selectedNovel?.mountedSkillIds).toEqual([]);
  });

  test('routes a governed capability directly to Editor with independent launch state', async () => {
    render(<AppShell />);
    fireEvent.click(await screen.findByRole('button', { name: '本次使用测试卡' }));

    await waitFor(() => expect(screen.getByText(/EDITOR:use-overlay:overlay-1.*CARDS:persisted-card-1/)).toBeDefined());
    expect(useNovelStore.getState().continuationLaunchState).toBeNull();
    expect(useNovelStore.getState().capabilityLaunchState?.novelId).toBe('novel-1');
  });

  test('keeps project configuration actions in the capability center', async () => {
    render(<AppShell />);
    fireEvent.click(await screen.findByRole('button', { name: '错误发送项目配置' }));

    await waitFor(() => expect(screen.getByText(/^SKILLS_RETURN:/)).toBeDefined());
    expect(useAppStore.getState().currentView).toBe('skills');
    expect(useNovelStore.getState().capabilityLaunchState).toBeNull();
  });

  test('returns from the capability center to the originating chapter', async () => {
    useAppStore.setState({ currentView: 'editor', workspaceFocus: 'editor' });
    render(<AppShell />);

    fireEvent.click(await screen.findByRole('button', { name: '打开作品能力中心' }));
    await waitFor(() => expect(screen.getByText('SKILLS_RETURN:editor')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: '返回能力来源' }));

    await waitFor(() => expect(screen.getByText(/INITIAL:chapter-2/)).toBeDefined());
    expect(screen.getByText(/SOURCE:none/)).toBeDefined();
    expect(useNovelStore.getState().continuationLaunchState).toBeNull();
  });

  test('returns from workspace editor capability center to the originating chapter', async () => {
    useAppStore.setState({ currentView: 'workspace', workspaceFocus: 'editor' });
    render(<AppShell />);

    fireEvent.click(await screen.findByRole('button', { name: '打开作品能力中心' }));

    await waitFor(() => expect(screen.getByText('SKILLS_RETURN:editor')).toBeDefined());
    expect(screen.getByText('SKILLS_TARGET:chapter-2')).toBeDefined();
  });

  test('shows a success toast after applied capabilities return to writing', async () => {
    useAppStore.setState({ currentView: 'editor', workspaceFocus: 'editor' });
    render(<AppShell />);

    fireEvent.click(await screen.findByRole('button', { name: '打开作品能力中心' }));
    await waitFor(() => expect(screen.getByText('SKILLS_RETURN:editor')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: '应用后返回能力来源' }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('能力配置已应用：作品卡组与常用技法影响后续正文，本章使用规则只影响当前章。', 'success'));
    expect(screen.getByText(/INITIAL:chapter-2/)).toBeDefined();
  });

  test('syncs applied capability configuration into the selected novel', async () => {
    render(<AppShell />);

    fireEvent.click(await screen.findByRole('button', { name: '模拟应用能力配置' }));

    await waitFor(() => {
      expect(useNovelStore.getState().selectedNovel?.projectPreferenceProfile?.capabilityProfile?.projectSkillDeck.mainCardId).toBe('applied-main-card');
    });
  });

  test('passes the originating chapter execution context into Book Factory', async () => {
    useAppStore.setState({ currentView: 'editor', workspaceFocus: 'editor' });
    render(<AppShell />);

    fireEvent.click(await screen.findByRole('button', { name: '从当前章节拆书' }));

    await waitFor(() => expect(screen.getByText('FACTORY:CHAPTER:chapter-2:GEN:17:STYLE:style-fingerprint-2')).toBeDefined());
  });

  test('does not pass a stale writing style fingerprint into Book Factory for a different chapter', async () => {
    useAppStore.setState({ currentView: 'editor', workspaceFocus: 'editor' });
    render(<AppShell />);

    fireEvent.click(await screen.findByRole('button', { name: '从其它章节拆书' }));

    await waitFor(() => expect(screen.getByText('FACTORY:CHAPTER:chapter-3:GEN:17:STYLE:')).toBeDefined());
  });

  test('runs diagnostics against the chapter that opened the capability center', async () => {
    useAppStore.setState({ currentView: 'editor', workspaceFocus: 'editor' });
    render(<AppShell />);

    fireEvent.click(await screen.findByRole('button', { name: '打开作品能力中心' }));
    await waitFor(() => expect(screen.getByText('SKILLS_TARGET:chapter-2')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: '运行章节诊断' }));

    await waitFor(() => expect(screen.getByText(/EDITOR:run-diagnostic:diagnostic-1:.*INITIAL:chapter-2:CAP_TARGET:chapter-2/)).toBeDefined());
  });

  test('opens polish cards from the editor with the originating chapter and stage', async () => {
    useAppStore.setState({ currentView: 'editor', workspaceFocus: 'editor' });
    render(<AppShell />);

    fireEvent.click(await screen.findByRole('button', { name: '打开精修能力卡' }));

    await waitFor(() => expect(screen.getByText('SKILLS_TARGET:chapter-2')).toBeDefined());
    expect(screen.getByText('SKILLS_STAGE:style-polish')).toBeDefined();
    expect(screen.getByText('SKILLS_RETURN:editor')).toBeDefined();
  });

  test('routes worldbuilding capability actions to the world bible workspace', async () => {
    render(<AppShell />);

    fireEvent.click(await screen.findByRole('button', { name: '打开世界观设定' }));

    await waitFor(() => expect(screen.getByText('WORLD_BIBLE')).toBeDefined());
    expect(screen.getByText('WORLD_CAPABILITY:bible-world-builder:world:104')).toBeDefined();
    expect(useAppStore.getState().currentView).toBe('world');
    expect(useAppStore.getState().workspaceFocus).toBe('world');
    expect(useNovelStore.getState().capabilityLaunchState).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '确认启动意图已接收' }));
    await waitFor(() => expect(screen.getByText('WORLD_CAPABILITY:none:none:none')).toBeDefined());

    act(() => useNovelStore.getState().setSelectedNovel({ ...novel, id: 'novel-2' }));
    await waitFor(() => expect(screen.getByText('WORLD_CAPABILITY:none:none:none')).toBeDefined());
  });

  test('uses an overlay card against the chapter that opened the capability center', async () => {
    useAppStore.setState({ currentView: 'editor', workspaceFocus: 'editor' });
    render(<AppShell />);

    fireEvent.click(await screen.findByRole('button', { name: '打开作品能力中心' }));
    await waitFor(() => expect(screen.getByText('SKILLS_TARGET:chapter-2')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: '本次使用测试卡' }));

    await waitFor(() => expect(screen.getByText(/EDITOR:use-overlay:overlay-1:.*CAP_TARGET:chapter-2:CARDS:persisted-card-1/)).toBeDefined());
    expect(useNovelStore.getState().capabilityLaunchState?.targetChapterId).toBe('chapter-2');
  });

});
