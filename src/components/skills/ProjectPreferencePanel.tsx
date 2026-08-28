import { Target, TrendingUp } from 'lucide-react';


import { getSkillRoleLabel } from '../../lib/skill-language';
import type { ProjectPreferenceProfile, SkillDimension } from '../../../shared/types';
import { normalizeProjectPreferenceProfile } from '../../../shared/lib/project-preference-profile';

function WeightBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-12 text-right text-theme-muted shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-theme-sidebar overflow-hidden">
        <div
          className="h-full rounded-full bg-theme-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-theme-muted">{pct}%</span>
    </div>
  );
}

interface ProjectPreferencePanelProps {
  profile?: ProjectPreferenceProfile;
}

export function ProjectPreferencePanel({ profile }: ProjectPreferencePanelProps) {
  const normalizedProfile = normalizeProjectPreferenceProfile(profile);
  const source = profile as Partial<ProjectPreferenceProfile> | undefined;
  const hasCompleteProfile = Boolean(
    source
    && Array.isArray(source.tags)
    && Array.isArray(source.acceptedDimensions)
    && Array.isArray(source.rejectedDimensions)
    && Array.isArray(source.notes)
    && source.weights
    && typeof source.weights === 'object'
    && ['styleWeight', 'characterWeight', 'worldWeight', 'plotWeight', 'pacingWeight']
      .every((key) => Number.isFinite(source.weights?.[key as keyof typeof source.weights])),
  );
  if (!hasCompleteProfile || normalizedProfile.evidenceCount < 2) {
    return (
      <div className="rounded-3xl border border-theme-border bg-theme-sidebar p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Target size={14} className="text-theme-muted" />
          <span className="text-xs font-bold uppercase tracking-widest text-theme-muted">作品写法画像</span>
        </div>
        <p className="text-xs text-theme-muted leading-relaxed">
          画像形成中。继续在创作舞台使用能力卡并给出反馈，系统会逐渐学习这部作品的写法偏好。
        </p>
      </div>
    );
  }

  const weightEntries = (Object.entries(normalizedProfile.weights) as Array<[string, number]>)
    .filter(([, value]) => value !== 0.5)
    .sort(([, a], [, b]) => b - a);

  return (
    <div className="rounded-3xl border border-theme-border bg-theme-sidebar p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target size={14} className="text-theme-accent" />
          <span className="text-xs font-bold uppercase tracking-widest text-theme-muted">作品写法画像</span>
        </div>
        <span className="text-[9px] text-theme-muted bg-theme-sidebar px-2 py-0.5 rounded-full border border-theme-border">
          {normalizedProfile.evidenceCount} 条证据
        </span>
      </div>

      {normalizedProfile.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {normalizedProfile.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-theme-accent/20 bg-theme-accent/5 px-2.5 py-1 text-[10px] font-medium text-theme-text"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {weightEntries.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">能力权重</div>
          <div className="space-y-1.5">
            {weightEntries.map(([key, value]) => (
              <WeightBar key={key} value={value} label={getSkillRoleLabel(key as SkillDimension)} />
            ))}
          </div>
        </div>
      )}

      {(normalizedProfile.acceptedDimensions.length > 0 || normalizedProfile.rejectedDimensions.length > 0) && (
        <div className="grid grid-cols-2 gap-3 text-[10px]">
          {normalizedProfile.acceptedDimensions.length > 0 && (
            <div className="rounded-xl border border-emerald-200/50 bg-emerald-50/50 px-3 py-2">
              <div className="font-bold text-emerald-700 mb-1 flex items-center gap-1">
                <TrendingUp size={10} />
                接受
              </div>
              <div className="text-emerald-600">
                {normalizedProfile.acceptedDimensions.map((dim) => getSkillRoleLabel(dim)).join('、')}
              </div>
            </div>
          )}
          {normalizedProfile.rejectedDimensions.length > 0 && (
            <div className="rounded-xl border border-red-200/50 bg-red-50/50 px-3 py-2">
              <div className="font-bold text-red-700 mb-1">排斥</div>
              <div className="text-red-600">
                {normalizedProfile.rejectedDimensions.map((dim) => getSkillRoleLabel(dim)).join('、')}
              </div>
            </div>
          )}
        </div>
      )}

      {normalizedProfile.notes.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">最近反馈</div>
          <ul className="space-y-1">
            {normalizedProfile.notes.slice(-3).map((note) => (
              <li key={note} className="text-[11px] text-theme-muted leading-relaxed pl-3 border-l-2 border-theme-border">
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
