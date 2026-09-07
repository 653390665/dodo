import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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

  test('010 J7 store writes propagate to two mounted surfaces in lockstep', () => {
    // 模拟工作台与编辑器两个表面同时挂载
    const probe = render(
      <div>
        <GenerationStatusBar mode="full" />
        <GenerationStatusBar mode="full" />
      </div>,
    );
    const bars = () => probe.container.querySelectorAll('[role="status"]');
    expect(bars().length).toBe(2);

    // 一处写入（模拟生产流 hook 的 store 更新）
    act(() => {
      useProductionStore.setState({
        isProductionRunning: true,
        productionBeatsSource: 'model',
        activeProductionRun: run({ status: 'running' }),
      });
    });
    // 两个表面四段同步流转：无"未生成"，出现"待写入"
    bars().forEach((bar) => {
      expect(bar.textContent).toContain('分镜');
      expect(bar.textContent).not.toContain('未生成');
      expect(bar.textContent).toContain('待写入');
    });

    act(() => {
      useProductionStore.setState({
        isProductionRunning: false,
        activeProductionRun: run({ status: 'applied', targetChapterId: 'chapter-1' }),
      });
    });
    bars().forEach((bar) => {
      expect(bar.textContent).toContain('已写入');
    });
  });

  test('write segment becomes clickable with a pending run and fires the seek callback', () => {
    const onWriteClick = vi.fn();
    useProductionStore.setState({
      activeProductionRun: run({ status: 'running' }),
      productionBeatsSource: 'model',
      productionDraftSource: 'model',
    });
    render(<GenerationStatusBar mode="full" onWriteClick={onWriteClick} />);

    const writeButton = screen.getByRole('button', { name: /④ 写入/ });
    expect(writeButton.getAttribute('title')).toBe('滚动到接受区');
    fireEvent.click(writeButton);
    expect(onWriteClick).toHaveBeenCalledTimes(1);

    // 已写入后不再可点击
    act(() => {
      useProductionStore.setState({ activeProductionRun: run({ status: 'applied', targetChapterId: 'chapter-1' }) });
    });
    expect(screen.queryByRole('button', { name: /④ 写入/ })).toBeNull();
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
