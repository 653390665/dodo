import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SkillsStudioView } from '../components/SkillsStudioView';
import { addCardToProjectDeck } from '../lib/skills-studio-governance';
import { canUseEnhancedCapability } from '../lib/entitlements';
import { getCatalogCapabilityManifest } from '../../shared/lib/capability-manifest-catalog';
import {
  getCapabilityConfigurationBaselineToken,
  saveCapabilityConfigurationSession,
  type CapabilityConfigurationSession,
} from '../lib/capability-configuration-session';

const skillMock = vi.hoisted(() => ({ created: null as Record<string, unknown> | null }));
const novelClientMock = vi.hoisted(() => ({
  listNovels: vi.fn(),
}));

vi.mock('../lib/skill-client', () => ({
  syncSkillFeedbackScores: vi.fn().mockImplementation(async () => skillMock.created ? [skillMock.created] : []),
  deleteSkill: vi.fn(),
  createSkill: vi.fn().mockImplementation(async (skill) => { skillMock.created = { ...skill, id: 'persisted-skill-1' }; }),
}));

const novel = {
  id: 'novel-1', title: '作品', authorId: 'local', summary: '', status: 'ongoing' as const,
  createdAt: 1, updatedAt: 1,
};

vi.mock('../lib/novel-client', () => ({
  listNovels: novelClientMock.listNovels,
  updateNovel: vi.fn().mockResolvedValue(true),
}));

vi.mock('../lib/db-transport', () => ({
  subscribeToChanges: vi.fn(() => () => undefined),
  getDatabaseGenerationSnapshot: vi.fn().mockResolvedValue(7),
}));

vi.mock('../lib/capability-configuration-client', () => ({
  previewCapabilityConfiguration: vi.fn().mockResolvedValue({ previewToken: 'preview-1', databaseGeneration: 7 }),
  applyCapabilityConfiguration: vi.fn().mockResolvedValue({ profile: { version: 3, projectSkillDeck: { supportCardIds: [], updatedAt: 1 }, favoriteTechniqueIds: [] }, databaseGeneration: 8 }),
}));

vi.mock('../lib/capability-migration-client', () => {
  class CapabilityMigrationError extends Error {
    constructor(public code: string, public status: number, message: string) {
      super(message);
    }
  }
  return {
    CapabilityMigrationError,
    previewCapabilityMigration: vi.fn().mockResolvedValue({
      databaseGeneration: 7,
      previewToken: 'migration-preview-1',
      flow: null,
      techniques: [],
      skillCards: { main: { id: 'migrated-main', source: 'legacy' }, support: [] },
      mainCard: { id: 'migrated-main', source: 'legacy' },
      conflicts: [],
      migrationPendingIds: [],
      migratedProfile: { version: 3, projectSkillDeck: { mainCardId: 'migrated-main', supportCardIds: [], updatedAt: 1 }, favoriteTechniqueIds: [] },
      warnings: [],
      sourceSummary: { legacySkillIds: ['legacy-skill'], mountedSkillIds: [] },
    }),
    applyCapabilityMigration: vi.fn().mockResolvedValue({
      applied: true,
      profile: { version: 3, projectSkillDeck: { mainCardId: 'migrated-main', supportCardIds: [], updatedAt: 1 }, favoriteTechniqueIds: [] },
      databaseGeneration: 8,
    }),
  };
});

vi.mock('../lib/product-events-client', () => ({
  createProductEventSessionId: vi.fn((scope = 'session') => `${scope}:test-session`),
  createProductEventId: vi.fn((action: string, sessionId = 'session:test-session') => `event:${sessionId}:${action}`),
  recordProductEvent: vi.fn().mockResolvedValue(undefined),
}));

async function settleStudio() {
  // SkillsStudio hydrates its generation/session state in an effect. Let that
  // first pass finish before asserting or clicking the tab bar.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function openPlaza() {
  await settleStudio();
  fireEvent.click(await screen.findByRole('button', { name: /^能力商店$/ }));
  await waitFor(() => expect(screen.getByRole('tab', { name: /写作技法/ })).toBeTruthy());
  fireEvent.click(screen.getByRole('tab', { name: /写作技法/ }));
}

async function openPackages() {
  await settleStudio();
  fireEvent.click(await screen.findByRole('button', { name: /^能力商店$/ }));
  await waitFor(() => expect(screen.getByRole('tab', { name: /能力包/ })).toBeTruthy());
  fireEvent.click(screen.getByRole('tab', { name: /能力包/ }));
}

describe('Plan 158 capability center', () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    skillMock.created = null;
    localStorage.clear();
    sessionStorage.clear();
    const { applyCapabilityConfiguration, previewCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    vi.mocked(previewCapabilityConfiguration).mockReset().mockResolvedValue({ previewToken: 'preview-1', databaseGeneration: 7 });
    vi.mocked(applyCapabilityConfiguration).mockReset().mockResolvedValue({ profile: { version: 3, projectSkillDeck: { supportCardIds: [], updatedAt: 1 }, favoriteTechniqueIds: [] }, databaseGeneration: 8 });
    novelClientMock.listNovels.mockReset().mockResolvedValue([novel]);
  });
  test('uses flow, techniques, deck and guardrail summaries instead of role equipment slots', async () => {
    render(<SkillsStudioView selectedNovel={novel} />);

    expect(await screen.findByText('当前创作流程')).toBeTruthy();
    expect(screen.getByText('常用技法')).toBeTruthy();
    expect(screen.getByText('作品卡组')).toBeTruthy();
    const deckSummary = screen.getByText('作品卡组').closest('div.rounded-2xl') as HTMLElement;
    expect(within(deckSummary).getByText('主卡：')).toBeTruthy();
    expect(within(deckSummary).getAllByText('未设置').length).toBeGreaterThan(0);
    expect(within(deckSummary).getByText('空位：')).toBeTruthy();
    expect(within(deckSummary).getByText('可添加 1 张主卡、2 张辅卡')).toBeTruthy();
    expect(screen.getByText('护栏状态')).toBeTruthy();
    expect(screen.getByText('系统检查候选')).toBeTruthy();
    expect(screen.queryByText('自动参与检查')).toBeNull();
    expect(screen.queryByText(/Planner（规划）|Writer（写作）|Critic（审稿）/)).toBeNull();
  });

  test('shows a single flow directory instead of duplicating flow packages', async () => {
    const novelWithFlow = {
      ...novel,
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
          activeFlowId: 'generic-novel-flow',
          projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
          favoriteTechniqueIds: [],
        },
      },
    };
    novelClientMock.listNovels.mockResolvedValueOnce([novelWithFlow]);
    render(<SkillsStudioView selectedNovel={novelWithFlow} />);
    fireEvent.click(await screen.findByRole('button', { name: '能力商店' }));

    expect(await screen.findByText('创作流程目录')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '名家短篇/老福特流' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '结构工坊大纲流' })).toBeTruthy();
    expect(screen.getByText('当前作品已选择')).toBeTruthy();
    expect(screen.getByText('已选流程')).toBeTruthy();
    expect(screen.queryByText('名家作者流程包')).toBeNull();
    expect(screen.queryByText('高级作者流程大包')).toBeNull();
    expect(screen.queryByRole('heading', { name: '能力包' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /能力包/ }));
    expect(await screen.findByRole('heading', { name: '能力包' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '创作流程目录' })).toBeNull();
    expect(screen.getByText(/先勾选待提交，再加入本次配置候选并按每步结果确认下一步/)).toBeTruthy();
    expect(screen.getByText('勾选待提交')).toBeTruthy();
    expect(screen.getAllByText('基础开放').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Beta 开放').length).toBeGreaterThan(0);
    expect(screen.queryByText('需授权')).toBeNull();
    expect(screen.queryByRole('button', { name: '查看受限步骤' })).toBeNull();
    expect(screen.queryByText('授权范围')).toBeNull();
    expect(screen.getAllByText('审稿包').length).toBeGreaterThan(0);
    expect(screen.getAllByText('写后处理').length).toBeGreaterThan(0);
    expect(screen.getAllByText('加入本次配置候选后点运行诊断').length).toBeGreaterThan(0);
    expect(screen.getAllByText('精修包').length).toBeGreaterThan(0);
    expect(screen.getAllByText('写前到写后').length).toBeGreaterThan(0);
    expect(screen.getAllByText('加入本次配置候选后点生成预览').length).toBeGreaterThan(0);
    expect(screen.getByText('设定包')).toBeTruthy();
    expect(screen.getAllByText('立项配置').length).toBeGreaterThan(0);
    expect(screen.getAllByText('加入本次配置候选后点应用配置').length).toBeGreaterThan(0);
    expect(screen.getAllByText('拆书包').length).toBeGreaterThan(0);
    expect(screen.getAllByText('加入本次配置候选后先选卡组位置').length).toBeGreaterThan(0);
    expect(screen.queryByText('加入候选后加入作品卡组')).toBeNull();
    expect(screen.getByText('建立可确认的世界观和人物设定候选')).toBeTruthy();
    expect(screen.getByText('先优化开篇结构，再安排第一章正文表达技法')).toBeTruthy();
    expect(screen.getByText('写前减少机械表达，写后提供去 AI 腔预览')).toBeTruthy();
    expect(screen.queryByText('辅助展开最初的小说创意、起名以及构建基础人设。')).toBeNull();
    const packagesRegion = screen.getByRole('region', { name: '能力包' });
    const setupGroup = within(packagesRegion).getByRole('region', { name: '设定与大纲' });
    expect(within(setupGroup).getByRole('heading', { name: '脑洞与角色构建包' })).toBeTruthy();
    expect(within(setupGroup).getByRole('heading', { name: '第一章闭环包' })).toBeTruthy();
    expect(within(setupGroup).getByText('大纲阶段')).toBeTruthy();
    const reviewGroup = within(packagesRegion).getByRole('region', { name: '审稿与精修' });
    expect(within(reviewGroup).getByRole('heading', { name: '基础审稿增强包' })).toBeTruthy();
    expect(within(reviewGroup).getByRole('heading', { name: '高级审稿与局部手术包' })).toBeTruthy();
    const deckGroup = within(packagesRegion).getByRole('region', { name: '拆书与卡组' });
    expect(within(deckGroup).getByRole('heading', { name: '神作拆书与文风融合包' })).toBeTruthy();
    const platformGroup = within(packagesRegion).getByRole('region', { name: '平台过签' });
    expect(within(platformGroup).getByRole('heading', { name: '爆款平台诊断包' })).toBeTruthy();
    expect(screen.queryByText('不自动应用')).toBeNull();
  }, 15_000);

  test('marks paid packages as gated when monetization is enabled', async () => {
    vi.stubEnv('VITE_INKFLOW_ENABLE_MONETIZATION', 'true');
    render(<SkillsStudioView selectedNovel={{
      ...novel,
      projectPreferenceProfile: {
        commercialMode: 'free',
        tags: [],
        weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
        acceptedDimensions: [],
        rejectedDimensions: [],
        notes: [],
        evidenceCount: 0,
      },
    }} />);
    await openPackages();

    expect(screen.getAllByText('需授权').length).toBeGreaterThan(0);
    const restrictedPackage = screen.getByText('跨章连贯性增强包').closest('div.rounded-xl') as HTMLElement;
    expect(within(restrictedPackage).getByRole('button', { name: '查看受限步骤' })).toBeTruthy();
    expect(screen.queryByText('Beta 开放')).toBeNull();
    expect(screen.queryByText('授权范围')).toBeNull();
    fireEvent.click(within(restrictedPackage).getByRole('button', { name: '查看受限步骤' }));
    const restrictedDialog = await screen.findByRole('dialog', { name: '跨章连贯性增强包' });
    expect(within(restrictedDialog).getByText('当前作品未开通授权增强；你可以先查看步骤，授权后再加入本次配置候选。')).toBeTruthy();
    const checkbox = within(restrictedDialog).getAllByRole('checkbox')[0];
    fireEvent.click(checkbox);
    await waitFor(() => expect((checkbox as HTMLInputElement).checked).toBe(true));
    const submit = within(restrictedDialog).getByRole('button', { name: '加入本次配置候选' });
    expect(submit.hasAttribute('disabled')).toBe(true);
    expect(within(restrictedDialog).getByText('当前作品未开通授权增强；可查看步骤，需授权后再加入本次配置候选。')).toBeTruthy();
    expect(submit.getAttribute('title')).toBe('当前作品未开通授权增强；可查看步骤，需授权后再加入本次配置候选。');
  }, 15_000);

  test('records a real capability view-change action after the initial view', async () => {
    const { recordProductEvent } = await import('../lib/product-events-client');
    render(<SkillsStudioView selectedNovel={novel} />);
    await settleStudio();
    fireEvent.click(await screen.findByRole('button', { name: /^能力商店$/ }));
    await waitFor(() => expect(vi.mocked(recordProductEvent)).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'capability_viewed', action: 'view-change', novelId: 'novel-1',
    })));
  });

  test('stages capability-center actions and applies before returning to writing', async () => {
    const onLaunchCapability = vi.fn();
    const onNavigate = vi.fn();
    const onNovelUpdated = vi.fn();
    render(<SkillsStudioView selectedNovel={novel} onNavigate={onNavigate} onLaunchCapability={onLaunchCapability} onNovelUpdated={onNovelUpdated} />);

    await openPlaza();
    const techniqueAction = (await screen.findAllByRole('button', { name: /收藏为常用技法|取消收藏/ }))[0];
    fireEvent.click(techniqueAction);

    await waitFor(() => expect(screen.getByRole('button', { name: '取消收藏' })).toBeTruthy());
    expect(screen.getByText('1 张已收藏')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消收藏' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: '收藏为常用技法' }).length).toBeGreaterThan(0));
    expect(screen.getByText('0 张已收藏')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '收藏为常用技法' })[0]);

    const { updateNovel } = await import('../lib/novel-client');
    expect(updateNovel).not.toHaveBeenCalled();
    expect(onLaunchCapability).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalledWith('editor');
    await waitFor(() => expect(screen.getByRole('button', { name: '应用配置并返回写作' })).toBeTruthy());
    expect(screen.getByText('应用配置后，主卡与辅卡影响作品后续正文；常用技法作为作品偏好；本章使用规则只影响当前章；系统护栏参与生成与审稿检查。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '应用配置并返回写作' }));
    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    await waitFor(() => expect(vi.mocked(applyCapabilityConfiguration)).toHaveBeenCalled());
    expect(vi.mocked(applyCapabilityConfiguration).mock.calls.at(-1)?.[3].favoriteTechniqueIds).toContain('opening-gold-three');
    expect(onNovelUpdated).toHaveBeenCalledWith(expect.objectContaining({
      id: 'novel-1',
      projectPreferenceProfile: expect.objectContaining({
        capabilityProfile: expect.objectContaining({ favoriteTechniqueIds: [] }),
      }),
    }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('workspace', { capabilityApplied: true }));
  }, 15_000);

  test('stages system guardrails from the capability shelf and applies them as guardrail ids', async () => {
    render(<SkillsStudioView selectedNovel={novel} />);

    await openPlaza();
    fireEvent.click(screen.getByRole('tab', { name: /系统护栏/ }));
    const guardrailButtons = await screen.findAllByRole('button', { name: '保存为系统检查候选' });
    fireEvent.click(guardrailButtons[0]);

    await waitFor(() => expect(screen.getByText('默认护栏自动启用；已选增强 1 条。')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '应用配置并返回写作' }));
    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    await waitFor(() => expect(vi.mocked(applyCapabilityConfiguration)).toHaveBeenCalled());
    expect(vi.mocked(applyCapabilityConfiguration).mock.calls.at(-1)?.[3].guardrailIds).toHaveLength(1);
  }, 15_000);

  test('persists a planner technique before opening the project outline', async () => {
    const onLaunchCapability = vi.fn();
    const onNavigate = vi.fn();
    render(
      <SkillsStudioView
        selectedNovel={novel}
        targetChapterId="chapter-7"
        onLaunchCapability={onLaunchCapability}
        onNavigate={onNavigate}
      />,
    );

    await openPlaza();
    const card = screen.getByRole('heading', { name: '黄金三章核心冲突大纲展开器' }).closest('div.bg-theme-sidebar');
    expect(card).not.toBeNull();
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: '应用配置后设为作品默认' }));

    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    await waitFor(() => expect(vi.mocked(applyCapabilityConfiguration)).toHaveBeenCalled());
    expect(vi.mocked(applyCapabilityConfiguration).mock.calls.at(-1)?.[3].projectTechniqueIds).toContain('opening-gold-three');
    expect(vi.mocked(applyCapabilityConfiguration).mock.calls.at(-1)?.[3].favoriteTechniqueIds).not.toContain('opening-gold-three');
    await waitFor(() => expect(onLaunchCapability).toHaveBeenCalledWith({
      action: 'use-project-technique',
      assetId: 'opening-gold-three',
      launchToken: expect.any(Number),
      novelId: 'novel-1',
    }));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  test('persists a writer technique as the full-book default before returning to writing', async () => {
    const onLaunchCapability = vi.fn();
    const onNavigate = vi.fn();
    render(<SkillsStudioView selectedNovel={novel} onLaunchCapability={onLaunchCapability} onNavigate={onNavigate} />);

    await openPlaza();
    const card = screen.getByRole('heading', { name: '场景肢体动作与画面张力正文器' }).closest('div.bg-theme-sidebar');
    expect(card).not.toBeNull();
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: '应用配置后设为作品默认' }));

    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    await waitFor(() => expect(vi.mocked(applyCapabilityConfiguration)).toHaveBeenCalled());
    expect(vi.mocked(applyCapabilityConfiguration).mock.calls.at(-1)?.[3].projectTechniqueIds).toContain('prose-action-booster');
    expect(vi.mocked(applyCapabilityConfiguration).mock.calls.at(-1)?.[3].favoriteTechniqueIds).not.toContain('prose-action-booster');
    expect(onLaunchCapability).not.toHaveBeenCalled();
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('workspace', { capabilityApplied: true }));
  });

  test('persists worldbuilding project techniques before launching a reviewable world candidate', async () => {
    const onLaunchCapability = vi.fn();
    const onNavigate = vi.fn();
    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    let resolveApply: ((value: {
      profile: Parameters<typeof applyCapabilityConfiguration>[3];
      databaseGeneration: number;
    }) => void) | undefined;
    vi.mocked(applyCapabilityConfiguration).mockImplementationOnce(async (_novelId, _generation, _previewToken, profile) => (
      new Promise((resolve) => {
        resolveApply = () => resolve({ profile, databaseGeneration: 8 });
      })
    ));
    render(
      <SkillsStudioView
        selectedNovel={{
          ...novel,
          projectPreferenceProfile: {
            tags: [],
            weights: { styleWeight: 0.5, characterWeight: 0.5, worldWeight: 0.5, plotWeight: 0.5, pacingWeight: 0.5 },
            acceptedDimensions: [],
            rejectedDimensions: [],
            notes: [],
            evidenceCount: 0,
            commercialMode: 'paid',
          },
        }}
        onLaunchCapability={onLaunchCapability}
        onNavigate={onNavigate}
      />,
    );

    await openPlaza();
    const card = screen.getByRole('heading', { name: /长篇超宏大世界观设定器/ }).closest('div.bg-theme-sidebar');
    expect(card).not.toBeNull();
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: '应用配置后设为作品默认' }));

    await waitFor(() => expect(vi.mocked(applyCapabilityConfiguration)).toHaveBeenCalled());
    expect(onNavigate).not.toHaveBeenCalled();
    expect(vi.mocked(applyCapabilityConfiguration).mock.calls.at(-1)?.[3].projectTechniqueIds).toContain('persisted-skill-1');
    await act(async () => resolveApply?.({
      profile: vi.mocked(applyCapabilityConfiguration).mock.calls.at(-1)![3],
      databaseGeneration: 8,
    }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('world', {
      capabilityApplied: true,
      targetFocus: 'workspace-world',
      worldCapabilityLaunch: {
        novelId: 'novel-1',
        launchToken: expect.any(Number),
        capabilityId: 'bible-world-builder',
        artifactKind: 'world',
      },
    }));
    expect(onLaunchCapability).not.toHaveBeenCalled();
  });

  test('keeps worldbuilding project techniques in the capability center when persistence fails', async () => {
    const onNavigate = vi.fn();
    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    vi.mocked(applyCapabilityConfiguration).mockRejectedValueOnce(new Error('配置写入失败'));
    render(<SkillsStudioView selectedNovel={novel} onNavigate={onNavigate} />);

    await openPlaza();
    const card = screen.getByRole('heading', { name: /长篇超宏大世界观设定器/ }).closest('div.bg-theme-sidebar');
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: '应用配置后设为作品默认' }));

    expect(await screen.findByText('配置写入失败')).toBeTruthy();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  test('launches one-shot polish and diagnostic cards with the originating chapter context', async () => {
    const onLaunchCapability = vi.fn();
    const onNavigate = vi.fn();
    render(
      <SkillsStudioView
        selectedNovel={novel}
        targetChapterId="chapter-7"
        onLaunchCapability={onLaunchCapability}
        onNavigate={onNavigate}
      />,
    );

    await openPlaza();
    fireEvent.click(screen.getByRole('tab', { name: /审稿与精修/ }));
    const polishCard = screen.getByRole('heading', { name: '深度AI句式与套话物理抹除器' }).closest('div.bg-theme-sidebar');
    expect(polishCard).not.toBeNull();
    fireEvent.click(within(polishCard as HTMLElement).getByRole('button', { name: '生成精修预览' }));

    const diagnosticCard = screen.getByRole('heading', { name: '去AI腔腔调与废话净化质检仪' }).closest('div.bg-theme-sidebar');
    expect(diagnosticCard).not.toBeNull();
    fireEvent.click(within(diagnosticCard as HTMLElement).getByRole('button', { name: '运行审稿诊断' }));

    await waitFor(() => expect(onLaunchCapability).toHaveBeenCalledTimes(2));
    expect(onLaunchCapability).toHaveBeenNthCalledWith(1, {
      action: 'run-utility',
      assetId: 'de-ai-slop-shield',
      launchToken: expect.any(Number),
      novelId: 'novel-1',
      targetChapterId: 'chapter-7',
    });
    expect(onLaunchCapability).toHaveBeenNthCalledWith(2, {
      action: 'run-diagnostic',
      assetId: 'audit-cliche-detector',
      launchToken: expect.any(Number),
      novelId: 'novel-1',
      targetChapterId: 'chapter-7',
    });
    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    expect(vi.mocked(applyCapabilityConfiguration)).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  test('opens polish stage in the capability store when launched from editor diagnostics', async () => {
    render(<SkillsStudioView selectedNovel={novel} initialStage="style-polish" targetChapterId="chapter-7" />);

    await settleStudio();

    expect(screen.getByText('从审稿问题进入：选择精修卡后点「生成精修预览」，会回到刚才章节生成只读预览。')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('tab', { name: /审稿与精修/ }).getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByRole('heading', { name: '③ 审稿与精修' })).toBeTruthy();
    expect(screen.getByText('写完后先跑审稿卡，再用精修卡处理套话、逻辑和局部润色。')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: '深度AI句式与套话物理抹除器' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '文字灵性语流节奏重建增强包' })).toBeTruthy();
  });

  test('prioritizes editor polish launch shelf while preserving a saved configuration draft', async () => {
    const profile = {
      version: 3 as const,
      projectSkillDeck: { mainCardId: undefined, supportCardIds: [], updatedAt: 1 },
      favoriteTechniqueIds: [],
    };
    saveCapabilityConfigurationSession({
      version: 1,
      novelId: 'novel-1',
      databaseGeneration: 7,
      baselineToken: getCapabilityConfigurationBaselineToken(profile),
      configurationDraft: profile,
      candidateCardIds: ['candidate-card'],
      pendingCandidateId: null,
      activeTab: 'mySkills',
      selectedCapability: 'skill-card',
      selectedCategory: 'all',
      selectedAssetId: null,
      scrollTop: 0,
      updatedAt: 1,
    });

    render(<SkillsStudioView selectedNovel={novel} initialStage="style-polish" targetChapterId="chapter-7" />);

    await settleStudio();

    expect(await screen.findByText('candidate-card')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('tab', { name: /审稿与精修/ }).getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByRole('heading', { name: '③ 审稿与精修' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '深度AI句式与套话物理抹除器' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '去AI腔腔调与废话净化质检仪' })).toBeTruthy();
  });

  test('restores pending package steps before applying a remounted configuration', async () => {
    const profile = {
      version: 3 as const,
      projectSkillDeck: { mainCardId: undefined, supportCardIds: [], updatedAt: 1 },
      favoriteTechniqueIds: [],
    };
    saveCapabilityConfigurationSession({
      version: 1,
      novelId: 'novel-1',
      databaseGeneration: 7,
      baselineToken: getCapabilityConfigurationBaselineToken(profile),
      configurationDraft: profile,
      pendingPackageSteps: [{ id: 'free-first-chapter-prose', assetId: 'prose-action-booster', mode: 'schedule', trigger: 'before-draft', scope: 'chapter', order: 2, required: false }],
      candidateCardIds: [],
      pendingCandidateId: null,
      activeTab: 'mySkills',
      selectedCapability: 'packages',
      selectedCategory: 'all',
      selectedAssetId: null,
      scrollTop: 0,
      updatedAt: 1,
    });
    render(<SkillsStudioView selectedNovel={novel} targetChapterId="chapter-7" />);

    await settleStudio();
    const { applyCapabilityConfiguration, previewCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    const previewButton = await screen.findByRole('button', { name: '重新预览本次配置' });
    fireEvent.click(previewButton);
    await waitFor(() => expect(vi.mocked(previewCapabilityConfiguration)).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /应用配置并返回写作/ }));
    await waitFor(() => expect(vi.mocked(applyCapabilityConfiguration)).toHaveBeenCalled());
    expect(vi.mocked(applyCapabilityConfiguration).mock.calls.at(-1)?.[4]).toEqual([
      expect.objectContaining({ stepId: 'free-first-chapter-prose', assetId: 'prose-action-booster', scope: 'chapter', mode: 'schedule' }),
    ]);
  }, 15_000);

  test('keeps the draft and stays in the center when apply fails', async () => {
    const onNavigate = vi.fn();
    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    vi.mocked(applyCapabilityConfiguration).mockRejectedValueOnce(new Error('generation changed'));
    render(<SkillsStudioView selectedNovel={novel} onNavigate={onNavigate} />);
    await openPlaza();
    fireEvent.click((await screen.findAllByRole('button', { name: /收藏为常用技法|取消收藏/ }))[0]);
    fireEvent.click(screen.getByRole('button', { name: '应用配置并返回写作' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('generation changed'));
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重试应用配置并返回写作' }));
    await waitFor(() => expect(vi.mocked(applyCapabilityConfiguration)).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('workspace', { capabilityApplied: true }));
  }, 15_000);

  test('alerts instead of silently ignoring capability actions without a selected work', async () => {
    const onLaunchCapability = vi.fn();
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    render(<SkillsStudioView selectedNovel={null} onLaunchCapability={onLaunchCapability} />);

    await openPlaza();
    const techniqueCard = screen.getByRole('heading', { name: '黄金三章核心冲突大纲展开器' }).closest('div.bg-theme-sidebar');
    expect(techniqueCard).not.toBeNull();
    fireEvent.click(within(techniqueCard as HTMLElement).getByRole('button', { name: '应用配置后设为作品默认' }));

    fireEvent.click(screen.getByRole('tab', { name: /审稿与精修/ }));
    const diagnosticCard = screen.getByRole('heading', { name: '去AI腔腔调与废话净化质检仪' }).closest('div.bg-theme-sidebar');
    expect(diagnosticCard).not.toBeNull();
    fireEvent.click(within(diagnosticCard as HTMLElement).getByRole('button', { name: '运行审稿诊断' }));

    expect(alert).toHaveBeenCalledTimes(2);
    expect(alert).toHaveBeenCalledWith('请先选择一个作品再使用该能力。');
    expect(onLaunchCapability).not.toHaveBeenCalled();
  });

  test('renders author-facing labels in real capability store cards', async () => {
    render(<SkillsStudioView selectedNovel={novel} />);

    await openPlaza();
    const outlineCard = screen.getByRole('heading', { name: '黄金三章核心冲突大纲展开器' }).closest('div.bg-theme-sidebar') as HTMLElement;
    expect(within(outlineCard).getByText('结构卡')).toBeTruthy();
    expect(within(outlineCard).getByText('适合：拆解结构、节奏与钩子')).toBeTruthy();
    expect(within(outlineCard).getByText('入口：应用配置后设为作品默认，用于开篇和节奏')).toBeTruthy();
    expect(within(outlineCard).getByText('作品默认')).toBeTruthy();
    expect(within(outlineCard).getByText('配置到作品：应用配置后写入大纲技法，并前往大纲继续使用。')).toBeTruthy();
    expect(within(outlineCard).getByRole('button', { name: '应用配置后设为作品默认' })).toBeTruthy();

    const worldCard = screen.getByRole('heading', { name: '核心角色人设卡与成长弧光生成' }).closest('div.bg-theme-sidebar') as HTMLElement;
    expect(within(worldCard).getByText('世界观卡')).toBeTruthy();
    expect(within(worldCard).getByText('适合：大纲、人设与世界观设定')).toBeTruthy();
    expect(within(worldCard).getByText('作品默认')).toBeTruthy();
    expect(within(worldCard).getByText('配置到作品：应用配置后写入设定素材，并前往世界观继续整理。')).toBeTruthy();

    const proseCard = screen.getByRole('heading', { name: '超强口语化推进剧情正文器' }).closest('div.bg-theme-sidebar') as HTMLElement;
    expect(within(proseCard).getByText('文风卡')).toBeTruthy();
    expect(within(proseCard).getByText('入口：可设为作品默认统一全文，也可点「用于本章」配置章节表达')).toBeTruthy();
    expect(within(proseCard).getByText('作品默认 / 本章使用')).toBeTruthy();
    expect(within(proseCard).getByText('可设为作品默认统一全文，也可只用于当前章节。')).toBeTruthy();
    expect(within(proseCard).getByRole('button', { name: '用于本章' })).toBeTruthy();
    expect(within(proseCard).queryByRole('button', { name: '仅运行一次' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '深度AI句式与套话物理抹除器' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /拆书卡/ }));
    const deconstructionCard = screen.getByRole('heading', { name: /克苏鲁不可名状寒风氛围风格增色包/ }).closest('div.bg-theme-sidebar') as HTMLElement;
    expect(within(deconstructionCard).getByText('文风卡')).toBeTruthy();
    expect(within(deconstructionCard).getByText('入口：先选主卡或辅卡位置，应用配置后用于拆书')).toBeTruthy();
    expect(within(deconstructionCard).getByText('卡组位置：先选主卡或辅卡，应用配置后写入作品卡组。')).toBeTruthy();
    expect(within(deconstructionCard).getByText('作品默认 / 本章使用')).toBeTruthy();
    expect(within(deconstructionCard).getByRole('button', { name: '应用配置后设为作品默认' })).toBeTruthy();
    expect(within(deconstructionCard).getByRole('button', { name: '用于本章' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /审稿与精修/ }));
    const polishCard = screen.getByRole('heading', { name: '深度AI句式与套话物理抹除器' }).closest('div.bg-theme-sidebar') as HTMLElement;
    expect(within(polishCard).getByText('精修卡')).toBeTruthy();
    expect(within(polishCard).getByText('适合：审稿后生成局部精修预览')).toBeTruthy();
    expect(within(polishCard).getByText('入口：收藏后可点「应用配置后写入本章规则」或「生成精修预览」')).toBeTruthy();
    expect(within(polishCard).getByText('应用配置后可写入本章规则；运行一次只生成精修预览。')).toBeTruthy();
    expect(within(polishCard).getByRole('button', { name: '收藏为常用精修卡' })).toBeTruthy();
    expect(within(polishCard).getByRole('button', { name: '应用配置后写入本章规则' })).toBeTruthy();
    expect(within(polishCard).getByRole('button', { name: '生成精修预览' })).toBeTruthy();
    expect(within(polishCard).queryByText(/作用域:|作者流程|质量防线|项目 \/ 章节|单次运行/)).toBeNull();

    const diagnosticCard = screen.getByRole('heading', { name: '去AI腔腔调与废话净化质检仪' }).closest('div.bg-theme-sidebar') as HTMLElement;
    expect(within(diagnosticCard).getByText('审稿卡')).toBeTruthy();
    expect(within(diagnosticCard).getByText('适合：写后检查跑偏、重复与逻辑问题')).toBeTruthy();
    expect(within(diagnosticCard).getByText('入口：写后直接运行审稿诊断')).toBeTruthy();
    expect(within(diagnosticCard).getByText('运行一次：只生成诊断或辅助结果，不改正文。')).toBeTruthy();
    expect(within(diagnosticCard).getByText('仅运行一次')).toBeTruthy();
    expect(within(diagnosticCard).getByRole('button', { name: '运行审稿诊断' })).toBeTruthy();
    expect(within(diagnosticCard).queryByText(/作用域:|质量防线|单次运行/)).toBeNull();

    fireEvent.click(screen.getByText('④ 过签与平台检查'));
    expect(screen.getByRole('heading', { name: '番茄爽文爆款完读率诊断评分仪' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '海外主流网文海外通吃爽点自检仪' })).toBeTruthy();
    expect(screen.getAllByText('暂不可运行')).toHaveLength(2);
    expect(screen.getAllByText('暂不可用')).toHaveLength(2);
    expect(screen.queryByText('该航道暂无精品卡，敬请期待')).toBeNull();
  });

  test('launches active catalog skill-cards as chapter overlays without importing a clone', async () => {
    const onLaunchCapability = vi.fn();
    render(<SkillsStudioView selectedNovel={novel} targetChapterId="chapter-7" onLaunchCapability={onLaunchCapability} />);

    await openPlaza();
    fireEvent.click(screen.getByRole('tab', { name: /拆书卡/ }));
    const card = screen.getByRole('heading', { name: '古言华美辞藻典雅国风参考包' }).closest('div.bg-theme-sidebar') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: '用于本章' }));

    await waitFor(() => expect(onLaunchCapability).toHaveBeenCalledWith({
      action: 'use-overlay',
      assetId: 'style-ancient-elegance',
      launchToken: expect.any(Number),
      novelId: 'novel-1',
      targetChapterId: 'chapter-7',
      sessionCardIds: ['style-ancient-elegance'],
    }));
    const { createSkill } = await import('../lib/skill-client');
    expect(vi.mocked(createSkill)).not.toHaveBeenCalled();
    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    expect(vi.mocked(applyCapabilityConfiguration)).not.toHaveBeenCalled();
  });

  test('shows a plaza technique as favorited after its imported id is staged', async () => {
    render(<SkillsStudioView selectedNovel={novel} />);
    await openPlaza();

    const card = screen.getByRole('heading', { name: '超强口语化推进剧情正文器' }).closest('div.bg-theme-sidebar');
    expect(card).not.toBeNull();
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: '收藏为常用技法' }));

    await waitFor(() => expect(within(card as HTMLElement).getByRole('button', { name: '取消收藏' })).toBeTruthy(), { timeout: 5_000 });
    fireEvent.click(screen.getByRole('button', { name: '应用配置并返回写作' }));
    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    await waitFor(() => expect(vi.mocked(applyCapabilityConfiguration)).toHaveBeenCalled());
    const appliedProfile = vi.mocked(applyCapabilityConfiguration).mock.calls.at(-1)?.[3];
    expect(appliedProfile?.favoriteTechniqueIds).toContain('persisted-skill-1');
    expect(appliedProfile?.capabilityMemberships).toContainEqual(expect.objectContaining({
      sourceId: 'prose-mouth-flavor',
      sourceVersion: '3',
      sourceType: 'plaza',
      persistedSkillId: 'persisted-skill-1',
    }));
  }, 15_000);

  test('routes a full deck replacement through the reachable pending candidate dialog', async () => {
    const fullDeck = {
      version: 3 as const,
      projectSkillDeck: { mainCardId: 'style-ancient-elegance', supportCardIds: ['deconstruct-golden-climax', 'deconstruct-suspense-hook'], updatedAt: 1 },
      favoriteTechniqueIds: [],
    };
    const blocked = addCardToProjectDeck(fullDeck, 'style-cthulhu-mystique', 'main');
    expect(blocked.requiresReplacement).toBe(true);
    const replaced = addCardToProjectDeck(fullDeck, 'style-cthulhu-mystique', undefined, 'style-ancient-elegance');
    expect(replaced.requiresReplacement).toBe(false);
    expect(replaced.profile.projectSkillDeck.mainCardId).toBe('style-cthulhu-mystique');
  });

  test('uses manifest source for flow gating and leaves generic flow available to free works', async () => {
    expect(getCatalogCapabilityManifest('generic-novel-flow')?.sourceType).toBe('built-in');
    expect(canUseEnhancedCapability({ commercialMode: 'free', env: { VITE_INKFLOW_ENABLE_MONETIZATION: 'true' } })).toBe(false);
    expect(getCatalogCapabilityManifest('generic-novel-flow')?.sourceType === 'licensed').toBe(false);
  });

  test('records cancellation only after explicitly abandoning dirty configuration', async () => {
    const { recordProductEvent } = await import('../lib/product-events-client');
    const onNavigate = vi.fn();
    render(<SkillsStudioView selectedNovel={novel} onNavigate={onNavigate} />);
    const returnButton = await screen.findByRole('button', { name: '回到当前作品工作台' });
    fireEvent.click(returnButton);
    expect(vi.mocked(recordProductEvent)).not.toHaveBeenCalledWith(expect.objectContaining({ eventName: 'capability_config_cancelled' }));

    await openPlaza();
    fireEvent.click((await screen.findAllByRole('button', { name: /收藏为常用技法|取消收藏/ }))[0]);
    fireEvent.click(screen.getByRole('button', { name: '回到当前作品工作台' }));
    fireEvent.click(await screen.findByRole('button', { name: '放弃变更' }));
    await waitFor(() => expect(vi.mocked(recordProductEvent)).toHaveBeenCalledWith(expect.objectContaining({ eventName: 'capability_config_cancelled' })));
  }, 15_000);

  test('shows an old-generation draft as read-only and previews before allowing apply', async () => {
    const { applyCapabilityConfiguration, previewCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    const draft = {
      version: 3 as const,
      projectSkillDeck: { mainCardId: undefined, supportCardIds: [], updatedAt: 1 },
      favoriteTechniqueIds: [],
    };
    const staleSession: CapabilityConfigurationSession = {
      version: 1,
      novelId: 'novel-1',
      databaseGeneration: 6,
      baselineToken: 'old-baseline',
      configurationDraft: draft,
      candidateCardIds: ['candidate-card'],
      pendingCandidateId: null,
      activeTab: 'mySkills',
      selectedCapability: 'skill-card',
      selectedCategory: 'all',
      selectedAssetId: null,
      scrollTop: 0,
      updatedAt: 1,
    };
    saveCapabilityConfigurationSession(staleSession);

    render(<SkillsStudioView selectedNovel={novel} />);
    expect(await screen.findByText(/这是旧版本草稿，仅供查看/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '设为主卡' }).hasAttribute('disabled')).toBe(true);

    const previewButton = screen.getByRole('button', { name: '重新预览本次配置' });
    fireEvent.click(previewButton);
    await waitFor(() => expect(vi.mocked(previewCapabilityConfiguration)).toHaveBeenCalled());
    expect(vi.mocked(applyCapabilityConfiguration)).not.toHaveBeenCalled();
    expect(screen.getByText(/请再次点击应用配置以写入作品/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '应用配置并返回写作' }));
    await waitFor(() => expect(vi.mocked(applyCapabilityConfiguration)).toHaveBeenCalledTimes(1));
  }, 15_000);

  test('allows a diagnostic-only package to run from a stale configuration session', async () => {
    const { previewCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    const draft = {
      version: 3 as const,
      projectSkillDeck: { mainCardId: undefined, supportCardIds: [], updatedAt: 1 },
      favoriteTechniqueIds: [],
    };
    saveCapabilityConfigurationSession({
      version: 1,
      novelId: 'novel-1',
      databaseGeneration: 6,
      baselineToken: 'old-baseline',
      configurationDraft: draft,
      candidateCardIds: [],
      pendingCandidateId: null,
      activeTab: 'mySkills',
      selectedCapability: 'skill-card',
      selectedCategory: 'all',
      selectedAssetId: null,
      scrollTop: 0,
      updatedAt: 1,
    });

    render(<SkillsStudioView selectedNovel={novel} />);
    expect(await screen.findByText(/这是旧版本草稿，仅供查看/)).toBeTruthy();
    await openPackages();
    const auditPackage = screen.getByText('基础审稿增强包').closest('div.rounded-xl');
    expect(auditPackage).not.toBeNull();
    fireEvent.click(within(auditPackage as HTMLElement).getByRole('button', { name: '展开并选择' }));

    const dialog = await screen.findByRole('dialog', { name: '基础审稿增强包' });
    const checkbox = within(dialog).getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.disabled).toBe(false);
    expect(within(dialog).getByRole('button', { name: '重新预览本次配置' })).toBeTruthy();
    fireEvent.click(checkbox);
    expect(within(dialog).getByRole('button', { name: '加入本次配置候选' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: '重新预览本次配置' }));
    await waitFor(() => expect(vi.mocked(previewCapabilityConfiguration)).toHaveBeenCalled());
    const refreshedDialog = screen.getByRole('dialog', { name: '基础审稿增强包' });
    expect((within(refreshedDialog).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(refreshedDialog).getByRole('button', { name: '加入本次配置候选' }));

    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    expect(vi.mocked(applyCapabilityConfiguration)).not.toHaveBeenCalled();
  }, 15_000);

  test('uses author-facing action and scope labels inside package components', async () => {
    const onLaunchCapability = vi.fn();
    const { recordProductEvent } = await import('../lib/product-events-client');
    render(<SkillsStudioView selectedNovel={novel} targetChapterId="chapter-7" onLaunchCapability={onLaunchCapability} />);
    await openPackages();

    const auditPackage = screen.getByText('基础审稿增强包').closest('div.rounded-xl') as HTMLElement;
    fireEvent.click(within(auditPackage).getByRole('button', { name: '展开并选择' }));
    const auditDialog = await screen.findByRole('dialog', { name: '基础审稿增强包' });
    expect(within(auditDialog).getByText('只把已勾选步骤提交到本次配置候选；配置类提交后仍待应用，点击应用配置后才写入作品；运行类提交后再点运行按钮。')).toBeTruthy();
    expect(within(auditDialog).getByText('目标：')).toBeTruthy();
    expect(within(auditDialog).getByText('完成章节写后基础审查')).toBeTruthy();
    expect(within(auditDialog).getByText('优先：')).toBeTruthy();
    expect(within(auditDialog).getByText(/先勾必选审稿项/)).toBeTruthy();
    expect(within(auditDialog).getByText('提交后：')).toBeTruthy();
    expect(within(auditDialog).getByText('加入本次配置候选后点运行诊断')).toBeTruthy();
    expect(within(auditDialog).getByText(/必选 · 不改正文 · 运行审稿诊断 · 写后 · 本章使用/)).toBeTruthy();
    expect(within(auditDialog).getByText('运行一次：只生成诊断或辅助结果，不改正文。')).toBeTruthy();
    const auditRow = within(auditDialog).getByText(/必选 · 不改正文 · 运行审稿诊断 · 写后 · 本章使用/).closest('div.rounded-lg') as HTMLElement;
    expect(within(auditRow).getByText('必选')).toBeTruthy();
    expect(within(auditDialog).queryByText(/配置到本书|可手动运行|仅提供工具/)).toBeNull();
    const auditCheckbox = within(auditDialog).getByRole('checkbox') as HTMLInputElement;
    if (!auditCheckbox.checked) fireEvent.click(auditCheckbox);
    await waitFor(() => expect((within(screen.getByRole('dialog', { name: '基础审稿增强包' })).getByRole('checkbox') as HTMLInputElement).checked).toBe(true));
    fireEvent.click(within(screen.getByRole('dialog', { name: '基础审稿增强包' })).getByRole('button', { name: '加入本次配置候选' }));
    const refreshedAuditDialog = await screen.findByRole('dialog', { name: '基础审稿增强包' });
    await waitFor(() => expect(within(refreshedAuditDialog).queryByText(/已勾选 \d+ 项，待提交/)).toBeNull());
    expect(await within(refreshedAuditDialog).findByText('下一步：审稿诊断待运行')).toBeTruthy();
    const auditLaunchButton = within(refreshedAuditDialog).getByRole('button', { name: '运行审稿诊断' });
    expect(auditLaunchButton.getAttribute('data-autofocus-package-result')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(auditLaunchButton));
    fireEvent.click(auditLaunchButton);
    await waitFor(() => expect(onLaunchCapability).toHaveBeenCalledWith({
      action: 'run-diagnostic',
      assetId: 'audit-cliche-detector',
      launchToken: expect.any(Number),
      novelId: 'novel-1',
      targetChapterId: 'chapter-7',
    }));
    expect(await within(refreshedAuditDialog).findByText('已发送到编辑器执行')).toBeTruthy();
    await waitFor(() => expect(vi.mocked(recordProductEvent)).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'capability_package_result_launched',
      objectId: 'audit-cliche-detector',
      action: 'run-diagnostic',
    })));
    const continueButton = within(refreshedAuditDialog).getByRole('button', { name: '勾选新能力后可提交' });
    expect(continueButton.hasAttribute('disabled')).toBe(true);
    expect(continueButton.getAttribute('title')).toBe('如需继续提交，请先勾选新能力');
    expect(within(refreshedAuditDialog).getByText('已提交的运行项可立即执行；请点击结果里的运行按钮。也可继续勾选其他能力。')).toBeTruthy();
    expect(within(refreshedAuditDialog).queryByText(/已推荐，需手动触发|已推荐，需手动运行/)).toBeNull();

    fireEvent.click(within(refreshedAuditDialog).getByRole('button', { name: '关闭能力包' }));
    const humanizationPackage = screen.getByText('基础去 AI 腔增强包').closest('div.rounded-xl') as HTMLElement;
    fireEvent.click(within(humanizationPackage).getByRole('button', { name: '展开并选择' }));
    const humanizationDialog = await screen.findByRole('dialog', { name: '基础去 AI 腔增强包' });
    expect(within(humanizationDialog).getByText(/先勾写前规则/)).toBeTruthy();
    expect(within(humanizationDialog).getByText(/必选 · 应用配置后写入本章规则 · 写前 · 本章使用/)).toBeTruthy();
    expect(within(humanizationDialog).getByText(/生成精修预览 · 写后 · 选区使用/)).toBeTruthy();
    expect(within(humanizationDialog).getAllByText('应用配置后可写入本章规则；运行一次只生成精修预览。').length).toBeGreaterThan(0);
    expect(within(humanizationDialog).getByText(/请先选择前置能力：深度AI句式与套话物理抹除器/)).toBeTruthy();
    const blockedPreviewRow = within(humanizationDialog).getByText(/请先选择前置能力：深度AI句式与套话物理抹除器/).closest('div.rounded-lg') as HTMLElement;
    expect(within(blockedPreviewRow).getByText('依赖未满足')).toBeTruthy();
    const humanizationCheckboxes = within(humanizationDialog).getAllByRole('checkbox');
    fireEvent.click(humanizationCheckboxes[0]);
    await waitFor(() => expect((humanizationCheckboxes[0] as HTMLInputElement).checked).toBe(true));
    fireEvent.click(humanizationCheckboxes[1]);
    await waitFor(() => expect((humanizationCheckboxes[1] as HTMLInputElement).checked).toBe(true));
    fireEvent.click(within(humanizationDialog).getByRole('button', { name: '加入本次配置候选' }));
    expect(await within(humanizationDialog).findByText('下一步：应用配置后写入本章规则')).toBeTruthy();
    expect(await within(humanizationDialog).findByText('下一步：精修预览待生成')).toBeTruthy();
    const ruleRow = within(humanizationDialog).getByText(/应用配置后写入本章规则 · 写前 · 本章使用/).closest('div.rounded-lg') as HTMLElement;
    const previewRow = within(humanizationDialog).getByText(/生成精修预览 · 写后 · 选区使用/).closest('div.rounded-lg') as HTMLElement;
    expect(within(ruleRow).getByText('下一步：应用配置后写入本章规则')).toBeTruthy();
    expect(within(ruleRow).queryByText('精修预览待生成')).toBeNull();
    expect(within(previewRow).getByText('下一步：精修预览待生成')).toBeTruthy();
    expect(within(previewRow).queryByText('应用配置后启用本章规则')).toBeNull();
    expect(within(humanizationDialog).getByRole('button', { name: '应用所选配置并返回写作' })).toBeTruthy();
    const polishPreviewButton = within(previewRow).getByRole('button', { name: '生成精修预览' });
    expect(polishPreviewButton.getAttribute('data-autofocus-package-result')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(polishPreviewButton));
    fireEvent.click(polishPreviewButton);
    await waitFor(() => expect(onLaunchCapability).toHaveBeenCalledWith({
      action: 'run-utility',
      assetId: 'de-ai-slop-shield',
      launchToken: expect.any(Number),
      novelId: 'novel-1',
      targetChapterId: 'chapter-7',
    }));
    expect(await within(humanizationDialog).findByText('已发送到编辑器执行')).toBeTruthy();
    await waitFor(() => expect(vi.mocked(recordProductEvent)).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'capability_package_result_launched',
      objectId: 'de-ai-slop-shield',
      action: 'run-utility',
    })));

    fireEvent.click(within(humanizationDialog).getByRole('button', { name: '关闭能力包' }));
    const onboardingPackage = screen.getByText('脑洞与角色构建包').closest('div.rounded-xl') as HTMLElement;
    fireEvent.click(within(onboardingPackage).getByRole('button', { name: '展开并选择' }));
    const onboardingDialog = await screen.findByRole('dialog', { name: '脑洞与角色构建包' });
    expect(within(onboardingDialog).getByText(/先生成世界观，再接人物弧线/)).toBeTruthy();
    expect(within(onboardingDialog).getAllByText(/必选 · 应用配置后设为作品默认 · 立项时 · 作品默认/).length).toBeGreaterThan(0);
    expect(within(onboardingDialog).getAllByText('配置到作品：应用配置后写入设定素材，并前往世界观继续整理。').length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(within(onboardingDialog).getByRole('button', { name: '保存到我的能力，并勾选待提交' }));
    });
    const onboardingCheckboxes = within(onboardingDialog).getAllByRole('checkbox');
    await waitFor(() => expect((onboardingCheckboxes[0] as HTMLInputElement).checked).toBe(true));
    fireEvent.click(onboardingCheckboxes[1]);
    await waitFor(() => expect((onboardingCheckboxes[1] as HTMLInputElement).checked).toBe(true));
    fireEvent.click(within(onboardingDialog).getByRole('button', { name: '加入本次配置候选' }));
    expect(await within(onboardingDialog).findAllByText('下一步：应用配置后前往世界观设定')).toHaveLength(2);
    expect(within(onboardingDialog).queryByText(/加入作品卡组后生效|启用作品卡组/)).toBeNull();
    const applyWorldButton = within(onboardingDialog).getByRole('button', { name: '应用配置并前往世界观' });
    expect(applyWorldButton.getAttribute('data-autofocus-package-apply')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(applyWorldButton));
    expect(within(onboardingDialog).getByText('已提交的配置仍待应用；点击应用配置后才写入作品。也可继续勾选其他能力。')).toBeTruthy();
    expect(screen.queryByText('当前配置仍待应用；应用成功后才更新作品状态。')).toBeNull();
    expect(within(onboardingDialog).queryByText(/配置到本书|本书/)).toBeNull();
  }, 15_000);

  test('explains outline package results as outline setup instead of deck setup', async () => {
    const onLaunchCapability = vi.fn();
    render(<SkillsStudioView selectedNovel={novel} targetChapterId="chapter-7" onLaunchCapability={onLaunchCapability} />);
    await openPackages();

    const firstChapterPackage = screen.getByText('第一章闭环包').closest('div.rounded-xl') as HTMLElement;
    fireEvent.click(within(firstChapterPackage).getByRole('button', { name: '展开并选择' }));
    const dialog = await screen.findByRole('dialog', { name: '第一章闭环包' });
    const checkboxes = within(dialog).getAllByRole('checkbox');
    expect(within(dialog).getByText('配置到作品：应用配置后写入大纲技法，并前往大纲继续使用。')).toBeTruthy();
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    await waitFor(() => expect((checkboxes[0] as HTMLInputElement).checked).toBe(true));
    await waitFor(() => expect((checkboxes[1] as HTMLInputElement).checked).toBe(true));
    fireEvent.click(within(dialog).getByRole('button', { name: '加入本次配置候选' }));

    expect(await within(dialog).findByText('下一步：应用配置后前往大纲面板')).toBeTruthy();
    expect(within(dialog).queryByText(/加入作品卡组后生效|启用作品卡组/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '应用配置并前往大纲' }));
    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    await waitFor(() => expect(vi.mocked(applyCapabilityConfiguration)).toHaveBeenCalled());
    const applyCall = vi.mocked(applyCapabilityConfiguration).mock.calls.at(-1);
    expect(applyCall?.[3].projectTechniqueIds).toContain('opening-gold-three');
    expect(applyCall?.[3].favoriteTechniqueIds).not.toContain('opening-gold-three');
    expect(applyCall?.[3].favoriteTechniqueIds).not.toContain('prose-action-booster');
    expect(applyCall?.[4]).toEqual([
      expect.objectContaining({ stepId: 'free-first-chapter-outline', assetId: 'opening-gold-three', scope: 'project' }),
      expect.objectContaining({ stepId: 'free-first-chapter-prose', assetId: 'prose-action-booster', scope: 'chapter', mode: 'schedule' }),
    ]);
    expect(applyCall?.[5]).toBe('chapter-7');
    await waitFor(() => expect(onLaunchCapability).toHaveBeenCalledWith({
      action: 'use-project-technique',
      assetId: 'opening-gold-three',
      launchToken: expect.any(Number),
      novelId: 'novel-1',
    }));
  }, 15_000);

  test('applies setup package configuration to the world bible destination', async () => {
    const onNavigate = vi.fn();
    const onNovelUpdated = vi.fn();
    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    vi.mocked(applyCapabilityConfiguration).mockImplementationOnce(async (_novelId, _databaseGeneration, _previewToken, profile) => ({
      profile,
      databaseGeneration: 8,
    }));
    render(<SkillsStudioView selectedNovel={novel} onNavigate={onNavigate} onNovelUpdated={onNovelUpdated} />);
    await openPackages();

    const onboardingPackage = screen.getByText('脑洞与角色构建包').closest('div.rounded-xl') as HTMLElement;
    fireEvent.click(within(onboardingPackage).getByRole('button', { name: '展开并选择' }));
    const dialog = await screen.findByRole('dialog', { name: '脑洞与角色构建包' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '保存到我的能力，并勾选待提交' }));
    });
    const checkboxes = within(dialog).getAllByRole('checkbox');
    await waitFor(() => expect((checkboxes[0] as HTMLInputElement).checked).toBe(true));
    fireEvent.click(checkboxes[1]);
    await waitFor(() => expect((checkboxes[1] as HTMLInputElement).checked).toBe(true));
    fireEvent.click(within(dialog).getByRole('button', { name: '加入本次配置候选' }));
    expect(await within(dialog).findByRole('button', { name: '应用配置并前往世界观' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '应用配置并前往世界观' }));

    await waitFor(() => expect(vi.mocked(applyCapabilityConfiguration)).toHaveBeenCalled());
    expect(onNovelUpdated).toHaveBeenCalledWith(expect.objectContaining({
      id: 'novel-1',
      projectPreferenceProfile: expect.objectContaining({ capabilityProfile: expect.any(Object) }),
    }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('world', { capabilityApplied: true, targetFocus: 'workspace-world' }));
  }, 15_000);

  test('applies staged package configuration directly from the package dialog', async () => {
    const onNavigate = vi.fn();
    const onNovelUpdated = vi.fn();
    render(<SkillsStudioView selectedNovel={novel} onNavigate={onNavigate} onNovelUpdated={onNovelUpdated} />);
    await openPackages();

    const humanizationPackage = screen.getByText('基础去 AI 腔增强包').closest('div.rounded-xl') as HTMLElement;
    fireEvent.click(within(humanizationPackage).getByRole('button', { name: '展开并选择' }));
    const humanizationDialog = await screen.findByRole('dialog', { name: '基础去 AI 腔增强包' });
    const humanizationCheckboxes = within(humanizationDialog).getAllByRole('checkbox');
    fireEvent.click(humanizationCheckboxes[0]);
    await waitFor(() => expect((humanizationCheckboxes[0] as HTMLInputElement).checked).toBe(true));
    fireEvent.click(within(humanizationDialog).getByRole('button', { name: '加入本次配置候选' }));
    expect(await within(humanizationDialog).findByText('下一步：应用配置后写入本章规则')).toBeTruthy();
    expect(within(humanizationDialog).getByText('应用配置后，主卡与辅卡影响作品后续正文；常用技法作为作品偏好；本章使用规则只影响当前章；系统护栏参与生成与审稿检查。')).toBeTruthy();

    fireEvent.click(within(humanizationDialog).getByRole('button', { name: '应用所选配置并返回写作' }));
    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    await waitFor(() => expect(vi.mocked(applyCapabilityConfiguration)).toHaveBeenCalled());
    expect(onNovelUpdated).toHaveBeenCalledWith(expect.objectContaining({
      id: 'novel-1',
      projectPreferenceProfile: expect.objectContaining({ capabilityProfile: expect.any(Object) }),
    }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('workspace', { capabilityApplied: true }));
  }, 15_000);

  test('puts a package deconstruction card into an empty project deck before returning to writing', async () => {
    const onNavigate = vi.fn();
    const onNovelUpdated = vi.fn();
    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    vi.mocked(applyCapabilityConfiguration).mockImplementationOnce(async (_novelId, _databaseGeneration, _previewToken, profile) => ({
      profile,
      databaseGeneration: 8,
    }));
    render(<SkillsStudioView selectedNovel={novel} onNavigate={onNavigate} onNovelUpdated={onNovelUpdated} />);
    await openPackages();

    const deckPackage = screen.getByText('跨章连贯性增强包').closest('div.rounded-xl') as HTMLElement;
    fireEvent.click(within(deckPackage).getByRole('button', { name: '展开并选择' }));
    const deckDialog = await screen.findByRole('dialog', { name: '跨章连贯性增强包' });
    expect(within(deckDialog).getAllByText('卡组位置：先选主卡或辅卡，应用配置后写入作品卡组。').length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(within(deckDialog).getAllByRole('button', { name: '保存到我的能力，并勾选待提交' })[0]);
    });
    await waitFor(() => expect((within(deckDialog).getByRole('checkbox', { name: '选择 神作黄金高爽节奏与钩子拆书卡' }) as HTMLInputElement).checked).toBe(true));
    fireEvent.click(within(deckDialog).getByRole('button', { name: '加入本次配置候选' }));

    expect(await within(deckDialog).findByText('下一步：应用配置后写入作品卡组')).toBeTruthy();
    expect(within(deckDialog).queryByRole('button', { name: '设为主卡' })).toBeNull();
    const deckSummary = screen.getByText('作品卡组').closest('div.rounded-2xl') as HTMLElement;
    expect(within(deckSummary).getByText('主卡：')).toBeTruthy();
    expect(within(deckSummary).getByText(/神作黄金高爽节奏与钩子拆书卡/)).toBeTruthy();
    fireEvent.click(within(deckDialog).getByRole('button', { name: '应用所选配置并返回写作' }));

    await waitFor(() => expect(vi.mocked(applyCapabilityConfiguration)).toHaveBeenCalled());
    expect(vi.mocked(applyCapabilityConfiguration).mock.calls.at(-1)?.[3].projectSkillDeck.mainCardId).toBe('persisted-skill-1');
    expect(onNovelUpdated).toHaveBeenCalledWith(expect.objectContaining({
      id: 'novel-1',
      projectPreferenceProfile: expect.objectContaining({
        capabilityProfile: expect.objectContaining({
          projectSkillDeck: expect.objectContaining({ mainCardId: 'persisted-skill-1' }),
        }),
      }),
    }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('workspace', { capabilityApplied: true }));
  }, 15_000);

  test('syncs migrated capability configuration back to the selected work', async () => {
    const onNovelUpdated = vi.fn();
    const legacyNovel = {
      ...novel,
      projectPreferenceProfile: {
        tags: [],
        weights: { styleWeight: 0.5, characterWeight: 0.5, worldWeight: 0.5, plotWeight: 0.5, pacingWeight: 0.5 },
        acceptedDimensions: [],
        rejectedDimensions: [],
        notes: [],
        evidenceCount: 0,
        mountedSkillIds: ['legacy-skill'],
      },
    };
    const { listNovels } = await import('../lib/novel-client');
    vi.mocked(listNovels).mockResolvedValueOnce([legacyNovel]);
    render(<SkillsStudioView selectedNovel={legacyNovel} onNovelUpdated={onNovelUpdated} />);

    const previewButton = await screen.findByRole('button', { name: '查看整理入口' });
    const { previewCapabilityMigration, applyCapabilityMigration } = await import('../lib/capability-migration-client');
    await act(async () => {
      fireEvent.click(previewButton);
    });
    await waitFor(() => expect(vi.mocked(previewCapabilityMigration)).toHaveBeenCalledWith('novel-1', 7));
    const migrationDialog = await screen.findByRole('dialog', { name: '能力迁移预览' });
    fireEvent.click(within(migrationDialog).getByRole('button', { name: '确认迁移' }));

    await waitFor(() => expect(vi.mocked(applyCapabilityMigration)).toHaveBeenCalledWith('novel-1', 7, 'migration-preview-1'));
    expect(onNovelUpdated).toHaveBeenCalledWith(expect.objectContaining({
      id: 'novel-1',
      projectPreferenceProfile: expect.objectContaining({
        capabilityProfile: expect.objectContaining({
          projectSkillDeck: expect.objectContaining({ mainCardId: 'migrated-main' }),
        }),
      }),
    }));
  }, 15_000);

  test('explains unavailable and import-gated package components', async () => {
    render(<SkillsStudioView selectedNovel={novel} />);
    await openPackages();

    const unavailablePackage = screen.getByText('爆款平台诊断包').closest('div.rounded-xl');
    expect(unavailablePackage).not.toBeNull();
    fireEvent.click(within(unavailablePackage as HTMLElement).getByRole('button', { name: '展开并选择' }));
    const unavailableDialog = await screen.findByRole('dialog', { name: '爆款平台诊断包' });
    expect(within(unavailableDialog).getAllByText(/当前能力暂不可运行/).length).toBeGreaterThan(0);

    fireEvent.click(within(unavailableDialog).getByRole('button', { name: '关闭能力包' }));
    const importPackage = screen.getByText('高级审稿与局部手术包').closest('div.rounded-xl');
    expect(importPackage).not.toBeNull();
    fireEvent.click(within(importPackage as HTMLElement).getByRole('button', { name: '展开并选择' }));
    const importDialog = await screen.findByRole('dialog', { name: '高级审稿与局部手术包' });
    expect(within(importDialog).getAllByText(/先保存到我的能力，再勾选待提交/).length).toBeGreaterThan(0);
    expect(within(importDialog).getByRole('button', { name: '保存到我的能力，并勾选待提交' })).toBeTruthy();
    expect(within(importDialog).queryByText(/加入后可勾选|加入后再提交|加入并选中/)).toBeNull();
  }, 15_000);

  test('keeps package submission disabled without a selected work and routes to the library', async () => {
    const onNavigate = vi.fn();
    render(<SkillsStudioView selectedNovel={null} onNavigate={onNavigate} />);
    await openPackages();
    const auditPackage = screen.getByText('基础审稿增强包').closest('div.rounded-xl');
    expect(auditPackage).not.toBeNull();
    fireEvent.click(within(auditPackage as HTMLElement).getByRole('button', { name: '展开并选择' }));

    const dialog = await screen.findByRole('dialog', { name: '基础审稿增强包' });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    const submit = within(dialog).getByRole('button', { name: '加入本次配置候选' });
    expect(submit.hasAttribute('disabled')).toBe(true);
    expect(within(dialog).getByText('请先在书库选择作品后再加入本次配置候选')).toBeTruthy();
    expect(submit.getAttribute('aria-describedby')).toBe('capability-package-submit-help');
    expect(submit.getAttribute('title')).toBe('请先在书库选择作品后再加入本次配置候选');

    fireEvent.click(within(dialog).getByRole('button', { name: '去书库选择作品' }));
    expect(onNavigate).toHaveBeenCalledWith('library');
    expect(screen.queryByRole('dialog', { name: '基础审稿增强包' })).toBeNull();
    expect(vi.mocked((await import('../lib/capability-configuration-client')).applyCapabilityConfiguration)).not.toHaveBeenCalled();

    await openPackages();
    const paidPackage = screen.getByText('跨章连贯性增强包').closest('div.rounded-xl');
    expect(paidPackage).not.toBeNull();
    fireEvent.click(within(paidPackage as HTMLElement).getByRole('button', { name: '展开并选择' }));
    const paidDialog = await screen.findByRole('dialog', { name: '跨章连贯性增强包' });
    expect(within(paidDialog).getByRole('button', { name: '加入本次配置候选' }).hasAttribute('disabled')).toBe(true);
  }, 15_000);

  test('keeps package selections visible while switching unopened packages', async () => {
    render(<SkillsStudioView selectedNovel={novel} />);
    await openPackages();
    const basicCard = screen.getByText('基础审稿增强包').closest('div.rounded-xl') as HTMLElement;
    fireEvent.click(within(basicCard).getByRole('button', { name: '展开并选择' }));
    const basicDialog = await screen.findByRole('dialog', { name: '基础审稿增强包' });
    fireEvent.click(within(basicDialog).getByRole('checkbox'));
    expect(within(basicDialog).getByText('已勾选 1 项，待提交')).toBeTruthy();
    fireEvent.click(within(basicDialog).getByRole('button', { name: '关闭能力包' }));
    expect(within(basicCard).getByText('已勾选 1 项，待提交')).toBeTruthy();

    const humanizationCard = screen.getByText('基础去 AI 腔增强包').closest('div.rounded-xl') as HTMLElement;
    fireEvent.click(within(humanizationCard).getByRole('button', { name: '展开并选择' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: '基础去 AI 腔增强包' })).getByRole('button', { name: '关闭能力包' }));
    fireEvent.click(within(basicCard).getByRole('button', { name: '展开并选择' }));
    expect((within(await screen.findByRole('dialog', { name: '基础审稿增强包' })).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  }, 15_000);

  test('keeps configuration drafts isolated when switching works', async () => {
    const secondNovel = { ...novel, id: 'novel-2', title: '第二部作品' };
    const profile = {
      version: 3 as const,
      projectSkillDeck: { mainCardId: undefined, supportCardIds: [], updatedAt: 1 },
      favoriteTechniqueIds: [],
    };
    saveCapabilityConfigurationSession({
      version: 1, novelId: 'novel-1', databaseGeneration: 6, baselineToken: getCapabilityConfigurationBaselineToken(profile),
      configurationDraft: profile, candidateCardIds: ['candidate-card'], pendingCandidateId: null,
      activeTab: 'mySkills', selectedCapability: 'skill-card', selectedCategory: 'all', selectedAssetId: null, scrollTop: 0, updatedAt: 1,
    });
    saveCapabilityConfigurationSession({
      version: 1, novelId: 'novel-2', databaseGeneration: 6, baselineToken: getCapabilityConfigurationBaselineToken(profile),
      configurationDraft: profile, candidateCardIds: ['candidate-card-2'], pendingCandidateId: null,
      activeTab: 'mySkills', selectedCapability: 'skill-card', selectedCategory: 'all', selectedAssetId: null, scrollTop: 0, updatedAt: 1,
    });

    const view = render(<SkillsStudioView selectedNovel={novel} />);
    expect(await screen.findByText('candidate-card')).toBeTruthy();
    view.rerender(<SkillsStudioView selectedNovel={secondNovel} />);
    expect(await screen.findByText('candidate-card-2')).toBeTruthy();
    expect(screen.queryByText('candidate-card')).toBeNull();
  });

  test('clears stale draft, candidate and store filters when switching to a work without a session', async () => {
    const secondNovel = { ...novel, id: 'novel-2', title: '第二部作品' };
    const profile = {
      version: 3 as const,
      projectSkillDeck: { mainCardId: undefined, supportCardIds: [], updatedAt: 1 },
      favoriteTechniqueIds: [],
    };
    saveCapabilityConfigurationSession({
      version: 1,
      novelId: 'novel-1',
      databaseGeneration: 7,
      baselineToken: getCapabilityConfigurationBaselineToken(profile),
      configurationDraft: profile,
      candidateCardIds: ['candidate-card'],
      pendingCandidateId: null,
      activeTab: 'plaza',
      selectedCapability: 'technique',
      selectedCategory: 'active-drafting',
      selectedAssetId: 'opening-gold-three',
      scrollTop: 0,
      updatedAt: 1,
    });

    const view = render(<SkillsStudioView selectedNovel={novel} />);
    expect(await screen.findByText('candidate-card')).toBeTruthy();

    view.rerender(<SkillsStudioView selectedNovel={secondNovel} />);

    await waitFor(() => expect(screen.queryByText('candidate-card')).toBeNull());
    expect(screen.getByText('你还没有保存能力卡')).toBeTruthy();
    expect(screen.getByText('这里还没有可配置到作品的专属 AI 写作能力。先生成或挑选能力卡，再选择卡组位置或应用配置；使用范围会在卡片上标明。')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '黄金三章核心冲突大纲展开器' })).toBeNull();
  });

});
