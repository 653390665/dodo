import type { StoryIdeaCard } from '../../types';

export function StoryCardPreview({
  card,
  selected,
  onSelect,
  onMix,
}: {
  card: StoryIdeaCard;
  selected: boolean;
  onSelect: () => void;
  onMix: () => void;
}) {
  return (
    <article
      className={`rounded-3xl border p-5 shadow-sm ${
        selected ? 'border-theme-accent bg-theme-sidebar/20' : 'border-theme-border bg-white'
      }`}
    >
      <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-theme-muted">故事方案</div>
      <h3 className="mb-3 text-lg font-serif font-bold text-theme-text">{card.hook}</h3>
      <div className="space-y-2 text-sm text-theme-text">
        <p className="line-clamp-2">
          <span className="font-bold">主角</span> {card.protagonist}
        </p>
        <p className="line-clamp-2">
          <span className="font-bold">冲突</span> {card.coreConflict}
        </p>
        <p className="line-clamp-1">
          <span className="font-bold">气质</span> {card.tone}
        </p>
        <p className="text-theme-muted line-clamp-2 text-xs">{card.whyItWorks}</p>
        <div className="rounded-2xl bg-theme-sidebar/20 px-3 py-3 text-xs text-theme-muted">
          <div>{card.planningFit.recommendedLength}</div>
          <div className="mt-1">{card.planningFit.recommendedFocus} · {card.planningFit.recommendedPacing}</div>
          <div className="mt-2 text-theme-text/80">{card.planningFit.reason}</div>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button onClick={onSelect} className="rounded-full bg-theme-accent px-4 py-2 text-xs font-bold text-white">
          选这个
        </button>
        <button onClick={onMix} className="rounded-full border border-theme-border px-4 py-2 text-xs font-bold text-theme-text">
          拿来混搭
        </button>
      </div>
    </article>
  );
}
