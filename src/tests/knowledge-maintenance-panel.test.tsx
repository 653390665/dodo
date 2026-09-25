/**
 * 批次 C · 图谱维护入口（KnowledgeMaintenancePanel）验收测试。
 *
 * 覆盖小类三条验收中的界面面：
 * ② 界面展示 coverage 六项叙事元素 + 伏笔 / 关系边 / 失效台账 / 失效边数值；
 * ① 重复执行后展示「台账新增 0 / 跳过 N」（幂等可读）；
 * ③ 重跑失败保留旧值、给出可读错误（不乐观更新）。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { runKnowledgeExtractMock, toastMock } = vi.hoisted(() => ({
  runKnowledgeExtractMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('../lib/knowledge-client', () => ({
  runKnowledgeExtract: runKnowledgeExtractMock,
  KnowledgeCapabilityRequestError: class KnowledgeCapabilityRequestError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = 'KnowledgeCapabilityRequestError';
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock('../lib/toast', () => ({ toast: toastMock }));

import { KnowledgeMaintenancePanel } from '../components/KnowledgeMaintenancePanel';
import { KnowledgeCapabilityRequestError } from '../lib/knowledge-client';

function report(
  overrides: {
    ledgerInserted?: number;
    ledgerSkipped?: number;
    staleLedger?: number;
    staleEdges?: number;
  } = {}
) {
  return {
    capabilityId: 'knowledge-extract',
    kind: 'coverage',
    coverage: {
      xigangEntries: 4,
      ledgerInserted: overrides.ledgerInserted ?? 3,
      ledgerSkipped: overrides.ledgerSkipped ?? 1,
      ledgerBackfilled: 0,
      powerEdgesAdded: 2,
      relicEdgesAdded: 1,
      affinityEdgesAdded: 0,
      residenceEdgesAdded: 0,
      relicUnmatched: [],
      relationshipTypesNormalized: 1,
      coverage: {
        characters: 6,
        items: 3,
        locations: 4,
        factions: 2,
        powerLevels: 5,
        timelineEvents: 7,
        foreshadowings: 9,
        edges: 11,
        staleLedger: overrides.staleLedger ?? 0,
        staleEdges: overrides.staleEdges ?? 0,
      },
    },
  };
}

describe('KnowledgeMaintenancePanel', () => {
  beforeEach(() => {
    runKnowledgeExtractMock.mockReset();
    toastMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  test('初始态提示尚未重跑，且不展示覆盖度数值', () => {
    render(<KnowledgeMaintenancePanel novelId="novel-1" />);
    expect(screen.getByText(/尚未重跑/)).toBeTruthy();
    expect(screen.queryByText('角色')).toBeNull();
    expect(screen.getByRole('button', { name: /从资料包重跑摄入/ })).toBeTruthy();
  });

  test('重跑成功后展示六项叙事元素与伏笔/关系边数值，并回报台账增量', async () => {
    runKnowledgeExtractMock.mockResolvedValue(report());
    render(<KnowledgeMaintenancePanel novelId="novel-1" />);

    fireEvent.click(screen.getByRole('button', { name: /从资料包重跑摄入/ }));

    await waitFor(() => {
      expect(screen.getByText(/最近一次：细纲条目 4 · 台账新增 3 \/ 跳过 1/)).toBeTruthy();
    });
    const expected: Array<[string, number]> = [
      ['角色', 6],
      ['道具', 3],
      ['地点', 4],
      ['势力', 2],
      ['境界', 5],
      ['时间线', 7],
    ];
    for (const [label, value] of expected) {
      const labelNode = screen.getByText(label);
      expect(labelNode.parentElement?.textContent).toBe(`${label}${value}`);
    }
    expect(screen.getByText('伏笔：').textContent).toBe('伏笔：9');
    expect(screen.getByText('关系边：').textContent).toBe('关系边：11');
  });

  test('失效计数可见，且存在失效行时给出「只打标不删除」说明', async () => {
    runKnowledgeExtractMock.mockResolvedValue(report({ staleLedger: 2, staleEdges: 1 }));
    render(<KnowledgeMaintenancePanel novelId="novel-stale" />);

    fireEvent.click(screen.getByRole('button', { name: /从资料包重跑摄入/ }));

    await waitFor(() => {
      expect(screen.getByText('失效台账：').textContent).toBe('失效台账：2');
    });
    expect(screen.getByText('失效边：').textContent).toBe('失效边：1');
    expect(screen.getByRole('status').textContent).toContain('已有 3 行知识失效');
  });

  test('无失效行时不展示失效说明', async () => {
    runKnowledgeExtractMock.mockResolvedValue(report());
    render(<KnowledgeMaintenancePanel novelId="novel-clean" />);

    fireEvent.click(screen.getByRole('button', { name: /从资料包重跑摄入/ }));

    await waitFor(() => {
      expect(screen.getByText('失效台账：').textContent).toBe('失效台账：0');
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('重复重跑展示台账新增 0 且覆盖度数值仍可见（幂等）', async () => {
    runKnowledgeExtractMock
      .mockResolvedValueOnce(report({ ledgerInserted: 3, ledgerSkipped: 1 }))
      .mockResolvedValueOnce(report({ ledgerInserted: 0, ledgerSkipped: 4 }));
    render(<KnowledgeMaintenancePanel novelId="novel-1" />);

    fireEvent.click(screen.getByRole('button', { name: /从资料包重跑摄入/ }));
    await waitFor(() => {
      expect(screen.getByText(/台账新增 3 \/ 跳过 1/)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /从资料包重跑摄入/ }));
    await waitFor(() => {
      expect(screen.getByText(/最近一次：细纲条目 4 · 台账新增 0 \/ 跳过 4/)).toBeTruthy();
    });
    expect(screen.getByText('角色').parentElement?.textContent).toBe('角色6');
  });

  test('重跑失败保留旧覆盖度并展示可读错误（不乐观更新）', async () => {
    runKnowledgeExtractMock
      .mockResolvedValueOnce(report())
      .mockRejectedValueOnce(
        new KnowledgeCapabilityRequestError(
          400,
          'KNOWLEDGE_SOURCE_PACK_MISSING',
          '未找到续写资料包，无法重跑知识谱系；请先导入资料包（含逐章细纲）。'
        )
      );
    render(<KnowledgeMaintenancePanel novelId="novel-1" />);

    fireEvent.click(screen.getByRole('button', { name: /从资料包重跑摄入/ }));
    await waitFor(() => {
      expect(screen.getByText('角色').parentElement?.textContent).toBe('角色6');
    });

    fireEvent.click(screen.getByRole('button', { name: /从资料包重跑摄入/ }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        '未找到续写资料包：请先导入资料包（含逐章细纲）再重跑。'
      );
    });
    // 旧值仍在（失败不破坏既有展示）。
    expect(screen.getByText('角色').parentElement?.textContent).toBe('角色6');
    expect(screen.getByText('最近一次：细纲条目 4 · 台账新增 3 / 跳过 1')).toBeTruthy();
    expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('未找到续写资料包'), 'error');
  });

  test('错误文案映射：409 代际过期与 404 作品缺失在界面可见', async () => {
    runKnowledgeExtractMock
      .mockRejectedValueOnce(
        new KnowledgeCapabilityRequestError(409, 'DATABASE_GENERATION_STALE', 'stale')
      )
      .mockRejectedValueOnce(new KnowledgeCapabilityRequestError(404, 'KNOWLEDGE_NOVEL_NOT_FOUND', 'x'));
    render(<KnowledgeMaintenancePanel novelId="novel-1" />);

    const button = screen.getByRole('button', { name: /从资料包重跑摄入/ });
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        '数据库已更新，本次结果已失效：请刷新后重试。'
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /从资料包重跑摄入/ }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('作品不存在或已被删除。');
    });
  });
});
