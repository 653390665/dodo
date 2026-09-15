import type { Novel } from '../../../shared/types';
import type { CuratedProductSkill } from '../../../shared/types/prompt-assets-governed';
import { isSanitizeRequiredAsset } from '../../lib/capability-governance';
import {
  computeCardFitness,
  deriveNovelGenreTokens,
  groupStyleShelf,
} from '../../lib/capability-shelf';
import { PlazaAssetCard } from './PlazaAssetCard';

interface StyleShelfCardWithFitness {
  asset: CuratedProductSkill;
  fitness: { score: number; reasons: string[] };
  isImported: boolean;
  isFavorited: boolean;
  isCloning: boolean;
}

interface StyleShelfGridProps {
  cards: StyleShelfCardWithFitness[];
  isFreeNovel: boolean;
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
function StyleShelfGrid({ cards, isFreeNovel, handlers }: StyleShelfGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {cards.map(({ asset, fitness, isImported, isFavorited, isCloning }) => (
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
          fitnessChip={{ score: fitness.score, reasons: fitness.reasons }}
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
}

/**
 * 013：文风与正文货架（Plan 195 切片 C Step 2 自 SkillsStudioView 内联迁出）。
 * 二级分组 + 适合度排序 + 分组渲染；判定谓词由视图传入（读会话草稿/货架数据）。
 */
export function StyleShelf({
  selectedNovel,
  assets,
  isFavorited,
  isImported,
  cloningAssetId,
  isFreeNovel,
  handlers,
}: StyleShelfProps) {
  const novelText = [selectedNovel?.title, selectedNovel?.summary].filter(Boolean).join('\n');
  const novelTags = selectedNovel?.projectPreferenceProfile?.tags || [];
  const novelGenreTokens = deriveNovelGenreTokens(novelText, novelTags);
  const novelPlatform = novelText.includes('番茄') ? 'tomato' : undefined;
  // Plan 226：有作品上下文时按适合度降序（无上下文保持目录序）。
  const hasFitnessContext = novelGenreTokens.length > 0 || Boolean(novelPlatform);
  const decorated = assets.map((asset) => ({
    ...asset,
    isFavorited: isFavorited(asset),
    isCloning: cloningAssetId === asset.id,
    isImported: isImported(asset),
    asset,
    fitness: computeCardFitness(asset, { novelGenreTokens, novelPlatform }),
  }));
  const shelf = groupStyleShelf(
    hasFitnessContext
      ? decorated.sort((a, b) => b.fitness.score - a.fitness.score)
      : decorated
  );
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
      {shelf.series.map((group) => (
        <details key={group.key} className="rounded-xl border border-theme-border/60 bg-theme-bg/40">
          <summary className="cursor-pointer select-none px-4 py-3 text-xs font-bold text-theme-muted">
            系列 {group.label}（{group.assets.length}）
          </summary>
          <div className="px-4 pb-4">
            <StyleShelfGrid cards={group.assets} isFreeNovel={isFreeNovel} handlers={handlers} />
          </div>
        </details>
      ))}
    </div>
  );
}
