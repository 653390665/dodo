import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ChapterCapabilityFeedbackBar } from '../components/ChapterCapabilityFeedbackBar';

const createRecord = vi.fn().mockResolvedValue(undefined);
const syncScores = vi.fn().mockResolvedValue([]);

vi.mock('../lib/skill-client', () => ({
  createSkillUsageRecord: (...args: unknown[]) => createRecord(...(args as [])),
  syncSkillFeedbackScores: () => syncScores(),
}));

describe('ChapterCapabilityFeedbackBar（plan 241）', () => {
  beforeEach(() => {
    createRecord.mockClear();
    syncScores.mockClear();
    window.localStorage.clear();
  });

  test('本章挂卡时渲染三条轻量反馈；空挂卡不渲染', () => {
    const { unmount } = render(
      <ChapterCapabilityFeedbackBar
        novelId="n1"
        chapterId="c1"
        cardIds={['card-a', 'card-b']}
      />
    );
    expect(screen.getByTestId('capability-feedback-bar').textContent).toContain('2 张能力卡');
    unmount();

    render(
      <ChapterCapabilityFeedbackBar novelId="n1" chapterId="c1" cardIds={[]} />
    );
    expect(screen.queryByTestId('capability-feedback-bar')).toBeNull();
  });

  test('单击提交：映射 userAction/fitScore 落 usage record 并立即聚合，随后消失', async () => {
    render(
      <ChapterCapabilityFeedbackBar
        novelId="n1"
        chapterId="c1"
        cardIds={['card-a', 'card-b']}
      />
    );
    fireEvent.click(screen.getByTestId('capability-feedback-unhelpful'));

    await waitFor(() => expect(createRecord).toHaveBeenCalledTimes(1));
    const record = createRecord.mock.calls[0][0] as {
      userAction: string;
      fitScore: number;
      mountedSkillIds: string[];
      chapterId: string;
      novelId: string;
    };
    expect(record.userAction).toBe('rejected');
    expect(record.fitScore).toBe(15);
    expect(record.mountedSkillIds).toEqual(['card-a', 'card-b']);
    expect(record.chapterId).toBe('c1');
    expect(record.novelId).toBe('n1');
    await waitFor(() => expect(syncScores).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('capability-feedback-bar')).toBeNull());
  });

  test('本章已提交/忽略后不再渲染（localStorage 幂等）；忽略不落记录', () => {
    window.localStorage.setItem('capability-feedback-done:c1', '1');
    render(
      <ChapterCapabilityFeedbackBar novelId="n1" chapterId="c1" cardIds={['card-a']} />
    );
    expect(screen.queryByTestId('capability-feedback-bar')).toBeNull();

    render(
      <ChapterCapabilityFeedbackBar novelId="n1" chapterId="c2" cardIds={['card-a']} />
    );
    fireEvent.click(screen.getByTestId('capability-feedback-dismiss'));
    expect(createRecord).not.toHaveBeenCalled();
    expect(screen.queryByTestId('capability-feedback-bar')).toBeNull();
    expect(window.localStorage.getItem('capability-feedback-dismissed:c2')).toBe('1');
  });
});
