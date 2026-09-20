import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SkillsStudioView } from '../components/SkillsStudioView';
import type { Novel, ProjectCapabilityProfile } from '../../shared/types';

// Plan 256：已生效配置总览——占格卡组 / 不占格技法 / 护栏三段按工位分组渲染。
// mock toast：真实 toast 的定时器会在测试结束后触发 act 环境外更新（同 Plan 209）。
vi.mock('../lib/toast', () => ({ toast: vi.fn() }));

vi.mock('../lib/skill-client', () => ({
  syncSkillFeedbackScores: vi.fn().mockResolvedValue([]),
  deleteSkill: vi.fn(),
  createSkill: vi.fn(),
}));
vi.mock('../lib/novel-client', () => ({ listNovels: vi.fn().mockResolvedValue([]) }));
vi.mock('../components/skills/SkillCard', () => ({
  SkillCard: ({ skill }: { skill: { name: string } }) => <div>{skill.name}</div>,
}));
vi.mock('../lib/db-transport', () => ({
  subscribeToChanges: vi.fn(() => () => undefined),
  getDatabaseGenerationSnapshot: vi.fn().mockResolvedValue(7),
}));
vi.mock('../lib/product-events-client', () => ({
  createProductEventSessionId: vi.fn((scope = 'session') => `${scope}:test-session`),
  createProductEventId: vi.fn(
    (action: string, sessionId = 'session:test-session') => `event:${sessionId}:${action}`
  ),
  recordProductEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/capability-configuration-client', () => ({
  previewCapabilityConfiguration: vi
    .fn()
    .mockResolvedValue({ previewToken: 'p', databaseGeneration: 7 }),
  applyCapabilityConfiguration: vi.fn().mockResolvedValue({
    profile: {
      version: 3,
      projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
      favoriteTechniqueIds: [],
    },
    databaseGeneration: 8,
  }),
}));

function novelWithProfile(capabilityProfile: ProjectCapabilityProfile): Novel {
  return {
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
        styleWeight: 0.5,
        characterWeight: 0.5,
        worldWeight: 0.5,
        plotWeight: 0.5,
        pacingWeight: 0.5,
      },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
      capabilityModelVersion: 3 as const,
      capabilityProfile,
    },
  };
}

describe('Plan 256 已生效配置总览', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  test('renders deck, technique and guardrail sections grouped by station', async () => {
    const novel = novelWithProfile({
      version: 3,
      projectSkillDeck: {
        mainCardId: 'deconstruct-golden-climax',
        supportCardIds: ['deconstruct-suspense-hook'],
        updatedAt: 1,
      },
      favoriteTechniqueIds: [],
      projectTechniqueIds: ['prose-mouth-flavor'],
    });
    render(<SkillsStudioView selectedNovel={novel} />);

    expect(await screen.findByText('已生效能力总览')).toBeTruthy();
    // 三段标题带容量语义标注。
    expect(screen.getByText('拆书卡组 2 张（占卡组格）')).toBeTruthy();
    expect(screen.getByText('作品默认技法 1 张（不占格 · 无上限）')).toBeTruthy();
    expect(screen.getByText('护栏（默认自动生效）')).toBeTruthy();
    // 卡组段按工位分组并解析出目录卡名（黄金三章卡 → 拆书工位）。
    expect(screen.getByText('神作黄金高爽节奏与钩子拆书卡')).toBeTruthy();
    expect(screen.getByText('神作高潮段落悬念精细拆解卡')).toBeTruthy();
    // 技法段解析出目录技法名（正文器 → 正文工位）。
    expect(screen.getByText('超强口语化推进剧情正文器')).toBeTruthy();
    // 护栏段给出计数引用（默认护栏数量由目录推导，不硬编码）。
    expect(screen.getByText(/默认 \d+ 条自动生效/)).toBeTruthy();
  });

  test('shows shelf guidance when nothing is configured', async () => {
    const novel = novelWithProfile({
      version: 3,
      projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
      favoriteTechniqueIds: [],
      projectTechniqueIds: [],
    });
    render(<SkillsStudioView selectedNovel={novel} />);

    expect(await screen.findByText('已生效能力总览')).toBeTruthy();
    expect(screen.getByText('从能力商店选用卡组或技法')).toBeTruthy();
    expect(screen.queryByText(/拆书卡组 .* 张（占卡组格）/)).toBeNull();
  });

  test('keeps deck slot summary at the expanded capacity', async () => {
    const novel = novelWithProfile({
      version: 3,
      projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
      favoriteTechniqueIds: [],
      projectTechniqueIds: [],
    });
    render(<SkillsStudioView selectedNovel={novel} />);

    expect(await screen.findByText('可添加 1 张主卡、4 张辅卡')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^能力商店$/ }));
    // 空卡组计数显示 0 / 5（1 主 + 4 辅）。
    expect(await screen.findByText('0 / 5')).toBeTruthy();
  });
});
