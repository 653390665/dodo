import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { getSidebarMainItems } from '../lib/workspace-nav';
import { WelcomeView } from '../components/WelcomeView';
import { AIAssistantDrawer } from '../components/AIAssistantDrawer';
import type { OnboardingDraftState, StoryIdeaCard } from '../../shared/types';

// 灵感卡片可注入，供「创作方向确认」弹窗用例使用；默认为空
const storyCardsMockState = vi.hoisted(() => ({
  cards: [] as StoryIdeaCard[],
}));

vi.mock('../hooks/useStoryCards', () => ({
  useStoryCards: () => ({
    get cards() {
      return storyCardsMockState.cards;
    },
    source: null,
    isWaiting: false,
    isModelPending: false,
    warnings: [],
    submit: vi.fn(),
  }),
}));

vi.mock('../lib/novel-client', () => ({
  listNovels: vi.fn().mockResolvedValue([]),
  getNovel: vi.fn().mockResolvedValue(undefined),
  createNovel: vi.fn().mockResolvedValue(undefined),
  updateNovel: vi.fn().mockResolvedValue(undefined),
  deleteNovel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/config-client', () => ({
  fetchLlmConfig: vi
    .fn()
    .mockResolvedValue({ config: { embeddingStatus: { status: 'unknown' } }, availability: 'ready' }),
}));

// 抽屉用例不测内部实现，轻量替换子组件
vi.mock('../components/onboarding/StoryCardDeck', () => ({
  StoryCardDeck: () => <div data-testid="story-card-deck" />,
}));
vi.mock('../components/AIAssistant', () => ({
  AIAssistant: () => <div data-testid="ai-assistant" />,
}));
vi.mock('../components/WorldBibleAssistant', () => ({
  WorldBibleAssistant: () => <div />,
}));

afterEach(() => {
  cleanup();
  storyCardsMockState.cards = [];
});

const makeCard = (id: string, hook: string): StoryIdeaCard =>
  ({
    id,
    hook,
    protagonist: '沉默刀客',
    coreConflict: '复仇与真相的拉扯',
    tone: '冷峻悬疑',
    whyItWorks: '强冲突开局，悬念驱动。',
    starterSeeds: { worldSeed: '', relationshipSeed: '', chapterOneSeed: '' },
    planningFit: { recommendedLength: '', recommendedFocus: '', recommendedPacing: '', reason: '' },
    riskNote: '',
    mixTags: [],
    signals: {
      tone: '',
      conflictType: '',
      worldWeight: 0,
      characterWeight: 0,
      pacingPreference: 'balanced',
    },
  }) as StoryIdeaCard;

const makeDraft = (overrides: Partial<OnboardingDraftState> = {}): OnboardingDraftState =>
  ({
    ideaSeed: '雨夜酒馆里的复仇故事',
    planning: {
      expectedWordCount: 300000,
      pacingPreference: 'balanced',
      storyFocus: 'plot',
      styleAnchors: [],
    },
    cards: [makeCard('card-1', '雨夜酒馆里的复仇刀客')],
    setupTasks: [],
    acceptedSkillIds: [],
    recommendedSkills: [],
    acceptedRecommendedSkills: false,
    ...overrides,
  }) as OnboardingDraftState;

const renderWelcome = (props: Partial<Parameters<typeof WelcomeView>[0]> = {}) => {
  const onHatchIdea = vi.fn();
  const merged = {
    onSelectStoryCard: vi.fn(),
    onJumpToLibrary: vi.fn(),
    onSelectNovel: vi.fn(),
    onStartContinuationImport: vi.fn(),
    onHatchIdea,
    ...props,
  } as Parameters<typeof WelcomeView>[0];
  render(<WelcomeView {...merged} />);
  return { onHatchIdea };
};

const getSeedTextarea = (): HTMLTextAreaElement =>
  document.getElementById('story-seed-input') as HTMLTextAreaElement;

describe('创作入口定位收敛', () => {
  test('侧边栏主项：「开始创作」更名「首页」，且项序稳定', () => {
    const items = getSidebarMainItems();
    expect(items.map((item) => item.id)).toEqual(['welcome', 'library', 'workspace', 'ai']);
    expect(items.map((item) => item.label)).toEqual(['首页', '我的书库', '创作工作台', 'AI 协作']);
  });

  test('抽屉孵化模式：显示「灵感孵化」定位标识', () => {
    render(
      <AIAssistantDrawer
        isOpen
        onClose={vi.fn()}
        onboardingDraft={makeDraft()}
        aiDrawerTab="cards"
        setAIDrawerTab={vi.fn()}
        handleSelectStoryCard={vi.fn()}
        handleCreateDraftFromIdea={vi.fn()}
        assistantLaunchContext={null}
        handleApplyAssistantToContent={vi.fn()}
        handleApplyAssistantToSceneBeats={vi.fn()}
        handleReplaceAssistantSelection={vi.fn()}
        selectedNovel={null}
        assistantMode="general"
        onAssistantModeChange={vi.fn()}
      />
    );
    expect(screen.getByText('灵感孵化')).toBeTruthy();
    expect(screen.getByTestId('story-card-deck')).toBeTruthy();
  });

  test('抽屉孵化模式：「直接快速开书」优先携带选中方案卡的钩子', () => {
    const onQuickCreate = vi.fn();
    render(
      <AIAssistantDrawer
        isOpen
        onClose={vi.fn()}
        onboardingDraft={makeDraft({
          cards: [makeCard('card-1', '钩子甲'), makeCard('card-2', '钩子乙')],
          selectedCardId: 'card-2',
        })}
        aiDrawerTab="cards"
        setAIDrawerTab={vi.fn()}
        handleSelectStoryCard={vi.fn()}
        handleCreateDraftFromIdea={vi.fn()}
        assistantLaunchContext={null}
        handleApplyAssistantToContent={vi.fn()}
        handleApplyAssistantToSceneBeats={vi.fn()}
        handleReplaceAssistantSelection={vi.fn()}
        selectedNovel={null}
        assistantMode="general"
        onAssistantModeChange={vi.fn()}
        onQuickCreate={onQuickCreate}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '直接快速开书' }));
    expect(onQuickCreate).toHaveBeenCalledTimes(1);
    expect(onQuickCreate).toHaveBeenCalledWith('钩子乙');
  });

  test('抽屉孵化模式：未选中方案卡时携带当前种子', () => {
    const onQuickCreate = vi.fn();
    render(
      <AIAssistantDrawer
        isOpen
        onClose={vi.fn()}
        onboardingDraft={makeDraft()}
        aiDrawerTab="cards"
        setAIDrawerTab={vi.fn()}
        handleSelectStoryCard={vi.fn()}
        handleCreateDraftFromIdea={vi.fn()}
        assistantLaunchContext={null}
        handleApplyAssistantToContent={vi.fn()}
        handleApplyAssistantToSceneBeats={vi.fn()}
        handleReplaceAssistantSelection={vi.fn()}
        selectedNovel={null}
        assistantMode="general"
        onAssistantModeChange={vi.fn()}
        onQuickCreate={onQuickCreate}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '直接快速开书' }));
    expect(onQuickCreate).toHaveBeenCalledWith('雨夜酒馆里的复仇故事');
  });

  test('首页：灵感输入后可一键「让 AI 多出几个方案」带种子进孵化', () => {
    const { onHatchIdea } = renderWelcome();
    const hatchButton = screen.getByRole('button', { name: '让 AI 多出几个方案' });
    expect((hatchButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(getSeedTextarea(), { target: { value: '深夜便利店的第100次偶遇' } });
    expect((hatchButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(hatchButton);
    expect(onHatchIdea).toHaveBeenCalledTimes(1);
    expect(onHatchIdea.mock.calls[0][0]).toBe('深夜便利店的第100次偶遇');
    expect(onHatchIdea.mock.calls[0][1]).toMatchObject({ expectedWordCount: 300000 });
  });

  test('首页：seedPrefill 变化时把孵化种子回填进灵感输入框', () => {
    const base = {
      onSelectStoryCard: vi.fn(),
      onJumpToLibrary: vi.fn(),
      onSelectNovel: vi.fn(),
      onStartContinuationImport: vi.fn(),
    } as Parameters<typeof WelcomeView>[0];
    const { rerender } = render(
      <WelcomeView {...base} seedPrefill={{ text: '记忆货币世界的造假者', token: 1 }} />
    );
    expect(getSeedTextarea().value).toBe('记忆货币世界的造假者');

    rerender(
      <WelcomeView {...base} seedPrefill={{ text: '升级后的新种子', token: 2 }} />
    );
    expect(getSeedTextarea().value).toBe('升级后的新种子');
  });

  test('创作方向确认弹窗：导流「去灵感孵化」携带方案钩子并关闭弹窗', () => {
    const onHatchIdea = vi.fn();
    storyCardsMockState.cards = [makeCard('card-hatch', '靠记忆为货币运转的世界')];
    try {
      renderWelcome({ onHatchIdea });
      fireEvent.click(screen.getByRole('button', { name: /靠记忆为货币运转的世界/ }));
      expect(screen.getByText('创作方向确认')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: '去灵感孵化' }));
      expect(onHatchIdea).toHaveBeenCalledWith(
        '靠记忆为货币运转的世界',
        expect.any(Object)
      );
      expect(screen.queryByText('创作方向确认')).toBeNull();
    } finally {
      storyCardsMockState.cards = [];
    }
  });
});
