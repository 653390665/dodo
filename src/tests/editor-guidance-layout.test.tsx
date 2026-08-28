/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { AgentWorkspace } from '../components/AgentWorkspace';
import { EditorGuideBanners } from '../components/EditorGuideBanners';
import { EditorStatusBar } from '../components/EditorStatusBar';
import { EditorHeader } from '../components/EditorHeader';
import { WritingSurface } from '../components/WritingSurface';
import { TooltipProvider } from '../components/ui/tooltip';

afterEach(() => {
  localStorage.clear();
});

function EmptyChapterGuideHarness() {
  const [showGuide, setShowGuide] = React.useState(true);

  return (
    <EditorGuideBanners
      currentChapter={{
        id: 'chapter-1',
        novelId: 'novel-1',
        title: '第一章',
        volumeName: '正文卷',
        content: '',
        wordCount: 0,
        order: 1,
        createdAt: 1,
        updatedAt: 1,
      }}
      isChapterEmpty
      showEmptyChapterGuide={showGuide}
      showHasContentGuide={false}
      onCloseEmptyGuide={() => setShowGuide(false)}
      onCloseContentGuide={vi.fn()}
      onRestoreEmptyGuide={() => setShowGuide(true)}
      onRestoreContentGuide={vi.fn()}
    />
  );
}

function SyncedPackGuideHarness({ status }: { status: 'not_started' | 'partial' | 'stale' | 'synced' }) {
  return (
    <EditorGuideBanners
      currentChapter={{ id: 'chapter-1', novelId: 'novel-1', title: '第一章', volumeName: '正文卷', content: '正文', sceneBeats: '分镜', critique: '意见', wordCount: 200, order: 1, createdAt: 1, updatedAt: 1 }}
      isChapterEmpty={false}
      showEmptyChapterGuide={false}
      showHasContentGuide
      onCloseEmptyGuide={vi.fn()}
      onCloseContentGuide={vi.fn()}
      onRestoreEmptyGuide={vi.fn()}
      onRestoreContentGuide={vi.fn()}
      packStatus="approved"
      syncState={status}
    />
  );
}

function renderAgentWorkspace(overrides: Record<string, unknown> = {}) {
  const noop = vi.fn();
  const noopAsync = vi.fn().mockResolvedValue(undefined);

  const props = {
        novel: {
          id: 'novel-1',
          title: '测试作品',
          authorId: 'local-user',
          summary: '',
          status: 'ongoing',
          createdAt: 1,
          updatedAt: 1,
        },
        chapters: [],
        currentChapter: null,
        onSelectChapter: noopAsync,
        isAgentSidebarOpen: true,
        setIsAgentSidebarOpen: noop,
        agentTab: 'context',
        setAgentTab: noop,
        copilotSuggestion: null,
        runCopilotAction: noopAsync,
        activeProductionRun: null,
        productionIntent: '',
        setProductionIntent: noop,
        isProductionRunning: false,
        isApplyingProductionRun: false,
        productionError: null,
        continuationPacks: [],
        selectedContinuationPackId: '',
        setSelectedContinuationPackId: noop,
        onStartProductionRun: noopAsync,
        onApplyProductionRun: noopAsync,
        expectedWordCount: '',
        setExpectedWordCount: noop,
        onGenerateOutline: noopAsync,
        onAdoptOutline: vi.fn().mockResolvedValue(true),
        isGeneratingOutline: false,
        globalOutline: '',
        onGlobalOutlineChange: noop,
        onGenerateBeats: noopAsync,
        isGeneratingBeats: false,
        userIntent: '',
        setUserIntent: noop,
        isGeneratingContent: false,
        generationStatus: null,
        onGenerateContent: noopAsync,
        onRewriteSelectedText: noopAsync,
        onUpdateChapterBeats: noop,
        onRunAudit: noopAsync,
        isGeneratingCritique: false,
        onPolishChapterFromAudit: noopAsync,
        characters: [],
        locations: [],
        items: [],
        factions: [],
        librarySkills: [],
        skillUsageRecords: [],
        mountedSkillLoadout: [],
        onAssignSkill: noopAsync,
        onRemoveSkill: noopAsync,
        projectPreferenceProfile: { tags: [] },
        onPreferenceProfileChange: noopAsync,
        versions: [],
        onSaveVersion: noopAsync,
        onRestoreVersion: noop,
        isSniffing: false,
        sniffedEntities: null,
        onSniffEntities: noopAsync,
        onAddSniffedEntity: noopAsync,
        addingEntityNames: [],
        relationships: [],
        isDocked: true,
  };
  return render(<AgentWorkspace {...({ ...props, ...overrides } as any)} />);
}

describe('编辑器引导与智能管家布局', () => {
  test('未知资料状态不应宣称需要同步', () => {
    render(
      <EditorGuideBanners
        currentChapter={{ id: 'chapter-1', novelId: 'novel-1', title: '第一章', volumeName: '正文卷', content: '', wordCount: 0, order: 1, createdAt: 1, updatedAt: 1 }}
        isChapterEmpty
        showEmptyChapterGuide
        showHasContentGuide={false}
        onCloseEmptyGuide={vi.fn()}
        onCloseContentGuide={vi.fn()}
        onRestoreEmptyGuide={vi.fn()}
        onRestoreContentGuide={vi.fn()}
        packStatus="none"
        syncState="unknown"
      />,
    );
    expect(screen.queryByText(/同步资料包/)).toBeNull();
  });

  test('正文主动作位于文本编辑器之前', () => {
    const noop = vi.fn().mockResolvedValue(undefined);
    render(
      <WritingSurface
        novel={{ id: 'novel-1', title: '测试作品', authorId: 'local-user', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 }}
        currentChapter={{ id: 'chapter-1', novelId: 'novel-1', title: '第一章', volumeName: '正文卷', content: '', wordCount: 0, order: 1, createdAt: 1, updatedAt: 1 }}
        isGeneratingBeats={false} isGeneratingCritique={false} isGeneratingContent={false}
        generationStatus={null} auditStatus={null} isChapterEmpty mountedSkillsCount={0}
        runCopilotAction={noop} contentRef={React.createRef()} onGenerateBeats={noop} onRunAudit={noop}
        onUpdateContent={vi.fn()} onQueueContentWrite={vi.fn()} onAddFirstChapter={noop} onAddChapter={noop}
        setAgentTab={vi.fn()} setIsAgentSidebarOpen={vi.fn()} packStatus="none" syncState="not-required"
      />,
    );
    const textarea = screen.getByPlaceholderText('在这里开始书写这一章……');
    const action = screen.getByRole('button', { name: '生成分镜' });
    expect(action.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('建议创作路径')).toBeNull();
    expect(screen.getByText('能力卡 0')).toBeTruthy();
    expect(screen.queryByText('技能 0')).toBeNull();
  });

  test('关闭引导按作品隔离且关闭按钮为普通按钮', () => {
    const { container } = render(<EmptyChapterGuideHarness />);
    const close = screen.getByRole('button', { name: '关闭提示' });
    expect(close.getAttribute('type')).toBe('button');
    expect(container).toBeDefined();
  });

  test('编辑器顶部世界观状态来自显式状态', () => {
    const noop = vi.fn();
    render(<TooltipProvider>
      <EditorHeader currentChapter={null} isSidebarOpen onToggleSidebar={noop} isFullscreen={false} onToggleFullscreen={noop}
        isAgentSidebarOpen={false} onToggleAgentSidebar={noop} isEditorDataLoading={false} isAnyGenerating={false}
        isSyncing={false} syncSuccess={false} syncFailed={false} connectionState="unknown" mountedSkills={[]}
        onVolumeNameChange={noop} onTitleChange={noop} />,
    </TooltipProvider>);
    expect(screen.queryByText('世界观已就位')).toBeNull();
    expect(screen.getByText('本次写法来源')).toBeTruthy();
    expect(screen.getByText('系统默认')).toBeTruthy();
    expect(screen.queryByText('挂载技能')).toBeNull();
    expect(screen.queryByText('未挂载')).toBeNull();
  });

  test('智能管家展开时释放顶部状态空间并保留关键操作', () => {
    const noop = vi.fn();
    render(<TooltipProvider>
      <EditorHeader currentChapter={null} isSidebarOpen onToggleSidebar={noop} isFullscreen={false} onToggleFullscreen={noop}
        isAgentSidebarOpen onToggleAgentSidebar={noop} isEditorDataLoading={false} isAnyGenerating={false}
        isSyncing={false} syncSuccess={false} syncFailed={false} connectionState="connected" worldBibleState="ready" mountedSkills={[]}
        onVolumeNameChange={noop} onTitleChange={noop} />
    </TooltipProvider>);

    expect(screen.queryByText('世界观已就绪')).toBeNull();
    expect(screen.queryByText('本次写法来源')).toBeNull();
    expect(screen.queryByText('AI 已连接')).toBeNull();
    expect(screen.getByRole('button', { name: '收起智能管家' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '进入全屏模式' })).toBeTruthy();
  });

  test('编辑器顶部 AI 状态复用共享三态文案', () => {
    const noop = vi.fn();
    render(<TooltipProvider>
      <EditorHeader currentChapter={null} isSidebarOpen onToggleSidebar={noop} isFullscreen={false} onToggleFullscreen={noop}
        isAgentSidebarOpen={false} onToggleAgentSidebar={noop} isEditorDataLoading={false} isAnyGenerating={false}
        isSyncing={false} syncSuccess={false} syncFailed={false} connectionState="missing" mountedSkills={[]}
        onVolumeNameChange={noop} onTitleChange={noop} />,
    </TooltipProvider>);

    expect(screen.getByText('AI 未配置')).toBeTruthy();
    expect(screen.getByTitle(/可继续本地写作、保存和整理设定/)).toBeTruthy();
    expect(screen.queryByText(/LOCAL_RESERVED|STATE_UNKNOWN/)).toBeNull();
  });

  test('状态栏不显示静态预计 token', () => {
    render(<EditorStatusBar currentChapter={null} statusTimeFormatter={new Intl.DateTimeFormat('zh-CN')} isSyncing={false} syncFailed={false} novelId="novel-1" novelTitle="测试" />);
    expect(screen.queryByText(/预计 token/)).toBeNull();
  });
  test('关闭空章节引导后仍可重新打开并恢复原内容', () => {
    render(<EmptyChapterGuideHarness />);

    expect(screen.getByText('空章节指引')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));

    expect(screen.queryByText('空章节指引')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新显示章节指引' }));
    expect(screen.getByText('空章节指引')).toBeDefined();
  });

  test.each(['not_started', 'partial', 'stale'] as const)('approved %s 显示接入主动作', (status) => {
    render(<SyncedPackGuideHarness status={status} />);
    expect(screen.getByText('当前阶段主动作：接入本章上下文。完成后再继续编辑正文。')).toBeDefined();
  });

  test('approved synced 保持章节阶段动作', () => {
    render(<SyncedPackGuideHarness status="synced" />);
    expect(screen.getByText('当前阶段主动作：启动本章质量审计。完成后再继续编辑正文。')).toBeDefined();
  });

  test('智能管家使用独立可滚动内容区，窄窗口不会裁切底部内容', () => {
    renderAgentWorkspace();

    const workspace = screen.getByTestId('agent-workspace');
    const scrollRegion = screen.getByTestId('agent-workspace-scroll-region');

    expect(workspace.getAttribute('role')).toBe('complementary');
    expect(workspace.getAttribute('aria-label')).toBe('智能管家');
    expect(workspace.className).toContain('min-h-0');
    expect(scrollRegion.className).toContain('min-h-0');
    expect(scrollRegion.className).toContain('overflow-y-auto');
  });

  test('本章正文为空时展示紧凑的作品全局关系预览', () => {
    const onNavigate = vi.fn();
    const relationships = Array.from({ length: 7 }, (_, index) => ({
      id: `rel-${index}`,
      sourceType: 'character', sourceId: 'char-a',
      targetType: 'character', targetId: 'char-b', relationshipType: `搭档${index + 1}`,
      description: '曾经并肩执行任务',
    }));
    renderAgentWorkspace({
      currentChapter: {
        id: 'chapter-1', novelId: 'novel-1', title: '第一章', volumeName: '正文卷',
        content: '', wordCount: 0, order: 1, createdAt: 1, updatedAt: 1,
      },
      characters: [
        { id: 'char-a', name: '顾铁峰' },
        { id: 'char-b', name: '苏老板' },
      ],
      relationships,
      onNavigate,
    });

    expect(screen.getByText('作品全局关系预览')).toBeDefined();
    expect(screen.getByText('预览: 6 / 7')).toBeDefined();
    expect(screen.getByText('本章正文暂未命中关系，先展示 6 条作品全局关系')).toBeDefined();
    expect(screen.getByText('顾铁峰')).toBeDefined();
    expect(screen.getByText('苏老板')).toBeDefined();
    expect(screen.getByText('搭档1')).toBeDefined();
    expect(screen.queryByText('搭档7')).toBeNull();
    expect(screen.getByTestId('agent-workspace').querySelectorAll('svg line')).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: '查看完整关系图' }));
    expect(localStorage.getItem('inkflow-world-bible-active-tab')).toBe('graph');
    expect(onNavigate).toHaveBeenCalledWith('world');
    expect(screen.queryByText('当前正文未提及已设定的实体关系')).toBeNull();
  });

  test('approved pack sync CTA writes intent and navigates to world view', () => {
    const onNavigate = vi.fn();
    renderAgentWorkspace({
      currentChapter: {
        id: 'chapter-1', novelId: 'novel-1', title: '第一章', volumeName: '正文卷',
        content: '正文', wordCount: 2, order: 1, createdAt: 1, updatedAt: 1,
      },
      continuationPacks: [{ id: 'pack-approved', novelId: 'novel-1', title: '已确认资料包', status: 'approved' }],
      selectedContinuationPackId: '',
      onNavigate,
    });

    fireEvent.click(screen.getByRole('button', { name: '从资料包同步' }));
    expect(localStorage.getItem('inkflow-world-bible-active-tab')).toBe('pack-management');
    const intent = JSON.parse(localStorage.getItem('inkflow-world-bible-sync-intent') || 'null');
    expect(intent).toEqual(expect.objectContaining({ novelId: 'novel-1', packId: 'pack-approved' }));
    expect(typeof intent.intentId).toBe('string');
    expect(intent.intentId).not.toBe('');
    expect(typeof intent.createdAt).toBe('number');
    expect(Number.isFinite(intent.createdAt)).toBe(true);
    expect(onNavigate).toHaveBeenCalledWith('world');
  });

  test('without approved pack keeps manual add CTA', () => {
    renderAgentWorkspace({
      currentChapter: {
        id: 'chapter-1', novelId: 'novel-1', title: '第一章', volumeName: '正文卷',
        content: '正文', wordCount: 2, order: 1, createdAt: 1, updatedAt: 1,
      },
    });
    expect(screen.getByRole('button', { name: '去添加人物' })).toBeDefined();
    expect(screen.queryByRole('button', { name: '从资料包同步' })).toBeNull();
  });

  test('智能管家一级入口使用创作阶段命名，更多菜单按用途分组', () => {
    renderAgentWorkspace();

    expect(screen.getAllByRole('button').filter((button) => ['当前', '分镜', '生成正文', '审稿', '查设定', '更多'].includes(button.textContent?.trim() || ''))).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: /更多/ }));
    expect(screen.getByRole('menu')).toBeDefined();
    expect(screen.getByRole('group', { name: '写前准备' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: '全书大纲' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: '写法与能力' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: '节奏检查' })).toBeDefined();
    fireEvent.click(screen.getByRole('menuitem', { name: '章节版本' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('实体扫描在光标上下文变化时刷新，同时相同内容不重复扫描', async () => {
    const firstName = '顾铁峰';
    const secondName = '苏老板';
    const content = `${firstName}${'中'.repeat(2200)}${secondName}`;
    const textarea = document.createElement('textarea');
    textarea.value = content;
    textarea.selectionStart = 0;
    textarea.selectionEnd = 0;
    document.body.appendChild(textarea);
    const contentRef = { current: textarea } as React.RefObject<HTMLTextAreaElement>;

    renderAgentWorkspace({
      currentChapter: { id: 'chapter-1', novelId: 'novel-1', title: '第一章', volumeName: '正文卷', content, wordCount: content.length, order: 1, createdAt: 1, updatedAt: 1 },
      characters: [{ id: 'char-1', name: firstName }, { id: 'char-2', name: secondName }],
      contentRef,
    });

    await waitFor(() => expect(screen.getByText(firstName)).toBeDefined(), { timeout: 1500 });
    expect(screen.queryByText(secondName)).toBeNull();

    textarea.selectionStart = content.length - 1;
    textarea.selectionEnd = content.length - 1;
    fireEvent.select(textarea);
    await waitFor(() => expect(screen.getByText(secondName)).toBeDefined(), { timeout: 1500 });
    expect(screen.queryByText(firstName)).toBeNull();
    textarea.remove();
  });

  test.each([
    ['initial', false, false, false, 'unknown'],
    ['confirmed', false, true, false, 'saved'],
    ['failed', false, false, true, 'failed'],
  ])('保存状态 %s 仅按明确持久化结果显示', (_name, isSyncing, syncSuccess, syncFailed, expected) => {
    render(
      <EditorStatusBar
        currentChapter={{ id: 'chapter-1', novelId: 'novel-1', title: '第一章', content: '正文', wordCount: 2, order: 1, createdAt: 1, updatedAt: 1 }}
        statusTimeFormatter={new Intl.DateTimeFormat('zh-CN')}
        isSyncing={isSyncing as boolean}
        syncSuccess={syncSuccess as boolean}
        syncFailed={syncFailed as boolean}
        novelId="novel-1"
        novelTitle="测试作品"
      />,
    );
    expect(screen.getByRole('status').getAttribute('data-save-status')).toBe(expected);
  });

  test('查设定面板的扫描入口切换到追踪', () => {
    const setAgentTab = vi.fn();
    renderAgentWorkspace({ agentTab: 'bible', setAgentTab });

    fireEvent.click(screen.getByRole('button', { name: '扫描本章实体' }));
    expect(setAgentTab).toHaveBeenCalledWith('trace');
  });

  test('工作台上下文使用作者化能力卡文案', () => {
    renderAgentWorkspace({
      currentChapter: {
        id: 'chapter-1',
        novelId: 'novel-1',
        title: '第一章',
        content: '正文',
        wordCount: 2,
        order: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      librarySkills: [{ id: 'main-card', name: '镜头感主卡' }],
      mountedSkillLoadout: [{ slot: 1, skillId: 'main-card', weight: 1, lockedDimensions: [] }],
    });

    expect(screen.getByText('作品默认能力卡 (1)')).toBeDefined();
    expect(screen.getByText(/镜头感主卡/)).toBeDefined();
    expect(screen.queryByText(/当前能力|临时能力卡|使用系统默认能力/)).toBeNull();
  });

  test('工作台上下文统计 v3 作品卡组而不是空旧卡槽', () => {
    renderAgentWorkspace({
      agentTab: 'planning',
      currentChapter: {
        id: 'chapter-1',
        novelId: 'novel-1',
        title: '第一章',
        content: '',
        wordCount: 0,
        order: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      novel: {
        id: 'novel-1',
        title: '测试作品',
        authorId: 'local-user',
        summary: '',
        status: 'ongoing',
        mountedSkillIds: [],
        mountedSkillLoadout: [],
        projectPreferenceProfile: {
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
        },
        createdAt: 1,
        updatedAt: 1,
      },
      mountedSkillLoadout: [],
    });

    fireEvent.click(screen.getByText('生成上下文摘要'));
    expect(screen.getByText('能力卡:')).toBeDefined();
    expect(screen.getByText('3/3 个')).toBeDefined();
    expect(screen.queryByText('0/3 个')).toBeNull();
  });

  test('工作台上下文列表显示 v3 作品卡组卡名', () => {
    renderAgentWorkspace({
      currentChapter: {
        id: 'chapter-1',
        novelId: 'novel-1',
        title: '第一章',
        content: '正文已有内容',
        wordCount: 6,
        order: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      novel: {
        id: 'novel-1',
        title: '测试作品',
        authorId: 'local-user',
        summary: '',
        status: 'ongoing',
        mountedSkillIds: [],
        mountedSkillLoadout: [],
        projectPreferenceProfile: {
          capabilityModelVersion: 3,
          capabilityProfile: {
            version: 3,
            projectSkillDeck: {
              mainCardId: 'main-card',
              supportCardIds: ['support-one'],
              updatedAt: 1,
            },
            favoriteTechniqueIds: [],
          },
        },
        createdAt: 1,
        updatedAt: 1,
      },
      librarySkills: [
        { id: 'main-card', name: '主笔节奏卡' },
        { id: 'support-one', name: '世界观约束卡' },
      ],
      mountedSkillLoadout: [],
    });

    expect(screen.getByText('作品默认能力卡 (2)')).toBeDefined();
    expect(screen.getByText(/主笔节奏卡/)).toBeDefined();
    expect(screen.getByText(/世界观约束卡/)).toBeDefined();
    expect(screen.queryByText('使用系统默认写法')).toBeNull();
  });

  test('工作台上下文列表解析无本地克隆的内置作品卡名', () => {
    renderAgentWorkspace({
      currentChapter: {
        id: 'chapter-1',
        novelId: 'novel-1',
        title: '第一章',
        content: '正文已有内容',
        wordCount: 6,
        order: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      novel: {
        id: 'novel-1',
        title: '测试作品',
        authorId: 'local-user',
        summary: '',
        status: 'ongoing',
        mountedSkillIds: [],
        mountedSkillLoadout: [],
        projectPreferenceProfile: {
          capabilityModelVersion: 3,
          capabilityProfile: {
            version: 3,
            projectSkillDeck: {
              mainCardId: 'style-ancient-elegance',
              supportCardIds: [],
              updatedAt: 1,
            },
            favoriteTechniqueIds: [],
          },
        },
        createdAt: 1,
        updatedAt: 1,
      },
      librarySkills: [],
      mountedSkillLoadout: [],
    });

    expect(screen.getByText('作品默认能力卡 (1)')).toBeDefined();
    expect(screen.getByText(/古言华美辞藻典雅国风参考包/)).toBeDefined();
    expect(screen.queryByText(/style-ancient-elegance/)).toBeNull();
  });

  test('生成正文入口展示本次会使用的作品能力配置', () => {
    const setAgentTab = vi.fn();
    renderAgentWorkspace({
      agentTab: 'production',
      setAgentTab,
      currentChapter: {
        id: 'chapter-1',
        novelId: 'novel-1',
        title: '第一章',
        content: '正文已有内容',
        wordCount: 6,
        order: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      novel: {
        id: 'novel-1',
        title: '测试作品',
        authorId: 'local-user',
        summary: '',
        status: 'ongoing',
        mountedSkillIds: [],
        mountedSkillLoadout: [],
        projectPreferenceProfile: {
          capabilityModelVersion: 3,
          capabilityProfile: {
            version: 3,
            projectSkillDeck: {
              mainCardId: 'main-card',
              supportCardIds: ['support-one'],
              updatedAt: 1,
            },
            favoriteTechniqueIds: ['technique-one'],
          },
        },
        createdAt: 1,
        updatedAt: 1,
      },
      projectPreferenceProfile: {
        capabilityModelVersion: 3,
        capabilityProfile: {
          version: 3,
          projectSkillDeck: { mainCardId: 'main-card', supportCardIds: ['support-one'], updatedAt: 1 },
          favoriteTechniqueIds: ['technique-one'],
        },
        tags: [],
      },
      librarySkills: [
        { id: 'main-card', name: '主笔节奏卡' },
        { id: 'support-one', name: '世界观约束卡' },
        { id: 'technique-one', name: '开篇钩子技法' },
        { id: 'chapter-card', name: '本章节奏卡' },
      ],
      stackedDeconstructionCardIds: ['chapter-card'],
      mountedSkillLoadout: [],
    });

    expect(screen.getByLabelText('本次生成能力配置')).toBeDefined();
    expect(screen.getByText('主笔节奏卡、世界观约束卡')).toBeDefined();
    expect(screen.getByText('开篇钩子技法')).toBeDefined();
    expect(screen.getByText('本章节奏卡')).toBeDefined();
    expect(screen.getByText('作品默认卡和常用技法会长期影响本书；本章使用卡只影响当前章节。')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '核对写法与能力' }));
    expect(setAgentTab).toHaveBeenCalledWith('skills');
  });

  test('生成正文入口解析无本地克隆的内置作品主卡名称', () => {
    renderAgentWorkspace({
      agentTab: 'production',
      currentChapter: {
        id: 'chapter-1',
        novelId: 'novel-1',
        title: '第一章',
        content: '正文已有内容',
        wordCount: 6,
        order: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      projectPreferenceProfile: {
        capabilityModelVersion: 3,
        capabilityProfile: {
          version: 3,
          projectSkillDeck: { mainCardId: 'style-ancient-elegance', supportCardIds: [], updatedAt: 1 },
          favoriteTechniqueIds: [],
        },
        tags: [],
      },
      librarySkills: [],
      mountedSkillLoadout: [],
    });

    expect(screen.getByLabelText('本次生成能力配置')).toBeDefined();
    expect(screen.getByText('古言华美辞藻典雅国风参考包')).toBeDefined();
    expect(screen.queryByText('style-ancient-elegance')).toBeNull();
  });

  test('生成正文入口为空作品能力配置提供核对入口', () => {
    const setAgentTab = vi.fn();
    renderAgentWorkspace({
      agentTab: 'production',
      setAgentTab,
      currentChapter: {
        id: 'chapter-1',
        novelId: 'novel-1',
        title: '第一章',
        content: '正文已有内容',
        wordCount: 6,
        order: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      projectPreferenceProfile: { tags: [] },
      librarySkills: [],
      mountedSkillLoadout: [],
    });

    expect(screen.getByLabelText('本次生成能力配置')).toBeDefined();
    expect(screen.getByText('还没有配置作品默认卡或常用技法，生成会先按当前章节与作品上下文继续。')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '核对写法与能力' }));
    expect(setAgentTab).toHaveBeenCalledWith('skills');
  });

  test('审稿入口展示本次会使用的作品能力配置', () => {
    const setAgentTab = vi.fn();
    renderAgentWorkspace({
      agentTab: 'quality',
      setAgentTab,
      currentChapter: {
        id: 'chapter-1',
        novelId: 'novel-1',
        title: '第一章',
        content: '正文已有内容',
        wordCount: 6,
        order: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      projectPreferenceProfile: {
        capabilityModelVersion: 3,
        capabilityProfile: {
          version: 3,
          projectSkillDeck: { mainCardId: 'main-card', supportCardIds: ['support-one'], updatedAt: 1 },
          favoriteTechniqueIds: ['technique-one'],
        },
        tags: [],
      },
      librarySkills: [
        { id: 'main-card', name: '主笔节奏卡' },
        { id: 'support-one', name: '世界观约束卡' },
        { id: 'technique-one', name: '开篇钩子技法' },
        { id: 'chapter-card', name: '本章审稿卡' },
      ],
      stackedDeconstructionCardIds: ['chapter-card'],
      mountedSkillLoadout: [],
    });

    expect(screen.getByLabelText('本次审稿能力配置')).toBeDefined();
    expect(screen.getByText('主笔节奏卡、世界观约束卡')).toBeDefined();
    expect(screen.getByText('开篇钩子技法')).toBeDefined();
    expect(screen.getByText('本章审稿卡')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '核对写法与能力' }));
    expect(setAgentTab).toHaveBeenCalledWith('skills');
  });

  test('本章使用卡摘要使用内置治理资产名称兜底', () => {
    renderAgentWorkspace({
      agentTab: 'production',
      currentChapter: {
        id: 'chapter-1',
        novelId: 'novel-1',
        title: '第一章',
        content: '正文已有内容',
        wordCount: 6,
        order: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      projectPreferenceProfile: { tags: [] },
      librarySkills: [],
      stackedDeconstructionCardIds: ['deconstruct-card-pacing'],
      mountedSkillLoadout: [],
    });

    expect(screen.getByLabelText('本次生成能力配置')).toBeDefined();
    expect(screen.getByText('节奏拆书卡')).toBeDefined();
    expect(screen.queryByText('deconstruct-card-pacing')).toBeNull();
  });

  test('精修入口展示本次会使用的作品能力配置', () => {
    renderAgentWorkspace({
      agentTab: 'quality',
      currentChapter: {
        id: 'chapter-1',
        novelId: 'novel-1',
        title: '第一章',
        content: '正文已有内容',
        critique: '审稿意见',
        wordCount: 6,
        order: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      projectPreferenceProfile: {
        capabilityModelVersion: 3,
        capabilityProfile: {
          version: 3,
          projectSkillDeck: { mainCardId: 'main-card', supportCardIds: [], updatedAt: 1 },
          favoriteTechniqueIds: ['technique-one'],
        },
        tags: [],
      },
      librarySkills: [
        { id: 'main-card', name: '主笔节奏卡' },
        { id: 'technique-one', name: '开篇钩子技法' },
        { id: 'chapter-card', name: '本章精修卡' },
      ],
      stackedDeconstructionCardIds: ['chapter-card'],
      mountedSkillLoadout: [],
    });

    expect(screen.getByLabelText('本次精修能力配置')).toBeDefined();
    expect(screen.getByText('主笔节奏卡')).toBeDefined();
    expect(screen.getByText('开篇钩子技法')).toBeDefined();
    expect(screen.getByText('本章精修卡')).toBeDefined();
  });

  test('半残项目画像打开写法与能力面板时仍可渲染', () => {
    const onNavigate = vi.fn();
    renderAgentWorkspace({
      agentTab: 'skills',
      projectPreferenceProfile: { tags: [] },
      onNavigate,
    });

    expect(screen.getByText('本章写法与能力')).toBeDefined();
    expect(screen.getByText('作品默认 0 · 本章 0 · 作品技法 0 · 本章技法 0 · 系统护栏 12')).toBeDefined();
    expect(screen.getByText('作品写法画像')).toBeDefined();
    expect(screen.getByText('作品默认卡')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '进入作品能力中心' }));
    expect(onNavigate).toHaveBeenCalledWith('skills');
    expect(screen.queryByText('页面出现了意外错误')).toBeNull();
  });

  test('从本章写法面板进入能力中心时保留当前章节', () => {
    const onNavigate = vi.fn();
    renderAgentWorkspace({
      agentTab: 'skills',
      currentChapter: {
        id: 'chapter-1',
        novelId: 'novel-1',
        title: '第一章',
        content: '正文',
        wordCount: 20,
        order: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      onNavigate,
    });

    fireEvent.click(screen.getByRole('button', { name: '进入作品能力中心' }));

    expect(onNavigate).toHaveBeenCalledWith('skills', { targetChapterId: 'chapter-1' });
  });

  test('合并入口状态可访问且更多菜单显示当前模块，Escape 可关闭', () => {
    const { rerender } = renderAgentWorkspace({ agentTab: 'copilot-home' });
    expect(screen.getByRole('button', { name: '当前' }).getAttribute('aria-pressed')).toBe('true');

    rerender(<div />);
    renderAgentWorkspace({ agentTab: 'trace' });
    expect(screen.getByRole('button', { name: '查设定' }).getAttribute('aria-pressed')).toBe('true');

    rerender(<div />);
    renderAgentWorkspace({ agentTab: 'versions' });
    const moreButton = screen.getByRole('button', { name: /版本/ });
    expect(moreButton.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(moreButton);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
