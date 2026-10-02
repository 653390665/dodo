import { describe, expect, test } from 'vitest';

import { criticProgressMessage } from '../lib/production-critic-progress';

describe('criticProgressMessage (plan 275)', () => {
  test('renders the running round', () => {
    expect(
      criticProgressMessage({ type: 'model_critic_progress', attempt: 1, stage: 'start' })
    ).toBe('AI 正在审稿（第 1 轮）…');
  });

  test('renders the retry round with its reason', () => {
    expect(
      criticProgressMessage({
        type: 'model_critic_progress',
        attempt: 2,
        stage: 'retry',
        reason: '证据四类不全',
      })
    ).toBe('AI 审稿重试中（第 2 轮）：证据四类不全…');
  });

  test('renders the resolved score', () => {
    expect(
      criticProgressMessage({ type: 'model_critic_progress', attempt: 1, stage: 'parsed', score: 88 })
    ).toBe('AI 审稿出分（第 1 轮）：88/100，正在整理结论…');
  });

  test('renders an unresolved audit with its reason', () => {
    expect(
      criticProgressMessage({
        type: 'model_critic_progress',
        attempt: 2,
        stage: 'unknown',
        reason: '审计请求失败',
      })
    ).toBe('AI 审稿未能定分（第 2 轮）：审计请求失败…');
  });
});
