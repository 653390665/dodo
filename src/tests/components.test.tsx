/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, act, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { Sidebar } from '../components/Sidebar';
import { SettingsModal } from '../components/SettingsModal';
import { WelcomeView } from '../components/WelcomeView';
import { ProjectCockpitView } from '../components/ProjectCockpitView';
import { EditorView } from '../components/EditorView';
import { WorldBibleOnboarding } from '../components/WorldBibleOnboarding';
import { downloadDbBackup } from '../lib/download-client';
import { computeChapterWorkflowHash } from '../../shared/lib/chapter-workflow';

const capabilityPreviewMocks = vi.hoisted(() => {
  const operationLog: string[] = [];
  return {
    operationLog,
    mockToast: vi.fn(),
    mockExecuteCapability: vi.fn(),
    mockCreateChapterVersion: vi.fn(async (_version: unknown, _databaseGeneration?: number) => { operationLog.push('version'); }),
    mockUpdateChapter: vi.fn().mockResolvedValue(true),
    mockHandleUpdateContent: vi.fn((_content: string, _isProgrammatic?: boolean) => { operationLog.push('update-content'); }),
    mockFlushPendingEditorWrites: vi.fn(async () => { operationLog.push('flush'); }),
  };
});

const completionMocks = vi.hoisted(() => ({
  completeChapter: vi.fn().mockResolvedValue({
    quality: 'pass', phase: 'facts-proposed',
    gate: {
      contentHash: 'completion-hash', planHash: 'plan-hash', quality: 'pass', completionGate: 'ready',
      deterministicIssues: [], unknownChecks: [], reviewRequired: false, canAcceptLocalRevision: false,
    },
  }),
  acceptChapterRisk: vi.fn(),
}));

vi.mock('../lib/download-client', () => ({
  downloadDbBackup: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/toast', () => ({
  toast: (...args: unknown[]) => capabilityPreviewMocks.mockToast(...args),
}));
vi.mock('../lib/product-events-client', () => ({
  recordProductEvent: vi.fn().mockResolvedValue(undefined),
  getProductMetrics: vi.fn().mockResolvedValue({
    rangeDays: 7,
    northStar: { weeklyAcceptedContinuousChapters: 0 },
    rates: { previewAcceptance: null, syncCompletion: null, criticUnknown: null, conflict: null },
    generationLatencyMs: { p50: null, p95: null },
    funnel: [],
  }),
  exportProductEvents: vi.fn().mockResolvedValue(undefined),
  clearProductEvents: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/db-transport', () => ({
  getDatabaseGenerationSnapshot: vi.fn().mockResolvedValue(7),
  requireResponseDatabaseGeneration: vi.fn(() => 7),
}));
vi.mock('../lib/capability-client', () => ({
  executeCapability: (novelId: string, assetId: string, input: unknown) => capabilityPreviewMocks.mockExecuteCapability(novelId, assetId, input),
}));
vi.mock('../lib/writing-style-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/writing-style-client')>();
  return {
    ...actual,
    resolveWritingStyle: vi.fn().mockResolvedValue({ resolution: null, candidates: [] }),
    confirmWritingStyle: vi.fn().mockResolvedValue({ resolution: null, candidates: [] }),
  };
});
vi.mock('../lib/chapter-client', () => ({
  createChapterVersion: (version: unknown, databaseGeneration?: number) => capabilityPreviewMocks.mockCreateChapterVersion(version, databaseGeneration),
  getChapter: vi.fn().mockResolvedValue(undefined),
  updateChapter: (...args: unknown[]) => capabilityPreviewMocks.mockUpdateChapter(...args),
}));
vi.mock('../lib/chapter-completion-client', () => completionMocks);
vi.mock('../lib/chapter-fact-client', () => ({
  previewChapterFactCandidate: vi.fn(),
  applyChapterFactCandidate: vi.fn(),
}));
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
    isAgentSidebarOpen: mockIsAgentSidebarOpen,
    setIsAgentSidebarOpen: mockSetIsAgentSidebarOpen,
    agentTab: mockAgentTab,
    setAgentTab: mockSetAgentTab,
    expandedVolumes: [],
    setExpandedVolumes: vi.fn(),
    toggleFullscreen: vi.fn(),
    toggleAgentSidebar: vi.fn(),
    toggleVolume: vi.fn(),
  }),
}));

vi.mock('../lib/hooks/useEditorContinuationPacks', () => ({
  useEditorContinuationPacks: () => ({
    continuationPacks: mockContinuationPacks,
    selectedContinuationPackId: mockSelectedContinuationPackId,
    setSelectedContinuationPackId: vi.fn(),
  }),
}));

let mockCurrentChapter: any = { id: 'ch-1', title: '第一章', content: 'Here is some content', wordCount: 150, createdAt: Date.now(), updatedAt: Date.now() };
let mockSelectedContinuationPackId = '';
let mockContinuationPacks: any[] = [];
let mockAgentTab = 'planning';
let mockIsAgentSidebarOpen = false;
const mockSetIsAgentSidebarOpen = vi.fn();
const mockSetAgentTab = vi.fn((next: string) => { mockAgentTab = next; });
const mockHandleStackDeconstructionCard = vi.fn();
const mockHandleUnstackDeconstructionCard = vi.fn();
const mockRemoveStackedDeconstructionCard = vi.fn();
const mockHandleSkipAsset = vi.fn();
let mockIsSessionStateLoaded = false;
const mockSetChapters = vi.fn();
const mockSetCurrentChapter = vi.fn();
const mockSelectChapter = vi.fn(async () => mockCurrentChapter);
const mockSetMountedSkillLoadout = vi.fn();
const mockSetProjectPreferenceProfile = vi.fn();
let mockEditorWorldData: {
  characters: any[];
  locations: any[];
  items: any[];
  factions: any[];
  powerLevels: any[];
  timelineEvents: any[];
  relationships: any[];
  globalOutline: string;
} = {
  characters: [],
  locations: [],
  items: [],
  factions: [],
  powerLevels: [],
  timelineEvents: [],
  relationships: [],
  globalOutline: '',
};
let mockLibrarySkills: any[] = [];
let mockProjectPreferenceProfile: any = { tags: [] };
const mockStartProductionRun = vi.fn().mockResolvedValue(undefined);
let mockChapterProductionFlowArgs: any = null;

vi.mock('../lib/hooks/useEditorData', () => ({
  useEditorData: () => ({
    chapters: [mockCurrentChapter],
    setChapters: mockSetChapters,
    currentChapter: mockCurrentChapter,
    setCurrentChapter: mockSetCurrentChapter,
    selectChapter: mockSelectChapter,
    chapterLoading: false,
    characters: mockEditorWorldData.characters,
    locations: mockEditorWorldData.locations,
    items: mockEditorWorldData.items,
    factions: mockEditorWorldData.factions,
    powerLevels: mockEditorWorldData.powerLevels,
    timelineEvents: mockEditorWorldData.timelineEvents,
    librarySkills: mockLibrarySkills,
    skillUsageRecords: [],
    mountedSkillLoadout: [],
    setMountedSkillLoadout: mockSetMountedSkillLoadout,
    relationships: mockEditorWorldData.relationships,
    globalOutline: mockEditorWorldData.globalOutline || '',
    projectPreferenceProfile: mockProjectPreferenceProfile,
    setProjectPreferenceProfile: mockSetProjectPreferenceProfile,
    databaseGeneration: 7,
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
  useEditorRecommendationCards: (args: { initialStackedIds?: string[] } = {}) => ({
    skippedAssetIds: [],
    stackedDeconstructionCardIds: args.initialStackedIds || [],
    handleStackDeconstructionCard: mockHandleStackDeconstructionCard,
    handleUnstackDeconstructionCard: mockHandleUnstackDeconstructionCard,
    removeStackedDeconstructionCard: mockRemoveStackedDeconstructionCard,
    handleSkipAsset: mockHandleSkipAsset,
    isSessionStateLoaded: mockIsSessionStateLoaded,
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
    handleUpdateContent: capabilityPreviewMocks.mockHandleUpdateContent,
    handleUpdateChapterBeats: vi.fn(),
    handleUpdateGlobalOutline: vi.fn(),
    handleAddChapter: vi.fn(),
    handleAddFirstChapter: vi.fn(),
    handleDeleteChapter: vi.fn(),
    handleVolumeNameChange: vi.fn(),
    handleTitleChange: vi.fn(),
    cancelPendingContentSync: vi.fn(),
    flushPendingEditorWrites: capabilityPreviewMocks.mockFlushPendingEditorWrites,
    refreshChapters: vi.fn(),
  }),
}));

vi.mock('../lib/hooks/useChapterProductionFlow', () => ({
  useChapterProductionFlow: (args: any) => {
    mockChapterProductionFlowArgs = args;
    return ({
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
    handleStartProductionRun: mockStartProductionRun,
    handleApplyProductionRun: vi.fn(),
    stopProductionFlow: vi.fn(),
    });
  },
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

let mockIsGeneratingCritique = false;
const mockHandleRunAudit = vi.fn().mockResolvedValue(undefined);
const mockHandlePolishChapterFromAudit = vi.fn().mockResolvedValue(undefined);
let mockEditorGenerationFlowArgs: any = null;

vi.mock('../lib/hooks/useEditorGenerationFlow', () => ({
  useEditorGenerationFlow: (args: any) => {
    mockEditorGenerationFlowArgs = args;
    return ({
    isGeneratingContent: false,
    isGeneratingOutline: false,
    isGeneratingBeats: false,
    isGeneratingCritique: mockIsGeneratingCritique,
    generationStatus: '',
    auditStatus: '',
    aiActionState: { status: 'idle' },
    retryLastAiAction: vi.fn(),
    handleRunAudit: mockHandleRunAudit,
    handleGenerateBeats: vi.fn(),
    handleRewriteSelectedText: vi.fn(),
    handleGenerateOutline: vi.fn(),
    handleGenerateContent: vi.fn(),
    handlePolishChapterFromAudit: mockHandlePolishChapterFromAudit,
    stopGenerationFlow: vi.fn(),
    });
  },
}));

describe('InkFlow Frontend Accessibility & A11y Suite', () => {
  beforeEach(() => {
    // Clear fetch mocks
    vi.restoreAllMocks();
    mockHandleRunAudit.mockClear();
    mockHandlePolishChapterFromAudit.mockClear();
    completionMocks.completeChapter.mockClear();
    completionMocks.acceptChapterRisk.mockClear();
    mockStartProductionRun.mockClear();
    mockStartProductionRun.mockResolvedValue(undefined);
    capabilityPreviewMocks.operationLog.length = 0;
    capabilityPreviewMocks.mockToast.mockClear();
    capabilityPreviewMocks.mockExecuteCapability.mockReset();
    capabilityPreviewMocks.mockCreateChapterVersion.mockClear();
    capabilityPreviewMocks.mockUpdateChapter.mockReset().mockResolvedValue(true);
    capabilityPreviewMocks.mockHandleUpdateContent.mockClear();
    capabilityPreviewMocks.mockFlushPendingEditorWrites.mockClear();
    mockSetIsAgentSidebarOpen.mockClear();
    mockSetAgentTab.mockClear();
    mockHandleStackDeconstructionCard.mockClear();
    mockHandleUnstackDeconstructionCard.mockClear();
    mockRemoveStackedDeconstructionCard.mockClear();
    mockHandleSkipAsset.mockClear();
    mockIsSessionStateLoaded = false;
    mockSetChapters.mockClear();
    mockSetCurrentChapter.mockClear();
    mockSelectChapter.mockClear();
    mockSetMountedSkillLoadout.mockClear();
    mockSetProjectPreferenceProfile.mockClear();
    mockSelectedContinuationPackId = '';
    mockContinuationPacks = [];
    mockAgentTab = 'planning';
    mockIsAgentSidebarOpen = false;
    mockEditorWorldData = {
      characters: [],
      locations: [],
      items: [],
      factions: [],
      powerLevels: [],
      timelineEvents: [],
      relationships: [],
      globalOutline: '',
    };
    mockLibrarySkills = [];
    mockProjectPreferenceProfile = { tags: [] };
    mockChapterProductionFlowArgs = null;
    mockEditorGenerationFlowArgs = null;
    mockIsGeneratingCritique = false;
    mockCurrentChapter = { id: 'ch-1', title: '第一章', content: 'Here is some content', wordCount: 150, createdAt: Date.now(), updatedAt: Date.now() };
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
    test.each([
      ['globalOutline', { globalOutline: '第一幕：主角踏上旅程' }],
      ['powerLevels', { powerLevels: [{ id: 'power-1' }] }],
      ['timelineEvents', { timelineEvents: [{ id: 'event-1' }] }],
      ['relationships', { relationships: [{ id: 'relationship-1' }] }],
    ])('EditorView 有%s资料时显示世界观已就绪', (_source, worldData) => {
      mockEditorWorldData = {
        characters: [], locations: [], items: [], factions: [],
        powerLevels: [], timelineEvents: [], relationships: [], globalOutline: '',
        ...worldData,
      };
      render(
        <EditorView
          novel={{
            id: 'test-novel-id', title: 'Test Novel', authorId: 'local-user', summary: '',
            status: 'ongoing', createdAt: Date.now(), updatedAt: Date.now(),
          }}
          onBack={vi.fn()}
        />,
      );

      expect(screen.getByText('世界观已就绪')).toBeDefined();
    });

    test('EditorView 正文顶部统计 v3 作品卡组', () => {
      mockProjectPreferenceProfile = {
        tags: [],
        weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
        acceptedDimensions: [],
        rejectedDimensions: [],
        notes: [],
        evidenceCount: 0,
        capabilityModelVersion: 3,
        capabilityProfile: {
          version: 3,
          projectSkillDeck: {
            mainCardId: 'main-card',
            supportCardIds: ['support-one', 'support-two'],
            updatedAt: 1,
          },
          favoriteTechniqueIds: [],
        },
      };

      render(
        <EditorView
          novel={{
            id: 'test-novel-id', title: 'Test Novel', authorId: 'local-user', summary: '',
            status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [], createdAt: Date.now(), updatedAt: Date.now(),
          }}
          onBack={vi.fn()}
        />,
      );

      expect(screen.getByText('能力卡 3')).toBeDefined();
      expect(screen.getByText('作品默认 0 · 本章 0 · 作品技法 0 · 本章技法 0 · 系统护栏 12')).toBeDefined();
      expect(screen.queryByText('main-card / support-one / support-two')).toBeNull();
      expect(screen.queryByText('能力卡 0')).toBeNull();
      expect(screen.queryByText('系统默认')).toBeNull();
    });

    test('EditorView 从章节能力状态恢复本章卡，并传入写作链路', () => {
      mockAgentTab = 'skills';
      mockIsAgentSidebarOpen = true;
      mockCurrentChapter = {
        id: 'ch-1',
        novelId: 'test-novel-id',
        title: '第一章',
        content: 'Here is some content',
        wordCount: 150,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        workflowMeta: {
          version: 1,
          capabilityState: {
            techniqueIds: [],
            overlayCardIds: ['deconstruct-card-pacing', 'chapter-style-card'],
            updatedAt: 1,
          },
        },
      };
      mockLibrarySkills = [
        { id: 'deconstruct-card-pacing', name: '节奏拆书卡', description: '', style: '', pacing: '', stabilityScore: 80, evaluationFeedback: '', version: 1, createdAt: 1 },
        { id: 'chapter-style-card', name: '本章文风卡', description: '', style: '', pacing: '', stabilityScore: 80, evaluationFeedback: '', version: 1, createdAt: 1 },
      ];
      mockProjectPreferenceProfile = {
        tags: [],
        weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
        acceptedDimensions: [],
        rejectedDimensions: [],
        notes: [],
        evidenceCount: 0,
        capabilityModelVersion: 3,
        capabilityProfile: {
          version: 3,
          activeFlowId: 'flow-1',
          projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
          favoriteTechniqueIds: [],
        },
      };

      render(
        <EditorView
          novel={{
            id: 'test-novel-id', title: 'Test Novel', authorId: 'local-user', summary: '',
            status: 'ongoing', createdAt: Date.now(), updatedAt: Date.now(),
          }}
          onBack={vi.fn()}
        />,
      );

      expect(screen.getByText('本章使用卡')).toBeDefined();
      expect(screen.getAllByText('节奏拆书卡、本章文风卡').length).toBeGreaterThanOrEqual(1);
      expect(mockEditorGenerationFlowArgs?.sessionCardIds).toEqual(['deconstruct-card-pacing', 'chapter-style-card']);
      expect(mockChapterProductionFlowArgs?.sessionCardIds).toEqual(['deconstruct-card-pacing', 'chapter-style-card']);
    });

    test('EditorView 在作品能力配置变化后同步内部写作配置', async () => {
      const oldNovel = {
        id: 'test-novel-id',
        title: 'Test Novel',
        authorId: 'local-user',
        summary: 'A test novel summary',
        mountedSkillIds: [],
        mountedSkillLoadout: [],
        status: 'ongoing' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        projectPreferenceProfile: {
          tags: [],
          weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
          acceptedDimensions: [],
          rejectedDimensions: [],
          notes: [],
          evidenceCount: 0,
          capabilityModelVersion: 3 as const,
          capabilityProfile: {
            version: 3 as const,
            projectSkillDeck: { mainCardId: 'old-main-card', supportCardIds: [], updatedAt: 1 },
            favoriteTechniqueIds: [],
            capabilityMemberships: [],
          },
        },
      };
      const newNovel = {
        ...oldNovel,
        projectPreferenceProfile: {
          ...oldNovel.projectPreferenceProfile,
          capabilityProfile: {
            ...oldNovel.projectPreferenceProfile.capabilityProfile,
            projectSkillDeck: { mainCardId: 'new-main-card', supportCardIds: ['support-card'], updatedAt: 2 },
            favoriteTechniqueIds: ['technique-1'],
          },
        },
      };

      const { rerender } = render(<EditorView novel={oldNovel} onBack={vi.fn()} />);
      mockSetProjectPreferenceProfile.mockClear();

      rerender(<EditorView novel={newNovel} onBack={vi.fn()} />);

      await waitFor(() => expect(mockSetProjectPreferenceProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          capabilityProfile: expect.objectContaining({
            projectSkillDeck: expect.objectContaining({
              mainCardId: 'new-main-card',
              supportCardIds: ['support-card'],
            }),
            favoriteTechniqueIds: ['technique-1'],
          }),
        }),
      ));
    });

    test('EditorView 本章使用卡变化后要求重新确认写法', async () => {
      const { resolveWritingStyle } = await import('../lib/writing-style-client');
      vi.mocked(resolveWritingStyle).mockResolvedValueOnce({
        resolution: {
          resolverVersion: 1,
          fingerprint: 'confirmed-fingerprint',
          mode: 'skill-deck',
          summary: '已确认写法',
          sources: [{ kind: 'skill-deck', label: '作品卡组' }],
          allowedModes: ['skill-deck'],
          warnings: [],
          confirmed: true,
        },
        candidates: [],
      }).mockResolvedValue({
        resolution: {
          resolverVersion: 1,
          fingerprint: 'new-fingerprint',
          mode: 'skill-deck',
          summary: '新写法待确认',
          sources: [{ kind: 'skill-deck', label: '作品卡组' }, { kind: 'writer-session', label: '本章卡' }],
          allowedModes: ['skill-deck'],
          warnings: [],
          confirmed: false,
        },
        candidates: [{ mode: 'skill-deck', fingerprint: 'new-fingerprint', summary: '新写法待确认', sources: [] }],
      });
      mockIsSessionStateLoaded = true;
      mockCurrentChapter = {
        id: 'ch-1',
        novelId: 'test-novel-id',
        title: '第一章',
        content: 'Here is some content',
        sceneBeats: '分镜',
        wordCount: 150,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        workflowMeta: {
          version: 1,
          capabilityState: {
            techniqueIds: [],
            overlayCardIds: ['chapter-card-a'],
            updatedAt: 1,
          },
        },
      };
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

      const { rerender } = render(<EditorView novel={novel} onBack={vi.fn()} />);
      expect(await screen.findByText('已确认写法')).toBeDefined();
      await waitFor(() => expect(vi.mocked(resolveWritingStyle)).toHaveBeenCalledWith(
        novel.id,
        expect.objectContaining({ databaseGeneration: 7 }),
      ));

      mockCurrentChapter = {
        ...mockCurrentChapter,
        workflowMeta: {
          version: 1,
          capabilityState: {
            techniqueIds: [],
            overlayCardIds: ['chapter-card-a', 'chapter-card-b'],
            updatedAt: 2,
          },
        },
      };
      rerender(<EditorView novel={novel} onBack={vi.fn()} />);

      await waitFor(() => expect(screen.queryByText('已确认写法')).toBeNull());
      expect(screen.getAllByText('新写法待确认').length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: '确认并生成' })).toBeDefined();
    });

    test('EditorView 应用能力预览前先创建章节版本，再写入正文', async () => {
      const { recordProductEvent } = await import('../lib/product-events-client');
      vi.mocked(recordProductEvent).mockClear();
      const onNavigate = vi.fn();
      mockCurrentChapter = {
        id: 'ch-1',
        novelId: 'test-novel-id',
        title: '第一章',
        content: '旧正文',
        sceneBeats: '分镜',
        wordCount: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      capabilityPreviewMocks.mockExecuteCapability.mockResolvedValueOnce({
        kind: 'transform-preview',
        capabilityId: 'de-ai-slop-shield',
        baselineHash: computeChapterWorkflowHash('旧正文', '分镜'),
        contextReceipt: {},
        readOnly: true,
        preview: '新正文',
      });

      render(
        <EditorView
          novel={{
            id: 'test-novel-id', title: 'Test Novel', authorId: 'local-user', summary: '',
            status: 'ongoing', createdAt: Date.now(), updatedAt: Date.now(),
          }}
          capabilityLaunchState={{
            novelId: 'test-novel-id',
            launchToken: 201,
            action: 'run-utility',
            assetId: 'de-ai-slop-shield',
            targetChapterId: 'ch-1',
          }}
          onBack={vi.fn()}
          onNavigate={onNavigate}
        />,
      );

      await waitFor(() => expect(capabilityPreviewMocks.mockExecuteCapability).toHaveBeenCalled());
      expect(capabilityPreviewMocks.mockExecuteCapability).toHaveBeenCalledWith(
        'test-novel-id',
        'de-ai-slop-shield',
        expect.objectContaining({ databaseGeneration: 7 }),
      );
      expect(await screen.findByText('精修卡修改预览')).toBeDefined();
      expect(screen.getByLabelText('本次能力来源')).toBeDefined();
      expect(screen.getByText('深度AI句式与套话物理抹除器')).toBeDefined();
      expect(screen.getByText('新正文')).toBeDefined();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '应用精修预览' }));
      });

      expect(capabilityPreviewMocks.mockCreateChapterVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          chapterId: 'ch-1',
          content: '旧正文',
          wordCount: 3,
          author: 'editor-agent',
        }),
        7,
      );
      expect(capabilityPreviewMocks.mockHandleUpdateContent).toHaveBeenCalledWith('新正文', true);
      expect(capabilityPreviewMocks.operationLog).toEqual(['version', 'update-content', 'flush']);
      expect(await screen.findByLabelText('能力应用结果')).toBeDefined();
      expect(screen.getByText('精修已应用')).toBeDefined();
      expect(screen.getByText('已保存应用前版本，可从章节版本记录回退。')).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: '调整精修卡' }));
      expect(onNavigate).toHaveBeenCalledWith('skills', { targetChapterId: 'ch-1', stage: 'style-polish' });
      const events = vi.mocked(recordProductEvent).mock.calls.map(([event]) => event);
      const previewEvent = events.find((event) => event.eventName === 'capability_preview');
      const applyEvent = events.find((event) => event.eventName === 'capability_apply');
      expect(previewEvent).toEqual(expect.objectContaining({
        action: 'transform-preview',
        novelId: 'test-novel-id',
        chapterId: 'ch-1',
        objectId: 'de-ai-slop-shield',
        sourceType: 'built-in',
      }));
      expect(applyEvent).toEqual(expect.objectContaining({
        action: 'transform-preview',
        novelId: 'test-novel-id',
        chapterId: 'ch-1',
        objectId: 'de-ai-slop-shield',
        sessionId: previewEvent?.sessionId,
        sourceType: 'built-in',
      }));
    });

    test('EditorView 能力执行来源优先展示用户保存的能力卡名称', async () => {
      mockCurrentChapter = {
        id: 'ch-1',
        novelId: 'test-novel-id',
        title: '第一章',
        content: '旧正文',
        sceneBeats: '分镜',
        wordCount: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      mockLibrarySkills = [{
        id: 'custom-polish-card',
        name: '我保存的精修卡',
        description: '',
        style: '',
        pacing: '',
        stabilityScore: 80,
        evaluationFeedback: '',
        version: 1,
        createdAt: Date.now(),
      }];
      capabilityPreviewMocks.mockExecuteCapability.mockResolvedValueOnce({
        kind: 'transform-preview',
        capabilityId: 'custom-polish-card',
        baselineHash: computeChapterWorkflowHash('旧正文', '分镜'),
        contextReceipt: {},
        readOnly: true,
        preview: '新正文',
      });

      render(
        <EditorView
          novel={{
            id: 'test-novel-id', title: 'Test Novel', authorId: 'local-user', summary: '',
            status: 'ongoing', createdAt: Date.now(), updatedAt: Date.now(),
          }}
          capabilityLaunchState={{
            novelId: 'test-novel-id',
            launchToken: 209,
            action: 'run-utility',
            assetId: 'custom-polish-card',
            targetChapterId: 'ch-1',
          }}
          onBack={vi.fn()}
        />,
      );

      await waitFor(() => expect(capabilityPreviewMocks.mockExecuteCapability).toHaveBeenCalled());
      expect(await screen.findByText('精修卡修改预览')).toBeDefined();
      expect(screen.getByLabelText('本次能力来源')).toBeDefined();
      expect(screen.getByText('我保存的精修卡')).toBeDefined();
      expect(screen.queryByText('custom-polish-card')).toBeNull();
    });

    test('EditorView 能力运行中也展示即将执行的能力卡名称', async () => {
      let resolveCapability!: (value: {
        kind: 'diagnostic';
        capabilityId: string;
        baselineHash: string;
        contextReceipt: Record<string, never>;
        readOnly: true;
        report: { issueCount: number; issues: [] };
      }) => void;
      mockCurrentChapter = {
        id: 'ch-1',
        novelId: 'test-novel-id',
        title: '第一章',
        content: '旧正文',
        sceneBeats: '分镜',
        wordCount: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      mockLibrarySkills = [{
        id: 'custom-running-card',
        name: '正在执行的审稿卡',
        description: '',
        style: '',
        pacing: '',
        stabilityScore: 80,
        evaluationFeedback: '',
        version: 1,
        createdAt: Date.now(),
      }];
      capabilityPreviewMocks.mockExecuteCapability.mockReturnValueOnce(new Promise((resolve) => {
        resolveCapability = resolve;
      }));

      render(
        <React.StrictMode>
          <EditorView
            novel={{
              id: 'test-novel-id', title: 'Test Novel', authorId: 'local-user', summary: '',
              status: 'ongoing', createdAt: Date.now(), updatedAt: Date.now(),
            }}
            capabilityLaunchState={{
              novelId: 'test-novel-id',
              launchToken: 210,
              action: 'run-utility',
              assetId: 'custom-running-card',
              targetChapterId: 'ch-1',
            }}
            onBack={vi.fn()}
          />
        </React.StrictMode>,
      );

      expect(await screen.findByText('正在运行能力卡...')).toBeDefined();
      expect(screen.getByLabelText('本次能力来源')).toBeDefined();
      expect(screen.getByText('正在执行的审稿卡')).toBeDefined();
      expect(screen.queryByText('custom-running-card')).toBeNull();

      await act(async () => {
        resolveCapability({
          kind: 'diagnostic',
          capabilityId: 'custom-running-card',
          baselineHash: computeChapterWorkflowHash('旧正文', '分镜'),
          contextReceipt: {},
          readOnly: true,
          report: { issueCount: 0, issues: [] },
        });
      });
    });

    test('EditorView 启用精修卡规则时使用精修规则提示', async () => {
      mockCurrentChapter = {
        id: 'ch-1',
        novelId: 'test-novel-id',
        title: '第一章',
        content: '旧正文',
        sceneBeats: '分镜',
        wordCount: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        workflowMeta: { version: 1, capabilityState: { techniqueIds: [], overlayCardIds: [] } },
      };

      render(
        <EditorView
          novel={{
            id: 'test-novel-id', title: 'Test Novel', authorId: 'local-user', summary: '',
            status: 'ongoing', createdAt: Date.now(), updatedAt: Date.now(),
          }}
          capabilityLaunchState={{
            novelId: 'test-novel-id',
            launchToken: 207,
            action: 'use-technique',
            assetId: 'de-ai-slop-shield',
            targetChapterId: 'ch-1',
          }}
          onBack={vi.fn()}
        />,
      );

      await waitFor(() => expect(capabilityPreviewMocks.mockToast).toHaveBeenCalledWith('已加入本章精修规则，请重新确认本次写法', 'success'));
      expect(capabilityPreviewMocks.mockToast).not.toHaveBeenCalledWith('已加入本章技法，请重新确认本次写法', 'success');
    });

    test('EditorView 启用普通写作技法时保留技法提示', async () => {
      mockCurrentChapter = {
        id: 'ch-1',
        novelId: 'test-novel-id',
        title: '第一章',
        content: '旧正文',
        sceneBeats: '分镜',
        wordCount: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        workflowMeta: { version: 1, capabilityState: { techniqueIds: [], overlayCardIds: [] } },
      };

      render(
        <EditorView
          novel={{
            id: 'test-novel-id', title: 'Test Novel', authorId: 'local-user', summary: '',
            status: 'ongoing', createdAt: Date.now(), updatedAt: Date.now(),
          }}
          capabilityLaunchState={{
            novelId: 'test-novel-id',
            launchToken: 208,
            action: 'use-technique',
            assetId: 'prose-mouth-flavor',
            targetChapterId: 'ch-1',
          }}
          onBack={vi.fn()}
        />,
      );

      await waitFor(() => expect(capabilityPreviewMocks.mockToast).toHaveBeenCalledWith('已加入本章技法，请重新确认本次写法', 'success'));
    });

    test('EditorView 从能力商店试跑拆书卡时优先入栈持久化卡', async () => {
      mockCurrentChapter = {
        id: 'ch-1',
        novelId: 'test-novel-id',
        title: '第一章',
        content: '旧正文',
        sceneBeats: '分镜',
        wordCount: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        workflowMeta: { version: 1, capabilityState: { techniqueIds: [], overlayCardIds: [] } },
      };
      mockLibrarySkills = [{
        id: 'persisted-card-1',
        parentSkillId: 'deconstruct-card-pacing',
        name: '已保存节奏拆书卡',
        description: '',
        style: '短句推进',
        pacing: '',
        stabilityScore: 80,
        evaluationFeedback: '',
        version: 3,
        sourceBadge: 'book-extracted',
        deconstructionCardType: 'pacing-card',
        executionScore: 88,
        createdAt: Date.now(),
      }];
      mockHandleStackDeconstructionCard.mockResolvedValueOnce(undefined);

      render(
        <EditorView
          novel={{
            id: 'test-novel-id', title: 'Test Novel', authorId: 'local-user', summary: '',
            status: 'ongoing', createdAt: Date.now(), updatedAt: Date.now(),
          }}
          capabilityLaunchState={{
            novelId: 'test-novel-id',
            launchToken: 211,
            action: 'use-overlay',
            assetId: 'deconstruct-card-pacing',
            targetChapterId: 'ch-1',
            sessionCardIds: ['persisted-card-1'],
          }}
          onBack={vi.fn()}
        />,
      );

      await waitFor(() => expect(mockHandleStackDeconstructionCard).toHaveBeenCalledWith('persisted-card-1'));
      expect(mockHandleStackDeconstructionCard).not.toHaveBeenCalledWith('deconstruct-card-pacing');
    });

    test('EditorView 精修规则保存失败时不暴露泛化能力配置错误', async () => {
      capabilityPreviewMocks.mockUpdateChapter.mockResolvedValueOnce(false);
      mockCurrentChapter = {
        id: 'ch-1',
        novelId: 'test-novel-id',
        title: '第一章',
        content: '旧正文',
        sceneBeats: '分镜',
        wordCount: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        workflowMeta: { version: 1, capabilityState: { techniqueIds: [], overlayCardIds: [] } },
      };

      render(
        <EditorView
          novel={{
            id: 'test-novel-id', title: 'Test Novel', authorId: 'local-user', summary: '',
            status: 'ongoing', createdAt: Date.now(), updatedAt: Date.now(),
          }}
          capabilityLaunchState={{
            novelId: 'test-novel-id',
            launchToken: 209,
            action: 'use-technique',
            assetId: 'de-ai-slop-shield',
            targetChapterId: 'ch-1',
          }}
          onBack={vi.fn()}
        />,
      );

      await waitFor(() => expect(capabilityPreviewMocks.mockToast).toHaveBeenCalledWith('本章精修规则保存失败，请重试', 'error'));
      expect(capabilityPreviewMocks.mockToast).not.toHaveBeenCalledWith('章节能力配置保存失败', 'error');
    });

    test('EditorView 取消精修预览时保留同一能力事件会话', async () => {
      const { recordProductEvent } = await import('../lib/product-events-client');
      vi.mocked(recordProductEvent).mockClear();
      mockCurrentChapter = {
        id: 'ch-1',
        novelId: 'test-novel-id',
        title: '第一章',
        content: '旧正文',
        sceneBeats: '分镜',
        wordCount: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      capabilityPreviewMocks.mockExecuteCapability.mockResolvedValueOnce({
        kind: 'transform-preview',
        capabilityId: 'preview-capability',
        baselineHash: computeChapterWorkflowHash('旧正文', '分镜'),
        contextReceipt: {},
        readOnly: true,
        preview: '新正文',
      });

      render(
        <EditorView
          novel={{
            id: 'test-novel-id', title: 'Test Novel', authorId: 'local-user', summary: '',
            status: 'ongoing', createdAt: Date.now(), updatedAt: Date.now(),
          }}
          capabilityLaunchState={{
            novelId: 'test-novel-id',
            launchToken: 204,
            action: 'run-utility',
            assetId: 'preview-capability',
            targetChapterId: 'ch-1',
          }}
          onBack={vi.fn()}
        />,
      );

      await waitFor(() => expect(capabilityPreviewMocks.mockExecuteCapability).toHaveBeenCalled());
      fireEvent.click(await screen.findByRole('button', { name: '关闭能力结果' }));

      const events = vi.mocked(recordProductEvent).mock.calls.map(([event]) => event);
      const previewEvent = events.find((event) => event.eventName === 'capability_preview');
      const cancelEvent = events.find((event) => event.eventName === 'capability_cancel');
      expect(cancelEvent).toEqual(expect.objectContaining({
        action: 'transform-preview',
        novelId: 'test-novel-id',
        chapterId: 'ch-1',
        objectId: 'preview-capability',
        sessionId: previewEvent?.sessionId,
        sourceType: 'unknown',
      }));
    });

    test('EditorView 记录一次性能力执行失败且不写入错误文本', async () => {
      const { recordProductEvent } = await import('../lib/product-events-client');
      vi.mocked(recordProductEvent).mockClear();
      mockCurrentChapter = {
        id: 'ch-1',
        novelId: 'test-novel-id',
        title: '第一章',
        content: '旧正文',
        sceneBeats: '分镜',
        wordCount: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      capabilityPreviewMocks.mockExecuteCapability
        .mockRejectedValueOnce(new Error('服务返回了正文片段'))
        .mockResolvedValueOnce({
          kind: 'diagnostic',
          capabilityId: 'de-ai-slop-shield',
          baselineHash: computeChapterWorkflowHash('旧正文', '分镜'),
          contextReceipt: {},
          readOnly: true,
          report: { issueCount: 0, issues: [] },
        });

      render(
        <EditorView
          novel={{
            id: 'test-novel-id', title: 'Test Novel', authorId: 'local-user', summary: '',
            status: 'ongoing', createdAt: Date.now(), updatedAt: Date.now(),
          }}
          capabilityLaunchState={{
            novelId: 'test-novel-id',
            launchToken: 205,
            action: 'run-utility',
            assetId: 'de-ai-slop-shield',
            targetChapterId: 'ch-1',
          }}
          onBack={vi.fn()}
        />,
      );

      expect(await screen.findByText('服务返回了正文片段')).toBeDefined();
      expect(screen.getByText('深度AI句式与套话物理抹除器')).toBeDefined();
      const retryButton = screen.getByRole('button', { name: '重新运行能力卡' });
      expect(vi.mocked(recordProductEvent)).toHaveBeenCalledWith(expect.objectContaining({
        eventName: 'capability_preview',
        result: 'failure',
        errorCode: 'CAPABILITY_UTILITY_EXECUTION_FAILED',
        action: 'run-utility',
        novelId: 'test-novel-id',
        chapterId: 'ch-1',
        objectId: 'de-ai-slop-shield',
        sourceType: 'built-in',
      }));
      expect(JSON.stringify(vi.mocked(recordProductEvent).mock.calls)).not.toContain('服务返回了正文片段');

      fireEvent.click(retryButton);
      await waitFor(() => expect(capabilityPreviewMocks.mockExecuteCapability).toHaveBeenCalledTimes(2));
      expect(await screen.findByText('审稿卡诊断报告')).toBeDefined();
      expect(screen.getByText('本次诊断未发现明确问题，正文未被修改。')).toBeDefined();
    });

    test('EditorView 审稿卡执行失败时不伪装成精修预览', async () => {
      const onNavigate = vi.fn();
      mockCurrentChapter = {
        id: 'ch-1',
        novelId: 'test-novel-id',
        title: '第一章',
        content: '旧正文',
        sceneBeats: '分镜',
        wordCount: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      capabilityPreviewMocks.mockExecuteCapability.mockRejectedValueOnce(new Error('审稿服务暂不可用'));

      render(
        <EditorView
          novel={{
            id: 'test-novel-id', title: 'Test Novel', authorId: 'local-user', summary: '',
            status: 'ongoing', createdAt: Date.now(), updatedAt: Date.now(),
          }}
          capabilityLaunchState={{
            novelId: 'test-novel-id',
            launchToken: 215,
            action: 'run-diagnostic',
            assetId: 'audit-cliche-detector',
            targetChapterId: 'ch-1',
          }}
          onBack={vi.fn()}
          onNavigate={onNavigate}
        />,
      );

      expect(await screen.findByText('审稿卡执行失败')).toBeDefined();
      expect(screen.getByText('审稿服务暂不可用')).toBeDefined();
      expect(screen.getByText('去AI腔腔调与废话净化质检仪')).toBeDefined();
      expect(screen.queryByText('精修卡修改预览')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '返回作品能力中心' }));
      expect(onNavigate).toHaveBeenCalledWith('skills', { targetChapterId: 'ch-1', stage: 'style-polish' });
    });

    test('EditorView 不会应用没有变化的能力预览', async () => {
      mockCurrentChapter = {
        id: 'ch-1',
        novelId: 'test-novel-id',
        title: '第一章',
        content: '旧正文',
        sceneBeats: '分镜',
        wordCount: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      capabilityPreviewMocks.mockExecuteCapability.mockResolvedValueOnce({
        kind: 'transform-preview',
        capabilityId: 'preview-capability',
        baselineHash: computeChapterWorkflowHash('旧正文', '分镜'),
        contextReceipt: {},
        readOnly: true,
        preview: '旧正文',
      });

      render(
        <EditorView
          novel={{
            id: 'test-novel-id', title: 'Test Novel', authorId: 'local-user', summary: '',
            status: 'ongoing', createdAt: Date.now(), updatedAt: Date.now(),
          }}
          capabilityLaunchState={{
            novelId: 'test-novel-id',
            launchToken: 203,
            action: 'run-utility',
            assetId: 'preview-capability',
            targetChapterId: 'ch-1',
          }}
          onBack={vi.fn()}
        />,
      );

      await waitFor(() => expect(capabilityPreviewMocks.mockExecuteCapability).toHaveBeenCalled());
      fireEvent.click(await screen.findByRole('button', { name: '应用精修预览' }));

      expect(await screen.findByText('本次精修没有产生可应用变化')).toBeDefined();
      expect(capabilityPreviewMocks.mockCreateChapterVersion).not.toHaveBeenCalled();
      expect(capabilityPreviewMocks.mockHandleUpdateContent).not.toHaveBeenCalled();
    });

    test('EditorView 展示审稿卡诊断报告时说明正文未被修改', async () => {
      mockCurrentChapter = {
        id: 'ch-1',
        novelId: 'test-novel-id',
        title: '第一章',
        content: '旧正文',
        sceneBeats: '分镜',
        wordCount: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      capabilityPreviewMocks.mockExecuteCapability.mockResolvedValueOnce({
        kind: 'diagnostic',
        capabilityId: 'audit-capability',
        baselineHash: computeChapterWorkflowHash('旧正文', '分镜'),
        contextReceipt: {
          actual: true,
          sourceIds: ['stage-prompt-critic'],
          runtimeSha256: 'runtime-hash',
          injectedChars: 120,
          itemCount: 2,
          truncated: false,
          sources: [
            { id: 'stage-prompt-critic', label: '审稿阶段能力卡与护栏', chars: 120, itemCount: 2, truncated: false },
          ],
        },
        readOnly: true,
        report: {
          issueCount: 0,
          issues: [],
        },
      });

      render(
        <EditorView
          novel={{
            id: 'test-novel-id', title: 'Test Novel', authorId: 'local-user', summary: '',
            status: 'ongoing', createdAt: Date.now(), updatedAt: Date.now(),
          }}
          capabilityLaunchState={{
            novelId: 'test-novel-id',
            launchToken: 202,
            action: 'run-utility',
            assetId: 'audit-capability',
            targetChapterId: 'ch-1',
          }}
          onBack={vi.fn()}
        />,
      );

      await waitFor(() => expect(capabilityPreviewMocks.mockExecuteCapability).toHaveBeenCalled());
      expect(await screen.findByText('审稿卡诊断报告')).toBeDefined();
      expect(screen.getByLabelText('本次能力来源')).toBeDefined();
      expect(screen.getByText('审稿阶段能力卡与护栏')).toBeDefined();
      expect(screen.getByText('本次诊断未发现明确问题，正文未被修改。')).toBeDefined();
      expect(capabilityPreviewMocks.mockHandleUpdateContent).not.toHaveBeenCalled();
    });

    test('EditorView 展示审稿卡问题时提示下一步精修闭环', async () => {
      const onNavigate = vi.fn();
      mockCurrentChapter = {
        id: 'ch-1',
        novelId: 'test-novel-id',
        title: '第一章',
        content: '旧正文',
        sceneBeats: '分镜',
        wordCount: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      capabilityPreviewMocks.mockExecuteCapability.mockResolvedValueOnce({
        kind: 'diagnostic',
        capabilityId: 'audit-capability',
        baselineHash: computeChapterWorkflowHash('旧正文', '分镜'),
        contextReceipt: {},
        readOnly: true,
        report: {
          issueCount: 1,
          issues: [
            { category: '节奏', line: 3, snippet: '这里忽然跳过冲突', suggestion: '补一段选择压力。' },
          ],
        },
      });

      render(
        <EditorView
          novel={{
            id: 'test-novel-id', title: 'Test Novel', authorId: 'local-user', summary: '',
            status: 'ongoing', createdAt: Date.now(), updatedAt: Date.now(),
          }}
          capabilityLaunchState={{
            novelId: 'test-novel-id',
            launchToken: 206,
            action: 'run-utility',
            assetId: 'audit-capability',
            targetChapterId: 'ch-1',
          }}
          onBack={vi.fn()}
          onNavigate={onNavigate}
        />,
      );

      await waitFor(() => expect(capabilityPreviewMocks.mockExecuteCapability).toHaveBeenCalled());
      expect(await screen.findByText('审稿卡诊断报告')).toBeDefined();
      expect(screen.getByText('节奏 · 第 3 行')).toBeDefined();
      expect(screen.getByText('建议：补一段选择压力。')).toBeDefined();
      expect(screen.getByText('下一步：按建议修改正文，或运行精修卡生成预览，确认后再应用。')).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: '打开精修卡' }));
      expect(onNavigate).toHaveBeenCalledWith('skills', { targetChapterId: 'ch-1', stage: 'style-polish' });
      expect(capabilityPreviewMocks.mockHandleUpdateContent).not.toHaveBeenCalled();
    });

    test('无 API Key 时, WelcomeView 降级为暂时无法确认琥珀色显示并渲染新手启航指南', async () => {
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

      // Verify the amber unknown state text is displayed
      const stateUnknown = await screen.findByText('暂时无法确认');
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

    test('空作品时, ProjectCockpitView 仅展示资料概览且不提供章节动作', async () => {
      const mockNavigate = vi.fn();
      const mockStartCockpitAction = vi.fn();
      const mockStartContinuationWriting = vi.fn();
      const mockEnterStoryboard = vi.fn();
      const mockOpenCapabilities = vi.fn();

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
          onOpenCapabilities={mockOpenCapabilities}
        />
      );

      expect(await screen.findByText('作品资料概览 / 已配置')).toBeDefined();
      expect(screen.queryByText(/创作前就绪诊断/)).toBeNull();
      expect(screen.queryByText('当前建议行动序列')).toBeNull();
      expect(screen.queryByTestId('cockpit-primary-action')).toBeNull();
      fireEvent.click(await screen.findByRole('button', { name: '管理能力' }));
      expect(mockOpenCapabilities).toHaveBeenCalledWith({ novelId: 'test-novel-id', stage: 'creative-setup' });
    });

    test('onboarding 展示作者化能力建议且不自动应用', () => {
      const onAcceptRecommendedSkills = vi.fn();
      render(
        <WorldBibleOnboarding
          onboarding={{
            tasks: [],
            assistantInput: '',
            onSelectTask: vi.fn(),
            onConfirmTask: vi.fn(),
            onAssistantInputChange: vi.fn(),
            onAssistantSubmit: vi.fn(),
            assistantLoading: false,
            completedCount: 0,
            canEnterEditor: false,
            onEnterEditor: vi.fn(),
            acceptedSkillIds: [],
            recommendedSkills: [{ skillId: 'role-1', skillName: '角色能力卡', reason: '阶段适配' }],
            acceptedRecommendedSkills: false,
            onAcceptRecommendedSkills,
          }}
        />,
      );

      expect(screen.getByText('创作流程')).toBeDefined();
      expect(screen.getByText('系统护栏')).toBeDefined();
      expect(screen.getByText('本章使用卡（可选）')).toBeDefined();
      expect(screen.getByText('推荐的角色写作配置')).toBeDefined();
      expect(screen.getByText('只展示建议，不会自动应用；可稍后在作品能力中心调整。')).toBeDefined();
      expect(screen.queryByText(/Flow|Guardrail|Overlay|Role Skill|角色技能|自动装配/)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '稍后调整' }));
      expect(screen.queryByText('本阶段能力建议')).toBeNull();
      expect(onAcceptRecommendedSkills).not.toHaveBeenCalled();
    });

    test('驾驶舱头部打开智能管家传递工作区上下文', async () => {
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
        <ProjectCockpitView
          novel={novel}
          onNavigate={vi.fn()}
          onOpenAssistant={mockOpenAssistant}
        />
      );

      const assistantButton = await screen.findByRole('button', { name: '打开智能管家' });
      fireEvent.click(assistantButton);

      expect(mockOpenAssistant).toHaveBeenCalledWith('general', {
        surface: 'workspace',
        novelId: novel.id,
      });
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

    test('cockpit-complete-chapter 加载目标章节后直接执行完成编排', async () => {
      const novel = {
        id: 'test-novel-id', title: 'Test Novel', authorId: 'local-user', summary: '', mountedSkillIds: [], mountedSkillLoadout: [],
        status: 'ongoing' as const, createdAt: Date.now(), updatedAt: Date.now(),
      };
      render(<EditorView
        novel={novel}
        launchState={{ approvedPackId: '', launchToken: 202, shouldOpenProductionPanel: true, source: 'cockpit-complete-chapter', targetChapterId: 'ch-1' }}
        onBack={vi.fn()}
      />);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
      expect(capabilityPreviewMocks.mockFlushPendingEditorWrites).toHaveBeenCalled();
      expect(completionMocks.completeChapter).toHaveBeenCalledWith('ch-1', expect.objectContaining({ novelId: novel.id, databaseGeneration: 7 }));
      expect(mockHandleRunAudit).not.toHaveBeenCalled();
    });

    test.each(['world-overview', 'continuation-import'] as const)('资料续写 %s 自动启动一次生产预览并带入意图', async (source) => {
      mockSelectedContinuationPackId = 'pack-1';
      mockContinuationPacks = [{ id: 'pack-1', status: 'approved', continuationTask: '推进主角与反派冲突', plotState: {}, continuationGaps: [] }];
      const novel = {
        id: 'test-novel-id', title: 'Test Novel', authorId: 'local-user', summary: 'A test novel summary',
        mountedSkillIds: [], mountedSkillLoadout: [], status: 'ongoing' as const, createdAt: Date.now(), updatedAt: Date.now(),
      };
      const launchState = {
        approvedPackId: 'pack-1', launchToken: 101, shouldOpenProductionPanel: true as const,
        source, prefillIntent: '继续写冲突', targetChapterId: 'ch-1',
      };
      const { rerender } = render(<EditorView novel={novel} launchState={launchState} onBack={vi.fn()} />);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
      rerender(<EditorView novel={novel} launchState={launchState} onBack={vi.fn()} />);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
      expect(mockStartProductionRun).toHaveBeenCalledTimes(1);
      expect(mockStartProductionRun).toHaveBeenCalledWith('继续写冲突');
    });

    test('world-overview 缺少 prefillIntent 时从 approved pack 派生生产意图', async () => {
      mockSelectedContinuationPackId = 'pack-1';
      mockContinuationPacks = [{ id: 'pack-1', status: 'approved', continuationTask: '推进主角与反派冲突', plotState: {}, continuationGaps: [] }];
      const novel = {
        id: 'test-novel-id', title: 'Test Novel', authorId: 'local-user', summary: 'A test novel summary',
        mountedSkillIds: [], mountedSkillLoadout: [], status: 'ongoing' as const, createdAt: Date.now(), updatedAt: Date.now(),
      };
      render(<EditorView novel={novel} launchState={{
        approvedPackId: 'pack-1', launchToken: 103, shouldOpenProductionPanel: true,
        source: 'world-overview', targetChapterId: 'ch-1',
      }} onBack={vi.fn()} />);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
      expect(mockStartProductionRun).toHaveBeenCalledWith('推进主角与反派冲突');
    });

    test('storyboard 来源不自动启动生产预览', async () => {
      mockSelectedContinuationPackId = 'pack-1';
      const novel = {
        id: 'test-novel-id', title: 'Test Novel', authorId: 'local-user', summary: 'A test novel summary',
        mountedSkillIds: [], mountedSkillLoadout: [], status: 'ongoing' as const, createdAt: Date.now(), updatedAt: Date.now(),
      };
      render(<EditorView novel={novel} launchState={{
        approvedPackId: 'pack-1', launchToken: 102, shouldOpenProductionPanel: true,
        source: 'storyboard', prefillIntent: '不应自动生产', targetChapterId: 'ch-1',
      }} onBack={vi.fn()} />);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
      expect(mockStartProductionRun).not.toHaveBeenCalled();
    });

    test('cockpit-polish 不复用旧 critique，仅在同章新审计成功后精修', async () => {
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

      const launchToken = Date.now();
      mockIsGeneratingCritique = true;
      mockCurrentChapter = {
        id: 'ch-1',
        title: '第一章',
        content: 'Here is some content',
        critique: 'Some critique report',
        workflowMeta: { version: 1, lastAudit: { status: 'fail', contentHash: 'old', completedAt: 100, source: 'model' } },
        wordCount: 150,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const { rerender } = render(
        <EditorView
          novel={novel}
          launchState={{
            approvedPackId: '',
            launchToken,
            shouldOpenProductionPanel: true,
            source: 'cockpit-polish',
            targetChapterId: 'ch-1',
          }}
          onBack={mockBack}
          onOpenAssistant={mockOpenAssistant}
        />
      );

      // Wait a tick for effects to trigger
      await new Promise(resolve => setTimeout(resolve, 15));

      expect(mockHandleRunAudit).toHaveBeenCalledTimes(1);
      expect(mockHandlePolishChapterFromAudit).not.toHaveBeenCalled();

      mockIsGeneratingCritique = false;
      mockCurrentChapter = {
        ...mockCurrentChapter,
        critique: 'New critique report',
        workflowMeta: { version: 1, lastAudit: { status: 'fail', contentHash: 'new', completedAt: 200, source: 'model' } },
      };
      rerender(
        <EditorView novel={novel} launchState={{
          approvedPackId: '', launchToken, shouldOpenProductionPanel: true,
          source: 'cockpit-polish', targetChapterId: 'ch-1',
        }} onBack={mockBack} onOpenAssistant={mockOpenAssistant} />
      );
      await new Promise(resolve => setTimeout(resolve, 15));
      expect(mockHandlePolishChapterFromAudit).toHaveBeenCalledTimes(1);
    });

    test('行动决策跳转 EditorView 时 cockpit-polish 且没有 critique 时自动跑 handleRunAudit()，并在结束后自动触发 handlePolishChapterFromAudit()', async () => {
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

      const launchToken = Date.now();
      mockIsGeneratingCritique = true;
      // critique is NOT present
      mockCurrentChapter = {
        id: 'ch-1',
        title: '第一章',
        content: 'Here is some content',
        wordCount: 150,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const { rerender } = render(
        <EditorView
          novel={novel}
          launchState={{
            approvedPackId: '',
            launchToken,
            shouldOpenProductionPanel: true,
            source: 'cockpit-polish',
            targetChapterId: 'ch-1',
          }}
          onBack={mockBack}
          onOpenAssistant={mockOpenAssistant}
        />
      );

      // Wait a tick for effects to trigger
      await new Promise(resolve => setTimeout(resolve, 15));

      // Assert handleRunAudit was automatically called instead
      expect(mockHandleRunAudit).toHaveBeenCalled();
      expect(mockHandlePolishChapterFromAudit).not.toHaveBeenCalled();

      // Now simulate audit completes: we update mockCurrentChapter with critique and make isGeneratingCritique false
      mockIsGeneratingCritique = false;
      mockCurrentChapter.critique = 'Newly generated critique';
      mockCurrentChapter.workflowMeta = { version: 1, lastAudit: { status: 'fail', contentHash: 'new', completedAt: 200, source: 'model' } };

      // Rerender to trigger effect
      rerender(
        <EditorView
          novel={novel}
          launchState={{
            approvedPackId: '',
            launchToken,
            shouldOpenProductionPanel: true,
            source: 'cockpit-polish',
            targetChapterId: 'ch-1',
          }}
          onBack={mockBack}
          onOpenAssistant={mockOpenAssistant}
        />
      );

      await new Promise(resolve => setTimeout(resolve, 15));

      // Now assert handlePolishChapterFromAudit was automatically run!
      expect(mockHandlePolishChapterFromAudit).toHaveBeenCalled();
    });

    test('cockpit-polish 在 launchState 被消费后仍会等待审计完成并自动精修', async () => {
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
      const launchToken = Date.now();
      const launchState = {
        approvedPackId: '',
        launchToken,
        shouldOpenProductionPanel: true as const,
        source: 'cockpit-polish' as const,
        targetChapterId: 'ch-1',
      };

      mockIsGeneratingCritique = true;
      mockCurrentChapter = {
        id: 'ch-1',
        title: '第一章',
        content: 'Here is some content',
        wordCount: 150,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const onLaunchConsumed = vi.fn();
      const { rerender } = render(
        <EditorView
          novel={novel}
          launchState={launchState}
          onLaunchConsumed={onLaunchConsumed}
          onBack={mockBack}
          onOpenAssistant={mockOpenAssistant}
        />
      );
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });

      expect(mockHandleRunAudit).toHaveBeenCalledTimes(1);
      expect(onLaunchConsumed).toHaveBeenCalledWith(launchToken);
      expect(mockHandlePolishChapterFromAudit).not.toHaveBeenCalled();

      rerender(
        <EditorView
          novel={novel}
          launchState={null}
          onLaunchConsumed={onLaunchConsumed}
          onBack={mockBack}
          onOpenAssistant={mockOpenAssistant}
        />
      );

      mockIsGeneratingCritique = false;
      mockCurrentChapter = {
        ...mockCurrentChapter,
        critique: 'Newly generated critique',
        workflowMeta: { version: 1, lastAudit: { status: 'fail', contentHash: 'new', completedAt: 200, source: 'model' } },
      };

      await act(async () => {
        rerender(
          <EditorView
            novel={novel}
            launchState={null}
            onLaunchConsumed={onLaunchConsumed}
            onBack={mockBack}
            onOpenAssistant={mockOpenAssistant}
          />
        );
      });

      await waitFor(() => expect(mockHandlePolishChapterFromAudit).toHaveBeenCalledTimes(1));
    });

    test('SettingsModal 数据备份与管理选项卡切换和一键导出', async () => {
      const mockClose = vi.fn();

      render(
        <SettingsModal
          isOpen={true}
          onClose={mockClose}
          theme="dark"
          onThemeChange={() => {}}
        />
      );

      const tabTrigger = screen.getByText('数据备份与管理');
      expect(tabTrigger).toBeDefined();
      await act(async () => {
        fireEvent.click(tabTrigger);
      });

      const backupTitle = screen.getByText('一键备份导出');
      expect(backupTitle).toBeDefined();

      const exportBtn = screen.getByText('立即导出备份数据');
      await act(async () => {
        fireEvent.click(exportBtn);
      });

      expect(downloadDbBackup).toHaveBeenCalled();
    });
  });
});
