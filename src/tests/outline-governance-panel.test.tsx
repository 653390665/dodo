import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { OutlineGovernancePanel } from '../components/book-factory/OutlineGovernancePanel';
import { OutlineTab } from '../components/book-factory/OutlineTab';

const mocks = vi.hoisted(() => ({
  listOutlines: vi.fn(), listCanonPatches: vi.fn(), activateOutline: vi.fn(), archiveOutline: vi.fn(),
  getDatabaseGenerationSnapshot: vi.fn(async () => 1),
  acceptCanonPatch: vi.fn(), rejectCanonPatch: vi.fn(), subscribe: vi.fn(),
}));
vi.mock('../lib/outline-client', () => ({
  listOutlines: mocks.listOutlines, listCanonPatches: mocks.listCanonPatches,
  getDatabaseGenerationSnapshot: mocks.getDatabaseGenerationSnapshot,
  activateOutline: mocks.activateOutline, archiveOutline: mocks.archiveOutline,
  acceptCanonPatch: mocks.acceptCanonPatch, rejectCanonPatch: mocks.rejectCanonPatch,
  subscribeToOutlineGovernanceChanges: mocks.subscribe,
}));

const master = (id: string, status: 'active' | 'candidate') => ({ id, novelId: 'n1', level: 'master' as const, scope: {}, content: id, source: 'user' as const, status });
const scoped = (id: string, level: 'volume' | 'chapter', status: 'active' | 'candidate') => ({ id, novelId: 'n1', level, scope: level === 'volume' ? { volumeName: '第一卷' } : { chapterStart: 2, chapterEnd: 3 }, content: id, source: 'user' as const, status });

describe('OutlineGovernancePanel', () => {
  let notify: (() => void) | undefined;
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listOutlines.mockResolvedValue([master('m-active', 'active'), master('m-candidate', 'candidate'), master('audit-report', 'candidate'), scoped('v1', 'volume', 'candidate'), scoped('c1', 'chapter', 'active')]);
    mocks.listCanonPatches.mockResolvedValue([{ id: 'p1', novelId: 'n1', baseFingerprint: 'x', operations: [], status: 'pending' }, { id: 'p-stale', novelId: 'n1', baseFingerprint: 'y', operations: [], status: 'stale' }]);
    mocks.activateOutline.mockResolvedValue({ archivedIds: [], demotedIds: [] });
    mocks.archiveOutline.mockResolvedValue({ archived: true });
    mocks.acceptCanonPatch.mockResolvedValue({ status: 'accepted' });
    mocks.rejectCanonPatch.mockResolvedValue({ status: 'rejected' });
    mocks.subscribe.mockImplementation((listener: () => void) => { notify = listener; return () => { notify = undefined; }; });
  });

  test('marks one active master and candidate radio is single-select with activation', async () => {
    const adopt = vi.fn(async () => true);
    render(<OutlineGovernancePanel novelId="n1" onAdoptOutline={adopt} />);
    await screen.findByText('m-active');
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect((screen.getAllByRole('radio')[0] as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: '主大纲 m-candidate' }));
    fireEvent.click(screen.getByRole('button', { name: '设为主纲' }));
    await waitFor(() => expect(mocks.activateOutline).toHaveBeenCalledWith('n1', 'm-candidate', 1));
    expect(adopt).toHaveBeenCalled();
  });

  test('renders scope labels and supports activate/archive', async () => {
    render(<OutlineGovernancePanel novelId="n1" />);
    await screen.findByText(/第一卷/);
    expect(screen.getByText(/章 2-3/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '激活' }));
    await waitFor(() => expect(mocks.activateOutline).toHaveBeenCalledWith('n1', 'v1', 1));
    fireEvent.click(screen.getAllByRole('button', { name: '归档细纲' })[0]);
    await waitFor(() => expect(mocks.archiveOutline).toHaveBeenCalledWith('n1', 'v1', 1));
  });

  test('accepts/rejects pending patches and keeps stale visible', async () => {
    render(<OutlineGovernancePanel novelId="n1" />);
    await screen.findByText(/p-stale/);
    expect(screen.getByText(/已失效，基线已变化/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '接受补丁' }));
    await waitFor(() => expect(mocks.acceptCanonPatch).toHaveBeenCalledWith('n1', 'p1', 1));
    fireEvent.click(screen.getByRole('button', { name: '拒绝补丁' }));
    await waitFor(() => expect(mocks.rejectCanonPatch).toHaveBeenCalledWith('n1', 'p1', 1));
    fireEvent.click(screen.getByRole('button', { name: '拒绝失效补丁' }));
    await waitFor(() => expect(mocks.rejectCanonPatch).toHaveBeenCalledWith('n1', 'p-stale', 1));
  });

  test('refreshes and exposes stale state when accepting a stale pending patch', async () => {
    mocks.acceptCanonPatch.mockRejectedValueOnce({ code: 'CANON_PATCH_STALE', status: 409, message: '基线已变化' });
    render(<OutlineGovernancePanel novelId="n1" />);
    await screen.findByText(/p1/);
    fireEvent.click(screen.getByRole('button', { name: '接受补丁' }));
    await waitFor(() => expect(mocks.listCanonPatches).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/补丁已标记为失效/)).toBeDefined();
  });

  test('hides report candidates by default and exposes them without activation', async () => {
    render(<OutlineGovernancePanel novelId="n1" />);
    await screen.findByText('m-active');
    expect(screen.queryByText('audit-report')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: /显示报告类候选/ }));
    const reportLabel = screen.getByText(/报告候选/);
    expect(reportLabel.textContent).toContain('audit-report');
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    const reportRow = reportLabel.closest('div');
    expect(reportRow?.querySelector('button')).toBeNull();
  });

  test('shows stale baseline guidance and provides refresh entry', async () => {
    render(<OutlineGovernancePanel novelId="n1" />);
    await screen.findByText(/Canon 基线已变化/);
    expect(screen.getByRole('button', { name: '刷新治理状态' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '刷新治理状态' }));
    await waitFor(() => expect(mocks.listCanonPatches).toHaveBeenCalledTimes(2));
  });

  test('refreshes on subscription, and ignores stale request after novel switch', async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.listOutlines.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce([master('new', 'active')]);
    const { rerender } = render(<OutlineGovernancePanel novelId="old" />);
    rerender(<OutlineGovernancePanel novelId="new" />);
    await screen.findByText('new');
    resolveOld([master('old', 'active')]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('old')).toBeNull();
    notify?.();
    expect(mocks.listOutlines).toHaveBeenCalledTimes(3);
  });

  test('keeps semantic controls and narrow layout class', () => {
    const { container } = render(<><OutlineGovernancePanel /><OutlineTab expectedWordCount={100} setExpectedWordCount={vi.fn()} onGenerateOutline={vi.fn(async () => {})} isGeneratingOutline={false} globalOutline="" onGlobalOutlineChange={vi.fn()} chapters={[]} currentChapter={null} onSelectChapter={vi.fn()} selectedContinuationPack={null} /></>);
    expect(screen.queryByRole('button', { name: '设为主纲' })).toBeNull();
    expect(container.querySelector('.sm\\:flex-row')).toBeTruthy();
  });
});
