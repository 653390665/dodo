// Plan 260：技法优先度——已生效总览的角色徽标与「设为基调/上移/下移」装配控件。
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SkillsStudioView } from '../components/SkillsStudioView';
import type { ProjectCapabilityProfile } from '../../shared/types';

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
  previewCapabilityConfiguration: vi
    .fn()
    .mockResolvedValue({ previewToken: 'preview-1', databaseGeneration: 7 }),
  applyCapabilityConfiguration: vi
    .fn()
    .mockImplementation(
      async (
        _novelId: unknown,
        _gen: unknown,
        _token: unknown,
        profile: ProjectCapabilityProfile
      ) => ({ profile, databaseGeneration: 8 })
    ),
}));

vi.mock('../lib/capability-migration-client', () => ({
  previewCapabilityMigration: vi.fn(),
  applyCapabilityMigration: vi.fn(),
  CapabilityMigrationError: class CapabilityMigrationError extends Error {},
}));

vi.mock('../lib/product-events-client', () => ({
  createProductEventSessionId: vi.fn((scope = 'session') => `${scope}:test-session`),
  createProductEventId: vi.fn(
    (action: string, sessionId = 'session:test-session') => `event:${sessionId}:${action}`
  ),
  recordProductEvent: vi.fn().mockResolvedValue(undefined),
}));

const novel = {
  id: 'novel-1',
  title: '作品',
  authorId: 'local',
  summary: '',
  status: 'ongoing' as const,
  createdAt: 1,
  updatedAt: 1,
  projectPreferenceProfile: {
    tags: [],
    weights: {
      styleWeight: 1,
      characterWeight: 1,
      worldWeight: 1,
      plotWeight: 1,
      pacingWeight: 1,
    },
    acceptedDimensions: [],
    rejectedDimensions: [],
    notes: [],
    evidenceCount: 0,
    capabilityModelVersion: 3 as const,
    capabilityProfile: {
      version: 3 as const,
      projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
      favoriteTechniqueIds: [],
      projectTechniqueIds: ['prose-mouth-flavor', 'opening-gold-three', 'prose-action-booster'],
      techniquePriorities: [{ id: 'prose-mouth-flavor', role: 'base' as const, order: 0 }],
    },
  },
};

async function settleStudio() {
  // 与既有 skills-studio 测试同款：等水合 effect 跑完再断言/点击。
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function rowOf(title: string): HTMLElement {
  const row = screen.getByText(title).closest('li');
  expect(row).toBeTruthy();
  return row as HTMLElement;
}

describe('Plan 260 technique assembly priority', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    novelClientMock.listNovels.mockReset().mockResolvedValue([novel]);
    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    vi.mocked(applyCapabilityConfiguration).mockClear();
  });

  test('renders role badges and per-card assembly controls in the overview', async () => {
    render(<SkillsStudioView selectedNovel={novel} />);
    await screen.findByText('已生效能力总览');
    await settleStudio();

    const baseRow = rowOf('超强口语化推进剧情正文器');
    expect(within(baseRow).getByText('基调')).toBeTruthy();
    expect(within(baseRow).getByRole('button', { name: '设为基调' })).toBeTruthy();
    const outlineRow = rowOf('黄金三章核心冲突大纲展开器');
    expect(within(outlineRow).getByText('强化')).toBeTruthy();
    const proseRow = rowOf('场景肢体动作与画面张力正文器');
    expect(within(proseRow).getByText('强化')).toBeTruthy();

    // 展示序 = 装备顺序；未标注卡按强化语义呈现。
    expect(within(baseRow).getByText('1.')).toBeTruthy();
    expect(within(outlineRow).getByText('2.')).toBeTruthy();
    expect(within(proseRow).getByText('3.')).toBeTruthy();
    // 首卡不可上移、末卡不可下移。
    expect(
      (within(baseRow).getByRole('button', { name: '上移' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (within(proseRow).getByRole('button', { name: '下移' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  test('sets a technique as base, demotes the previous base and applies immediately', async () => {
    render(<SkillsStudioView selectedNovel={novel} />);
    await screen.findByText('已生效能力总览');
    await settleStudio();

    fireEvent.click(
      within(rowOf('场景肢体动作与画面张力正文器')).getByRole('button', { name: '设为基调' })
    );

    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    await waitFor(() => expect(vi.mocked(applyCapabilityConfiguration)).toHaveBeenCalled());
    const appliedProfile = vi
      .mocked(applyCapabilityConfiguration)
      .mock.calls.at(-1)![3] as ProjectCapabilityProfile;
    // 基调卡排首位；原基调卡降级为强化，order 归整为数组下标。
    expect(appliedProfile.projectTechniqueIds).toEqual([
      'prose-action-booster',
      'prose-mouth-flavor',
      'opening-gold-three',
    ]);
    expect(appliedProfile.techniquePriorities).toEqual([
      { id: 'prose-action-booster', role: 'base', order: 0 },
      { id: 'prose-mouth-flavor', role: 'accent', order: 1 },
      { id: 'opening-gold-three', role: 'accent', order: 2 },
    ]);
    // 应用后 UI 回灌：场景动作卡升至第 1 位并显示基调徽标。
    const movedRow = rowOf('场景肢体动作与画面张力正文器');
    expect(within(movedRow).getByText('1.')).toBeTruthy();
    expect(within(movedRow).getByText('基调')).toBeTruthy();
  });

  test('moves a technique up and normalizes orders to array indices', async () => {
    render(<SkillsStudioView selectedNovel={novel} />);
    await screen.findByText('已生效能力总览');
    await settleStudio();

    fireEvent.click(
      within(rowOf('黄金三章核心冲突大纲展开器')).getByRole('button', { name: '上移' })
    );

    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    await waitFor(() => expect(vi.mocked(applyCapabilityConfiguration)).toHaveBeenCalled());
    const appliedProfile = vi
      .mocked(applyCapabilityConfiguration)
      .mock.calls.at(-1)![3] as ProjectCapabilityProfile;
    // 上移只换位置，不改变角色（口语化卡保持基调）。
    expect(appliedProfile.projectTechniqueIds).toEqual([
      'opening-gold-three',
      'prose-mouth-flavor',
      'prose-action-booster',
    ]);
    expect(appliedProfile.techniquePriorities).toEqual([
      { id: 'opening-gold-three', role: 'accent', order: 0 },
      { id: 'prose-mouth-flavor', role: 'base', order: 1 },
      { id: 'prose-action-booster', role: 'accent', order: 2 },
    ]);
  });
});
