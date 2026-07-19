/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { PlanningTab } from '../components/book-factory/PlanningTab';

// ── Mocks ────────────────────────────────────────────────────────

const mockNovel = {
  id: 'novel-1',
  title: '测试小说',
  projectPreferenceProfile: {
    tags: ['current-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step1'],
    weights: { styleWeight: 0.2, characterWeight: 0.2, worldWeight: 0.2, plotWeight: 0.2, pacingWeight: 0.2 },
    acceptedDimensions: [],
    rejectedDimensions: [],
    notes: [],
    evidenceCount: 0,
  },
};

const mockCurrentChapter = { id: 'ch-1', novelId: 'novel-1', title: '第一章', content: '', sceneBeats: '', wordCount: 0, order: 1, createdAt: 0, updatedAt: 0 };

const defaultProps = {
  renderContextReceipt: () => <div data-testid="context-receipt" />,
  userIntent: '',
  setUserIntent: vi.fn(),
  currentChapter: mockCurrentChapter,
  onGenerateBeats: vi.fn().mockResolvedValue(undefined),
  isGeneratingBeats: false,
  onGenerateContent: vi.fn().mockResolvedValue(undefined),
  isGeneratingContent: false,
  onRewriteSelectedText: vi.fn().mockResolvedValue(undefined),
  onUpdateChapterBeats: vi.fn(),
  generationStatus: null,
  novel: mockNovel as any,
};

// ── Helpers ───────────────────────────────────────────────────────

/** Advance the step by clicking the progress button. */
async function clickAdvance() {
  const btn = screen.getByText(/完成本步并前往|完成全流程创作/);
  fireEvent.click(btn);
  await act(async () => { await new Promise(r => setTimeout(r, 50)); });
}

// ── Tests ─────────────────────────────────────────────────────────

describe('PlanningTab Step Progression', () => {
  beforeEach(() => {});

  // ── Navigation routing ──

  test('step1 → nextStep is step2 (世界观架构设定) with navigateTo:bible', async () => {
    const onPreferenceProfileChange = vi.fn().mockResolvedValue(undefined);
    const onSwitchTab = vi.fn();

    const { rerender } = render(
      <PlanningTab
        {...defaultProps}
        onPreferenceProfileChange={onPreferenceProfileChange}
        onSwitchTab={onSwitchTab}
      />
    );

    await clickAdvance();

    // Tags should reflect completed step1, current step2
    const saved = onPreferenceProfileChange.mock.calls[0][0];
    expect(saved.tags).toContain('completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step1');
    expect(saved.tags).toContain('current-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step2');

    // Step1's nextStep is step2 whose navigateTo is 'bible'
    expect(onSwitchTab).toHaveBeenCalledWith('bible');

    // Rerender with the saved profile — UI should now show step 2
    rerender(
      <PlanningTab
        {...defaultProps}
        novel={{ ...mockNovel, projectPreferenceProfile: saved } as any}
        onPreferenceProfileChange={onPreferenceProfileChange}
        onSwitchTab={onSwitchTab}
      />
    );

    expect(screen.getByText('世界观架构设定')).toBeDefined();
    // Button should now show step 2 → step 3 path
    expect(screen.getByText(/核心角色人设卡/)).toBeDefined();
  });

  test('step2 → step3 navigateTo:bible (nextStep is 核心角色人设卡)', async () => {
    const onPreferenceProfileChange = vi.fn().mockResolvedValue(undefined);
    const onSwitchTab = vi.fn();

    const step2Novel = {
      ...mockNovel,
      projectPreferenceProfile: {
        ...mockNovel.projectPreferenceProfile,
        tags: ['current-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step2'],
      },
    };

    render(
      <PlanningTab
        {...defaultProps}
        novel={step2Novel as any}
        onPreferenceProfileChange={onPreferenceProfileChange}
        onSwitchTab={onSwitchTab}
      />
    );

    await clickAdvance();
    // Step3 (核心角色人设卡) has navigateTo: 'bible'
    expect(onSwitchTab).toHaveBeenCalledWith('bible');
  });

  test('step4 → step5 navigateTo:outline (大纲骨架与主线设计 → 故事细纲与高潮铺设)', async () => {
    const onPreferenceProfileChange = vi.fn().mockResolvedValue(undefined);
    const onSwitchTab = vi.fn();

    const step4Novel = {
      ...mockNovel,
      projectPreferenceProfile: {
        ...mockNovel.projectPreferenceProfile,
        tags: ['current-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step4'],
      },
    };

    render(
      <PlanningTab
        {...defaultProps}
        novel={step4Novel as any}
        onPreferenceProfileChange={onPreferenceProfileChange}
        onSwitchTab={onSwitchTab}
      />
    );

    await clickAdvance();
    // Step5 has navigateTo: 'outline'
    expect(onSwitchTab).toHaveBeenCalledWith('outline');
  });

  test('last step (step8) — no nextStep, no navigation', async () => {
    const onPreferenceProfileChange = vi.fn().mockResolvedValue(undefined);
    const onSwitchTab = vi.fn();

    const lastStepNovel = {
      ...mockNovel,
      projectPreferenceProfile: {
        ...mockNovel.projectPreferenceProfile,
        tags: ['current-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step8'],
      },
    };

    render(
      <PlanningTab
        {...defaultProps}
        novel={lastStepNovel as any}
        onPreferenceProfileChange={onPreferenceProfileChange}
        onSwitchTab={onSwitchTab}
      />
    );

    expect(screen.getByText('完成全流程创作')).toBeDefined();
    await clickAdvance();

    const saved = onPreferenceProfileChange.mock.calls[0][0];
    expect(saved.tags).toContain('completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step8');
    expect(saved.tags).toContain('completed-flow:xiaofeiji-novel-flow');

    // No nextStep → no navigation
    expect(onSwitchTab).not.toHaveBeenCalled();
  });

  // ── Save-gate ──

  test('button is disabled during save and re-enabled after', async () => {
    let resolveSave!: (v: unknown) => void;
    const savePromise = new Promise(resolve => { resolveSave = resolve; });
    const onPreferenceProfileChange = vi.fn().mockReturnValue(savePromise);

    render(
      <PlanningTab
        {...defaultProps}
        onPreferenceProfileChange={onPreferenceProfileChange}
      />
    );

    const advanceBtn = screen.getByText(/完成本步并前往/);
    fireEvent.click(advanceBtn);
    expect(screen.getByText('保存中...')).toBeDefined();
    expect((advanceBtn as HTMLButtonElement).disabled).toBe(true);

    await act(async () => { resolveSave(undefined); await new Promise(r => setTimeout(r, 50)); });
    expect(screen.queryByText('保存中...')).toBeNull();
    expect((screen.getByText(/完成本步并前往/) as HTMLButtonElement).disabled).toBe(false);
  });

  test('double-click only produces one save call', async () => {
    const onPreferenceProfileChange = vi.fn().mockResolvedValue(undefined);
    render(
      <PlanningTab {...defaultProps} onPreferenceProfileChange={onPreferenceProfileChange} />
    );
    const btn = screen.getByText(/完成本步并前往/);
    fireEvent.click(btn);
    fireEvent.click(btn);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(onPreferenceProfileChange).toHaveBeenCalledTimes(1);
  });

  test('save failure displays error, does not advance, re-enables button', async () => {
    const onPreferenceProfileChange = vi.fn().mockRejectedValue(new Error('DB write failed'));
    const onSwitchTab = vi.fn();

    render(
      <PlanningTab
        {...defaultProps}
        onPreferenceProfileChange={onPreferenceProfileChange}
        onSwitchTab={onSwitchTab}
      />
    );

    await clickAdvance();
    expect(screen.getByText(/DB write failed|保存失败/)).toBeDefined();
    expect(onSwitchTab).not.toHaveBeenCalled();
    expect((screen.getByText(/完成本步并前往/) as HTMLButtonElement).disabled).toBe(false);
  });

  // ── Flow completed state ──

  test('flow completed — hides advance button, shows reset', () => {
    const completedNovel = {
      ...mockNovel,
      projectPreferenceProfile: {
        ...mockNovel.projectPreferenceProfile,
        tags: [
          'completed-flow:xiaofeiji-novel-flow',
          'completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step8',
          'current-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step8',
        ],
      },
    };

    render(<PlanningTab {...defaultProps} novel={completedNovel as any} />);

    // Advance button hidden
    expect(screen.queryByText('完成全流程创作')).toBeNull();
    // Reset visible
    expect(screen.getByText('重置流程进度')).toBeDefined();
    // Banner
    expect(screen.getByText(/全流程已完成/)).toBeDefined();
    // Show last step name
    expect(screen.getByText('正文去AI润色')).toBeDefined();
  });

  test('completed-flow prevents fallback to step 1 when no current-step tag', () => {
    const completedNovel = {
      ...mockNovel,
      projectPreferenceProfile: {
        ...mockNovel.projectPreferenceProfile,
        tags: ['completed-flow:xiaofeiji-novel-flow', 'completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step8'],
      },
    };

    render(<PlanningTab {...defaultProps} novel={completedNovel as any} />);
    expect(screen.queryByText('脑洞灵感闪耀')).toBeNull();
    expect(screen.getByText('正文去AI润色')).toBeDefined();
  });

  // ── Reset ──

  test('reset clears completed-flow and restores step 1', async () => {
    const onPreferenceProfileChange = vi.fn().mockResolvedValue(undefined);

    const completedNovel = {
      ...mockNovel,
      projectPreferenceProfile: {
        ...mockNovel.projectPreferenceProfile,
        tags: [
          'completed-flow:xiaofeiji-novel-flow',
          'completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step8',
          'current-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step8',
        ],
      },
    };

    const { rerender } = render(
      <PlanningTab
        {...defaultProps}
        novel={completedNovel as any}
        onPreferenceProfileChange={onPreferenceProfileChange}
      />
    );

    // Click reset
    fireEvent.click(screen.getByText('重置流程进度'));
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    const saved = onPreferenceProfileChange.mock.calls[0][0];
    const tags = saved.tags as string[];

    // completed-flow cleared
    expect(tags).not.toContain('completed-flow:xiaofeiji-novel-flow');
    // All completed-step tags cleared
    expect(tags.filter((t: string) => t.startsWith('completed-step:'))).toHaveLength(0);
    // Step 1 restored
    expect(tags).toContain('current-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step1');

    // Rerender with reset profile — UI should show step 1
    rerender(
      <PlanningTab
        {...defaultProps}
        novel={{ ...mockNovel, projectPreferenceProfile: saved } as any}
        onPreferenceProfileChange={onPreferenceProfileChange}
      />
    );
    expect(screen.getByText('脑洞灵感闪耀')).toBeDefined();
  });

  test('re-completing a completed flow does not duplicate completed-flow tag', async () => {
    const onPreferenceProfileChange = vi.fn().mockResolvedValue(undefined);

    // Novel already on last step with some completed steps
    const repeatingNovel = {
      ...mockNovel,
      projectPreferenceProfile: {
        ...mockNovel.projectPreferenceProfile,
        tags: [
          'completed-flow:xiaofeiji-novel-flow',
          'current-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step8',
          'completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step1',
          'completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step8',
        ],
      },
    };

    render(
      <PlanningTab
        {...defaultProps}
        novel={repeatingNovel as any}
        onPreferenceProfileChange={onPreferenceProfileChange}
      />
    );

    // Button should be hidden (flow already completed)
    expect(screen.queryByText('完成全流程创作')).toBeNull();
    expect(onPreferenceProfileChange).not.toHaveBeenCalled();
  });

  // ── UI display ──

  test('displayStepNumber and total steps shown correctly', () => {
    render(<PlanningTab {...defaultProps} />);
    const indicator = screen.getByText((c) => c.includes('步骤') && c.includes('/') && c.includes('8'));
    expect(indicator).toBeDefined();
  });

  test('step name and quality gate are displayed on step 1', () => {
    render(<PlanningTab {...defaultProps} />);
    expect(screen.getByText('脑洞灵感闪耀')).toBeDefined();
    expect(screen.getByText(/脑洞概念成型且具备初始爽点/)).toBeDefined();
  });

  // ── Table-driven: all xiaofeiji-novel-flow steps ──

  const stepNavigationCases = [
    { step: 1, name: '脑洞灵感闪耀', nextName: '世界观架构设定', navigateTo: 'bible' },
    { step: 2, name: '世界观架构设定', nextName: '核心角色人设卡', navigateTo: 'bible' },
    { step: 3, name: '核心角色人设卡', nextName: '大纲骨架与主线设计', navigateTo: 'outline' },
    { step: 4, name: '大纲骨架与主线设计', nextName: '故事细纲与高潮铺设', navigateTo: 'outline' },
    { step: 5, name: '故事细纲与高潮铺设', nextName: '章纲逐章展开', navigateTo: 'planning' },
    { step: 6, name: '章纲逐章展开', nextName: '高质量正文起步', navigateTo: 'production' },
    { step: 7, name: '高质量正文起步', nextName: '正文去AI润色', navigateTo: 'quality' },
  ];

  test.each(stepNavigationCases)(
    'step$step ($name) → nextStep navigateTo:$navigateTo',
    async ({ step, nextName, navigateTo }) => {
      const onPreferenceProfileChange = vi.fn().mockResolvedValue(undefined);
      const onSwitchTab = vi.fn();

      const stepNovel = {
        ...mockNovel,
        projectPreferenceProfile: {
          ...mockNovel.projectPreferenceProfile,
          tags: [`current-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step${step}`],
        },
      };

      render(
        <PlanningTab
          {...defaultProps}
          novel={stepNovel as any}
          onPreferenceProfileChange={onPreferenceProfileChange}
          onSwitchTab={onSwitchTab}
        />
      );

      // Button should reference the correct next step name
      expect(screen.getByText(new RegExp(nextName))).toBeDefined();
      await clickAdvance();
      expect(onSwitchTab).toHaveBeenCalledWith(navigateTo);
    }
  );
});
