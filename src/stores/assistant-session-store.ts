import { create } from 'zustand';
import type { AssistantActionPlan, AssistantMode } from '../../shared/types';

export interface AssistantMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  text: string;
  actionPlan?: AssistantActionPlan;
}

export interface AssistantFailure {
  code: string;
  message: string;
  prompt: string;
  failedAt: number;
  requestId: string;
  retriable: boolean;
  reason?: 'no_content' | 'reasoning_only' | 'length_exhausted';
  finishReason?: string;
  traceId?: string;
}

export interface AssistantSession {
  messages: AssistantMessage[];
  input: string;
  draft: unknown | null;
  isLoading: boolean;
  activeRequestId: string | null;
  failure: AssistantFailure | null;
}

interface AssistantSessionState {
  getSession: (novelId: string, mode: AssistantMode) => AssistantSession;
  setInput: (novelId: string, mode: AssistantMode, input: string) => void;
  setDraft: (novelId: string, mode: AssistantMode, draft: unknown | null) => void;
  setMessages: (novelId: string, mode: AssistantMode, messages: AssistantMessage[]) => void;
  appendMessage: (novelId: string, mode: AssistantMode, message: AssistantMessage) => void;
  updateMessage: (novelId: string, mode: AssistantMode, messageId: string, update: Partial<AssistantMessage>) => void;
  removeMessage: (novelId: string, mode: AssistantMode, messageId: string) => void;
  setLoading: (novelId: string, mode: AssistantMode, isLoading: boolean) => void;
  clearSession: (novelId: string, mode: AssistantMode) => void;
  startRequest: (novelId: string, mode: AssistantMode) => string;
  applyResponse: (novelId: string, mode: AssistantMode, requestId: string, text: string, actionPlan?: AssistantActionPlan) => boolean;
  finishRequest: (novelId: string, mode: AssistantMode, requestId?: string) => void;
  setFailure: (novelId: string, mode: AssistantMode, failure: AssistantFailure) => void;
  clearFailure: (novelId: string, mode: AssistantMode) => void;
}

const emptySession = (): AssistantSession => ({
  messages: [],
  input: '',
  draft: null,
  isLoading: false,
  activeRequestId: null,
  failure: null,
});

const sessionKey = (novelId: string, mode: AssistantMode) => `${novelId}:${mode}`;
let requestSequence = 0;

export const useAssistantSessionStore = create<AssistantSessionState>((set) => {
  const sessions = new Map<string, AssistantSession>();
  const read = (novelId: string, mode: AssistantMode) => {
    const key = sessionKey(novelId, mode);
    const existing = sessions.get(key);
    if (existing) return existing;
    const session = emptySession();
    sessions.set(key, session);
    return session;
  };
  const write = (novelId: string, mode: AssistantMode, update: (session: AssistantSession) => AssistantSession) => {
    const key = sessionKey(novelId, mode);
    sessions.set(key, update(read(novelId, mode)));
    set({});
  };

  return {
    getSession: (novelId, mode) => read(novelId, mode),
    setInput: (novelId, mode, input) => write(novelId, mode, (session) => ({ ...session, input })),
    setDraft: (novelId, mode, draft) => write(novelId, mode, (session) => ({ ...session, draft })),
    setMessages: (novelId, mode, messages) => write(novelId, mode, (session) => ({ ...session, messages: [...messages] })),
    appendMessage: (novelId, mode, message) => write(novelId, mode, (session) => ({ ...session, messages: [...session.messages, message] })),
    updateMessage: (novelId, mode, messageId, update) => write(novelId, mode, (session) => ({
      ...session,
      messages: session.messages.map((message) => message.id === messageId ? { ...message, ...update } : message),
    })),
    removeMessage: (novelId, mode, messageId) => write(novelId, mode, (session) => ({
      ...session,
      messages: session.messages.filter((message) => message.id !== messageId),
    })),
    setLoading: (novelId, mode, isLoading) => write(novelId, mode, (session) => ({ ...session, isLoading })),
    clearSession: (novelId, mode) => { sessions.delete(sessionKey(novelId, mode)); set({}); },
    startRequest: (novelId, mode) => {
      const requestId = `${sessionKey(novelId, mode)}:${++requestSequence}`;
      write(novelId, mode, (session) => ({ ...session, isLoading: true, activeRequestId: requestId }));
      return requestId;
    },
    applyResponse: (novelId, mode, requestId, text, actionPlan) => {
      if (read(novelId, mode).activeRequestId !== requestId) return false;
      write(novelId, mode, (session) => ({
        ...session,
        messages: [...session.messages, { id: `${requestId}:response`, sender: 'assistant', text, actionPlan }],
      }));
      return true;
    },
    finishRequest: (novelId, mode, requestId) => write(novelId, mode, (session) => {
      if (requestId && session.activeRequestId !== requestId) return session;
      return { ...session, isLoading: false, activeRequestId: null };
    }),
    setFailure: (novelId, mode, failure) => write(novelId, mode, (session) => ({ ...session, failure })),
    clearFailure: (novelId, mode) => write(novelId, mode, (session) => ({ ...session, failure: null })),
  };
});
