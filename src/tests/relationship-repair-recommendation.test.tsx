import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SyncPreviewPanel } from '../components/world-bible/SyncPreviewPanel';
import { recommendRelationshipRepairs } from '../lib/continuation-client';
import type { SyncExtractionResult } from '../../shared/lib/sync-extract-prompt';
import type { Character, Faction } from '../../shared/types';

vi.mock('../lib/continuation-client', async () => {
  const actual = await vi.importActual<typeof import('../lib/continuation-client')>('../lib/continuation-client');
  return { ...actual, recommendRelationshipRepairs: vi.fn() };
});

const recommendMock = vi.mocked(recommendRelationshipRepairs);
const extraction: SyncExtractionResult = {
  characters: [{ name: '林默', role: 'protagonist', summary: '', bio: '', traits: [] }], locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [],
  relationships: [{ sourceName: '林默', sourceType: 'character', targetName: '玄霜盟旧称', targetType: 'faction', relationshipType: '敌对', description: '关系描述' }], globalOutline: '', worldRules: '',
};
const props = () => ({ extraction, packId: 'p1', novelId: 'n1', databaseGeneration: 3, existingCharacters: [{ id: 'c1', novelId: 'n1', name: '林默', role: 'protagonist', summary: '', bio: '', traits: [] } as Character], existingLocations: [], existingItems: [], existingFactions: [{ id: 'f1', novelId: 'n1', name: '玄霜盟', leader: '', territory: '', description: '' } as Faction], onConfirm: vi.fn(), onCancel: vi.fn(), isSyncing: false });

describe('relationship repair recommendations', () => {
  beforeEach(() => { recommendMock.mockReset(); });

  test('sends original index and does not confirm', async () => {
    recommendMock.mockResolvedValue({ recommendations: [] });
    const panelProps = props();
    render(<SyncPreviewPanel {...panelProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Agent 推荐修复/ }));
    await waitFor(() => expect(recommendMock).toHaveBeenCalled());
    expect(recommendMock.mock.calls[0][0].relationships[0]).toMatchObject({ index: 0, sourceName: '林默' });
    expect(panelProps.onConfirm).not.toHaveBeenCalled();
  });

  test('auto-applies map without confirming, then confirms mapped relationship', async () => {
    recommendMock.mockResolvedValue({ recommendations: [{ index: 0, action: 'map', sourceName: '林默', targetName: '玄霜盟', confidence: 'high', reason: '资料明确', evidence: [{ filename: '设定.txt', quote: '林默与玄霜盟交战' }] }] });
    const panelProps = props();
    render(<SyncPreviewPanel {...panelProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Agent 推荐修复/ }));
    expect(await screen.findByText('资料明确')).toBeTruthy();
    expect(screen.getByText(/设定.txt/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Agent 已自动处理 1 条建议');
    expect(panelProps.onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByText('待确认')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '确认同步' }));
    await waitFor(() => expect(panelProps.onConfirm).toHaveBeenCalled());
    expect(panelProps.onConfirm.mock.calls[0][0].relationships).toEqual([
      expect.objectContaining({ sourceName: '林默', targetName: '玄霜盟' }),
    ]);
  });

  test('auto-applies skip and excludes it on confirm', async () => {
    recommendMock.mockResolvedValue({ recommendations: [{ index: 0, action: 'skip', confidence: 'low', reason: '无证据', evidence: [] }] });
    const panelProps = props();
    render(<SyncPreviewPanel {...panelProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Agent 推荐修复/ }));
    expect((await screen.findByRole('button', { name: '已采用跳过' })).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('已跳过')).toBeTruthy();
    expect(panelProps.onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认同步' }));
    await waitFor(() => expect(panelProps.onConfirm).toHaveBeenCalled());
    expect(panelProps.onConfirm.mock.calls[0][0].relationships).toEqual([]);
  });

  test('shows retry while keeping manual select', async () => {
    recommendMock.mockRejectedValue(new Error('网络失败'));
    render(<SyncPreviewPanel {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: /Agent 推荐修复/ }));
    expect(await screen.findByText('网络失败')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关系' }));
    expect(screen.getByRole('combobox')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });

  test('opens settings from recommendation error without confirming', async () => {
    recommendMock.mockRejectedValue(new Error('未配置 API Key'));
    const panelProps = props();
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    render(<SyncPreviewPanel {...panelProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Agent 推荐修复/ }));
    expect(await screen.findByText('未配置 API Key')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '打开设置' }));
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'open-settings' }));
    expect(panelProps.onConfirm).not.toHaveBeenCalled();
    dispatchSpy.mockRestore();
  });
});
