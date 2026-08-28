import { useMemo, useState } from 'react';
import { GitMerge, Sparkles } from 'lucide-react';

import { buildResolvedFusionDraft, explainSkillFusion, isAuthorizedSkillFusionSource } from '../../lib/skill-fusion';
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
  const [conflictsConfirmed, setConflictsConfirmed] = useState(false);

  const supportSkill = useMemo(
    () => candidates.find((skill) => skill.id === supportSkillId && isAuthorizedSkillFusionSource(skill)) || null,
    [candidates, supportSkillId],
  );
  const fusionTimestamp = supportSkill?.updatedAt ?? baseSkill.updatedAt ?? baseSkill.createdAt;

  const preview = useMemo(() => {
    if (!supportSkill) return null;
    return buildResolvedFusionDraft(baseSkill, supportSkill, fusionTimestamp, { confirmConflicts: conflictsConfirmed });
  }, [baseSkill, supportSkill, fusionTimestamp, conflictsConfirmed]);

  const explanation: SkillFusionExplanation | null = useMemo(() => {
    if (!supportSkill || !preview?.draft) return null;
    return explainSkillFusion({
      mainSkillName: baseSkill.name,
      supportSkillName: supportSkill.name,
      retained: preview.draft.fusionMeta?.retainedTraits || [],
      absorbed: preview.draft.fusionMeta?.absorbedTraits || [],
      risks: [...(preview.draft.fusionMeta?.risks || []), ...preview.conflicts],
    });
  }, [baseSkill, supportSkill, preview]);

  const conflictPreview = supportSkill
    ? buildResolvedFusionDraft(baseSkill, supportSkill, fusionTimestamp)
    : null;

  return (
    <section className="space-y-3">
      <div className="text-xs font-bold text-theme-muted uppercase tracking-wider flex items-center gap-2">
        <GitMerge size={14} />
        融合工坊
      </div>
      <div className="text-xs text-theme-muted" aria-live="polite">
        主卡：{baseSkill.name} · 辅卡：{supportSkill?.name || '待选择'}
      </div>
      <select
        aria-label="选择融合辅卡"
        value={supportSkillId}
        onChange={(event) => {
          const nextSupportSkillId = event.target.value;
          setSupportSkillId(nextSupportSkillId);
          setConflictsConfirmed(false);
          // Selecting a source only stages the pair; generation is explicit.
          onPreview(null);
        }}
        className="w-full rounded-xl border border-theme-border px-3 py-3 text-sm bg-theme-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/40"
      >
        <option value="">选择辅卡</option>
        {candidates
          .filter((skill) => skill.id !== baseSkill.id && isAuthorizedSkillFusionSource(skill))
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

      {conflictPreview && conflictPreview.conflicts.length > 0 && (
        <label className="flex items-start gap-2 text-xs text-theme-muted">
          <input
            type="checkbox"
            checked={conflictsConfirmed}
            onChange={(event) => setConflictsConfirmed(event.target.checked)}
            className="mt-0.5"
          />
          <span>我已确认冲突维度由主卡规则优先处理</span>
        </label>
      )}

      {conflictPreview && conflictPreview.conflicts.length > 0 && !conflictsConfirmed && (
        <div role="alert" className="text-xs text-amber-700">
          冲突待确认：{conflictPreview.conflicts.join('；')}
        </div>
      )}

      <button
        type="button"
        disabled={!supportSkill || !preview?.draft || (conflictPreview?.conflicts.length ?? 0) > 0 && !conflictsConfirmed}
        onClick={() => {
          if (!supportSkill) return;
          const resolved = buildResolvedFusionDraft(baseSkill, supportSkill, Date.now(), { confirmConflicts: conflictsConfirmed });
          onPreview(resolved.draft || null);
        }}
        className="w-full rounded-2xl bg-theme-accent text-white px-4 py-3 text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <Sparkles size={16} />
        生成融合候选
      </button>
    </section>
  );
}
