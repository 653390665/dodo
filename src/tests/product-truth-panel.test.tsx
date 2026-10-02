/**
 * Plan 271 W2 · 产品真值面板渲染测试（缺失值显示「未知」，不按 0 计）。
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProductTruthMetrics, ProductTruthSnapshot } from '../../shared/types/product-truth';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('../lib/product-truth-client', () => ({ fetchProductTruthMetrics: fetchMock }));

import { ProductTruthPanel } from '../components/ProductTruthPanel';

function metrics(overrides: Partial<ProductTruthMetrics> = {}): ProductTruthMetrics {
  return {
    rangeDays: 30,
    generatedAt: 1,
    novelId: null,
    firstChapter: {
      totalNovels: 2,
      completedNovels: 1,
      rate: { value: 0.5, numerator: 1, denominator: 2 },
    },
    delivery: {
      versions: 4,
      modelVersions: 1,
      fallbackVersions: 3,
      versionModelShare: { value: 0.25, numerator: 1, denominator: 4 },
      runs: 2,
      runsWithModelVersion: 1,
      runModelShare: { value: 0.5, numerator: 1, denominator: 2 },
    },
    decision: {
      runs: 3,
      byStatus: [
        { status: 'review_required', count: 2 },
        { status: 'applied', count: 1 },
      ],
      applied: 1,
      adoptionRate: { value: 1 / 3, numerator: 1, denominator: 3 },
      medianDecisionMs: 90_000,
    },
    ...overrides,
  };
}

function snapshot(): ProductTruthSnapshot {
  return { global: metrics({ novelId: null }), novel: metrics({ novelId: 'novel-1' }) };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(snapshot());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProductTruthPanel', () => {
  test('renders the three north-star readings for both scopes', async () => {
    render(<ProductTruthPanel novelId="novel-1" />);

    await waitFor(() => expect(screen.getByTestId('product-truth-first-chapter-novel')).toBeTruthy());
    expect(screen.getByTestId('product-truth-first-chapter-novel').textContent).toContain('50%（1/2）');
    expect(screen.getByTestId('product-truth-delivery-novel').textContent).toContain('25%（1/4）');
    expect(screen.getByTestId('product-truth-adoption-novel').textContent).toContain('33%（1/3）');
    expect(screen.getByTestId('product-truth-latency-novel').textContent).toContain('1.5 min');
    expect(screen.getByTestId('product-truth-adoption-global').textContent).toContain('33%（1/3）');
  });

  test('shows 未知 (not 0) when a reading is missing', async () => {
    fetchMock.mockResolvedValue({
      global: metrics({
        firstChapter: { totalNovels: 0, completedNovels: 0, rate: { value: null, numerator: 0, denominator: 0 } },
      }),
      novel: null,
    });
    render(<ProductTruthPanel novelId="novel-1" />);

    await waitFor(() => expect(screen.getByTestId('product-truth-first-chapter-global')).toBeTruthy());
    expect(screen.getByTestId('product-truth-first-chapter-global').textContent).toContain('未知');
    expect(screen.getByTestId('product-truth-first-chapter-novel').textContent).toContain('未知');
  });

  test('surfaces a readable error and keeps 未知 values', async () => {
    fetchMock.mockRejectedValue(new Error('产品真值读取失败'));
    render(<ProductTruthPanel novelId="novel-1" />);

    await waitFor(() => expect(screen.getByTestId('product-truth-error')).toBeTruthy());
    expect(screen.getByTestId('product-truth-error').textContent).toContain('产品真值读取失败');
    expect(screen.getByTestId('product-truth-latency-novel').textContent).toContain('未知');
  });
});
