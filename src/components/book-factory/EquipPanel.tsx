import React from 'react';
import type { AggregatedSkillDeck, Novel } from '../../../shared/types';

interface EquipPanelProps {
  deck: AggregatedSkillDeck | null;
  savedDeckIds: string[];
  isSaving: boolean;
  equipNovelId: string;
  onSetEquipNovelId: (val: string) => void;
  userNovels: Novel[];
  onEquipDeck: () => void;
  onEquipSkill: () => void;
  onCancel: () => void;
}

export function EquipPanel({
  deck,
  savedDeckIds,
  isSaving,
  equipNovelId,
  onSetEquipNovelId,
  userNovels,
  onEquipDeck,
  onEquipSkill,
  onCancel,
}: EquipPanelProps) {
  return (
    <div className="mt-4 rounded-2xl border border-theme-accent/30 bg-theme-accent/5 p-5">
      <div className="text-sm font-bold text-theme-text mb-1">
        {deck ? '装备整组 Deck' : '装备技能'}
      </div>
      <div className="text-xs text-theme-muted mb-4">
        {deck
          ? savedDeckIds.length > 0
            ? `将已保存的主笔卡「${deck.mainCard.name}」+ ${deck.supportCards.length} 张副卡装备到作品。`
            : `主笔卡「${deck.mainCard.name}」+ ${deck.supportCards.length} 张副卡将先保存一次，再装备到作品。`
          : '装备到作品后，AI 生成时会参考这个技能的文风和节奏设定。'}
      </div>
      <div className="mb-3">
        <label className="text-[10px] font-bold text-theme-muted uppercase">装备到</label>
        <select
          value={equipNovelId}
          onChange={(e) => onSetEquipNovelId(e.target.value)}
          className="w-full rounded-xl border border-theme-border px-3 py-2 text-sm mt-1 bg-theme-sidebar"
        >
          <option value="">不装备，仅保存到仓库</option>
          {userNovels.map((n) => (
            <option key={n.id} value={n.id}>{n.title}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button
          onClick={deck ? onEquipDeck : onEquipSkill}
          disabled={!equipNovelId || isSaving}
          className="rounded-xl bg-theme-accent text-white px-4 py-2 text-sm font-bold disabled:opacity-40 transition-opacity"
        >
          {isSaving ? '处理中...' : deck ? (savedDeckIds.length > 0 ? '装备已保存 Deck' : '保存并装备整组') : '装备已保存技能'}
        </button>
        <button
          onClick={onCancel}
          className="rounded-xl border border-theme-border px-4 py-2 text-sm text-theme-muted hover:text-theme-text transition-colors"
        >
          仅保存
        </button>
      </div>
    </div>
  );
}
