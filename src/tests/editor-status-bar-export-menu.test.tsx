import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { EditorStatusBar } from '../components/EditorStatusBar';

// Plan 208 回归：导出菜单 portal 化后的外部行为——开关、选中导出、Escape/外点关闭。
// 菜单挂载在 document.body（portal），RTL getByRole 可穿透。

const baseProps = {
  currentChapter: null,
  statusTimeFormatter: new Intl.DateTimeFormat('zh-CN'),
  isSyncing: false,
  syncFailed: false,
  novelId: 'novel-1',
  novelTitle: '测试作品',
};

describe('EditorStatusBar 导出菜单（plan 208 portal 化）', () => {
  const fetchMock = vi.fn();
  const createObjectURLMock = vi.fn(() => 'blob:mock');
  const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

  beforeEach(() => {
    fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob(['x']) });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: createObjectURLMock, revokeObjectURL: vi.fn() }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    anchorClickSpy.mockClear();
  });

  const openMenu = () => {
    render(<EditorStatusBar {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
  };

  test('点导出后菜单出现且 portal 挂载在 document.body 下', () => {
    openMenu();
    const menu = screen.getByRole('menu');
    expect(menu.parentElement).toBe(document.body);
    expect(screen.getByRole('button', { name: '导出' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menuitem', { name: '导出 EPUB' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: '导出 TXT' })).toBeDefined();
  });

  test('点导出 EPUB 触发导出 fetch 并关闭菜单', async () => {
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '导出 EPUB' }));
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/export',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ novelId: 'novel-1', format: 'epub' }),
        })
      );
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('Escape 关闭菜单', () => {
    openMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('外点（menu 与触发按钮之外）关闭菜单；点菜单本身不关闭', () => {
    const { container } = render(<EditorStatusBar {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    const menu = screen.getByRole('menu');
    fireEvent.mouseDown(menu);
    expect(screen.queryByRole('menu')).not.toBeNull();
    fireEvent.mouseDown(container);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('重新打开时 aria-expanded 翻转', () => {
    const { rerender } = render(<EditorStatusBar {...baseProps} />);
    const trigger = screen.getByRole('button', { name: '导出' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    rerender(<EditorStatusBar {...baseProps} />);
    expect(screen.getByRole('button', { name: '导出' }).getAttribute('aria-expanded')).toBe('false');
  });
});
