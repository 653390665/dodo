import { useMemo, useState } from 'react';
import { GitMerge, Sparkles } from 'lucide-react';

import { buildFusionDraft, explainSkillFusion } from '../../lib/skill-fusion';
import type { Skill, SkillFusionExplanation } from '../../../shared/types';

interface SkillFusionWorkbenchProps {
  baseSkill: Skill;
  candidates: Skill[];
  onPreview: (draft: Skill | null) => void;
}

export function SkillFusionWorkbench({
  baseSkill,
  candidates,
  onPreview,
}: SkillFusionWorkbenchProps) {
  const [supportSkillId, setSupportSkillId] = useState('');

  const supportSkill = useMemo(
    () => candidates.find((skill) => skill.id === supportSkillId) || null,
    [candidates, supportSkillId],
  );

  const explanation: SkillFusionExplanation | null = useMemo(() => {
    if (!supportSkill) return null;
    const preview = buildFusionDraft(baseSkill, supportSkill);
    return explainSkillFusion({
      mainSkillName: baseSkill.name,
      supportSkillName: supportSkill.name,
      retained: preview.fusionMeta?.retainedTraits || [],
      absorbed: preview.fusionMeta?.absorbedTraits || [],
      risks: preview.fusionMeta?.risks || [],
    });
  }, [baseSkill, supportSkill]);

  return (
    <section className="space-y-3">
      <div className="text-xs font-bold text-theme-muted uppercase tracking-wider flex items-center gap-2">
        <GitMerge size={14} />
        融合工坊
      </div>
      <select
        value={supportSkillId}
        onChange={(event) => {
          const nextSupportSkillId = event.target.value;
          setSupportSkillId(nextSupportSkillId);
          const nextSupportSkill = candidates.find((skill) => skill.id === nextSupportSkillId);
          onPreview(nextSupportSkill ? buildFusionDraft(baseSkill, nextSupportSkill) : null);
        }}
        className="w-full rounded-xl border border-theme-border px-3 py-3 text-sm bg-theme-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/40"
      >
        <option value="">选择辅卡</option>
        {candidates
          .filter((skill) => skill.id !== baseSkill.id)
          .map((skill) => (
            <option key={skill.id} value={skill.id}>
              {skill.name}
            </option>
          ))}
      </select>

      {explanation && (
        <div className="rounded-2xl border border-theme-border bg-theme-sidebar/20 p-4 text-sm space-y-2">
          <div>
            <span className="font-bold">保留：</span>
            {explanation.retained.join('、') || '保留主卡核心表达'}
          </div>
          <div>
            <span className="font-bold">吸收：</span>
            {explanation.absorbed.join('、') || '吸收辅卡增强特征'}
          </div>
          <div>
            <span className="font-bold">风险：</span>
            {explanation.risks.join('、') || '暂无明显额外风险'}
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={!supportSkill}
        onClick={() => supportSkill && onPreview(buildFusionDraft(baseSkill, supportSkill))}
        className="w-full rounded-2xl bg-theme-accent text-white px-4 py-3 text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <Sparkles size={16} />
        生成融合候选
      </button>
    </section>
  );
}
