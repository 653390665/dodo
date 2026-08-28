import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SkillsStudioView } from '../components/SkillsStudioView';

vi.mock('../lib/skill-client', () => ({
  syncSkillFeedbackScores: vi.fn().mockResolvedValue([]),
  deleteSkill: vi.fn(),
  createSkill: vi.fn(),
}));

vi.mock('../lib/novel-client', () => ({
  listNovels: vi.fn().mockResolvedValue([]),
  updateNovel: vi.fn(),
}));

vi.mock('../lib/db-transport', () => ({
  subscribeToChanges: vi.fn(() => () => undefined),
}));

vi.mock('../lib/product-events-client', () => ({
  createProductEventSessionId: vi.fn((scope = 'session') => `${scope}:test-session`),
  createProductEventId: vi.fn((action: string, sessionId = 'session:test-session') => `event:${sessionId}:${action}`),
  recordProductEvent: vi.fn().mockResolvedValue(undefined),
}));

describe('SkillsStudioView product boundary', () => {
  test('labels the page as the long-lived work capability center', async () => {
    render(<SkillsStudioView selectedNovel={null} />);

    expect(await screen.findByRole('heading', { name: '作品能力中心' })).toBeTruthy();
    expect(screen.getByText(/管理作品默认能力与本章写法/)).toBeTruthy();
  });

  test('returns an editor-origin visit to the current chapter', async () => {
    const onNavigate = vi.fn();
    render(<SkillsStudioView selectedNovel={{ id: 'novel-1', title: '作品', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 }} returnView="editor" targetChapterId="chapter-1" onNavigate={onNavigate} />);

    expect(await screen.findByText('能力配置会带回刚才那一章，不需要重新找章节。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '回到刚才章节写作' }));
    expect(onNavigate).toHaveBeenCalledWith('editor');
  });
});
