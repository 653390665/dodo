import { beforeEach, describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GenerationStatusBar } from '../components/GenerationStatusBar';
import { useProductionStore } from '../stores/production-store';
import type { ChapterProductionRun } from '../../shared/types';

const run = (overrides: Partial<ChapterProductionRun> = {}): ChapterProductionRun => ({
  id: 'run-1',
  status: 'running',
  createdAt: 1,
  updatedAt: 1,
  novelId: 'novel-1',
  continuityReport: {} as ChapterProductionRun['continuityReport'],
  ...overrides,
} as ChapterProductionRun);

describe('GenerationStatusBar', () => {
  beforeEach(() => {
    useProductionStore.setState({
      productionIntent: '',
      activeProductionRun: null,
      isProductionRunning: false,
      isApplyingProductionRun: false,
      productionError: null,
      productionBeatsSource: null,
      productionDraftSource: null,
      productionAuditSource: null,
      productionStatusMessage: null,
    });
  });

  test('full mode renders the four segments idle', () => {
    render(<GenerationStatusBar mode="full" />);
    expect(screen.getByText('① 分镜')).toBeTruthy();
    expect(screen.getByText('② 正文')).toBeTruthy();
    expect(screen.getByText('③ 审稿')).toBeTruthy();
    expect(screen.getByText('④ 写入')).toBeTruthy();
    expect(screen.getAllByText(/未生成/).length).toBe(2);
    expect(screen.getByText(/未运行/)).toBeTruthy();
    expect(screen.getByText(/待生成/)).toBeTruthy();
  });

  test('full mode follows the running flow through sources and apply', () => {
    useProductionStore.setState({
      isProductionRunning: true,
      productionBeatsSource: 'model',
      productionDraftSource: 'fallback',
      productionAuditSource: 'model',
      activeProductionRun: run({ status: 'running' }),
    });
    const { rerender } = render(<GenerationStatusBar mode="full" />);
    expect(screen.getAllByText(/完成/).length).toBeGreaterThan(0);
    expect(screen.getByText(/降级/)).toBeTruthy();
    expect(screen.getByText(/待写入/)).toBeTruthy();

    useProductionStore.setState({
      isProductionRunning: false,
      activeProductionRun: run({ status: 'applied', targetChapterId: 'chapter-1' }),
    });
    rerender(<GenerationStatusBar mode="full" />);
    expect(screen.getByText(/已写入/)).toBeTruthy();
  });

  test('quick mode marks review as skipped and follows draft readiness', () => {
    const { rerender } = render(<GenerationStatusBar mode="quick" />);
    expect(screen.getByText(/已跳过/)).toBeTruthy();
    expect(screen.getByText(/待生成/)).toBeTruthy();

    rerender(<GenerationStatusBar mode="quick" quickDraftReady />);
    expect(screen.getByText(/就绪/)).toBeTruthy();
    expect(screen.getByText(/待写入/)).toBeTruthy();

    rerender(<GenerationStatusBar mode="quick" quickDraftReady quickWritten />);
    expect(screen.getByText(/已写入/)).toBeTruthy();
  });
});
