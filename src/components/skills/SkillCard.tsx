import { useState } from 'react';import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Zap from 'lucide-react/dist/esm/icons/zap.js';
import { getSkillRoleLabel, getSkillRoleTags } from '../../lib/skill-language';
import { cn } from '../../lib/utils';
import type { Skill, Novel } from '../../types';

interface SkillCardProps {
  skill: Skill;
  selected: boolean;
  onOpen: () => void;
  onDelete: () => void;
  userNovels?: Novel[];
  onEquip?: (novelId: string) => void;
}

export function SkillCard({ skill, selected, onOpen, onDelete, userNovels, onEquip }: SkillCardProps) {
  const [showEquipMenu, setShowEquipMenu] = useState(false);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group bg-white rounded-2xl p-6 border shadow-sm flex flex-col text-left relative overflow-hidden',
        selected ? 'border-theme-accent ring-1 ring-theme-accent/20' : 'border-theme-border',
      )}
    >
      <div className="flex justify-between items-start mb-4 gap-3">
        <div className="min-w-0">
          <h3 className="font-bold text-theme-text text-lg truncate">{skill.name}</h3>
          <div className="text-[10px] text-theme-muted tracking-widest uppercase font-bold mt-1">
            v{skill.version || 1} · {getSkillRoleLabel(skill.primaryDimension)} · {skill.stabilityScore}%
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onEquip && userNovels && userNovels.length > 0 && (
            <div className="relative">
              <button
                type="button"
                aria-label={`装备技能 ${skill.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setShowEquipMenu(!showEquipMenu);
                }}
                className="p-2 text-theme-muted hover:text-theme-accent rounded-lg hover:bg-theme-accent/10 transition-colors opacity-0 group-hover:opacity-100"
              >
                <Zap size={16} />
              </button>
              {showEquipMenu && (
                <div className="absolute top-full right-0 mt-1 bg-white rounded-xl border border-theme-border shadow-lg p-2 z-20 min-w-[160px]">
                  {userNovels.map((novel) => (
                    <button
                      key={novel.id}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onEquip(novel.id);
                        setShowEquipMenu(false);
                      }}
                      className="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-theme-sidebar/40 whitespace-nowrap"
                    >
                      装备到《{novel.title}》
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            aria-label={`删除技能 ${skill.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            className="p-2 text-theme-muted hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <p className="text-sm text-theme-muted/80 flex-1 mb-4 italic line-clamp-3">"{skill.description}"</p>

      <div className="flex flex-wrap gap-1.5 mt-auto">
        {getSkillRoleTags(skill.dimensionTags).slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="px-2 py-0.5 bg-theme-sidebar rounded text-[10px] text-theme-muted border border-theme-border"
          >
            {tag}
          </span>
        ))}
        {(getSkillRoleTags(skill.dimensionTags).length || 0) > 3 && (
          <span className="px-2 py-0.5 bg-theme-sidebar rounded text-[10px] text-theme-muted border border-theme-border">
            +{getSkillRoleTags(skill.dimensionTags).length - 3}
          </span>
        )}
      </div>
    </button>
  );
}
