import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProjectCapabilityProfile } from '../../shared/types';

import { SkillsStudioView } from '../components/SkillsStudioView';

vi.mock('../lib/toast', () => ({ toast: vi.fn() }));

vi.mock('../lib/skill-client', () => ({
  deleteSkill: vi.fn().mockResolvedValue(true),
  syncSkillFeedbackScores: vi.fn().mockResolvedValue([]),
  createSkill: vi.fn(),
}));

vi.mock('../lib/novel-client', () => ({
  listNovels: vi.fn().mockResolvedValue([]),
  updateNovel: vi.fn().mockResolvedValue(true),
}));

vi.mock('../lib/db-transport', () => ({
  subscribeToChanges: vi.fn(() => () => undefined),
  getDatabaseGenerationSnapshot: vi.fn().mockResolvedValue(7),
}));

vi.mock('../lib/capability-configuration-client', () => ({
  previewCapabilityConfiguration: vi
    .fn()
    .mockResolvedValue({ previewToken: 'preview-1', databaseGeneration: 7, warnings: [] }),
  applyCapabilityConfiguration: vi.fn().mockImplementation(
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
}));

vi.mock('../lib/product-events-client', () => ({
  recordCapabilityEvent: vi.fn().mockResolvedValue(undefined),
  createProductEventSessionId: vi.fn((scope = 'session') => `${scope}:test-session`),
  createProductEventId: vi.fn((action: string) => `event:${action}`),
  recordProductEvent: vi.fn().mockResolvedValue(undefined),
}));

const novel = {
  id: 'novel-starter',
  title: '作品',
  authorId: 'local',
  summary: '',
  status: 'ongoing' as const,
  createdAt: 1,
  updatedAt: 1,
};

function renderStudio() {
  return render(<SkillsStudioView selectedNovel={novel} />);
}

async function settleStudio() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

describe('Plan 230 新用户保底配置', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  test('零配置作品显示保底配置导购并可一键套用', async () => {
    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    renderStudio();
    expect(
      await screen.findByTestId('starter-config-card')
    ).toBeTruthy();

    await settleStudio();
    await act(async () => {
      fireEvent.click(screen.getByTestId('apply-starter-config'));
    });

    await waitFor(() =>
      expect(vi.mocked(applyCapabilityConfiguration)).toHaveBeenCalled()
    );
    const appliedProfile = vi.mocked(applyCapabilityConfiguration).mock.calls.at(-1)?.[3];
    expect(appliedProfile?.favoriteTechniqueIds).toContain('de-ai-tells-guard');
    expect(appliedProfile?.activeFlowId).toBe('xiaofeiji-novel-flow');
  });

  test('已有收藏的作品不显示保底导购', async () => {
    const configuredNovel = {
      ...novel,
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
        capabilityProfile: {
          version: 3 as const,
          projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
          favoriteTechniqueIds: ['some-technique'],
        },
      },
    };
    render(<SkillsStudioView selectedNovel={configuredNovel} />);
    await settleStudio();
    expect(screen.queryByTestId('starter-config-card')).toBeNull();
  });
});
