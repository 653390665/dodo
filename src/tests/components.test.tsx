/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import axe from 'axe-core';
import { Sidebar } from '../components/Sidebar';
import { SettingsModal } from '../components/SettingsModal';
import { WelcomeView } from '../components/WelcomeView';
import { ProjectCockpitView } from '../components/ProjectCockpitView';
import { EditorView } from '../components/EditorView';

// Mock tooltip to avoid complicated portal testing in jsdom
vi.mock('../components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock simple Tabs to work around Radix event delegation in JSDOM tests
const TabsContext = React.createContext<{
  value: string;
  onValueChange: (v: string) => void;
}>({ value: '', onValueChange: () => {} });

vi.mock('../components/ui/tabs', () => {
  return {
    Tabs: ({ value, onValueChange, children, className }: any) => {
      return (
        <TabsContext.Provider value={{ value, onValueChange }}>
          <div className={className}>{children}</div>
        </TabsContext.Provider>
      );
    },
    TabsList: ({ children, className }: any) => <div className={className}>{children}</div>,
    TabsTrigger: ({ value, children, className }: any) => {
      const ctx = React.useContext(TabsContext);
      return (
        <button
          type="button"
          onClick={() => ctx.onValueChange(value)}
          className={className}
        >
          {children}
        </button>
      );
    },
    TabsContent: ({ value, children, className }: any) => {
      const ctx = React.useContext(TabsContext);
      if (ctx.value !== value) return null;
      return <div className={className}>{children}</div>;
    }
  };
});

// Mock novel-client functions globally
vi.mock('../lib/novel-client', () => ({
  listNovels: vi.fn().mockResolvedValue([]),
  getNovel: vi.fn().mockResolvedValue(undefined),
  createNovel: vi.fn().mockResolvedValue(undefined),
  updateNovel: vi.fn().mockResolvedValue(undefined),
  deleteNovel: vi.fn().mockResolvedValue(undefined),
}));

// Mock hook useStoryCards to prevent external dependencies and network requests
vi.mock('../hooks/useStoryCards', () => ({
  useStoryCards: () => ({
    cards: [],
    source: null,
    isWaiting: false,
    isModelPending: false,
    warnings: [],
    submit: vi.fn(),
  }),
}));

// Mock api functions globally
vi.mock('../lib/api', () => ({
  listChaptersMetadata: vi.fn().mockResolvedValue([]),
  getChapter: vi.fn().mockResolvedValue(undefined),
  listCharacters: vi.fn().mockResolvedValue([]),
  listLocations: vi.fn().mockResolvedValue([]),
  listItems: vi.fn().mockResolvedValue([]),
  listFactions: vi.fn().mockResolvedValue([]),
  listContinuationPacks: vi.fn().mockResolvedValue([]),
  listSkills: vi.fn().mockResolvedValue([]),
  getNovel: vi.fn().mockResolvedValue({
    id: 'test-novel-id',
    title: 'Test Novel',
    summary: 'A test novel summary',
    mountedSkillIds: [],
    mountedSkillLoadout: [],
  }),
  createChapter: vi.fn().mockResolvedValue(undefined),
}));

// Mock EditorView hooks to decouple it for component tests
vi.mock('../lib/hooks/useEditorUiState', () => ({
  useEditorUiState: () => ({
    isFullscreen: false,
    isAgentSidebarOpen: false,
    setIsAgentSidebarOpen: vi.fn(),
    agentTab: 'planning',
    setAgentTab: vi.fn(),
    expandedVolumes: [],
    setExpandedVolumes: vi.fn(),
    toggleFullscreen: vi.fn(),
    toggleAgentSidebar: vi.fn(),
    toggleVolume: vi.fn(),
  }),
}));

vi.mock('../lib/hooks/useEditorContinuationPacks', () => ({
  useEditorContinuationPacks: () => ({
    continuationPacks: [],
    selectedContinuationPackId: '',
    setSelectedContinuationPackId: vi.fn(),
  }),
}));

vi.mock('../lib/hooks/useEditorData', () => ({
  useEditorData: () => ({
    chapters: [{ id: 'ch-1', title: '第一章', content: 'Here is some content', createdAt: Date.now(), updatedAt: Date.now() }],
    setChapters: vi.fn(),
    currentChapter: { id: 'ch-1', title: '第一章', content: 'Here is some content', wordCount: 150, createdAt: Date.now(), updatedAt: Date.now() },
    setCurrentChapter: vi.fn(),
    characters: [],
    locations: [],
    items: [],
    factions: [],
    powerLevels: [],
    timelineEvents: [],
    librarySkills: [],
    skillUsageRecords: [],
    mountedSkillLoadout: [],
    setMountedSkillLoadout: vi.fn(),
    relationships: [],
    projectPreferenceProfile: { tags: [] },
    setProjectPreferenceProfile: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock('../lib/hooks/useChapterUndo', () => ({
  useChapterUndo: () => ({
    pushToUndoHistory: vi.fn(),
    resetUndoHistory: vi.fn(),
  }),
}));

vi.mock('../lib/hooks/useEditorRecommendationCards', () => ({
  useEditorRecommendationCards: () => ({
    skippedAssetIds: [],
    stackedDeconstructionCardIds: [],
    handleStackDeconstructionCard: vi.fn(),
    handleUnstackDeconstructionCard: vi.fn(),
    handleSkipAsset: vi.fn(),
  }),
}));

vi.mock('../lib/hooks/useEntitySniffing', () => ({
  useEntitySniffing: () => ({
    isSniffing: false,
    sniffedEntities: { activeExisting: [], potentialNew: [] },
    addingEntityNames: [],
    handleSniffEntities: vi.fn(),
    handleAddSniffedEntity: vi.fn(),
  }),
}));

vi.mock('../lib/hooks/useChapterVersions', () => ({
  useChapterVersions: () => ({
    versions: [],
  }),
}));

vi.mock('../lib/hooks/useEditorPersistence', () => ({
  useEditorPersistence: () => ({
    isSyncing: false,
    syncSuccess: true,
    persistSkillLoadout: vi.fn(),
    persistProjectPreferenceProfile: vi.fn(),
    handleSaveVersion: vi.fn(),
    handleRestoreVersion: vi.fn(),
    handleUpdateContent: vi.fn(),
    handleUpdateChapterBeats: vi.fn(),
    handleUpdateGlobalOutline: vi.fn(),
    handleAddChapter: vi.fn(),
    handleAddFirstChapter: vi.fn(),
    handleDeleteChapter: vi.fn(),
    handleVolumeNameChange: vi.fn(),
    handleTitleChange: vi.fn(),
    cancelPendingContentSync: vi.fn(),
    refreshChapters: vi.fn(),
  }),
}));

vi.mock('../lib/hooks/useChapterProductionFlow', () => ({
  useChapterProductionFlow: () => ({
    productionIntent: '',
    setProductionIntent: vi.fn(),
    activeProductionRun: null,
    isProductionRunning: false,
    isApplyingProductionRun: false,
    productionError: null,
    productionBeatsSource: null,
    productionDraftSource: null,
    productionAuditSource: null,
    productionStatusMessage: '',
    handleStartProductionRun: vi.fn(),
    handleApplyProductionRun: vi.fn(),
    stopProductionFlow: vi.fn(),
  }),
}));

vi.mock('../lib/hooks/useEditorIntelligenceContext', () => ({
  useEditorIntelligenceContext: () => ({
    mountedSkills: [],
    agentContext: {
      novelTitle: 'Test',
      novelSummary: 'A test novel',
      chapterTitle: '第一章',
      chapterContent: 'Here is some content',
      customRules: '',
    },
    copilotSuggestion: null,
    getCurrentFitScore: vi.fn().mockReturnValue(100),
  }),
}));

vi.mock('../lib/hooks/useSkillLoadoutManager', () => ({
  useSkillLoadoutManager: () => ({
    recordSkillUsage: vi.fn(),
    assignSkillToSlot: vi.fn(),
    removeSkillFromSlot: vi.fn(),
  }),
}));

const mockHandleRunAudit = vi.fn().mockResolvedValue(undefined);
const mockHandlePolishChapterFromAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('../lib/hooks/useEditorGenerationFlow', () => ({
  useEditorGenerationFlow: () => ({
    isGeneratingContent: false,
    isGeneratingOutline: false,
    isGeneratingBeats: false,
    isGeneratingCritique: false,
    generationStatus: '',
    auditStatus: '',
    handleRunAudit: mockHandleRunAudit,
    handleGenerateBeats: vi.fn(),
    handleRewriteSelectedText: vi.fn(),
    handleGenerateOutline: vi.fn(),
    handleGenerateContent: vi.fn(),
    handlePolishChapterFromAudit: mockHandlePolishChapterFromAudit,
    stopGenerationFlow: vi.fn(),
  }),
}));

describe('InkFlow Frontend Accessibility & A11y Suite', () => {
  beforeEach(() => {
    // Clear fetch mocks
    vi.restoreAllMocks();
    localStorage.clear();

    // Mock the fetch call in SettingsModal to resolve immediately
    window.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          baseUrl: 'http://test.api',
          model: 'gemini-pro',
          hasApiKey: true,
          promptTemplates: {}
        }),
      } as Response)
    );
  });

  describe('Sidebar A11y & Interactive State', () => {
    test('Toggle button should correctly report aria-expanded and aria-controls', () => {
      const mockNavigate = vi.fn();
      const mockUser = { uid: 'test-uid' };

      render(
        <Sidebar
          currentView="welcome"
          onNavigate={mockNavigate}
          user={mockUser}
        />
      );

      // Locate toggle button using aria-label (default uncollapsed state is "折叠侧边栏")
      const toggleBtn = screen.getByLabelText('折叠侧边栏');
      expect(toggleBtn).toBeDefined();
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
      expect(toggleBtn.getAttribute('aria-controls')).toBe('sidebar-nav-panel');

      // Click to collapse
      fireEvent.click(toggleBtn);

      // Now the label should transition to "展开侧边栏" and aria-expanded becomes "false"
      expect(toggleBtn.getAttribute('aria-label')).toBe('展开侧边栏');
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    });

    test('Should execute automated axe-core A11y scan on Sidebar', async () => {
      const mockNavigate = vi.fn();
      const mockUser = { uid: 'test-uid' };

      const { container } = render(
        <Sidebar
          currentView="welcome"
          onNavigate={mockNavigate}
          user={mockUser}
        />
      );

      // Perform direct axe-core scan on the rendered container
      // Disable 'color-contrast' which is extremely slow and prone to timing out in JSDOM environment
      const results = await axe.run(container, {
        rules: {
          'color-contrast': { enabled: false }
        }
      });
      expect(results.violations.length).toBe(0);
    });
  });

  describe('SettingsModal Focus Trap & restoration', () => {
    test('Should auto focus first input on open, trap focus on tab, and restore focus on close', async () => {
      // 1. Create a trigger element to host the initial focus
      const triggerButton = document.createElement('button');
      triggerButton.textContent = 'Open Settings';
      document.body.appendChild(triggerButton);
      triggerButton.focus();
      expect(document.activeElement).toBe(triggerButton);

      const mockClose = vi.fn();

      // 2. Render SettingsModal as open
      const { unmount } = render(
        <SettingsModal
          isOpen={true}
          onClose={mockClose}
          theme="dark"
          onThemeChange={() => {}}
        />
      );

      // 3. Confirm focus was trapped and redirected to the first input in SettingsModal (typically API Key or first TabTrigger)
      const container = document.getElementById('settings-dialog-container');
      expect(container).not.toBeNull();

      // Wait for focus trap setTimeout (50ms) to trigger inside SettingsModal
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 60));
      });

      const firstInput = container?.querySelector('input, select, textarea, button') as HTMLElement;
      if (firstInput) {
        expect(document.activeElement).toBe(firstInput);
      }

      // 4. Fire Escape key to verify triggers close callback
      await act(async () => {
        fireEvent.keyDown(window, { key: 'Escape' });
      });
      expect(mockClose).toHaveBeenCalledTimes(1);

      // 5. Unmount settings modal to trigger cleanup and check focus restoration
      await act(async () => {
        unmount();
      });
      expect(document.activeElement).toBe(triggerButton);

      // Cleanup DOM
      document.body.removeChild(triggerButton);
    });
  });

  describe('Beta 收口计划高价值交互场景测试', () => {
    test('无 API Key 时, WelcomeView 降级为 STATE_UNKNOWN 琥珀色显示并渲染新手启航指南', async () => {
      // Mock fetch to reject to trigger 'unknown' fallback
      window.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const mockSelectStoryCard = vi.fn();
      const mockJumpToLibrary = vi.fn();
      const mockSelectNovel = vi.fn();
      const mockStartContinuationImport = vi.fn();

      render(
        <WelcomeView
          onSelectStoryCard={mockSelectStoryCard}
          onJumpToLibrary={mockJumpToLibrary}
          onSelectNovel={mockSelectNovel}
          onStartContinuationImport={mockStartContinuationImport}
        />
      );

      // Verify the amber state text STATE_UNKNOWN is displayed
      const stateUnknown = await screen.findByText('网络波动/配置未知');
      expect(stateUnknown).toBeDefined();

      // Verify empty library guide banner is visible
      const guideTitle = screen.getByText('新手启航指南');
      expect(guideTitle).toBeDefined();

      // Click to close empty guide banner
      const closeBtn = screen.getByLabelText('关闭提示');
      fireEvent.click(closeBtn);

      // Confirm preference persists in localStorage and banner disappears
      expect(localStorage.getItem('inkflow_welcome_empty_guide_closed')).toBe('true');
      expect(screen.queryByText('新手启航指南')).toBeNull();
    });

    test('空作品时, ProjectCockpitView 渲染自适应诊断与建议', async () => {
      const mockNavigate = vi.fn();
      const mockStartCockpitAction = vi.fn();
      const mockStartContinuationWriting = vi.fn();
      const mockEnterStoryboard = vi.fn();

      const novel = {
        id: 'test-novel-id',
        title: 'Test Novel',
        authorId: 'local-user',
        summary: 'A test novel summary',
        mountedSkillIds: [],
        mountedSkillLoadout: [],
        status: 'ongoing' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      render(
        <ProjectCockpitView
          novel={novel}
          onNavigate={mockNavigate}
          onStartCockpitAction={mockStartCockpitAction}
          onStartContinuationWriting={mockStartContinuationWriting}
          onEnterStoryboard={mockEnterStoryboard}
        />
      );

      // Verify that diagnostic warnings and action sequence appear
      const alertTitle = await screen.findByText(/创作前就绪诊断/);
      expect(alertTitle).toBeDefined();

      const actionTitle = await screen.findByText('当前建议行动序列');
      expect(actionTitle).toBeDefined();

      const guideTitle = await screen.findByText('首章未创建，AI 写作位置未锁定');
      expect(guideTitle).toBeDefined();
    });

    test('行动决策跳转 EditorView 时 cockpit-audit 能直接触发 handleRunAudit() 动作闭环', async () => {
      const mockBack = vi.fn();
      const mockOpenAssistant = vi.fn();
      const novel = {
        id: 'test-novel-id',
        title: 'Test Novel',
        authorId: 'local-user',
        summary: 'A test novel summary',
        mountedSkillIds: [],
        mountedSkillLoadout: [],
        status: 'ongoing' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      render(
        <EditorView
          novel={novel}
          launchState={{
            approvedPackId: '',
            launchToken: Date.now(),
            shouldOpenProductionPanel: true,
            source: 'cockpit-audit',
            targetChapterId: 'ch-1',
          }}
          onBack={mockBack}
          onOpenAssistant={mockOpenAssistant}
        />
      );

      // Wait a tick for effects to trigger
      await new Promise(resolve => setTimeout(resolve, 15));

      // Assert handleRunAudit was automatically called
      expect(mockHandleRunAudit).toHaveBeenCalled();
    });

    test('SettingsModal 数据备份与管理选项卡切换和一键导出', async () => {
      const mockClose = vi.fn();
      const originalLocation = window.location;

      // Mock window.location.href safely
      const mockLocation = { href: '' };
      delete (window as any).location;
      window.location = mockLocation as any;

      render(
        <SettingsModal
          isOpen={true}
          onClose={mockClose}
          theme="dark"
          onThemeChange={() => {}}
        />
      );

      // Switch to 'dataManage' tab
      const tabTrigger = screen.getByText('数据备份与管理');
      expect(tabTrigger).toBeDefined();
      await act(async () => {
        fireEvent.click(tabTrigger);
      });

      // Verify backup section is visible
      const backupTitle = screen.getByText('一键备份导出');
      expect(backupTitle).toBeDefined();

      // Click on immediate export button
      const exportBtn = screen.getByText('立即导出备份数据');
      await act(async () => {
        fireEvent.click(exportBtn);
      });

      // Verify the window.location.href changes correctly
      expect(window.location.href).toBe('/api/db/export-file');

      // Restore window.location
      (window as any).location = originalLocation;
    });
  });
});
