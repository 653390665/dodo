import { Sparkles } from 'lucide-react';
import { getSkillRoleLabel } from '../../lib/skill-language';
import type { Skill } from '../../types';
import type { SkillFitResult } from '../../lib/skill-model';

interface FusionSuggestionBannerProps {
  mainSkill: Skill;
  supportSkill: Skill;
  fit: SkillFitResult;
  acceptedCoMountCount?: number;
}

export function FusionSuggestionBanner({
  mainSkill,
  supportSkill,
  fit,
  acceptedCoMountCount,
}: FusionSuggestionBannerProps) {
  return (
    <div className="shrink-0 rounded-2xl border border-theme-accent/30 bg-theme-accent/5 px-4 py-3 text-sm text-theme-text flex items-start gap-3">
      <Sparkles size={18} className="text-theme-accent mt-0.5 shrink-0" />
      <div>
        这两张卡长期配合稳定，建议尝试融合：以《{mainSkill.name}》为主卡（{getSkillRoleLabel(mainSkill.primaryDimension)}），吸收《{supportSkill.name}》的增强特征（{getSkillRoleLabel(supportSkill.primaryDimension)}）。
        {acceptedCoMountCount != null && (
          <span className="ml-2 text-theme-muted">共挂采纳 {acceptedCoMountCount} 次</span>
        )}
        <span className="ml-2 text-theme-muted">当前适配 {fit.totalScore}%</span>
      </div>
    </div>
  );
}
