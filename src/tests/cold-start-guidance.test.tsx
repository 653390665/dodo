import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { SkillsStudioView } from '../components/SkillsStudioView';
import { useSkillsShelfStore } from '../stores/skills-shelf-store';
import type { ProjectCapabilityProfile } from '../../shared/types';

vi.mock('../lib/toast', () => ({ toast: vi.fn() }));

const novelClientMock = vi.hoisted(() => ({
  listNovels: vi.fn(),
}));

vi.mock('../lib/skill-client', () => ({
  syncSkillFeedbackScores: vi.fn().mockResolvedValue([]),
  deleteSkill: vi.fn(),
  createSkill: vi.fn(),
}));

vi.mock('../lib/novel-client', () => ({
  listNovels: novelClientMock.listNovels,
  updateNovel: vi.fn().mockResolvedValue(true),
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
  CapabilityMigrationError: class CapabilityMigrationError extends Error {},
  previewCapabilityMigration: vi.fn(),
  applyCapabilityMigration: vi.fn(),
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
};

async function settleStudio() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

describe('Plan 235 冷启动导购前置', () => {
  beforeEach(() => {
    useSkillsShelfStore.setState({ savedSkills: [] });
    novelClientMock.listNovels.mockReset().mockResolvedValue([]);
  });

  test('无作品时概览展示保底配置预览与零收藏能力地图指引', async () => {
    render(<SkillsStudioView selectedNovel={undefined} />);
    await settleStudio();

    const guide = screen.getByTestId('cold-start-guide');
    expect(guide.textContent).toContain('保底配置预览');
    expect(guide.textContent).toContain('去 AI 味规则卡');
    expect(guide.textContent).toContain('选择作品');

    const mapPreview = screen.getByTestId('skill-map-preview');
    expect(mapPreview.textContent).toContain('能力地图');
    expect(mapPreview.textContent).toContain('这章要解决什么');
  });

  test('有作品时不显示无作品导购卡；零收藏地图指引仍可见', async () => {
    render(<SkillsStudioView selectedNovel={novel} />);
    await settleStudio();

    expect(screen.queryByTestId('cold-start-guide')).toBeNull();
    expect(screen.getByTestId('skill-map-preview')).toBeTruthy();
  });
});
