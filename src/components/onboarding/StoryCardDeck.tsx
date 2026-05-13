import type { StoryIdeaCard } from '../../types';
import { StoryCardPreview } from './StoryCardPreview';

export function StoryCardDeck({
  cards,
  selectedCardId,
  onSelectCard,
  onMixCard,
  onRefreshBatch,
}: {
  cards: StoryIdeaCard[];
  selectedCardId?: string;
  onSelectCard: (card: StoryIdeaCard) => void;
  onMixCard: (card: StoryIdeaCard) => void;
  onRefreshBatch: () => void;
}) {
  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-serif font-bold text-theme-text">故事方案卡</h2>
          <p className="text-sm text-theme-muted">先选方向，再进入设定记忆立骨架。</p>
        </div>
        <button onClick={onRefreshBatch} className="rounded-full border border-theme-border px-4 py-2 text-xs font-bold text-theme-text">
          继续刷一批
        </button>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        {cards.map((card) => (
          <StoryCardPreview
            key={card.id}
            card={card}
            selected={card.id === selectedCardId}
            onSelect={() => onSelectCard(card)}
            onMix={() => onMixCard(card)}
          />
        ))}
      </div>
    </section>
  );
}
