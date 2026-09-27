/**
 * Plan 263 D3 · 章节时光机版本卡的一致性徽标（外部行为）。
 *
 * 语义（与服务端 `ChapterVersionMeta` 同源）：
 * - `matchesCurrentContent === true`  → 「＝ 当前正文」（还原为无操作）
 * - `false`                          → 「≠ 与当前正文不同」
 * - `null`（迁移前旧快照无指纹）      → 「来源未知（旧快照）」
 * 徽标只做显示：还原按钮行为不变（仍回调 `onRestoreVersion`）。
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { AgentWorkspaceVersionsPanel } from '../components/AgentWorkspaceVersionsPanel';
import type { ChapterVersionMeta } from '../lib/chapter-client';

function version(overrides: Partial<ChapterVersionMeta>): ChapterVersionMeta {
  return {
    id: 'v1',
    wordCount: 1200,
    author: 'user',
    createdAt: Date.UTC(2026, 8, 28, 10, 0, 0),
    preview: '这是一段预览正文……',
    contentHash: 'hash-a',
    matchesCurrentContent: null,
    ...overrides,
  };
}

const currentChapter = {
  id: 'ch-1',
  novelId: 'novel-1',
  title: '第一章',
  content: '当前正文',
  order: 1,
  wordCount: 4,
  createdAt: 0,
  updatedAt: 0,
} as unknown as Parameters<typeof AgentWorkspaceVersionsPanel>[0]['currentChapter'];

describe('AgentWorkspaceVersionsPanel · 版本一致性徽标', () => {
  it('三种状态各自渲染对应文案（一致 / 不同 / 未知）', () => {
    render(
      <AgentWorkspaceVersionsPanel
        currentChapter={currentChapter}
        versions={[
          version({ id: 'same', matchesCurrentContent: true }),
          version({ id: 'diff', matchesCurrentContent: false }),
          version({ id: 'legacy', matchesCurrentContent: null, contentHash: null }),
        ]}
        onSaveVersion={vi.fn()}
        onRestoreVersion={vi.fn()}
      />
    );

    expect(screen.getByText('＝ 当前正文')).toBeTruthy();
    expect(screen.getByText('≠ 与当前正文不同')).toBeTruthy();
    expect(screen.getByText('来源未知（旧快照）')).toBeTruthy();
  });

  it('徽标不改变还原行为：一致版本仍可回调', () => {
    const onRestoreVersion = vi.fn();
    const target = version({ id: 'same', matchesCurrentContent: true });
    render(
      <AgentWorkspaceVersionsPanel
        currentChapter={currentChapter}
        versions={[target]}
        onSaveVersion={vi.fn()}
        onRestoreVersion={onRestoreVersion}
      />
    );

    fireEvent.click(screen.getByText('还原此版本'));
    expect(onRestoreVersion).toHaveBeenCalledTimes(1);
    expect(onRestoreVersion.mock.calls[0][0]).toMatchObject({ id: 'same', matchesCurrentContent: true });
  });

  it('无版本时仍显示空态', () => {
    render(
      <AgentWorkspaceVersionsPanel
        currentChapter={currentChapter}
        versions={[]}
        onSaveVersion={vi.fn()}
        onRestoreVersion={vi.fn()}
      />
    );
    expect(screen.getByText('暂无历史版本记录')).toBeTruthy();
  });
});
