import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { Skill } from '../../shared/types';
import { SkillTestBench } from '../components/skills/SkillTestBench';

function savedCard(): Skill {
  return {
    id: 'saved-card',
    name: '已保存文风卡',
    description: '测试卡',
    style: '短句推进',
    pacing: '紧凑',
    stabilityScore: 80,
    evaluationFeedback: '',
    version: 1,
    createdAt: 1,
    sourceBadge: 'book-extracted',
    executionScore: 80,
    deconstructionCardType: 'style-card',
  };
}

function streamResponse(): Response {
  return new Response('data: {"type":"done","text":"试跑结果"}\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('SkillTestBench request contract', () => {
  test('sends scoped trusted card context instead of client skill objects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse());
    vi.stubGlobal('fetch', fetchMock);
    const card = savedCard();
    render(
      <SkillTestBench
        baseSkill={card}
        candidates={[]}
        allSkills={[card]}
        novelId="novel-1"
        chapterId="chapter-1"
        databaseGeneration={7}
        styleConfirmationFingerprint="confirmed-style"
      />,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '林舟推开城门，门后传来一声不属于人的低语。' } });
    fireEvent.click(screen.getByRole('button', { name: '运行当前版本' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(payload).toMatchObject({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      databaseGeneration: 7,
      sessionCardIds: ['saved-card'],
      styleConfirmationFingerprint: 'confirmed-style',
    });
    expect(payload.skills).toBeUndefined();
    expect(await screen.findByText('试跑结果')).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
