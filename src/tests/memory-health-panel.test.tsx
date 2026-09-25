/**
 * 批次 D · 记忆健康度看板（MemoryHealthPanel）界面验收测试。
 *
 * 覆盖小类三条验收中的界面面：
 * ① 四项指标在界面可见（数值 + 标签 + detail）；
 * ② 数据缺失显示「未知」而不显示 0（沿用 llm-status-honesty 口径）；
 * ③ 面板不再计算——数值直接来自服务端快照（同源），失败保留上一次成功值。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { fetchMemoryHealthMock } = vi.hoisted(() => ({ fetchMemoryHealthMock: vi.fn() }));

vi.mock('../lib/knowledge-client', () => ({
  fetchMemoryHealth: fetchMemoryHealthMock,
}));

import { MemoryHealthPanel } from '../components/MemoryHealthPanel';
import { buildMemoryHealthMetrics, type MemoryHealthMetric } from '../../shared/lib/memory-health';

function snapshot(metrics: MemoryHealthMetric[]) {
  return {
    novelId: 'novel-1',
    computedAt: '2026-09-27T00:00:00.000Z',
    metrics,
    evidence: {
      packDocuments: 1,
      foreshadowingRows: 3,
      relationshipRows: 1,
      entityRows: 4,
      orphanRows: 2,
      indexedChunks: 0,
      embeddingStatus: 'unavailable',
      ragQueryChapterId: null,
    },
  };
}

const healthyMetrics = buildMemoryHealthMetrics({
  openForeshadowings: 3,
  orphanNodes: 2,
  staleLedger: 2,
  staleEdges: 3,
  ragHits: 5,
  ragDetail: '查询：最新章节《第十章》',
});

const unknownMetrics = buildMemoryHealthMetrics({
  openForeshadowings: null,
  openForeshadowingsUnknownReason: '尚未摄入资料包',
  orphanNodes: null,
  staleLedger: null,
  staleEdges: null,
  ragHits: null,
  ragUnknownReason: '尚未建立向量索引',
});

function metricText(key: string): string {
  return screen.getByTestId(`memory-health-metric-${key}`).textContent ?? '';
}

beforeEach(() => {
  fetchMemoryHealthMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('记忆健康度看板', () => {
  test('四项指标按服务端数值渲染（含标签与 detail）', async () => {
    fetchMemoryHealthMock.mockResolvedValue(snapshot(healthyMetrics));
    render(<MemoryHealthPanel novelId="novel-1" />);

    await waitFor(() => expect(metricText('openForeshadowings')).toContain('3'));
    expect(metricText('openForeshadowings')).toContain('未回收伏笔');
    expect(metricText('orphanNodes')).toContain('孤立节点');
    expect(metricText('orphanNodes')).toContain('2');
    expect(metricText('staleKnowledge')).toContain('失效知识');
    expect(metricText('staleKnowledge')).toContain('5');
    expect(metricText('staleKnowledge')).toContain('台账 2 · 关系边 3');
    expect(metricText('ragHits')).toContain('RAG 命中');
    expect(metricText('ragHits')).toContain('5');
    expect(metricText('ragHits')).toContain('查询：最新章节《第十章》');
  });

  test('数据缺失显示「未知」（琥珀降级）且不显示 0', async () => {
    fetchMemoryHealthMock.mockResolvedValue(snapshot(unknownMetrics));
    const { container } = render(<MemoryHealthPanel novelId="novel-1" />);

    await waitFor(() => expect(metricText('ragHits')).toContain('未知'));
    expect(screen.getAllByText('未知').length).toBe(4);
    expect(metricText('openForeshadowings')).toContain('尚未摄入资料包');
    expect(metricText('ragHits')).toContain('尚未建立向量索引');
    expect(screen.queryByText('0')).toBeNull();
    expect(container.querySelectorAll('.text-amber-800').length).toBe(4);
  });

  test('从未成功读取：四项显示未知并给出可读错误（role=alert）', async () => {
    fetchMemoryHealthMock.mockRejectedValue(new Error('记忆健康度读取失败，请稍后重试。'));
    render(<MemoryHealthPanel novelId="novel-1" />);

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('记忆健康度读取失败'));
    expect(screen.getAllByText('未知').length).toBe(4);
  });

  test('读取失败保留上一次成功值（不乐观更新），刷新成功后再更新', async () => {
    fetchMemoryHealthMock.mockResolvedValueOnce(snapshot(healthyMetrics));
    render(<MemoryHealthPanel novelId="novel-1" />);
    await waitFor(() => expect(metricText('openForeshadowings')).toContain('3'));

    fetchMemoryHealthMock.mockRejectedValueOnce(new Error('网络中断'));
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('网络中断'));
    expect(metricText('openForeshadowings')).toContain('3');

    const refreshed = buildMemoryHealthMetrics({
      openForeshadowings: 7,
      orphanNodes: 1,
      staleLedger: 0,
      staleEdges: 1,
      ragHits: 2,
    });
    fetchMemoryHealthMock.mockResolvedValueOnce(snapshot(refreshed));
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(metricText('openForeshadowings')).toContain('7'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
