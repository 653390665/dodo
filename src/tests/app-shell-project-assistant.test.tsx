import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type {
  AssistantActionPlan,
  AssistantLaunchContext,
  AssistantMode,
  AssistantSurfaceContext,
  ContinuationGap,
  Novel,
  WorldCapabilityLaunchIntent,
} from '../../shared/types';

type MockDrawerProps = {
  isOpen: boolean;
  assistantMode: AssistantMode;
  selectedNovel?: Novel | null;
  assistantLaunchContext: AssistantLaunchContext | null;
  handleApplyAssistantToContent: (text: string) => void;
  handleReplaceAssistantSelection: (text: string) => void;
  handleStartAssistantCreation: (plan: AssistantActionPlan, seedText?: string) => void;
  handleLaunchAssistantSettingCandidate: (plan: AssistantActionPlan, seedText: string) => void;
};

const mocks = vi.hoisted(() => ({
  getNovel: vi.fn(),
  listChapters: vi.fn(),
  getChapter: vi.fn(),
  updateChapter: vi.fn(),
  drawerPropsHistory: [] as MockDrawerProps[],
  worldPropsHistory: [] as Array<{ capabilityLaunchIntent?: WorldCapabilityLaunchIntent | null }>,
}));

vi.mock('../lib/api', () => ({
  createChapter: vi.fn(),
  createCharacter: vi.fn(),
  createNovel: vi.fn(),
  generateStoryCards: vi.fn(),
  getNovel: mocks.getNovel,
  getChapter: mocks.getChapter,
  listChapters: mocks.listChapters,
  listSkills: vi.fn().mockResolvedValue([]),
  refineSetupTask: vi.fn(),
  updateChapter: mocks.updateChapter,
  updateNovel: vi.fn(),
}));
vi.mock('../lib/editor-write-queue', () => ({
  flushPendingEditorWrites: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../components/Sidebar', () => ({
  Sidebar: ({ onNavigate }: { onNavigate: (view: 'ai') => void }) => (
    <aside>
      <button data-testid="open-sidebar-assistant" onClick={() => onNavigate('ai')}>
        SIDEBAR
      </button>
    </aside>
  ),
}));
vi.mock('../components/WelcomeView', () => ({ WelcomeView: () => <div>WELCOME</div> }));
vi.mock('../components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../components/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../components/Library', () => ({ Library: () => <div>LIBRARY</div> }));
vi.mock('../components/ProjectCockpitView', () => ({
  ProjectCockpitView: ({
    onOpenAssistant,
  }: {
    onOpenAssistant?: (mode: AssistantMode, context: AssistantSurfaceContext) => void;
  }) => (
    <button
      data-testid="open-cockpit-assistant"
      onClick={() => onOpenAssistant?.('general', { surface: 'workspace', novelId: 'novel-a' })}
    >
      COCKPIT
    </button>
  ),
}));
vi.mock('../components/ContinuationImportView', () => ({
  ContinuationImportView: () => <div>IMPORT</div>,
}));
vi.mock('../components/SkillsStudioView', () => ({ SkillsStudioView: () => <div>SKILLS</div> }));
vi.mock('../components/BookFactoryView', () => ({ BookFactoryView: () => <div>FACTORY</div> }));
vi.mock('../components/AIAssistantDrawer', () => ({
  AIAssistantDrawer: (props: MockDrawerProps) => {
    mocks.drawerPropsHistory.push(props);
    return (
      <>
        <button
          data-testid="apply-assistant"
          onClick={() => props.handleApplyAssistantToContent('generated text')}
        >
          apply
        </button>
        <button
          data-testid="replace-assistant-selection"
          onClick={() => props.handleReplaceAssistantSelection('generated text')}
        >
          replace
        </button>
        <button
          data-testid="start-assistant-creation"
          onClick={() =>
            props.handleStartAssistantCreation({
              intent: 'start-creation',
              label: '开始完整创作',
              userRequest: '写一个月蚀故事',
              novelId: 'novel-a',
              scope: 'project',
              executionMode: 'workflow',
              outputArtifact: 'creation-flow',
              recommendedCapabilityId: 'generic-novel-flow',
              requiresReview: false,
            })
          }
        >
          start
        </button>
        <button
          data-testid="launch-assistant-setting"
          onClick={() =>
            props.handleLaunchAssistantSettingCandidate(
              {
                intent: 'build-setting',
                label: '完善作品设定',
                userRequest: '补规则',
                novelId: 'novel-a',
                scope: 'project',
                executionMode: 'single-run',
                outputArtifact: 'world-candidate',
                recommendedCapabilityId: 'bible-world-builder',
                requiresReview: true,
              },
              '月蚀时不能点灯'
            )
          }
        >
          setting
        </button>
      </>
    );
  },
}));
vi.mock('../components/WorldBibleView', () => ({
  WorldBibleView: ({
    novel,
    isGlobalAssistantOpen,
    onOpenAssistant,
    onOpenGapAssistant,
    capabilityLaunchIntent,
  }: {
    novel: Novel;
    isGlobalAssistantOpen?: boolean;
    onOpenAssistant?: (mode: AssistantMode, context: AssistantSurfaceContext) => void;
    onOpenGapAssistant?: (gap: ContinuationGap, packTitle: string) => void;
    capabilityLaunchIntent?: WorldCapabilityLaunchIntent | null;
  }) => (
    <>
      {mocks.worldPropsHistory.push({ capabilityLaunchIntent }) && null}
      {!isGlobalAssistantOpen && <div data-testid="world-bible-onboarding">LOCAL ONBOARDING</div>}
      <button
        data-testid="open-bible-assistant"
        onClick={() =>
          onOpenAssistant?.('bible', {
            surface: 'world',
            novelId: novel.id,
            worldBibleTab: 'characters',
          })
        }
      >
        WORLD:{novel.title}
      </button>
      <button
        data-testid="open-gap-assistant"
        onClick={() =>
          onOpenGapAssistant?.(
            {
              id: 'gap-1',
              severity: 'medium',
              description: '关系细节未展开',
              suggestedDirection: '补充共事片段',
              relatedFacts: ['事实 A'],
            },
            '资料包 A'
          )
        }
      >
        GAP
      </button>
    </>
  ),
}));
vi.mock('../components/EditorView', () => ({
  EditorView: ({
    novel,
    onOpenAssistant,
  }: {
    novel: Novel;
    onOpenAssistant?: (context: AssistantLaunchContext) => void;
  }) => (
    <button
      data-testid="open-editor-assistant"
      onClick={() =>
        onOpenAssistant?.({
          source: 'editor',
          novelId: novel.id,
          novelTitle: novel.title,
          chapterId: 'chapter-a',
        })
      }
    >
      EDITOR:{novel.title}
    </button>
  ),
}));

import { AppShell } from '../components/AppShell';
import { useAppStore } from '../stores/app-store';
import { useAssistantSessionStore } from '../stores/assistant-session-store';
import { useNovelStore } from '../stores/novel-store';

const novelA: Novel = {
  id: 'novel-a',
  title: '作品 A',
  authorId: 'local-user',
  summary: '',
  status: 'ongoing',
  createdAt: 1,
  updatedAt: 1,
};
const novelB: Novel = { ...novelA, id: 'novel-b', title: '作品 B' };

describe('AppShell project assistant wiring', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.getNovel.mockReset();
    mocks.listChapters.mockReset();
    mocks.listChapters.mockResolvedValue([]);
    mocks.getChapter.mockReset();
    mocks.getChapter.mockResolvedValue(undefined);
    mocks.updateChapter.mockReset();
    mocks.drawerPropsHistory.length = 0;
    mocks.worldPropsHistory.length = 0;
    useAssistantSessionStore.getState().clearSession(novelA.id, 'bible');
    useNovelStore.setState({ selectedNovel: novelA, assistantLaunchContext: null });
    useAppStore.setState({
      currentView: 'world',
      workspaceFocus: 'world',
      isAIAssistantOpen: false,
      assistantMode: 'general',
      assistantSurfaceContext: null,
    });
  });

  test('world bible opens the drawer in bible mode with its surface context', async () => {
    render(<AppShell />);
    await waitFor(() => expect(screen.getByTestId('open-bible-assistant')).toBeDefined());
    fireEvent.click(screen.getByTestId('open-bible-assistant'));

    const drawer = mocks.drawerPropsHistory.at(-1)!;
    expect(drawer.isOpen).toBe(true);
    expect(drawer.assistantMode).toBe('bible');
    expect(drawer.selectedNovel).toEqual(novelA);
  });

  test('续写缺口打开设定助手并预填结构化上下文', async () => {
    render(<AppShell />);
    fireEvent.click(await screen.findByTestId('open-gap-assistant'));

    const drawer = mocks.drawerPropsHistory.at(-1)!;
    expect(drawer.isOpen).toBe(true);
    expect(drawer.assistantMode).toBe('bible');
    expect(drawer.selectedNovel).toEqual(novelA);
    const prompt = useAssistantSessionStore.getState().getSession(novelA.id, 'bible').input;
    expect(prompt).toContain('资料包《资料包 A》');
    expect(prompt).toContain('缺口等级：medium');
    expect(prompt).toContain('关系细节未展开');
    expect(prompt).toContain('建议方向：补充共事片段');
    expect(prompt).toContain('资料包提取结果（待核对）：事实 A');
    expect(prompt).toContain('不要自动写入');
  });

  test('hides world bible onboarding while the global bible assistant is open', async () => {
    render(<AppShell />);
    expect(await screen.findByTestId('world-bible-onboarding')).toBeDefined();

    fireEvent.click(screen.getByTestId('open-bible-assistant'));

    await waitFor(() => {
      expect(mocks.drawerPropsHistory.at(-1)?.isOpen).toBe(true);
      expect(mocks.drawerPropsHistory.at(-1)?.assistantMode).toBe('bible');
      expect(screen.queryByTestId('world-bible-onboarding')).toBeNull();
    });
  });

  test('sidebar opens the general assistant from the world view', async () => {
    render(<AppShell />);
    await waitFor(() => expect(screen.getByTestId('open-sidebar-assistant')).toBeDefined());
    fireEvent.click(screen.getByTestId('open-sidebar-assistant'));

    const drawer = mocks.drawerPropsHistory.at(-1)!;
    expect(drawer.isOpen).toBe(true);
    expect(drawer.assistantMode).toBe('general');
  });

  test('project cockpit opens the general assistant with its workspace context', async () => {
    useAppStore.setState({ currentView: 'workspace', workspaceFocus: 'cockpit' });
    render(<AppShell />);
    await waitFor(() => expect(screen.getByTestId('open-cockpit-assistant')).toBeDefined());
    fireEvent.click(screen.getByTestId('open-cockpit-assistant'));

    const drawer = mocks.drawerPropsHistory.at(-1)!;
    expect(drawer.isOpen).toBe(true);
    expect(drawer.assistantMode).toBe('general');
    expect(drawer.selectedNovel).toEqual(novelA);
  });

  test('assistant start creation enters editor planning with the original request', async () => {
    render(<AppShell />);
    fireEvent.click(await screen.findByTestId('start-assistant-creation'));

    await waitFor(() => expect(useAppStore.getState().currentView).toBe('editor'));
    expect(useNovelStore.getState().continuationLaunchState).toMatchObject({
      source: 'cockpit-planning',
      prefillIntent: '写一个月蚀故事',
    });
  });

  test('assistant setting plan enters the governed world candidate path with its seed', async () => {
    render(<AppShell />);
    fireEvent.click(await screen.findByTestId('launch-assistant-setting'));

    await waitFor(() =>
      expect(mocks.worldPropsHistory.at(-1)?.capabilityLaunchIntent).toMatchObject({
        novelId: 'novel-a',
        capabilityId: 'bible-world-builder',
        artifactKind: 'world',
        seedText: '月蚀时不能点灯',
      })
    );
  });

  test('editor opens the general assistant with its launch context', async () => {
    useAppStore.setState({ currentView: 'editor', workspaceFocus: 'editor' });
    render(<AppShell />);
    await waitFor(() => expect(screen.getByTestId('open-editor-assistant')).toBeDefined());
    fireEvent.click(screen.getByTestId('open-editor-assistant'));

    const drawer = mocks.drawerPropsHistory.at(-1)!;
    expect(drawer.isOpen).toBe(true);
    expect(drawer.assistantMode).toBe('general');
    expect(drawer.assistantLaunchContext).toEqual({
      source: 'editor',
      novelId: novelA.id,
      novelTitle: novelA.title,
      chapterId: 'chapter-a',
    });
  });

  test('switching selected novel closes the assistant and clears its launch context', async () => {
    useAppStore.setState({ isAIAssistantOpen: true });
    useNovelStore.setState({
      assistantLaunchContext: {
        source: 'editor',
        novelId: novelA.id,
        novelTitle: novelA.title,
        chapterId: 'chapter-a',
      },
    });
    render(<AppShell />);
    await waitFor(() => expect(mocks.drawerPropsHistory.at(-1)?.isOpen).toBe(true));

    act(() => useNovelStore.getState().setSelectedNovel(novelB));
    await waitFor(() => expect(mocks.drawerPropsHistory.at(-1)?.isOpen).toBe(false));
    expect(mocks.drawerPropsHistory.at(-1)?.assistantLaunchContext).toBeNull();
  });

  test('does not apply an old novel context after switching to another novel', async () => {
    useAppStore.setState({ isAIAssistantOpen: true });
    useNovelStore.setState({
      assistantLaunchContext: {
        source: 'editor',
        novelId: novelA.id,
        novelTitle: novelA.title,
        chapterId: 'chapter-a',
      },
    });
    render(<AppShell />);
    await waitFor(() => expect(mocks.drawerPropsHistory.at(-1)?.isOpen).toBe(true));
    const oldDrawer = mocks.drawerPropsHistory.at(-1)!;

    act(() => useNovelStore.getState().setSelectedNovel(novelB));
    await act(async () => oldDrawer.handleApplyAssistantToContent('stale text'));

    expect(mocks.listChapters).not.toHaveBeenCalled();
    expect(mocks.updateChapter).not.toHaveBeenCalled();
  });

  test('assistant selection replacement passes the chapter quality gate before saving', async () => {
    const { toast } = await import('../lib/toast');
    // AppShell locates the target chapter via getChapter (single-row read).
    mocks.getChapter.mockResolvedValue({
      id: 'chapter-a',
      novelId: novelA.id,
      title: '第一章',
      content: '现有的短正文。',
      wordCount: 8,
      createdAt: 1,
      updatedAt: 1,
    });
    useAppStore.setState({
      isAIAssistantOpen: true,
      currentView: 'editor',
      workspaceFocus: 'editor',
    });
    useNovelStore.setState({
      assistantLaunchContext: {
        source: 'editor',
        novelId: novelA.id,
        novelTitle: novelA.title,
        chapterId: 'chapter-a',
        selectedText: '短正文',
        selectionStart: 3,
        selectionEnd: 6,
      },
    });
    render(<AppShell />);
    await waitFor(() => expect(mocks.drawerPropsHistory.at(-1)?.isOpen).toBe(true));
    const drawer = mocks.drawerPropsHistory.at(-1)!;

    await act(async () => drawer.handleReplaceAssistantSelection('generated text'));

    // 替换后的整章未达交付标准：质量门拒绝直写
    expect(mocks.updateChapter).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.stringContaining('助手改写未通过质量门禁'),
        'error',
        6500
      )
    );
  });

  test('assistant apply writes the chapter without a database generation guard', async () => {
    // 特征化测试：登记已知缺陷「助手正文写入 updateChapter 不带 databaseGeneration」：
    // 跨标签页并发切换数据库代际时，这次写入没有代际校验（盲写窗口）。
    // 修复该缺陷时，本断言应翻转为「调用携带 databaseGeneration」，勿删除。
    const generatedDraft = Array.from({ length: 40 }, (_, index) =>
      [
        `生成场景${index + 1}从一声门响开始，林舟先确认水痕方向，再把手从桌沿收回。`,
        '对方的停顿托住了下一句对白，灯影沿着地面移动，逼得两人的站位同时改变。',
        '他将线索压回袖中，听见远处锁舌回应，局势因此向门外又推进一步。',
        '雨声盖住半句话，留下的空白反而指向更近的危险。',
      ].join('')
    ).join('\n\n');
    mocks.updateChapter.mockResolvedValue(true);
    mocks.getChapter.mockResolvedValue({
      id: 'chapter-a',
      novelId: novelA.id,
      title: '第一章',
      content: 'baseline',
      wordCount: 8,
      createdAt: 1,
      updatedAt: 1,
    });
    useAppStore.setState({
      isAIAssistantOpen: true,
      currentView: 'editor',
      workspaceFocus: 'editor',
    });
    useNovelStore.setState({
      assistantLaunchContext: {
        source: 'editor',
        novelId: novelA.id,
        novelTitle: novelA.title,
        chapterId: 'chapter-a',
      },
    });
    render(<AppShell />);
    await waitFor(() => expect(mocks.drawerPropsHistory.at(-1)?.isOpen).toBe(true));
    const drawer = mocks.drawerPropsHistory.at(-1)!;

    // 附加 40 段长文确保拼接后的整章能通过完整章质量门，走进写入分支。
    await act(async () => drawer.handleApplyAssistantToContent(generatedDraft));

    expect(mocks.updateChapter).toHaveBeenCalledTimes(1);
    const patch = mocks.updateChapter.mock.calls[0][1] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('databaseGeneration');
    expect(patch).toMatchObject({
      content: expect.stringContaining('生成场景40'),
      wordCount: expect.any(Number),
      updatedAt: expect.any(Number),
    });
  });

  test('inerts the sidebar and main content while the assistant is open', async () => {
    useAppStore.setState({ isAIAssistantOpen: true });
    render(<AppShell />);

    const sidebar = await screen.findByTestId('app-shell-sidebar');
    const main = screen.getByTestId('app-shell-main');
    expect(sidebar.hasAttribute('inert')).toBe(true);
    expect(main.hasAttribute('inert')).toBe(true);

    act(() => useAppStore.setState({ isAIAssistantOpen: false }));
    await waitFor(() => {
      expect(sidebar.hasAttribute('inert')).toBe(false);
      expect(main.hasAttribute('inert')).toBe(false);
    });
  });
});
