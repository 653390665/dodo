// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ContinuationGap, Novel } from '../../shared/types';

vi.mock('../lib/api', () => ({
  createChapter: vi.fn(), createCharacter: vi.fn(), createNovel: vi.fn(), generateStoryCards: vi.fn(),
  getNovel: vi.fn(), listChapters: vi.fn().mockResolvedValue([]), listSkills: vi.fn().mockResolvedValue([]),
  refineSetupTask: vi.fn(), updateChapter: vi.fn(), updateNovel: vi.fn(),
}));
vi.mock('../lib/editor-write-queue', () => ({ flushPendingEditorWrites: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../components/Sidebar', () => ({ Sidebar: () => <aside /> }));
vi.mock('../components/WelcomeView', () => ({ WelcomeView: () => <div /> }));
vi.mock('../components/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../components/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../components/Library', () => ({ Library: () => <div /> }));
vi.mock('../components/ProjectCockpitView', () => ({ ProjectCockpitView: () => <div /> }));
vi.mock('../components/ContinuationImportView', () => ({ ContinuationImportView: () => <div /> }));
vi.mock('../components/SkillsStudioView', () => ({ SkillsStudioView: () => <div /> }));
vi.mock('../components/BookFactoryView', () => ({ BookFactoryView: () => <div /> }));
vi.mock('../components/EditorView', () => ({ EditorView: () => <div /> }));
vi.mock('../components/AIAssistantDrawer', () => ({ AIAssistantDrawer: () => null }));
vi.mock('../components/WorldBibleView', () => ({
  WorldBibleView: ({ onOpenGapAssistantBatch }: { onOpenGapAssistantBatch?: (gaps: ContinuationGap[], packTitle: string) => void }) => (
    <button data-testid="open-batch-gap-assistant" onClick={() => onOpenGapAssistantBatch?.([
      { id: 'gap-1', severity: 'high', description: '人物关系未展开', suggestedDirection: '补充冲突来源', relatedFacts: ['事实一'] },
      { id: 'gap-2', severity: 'low', description: '地点规则缺失', suggestedDirection: '补充限制条件', relatedFacts: [] },
    ], '批量资料包')}>
      batch
    </button>
  ),
}));

import { AppShell } from '../components/AppShell';
import { useAppStore } from '../stores/app-store';
import { useAssistantSessionStore } from '../stores/assistant-session-store';
import { useNovelStore } from '../stores/novel-store';

const novel: Novel = { id: 'batch-novel', title: '批量缺口作品', authorId: 'local-user', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 };

describe('AppShell batch continuation gap assistant bridge', () => {
  beforeEach(() => {
    localStorage.clear();
    useNovelStore.setState({ selectedNovel: novel, assistantLaunchContext: null });
    useAppStore.setState({ currentView: 'world', workspaceFocus: 'world', isAIAssistantOpen: false, assistantMode: 'general', assistantSurfaceContext: null });
    useAssistantSessionStore.getState().clearSession(novel.id, 'bible');
  });

  test('prefills one bible prompt with the pack title and every gap', async () => {
    render(<AppShell />);
    fireEvent.click(await screen.findByTestId('open-batch-gap-assistant'));

    await waitFor(() => expect(useAppStore.getState().isAIAssistantOpen).toBe(true));
    expect(useAppStore.getState().assistantMode).toBe('bible');
    expect(useAppStore.getState().assistantSurfaceContext).toEqual(expect.objectContaining({
      surface: 'world', novelId: novel.id, worldBibleTab: 'pack-management', intent: 'continuation-gap',
    }));
    const prompt = useAssistantSessionStore.getState().getSession(novel.id, 'bible').input;
    expect(prompt).toContain('资料包《批量资料包》');
    expect(prompt).toContain('人物关系未展开');
    expect(prompt).toContain('地点规则缺失');
    expect(prompt).toContain('资料包提取结果（待核对）：事实一');
    expect(prompt).toContain('资料包提取结果（待核对）：暂无明确关联事实');
    expect(prompt).toContain('不要自动写入');
  });
});
