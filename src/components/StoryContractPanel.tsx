import { useState } from 'react';
import { Plus, Shield, X } from 'lucide-react';
import type { StoryContract } from '../../shared/types';

interface StoryContractPanelProps {
  contract: StoryContract | null;
  onSave: (contract: StoryContract) => void;
  onClose: () => void;
}

const DEFAULT_CONTRACT: StoryContract = {
  powerCeiling: '',
  noResurrection: false,
  characterConsistency: 'strict',
  genreRules: [],
  customConstraints: [],
  foreshadowingDebt: { open: 0, resolved: 0, planted: 0, overdue: 0 },
};

export function StoryContractPanel({ contract, onSave, onClose }: StoryContractPanelProps) {
  const [draft, setDraft] = useState<StoryContract>(contract ?? DEFAULT_CONTRACT);
  const [newRule, setNewRule] = useState('');

  const addRule = () => {
    if (!newRule.trim()) return;
    setDraft((prev) => ({ ...prev, customConstraints: [...(prev.customConstraints || []), newRule.trim()] }));
    setNewRule('');
  };

  const removeRule = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      customConstraints: (prev.customConstraints || []).filter((_, i) => i !== index),
    }));
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-theme-text flex items-center gap-2">
          <Shield size={16} className="text-theme-accent" />
          写作合同
        </h2>
        <button
          onClick={onClose}
          aria-label="关闭合同面板"
          className="p-1 rounded-lg hover:bg-theme-sidebar text-theme-muted"
        >
          <X size={16} />
        </button>
      </div>

      <p className="text-xs text-theme-muted">
        合同规则会在写作和审查时自动校验，防止世界观崩塌和角色OOC。
      </p>

      {/* Power ceiling */}
      <label className="block">
        <span className="text-xs font-bold text-theme-text">战力天花板</span>
        <input
          type="text"
          value={draft.powerCeiling}
          onChange={(e) => setDraft((prev) => ({ ...prev, powerCeiling: e.target.value }))}
          placeholder="例如：最高不超过元婴期 / 不可超越天道"
          className="mt-1 w-full rounded-xl border border-theme-border bg-theme-sidebar px-3 py-2 text-sm text-theme-text outline-none focus:border-theme-accent"
        />
      </label>

      {/* No resurrection */}
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={draft.noResurrection}
          onChange={(e) => setDraft((prev) => ({ ...prev, noResurrection: e.target.checked }))}
          className="rounded"
        />
        <span className="text-xs font-bold text-theme-text">禁止复活已死角色</span>
      </label>

      {/* Character consistency */}
      <label className="block">
        <span className="text-xs font-bold text-theme-text">角色一致性</span>
        <select
          value={draft.characterConsistency}
          onChange={(e) =>
            setDraft((prev) => ({ ...prev, characterConsistency: e.target.value as 'strict' | 'loose' }))
          }
          className="mt-1 w-full rounded-xl border border-theme-border bg-theme-sidebar px-3 py-2 text-sm text-theme-text outline-none"
        >
          <option value="strict">严格（角色行为必须始终符合人设）</option>
          <option value="loose">宽松（允许角色在重大事件后成长变化）</option>
        </select>
      </label>

      {/* Custom constraints */}
      <div>
        <div className="text-xs font-bold text-theme-text mb-2">自定义约束</div>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={newRule}
            onChange={(e) => setNewRule(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRule()}
            placeholder="添加一条规则..."
            className="flex-1 rounded-xl border border-theme-border bg-theme-sidebar px-3 py-2 text-sm outline-none focus:border-theme-accent"
          />
          <button
            onClick={addRule}
            aria-label="添加约束"
            className="px-3 py-2 bg-theme-accent text-white rounded-xl text-xs font-bold"
          >
            <Plus size={14} />
          </button>
        </div>
        {((draft.customConstraints?.length ?? 0) > 0) && (
          <div className="space-y-1">
            {(draft.customConstraints || []).map((rule, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-theme-muted bg-theme-sidebar rounded-lg px-3 py-1.5">
                <span className="flex-1">{rule}</span>
                <button onClick={() => removeRule(i)} aria-label={`删除约束：${rule}`} className="text-theme-muted hover:text-red-500">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Foreshadowing debt */}
      <div className="bg-theme-sidebar rounded-xl p-3 border border-theme-border">
        <div className="text-xs font-bold text-theme-text mb-2">伏笔债务</div>
        <div className="flex gap-4 text-xs text-theme-muted">
          <span>已埋：{draft.foreshadowingDebt?.planted ?? 0}</span>
          <span>已回收：{draft.foreshadowingDebt?.resolved ?? 0}</span>
          <span className="text-amber-600">逾期：{draft.foreshadowingDebt?.overdue ?? 0}</span>
        </div>
      </div>

      {/* Save */}
      <button
        onClick={() => onSave(draft)}
        className="w-full py-3 bg-theme-accent text-white rounded-xl text-sm font-bold shadow-sm hover:bg-theme-accent/90"
      >
        保存合同
      </button>
    </div>
  );
}
