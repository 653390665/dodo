import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { Novel } from '../../shared/types';

const mocks = vi.hoisted(() => ({
  apiCalls: [] as string[],
}));

vi.mock('../lib/api', () => ({
  createChapter: vi.fn(),
  createCharacter: vi.fn(),
  createNovel: vi.fn(),
  generateStoryCards: vi.fn(() => { mocks.apiCalls.push('generateStoryCards'); }),
  getNovel: vi.fn(),
  listChapters: vi.fn().mockResolvedValue([]),
  listSkills: vi.fn().mockResolvedValue([]),
  refineSetupTask: vi.fn(),
  updateChapter: vi.fn(),
  updateNovel: vi.fn(),
}));
vi.mock('../lib/editor-write-queue', () => ({ flushPendingEditorWrites: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../components/Sidebar', () => ({ Sidebar: () => <aside>SIDEBAR</aside> }));
vi.mock('../components/WelcomeView', () => ({ WelcomeView: () => <div>WELCOME</div> }));
vi.mock('../components/AIAssistantDrawer', () => ({ AIAssistantDrawer: () => null }));
vi.mock('../components/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../components/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../components/Library', () => ({ Library: () => <div>LIBRARY</div> }));
vi.mock('../components/ProjectCockpitView', () => ({ ProjectCockpitView: () => <div>COCKPIT</div> }));
vi.mock('../components/WorldBibleView', () => ({ WorldBibleView: () => <div>WORLD</div> }));
vi.mock('../components/ContinuationImportView', () => ({ ContinuationImportView: () => <div>IMPORT</div> }));
vi.mock('../components/SkillsStudioView', () => ({ SkillsStudioView: () => <div>SKILLS</div> }));
vi.mock('../components/BookFactoryView', () => ({ BookFactoryView: () => <div>FACTORY</div> }));
vi.mock('../components/EditorView', () => ({
  EditorView: ({ onOpenBibleAssistant }: { onOpenBibleAssistant?: (prompt: string) => void }) => (
    <button
      data-testid="open-continuation-gap-assistant"
      onClick={() => onOpenBibleAssistant?.('补充顾铁峰与苏老板二十年前共事片段')}
    >
      补充资料缺口
    </button>
  ),
}));

import { AppShell } from '../components/AppShell';
import { useAppStore } from '../stores/app-store';
import { useAssistantSessionStore } from '../stores/assistant-session-store';
import { useNovelStore } from '../stores/novel-store';

const novel: Novel = {
  id: 'novel-gap',
  title: '缺口测试作品',
  authorId: 'local-user',
  summary: '',
  status: 'ongoing',
  createdAt: 1,
  updatedAt: 1,
};

describe('continuation gap assistant bridge', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.apiCalls.length = 0;
    useNovelStore.setState({ selectedNovel: novel, assistantLaunchContext: null });
    useAppStore.setState({
      currentView: 'editor',
      workspaceFocus: 'editor',
      isAIAssistantOpen: false,
      assistantMode: 'general',
      assistantSurfaceContext: null,
    });
    useAssistantSessionStore.getState().clearSession(novel.id, 'bible');
  });

  test('prefills the bible session and opens the global bible assistant', async () => {
    render(<AppShell />);
    const button = await screen.findByTestId('open-continuation-gap-assistant');
    fireEvent.click(button);

    await waitFor(() => expect(useAppStore.getState().isAIAssistantOpen).toBe(true));
    expect(useAppStore.getState().assistantMode).toBe('bible');
    expect(useAppStore.getState().assistantSurfaceContext).toEqual({
      surface: 'editor',
      novelId: novel.id,
      intent: 'continuation-gap',
    });
    expect(useAssistantSessionStore.getState().getSession(novel.id, 'bible').input)
      .toBe('补充顾铁峰与苏老板二十年前共事片段');
    expect(mocks.apiCalls).toEqual([]);
  });
});
