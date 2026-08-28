import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type { ContinuationPack, Novel } from '../../shared/types';

vi.mock('../components/ProductionRunReview', () => ({
  ProductionRunReview: () => null,
}));

import { ProductionTab } from '../components/book-factory/ProductionTab';

const novel: Novel = {
  id: 'novel-gap-action',
  title: '资料缺口测试',
  authorId: 'local-user',
  summary: '',
  status: 'ongoing',
  createdAt: 1,
  updatedAt: 1,
};

function createPack(gaps: ContinuationPack['continuationGaps'] = []): ContinuationPack {
  return {
    id: 'pack-gap-action',
    novelId: novel.id,
    title: '已确认资料包',
    status: 'approved',
    sourceDocuments: [],
    canonFacts: [],
    characterStates: [],
    plotState: {
      currentTimeline: '现在',
      latestScene: '老城区锚点处',
      unresolvedHooks: [],
      immediateConflict: '持续对抗',
      nextLikelyMove: '继续调查',
    },
    styleProfile: {
      pov: '第三人称',
      tense: '过去时',
      pacing: 'balanced',
      dialogueDensity: '中',
      proseTraits: [],
      avoidTraits: [],
      sampleEvidence: '',
    },
    contradictions: [],
    continuationTask: '续写下一章',
    continuationGaps: gaps,
    createdAt: 1,
    updatedAt: 1,
  };
}

function renderTab(
  pack: ContinuationPack,
  onOpenBibleAssistant?: (prompt: string) => void,
  capabilityEffectSummary?: React.ComponentProps<typeof ProductionTab>['capabilityEffectSummary'],
  onSwitchTab?: React.ComponentProps<typeof ProductionTab>['onSwitchTab'],
) {
  const onStartProductionRun = vi.fn(async () => undefined);
  const onApplyProductionRun = vi.fn(async () => undefined);

  render(
    <ProductionTab
      novel={novel}
      continuationPacks={[pack]}
      selectedContinuationPackId={pack.id}
      setSelectedContinuationPackId={vi.fn()}
      selectedContinuationPack={pack}
      activeProductionRun={null}
      productionIntent=""
      isProductionRunning={false}
      isApplyingProductionRun={false}
      productionError={null}
      setProductionIntent={vi.fn()}
      onStartProductionRun={onStartProductionRun}
      onApplyProductionRun={onApplyProductionRun}
      onOpenBibleAssistant={onOpenBibleAssistant}
      packTimeFormatter={new Intl.DateTimeFormat('zh-CN')}
      renderContextReceipt={() => null}
      capabilityEffectSummary={capabilityEffectSummary}
      onSwitchTab={onSwitchTab}
    />,
  );

  return { onStartProductionRun, onApplyProductionRun };
}

describe('ProductionTab continuation gap actions', () => {
  test('opens the bible assistant with a complete gap prompt without starting production', () => {
    const onOpenBibleAssistant = vi.fn();
    const gaps = [
      {
        id: 'gap-1',
        description: '顾铁峰与苏老板的年轻外勤搭档细节未展开',
        severity: 'medium' as const,
        suggestedDirection: '补充20年前共事片段，强化关系深度',
        relatedFacts: ['两人曾共同执行任务', '当前仍保持联系'],
      },
      {
        id: 'gap-2',
        description: '林啸的进化棋局规则细节未完整记录',
        severity: 'low' as const,
        suggestedDirection: "设计'卒过河变车'等规则",
        relatedFacts: ['棋局是重要线索'],
      },
      {
        id: 'gap-3',
        description: '不应展示的第三条缺口',
        severity: 'low' as const,
        suggestedDirection: '暂不处理',
        relatedFacts: [],
      },
    ];
    const { onStartProductionRun, onApplyProductionRun } = renderTab(
      createPack(gaps),
      onOpenBibleAssistant,
    );

    const button = screen.getByRole('button', {
      name: '让智能管家补齐：顾铁峰与苏老板的年轻外勤搭档细节未展开',
    });
    expect(screen.getByRole('button', {
      name: '让智能管家补齐：林啸的进化棋局规则细节未完整记录',
    })).toBeTruthy();
    expect(screen.queryByRole('button', {
      name: '让智能管家补齐：不应展示的第三条缺口',
    })).toBeNull();

    fireEvent.click(button);

    expect(onOpenBibleAssistant).toHaveBeenCalledTimes(1);
    expect(onOpenBibleAssistant).toHaveBeenCalledWith(
      expect.stringContaining('请补充资料缺口：顾铁峰与苏老板的年轻外勤搭档细节未展开'),
    );
    const prompt = onOpenBibleAssistant.mock.calls[0][0];
    expect(prompt).toContain('建议方向：补充20年前共事片段，强化关系深度');
    expect(prompt).toContain('相关事实：两人曾共同执行任务；当前仍保持联系');
    expect(prompt).toContain('请先生成可编辑确认单，不要直接写入。');
    expect(onStartProductionRun).not.toHaveBeenCalled();
    expect(onApplyProductionRun).not.toHaveBeenCalled();
  });

  test('without the assistant callback, keeps gap text but hides action buttons', () => {
    const description = '缺少人物关系的关键转折';
    renderTab(createPack([{
      id: 'gap-no-action',
      description,
      severity: 'high',
      suggestedDirection: '补充冲突来源',
      relatedFacts: [],
    }]));

    expect(screen.getByText(description)).toBeTruthy();
    expect(screen.queryByRole('button', {
      name: `让智能管家补齐：${description}`,
    })).toBeNull();
  });

  test('shows the capability cards and techniques used for this production run', () => {
    const onSwitchTab = vi.fn();
    renderTab(createPack(), undefined, {
      projectCardNames: ['主笔节奏卡', '世界观约束卡'],
      favoriteTechniqueNames: ['开篇钩子技法'],
      chapterCardNames: ['本章节奏卡'],
    }, onSwitchTab);

    expect(screen.getByLabelText('本次生成能力配置')).toBeTruthy();
    expect(screen.getByText('主笔节奏卡、世界观约束卡')).toBeTruthy();
    expect(screen.getByText('开篇钩子技法')).toBeTruthy();
    expect(screen.getByText('本章节奏卡')).toBeTruthy();
    expect(screen.getByText('作品默认卡和常用技法会长期影响本书；本章使用卡只影响当前章节。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '核对写法与能力' }));
    expect(onSwitchTab).toHaveBeenCalledWith('skills');
  });

  test('shows an empty capability setup state before production', () => {
    const onSwitchTab = vi.fn();
    renderTab(createPack(), undefined, undefined, onSwitchTab);

    expect(screen.getByLabelText('本次生成能力配置')).toBeTruthy();
    expect(screen.getByText('还没有配置作品默认卡或常用技法，生成会先按当前章节与作品上下文继续。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '核对写法与能力' }));
    expect(onSwitchTab).toHaveBeenCalledWith('skills');
  });
});
