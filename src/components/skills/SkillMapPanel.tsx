import { useMemo } from 'react';
import { AlertCircle, Compass, TrendingUp, Zap } from 'lucide-react';

import type { Skill, SkillDimension } from '../../../shared/types';

const DIMENSION_LABELS: Record<SkillDimension, string> = {
  style: '文风',
  character: '人物',
  world: '世界',
  power: '战力',
  plot: '剧情',
  pacing: '节奏',
};

const ALL_DIMENSIONS: SkillDimension[] = ['style', 'character', 'world', 'power', 'plot', 'pacing'];

interface DimensionStats {
  dimension: SkillDimension;
  label: string;
  count: number;
  avgScore: number;
  topSkillName: string;
}

interface FusionSuggestion {
  left: SkillDimension;
  right: SkillDimension;
  reason: string;
}

function deriveFusionSuggestions(
  populated: SkillDimension[],
  _missing: SkillDimension[],
): FusionSuggestion[] {
  const suggestions: FusionSuggestion[] = [];
  const complementary: Array<[SkillDimension, SkillDimension, string]> = [
    ['style', 'character', '文风 + 人物 = 角色语气鲜明'],
    ['plot', 'pacing', '剧情 + 节奏 = 推进张弛有度'],
    ['world', 'power', '世界 + 战力 = 设定自洽'],
    ['style', 'plot', '文风 + 剧情 = 好看又顺畅'],
    ['character', 'world', '人物 + 世界 = 角色扎根世界'],
  ];
  for (const [left, right, reason] of complementary) {
    if (populated.includes(left) && populated.includes(right)) {
      suggestions.push({ left, right, reason });
    }
    if (suggestions.length >= 3) break;
  }
  if (suggestions.length === 0 && populated.length >= 2) {
    suggestions.push({
      left: populated[0],
      right: populated[1],
      reason: `${DIMENSION_LABELS[populated[0]]} + ${DIMENSION_LABELS[populated[1]]} = 互补增强`,
    });
  }
  return suggestions;
}

interface SkillMapPanelProps {
  skills: Skill[];
}

export function SkillMapPanel({ skills }: SkillMapPanelProps) {
  const stats = useMemo(() => {
    const dimMap = new Map<SkillDimension, { count: number; totalScore: number; topName: string; topScore: number }>();
    for (const dim of ALL_DIMENSIONS) {
      dimMap.set(dim, { count: 0, totalScore: 0, topName: '', topScore: 0 });
    }
    for (const skill of skills) {
      const tags = skill.dimensionTags || (skill.primaryDimension ? [skill.primaryDimension] : []);
      for (const tag of tags) {
        const entry = dimMap.get(tag);
        if (!entry) continue;
        entry.count++;
        const score = skill.feedbackScore ?? skill.stabilityScore ?? 0;
        entry.totalScore += score;
        if (score > entry.topScore) {
          entry.topScore = score;
          entry.topName = skill.name;
        }
      }
    }
    const dimensionStats: DimensionStats[] = ALL_DIMENSIONS.map((dim) => {
      const entry = dimMap.get(dim)!;
      return {
        dimension: dim,
        label: DIMENSION_LABELS[dim],
        count: entry.count,
        avgScore: entry.count > 0 ? Math.round(entry.totalScore / entry.count) : 0,
        topSkillName: entry.topName,
      };
    });

    const populated = dimensionStats.filter((d) => d.count > 0).map((d) => d.dimension);
    const missing = dimensionStats.filter((d) => d.count === 0).map((d) => d.dimension);
    const weak = dimensionStats.filter((d) => d.count > 0 && d.avgScore < 60).map((d) => d.dimension);
    const fusionSuggestions = deriveFusionSuggestions(populated, missing);

    const totalSkills = skills.length;
    const mountedCount = skills.filter((s) => (s.usageStats?.mountedCount ?? 0) > 0).length;
    const avgFeedback = skills.length > 0
      ? Math.round(skills.reduce((sum, s) => sum + (s.feedbackScore ?? 0), 0) / skills.length)
      : 0;

    return { dimensionStats, populated, missing, weak, fusionSuggestions, totalSkills, mountedCount, avgFeedback };
  }, [skills]);

  if (skills.length === 0) return null;

  return (
    <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Compass size={18} className="text-theme-accent" />
        <span className="font-bold text-theme-text text-sm">Skill 地图</span>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-theme-sidebar/20 px-3 py-2.5 text-center">
          <div className="text-lg font-bold text-theme-text">{stats.totalSkills}</div>
          <div className="text-[10px] text-theme-muted">技能总数</div>
        </div>
        <div className="rounded-xl bg-theme-sidebar/20 px-3 py-2.5 text-center">
          <div className="text-lg font-bold text-theme-text">{stats.mountedCount}</div>
          <div className="text-[10px] text-theme-muted">已装配</div>
        </div>
        <div className="rounded-xl bg-theme-sidebar/20 px-3 py-2.5 text-center">
          <div className="text-lg font-bold text-theme-text">{stats.avgFeedback}</div>
          <div className="text-[10px] text-theme-muted">均分</div>
        </div>
      </div>

      {/* Dimension bars */}
      <div className="space-y-2">
        <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">能力维度分布</div>
        {stats.dimensionStats.map((ds) => (
          <div key={ds.dimension} className="flex items-center gap-2">
            <span className={`text-[10px] font-bold w-10 shrink-0 ${ds.count === 0 ? 'text-theme-muted/40' : 'text-theme-text'}`}>
              {ds.label}
            </span>
            <div className="flex-1 h-2 rounded-full bg-theme-sidebar overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, ds.count * 25)}%`,
                  backgroundColor: ds.count === 0 ? '#e5e7eb' : ds.avgScore >= 70 ? '#059669' : ds.avgScore >= 50 ? '#d97706' : '#dc2626',
                }}
              />
            </div>
            <span className="text-[10px] text-theme-muted w-8 text-right">{ds.count}</span>
          </div>
        ))}
      </div>

      {/* Alerts */}
      {(stats.missing.length > 0 || stats.weak.length > 0) && (
        <div className="space-y-1.5">
          {stats.missing.length > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-700">
              <AlertCircle size={10} />
              缺失维度：{stats.missing.map((d) => DIMENSION_LABELS[d]).join('、')}
            </div>
          )}
          {stats.weak.length > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-700">
              <TrendingUp size={10} />
              薄弱维度：{stats.weak.map((d) => DIMENSION_LABELS[d]).join('、')}
            </div>
          )}
        </div>
      )}

      {/* Fusion suggestions */}
      {stats.fusionSuggestions.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">可融合路径</div>
          {stats.fusionSuggestions.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px] text-theme-accent">
              <Zap size={10} />
              <span className="font-bold">{DIMENSION_LABELS[s.left]}</span>
              <span className="text-theme-muted">+</span>
              <span className="font-bold">{DIMENSION_LABELS[s.right]}</span>
              <span className="text-theme-muted">— {s.reason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
