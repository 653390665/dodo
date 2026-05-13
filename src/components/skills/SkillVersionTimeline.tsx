import { cn } from '../../lib/utils';
import type { Skill } from '../../types';

interface SkillVersionTimelineProps {
  versions: Skill[];
  activeId: string;
  onSelect: (skill: Skill) => void;
}

export function SkillVersionTimeline({
  versions,
  activeId,
  onSelect,
}: SkillVersionTimelineProps) {
  if (versions.length === 0) {
    return (
      <div className="text-xs text-theme-muted border border-dashed border-theme-border rounded-xl p-4">
        暂无版本谱系
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {versions.map((version) => (
        <button
          key={version.id}
          type="button"
          onClick={() => onSelect(version)}
          className={cn(
            'w-full rounded-xl border p-3 text-left transition-colors',
            version.id === activeId
              ? 'border-theme-accent bg-theme-accent/5'
              : 'border-theme-border bg-white hover:bg-theme-sidebar/20',
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-theme-text">v{version.version || 1}</div>
              <div className="text-[10px] text-theme-muted mt-1 line-clamp-2">
                {version.description || '无描述'}
              </div>
            </div>
            <div className="text-[10px] text-theme-muted shrink-0">
              {new Date(version.createdAt).toLocaleDateString('zh-CN')}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
