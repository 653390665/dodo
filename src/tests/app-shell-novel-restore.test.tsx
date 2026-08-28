import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { Novel } from '../../shared/types';

const mocks = vi.hoisted(() => ({
  getNovel: vi.fn(),
  recordProductEvent: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  createChapter: vi.fn(),
  createCharacter: vi.fn(),
  createNovel: vi.fn(),
  generateStoryCards: vi.fn(),
  getNovel: mocks.getNovel,
  listChapters: vi.fn(),
  listSkills: vi.fn().mockResolvedValue([]),
  refineSetupTask: vi.fn(),
  updateChapter: vi.fn(),
  updateNovel: vi.fn(),
}));
vi.mock('../lib/editor-write-queue', () => ({ flushPendingEditorWrites: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../lib/product-events-client', () => ({ recordProductEvent: mocks.recordProductEvent }));
vi.mock('../components/Sidebar', () => ({ Sidebar: ({ onNavigate }: { onNavigate: (view: 'editor') => void }) => (
  <aside>
    <button data-testid="enter-editor" onClick={() => onNavigate('editor')}>SIDEBAR</button>
  </aside>
) }));
vi.mock('../components/WelcomeView', () => ({ WelcomeView: ({ onSelectNovel }: { onSelectNovel: (novel: Novel) => void }) => (
  <div>
    <button onClick={() => onSelectNovel(restoredNovel)}>选择作品</button>
    WELCOME
  </div>
) }));
vi.mock('../components/AIAssistantDrawer', () => ({ AIAssistantDrawer: () => null }));
vi.mock('../components/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../components/ProjectCockpitView', () => ({ ProjectCockpitView: ({ novel }: { novel: Novel }) => <div>COCKPIT:{novel.title}</div> }));
vi.mock('../components/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../components/Library', () => ({ Library: () => <div>LIBRARY</div> }));
vi.mock('../components/EditorView', () => ({ EditorView: ({ novel }: { novel: Novel }) => <div>EDITOR:{novel.title}</div> }));
vi.mock('../components/WorldBibleView', () => ({ WorldBibleView: ({ novel }: { novel: Novel }) => <div>WORLD:{novel.title}</div> }));
vi.mock('../components/ContinuationImportView', () => ({ ContinuationImportView: () => <div>IMPORT</div> }));
vi.mock('../components/SkillsStudioView', () => ({ SkillsStudioView: () => <div>SKILLS</div> }));
vi.mock('../components/BookFactoryView', () => ({ BookFactoryView: () => <div>FACTORY</div> }));

import { AppShell } from '../components/AppShell';
import { useAppStore } from '../stores/app-store';
import { useNovelStore } from '../stores/novel-store';

const restoredNovel: Novel = {
  id: 'restored-novel',
  title: '恢复作品',
  authorId: 'local-user',
  summary: '',
  status: 'ongoing',
  createdAt: 1,
  updatedAt: 2,
};

describe('AppShell selected novel restoration', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.getNovel.mockReset();
    mocks.recordProductEvent.mockReset();
    mocks.recordProductEvent.mockResolvedValue(undefined);
    useNovelStore.setState({ selectedNovel: null });
    useAppStore.setState({ currentView: 'world', workspaceFocus: 'world' });
  });

  test('restores the selected novel before rendering a persisted world view', async () => {
    useNovelStore.getState().setSelectedNovel(restoredNovel);
    useNovelStore.setState({ selectedNovel: null });
    mocks.getNovel.mockResolvedValue(restoredNovel);

    render(
      <React.StrictMode>
        <AppShell />
      </React.StrictMode>,
    );

    expect(screen.getByText('正在恢复上次作品...')).toBeDefined();
    await waitFor(() => expect(screen.getByText('WORLD:恢复作品')).toBeDefined());
    expect(screen.queryByText('设定集需要绑定作品')).toBeNull();
  });

  test('clears a missing novel ID and falls back to the library', async () => {
    localStorage.setItem('inkflow-selected-novel-id', 'deleted-novel');
    mocks.getNovel.mockResolvedValue(undefined);

    render(<AppShell />);

    await waitFor(() => expect(screen.getByText('LIBRARY')).toBeDefined());
    expect(localStorage.getItem('inkflow-selected-novel-id')).toBeNull();
  });

  test('falls back to the library when an old session has no stored novel ID', async () => {
    render(<AppShell />);

    await waitFor(() => expect(screen.getByText('LIBRARY')).toBeDefined());
    expect(mocks.getNovel).not.toHaveBeenCalled();
  });

  test('records editor entry once per novel and never includes正文', async () => {
    useNovelStore.setState({ selectedNovel: restoredNovel });
    useAppStore.setState({ currentView: 'world', workspaceFocus: 'world' });
    render(<AppShell />);

    fireEvent.click(await screen.findByTestId('enter-editor'));
    await waitFor(() => expect(screen.getByText('EDITOR:恢复作品')).toBeDefined());
    fireEvent.click(screen.getByTestId('enter-editor'));

    expect(mocks.recordProductEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordProductEvent).toHaveBeenCalledWith({
      eventName: 'editor_enter',
      stage: 'drafting',
      result: 'success',
      novelId: restoredNovel.id,
    });
    expect(mocks.recordProductEvent.mock.calls[0][0]).not.toHaveProperty('content');
  });

  test('opens the editor when selecting an existing novel from the welcome view', async () => {
    useAppStore.setState({ currentView: 'welcome', workspaceFocus: 'editor' });

    render(<AppShell />);

    fireEvent.click(screen.getByRole('button', { name: '选择作品' }));
    await waitFor(() => expect(screen.getByText('EDITOR:恢复作品')).toBeDefined());
    expect(screen.queryByText('COCKPIT:恢复作品')).toBeNull();
  });

  test('renders the editor for the workspace editor focus', async () => {
    useNovelStore.setState({ selectedNovel: restoredNovel });
    useAppStore.setState({ currentView: 'workspace', workspaceFocus: 'editor' });

    render(<AppShell />);

    await waitFor(() => expect(screen.getByText('EDITOR:恢复作品')).toBeDefined());
    expect(screen.queryByText('COCKPIT:恢复作品')).toBeNull();
  });
});
