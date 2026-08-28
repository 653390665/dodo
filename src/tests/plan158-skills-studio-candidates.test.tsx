import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SkillsStudioView } from '../components/SkillsStudioView';

const { savedCards } = vi.hoisted(() => ({ savedCards: [
  {
    id: 'candidate-card', name: '黄金三章候选卡', description: '候选', style: 'style', pacing: 'pacing',
    stabilityScore: 95, evaluationFeedback: 'ok', version: 3, parentSkillId: 'deconstruct-golden-climax',
    primaryDimension: 'pacing' as const, dimensionTags: ['pacing' as const], sourceType: 'plaza', sourceBadge: 'manual' as const,
    deconstructionCardType: 'pacing-card' as const, isRuntimeReady: true, sanitizationStatus: 'runtime-ready' as const,
    runtimeStatus: 'active' as const, createdAt: 1,
  },
  {
    id: 'ordinary-technique', name: '普通技法', description: '技法', style: 'rule', pacing: '',
    stabilityScore: 80, evaluationFeedback: '', version: 3, parentSkillId: 'prose-mouth-flavor',
    primaryDimension: 'style' as const, sourceType: 'plaza', sourceBadge: 'manual' as const, createdAt: 1,
  },
  ] }));

vi.mock('../lib/skill-client', () => ({
  syncSkillFeedbackScores: vi.fn().mockResolvedValue(savedCards),
  deleteSkill: vi.fn(),
  createSkill: vi.fn(),
}));
vi.mock('../lib/novel-client', () => ({ listNovels: vi.fn().mockResolvedValue([]) }));
vi.mock('../components/skills/SkillCard', () => ({
  SkillCard: ({ skill, onEquip }: { skill: { name: string }; onEquip?: (novelId: string) => void }) => <div>
    <span>{skill.name}</span>
    {onEquip && <button type="button" onClick={() => onEquip('novel-1')}>加入本次配置候选 {skill.name}</button>}
  </div>,
}));
vi.mock('../lib/db-transport', () => ({ subscribeToChanges: vi.fn(() => () => undefined), getDatabaseGenerationSnapshot: vi.fn().mockResolvedValue(7) }));
vi.mock('../lib/product-events-client', () => ({
  createProductEventSessionId: vi.fn((scope = 'session') => `${scope}:test-session`),
  createProductEventId: vi.fn((action: string, sessionId = 'session:test-session') => `event:${sessionId}:${action}`),
  recordProductEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/capability-configuration-client', () => ({
  previewCapabilityConfiguration: vi.fn().mockResolvedValue({ previewToken: 'p', databaseGeneration: 7 }),
  applyCapabilityConfiguration: vi.fn().mockResolvedValue({ profile: { version: 3, projectSkillDeck: { supportCardIds: [], updatedAt: 1 }, favoriteTechniqueIds: [] }, databaseGeneration: 8 }),
}));

const novel = {
  id: 'novel-1', title: '作品', authorId: 'local', summary: '', status: 'ongoing' as const, createdAt: 1, updatedAt: 1,
  projectPreferenceProfile: {
    tags: [],
    weights: { styleWeight: 0.5, characterWeight: 0.5, worldWeight: 0.5, plotWeight: 0.5, pacingWeight: 0.5 },
    acceptedDimensions: [],
    rejectedDimensions: [],
    notes: [],
    evidenceCount: 0,
    capabilityModelVersion: 3 as const,
    capabilityProfile: {
      version: 3 as const,
      projectSkillDeck: { mainCardId: 'legacy-unknown-card', supportCardIds: ['style-ancient-elegance', 'deconstruct-suspense-hook'], updatedAt: 1 },
      favoriteTechniqueIds: [],
    },
  },
};

async function openPackages() {
  fireEvent.click(await screen.findByRole('button', { name: /^能力商店$/ }));
  await waitFor(() => expect(screen.getByRole('tab', { name: /能力包/ })).toBeTruthy());
  fireEvent.click(screen.getByRole('tab', { name: /能力包/ }));
}

describe('Plan 158 capability candidates', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  test('adds a trusted saved card in place and does not navigate to editor', async () => {
    const onNavigate = vi.fn();
    render(<SkillsStudioView selectedNovel={{ ...novel, projectPreferenceProfile: undefined }} onNavigate={onNavigate} />);
    const action = await screen.findByRole('button', { name: '加入本次配置候选 黄金三章候选卡' });
    fireEvent.click(action);
    expect(await screen.findByText('待提交的卡组位置')).toBeTruthy();
    expect(screen.getByText('选择主卡或辅卡后仍是待提交状态；点击应用配置才会写入作品卡组。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '加入本次配置候选 普通技法' })).toBeNull();
    expect(onNavigate).not.toHaveBeenCalledWith('editor');
  });

  test('explains a fourth-card replacement and blocks an unresolved historical target', async () => {
    render(<SkillsStudioView selectedNovel={novel} />);
    fireEvent.click(await screen.findByRole('button', { name: '加入本次配置候选 黄金三章候选卡' }));
    fireEvent.click(await screen.findByRole('button', { name: '设为主卡' }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('待放入：黄金三章候选卡')).toBeTruthy();
    expect(screen.getAllByText(/来源：/).length).toBeGreaterThan(1);
    const responsibilityLabels = screen.getAllByText(/负责维度：/).map((element) => element.textContent || '');
    expect(responsibilityLabels.length).toBeGreaterThan(1);
    expect(responsibilityLabels.some((text) => text.includes('节奏'))).toBe(true);
    expect(screen.queryByText(/负责维度：pacing|负责维度：style|负责维度：hook/)).toBeNull();
    const replacementButton = screen.getByRole('button', { name: /古言华美辞藻典雅国风参考包/ });
    expect(within(replacementButton).getByText('重叠')).toBeTruthy();
    expect(within(replacementButton).getByText('会失去')).toBeTruthy();
    expect(within(replacementButton).getByText('会新增')).toBeTruthy();
    expect(screen.getByRole('button', { name: /legacy-unknown-card/ }).hasAttribute('disabled')).toBe(true);
  });

  test('expands a capability package and submits only checked components', async () => {
    const onNavigate = vi.fn();
    render(<SkillsStudioView selectedNovel={novel} onNavigate={onNavigate} />);
    await openPackages();
    const packageCard = screen.getByText('基础审稿增强包').closest('div.rounded-xl');
    expect(packageCard).not.toBeNull();
    fireEvent.click(within(packageCard as HTMLElement).getByRole('button', { name: '展开并选择' }));
    expect(await screen.findByRole('dialog', { name: '基础审稿增强包' })).toBeTruthy();
    const dialog = screen.getByRole('dialog', { name: '基础审稿增强包' });
    expect(within(dialog).getByText(/必选 · 不改正文 · 运行审稿诊断 · 写后 · 本章使用/)).toBeTruthy();
    const checkboxes = within(dialog).getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(1);
    fireEvent.click(checkboxes[0]);
    expect(within(dialog).getByRole('button', { name: '加入本次配置候选' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: '加入本次配置候选' }));
    expect(onNavigate).not.toHaveBeenCalledWith('editor');
  });

  test('keeps skill-card-only package selections in the staged profile', async () => {
    const packageNovel = {
      ...novel,
      projectPreferenceProfile: {
        ...novel.projectPreferenceProfile,
        capabilityProfile: {
          ...novel.projectPreferenceProfile.capabilityProfile,
          projectSkillDeck: { mainCardId: undefined, supportCardIds: [], updatedAt: 1 },
        },
      },
    };
    render(<SkillsStudioView selectedNovel={packageNovel} />);
    await openPackages();

    const packageCard = screen.getByText('跨章连贯性增强包').closest('div.rounded-xl');
    expect(packageCard).not.toBeNull();
    fireEvent.click(within(packageCard as HTMLElement).getByRole('button', { name: '展开并选择' }));

    const dialog = await screen.findByRole('dialog', { name: '跨章连贯性增强包' });
    const selectable = within(dialog).getAllByRole('checkbox').filter((checkbox) => !checkbox.hasAttribute('disabled'));
    expect(selectable.length).toBeGreaterThan(0);
    fireEvent.click(selectable[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: '加入本次配置候选' }));

    expect(await screen.findByText('本次配置')).toBeTruthy();
    expect(screen.getByText('仅拆书卡占用：一张主卡，最多两张辅卡')).toBeTruthy();
    expect(await within(dialog).findByText('下一步：应用配置后写入作品卡组')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: '设为主卡' })).toBeNull();
    const deckSummary = screen.getByText('作品卡组').closest('div.rounded-2xl') as HTMLElement;
    expect(within(deckSummary).getByText('主卡：')).toBeTruthy();
    expect(within(deckSummary).getByText(/黄金三章候选卡 · 用途：节奏/)).toBeTruthy();
    expect(within(deckSummary).getByText('还可添加 2 张辅卡')).toBeTruthy();
    const { applyCapabilityConfiguration } = await import('../lib/capability-configuration-client');
    fireEvent.click(screen.getByRole('button', { name: '应用配置并返回写作' }));
    await screen.findByText('作品卡组');
    expect(vi.mocked(applyCapabilityConfiguration).mock.calls.at(-1)?.[3].capabilityMemberships).toContainEqual(expect.objectContaining({
      sourceId: 'deconstruct-golden-climax',
      persistedSkillId: 'candidate-card',
    }));
    expect(vi.mocked(applyCapabilityConfiguration).mock.calls.at(-1)?.[3].projectSkillDeck.mainCardId).toBe('candidate-card');
    expect(screen.queryByText(/本次已选 \d+ 项（暂存）/)).toBeNull();
    expect(screen.queryByText(/待加入候选 \d+ 项/)).toBeNull();
  });

  test('imports an unavailable package component in place and selects it', async () => {
    render(<SkillsStudioView selectedNovel={novel} />);
    await openPackages();

    const packageCard = screen.getByText('高级审稿与局部手术包').closest('div.rounded-xl');
    expect(packageCard).not.toBeNull();
    fireEvent.click(within(packageCard as HTMLElement).getByRole('button', { name: '展开并选择' }));

    const dialog = await screen.findByRole('dialog', { name: '高级审稿与局部手术包' });
    const importGatedRow = within(dialog).getByText(/先保存到我的能力，再勾选待提交/).closest('div.rounded-lg') as HTMLElement;
    expect(within(importGatedRow).getByText('需先保存')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '保存到我的能力，并勾选待提交' }));

    await waitFor(() => expect(within(dialog).getAllByRole('checkbox').some((checkbox) => (checkbox as HTMLInputElement).checked)).toBe(true));
    expect(within(dialog).getByText('已勾选 1 项，待提交')).toBeTruthy();
    expect(within(dialog).getByText('已勾选，待提交到本次配置')).toBeTruthy();
    expect(within(dialog).getByText('请先选择必需能力：深度AI句式与套话物理抹除器')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '加入本次配置候选' }).getAttribute('aria-describedby')).toBe('capability-package-submit-help');
  });

});
