import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Novel } from '../../shared/types';

// Plan 184：消息行 memo 回归守卫。
// 计数器在 ReactMarkdown mock 内自增——每次真实渲染（含 memo 失效导致的重渲染）都会 +1。
const testState = vi.hoisted(() => ({ markdownRenderCount: 0 }));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children?: unknown }) => {
    testState.markdownRenderCount += 1;
    return <div data-testid="assistant-markdown">{String(children)}</div>;
  },
}));

vi.mock('../lib/novel-client', () => ({
  listNovels: vi.fn().mockReturnValue(new Promise(() => {})),
}));
vi.mock('../lib/db-transport', () => ({ subscribeToChanges: vi.fn().mockReturnValue(() => {}) }));
vi.mock('../lib/prompt-client', () => ({ generateInspiration: vi.fn().mockResolvedValue('') }));
vi.mock('../lib/agents', () => ({ extractWorldSetupPhase: vi.fn() }));
vi.mock('../lib/world-client', () => ({ importWorldExtraction: vi.fn() }));
vi.mock('../lib/product-events-client', () => ({
  recordProductEvent: vi.fn().mockResolvedValue(undefined),
}));

import { AIAssistant } from '../components/AIAssistant';
import { useAssistantSessionStore } from '../stores/assistant-session-store';

const novelA: Novel = {
  id: 'novel-memo',
  title: '作品 A',
  authorId: 'local',
  summary: '',
  status: 'ongoing',
  createdAt: 1,
  updatedAt: 1,
};

function seedThreeMessages(): void {
  useAssistantSessionStore.getState().setMessages(novelA.id, 'general', [
    { id: 'm1', sender: 'assistant', text: '第一条建议' },
    { id: 'm2', sender: 'assistant', text: '第二条建议' },
    { id: 'm3', sender: 'assistant', text: '第三条建议' },
  ]);
}

describe('AssistantMessageRow memo (Plan 184)', () => {
  beforeEach(() => {
    useAssistantSessionStore.getState().clearSession(novelA.id, 'general');
    testState.markdownRenderCount = 0;
  });

  test('输入键入不触发已渲染消息行的 ReactMarkdown 重渲染', () => {
    seedThreeMessages();
    render(<AIAssistant activeNovel={novelA} />);
    const initialCount = testState.markdownRenderCount;
    expect(initialCount).toBeGreaterThanOrEqual(3);

    const input = screen.getByPlaceholderText('创作困惑？');
    fireEvent.change(input, { target: { value: '打字中' } });
    fireEvent.change(input, { target: { value: '打字中……' } });

    // 消息行 memo 命中：session.input 变化只重渲染输入区，ReactMarkdown 不再渲染
    expect(testState.markdownRenderCount).toBe(initialCount);
  });

  test('无关 prop 变化重渲染不增加 ReactMarkdown 渲染次数', () => {
    seedThreeMessages();
    const view = render(<AIAssistant activeNovel={novelA} />);
    const initialCount = testState.markdownRenderCount;
    expect(initialCount).toBeGreaterThanOrEqual(3);

    view.rerender(<AIAssistant activeNovel={novelA} onClose={() => {}} />);

    expect(testState.markdownRenderCount).toBe(initialCount);
  });
});
