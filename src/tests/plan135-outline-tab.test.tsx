import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi, beforeEach } from 'vitest';

import type { ChapterMetadata, ContinuationPack, Skill, MountedSkillLoadoutItem, AggregatedSkillDeck } from '../../shared/types';
import type { OutlineArtifact } from '../../shared/types/outline-governance';
import { OutlineTab } from '../components/book-factory/OutlineTab';
import { buildDeckMountPlan } from '../components/book-factory/useBookFactory';
import { EquipPanel } from '../components/book-factory/EquipPanel';

const outlineClientMocks = vi.hoisted(() => ({
  createOutline: vi.fn(),
  activateOutline: vi.fn(),
  getDatabaseGenerationSnapshot: vi.fn(async () => 1),
  listOutlines: vi.fn(async (): Promise<OutlineArtifact[]> => []),
  listCanonPatches: vi.fn(async () => []),
  subscribeToOutlineGovernanceChanges: vi.fn(() => () => {}),
  archiveOutline: vi.fn(), acceptCanonPatch: vi.fn(), rejectCanonPatch: vi.fn(),
}));
vi.mock('../lib/outline-client', () => outlineClientMocks);

const chapter: ChapterMetadata = {
  id: 'chapter-1',
  novelId: 'novel-1',
  title: '第一章',
  volumeName: '正文卷',
  order: 1,
  wordCount: 100,
  createdAt: 1,
  updatedAt: 1,
};

const approvedPackWithManuscript: ContinuationPack = {
  id: 'pack-1',
  novelId: 'novel-1',
  title: '续写资料包',
  status: 'approved',
  sourceDocuments: [
    { id: 'doc-1', packId: 'pack-1', filename: '正文.txt', kind: 'manuscript', text: '内容', excerpt: '摘要', createdAt: 1 },
    { id: 'doc-2', packId: 'pack-1', filename: '设定.txt', kind: 'world', text: '内容', excerpt: '摘要', createdAt: 1 },
    { id: 'doc-4', packId: 'pack-1', filename: '主线大纲.txt', kind: 'outline', text: '第一卷：起势', excerpt: '主线摘要', createdAt: 1 },
    { id: 'doc-5', packId: 'pack-1', filename: '备用大纲.txt', kind: 'outline', text: '备用路线', excerpt: '备用摘要', createdAt: 1 },
  ],
  canonFacts: [],
  characterStates: [],
  plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
  styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
  contradictions: [],
  continuationTask: '',
  createdAt: 1,
  updatedAt: 1,
};

const approvedPackWithoutManuscript: ContinuationPack = {
  ...approvedPackWithManuscript,
  id: 'pack-2',
  sourceDocuments: [
    { id: 'doc-3', packId: 'pack-2', filename: '设定.txt', kind: 'world', text: '内容', excerpt: '摘要', createdAt: 1 },
  ],
};

const draftPack: ContinuationPack = {
  ...approvedPackWithManuscript,
  id: 'pack-3',
  status: 'draft',
};

const reportOutlinePack: ContinuationPack = {
  ...approvedPackWithManuscript,
  id: 'pack-report',
  sourceDocuments: [
    { id: 'doc-report', packId: 'pack-report', filename: '审稿问题清单.txt', kind: 'outline', text: '问题清单：冲突不足', excerpt: '审稿报告', createdAt: 1 },
  ],
};

const makeSkill = (id: string, cardType?: Skill['deconstructionCardType']): Skill => ({
  id, name: id, description: '', style: '', pacing: '', stabilityScore: 1, evaluationFeedback: '', version: 1,
  primaryDimension: 'world', deconstructionCardType: cardType, createdAt: 1,
});

describe('OutlineTab - Plan 135 Behavior Tests', () => {
  const defaultProps = {
    expectedWordCount: '' as number | '',
    setExpectedWordCount: vi.fn(),
    onGenerateOutline: vi.fn(async () => {}),
    isGeneratingOutline: false,
    globalOutline: '',
    onGlobalOutlineChange: vi.fn(),
    chapters: [chapter],
    currentChapter: null,
    onSelectChapter: vi.fn(async () => {}),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    outlineClientMocks.createOutline.mockResolvedValue({ id: 'candidate-1' });
    outlineClientMocks.activateOutline.mockResolvedValue({ archivedIds: [], demotedIds: [] });
    outlineClientMocks.listOutlines.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('production draft input does not persist until save, then creates user candidate and syncs locally', async () => {
    const onGlobalOutlineChange = vi.fn();
    const onCanonicalOutlineChange = vi.fn();
    render(<OutlineTab {...defaultProps} novelId="novel-1" globalOutline="旧主纲" selectedContinuationPack={null} onGlobalOutlineChange={onGlobalOutlineChange} onCanonicalOutlineChange={onCanonicalOutlineChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '本地草稿' } });
    expect(onGlobalOutlineChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /保存并设为主纲/ }));
    await waitFor(() => expect(outlineClientMocks.createOutline).toHaveBeenCalledWith('novel-1', expect.objectContaining({ content: '本地草稿', source: 'user' })));
    expect(outlineClientMocks.activateOutline).toHaveBeenCalledWith('novel-1', 'candidate-1', 1);
    expect(onCanonicalOutlineChange).toHaveBeenCalledWith('本地草稿');
  });

  test('production save failure preserves Canon and does not call local callback', async () => {
    const onCanonicalOutlineChange = vi.fn();
    outlineClientMocks.activateOutline.mockRejectedValueOnce(new Error('conflict'));
    render(<OutlineTab {...defaultProps} novelId="novel-1" globalOutline="旧主纲" selectedContinuationPack={null} onCanonicalOutlineChange={onCanonicalOutlineChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '失败草稿' } });
    fireEvent.click(screen.getByRole('button', { name: /保存并设为主纲/ }));
    await screen.findByRole('alert');
    expect(onCanonicalOutlineChange).not.toHaveBeenCalled();
  });

  test('production AI generation receives the local draft', async () => {
    const onGenerateOutline = vi.fn(async () => {});
    render(<OutlineTab {...defaultProps} novelId="novel-1" expectedWordCount={100} selectedContinuationPack={null} onGenerateOutline={onGenerateOutline} globalOutline="旧主纲" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'AI 输入草稿' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 生成作品大纲' }));
    await waitFor(() => expect(onGenerateOutline).toHaveBeenCalledWith('AI 输入草稿'));
  });

  test('project technique generation sends structured source IDs without imported text', async () => {
    const onGenerateOutline = vi.fn(async () => ({ candidateId: 'candidate-1', content: '候选细纲', databaseGeneration: 1 }));
    render(
      <OutlineTab
        {...defaultProps}
        novelId="novel-1"
        expectedWordCount={100}
        projectTechniqueId="opening-gold-three"
        selectedContinuationPack={approvedPackWithManuscript}
        onGenerateOutline={onGenerateOutline}
      />,
    );
    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: /黄金三章核心冲突大纲展开器/ }));
    await waitFor(() =>
      expect(onGenerateOutline).toHaveBeenCalledWith(undefined, {
        techniqueId: 'opening-gold-three',
        outlineSourceSelection: {
          continuationPackId: 'pack-1',
          primaryDocumentId: 'doc-4',
          referenceDocumentIds: [],
        },
      }),
    );
  });

  test('regular imported-outline generation sends structured source IDs without a technique', async () => {
    const onGenerateOutline = vi.fn(async () => ({ candidateId: 'candidate-1', content: '候选细纲', databaseGeneration: 1 }));
    render(
      <OutlineTab
        {...defaultProps}
        novelId="novel-1"
        expectedWordCount={100}
        selectedContinuationPack={approvedPackWithManuscript}
        onGenerateOutline={onGenerateOutline}
      />,
    );
    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'AI 整理所选大纲' }));
    await waitFor(() =>
      expect(onGenerateOutline).toHaveBeenCalledWith(undefined, {
        outlineSourceSelection: {
          continuationPackId: 'pack-1',
          primaryDocumentId: 'doc-4',
          referenceDocumentIds: [],
        },
      }),
    );
  });

  test('project technique label makes candidate-only behavior explicit', () => {
    render(
      <OutlineTab
        {...defaultProps}
        expectedWordCount={100}
        projectTechniqueId="opening-gold-three"
        selectedContinuationPack={null}
      />,
    );
    expect(screen.getByText('本次大纲技法')).toBeDefined();
    expect(screen.getByText(/基于当前主纲或选中的导入大纲生成候选，不直接覆盖/)).toBeDefined();
  });

  test('production imported adoption does not call legacy callbacks', async () => {
    const onAdoptOutline = vi.fn(async () => true);
    const onGlobalOutlineChange = vi.fn();
    const onCanonicalOutlineChange = vi.fn();
    render(<OutlineTab {...defaultProps} novelId="novel-1" onAdoptOutline={onAdoptOutline} onGlobalOutlineChange={onGlobalOutlineChange} onCanonicalOutlineChange={onCanonicalOutlineChange} selectedContinuationPack={approvedPackWithManuscript} />);
    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: '确认采用此大纲' }));
    await waitFor(() => expect(outlineClientMocks.activateOutline).toHaveBeenCalled());
    expect(onAdoptOutline).not.toHaveBeenCalled();
    expect(onGlobalOutlineChange).not.toHaveBeenCalled();
  });

  test('approved pack shows outline files', () => {
    render(
      <OutlineTab
        {...defaultProps}
        selectedContinuationPack={approvedPackWithManuscript}
      />,
    );

    expect(screen.getByText('主线大纲.txt')).toBeDefined();
  });

  test('approved pack without manuscript docs does not show manuscript hint', () => {
    render(
      <OutlineTab
        {...defaultProps}
        selectedContinuationPack={approvedPackWithoutManuscript}
      />,
    );

    expect(screen.getByText('资料已读取，尚未生成作品大纲')).toBeDefined();
    expect(screen.queryByText(/导入正文仅作为续写参考/)).toBeNull();
  });

  test('draft pack does not show approved pack hint', () => {
    render(
      <OutlineTab
        {...defaultProps}
        selectedContinuationPack={draftPack}
      />,
    );

    expect(screen.queryByText('资料已读取，尚未生成作品大纲')).toBeNull();
  });

  test('no pack does not show approved pack hint', () => {
    render(
      <OutlineTab
        {...defaultProps}
        selectedContinuationPack={null}
      />,
    );

    expect(screen.queryByText('资料已读取，尚未生成作品大纲')).toBeNull();
  });

  test('button shows "AI 整理所选大纲" when outline files exist', () => {
    render(
      <OutlineTab
        {...defaultProps}
        expectedWordCount={100000}
        selectedContinuationPack={approvedPackWithManuscript}
      />,
    );

    expect(screen.getByText('AI 整理所选大纲')).toBeDefined();
  });

  test('button shows "AI 生成作品大纲" without outline files', () => {
    render(
      <OutlineTab
        {...defaultProps}
        expectedWordCount={100000}
        selectedContinuationPack={null}
      />,
    );

    expect(screen.getByText('AI 生成作品大纲')).toBeDefined();
  });

  test('does not treat outline-kind review reports as the primary outline', () => {
    render(
      <OutlineTab
        {...defaultProps}
        expectedWordCount={100000}
        selectedContinuationPack={reportOutlinePack}
      />,
    );

    expect(screen.queryByText('审稿问题清单.txt')).toBeNull();
    expect(screen.getByText('AI 生成作品大纲')).toBeDefined();
  });

  test('hides compatibility review reports from primary and reference choices', () => {
    const pack: ContinuationPack = {
      ...approvedPackWithManuscript,
      id: 'pack-compatibility-report',
      sourceDocuments: [
        { id: 'doc-candidate', packId: 'pack-compatibility-report', filename: '主线大纲.md', kind: 'outline', text: '主结构', excerpt: '', createdAt: 1 },
        { id: 'doc-outline-report', packId: 'pack-compatibility-report', filename: '左道指南_事务所生态圈兼容性审查报告.md', kind: 'outline', text: '审查结论', excerpt: '', createdAt: 1 },
        { id: 'doc-world-report', packId: 'pack-compatibility-report', filename: '左道指南_事务所生态圈兼容性审查报告-设定.md', kind: 'world', text: '报告内容', excerpt: '', createdAt: 1 },
      ],
    };
    render(<OutlineTab {...defaultProps} selectedContinuationPack={pack} />);

    expect(screen.getByText('主线大纲.md')).toBeDefined();
    expect(screen.queryByText('左道指南_事务所生态圈兼容性审查报告.md')).toBeNull();
    expect(screen.queryByText('左道指南_事务所生态圈兼容性审查报告-设定.md')).toBeNull();
    expect(screen.queryByRole('radio', { name: /兼容性审查报告/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /兼容性审查报告/ })).toBeNull();
  });

  test('only exposes server-accepted outline reference kinds', () => {
    const pack = {
      ...approvedPackWithManuscript,
      id: 'pack-reference-kinds',
      sourceDocuments: [
        ...approvedPackWithManuscript.sourceDocuments,
        { id: 'doc-style', packId: 'pack-reference-kinds', filename: '风格样本.txt', kind: 'style_sample' as const, text: '风格', excerpt: '', createdAt: 1 },
        { id: 'doc-other', packId: 'pack-reference-kinds', filename: '其他资料.txt', kind: 'other' as const, text: '其他', excerpt: '', createdAt: 1 },
      ],
    };
    render(<OutlineTab {...defaultProps} selectedContinuationPack={pack} />);
    expect(screen.getByRole('checkbox', { name: '参考资料：设定.txt' })).toBeDefined();
    expect(screen.queryByRole('checkbox', { name: '参考资料：正文.txt' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: '参考资料：风格样本.txt' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: '参考资料：其他资料.txt' })).toBeNull();
  });

  test('button disabled without expectedWordCount shows tooltip', () => {
    render(
      <OutlineTab
        {...defaultProps}
        selectedContinuationPack={approvedPackWithManuscript}
      />,
    );

    const button = screen.getByRole('button', { name: /AI 整理所选大纲/ });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('title')).toBe('请先填写预计总字数');
  });

  test('button enabled with expectedWordCount', () => {
    render(
      <OutlineTab
        {...defaultProps}
        expectedWordCount={100000}
        selectedContinuationPack={approvedPackWithManuscript}
      />,
    );

    fireEvent.click(screen.getAllByRole('radio')[0]);
    const button = screen.getByRole('button', { name: /AI 整理所选大纲/ });
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  test('textarea disabled during generation', () => {
    render(
      <OutlineTab
        {...defaultProps}
        isGeneratingOutline={true}
        selectedContinuationPack={approvedPackWithManuscript}
      />,
    );

    const textarea = screen.getByRole('textbox');
    expect(textarea.hasAttribute('disabled')).toBe(true);
  });

  test('input disabled during generation', () => {
    render(
      <OutlineTab
        {...defaultProps}
        isGeneratingOutline={true}
        selectedContinuationPack={approvedPackWithManuscript}
      />,
    );

    const input = screen.getByRole('spinbutton');
    expect(input.hasAttribute('disabled')).toBe(true);
  });

  test('shows outline filenames, summaries, previews, and requires a primary selection', () => {
    render(
      <OutlineTab
        {...defaultProps}
        expectedWordCount={3000000}
        selectedContinuationPack={approvedPackWithManuscript}
      />,
    );

    expect(screen.getByText('主线大纲.txt')).toBeDefined();
    expect(screen.getByText(/摘要：主线摘要/)).toBeDefined();
    expect(screen.getByText(/预览：第一卷：起势/)).toBeDefined();
    expect(screen.getAllByRole('radio')).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('radio')[1]);
    expect(screen.getByRole('button', { name: '确认采用此大纲' })).toBeDefined();
  });

  test('adopts the selected outline without generating', () => {
    const onGlobalOutlineChange = vi.fn();
    const onGenerateOutline = vi.fn(async () => {});
    render(
      <OutlineTab
        {...defaultProps}
        onGlobalOutlineChange={onGlobalOutlineChange}
        onGenerateOutline={onGenerateOutline}
        selectedContinuationPack={approvedPackWithManuscript}
      />,
    );

    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: '确认采用此大纲' }));

    expect(onGlobalOutlineChange).toHaveBeenCalledWith('第一卷：起势');
    expect(onGenerateOutline).not.toHaveBeenCalled();
  });

  test('canceling overwrite leaves the existing outline untouched', () => {
    const onGlobalOutlineChange = vi.fn();
    vi.stubGlobal('confirm', vi.fn(() => false));
    render(
      <OutlineTab
        {...defaultProps}
        globalOutline="已有大纲"
        onGlobalOutlineChange={onGlobalOutlineChange}
        selectedContinuationPack={approvedPackWithManuscript}
      />,
    );

    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: '确认采用此大纲' }));

    expect(window.confirm).toHaveBeenCalled();
    expect(onGlobalOutlineChange).not.toHaveBeenCalled();
  });

  test('shows a persistent save error and preserves the old outline when adoption fails', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const onAdoptOutline = vi.fn(async () => false);
    render(
      <OutlineTab
        {...defaultProps}
        globalOutline="已有大纲"
        onAdoptOutline={onAdoptOutline}
        selectedContinuationPack={approvedPackWithManuscript}
      />,
    );

    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: '确认采用此大纲' }));

    expect(onAdoptOutline).toHaveBeenCalledWith('第一卷：起势');
    expect((await screen.findByRole('alert')).textContent).toContain('原大纲未被修改');
  });

  test('preserves 3000000 as a numeric UI value', () => {
    const setExpectedWordCount = vi.fn();
    render(<OutlineTab {...defaultProps} setExpectedWordCount={setExpectedWordCount} selectedContinuationPack={null} />);

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3000000' } });

    expect(setExpectedWordCount).toHaveBeenCalledWith(3000000);
  });

  test('deck mount plan preserves unrelated slots and requires an explicit dual-stage choice', () => {
    const existing = [
      { slot: 0, skillId: 'old-planner', weight: 1, lockedDimensions: ['world'] as const },
      { slot: 2, skillId: 'keep-critic', weight: 1, lockedDimensions: ['plot'] as const },
    ];
    const pacing = { ...makeSkill('new-pacing', 'pacing-card'), primaryDimension: 'pacing' as const };
    const typedExisting: MountedSkillLoadoutItem[] = existing.map((entry) => ({ ...entry, lockedDimensions: [...entry.lockedDimensions] }));
    const unresolved = buildDeckMountPlan([pacing], typedExisting);
    expect(unresolved.requiresStageSelection).toBe(true);
    expect(unresolved.loadout.find((entry) => entry.slot === 2)?.skillId).toBe('keep-critic');

    const resolved = buildDeckMountPlan([pacing], typedExisting, 'writer');
    expect(resolved.loadout.find((entry) => entry.slot === 1)?.skillId).toBe('new-pacing');
    expect(resolved.loadout.find((entry) => entry.slot === 2)?.skillId).toBe('keep-critic');
  });

  test('deck mount plan rejects same-slot card conflicts and keeps unknown cards out', () => {
    const conflict = buildDeckMountPlan([
      makeSkill('world-a', 'worldview-card'),
      makeSkill('world-b', 'worldview-card'),
      makeSkill('unknown'),
    ], []);
    expect(conflict.conflicts).toHaveLength(1);
    expect(conflict.unknownCards.map((card) => card.id)).toEqual(['unknown']);
  });

  test('ordinary outline remains selectable when keyword appears after the opening', () => {
    const pack = { ...approvedPackWithManuscript, id: 'pack-ordinary', sourceDocuments: [
      { id: 'ordinary', packId: 'pack-ordinary', filename: '主线大纲.txt', kind: 'outline' as const, text: `${'正文'.repeat(150)}评分 review`, excerpt: '主线大纲', createdAt: 1 },
    ] };
    render(<OutlineTab {...defaultProps} expectedWordCount={100000} selectedContinuationPack={pack} />);
    expect(screen.getByText('主线大纲.txt')).toBeDefined();
  });

  test('deck equipment exposes main/support cards without role-slot selection', () => {
    const deck = (id: string): AggregatedSkillDeck => ({
      mainCard: { ...makeSkill(id, 'pacing-card'), evidenceCoverage: 'full-book-stable', evidenceMoments: [] },
      supportCards: [],
    });
    const props = {
      deck: deck('deck-a'), savedDeckIds: ['saved-a'], isSaving: false, equipNovelId: 'novel-a',
      onSetEquipNovelId: vi.fn(), userNovels: [], onEquipDeck: vi.fn(), onEquipSkill: vi.fn(), onCancel: vi.fn(),
    };
    render(<EquipPanel {...props} />);
    expect(screen.getByText('主卡')).toBeDefined();
    expect(screen.queryByText(/Planner|Writer|Critic/)).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  test('reconciles activate rejection when candidate is active', async () => {
    outlineClientMocks.activateOutline.mockRejectedValueOnce(new Error('timeout'));
    outlineClientMocks.listOutlines
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'candidate-1', level: 'master', status: 'active', content: '本地草稿', scope: {}, novelId: 'novel-1', source: 'user' }]);
    const onCanonicalOutlineChange = vi.fn();
    render(<OutlineTab {...defaultProps} novelId="novel-1" globalOutline="旧" selectedContinuationPack={null} onCanonicalOutlineChange={onCanonicalOutlineChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '本地草稿' } });
    fireEvent.click(screen.getByRole('button', { name: /保存并设为主纲/ }));
    expect((await screen.findByText(/确认响应中断/)).textContent).toContain('确认响应中断');
    expect(screen.queryByText(/当前主纲未变|保存状态未知/)).toBeNull();
    expect(onCanonicalOutlineChange).toHaveBeenCalledWith('本地草稿');
  });

  test('reconciliation reports unchanged active master without local sync', async () => {
    outlineClientMocks.activateOutline.mockRejectedValueOnce(new Error('timeout'));
    outlineClientMocks.listOutlines
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'old', level: 'master', status: 'active', content: '旧', scope: {}, novelId: 'novel-1', source: 'user' }]);
    const onCanonicalOutlineChange = vi.fn();
    render(<OutlineTab {...defaultProps} novelId="novel-1" globalOutline="旧" selectedContinuationPack={null} onCanonicalOutlineChange={onCanonicalOutlineChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '新' } });
    fireEvent.click(screen.getByRole('button', { name: /保存并设为主纲/ }));
    expect((await screen.findByText(/当前主纲未变/)).textContent).toContain('当前主纲未变');
    expect(onCanonicalOutlineChange).not.toHaveBeenCalled();
  });

  test('reconciliation reports unknown state when readback fails', async () => {
    outlineClientMocks.activateOutline.mockRejectedValueOnce(new Error('timeout'));
    outlineClientMocks.listOutlines
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('offline'));
    render(<OutlineTab {...defaultProps} novelId="novel-1" globalOutline="旧" selectedContinuationPack={null} onCanonicalOutlineChange={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '新' } });
    fireEvent.click(screen.getByRole('button', { name: /保存并设为主纲/ }));
    expect((await screen.findByText(/保存状态未知/)).textContent).toContain('保存状态未知');
  });

  test('late reconciliation after novel switch does not update the new work', async () => {
    let resolveReadback!: (value: OutlineArtifact[]) => void;
    outlineClientMocks.activateOutline.mockRejectedValueOnce(new Error('timeout'));
    outlineClientMocks.listOutlines
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => new Promise<OutlineArtifact[]>((resolve) => { resolveReadback = resolve; }));
    const onCanonicalOutlineChange = vi.fn();
    const { rerender } = render(<OutlineTab {...defaultProps} novelId="novel-1" globalOutline="旧" selectedContinuationPack={null} onCanonicalOutlineChange={onCanonicalOutlineChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '新' } });
    fireEvent.click(screen.getByRole('button', { name: /保存并设为主纲/ }));
    await waitFor(() => expect(outlineClientMocks.listOutlines).toHaveBeenCalledTimes(2));
    rerender(<OutlineTab {...defaultProps} novelId="novel-2" globalOutline="二" selectedContinuationPack={null} onCanonicalOutlineChange={onCanonicalOutlineChange} />);
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('二'));
    await act(async () => {
      resolveReadback([{ id: 'candidate-1', level: 'master', status: 'active', content: '新', scope: {}, novelId: 'novel-1', source: 'user' }]);
      await Promise.resolve();
    });
    expect(onCanonicalOutlineChange).not.toHaveBeenCalled();
  });
});
