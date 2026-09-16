import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { getOptionalStyleAssets, isOfficialSupplyAsset } from '../lib/capability-governance';
import { getCraftSignature } from '../lib/capability-craft';
import { StyleShelf } from '../components/skills/StyleShelf';
import type { CuratedProductSkill } from '../../shared/types/prompt-assets-governed';

const noop = vi.fn();
const handlers = {
  onImport: noop,
  onEquip: noop,
  onUseTechnique: noop,
  onUseProjectTechnique: noop,
  onDirectExec: noop,
  onSanitize: noop,
};

const renderShelf = (overrides?: {
  assets?: CuratedProductSkill[];
  onApplyDeck?: (cards: CuratedProductSkill[]) => void;
  isCardConfigured?: (asset: CuratedProductSkill) => boolean;
  filterActive?: boolean;
}) =>
  render(
    <StyleShelf
      selectedNovel={undefined}
      assets={getOptionalStyleAssets()}
      isFavorited={() => false}
      isImported={() => false}
      cloningAssetId={null}
      isFreeNovel={false}
      handlers={handlers}
      {...overrides}
    />
  );

describe('StyleShelf 系列套牌（plan 229）', () => {
  test('系列分组升级为套牌卡面：名称、张数、按序提示、工位与整剂启用入口', () => {
    renderShelf({ onApplyDeck: noop });
    const decks = screen.getAllByTestId('series-deck');
    const cthulhu = decks.find((node) => node.textContent?.includes('克苏鲁'));
    const pokemon = decks.find((node) => node.textContent?.includes('宝可梦'));
    expect(cthulhu?.textContent).toContain('按序连用');
    expect(cthulhu?.textContent).toContain('工位：');
    expect(pokemon?.textContent).toContain('按序连用');
    expect(screen.getAllByTestId('apply-deck').length).toBeGreaterThanOrEqual(2);
  });

  test('套牌展开后每张卡带序号与工位标注（套牌第1张起，工序序：世界观先于正文）', () => {
    renderShelf({ onApplyDeck: noop });
    expect(screen.getAllByText(/套牌第1张 · /).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/套牌第\d+张 · .+工位/).length).toBeGreaterThanOrEqual(4);
    const cthulhu = screen
      .getAllByTestId('series-deck')
      .find((node) => node.textContent?.includes('克苏鲁'));
    const worldPos = cthulhu?.textContent?.indexOf('套牌第1张');
    const proseTitlePos = cthulhu?.textContent?.indexOf('克苏鲁正文');
    expect(worldPos).toBeGreaterThanOrEqual(0);
    expect(proseTitlePos).toBeGreaterThan(worldPos ?? -1);
  });

  test('部分已配置时显示「从第 N 张继续」，入口只传剩余卡', () => {
    const onApplyDeck = vi.fn();
    renderShelf({
      onApplyDeck,
      isCardConfigured: (asset) =>
        asset.title.startsWith('克苏鲁') && asset.title.includes('世界观'),
    });
    const continueButtons = screen.getAllByTestId('continue-deck');
    expect(continueButtons.length).toBe(1);
    expect(continueButtons[0].textContent).toContain('从第 2 张继续');
    continueButtons[0].click();
    expect(onApplyDeck).toHaveBeenCalledTimes(1);
    const staged = onApplyDeck.mock.calls[0][0] as CuratedProductSkill[];
    expect(staged.length).toBeGreaterThanOrEqual(1);
    expect(
      staged.every(
        (card) => !(card.title.startsWith('克苏鲁') && card.title.includes('世界观'))
      )
    ).toBe(true);
  });

  test('整剂启用按工序序传入全部套牌卡', () => {
    const onApplyDeck = vi.fn();
    renderShelf({ onApplyDeck });
    const cthulhu = screen
      .getAllByTestId('series-deck')
      .find((node) => node.textContent?.includes('克苏鲁'));
    expect(cthulhu).toBeTruthy();
    const applyButtons = screen.getAllByTestId('apply-deck');
    applyButtons[0].click();
    expect(onApplyDeck).toHaveBeenCalledTimes(1);
    const staged = onApplyDeck.mock.calls[0][0] as CuratedProductSkill[];
    expect(staged.length).toBeGreaterThanOrEqual(3);
    // 工序序：概念/大纲卡先于正文卡
    const lastIsProse = getCraftSignature(staged[staged.length - 1]).station === 'prose';
    expect(lastIsProse).toBe(true);
  });

  test('无 onApplyDeck 时套牌仍渲染但不出现批量入口（高级用户单卡路径不受限）', () => {
    renderShelf();
    expect(screen.queryByTestId('apply-deck')).toBeNull();
    expect(screen.getAllByTestId('series-deck').length).toBeGreaterThanOrEqual(2);
  });

  test('无作品上下文不渲染适合度分；有作品上下文时恢复（plan 237）', () => {
    const { unmount } = renderShelf({ onApplyDeck: noop });
    expect(screen.queryByText(/适合度/)).toBeNull();
    unmount();

    render(
      <StyleShelf
        selectedNovel={{
          id: 'n1',
          title: '番茄玄幻长篇',
          authorId: 'local',
          summary: '',
          status: 'ongoing' as const,
          createdAt: 1,
          updatedAt: 1,
        }}
        assets={getOptionalStyleAssets()}
        isFavorited={() => false}
        isImported={() => false}
        cloningAssetId={null}
        isFreeNovel={false}
        handlers={handlers}
        onApplyDeck={noop}
      />
    );
    expect(screen.getAllByText(/适合度/).length).toBeGreaterThan(0);
  });

  test('默认浏览态社区散卡归入原料库折叠，过滤激活时全部展开（plan 239）', () => {
    // 镜像生产两区结构：官方区（built-in）与社区区各自一个 StyleShelf 实例
    const all = getOptionalStyleAssets();
    const official = all.filter((asset) => isOfficialSupplyAsset(asset));
    const community = all.filter((asset) => !isOfficialSupplyAsset(asset));

    const { unmount } = render(
      <>
        <StyleShelf
          selectedNovel={undefined}
          assets={official}
          isFavorited={() => false}
          isImported={() => false}
          cloningAssetId={null}
          isFreeNovel={false}
          handlers={handlers}
        />
        <StyleShelf
          selectedNovel={undefined}
          assets={community}
          isFavorited={() => false}
          isImported={() => false}
          cloningAssetId={null}
          isFreeNovel={false}
          handlers={handlers}
          onApplyDeck={noop}
        />
      </>
    );
    const libraries = screen.getAllByTestId('raw-supply-library');
    expect(libraries).toHaveLength(1); // 官方区无原料库，社区区一个
    const decks = screen.getAllByTestId('series-deck');
    const deckCardCount = decks.reduce(
      (sum, node) => sum + (node.textContent?.match(/套牌第\d+张/g)?.length ?? 0),
      0
    );
    const expectedLibrary = community.length - deckCardCount;
    expect(libraries[0].textContent).toContain(`原料库（${expectedLibrary} 张 · 社区散卡）`);
    unmount();

    // 过滤激活：原料库消失，全部展开
    renderShelf({ assets: community, filterActive: true });
    expect(screen.queryByTestId('raw-supply-library')).toBeNull();
  });
});
