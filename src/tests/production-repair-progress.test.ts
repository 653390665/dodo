import { describe, expect, test } from 'vitest';
import {
  writerRepairMessage,
  type ProductionWriterRepairEvent,
} from '../lib/production-repair-progress';

const base: Omit<ProductionWriterRepairEvent, 'status'> = {
  type: 'model_writer_repair',
  round: 1,
  targets: 3,
  applied: 3,
  batchCalls: 2,
  singleCalls: 0,
};

describe('writerRepairMessage', () => {
  test('reports a passed repair round', () => {
    expect(writerRepairMessage({ ...base, status: 'passed' })).toBe(
      '已局部修好门禁命中的句子（第 1 轮 · 修补 3/3 处），继续审稿…'
    );
  });
  test('names the P2 codes that survived', () => {
    const message = writerRepairMessage({
      ...base,
      status: 'residual',
      residualCodes: ['repeated-opening'],
    });
    expect(message).toContain('仍有软残留（repeated-opening）');
  });
  test('keeps a short residual note when no code is known', () => {
    const message = writerRepairMessage({ ...base, status: 'residual' });
    expect(message).toContain('仍有软残留…');
  });
  test('reports the fallback to a whole-chapter rewrite', () => {
    const message = writerRepairMessage({ ...base, applied: 1, status: 'failed' });
    expect(message).toContain('转为整章重写…');
    expect(message).toContain('1/3');
  });
});
