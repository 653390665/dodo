import { describe, expect, test } from 'vitest';
import { getWorkflowDisplay } from '../lib/workflow-display-registry';

describe('workflow display registry', () => {
  test('returns Chinese stage, primary action and target view without internal enum leakage', () => {
    const display = getWorkflowDisplay('sync');
    expect(display).toEqual({ stage: '资料接入', primaryAction: '接入本章上下文', targetView: 'world' });
    expect(JSON.stringify(display)).not.toMatch(/sync|creative-setup/);
  });

  test('completion actions have explicit editor labels', () => {
    expect(getWorkflowDisplay('complete-chapter').primaryAction).toBe('完成本章');
    expect(getWorkflowDisplay('confirm-facts').stage).toBe('事实确认');
    expect(getWorkflowDisplay('create-next-chapter').primaryAction).toBe('创建下一章');
  });
});
