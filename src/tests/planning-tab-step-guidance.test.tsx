/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 批次 B「空壳链路清账」前端可见提示：PlanningTab（当前步）+ SkillsStudioView（链路详情逐步）。
 */
import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PlanningTab } from '../components/book-factory/PlanningTab';
import { SkillsStudioView } from '../components/SkillsStudioView';
import { GUIDANCE_ONLY_HINT, GUIDANCE_ONLY_LABEL } from '../../shared/lib/flow-step-guidance';
import { SKILL_SERIES_FLOWS } from '../../shared/lib/public-skill-catalog';

vi.mock('../components/ui/app-confirm', () => ({
  appConfirm: vi.fn(async () => true),
  appPrompt: vi.fn(async () => ''),
}));

vi.mock('../lib/toast', () => ({ toast: vi.fn() }));

const novelClientMock = vi.hoisted(() => ({ listNovels: vi.fn() }));

vi.mock('../lib/novel-client', () => ({
  listNovels: novelClientMock.listNovels,
  updateNovel: vi.fn().mockResolvedValue(true),
}));

vi.mock('../lib/skill-client', () => ({
  syncSkillFeedbackScores: vi.fn().mockResolvedValue([]),
  deleteSkill: vi.fn(),
  createSkill: vi.fn(),
}));

vi.mock('../lib/db-transport', () => ({
  subscribeToChanges: vi.fn(() => () => undefined),
  getDatabaseGenerationSnapshot: vi.fn().mockResolvedValue(7),
}));

vi.mock('../lib/capability-configuration-client', () => ({
  previewCapabilityConfiguration: vi.fn().mockResolvedValue({ previewToken: 'preview-1', databaseGeneration: 7 }),
  applyCapabilityConfiguration: vi.fn().mockImplementation(async (_n: unknown, _g: unknown, _t: unknown, profile: unknown) => ({
    profile,
    databaseGeneration: 8,
  })),
}));

vi.mock('../lib/capability-migration-client', () => ({
  previewCapabilityMigration: vi.fn(),
  applyCapabilityMigration: vi.fn(),
  CapabilityMigrationError: class CapabilityMigrationError extends Error {},
}));

vi.mock('../lib/product-events-client', () => ({
  createProductEventSessionId: vi.fn((scope = 'session') => `${scope}:test-session`),
  createProductEventId: vi.fn((action: string, sessionId = 'session:test-session') => `event:${sessionId}:${action}`),
  recordProductEvent: vi.fn().mockResolvedValue(undefined),
}));

const TIANMA_STEP1 = 'current-step:tianma-outline-flow:tianma-outline-flow-step1';
const GENERIC_STEP5 = 'current-step:generic-novel-flow:generic-novel-flow-step5';

function flowById(id: string) {
  const flow = SKILL_SERIES_FLOWS.find((candidate) => candidate.id === id);
  if (!flow) throw new Error(`missing flow ${id}`);
  return flow;
}

function flowStepName(flowId: string, stepId: string) {
  const step = flowById(flowId).steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`missing step ${stepId}`);
  return step.name;
}

async function openFlowDetail(flowId: string) {
  fireEvent.click(screen.getByRole('button', { name: '能力商店' }));
  const flowName = flowById(flowId).name;
  const card = await waitFor(() => {
    const matched = screen
      .getAllByText(flowName)
      .map((node) => node.closest('div.relative'))
      .find(
        (candidate) =>
          candidate instanceof HTMLElement &&
          within(candidate).queryAllByText('免密预览流程详情').length === 1
      );
    if (!matched) throw new Error(`flow card not rendered: ${flowName}`);
    return matched as HTMLElement;
  });
  fireEvent.click(within(card).getByText('免密预览流程详情'));
  await screen.findByText(flowById(flowId).steps[0].name, {}, { timeout: 3000 });
}

function buildNovel(tags: string[], id = 'novel-guidance') {
  return {
    id,
    title: '仅引导测试',
    authorId: 'local',
    summary: '',
    status: 'ongoing' as const,
    createdAt: 1,
    updatedAt: 1,
    projectPreferenceProfile: {
      tags,
      weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
      capabilityModelVersion: 3 as const,
      capabilityProfile: {
        version: 3 as const,
        activeFlowId: tags[0]?.split(':')[1] ?? 'generic-novel-flow',
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
      },
    },
  };
}

const mockCurrentChapter = {
  id: 'ch-1',
  novelId: 'novel-guidance',
  title: '第一章',
  content: '',
  sceneBeats: '',
  wordCount: 0,
  order: 1,
  createdAt: 0,
  updatedAt: 0,
} as any;

function baseProps(novel: any) {
  return {
    renderContextReceipt: () => <div data-testid="context-receipt" />,
    currentChapter: mockCurrentChapter,
    onGenerateBeats: vi.fn().mockResolvedValue(undefined),
    isGeneratingBeats: false,
    onGenerateContent: vi.fn().mockResolvedValue(undefined),
    isGeneratingContent: false,
    onRewriteSelectedText: vi.fn().mockResolvedValue(undefined),
    onUpdateChapterBeats: vi.fn(),
    novel,
    stepEvidence: {},
  };
}

describe('PlanningTab 仅引导步骤可见提示', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('仅引导步骤：显示「仅引导」标签与解释文案', () => {
    render(<PlanningTab {...baseProps(buildNovel([TIANMA_STEP1]))} />);

    expect(
      screen.getByText(flowStepName('tianma-outline-flow', 'tianma-outline-flow-step1'))
    ).toBeTruthy();
    expect(screen.getAllByText(GUIDANCE_ONLY_LABEL).length).toBeGreaterThan(0);
    expect(screen.getAllByText(GUIDANCE_ONLY_HINT).length).toBeGreaterThan(0);
  });

  test('可运行资产步骤：不显示「仅引导」提示', () => {
    render(<PlanningTab {...baseProps(buildNovel([GENERIC_STEP5]))} />);

    expect(
      screen.getByText(flowStepName('generic-novel-flow', 'generic-novel-flow-step5'))
    ).toBeTruthy();
    expect(screen.queryByText(GUIDANCE_ONLY_HINT)).toBeNull();
  });
});

describe('SkillsStudioView 链路详情仅引导标注', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    novelClientMock.listNovels.mockReset().mockResolvedValue([buildNovel([], 'novel-1')]);
    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    vi.mocked(applyCapabilityConfiguration).mockClear();
  });

  test('天马链路详情：4 个壳步骤全部带「仅引导」徽标', async () => {
    render(<SkillsStudioView selectedNovel={buildNovel([], 'novel-1') as any} />);
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    await openFlowDetail('tianma-outline-flow');

    const tianmaSteps = flowById('tianma-outline-flow').steps;
    expect(tianmaSteps.filter((step) => step.guidanceOnly === true).length).toBe(4);
    expect(screen.getAllByText(GUIDANCE_ONLY_LABEL).length).toBe(4);
  });

  test('通用链路详情：无「仅引导」徽标', async () => {
    render(<SkillsStudioView selectedNovel={buildNovel([], 'novel-1') as any} />);
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    await openFlowDetail('generic-novel-flow');
    expect(screen.queryByText(GUIDANCE_ONLY_LABEL)).toBeNull();
  });

  test('小飞鸡链路详情：2 个壳步骤带「仅引导」徽标', async () => {
    render(<SkillsStudioView selectedNovel={buildNovel([], 'novel-1') as any} />);
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    await openFlowDetail('xiaofeiji-novel-flow');
    expect(screen.getAllByText(GUIDANCE_ONLY_LABEL).length).toBe(2);
  });
});
