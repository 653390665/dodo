import React from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsModal } from '../components/SettingsModal';

const { getProductMetrics, exportProductEvents, clearProductEvents } = vi.hoisted(() => ({ getProductMetrics: vi.fn(), exportProductEvents: vi.fn().mockResolvedValue(undefined), clearProductEvents: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/product-events-client', () => ({ getProductMetrics, exportProductEvents, clearProductEvents }));
vi.mock('../lib/download-client', () => ({ downloadDbBackup: vi.fn().mockResolvedValue(undefined) }));
type TabsContextValue = { value: string; onValueChange: (value: string) => void };
type TabsProps = React.PropsWithChildren<TabsContextValue>;
type TabsListProps = React.PropsWithChildren<unknown>;
type TabsTriggerProps = React.PropsWithChildren<Pick<TabsContextValue, 'value'>>;
type TabsContentProps = React.PropsWithChildren<Pick<TabsContextValue, 'value'>>;

const TabsContext = React.createContext<TabsContextValue>({ value: 'quick', onValueChange: () => {} });
vi.mock('../components/ui/tabs', () => ({
  Tabs: ({ children, value, onValueChange }: TabsProps) => <TabsContext.Provider value={{ value, onValueChange }}>{children}</TabsContext.Provider>,
  TabsList: ({ children }: TabsListProps) => <div>{children}</div>,
  TabsTrigger: ({ children, value }: TabsTriggerProps) => { const ctx = React.useContext(TabsContext); return <button onClick={() => ctx.onValueChange(value)}>{children}</button>; },
  TabsContent: ({ children, value }: TabsContentProps) => { const ctx = React.useContext(TabsContext); return ctx.value === value ? <div>{children}</div> : null; },
}));

describe('Settings local metrics', () => {
  afterEach(() => cleanup());

  test('loads only when data tab opens and displays null as 暂无', async () => {
    getProductMetrics.mockResolvedValue({ rangeDays: 7, sampleSize: 0, northStar: { acceptedChapters: 0 }, rates: { previewAcceptance: null, syncCompletion: null, criticUnknown: null, conflict: null }, generationLatencyMs: { p50: null, p95: null } });
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    expect(getProductMetrics).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByText('数据备份与管理')[0]);
    await waitFor(() => expect(getProductMetrics).toHaveBeenCalled());
    expect(screen.getByText('已接受章节')).toBeTruthy();
    expect(screen.getByText('样本数（去重对象）')).toBeTruthy();
    expect(screen.getAllByText('暂无').length).toBeGreaterThan(0);
  });

  test('exports and confirms clear before refreshing', async () => {
    getProductMetrics.mockResolvedValue({ rangeDays: 7, sampleSize: 4, northStar: { acceptedChapters: 1 }, rates: { previewAcceptance: { value: .5, numerator: 1, denominator: 2 }, syncCompletion: { value: 1, numerator: 1, denominator: 1 }, criticUnknown: { value: 0, numerator: 0, denominator: 2 }, conflict: { value: null, numerator: 0, denominator: 0 } }, generationLatencyMs: { p50: 10, p95: 20 }, stageCompletions: [{ stage: 'drafting', count: 2 }], advancedAdoption: [{ eventName: 'factory_start', count: 1 }] });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByText('数据备份与管理')[0]);
    await waitFor(() => expect(screen.getByText('已接受章节')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '导出本地创作指标' }));
    expect(exportProductEvents).toHaveBeenCalled();
    expect(screen.getByText('导出')).toBeTruthy();
    expect(screen.getByText('样本数（去重对象）')).toBeTruthy();
    expect(screen.getByText('50% (1/2)')).toBeTruthy();
    expect(screen.getByText('factory_start')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清除本地创作指标' }));
    expect(clearProductEvents).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '清除本地创作指标' }));
    await waitFor(() => expect(clearProductEvents).toHaveBeenCalled());
    confirm.mockRestore();
  });

  test('shows writing activation counts and conversion rates', async () => {
    getProductMetrics.mockResolvedValue({ rangeDays: 7, sampleSize: 2, northStar: { acceptedChapters: 0, activeNovels: 2 }, rates: { previewAcceptance: null, syncCompletion: null, criticUnknown: null, conflict: null }, generationLatencyMs: { p50: null, p95: null }, writingActivation: { editorEntries: 2, firstInputs: 1, contentSaves: 1, continuationSkips: 1, entryToFirstInput: { value: .5, numerator: 1, denominator: 2 }, skipToFirstInput: { value: 0, numerator: 0, denominator: 1 }, firstAiAssistCompletion: { value: .75, numerator: 3, denominator: 4 } } });
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByText('数据备份与管理')[0]);
    await waitFor(() => expect(screen.getByText('写作激活')).toBeTruthy());
    expect(screen.getByText(/进入编辑器/)).toBeTruthy();
    expect(screen.getAllByText(/首次输入/).length).toBeGreaterThan(0);
    expect(screen.getByText(/内容保存/)).toBeTruthy();
    expect(screen.getAllByText(/跳过同步/).length).toBeGreaterThan(0);
    expect(screen.getByText('50% (1/2)')).toBeTruthy();
    expect(screen.getByText('0% (0/1)')).toBeTruthy();
    expect(screen.getByText(/首次 AI 辅助跑通率/)).toBeTruthy();
    expect(screen.getByText('75% (3/4)')).toBeTruthy();
    expect(screen.getByText(/活跃作品/)).toBeTruthy();
  });

  test('shows capability lifecycle metrics with rates and integer view changes', async () => {
    getProductMetrics.mockResolvedValue({ rangeDays: 7, sampleSize: 3, northStar: { acceptedChapters: 1 }, rates: { previewAcceptance: null, syncCompletion: null, criticUnknown: null, conflict: null }, generationLatencyMs: { p50: null, p95: null }, capabilities: {
      configurationCompletion: { value: .75, numerator: 3, denominator: 4 },
      configurationViewChanges: 7,
      conflictCancellation: { value: 0, numerator: 0, denominator: 2 },
      storeToEditorReturn: { value: null, numerator: 0, denominator: 0 },
      cardDraftAcceptance: { value: 1, numerator: 2, denominator: 2 },
      oneShotPreviewApplication: { value: .5, numerator: 1, denominator: 2 },
      diagnosticPreviewApplication: { value: .5, numerator: 1, denominator: 2 },
    } });
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByText('数据备份与管理')[0]);
    await waitFor(() => expect(screen.getByText('能力生命周期')).toBeTruthy());
    expect(screen.getByText(/配置完成率/)).toBeTruthy();
    expect(screen.getByText('75% (3/4)')).toBeTruthy();
    expect(screen.getByText(/配置期间视图跳转数/)).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText(/冲突取消率/)).toBeTruthy();
    expect(screen.getByText('0% (0/2)')).toBeTruthy();
    expect(screen.getByText(/商店到编辑器回流率/)).toBeTruthy();
    expect(screen.getByText(/卡组正文采纳率/)).toBeTruthy();
    expect(screen.getByText('100% (2/2)')).toBeTruthy();
    expect(screen.getByText(/精修预览应用率/)).toBeTruthy();
    expect(screen.getByText('50% (1/2)')).toBeTruthy();
  });

  test('does not crash when legacy metrics omit capabilities', async () => {
    getProductMetrics.mockResolvedValue({ rangeDays: 7, sampleSize: 1, northStar: { acceptedChapters: 0 }, rates: { previewAcceptance: null, syncCompletion: null, criticUnknown: null, conflict: null }, generationLatencyMs: { p50: null, p95: null } });
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByText('数据备份与管理')[0]);
    await waitFor(() => expect(screen.getByText('本地创作指标')).toBeTruthy());
    expect(screen.queryByText('能力生命周期')).toBeNull();
  });
});
