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

// ── Tests ─────────────────────────────────────────────────────────

describe('PlanningTab Step Progression', () => {
  beforeEach(() => {
    // Mocks cleared per test by vitest
  });

  test('displays step 1 with correct button text', () => {
    render(<PlanningTab {...defaultProps} />);

    // Should show step 1 name
    expect(screen.getByText('脑洞灵感闪耀')).toBeDefined();
    // Should show next step name in button
    expect(screen.getByText(/世界观架构设定/)).toBeDefined();
  });

  test('clicking advance calls onPreferenceProfileChange with step1 completed and step2 current', async () => {
    const onPreferenceProfileChange = vi.fn().mockResolvedValue(undefined);
    const onSwitchTab = vi.fn();

    render(
      <PlanningTab
        {...defaultProps}
        onPreferenceProfileChange={onPreferenceProfileChange}
        onSwitchTab={onSwitchTab}
      />
    );

    const advanceBtn = screen.getByText(/完成本步并前往/);
    fireEvent.click(advanceBtn);

    // Wait for async handler
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    expect(onPreferenceProfileChange).toHaveBeenCalledTimes(1);

    const updatedProfile = onPreferenceProfileChange.mock.calls[0][0];
    const tags = updatedProfile.tags as string[];

    // Step1 should be completed
    expect(tags).toContain('completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step1');
    // Step2 should be current
    expect(tags).toContain('current-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step2');
    // Old current-step1 should be removed
    expect(tags).not.toContain('current-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step1');

    // Step1 (脑洞灵感闪耀) has NO navigateTo → stay on planning tab
    expect(onSwitchTab).not.toHaveBeenCalled();
  });

  test('step with navigateTo navigates to the correct tab after save', async () => {
    const onPreferenceProfileChange = vi.fn().mockResolvedValue(undefined);
    const onSwitchTab = vi.fn();

    // Mock novel on step2 (世界观架构设定 → navigateTo: 'bible')
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

    const advanceBtn = screen.getByText(/完成本步并前往/);
    fireEvent.click(advanceBtn);

    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Step2 has navigateTo: 'bible'
    expect(onSwitchTab).toHaveBeenCalledWith('bible');
  });

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

    // Button should show saving state
    expect(screen.getByText('保存中...')).toBeDefined();
    expect((advanceBtn as HTMLButtonElement).disabled).toBe(true);

    // Resolve save
    await act(async () => {
      resolveSave(undefined);
      await new Promise(r => setTimeout(r, 50));
    });

    // Button should be re-enabled
    expect(screen.queryByText('保存中...')).toBeNull();
    expect((screen.getByText(/完成本步并前往/) as HTMLButtonElement).disabled).toBe(false);
  });

  test('double-click only produces one save call', async () => {
    const onPreferenceProfileChange = vi.fn().mockResolvedValue(undefined);

    render(
      <PlanningTab
        {...defaultProps}
        onPreferenceProfileChange={onPreferenceProfileChange}
      />
    );

    const advanceBtn = screen.getByText(/完成本步并前往/);

    // Click twice rapidly
    fireEvent.click(advanceBtn);
    fireEvent.click(advanceBtn);

    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Should only have been called once
    expect(onPreferenceProfileChange).toHaveBeenCalledTimes(1);
  });

  test('save failure displays error and does not switch tabs', async () => {
    const onPreferenceProfileChange = vi.fn().mockRejectedValue(new Error('Network error'));
    const onSwitchTab = vi.fn();

    render(
      <PlanningTab
        {...defaultProps}
        onPreferenceProfileChange={onPreferenceProfileChange}
        onSwitchTab={onSwitchTab}
      />
    );

    const advanceBtn = screen.getByText(/完成本步并前往/);
    fireEvent.click(advanceBtn);

    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Error should be displayed
    expect(screen.getByText(/Network error|保存失败/)).toBeDefined();

    // Should NOT switch tabs on failure
    expect(onSwitchTab).not.toHaveBeenCalled();

    // Button should be re-enabled for retry
    expect((screen.getByText(/完成本步并前往/) as HTMLButtonElement).disabled).toBe(false);
  });

  test('last step shows "完成全流程创作" and does not switch tabs', async () => {
    const onPreferenceProfileChange = vi.fn().mockResolvedValue(undefined);
    const onSwitchTab = vi.fn();

    // Mock novel with profile on the LAST step (step8 has nextStepId: null)
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

    // Should show last step button text
    expect(screen.getByText('完成全流程创作')).toBeDefined();
    expect(screen.queryByText(/完成本步并前往/)).toBeNull();

    const finishBtn = screen.getByText('完成全流程创作');
    fireEvent.click(finishBtn);

    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Should mark step8 as completed
    const updatedProfile = onPreferenceProfileChange.mock.calls[0][0];
    const tags = updatedProfile.tags as string[];
    expect(tags).toContain('completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step8');

    // Should add completed-flow tag (T3: prevent fallback to step 1)
    expect(tags).toContain('completed-flow:xiaofeiji-novel-flow');

    // Should NOT add a new current-step (no next step)
    const currentStepTags = tags.filter((t: string) => t.startsWith('current-step:'));
    expect(currentStepTags.length).toBe(0);

    // Step8 has navigateTo: 'quality' → should switch to quality tab
    expect(onSwitchTab).toHaveBeenCalledWith('quality');
  });

  test('displayStepNumber and total steps shown correctly', () => {
    render(<PlanningTab {...defaultProps} />);

    // Should show "步骤 1 / 8" (the xiaofeiji-novel-flow has 8 steps)
    const stepIndicator = screen.getByText((content) => {
      return content.includes('步骤') && content.includes('/') && content.includes('8');
    });
    expect(stepIndicator).toBeDefined();
  });

  test('step name and quality gate are displayed', () => {
    render(<PlanningTab {...defaultProps} />);

    expect(screen.getByText('脑洞灵感闪耀')).toBeDefined();
    expect(screen.getByText(/脑洞概念成型且具备初始爽点/)).toBeDefined();
  });

  test('flow completed state shows completion banner', () => {
    const flowCompletedNovel = {
      ...mockNovel,
      projectPreferenceProfile: {
        ...mockNovel.projectPreferenceProfile,
        tags: [
          'completed-flow:xiaofeiji-novel-flow',
          'current-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step8',
          'completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step1',
          'completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step2',
          'completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step3',
          'completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step4',
          'completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step5',
          'completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step6',
          'completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step7',
          'completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step8',
        ],
      },
    };

    render(
      <PlanningTab
        {...defaultProps}
        novel={flowCompletedNovel as any}
      />
    );

    // Should show completion banner
    expect(screen.getByText(/全流程已完成/)).toBeDefined();
    // Button should show last step state
    expect(screen.getByText('完成全流程创作')).toBeDefined();
  });

  test('completed-flow tag prevents fallback to step 1', () => {
    // Simulate state after last step save: completed-flow exists,
    // no current-step tag (but UI should still show last step)
    const flowCompletedNovel = {
      ...mockNovel,
      projectPreferenceProfile: {
        ...mockNovel.projectPreferenceProfile,
        tags: [
          'completed-flow:xiaofeiji-novel-flow',
          'completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step8',
        ],
      },
    };

    render(
      <PlanningTab
        {...defaultProps}
        novel={flowCompletedNovel as any}
      />
    );

    // Should NOT show step 1 (脑洞灵感闪耀)
    expect(screen.queryByText('脑洞灵感闪耀')).toBeNull();
    // Should show last step name
    expect(screen.getByText('正文去AI润色')).toBeDefined();
    // Should show completion banner
    expect(screen.getByText(/全流程已完成/)).toBeDefined();
  });
});
