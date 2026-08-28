import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const storeMock = vi.hoisted(() => {
  const session = { messages: [], input: '', draft: null, isLoading: false, activeRequestId: null };
  const state = {
    getSession: vi.fn(() => session),
    setMessages: vi.fn(),
    setInput: vi.fn(),
    setDraft: vi.fn(),
    appendMessage: vi.fn(),
    updateMessage: vi.fn(),
    setLoading: vi.fn(),
    clearSession: vi.fn(),
    startRequest: vi.fn(() => 'request-1'),
    finishRequest: vi.fn(),
  };
  const hook = (selector: (value: typeof state) => unknown) => selector(state);
  hook.getState = () => state;
  return { hook, state };
});

vi.mock('../stores/assistant-session-store', () => ({ useAssistantSessionStore: storeMock.hook }));
vi.mock('../lib/world-client', () => ({
  listCharacters: vi.fn(), listLocations: vi.fn(), listItems: vi.fn(), listFactions: vi.fn(),
  listPowerLevels: vi.fn(), listTimelineEvents: vi.fn(), createCharacter: vi.fn(), createLocation: vi.fn(),
  createItem: vi.fn(), createFaction: vi.fn(), createPowerLevel: vi.fn(), createTimelineEvent: vi.fn(),
}));

import { WorldBibleAssistant } from '../components/WorldBibleAssistant';

describe('WorldBibleAssistant accessibility', () => {
  beforeEach(() => vi.clearAllMocks());

  test('names the inspiration textbox and exposes polite live updates', () => {
    render(<WorldBibleAssistant novel={{ id: 'novel-1', title: '测试作品' } as never} onClose={vi.fn()} />);

    expect(screen.getByRole('textbox', { name: '输入设定灵感' })).toBeTruthy();
    expect(screen.getByRole('log').getAttribute('aria-live')).toBe('polite');
  });
});
