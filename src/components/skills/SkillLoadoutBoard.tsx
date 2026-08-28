import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';

import { deriveSkillFitNeeds } from '../../lib/skill-fit-language';
import { getSkillRoleLabel, getSkillRoleTags } from '../../lib/skill-language';
import { calculateSkillFitScore, getSkillScoreChannels } from '../../lib/skill-model';
import { normalizeProjectPreferenceProfile } from '../../../shared/lib/project-preference-profile';
import type {
  Chapter,
  MountedSkillLoadoutItem,
  Novel,
  ProjectPreferenceProfile,
  Skill,
  SkillUsageRecord,
} from '../../../shared/types';

/**
 * Compatibility adapter for legacy loadout data.
 *
 * Role slots are configured in the capability center. This component is
 * intentionally read-only so historical editor mounts cannot mutate them.
 */
interface SkillLoadoutBoardProps {
  novel: Novel;
  currentChapter: Chapter | null;
  skills: Skill[];
  usageRecords?: SkillUsageRecord[];
  loadout: MountedSkillLoadoutItem[];
  /** @deprecated Kept for callers that still pass legacy handlers. */
  onAssignSkill?: (slot: number, skillId: string) => void;
  /** @deprecated Kept for callers that still pass legacy handlers. */
  onRemoveSkill?: (slot: number) => void;
  onPreferenceProfileChange?: (profile: ProjectPreferenceProfile) => void;
  /** @deprecated Pending placement is resolved in the capability center. */
  pendingSkillIds?: string[];
  /** @deprecated Pending placement is resolved in the capability center. */
  onResolvePendingSkill?: (skillId: string, slot: number) => void;
}

export function SkillLoadoutBoard({
  novel,
  currentChapter,
  skills,
  loadout,
}: SkillLoadoutBoardProps) {
  const normalizedProfile = normalizeProjectPreferenceProfile(novel.projectPreferenceProfile);
  const mountedSkills = useMemo(
    () => loadout
      .slice()
      .sort((left, right) => left.slot - right.slot)
      .map((entry) => skills.find((skill) => skill.id === entry.skillId))
      .filter((skill): skill is Skill => Boolean(skill)),
    [loadout, skills],
  );
  const unresolvedLoadoutCount = useMemo(
    () => loadout.filter((entry) => !skills.some((skill) => skill.id === entry.skillId)).length,
    [loadout, skills],
  );
  const fit = useMemo(() => {
    const needs = deriveSkillFitNeeds(novel, currentChapter);
    return calculateSkillFitScore({
      requiredDimensions: needs.requiredDimensions,
      chapterSignals: needs.chapterSignals,
      loadout: mountedSkills,
    });
  }, [currentChapter, mountedSkills, novel]);

  return (
    <div className="h-full min-h-0 flex flex-col gap-4">
      <section className="shrink-0 rounded-2xl border border-theme-border bg-theme-sidebar p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-theme-text">能力摘要</h2>
            <p className="mt-1 text-xs leading-5 text-theme-muted">
              {mountedSkills.length > 0
                ? `当前项目已记录 ${mountedSkills.length} 张历史能力卡。长期配置请在作品能力中心管理。`
                : '当前没有已记录的能力卡，正文仍可使用系统默认笔调。'}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-xl font-black text-theme-accent">{fit.totalScore}%</div>
            <div className="text-[10px] text-theme-muted">当前场景适配</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-theme-muted md:grid-cols-4">
          <div className="rounded-lg border border-theme-border/40 px-2 py-1.5">覆盖 {fit.breakdown.coverageScore}%</div>
          <div className="rounded-lg border border-theme-border/40 px-2 py-1.5">上下文 {fit.breakdown.contextScore}%</div>
          <div className="rounded-lg border border-theme-border/40 px-2 py-1.5">稳定性 {fit.breakdown.stabilityScore}%</div>
          <div className="rounded-lg border border-theme-border/40 px-2 py-1.5">惩罚 {fit.breakdown.conflictPenalty}%</div>
        </div>
      </section>

      {loadout.length > 0 ? (
        <section className="shrink-0 rounded-xl border border-amber-300/40 bg-amber-50/5 px-4 py-3 text-xs text-theme-muted">
          <h3 className="font-semibold text-theme-text">旧配置待整理</h3>
          <p className="mt-1 leading-5">
            历史三槽配置仅供只读查看，不会阻断手写流程；后续请在作品能力中心整理。
            {unresolvedLoadoutCount > 0 ? ` ${unresolvedLoadoutCount} 项历史能力卡无法解析，已保留原记录。` : ''}
          </p>
        </section>
      ) : null}

      <section className="min-h-0 flex-1 overflow-y-auto space-y-3">
        <div className="flex items-center justify-between gap-2 px-1">
          <h3 className="text-xs font-semibold text-theme-text">当前能力卡</h3>
          <span className="text-[10px] text-theme-muted">
            {normalizedProfile.tags.length > 0 ? normalizedProfile.tags.slice(0, 3).join('、') : '系统默认笔调'}
          </span>
        </div>
        {mountedSkills.length === 0 ? (
          <div className="rounded-xl border border-dashed border-theme-border p-6 text-center text-xs text-theme-muted">
            <Sparkles size={24} className="mx-auto mb-2 opacity-40" aria-hidden="true" />
            暂无历史能力卡记录
          </div>
        ) : (
          mountedSkills.map((skill) => {
            const channels = getSkillScoreChannels(skill);
            return (
              <article key={skill.id} className="rounded-xl border border-theme-border/60 bg-theme-sidebar p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-semibold text-theme-text">{skill.name}</h4>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {getSkillRoleTags(skill.dimensionTags).slice(0, 3).map((tag) => (
                        <span key={tag} className="rounded-full border border-theme-border px-2 py-0.5 text-[10px] text-theme-muted">{tag}</span>
                      ))}
                      {skill.primaryDimension ? <span className="text-[10px] text-theme-muted">{getSkillRoleLabel(skill.primaryDimension)}</span> : null}
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] text-theme-muted">v{skill.version || 1}</span>
                </div>
                {skill.description ? <p className="mt-2 text-xs leading-5 text-theme-muted">{skill.description}</p> : null}
                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-theme-muted">
                  <div className="rounded-lg bg-theme-sidebar/60 px-2 py-1">冷启动分 {channels.coldStartScore ?? '—'}</div>
                  <div className="rounded-lg bg-theme-sidebar/60 px-2 py-1">证据稳定 {channels.evidenceStabilityScore ?? '—'}</div>
                  <div className="col-span-2 rounded-lg bg-theme-sidebar/60 px-2 py-1">
                    {channels.observedPerformance
                      ? `使用反馈 ${channels.observedPerformance.score}（${channels.observedPerformance.sampleSize}次）`
                      : '暂无使用反馈'}
                  </div>
                </div>
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}
