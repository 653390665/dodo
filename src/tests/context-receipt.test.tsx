import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { ContextReceipt } from '../components/book-factory/ContextReceipt';

describe('ContextReceipt', () => {
  test('缺少运行凭证时默认折叠并显示未知来源摘要', () => {
    render(
      <ContextReceipt
        currentChapter={{ title: '第一章' } as never}
        selectedContinuationPack={{ title: '导入资料包' } as never}
        activeSkillsCount={2}
        bibleEntitiesCount={12}
      />,
    );

    const details = screen.getByText('上下文来源未知').closest('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(screen.getByText('查看详情')).toBeTruthy();

    fireEvent.click(screen.getByText('上下文来源未知'));

    expect(details?.open).toBe(true);
    expect(screen.getByText('目标章节:')).toBeTruthy();
    expect(screen.getByText('第一章')).toBeTruthy();
    expect(screen.getByText('资料包:')).toBeTruthy();
    expect(screen.getByText('导入资料包')).toBeTruthy();
    expect(screen.getByText('能力卡:')).toBeTruthy();
    expect(screen.getByText('2/3 个')).toBeTruthy();
    expect(screen.getByText('世界观条目:')).toBeTruthy();
    expect(screen.getByText('12 条')).toBeTruthy();
    expect(screen.getByText('尚无实际运行凭证 · 来源版本未知')).toBeTruthy();
    expect(screen.queryByText('Context Receipt')).toBeNull();
  });

  test('缺少章节或资料包时显示默认值', () => {
    render(
      <ContextReceipt
        currentChapter={null}
        selectedContinuationPack={null}
        activeSkillsCount={0}
        bibleEntitiesCount={0}
      />,
    );

    fireEvent.click(screen.getByText('上下文来源未知'));

    expect(screen.getByText('未选择')).toBeTruthy();
    expect(screen.getByText('未绑定')).toBeTruthy();
  });

  test('实际运行凭证显示绿色就绪状态', () => {
    render(
      <ContextReceipt
        currentChapter={null}
        selectedContinuationPack={null}
        activeSkillsCount={0}
        bibleEntitiesCount={0}
        receipt={{ actual: true, injectedChars: 120, itemCount: 3 } as never}
      />,
    );

    expect(screen.getByText('生成上下文已就绪')).toBeTruthy();
    expect(screen.queryByText('上下文来源未知')).toBeNull();
  });
});
