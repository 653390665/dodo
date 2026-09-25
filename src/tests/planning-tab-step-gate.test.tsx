/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { PlanningTab } from '../components/book-factory/PlanningTab';
import { getNovelSkippedSteps } from '../../shared/lib/flow-step-gate';

vi.mock('../components/ui/app-confirm', () => ({
  appConfirm: vi.fn(async () => true),
  appPrompt: vi.fn(async () => ''),
}));

import { appPrompt } from '../components/ui/app-confirm';

const GENERIC_STEP5 = 'current-step:generic-novel-flow:generic-novel-flow-step5';
const GENERIC_STEP6 = 'current-step:generic-novel-flow:generic-novel-flow-step6';

function buildNovel(tags: string[]) {
  return {
    id: 'novel-gate',
    title: '质量门测试',
    projectPreferenceProfile: {
      tags,
      weights: {
        styleWeight: 0.2,
        characterWeight: 0.2,
        worldWeight: 0.2,
        plotWeight: 0.2,
        pacingWeight: 0.2,
      },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
    },
  } as any;
}

const mockCurrentChapter = {
  id: 'ch-1',
  novelId: 'novel-gate',
  title: '第一章',
  content: '',
  sceneBeats: '',
  wordCount: 0,
  order: 1,
  createdAt: 0,
  updatedAt: 0,
} as any;

function baseProps(novel: any, stepEvidence: any) {
  return {
    renderContextReceipt: () => <div data-testid="context-receipt" />,
    currentChapter: mockCurrentChapter,
    onGenerateBeats: vi.fn().mockResolvedValue(undefined),
    isGeneratingBeats: false,
    onGenerateContent: vi.fn().mockResolvedValue(undefined),
    isGeneratingContent: false,
    onRewriteSelectedText: vi.fn().mockResolvedValue(undefined),
    onUpdateChapterBeats: vi.fn(),
    novel,
    stepEvidence,
  };
}

async function clickAdvance() {
  fireEvent.click(screen.getByText(/完成本步并前往|完成全流程创作/));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

async function clickSkip() {
  fireEvent.click(screen.getByText('记录原因并跳过本步'));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe('PlanningTab 步骤质量门判定与推进拦截', () => {
  beforeEach(() => {
    vi.mocked(appPrompt).mockReset();
    vi.mocked(appPrompt).mockResolvedValue('');
  });

  test('mechanical 门：草稿未过质量门时推进被拒（标签未写入）', async () => {
    const onPreferenceProfileChange = vi.fn().mockResolvedValue(undefined);
    render(
      <PlanningTab
        {...baseProps(buildNovel([GENERIC_STEP5]), { draftText: '他只说了一句话。' })}
        onPreferenceProfileChange={onPreferenceProfileChange}
      />
    );

    expect(screen.getByText(/可判定质量门：mechanical/)).toBeTruthy();
    await clickAdvance();

    expect(onPreferenceProfileChange).not.toHaveBeenCalled();
    expect(screen.getByText(/质量门未通过：/)).toBeTruthy();
  });

  test('mechanical 门：无草稿证据时同样不放行', async () => {
    const onPreferenceProfileChange = vi.fn().mockResolvedValue(undefined);
    render(
      <PlanningTab
        {...baseProps(buildNovel([GENERIC_STEP5]), { draftChars: 0 })}
        onPreferenceProfileChange={onPreferenceProfileChange}
      />
    );

    await clickAdvance();

    expect(onPreferenceProfileChange).not.toHaveBeenCalled();
    expect(screen.getByText(/质量门未通过：/)).toBeTruthy();
  });

  test('critic 门：分数低于阈值时推进被拒，原因含分数与阈值', async () => {
    const onPreferenceProfileChange = vi.fn().mockResolvedValue(undefined);
    render(
      <PlanningTab
        {...baseProps(buildNovel([GENERIC_STEP6]), {
          critic: { status: 'pass', score: 62 },
        })}
        onPreferenceProfileChange={onPreferenceProfileChange}
      />
    );

    expect(screen.getByText(/可判定质量门：critic（阈值 80）/)).toBeTruthy();
    await clickAdvance();

    expect(onPreferenceProfileChange).not.toHaveBeenCalled();
    expect(screen.getAllByText(/62/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/低于阈值 80/).length).toBeGreaterThan(0);
  });

  test('critic 门：审稿 unknown 时不放行（不能确认就不放行）', async () => {
    const onPreferenceProfileChange = vi.fn().mockResolvedValue(undefined);
    render(
      <PlanningTab
        {...baseProps(buildNovel([GENERIC_STEP6]), { critic: { status: 'unknown' } })}
        onPreferenceProfileChange={onPreferenceProfileChange}
      />
    );

    await clickAdvance();

    expect(onPreferenceProfileChange).not.toHaveBeenCalled();
    expect(screen.getAllByText(/不可验证/).length).toBeGreaterThan(0);
  });

  test('critic 门：pass 且分数达标时推进成功', async () => {
    const onPreferenceProfileChange = vi.fn().mockResolvedValue(undefined);
    render(
      <PlanningTab
        {...baseProps(buildNovel([GENERIC_STEP6]), {
          critic: { status: 'pass', score: 88 },
        })}
        onPreferenceProfileChange={onPreferenceProfileChange}
      />
    );

    await clickAdvance();

    expect(onPreferenceProfileChange).toHaveBeenCalledTimes(1);
    const saved = onPreferenceProfileChange.mock.calls[0][0];
    expect(saved.tags).toContain('completed-step:generic-novel-flow:generic-novel-flow-step6');
    expect(saved.tags).toContain('completed-flow:generic-novel-flow');
  });

  test('跳过路径：空原因不跳过，非空原因写入标签且可查询', async () => {
    const onPreferenceProfileChange = vi.fn().mockResolvedValue(undefined);
    const novel = buildNovel([GENERIC_STEP5]);
    render(
      <PlanningTab
        {...baseProps(novel, { draftText: '太短。' })}
        onPreferenceProfileChange={onPreferenceProfileChange}
      />
    );

    // 空原因（用户取消）→ 不推进
    await clickSkip();
    expect(onPreferenceProfileChange).not.toHaveBeenCalled();

    // 记录原因 → 推进并留下可查询的跳过记录
    vi.mocked(appPrompt).mockResolvedValue('初稿未定稿，先推进流程');
    await clickSkip();

    expect(onPreferenceProfileChange).toHaveBeenCalledTimes(1);
    const saved = onPreferenceProfileChange.mock.calls[0][0];
    expect(saved.tags).toContain('completed-step:generic-novel-flow:generic-novel-flow-step5');
    expect(saved.tags).toContain('current-step:generic-novel-flow:generic-novel-flow-step6');
    expect(saved.tags).toContain(
      'skipped-step:generic-novel-flow:generic-novel-flow-step5:初稿未定稿，先推进流程'
    );
    expect(getNovelSkippedSteps({ ...novel, projectPreferenceProfile: saved } as any, 'generic-novel-flow')).toEqual([
      { stepId: 'generic-novel-flow-step5', reason: '初稿未定稿，先推进流程' },
    ]);
  });

  test('未声明 gate 的步骤：无判定 UI，推进行为不变', async () => {
    const onPreferenceProfileChange = vi.fn().mockResolvedValue(undefined);
    render(
      <PlanningTab
        {...baseProps(
          buildNovel(['current-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step1']),
          undefined
        )}
        onPreferenceProfileChange={onPreferenceProfileChange}
      />
    );

    expect(screen.queryByText(/可判定质量门/)).toBeNull();
    await clickAdvance();

    expect(onPreferenceProfileChange).toHaveBeenCalledTimes(1);
    const saved = onPreferenceProfileChange.mock.calls[0][0];
    expect(saved.tags).toContain('completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step1');
    expect(saved.tags).toContain('current-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step2');
  });
});
