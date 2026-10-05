import { describe, expect, test } from 'vitest';
import {
  runBudgetMessage,
  type ProductionRunBudgetEvent,
} from '../lib/production-budget-progress';

const base: ProductionRunBudgetEvent = {
  type: 'model_run_budget',
  stage: 'gate-fail',
  elapsedMs: 903_000,
  budgetMs: 900_000,
};

describe('runBudgetMessage', () => {
  test('tells the author the clock stopped the retries and what ships now', () => {
    const message = runBudgetMessage(base);
    expect(message).toContain('已到本次生成的时间上限');
    expect(message).toContain('15.1 分钟 / 上限 15 分钟');
    expect(message).toContain('停止再次重写');
    expect(message).toContain('交付当前最好的一稿供你审阅');
  });
  test('names the critic-retry stop', () => {
    expect(runBudgetMessage({ ...base, stage: 'critic-retry' })).toContain('停止审稿重试');
  });
  test('falls back to a generic hint for an unknown stage', () => {
    expect(runBudgetMessage({ ...base, stage: 'something-new' })).toContain('停止继续重试');
  });
  test('never renders a zero-minute budget', () => {
    const message = runBudgetMessage({ ...base, elapsedMs: 1_000, budgetMs: 0 });
    expect(message).toContain('0.1 分钟 / 上限 0.1 分钟');
  });
});
