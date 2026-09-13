import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SkillsStudioView } from '../components/SkillsStudioView';
import {
  computePackageSubmitDisabledReason,
  useSkillsPackageStore,
} from '../stores/skills-package-store';
import {
  getCapabilityConfigurationBaselineToken,
  saveCapabilityConfigurationSession,
} from '../lib/capability-configuration-session';
import { getProjectCapabilityProfile } from '../lib/skills-studio-governance';
import type { EnhancementPackageStep } from '../../shared/types/prompt-assets-governed';

vi.mock('../lib/toast', () => ({ toast: vi.fn() }));

const novelClientMock = vi.hoisted(() => ({ listNovels: vi.fn() }));

vi.mock('../lib/skill-client', () => ({
  syncSkillFeedbackScores: vi.fn().mockResolvedValue([]),
  deleteSkill: vi.fn(),
  createSkill: vi.fn(),
}));

const novel = {
  id: 'novel-1',
  title: '作品',
  authorId: 'local',
  summary: '',
  status: 'ongoing' as const,
  createdAt: 1,
  updatedAt: 1,
  projectPreferenceProfile: undefined,
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
    .mockImplementation(async (_novelId: unknown, _gen: unknown, _token: unknown) => ({
      profile: getProjectCapabilityProfile(novel),
      databaseGeneration: 8,
    })),
}));

vi.mock('../lib/capability-migration-client', () => ({
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

const seededStep: EnhancementPackageStep = {
  id: 'step-1',
  assetId: 'asset-1',
  mode: 'configure',
  trigger: 'before-draft',
  scope: 'chapter',
  order: 1,
  required: false,
};

describe('Plan 204 skills package store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    useSkillsPackageStore.getState().resetForRemount();
    novelClientMock.listNovels.mockReset().mockResolvedValue([novel]);
  });

  test('setter 镜像 useState 语义：支持值与函数式更新', () => {
    const store = useSkillsPackageStore.getState();
    store.setPackageSelections(['a']);
    store.setPackageSelections((current) => [...current, 'b']);
    expect(useSkillsPackageStore.getState().packageSelections).toEqual(['a', 'b']);

    store.setPackageComponentResults({ 'step-1': 'recommended' });
    store.setPackageComponentResults((current) => ({ ...current, 'step-2': 'conflict' }));
    expect(useSkillsPackageStore.getState().packageComponentResults).toEqual({
      'step-1': 'recommended',
      'step-2': 'conflict',
    });

    store.setPackageSelectionDrafts({ 'pkg-1': ['a'] });
    store.setPackageSelectionDrafts((current) => {
      const rest = { ...current };
      delete rest['pkg-1'];
      return rest;
    });
    expect(useSkillsPackageStore.getState().packageSelectionDrafts).toEqual({});

    store.setPackageResultLaunchFeedbackAssetId('asset-1');
    expect(useSkillsPackageStore.getState().packageResultLaunchFeedbackAssetId).toBe('asset-1');
  });

  test('resetForRemount 对齐原 useState 按挂载初始化语义', () => {
    const store = useSkillsPackageStore.getState();
    store.setPackageSelections(['a']);
    store.setPendingPackageSteps([seededStep]);
    store.setPackageSelectionDrafts({ 'pkg-1': ['a'] });
    store.setPackageComponentResults({ 'step-1': 'recommended' });
    store.setPackageResultLaunchFeedbackAssetId('asset-1');
    store.resetForRemount();
    expect(useSkillsPackageStore.getState()).toMatchObject({
      packageSelections: [],
      pendingPackageSteps: [],
      packageSelectionDrafts: {},
      packageComponentResults: {},
      packageResultLaunchFeedbackAssetId: null,
    });
  });

  test('提交禁用口径：逐分支与原视图派生等价', () => {
    const base = {
      hasNovel: true,
      restrictedPackage: false,
      selectionCount: 0,
      packageHasResults: false,
      missingRequiredLabels: [] as string[],
      staleConfigurationSession: false,
      packageHasStaleSelection: false,
    };
    // 无作品：区分有无勾选
    expect(computePackageSubmitDisabledReason({ ...base, hasNovel: false })).toBe(
      '请先在书库选择作品'
    );
    expect(computePackageSubmitDisabledReason({ ...base, hasNovel: false, selectionCount: 2 })).toBe(
      '请先在书库选择作品后再启用所选能力'
    );
    // 受限包 + 有勾选
    expect(
      computePackageSubmitDisabledReason({ ...base, restrictedPackage: true, selectionCount: 1 })
    ).toBe('当前作品未开通授权增强；可查看步骤，需授权后再启用所选能力。');
    // 零勾选：区分有无历史结果
    expect(computePackageSubmitDisabledReason(base)).toBe('至少选择一项能力');
    expect(computePackageSubmitDisabledReason({ ...base, packageHasResults: true })).toBe(
      '如需继续提交，请先勾选新能力'
    );
    // 缺必需能力
    expect(
      computePackageSubmitDisabledReason({
        ...base,
        selectionCount: 1,
        missingRequiredLabels: ['写前规则'],
      })
    ).toBe('请先选择必需能力：写前规则');
    // 会话过期 + 陈旧勾选
    expect(
      computePackageSubmitDisabledReason({
        ...base,
        selectionCount: 1,
        staleConfigurationSession: true,
        packageHasStaleSelection: true,
      })
    ).toBe('本次配置已变化，请先重新预览');
    // 其余情况可提交
    expect(
      computePackageSubmitDisabledReason({ ...base, selectionCount: 1 })
    ).toBeNull();
  });

  test('会话恢复后 pendingPackageSteps 水合进包 store（跨 store 编排）', async () => {
    const { waitFor: waitForElement } = await import('@testing-library/react');
    saveCapabilityConfigurationSession({
      version: 1,
      novelId: novel.id,
      databaseGeneration: 7,
      baselineToken: getCapabilityConfigurationBaselineToken(getProjectCapabilityProfile(novel)),
      configurationDraft: getProjectCapabilityProfile(novel),
      pendingPackageSteps: [seededStep],
      candidateCardIds: [],
      pendingCandidateId: null,
      activeTab: 'plaza',
      selectedCapability: 'packages',
      selectedCategory: 'all',
      selectedAssetId: null,
      scrollTop: 0,
      updatedAt: 0,
    });
    render(<SkillsStudioView selectedNovel={novel} />);
    // 会话水合在 effect 中完成（代际快照 resolve 之后）。
    await waitForElement(() => {
      expect(useSkillsPackageStore.getState().pendingPackageSteps).toEqual([seededStep]);
    });
  });
});
