import { describe, expect, it } from 'vitest';
import {
  createAiActionError,
  createAiActionRunning,
  createAiActionSuccess,
  idleAiAction,
  type AiActionState,
} from '../lib/generation-action-state';

describe('AI action state', () => {
  it('preserves operation and start time while an action is running', () => {
    const state = createAiActionRunning('draft', 1000);

    expect(state).toEqual({
      status: 'running',
      operation: 'draft',
      startedAt: 1000,
      elapsedMs: 0,
      retryable: false,
      message: '正在生成正文…',
    });
  });

  it('records a complete result so the accept action can stay gated by status', () => {
    const running = createAiActionRunning('polish', 1000);
    const state = createAiActionSuccess(running, '精修预览已生成。', 2450);

    expect(state.status).toBe('success');
    expect(state.operation).toBe('polish');
    expect(state.elapsedMs).toBe(1450);
    expect(state.retryable).toBe(false);
  });

  it('keeps a retryable error without dropping the operation context', () => {
    const running = createAiActionRunning('audit', 1000);
    const state: AiActionState = createAiActionError(running, '请求超时，请重试。', 5000, true, 'PROMPT_TEST_TIMEOUT');

    expect(state).toMatchObject({
      status: 'error',
      operation: 'audit',
      message: '请求超时，请重试。',
      elapsedMs: 4000,
      retryable: true,
      errorCode: 'PROMPT_TEST_TIMEOUT',
    });
  });

  it('resets to idle when a chapter changes or an action is cancelled', () => {
    expect(idleAiAction()).toEqual({ status: 'idle' });
  });
});
