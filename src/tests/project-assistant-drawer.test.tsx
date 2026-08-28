import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('../components/AIAssistant', () => ({
  AIAssistant: () => <div>作品助手内容</div>,
}));
vi.mock('../components/WorldBibleAssistant', () => ({
  WorldBibleAssistant: () => <div>设定助手内容</div>,
}));

import { AIAssistantDrawer } from '../components/AIAssistantDrawer';

const novel = { id: 'novel-1', title: '测试作品' } as never;

function renderDrawer(overrides: Partial<React.ComponentProps<typeof AIAssistantDrawer>> = {}) {
  const props: React.ComponentProps<typeof AIAssistantDrawer> = {
    isOpen: true,
    onClose: vi.fn(),
    onboardingDraft: null,
    aiDrawerTab: 'chat',
    setAIDrawerTab: vi.fn(),
    handleSelectStoryCard: vi.fn(),
    handleCreateDraftFromIdea: vi.fn(),
    assistantLaunchContext: null,
    handleApplyAssistantToContent: vi.fn(),
    handleApplyAssistantToSceneBeats: vi.fn(),
    handleReplaceAssistantSelection: vi.fn(),
    selectedNovel: novel,
    assistantMode: 'general',
    onAssistantModeChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<AIAssistantDrawer {...props} />), props };
}

describe('Project assistant drawer', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  test('renders a dialog with an explicit mode switch and general assistant by default', () => {
    renderDrawer();

    const dialog = screen.getByRole('dialog');
    const generalButton = screen.getByRole('button', { name: '作品协作' });
    const bibleButton = screen.getByRole('button', { name: '设定记忆' });
    expect(dialog).toBeDefined();
    expect(dialog.className).toContain('flex');
    expect(dialog.className).toContain('flex-col');
    expect(dialog.className).toContain('min-h-0');
    expect(generalButton.getAttribute('aria-pressed')).toBe('true');
    expect(bibleButton.getAttribute('aria-pressed')).toBe('false');
    expect(generalButton.className).toContain('bg-theme-text');
    expect(generalButton.className).toContain('text-white');
    expect(bibleButton.className).toContain('text-theme-muted');
    expect(bibleButton.className).not.toContain('bg-theme-text');
    expect(screen.getByText('作品助手内容')).toBeDefined();
    expect(screen.queryByText('设定助手内容')).toBeNull();
    expect(screen.getByText('作品助手内容').parentElement?.className).toContain('min-h-0');
  });

  test('switches to bible mode through the callback and renders only WorldBibleAssistant', () => {
    const onAssistantModeChange = vi.fn();
    const { rerender, props } = renderDrawer({ onAssistantModeChange });

    fireEvent.click(screen.getByRole('button', { name: '设定记忆' }));
    expect(onAssistantModeChange).toHaveBeenCalledTimes(1);
    expect(onAssistantModeChange).toHaveBeenCalledWith('bible');

    rerender(<AIAssistantDrawer {...props} assistantMode="bible" />);
    expect(screen.getByRole('button', { name: '设定记忆' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('设定助手内容')).toBeDefined();
    expect(screen.queryByText('作品助手内容')).toBeNull();
  });

  test('bible mode takes precedence over a retained onboarding draft', () => {
    renderDrawer({
      assistantMode: 'bible',
      onboardingDraft: {
        ideaSeed: '旧开书上下文',
        planning: { expectedWordCount: 100_000, pacingPreference: 'balanced', storyFocus: 'plot' },
        cards: [],
        setupTasks: [],
        acceptedSkillIds: [],
        recommendedSkills: [],
        acceptedRecommendedSkills: false,
      },
    });

    expect(screen.getByText('设定助手内容')).toBeDefined();
    expect(screen.queryByText('作品助手内容')).toBeNull();
  });

  test('keeps Escape and backdrop close behavior', () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.previousElementSibling as HTMLElement;
    expect(backdrop.className).toContain('fixed');
    expect(backdrop.className).toContain('inset-0');
    expect(backdrop.className).not.toContain('sm:left-[76px]');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
