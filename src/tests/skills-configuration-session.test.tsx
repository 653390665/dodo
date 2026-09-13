import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SkillsStudioView } from '../components/SkillsStudioView';
import type { ProjectCapabilityProfile } from '../../shared/types';

vi.mock('../lib/toast', () => ({ toast: vi.fn() }));

const skillMock = vi.hoisted(() => ({ created: null as Record<string, unknown> | null }));
const novelClientMock = vi.hoisted(() => ({ listNovels: vi.fn() }));

vi.mock('../lib/skill-client', () => ({
  syncSkillFeedbackScores: vi
    .fn()
    .mockImplementation(async () => (skillMock.created ? [skillMock.created] : [])),
  deleteSkill: vi.fn(),
  createSkill: vi.fn().mockImplementation(async (skill) => {
    skillMock.created = { ...skill, id: 'persisted-skill-1' };
  }),
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

vi.mock('../lib/capability-migration-client', () => {
  class CapabilityMigrationError extends Error {
    constructor(
      public code: string,
      public status: number,
      message: string
    ) {
      super(message);
    }
  }
  return {
    CapabilityMigrationError,
    previewCapabilityMigration: vi.fn(),
    applyCapabilityMigration: vi.fn(),
  };
});

vi.mock('../lib/product-events-client', () => ({
  createProductEventSessionId: vi.fn((scope = 'session') => `${scope}:test-session`),
  createProductEventId: vi.fn(
    (action: string, sessionId = 'session:test-session') => `event:${sessionId}:${action}`
  ),
  recordProductEvent: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Plan 195 切片 A（Plan 203）：自应用豁免窗口与会话恢复水合的行为锁定。
 * 豁免窗口语义（selfAppliedContextRef + flagAge < 5000）已随配置会话簇下沉
 * skills-configuration-store 的 hydrateSession，本文件保证搬移后行为逐点不变。
 */
describe('Plan 203 capability configuration session', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    skillMock.created = null;
    localStorage.clear();
    sessionStorage.clear();
    const { applyCapabilityConfiguration, previewCapabilityConfiguration } =
      await import('../lib/capability-configuration-client');
    vi.mocked(previewCapabilityConfiguration)
      .mockReset()
      .mockResolvedValue({ previewToken: 'preview-1', databaseGeneration: 7 });
    vi.mocked(applyCapabilityConfiguration)
      .mockReset()
      .mockImplementation(
        async (
          _novelId: unknown,
          _gen: unknown,
          _token: unknown,
          profile: ProjectCapabilityProfile
        ) => ({ profile, databaseGeneration: 8 })
      );
    novelClientMock.listNovels.mockReset().mockResolvedValue([novel]);
  });

  async function openPackageDialog(name: string) {
    // SkillsStudio 的会话/代际水合在 effect 中完成，先让首轮 effect 结束。
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fireEvent.click(await screen.findByRole('button', { name: /^能力商店$/ }));
    await waitFor(() => expect(screen.getByRole('tab', { name: /能力包/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: /能力包/ }));
    const pkgCard = screen.getByText(name).closest('div.rounded-xl') as HTMLElement;
    fireEvent.click(within(pkgCard).getByRole('button', { name: '展开并选择' }));
    return screen.findByRole('dialog', { name });
  }

  test('自应用后 5s 窗口内的上下文漂移被豁免：应用配置后能力包弹窗不被外部漂移重置', async () => {
    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    render(<SkillsStudioView selectedNovel={novel} />);
    const dialog = await openPackageDialog('基础去 AI 腔增强包');

    // 勾选写前规则并提交：单动词启用即应用，应用会移动 baseline（上下文漂移）。
    fireEvent.click(within(dialog).getAllByRole('checkbox')[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: '启用所选' }));
    await waitFor(() => expect(vi.mocked(applyCapabilityConfiguration)).toHaveBeenCalled());

    // 豁免窗口：自家 apply 造成的上下文变化只重锚会话，不按外部漂移重置
    // （外部漂移路径会清空 packageSelections/selectedPackageId 并关闭弹窗）。
    const refreshedDialog = screen.getByRole('dialog', { name: '基础去 AI 腔增强包' });
    expect(refreshedDialog).toBeTruthy();
    expect(await within(refreshedDialog).findByText('下一步：应用配置后写入本章规则')).toBeTruthy();
  });
});
