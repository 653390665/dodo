import { describe, expect, test } from 'vitest';
import { useAssistantSessionStore } from '../stores/assistant-session-store';

describe('作品级助手会话', () => {
  test('缺失 session 的连续读取应返回同一快照引用', () => {
    const store = useAssistantSessionStore.getState();
    const first = store.getSession('novel-missing', 'general');
    const second = store.getSession('novel-missing', 'general');

    expect(first).toBe(second);
  });

  test('写入一个 session 不会污染其他缺失 session', () => {
    const store = useAssistantSessionStore.getState();
    const other = store.getSession('novel-other', 'general');

    store.setMessages('novel-written', 'general', [{ id: 'message-1', sender: 'user', text: '内容' }]);

    expect(store.getSession('novel-written', 'general').messages).toHaveLength(1);
    expect(store.getSession('novel-other', 'general')).toBe(other);
    expect(other.messages).toHaveLength(0);
  });

  test('按 novelId + mode 隔离，并在切换模式时保留各自输入和草稿', () => {
    const store = useAssistantSessionStore.getState();
    store.setInput('novel-1', 'general', '正文问题');
    store.setDraft('novel-1', 'general', '正文草稿');
    store.setInput('novel-1', 'bible', '设定问题');
    store.setDraft('novel-1', 'bible', '设定草稿');

    expect(store.getSession('novel-1', 'general')).toMatchObject({ input: '正文问题', draft: '正文草稿' });
    expect(store.getSession('novel-1', 'bible')).toMatchObject({ input: '设定问题', draft: '设定草稿' });
    expect(store.getSession('novel-2', 'general')).not.toEqual(store.getSession('novel-1', 'general'));
  });

  test('旧 requestId 或 novelId 的迟到结果不会写入当前 session', () => {
    const store = useAssistantSessionStore.getState();
    store.setInput('novel-1', 'general', '当前输入');
    store.setDraft('novel-1', 'general', '当前草稿');
    const requestId = store.startRequest('novel-1', 'general');
    expect(store.applyResponse('novel-1', 'general', `old-${requestId}`, '旧结果')).toBe(false);
    expect(store.applyResponse('novel-old', 'general', requestId, '串作品结果')).toBe(false);
    expect(store.getSession('novel-1', 'general')).toMatchObject({ input: '当前输入', draft: '当前草稿' });
  });

  test('failure 可透传输出原因、结束原因和诊断编号', () => {
    const store = useAssistantSessionStore.getState();
    store.setFailure('novel-diagnostic', 'general', {
      code: 'empty_response', message: '请求失败', prompt: '不可展示', failedAt: 1,
      requestId: 'request-1', retriable: true, reason: 'reasoning_only',
      finishReason: 'length', traceId: 'trace-123',
    });

    expect(store.getSession('novel-diagnostic', 'general').failure).toMatchObject({
      reason: 'reasoning_only', finishReason: 'length', traceId: 'trace-123',
    });
  });
});
