import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WritingStyleControl } from '../components/WritingStyleControl';

describe('WritingStyleControl', () => {
  test('shows the compact style receipt and confirms a selected mode once', async () => {
    const onConfirm = vi.fn().mockResolvedValue('fp-confirmed');
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    render(<WritingStyleControl resolution={{ resolverVersion: 1, fingerprint: 'fp-1', mode: 'writer-skill', summary: '克制短句', sources: [{ kind: 'project-tone', label: '克制' }], allowedModes: ['writer-skill', 'continuation-pack', 'blend'], warnings: [], confirmed: false }} candidates={[{ mode: 'writer-skill', fingerprint: 'fp-writer', summary: '主笔优先', sources: [] }, { mode: 'continuation-pack', fingerprint: 'fp-pack', summary: '资料包优先', sources: [] }, { mode: 'blend', fingerprint: 'fp-blend', summary: '融合', sources: [] }]} onConfirm={onConfirm} onGenerate={onGenerate} />);

    expect(screen.getByText(/克制短句/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '资料包优先' }));
    fireEvent.click(screen.getByRole('button', { name: '确认并生成' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('dialog').querySelector('button:last-child')!);
    expect(onConfirm).toHaveBeenCalledWith('continuation-pack');
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith('fp-confirmed'));
  });

  test('shows confirmation errors and closes with Escape', async () => {
    const trigger = vi.fn();
    const onConfirm = vi.fn().mockRejectedValue(new Error('服务暂不可用'));
    render(<WritingStyleControl candidates={[{ mode: 'default', fingerprint: 'fp', summary: '系统默认', sources: [] }]} onConfirm={onConfirm} onGenerate={trigger} />);
    const button = screen.getByRole('button', { name: '确认并生成' });
    fireEvent.click(button);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('dialog').querySelector('button:last-child')!);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('服务暂不可用'));
    expect(trigger).not.toHaveBeenCalled();
  });

  test('exposes the primary writing style and skills entry point', () => {
    const onOpenWritingStyle = vi.fn();
    const onManageSkills = vi.fn();
    render(<WritingStyleControl
      onOpenWritingStyle={onOpenWritingStyle}
      onManageSkills={onManageSkills}
      resolution={{
        resolverVersion: 1,
        fingerprint: 'fp-sources',
        mode: 'skill-deck',
        summary: '作品卡组：镜头感 · 章末钩子',
        sources: [
          { kind: 'skill-deck', id: 'deck-1', label: '作品卡组：镜头感' },
          { kind: 'writer-session', id: 'chapter-card-1', label: '章末钩子' },
        ],
        allowedModes: ['skill-deck'],
        warnings: [],
        confirmed: true,
      }}
    />);
    expect(screen.getByRole('button', { name: '查看本章写法' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看本章写法' }));
    expect(onOpenWritingStyle).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('本次写法来源列表')).toBeTruthy();
    expect(screen.getByText('作品默认')).toBeTruthy();
    expect(screen.getByText('本章使用')).toBeTruthy();
    expect(screen.getByText('作品卡组：镜头感')).toBeTruthy();
    expect(screen.getByText('章末钩子')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '管理能力卡' }));
    expect(onManageSkills).toHaveBeenCalledTimes(1);
  });

  test('marks a changed mode stale and does not reuse the confirmed fingerprint', async () => {
    const onConfirm = vi.fn().mockResolvedValue('fp-new');
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    render(<WritingStyleControl confirmed resolution={{ resolverVersion: 1, fingerprint: 'fp-old', mode: 'writer-skill', summary: '旧写法', sources: [], allowedModes: ['writer-skill', 'blend'], warnings: [], confirmed: true }} candidates={[{ mode: 'writer-skill', fingerprint: 'fp-old', summary: '主笔', sources: [] }, { mode: 'blend', fingerprint: 'fp-new-candidate', summary: '融合', sources: [] }]} onConfirm={onConfirm} onGenerate={onGenerate} />);
    fireEvent.click(screen.getByRole('button', { name: '融合' }));
    expect(screen.getByRole('button', { name: '确认并生成' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认并生成' }));
    fireEvent.click(screen.getByRole('dialog').querySelector('button:last-child')!);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('blend'));
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith('fp-new'));
  });
});
