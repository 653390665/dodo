import type { Novel } from '../../../shared/types';
import type { CuratedProductSkill } from '../../../shared/types/prompt-assets-governed';
import { isSanitizeRequiredAsset } from '../../lib/capability-governance';
import { getCraftSignature } from '../../lib/capability-craft';
import {
  computeCardFitness,
  deriveNovelGenreTokens,
  groupStyleShelf,
} from '../../lib/capability-shelf';
import { PlazaAssetCard } from './PlazaAssetCard';

interface StyleShelfCardWithFitness {
  asset: CuratedProductSkill;
  /** Plan 237：无作品上下文时为 null——噪声分不渲染（排序保持目录序）。 */
  fitness: { score: number; reasons: string[] } | null;
  isImported: boolean;
  isFavorited: boolean;
  isCloning: boolean;
}

/** Plan 229 工位中文名（仅套牌卡面展示用；misc:* 原样透出）。 */
const STATION_LABELS: Record<string, string> = {
  outline: '大纲',
  deconstruct: '拆书',
  concept: '设定命名',
  'platform-check': '平台检验',
  prose: '正文',
  guardrail: '护栏',
};

function stationLabel(station: string): string {
  // Plan 232：misc:* 是推导兜底桶，不把内部枚举裸漏给用户。
  if (station.startsWith('misc:')) return '其他';
  return STATION_LABELS[station] ?? station;
}

/**
 * Plan 229 套牌内工序排序：工位推进（护栏→概念设定→大纲→拆书→平台检验→正文），
 * 工位内再按标题工序细分（世界观先于命名，大纲先于细纲章纲）。
 * 目录序不等于工序序（如克苏鲁正文在目录里排在世界观之前），整剂启用必须按工序序。
 */
function deckOrderIndex(asset: CuratedProductSkill): number {
  const signature = getCraftSignature(asset);
  const stationRank: Record<string, number> = {
    guardrail: 0,
    concept: 1,
    outline: 2,
    deconstruct: 3,
    'platform-check': 4,
    prose: 5,
  };
  const station = stationRank[signature.station] ?? 8;
  const subPatterns: RegExp[] =
    signature.station === 'concept'
      ? [/世界观|设定/, /书名|标题/, /简介/, /配角/, /主角|信息卡/]
      : signature.station === 'outline'
        ? [/大纲/, /细纲/, /章纲/]
        : [];
  const matched = subPatterns.findIndex((pattern) => pattern.test(asset.title));
  return station * 100 + (matched >= 0 ? matched : 99);
}

/** 套牌有序卡列（目录序 → 工序序）。 */
function orderDeckCards(cards: CuratedProductSkill[]): CuratedProductSkill[] {
  return [...cards].sort((a, b) => deckOrderIndex(a) - deckOrderIndex(b));
}

interface StyleShelfGridProps {
  cards: StyleShelfCardWithFitness[];
  isFreeNovel: boolean;
  /** 套牌上下文标注（如「套牌第1张 · 正文工位」），非套牌渲染为 undefined。 */
  deckBadges?: (string | undefined)[];
  handlers: {
    onImport: (card: CuratedProductSkill) => void;
    onEquip: (card: CuratedProductSkill) => void;
    onUseTechnique: (card: CuratedProductSkill) => void;
    onUseProjectTechnique: (card: CuratedProductSkill) => void;
    onDirectExec: (card: CuratedProductSkill) => void;
    onSanitize: (card: CuratedProductSkill) => void;
  };
}

/** 013：文风与正文货架单组网格（独立组件——事件闭包属于本组件的渲染，规则不穿透 props）。 */
function StyleShelfGrid({ cards, isFreeNovel, deckBadges, handlers }: StyleShelfGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {cards.map(({ asset, fitness, isImported, isFavorited, isCloning }, index) => (
        <PlazaAssetCard
          key={asset.id}
          asset={asset}
          isImported={isImported}
          isFavorited={isFavorited}
          isCloning={isCloning}
          selectedNovel={null}
          isFreeNovel={isFreeNovel}
          onImport={() => handlers.onImport(asset)}
          onEquip={() => handlers.onEquip(asset)}
          onUseTechnique={() => handlers.onUseTechnique(asset)}
          onUseProjectTechnique={() => handlers.onUseProjectTechnique(asset)}
          onDirectExec={() => handlers.onDirectExec(asset)}
          onSanitize={
            isSanitizeRequiredAsset(asset.id) ? () => handlers.onSanitize(asset) : undefined
          }
          fitnessChip={fitness ? { score: fitness.score, reasons: fitness.reasons } : undefined}
          deckBadge={deckBadges?.[index]}
        />
      ))}
    </div>
  );
}

interface StyleShelfProps {
  selectedNovel: Novel | null | undefined;
  assets: CuratedProductSkill[];
  /** 收藏/护栏候选复合判定（原 isTechniqueFavorited || isGuardrailCandidate）。 */
  isFavorited: (asset: CuratedProductSkill) => boolean;
  /** 已持久化判定（原 isAssetPersisted）。 */
  isImported: (asset: CuratedProductSkill) => boolean;
  cloningAssetId: string | null;
  isFreeNovel: boolean;
  handlers: StyleShelfGridProps['handlers'];
  /** Plan 229：整剂启用（按序传入全部套牌卡）。缺省时套牌头不出现批量入口。 */
  onApplyDeck?: (cards: CuratedProductSkill[]) => void;
  /** 套牌卡是否已进入当前配置草稿（用于「从第 N 张继续」推算）。 */
  isCardConfigured?: (asset: CuratedProductSkill) => boolean;
}

/**
 * 013：文风与正文货架（Plan 195 切片 C Step 2 自 SkillsStudioView 内联迁出）。
 * 二级分组 + 适合度排序 + 分组渲染；判定谓词由视图传入（读会话草稿/货架数据）。
 * Plan 229：系列分组升级为套牌卡面——名称、卡数、工位、序号、整剂启用/从第 N 张继续。
 */
export function StyleShelf({
  selectedNovel,
  assets,
  isFavorited,
  isImported,
  cloningAssetId,
  isFreeNovel,
  handlers,
  onApplyDeck,
  isCardConfigured,
}: StyleShelfProps) {
  const novelText = [selectedNovel?.title, selectedNovel?.summary].filter(Boolean).join('\n');
  const novelTags = selectedNovel?.projectPreferenceProfile?.tags || [];
  const novelGenreTokens = deriveNovelGenreTokens(novelText, novelTags);
  const novelPlatform = novelText.includes('番茄') ? 'tomato' : undefined;
  // Plan 226：有作品上下文时按适合度降序（无上下文保持目录序）。
  // Plan 237：无上下文时适合度是无含义的噪声分（题材/平台/反馈权重全空），不渲染。
  const hasFitnessContext = novelGenreTokens.length > 0 || Boolean(novelPlatform);
  const decorated = assets.map((asset) => ({
    ...asset,
    isFavorited: isFavorited(asset),
    isCloning: cloningAssetId === asset.id,
    isImported: isImported(asset),
    asset,
    fitness: hasFitnessContext
      ? computeCardFitness(asset, { novelGenreTokens, novelPlatform })
      : null,
  }));
  const shelf = groupStyleShelf(
    hasFitnessContext
      ? decorated.sort((a, b) => (b.fitness?.score ?? 0) - (a.fitness?.score ?? 0))
      : decorated
  );
  const deckBadgeFor = (groupAssets: StyleShelfCardWithFitness[], index: number) => {
    const signature = getCraftSignature(groupAssets[index].asset);
    return `套牌第${index + 1}张 · ${stationLabel(signature.station)}工位`;
  };
  const deckContinueLabel = (groupAssets: StyleShelfCardWithFitness[]) => {
    if (!isCardConfigured) return null;
    const firstMissing = groupAssets.findIndex((entry) => !isCardConfigured(entry.asset));
    if (firstMissing < 0) return '已整剂启用';
    if (firstMissing === 0) return null;
    return `从第 ${firstMissing + 1} 张继续`;
  };
  return (
    <div className="space-y-4">
      {shelf.functional.map((group) => (
        <div key={group.key} className="space-y-2">
          <h3 className="text-xs font-bold text-theme-text">
            {group.label}（{group.assets.length}）
          </h3>
          <StyleShelfGrid cards={group.assets} isFreeNovel={isFreeNovel} handlers={handlers} />
        </div>
      ))}
      {shelf.series.map((group) => {
        const orderedCards = orderDeckCards(group.assets.map((entry) => entry.asset));
        const deckSignatureStations = [
          ...new Set(orderedCards.map((asset) => getCraftSignature(asset).station)),
        ];
        const entryById = new Map(group.assets.map((entry) => [entry.asset.id, entry]));
        const orderedEntries = orderedCards.flatMap((asset) => {
          const entry = entryById.get(asset.id);
          return entry ? [entry] : [];
        });
        const continueLabel = deckContinueLabel(orderedEntries);
        return (
          <details
            key={group.key}
            data-testid="series-deck"
            className="rounded-xl border border-violet-500/25 bg-theme-bg/40"
          >
            <summary className="cursor-pointer select-none px-4 py-3 text-xs font-bold text-theme-muted">
              套牌 {group.label}（{orderedCards.length} 张 · 按序连用）
              <span className="ml-2 font-normal">
                工位：{deckSignatureStations.map(stationLabel).join('、')}
              </span>
            </summary>
            <div className="px-4 pb-4 space-y-3">
              {onApplyDeck && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="apply-deck"
                    onClick={() => onApplyDeck(orderedCards)}
                    className="px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/35 text-violet-600 dark:text-violet-300 text-xs font-bold hover:bg-violet-500/15 transition-colors"
                  >
                    整剂启用（{orderedCards.length} 张）
                  </button>
                  {continueLabel && continueLabel !== '已整剂启用' && (
                    <button
                      type="button"
                      data-testid="continue-deck"
                      onClick={() =>
                        onApplyDeck(
                          orderedCards.filter((asset) => !isCardConfigured?.(asset))
                        )
                      }
                      className="px-3 py-1.5 rounded-lg border border-theme-border text-theme-text text-xs font-bold hover:border-violet-500/40 transition-colors"
                    >
                      {continueLabel}
                    </button>
                  )}
                  {continueLabel === '已整剂启用' && (
                    <span className="text-[10px] text-theme-muted" data-testid="deck-applied">
                      套牌卡已全部进入当前配置
                    </span>
                  )}
                </div>
              )}
              <StyleShelfGrid
                cards={orderedEntries}
                isFreeNovel={isFreeNovel}
                deckBadges={orderedEntries.map((_, index) =>
                  deckBadgeFor(orderedEntries, index)
                )}
                handlers={handlers}
              />
            </div>
          </details>
        );
      })}
    </div>
  );
}
