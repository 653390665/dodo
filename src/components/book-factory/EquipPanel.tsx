import React from 'react';
import type { AggregatedSkillDeck, Novel } from '../../../shared/types';
import type { ProjectSkillDeckSelection } from './useBookFactory';

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
  deckSelection?: ProjectSkillDeckSelection;
  disabledReason?: string;
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
  deckSelection,
  disabledReason,
}: EquipPanelProps) {
  const selectedMain = deck && deckSelection?.mainCardId
    ? deck.supportCards.find((card) => card.id === deckSelection.mainCardId) || (deck.mainCard.id === deckSelection.mainCardId ? deck.mainCard : undefined)
    : deck?.mainCard;
  const selectedSupports = deck && deckSelection
    ? deck.supportCards.filter((card) => (deckSelection.supportCardIds || []).includes(card.id))
    : deck?.supportCards || [];
  return (
    <div className="mt-4 rounded-2xl border border-theme-accent/30 bg-theme-accent/5 p-5">
      <div className="text-sm font-bold text-theme-text mb-1">
        提交到作品卡组待选
      </div>
      <div className="text-xs text-theme-muted mb-4">
        {deck
          ? savedDeckIds.length > 0
            ? `将已保存的主卡「${selectedMain?.name || '待选择'}」和 ${selectedSupports.length} 张辅卡提交到所选作品的卡组待选。`
            : `主卡「${selectedMain?.name || '待选择'}」和 ${selectedSupports.length} 张辅卡会先保存为卡组草稿；提交后需在作品能力中心选择位置并应用配置。`
          : '保存后进入作品卡组待选；选择主卡或辅卡，并点击应用配置后才写入作品卡组。'}
      </div>
      {deck && (
        <div className="mb-3 rounded-xl border border-theme-border/70 bg-theme-sidebar/60 p-3 text-xs text-theme-text">
          <div className="mb-2 font-bold text-theme-muted">作品卡组预览</div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-theme-muted">主卡</span>
            <span className="truncate font-medium">{selectedMain?.name || '待选择主卡'}</span>
          </div>
          {selectedSupports.map((card) => (
            <div key={card.id} className="mt-1 flex items-center justify-between gap-2">
              <span className="text-theme-muted">辅卡</span>
              <span className="truncate font-medium">{card.name}</span>
            </div>
          ))}
          <div className="mt-2 text-[11px] text-theme-muted">提交后仍是待选；在作品能力中心选择主卡或辅卡并应用配置后，才会参与后续写作。</div>
        </div>
      )}
      <div className="mb-3">
        <label className="text-[10px] font-bold text-theme-muted uppercase">目标作品</label>
        <select
          value={equipNovelId}
          onChange={(e) => onSetEquipNovelId(e.target.value)}
          className="w-full rounded-xl border border-theme-border px-3 py-2 text-sm mt-1 bg-theme-sidebar"
        >
          <option value="">请选择目标作品</option>
          {userNovels.map((n) => (
            <option key={n.id} value={n.id}>{n.title}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => deck ? onEquipDeck() : onEquipSkill()}
          disabled={!equipNovelId || isSaving || Boolean(disabledReason)}
          className="rounded-xl bg-theme-accent text-white px-4 py-2 text-sm font-bold disabled:opacity-40 transition-opacity"
        >
          {isSaving ? '处理中...' : disabledReason || (deck ? (savedDeckIds.length > 0 ? '提交到作品卡组待选' : '保存草稿，并提交到作品卡组待选') : '提交到作品卡组待选')}
        </button>
        <button
          onClick={onCancel}
          className="rounded-xl border border-theme-border px-4 py-2 text-sm text-theme-muted hover:text-theme-text transition-colors"
        >
          取消
        </button>
      </div>
    </div>
  );
}
