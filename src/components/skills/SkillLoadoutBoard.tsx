import { useMemo, useState } from 'react';
import { AlertTriangle, Grip, Sparkles, Trash2 } from 'lucide-react';

import { deriveSkillFitNeeds } from '../../lib/skill-fit-language';
import { getSkillRoleLabel, getSkillRoleLongLabel, getSkillRoleTags } from '../../lib/skill-language';
import { calculateSkillFitScore } from '../../lib/skill-model';
import { pickFusionSuggestionPair } from '../../lib/skill-fusion';
import {
  applyPreferenceFeedback,
  buildProjectPreferenceSnapshot,
  explainFitScoreDelta,
} from '../../lib/preference-flywheel';
import { FusionSuggestionBanner } from './FusionSuggestionBanner';
import { cn } from '../../lib/utils';
import type {
  Chapter,
  MountedSkillLoadoutItem,
  Novel,
  ProjectPreferenceProfile,
  SkillUsageRecord,
  Skill,
} from '../../../shared/types';

interface SkillLoadoutBoardProps {
  novel: Novel;
  currentChapter: Chapter | null;
  skills: Skill[];
  usageRecords?: SkillUsageRecord[];
  loadout: MountedSkillLoadoutItem[];
  onAssignSkill: (slot: number, skillId: string) => void;
  onRemoveSkill: (slot: number) => void;
  onPreferenceProfileChange?: (profile: ProjectPreferenceProfile) => void;
}

export function SkillLoadoutBoard({
  novel,
  currentChapter,
  skills,
  usageRecords = [],
  loadout,
  onAssignSkill,
  onRemoveSkill,
  onPreferenceProfileChange,
}: SkillLoadoutBoardProps) {
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [projectPreference, setProjectPreference] = useState<ProjectPreferenceProfile>(() =>
    novel.projectPreferenceProfile && novel.projectPreferenceProfile.evidenceCount > 0
      ? novel.projectPreferenceProfile
      : buildProjectPreferenceSnapshot({
          acceptedSkills: skills.filter((skill) => loadout.some((entry) => entry.skillId === skill.id)),
          rejectedSkills: [],
        }),
  );

  const mountedSkills = useMemo(
    () =>
      loadout
        .slice()
        .sort((left, right) => left.slot - right.slot)
        .map((entry) => skills.find((skill) => skill.id === entry.skillId))
        .filter((skill): skill is Skill => Boolean(skill)),
    [loadout, skills],
  );

  const fit = useMemo(
    () => {
      const needs = deriveSkillFitNeeds(novel, currentChapter);
      return calculateSkillFitScore({
        requiredDimensions: needs.requiredDimensions,
        chapterSignals: needs.chapterSignals,
        loadout: mountedSkills,
      });
    },
    [currentChapter, mountedSkills, novel],
  );

  const fitNeeds = useMemo(
    () => deriveSkillFitNeeds(novel, currentChapter),
    [currentChapter, novel],
  );

  const rankedSkills = useMemo(() => {
    const currentCoveredDimensions = new Set(
      mountedSkills.flatMap((mountedSkill) => mountedSkill.dimensionTags || []),
    );

    return skills
      .map((skill) => {
        const simulatedLoadout = loadout
          .filter((entry) => entry.slot !== selectedSlot && entry.skillId !== skill.id)
          .concat([{ slot: selectedSlot, skillId: skill.id, weight: 1, lockedDimensions: [] }])
          .sort((left, right) => left.slot - right.slot)
          .map((entry) => skills.find((candidate) => candidate.id === entry.skillId))
          .filter((candidate): candidate is Skill => Boolean(candidate));

        const projectedFitResult = calculateSkillFitScore({
          requiredDimensions: fitNeeds.requiredDimensions,
          chapterSignals: fitNeeds.chapterSignals,
          loadout: simulatedLoadout,
        });
        const projectedFit = projectedFitResult.totalScore;
        const recommendationScore = Math.round(
          projectedFit * 0.55 +
            (skill.stabilityScore || 0) * 0.25 +
            (skill.feedbackScore || 50) * 0.2,
        );
        const candidateDimensions = new Set(skill.dimensionTags || []);
        const newlyCoveredDimensions = fitNeeds.requiredDimensions.filter(
          (dimension) => candidateDimensions.has(dimension) && !currentCoveredDimensions.has(dimension),
        );
        const conflictNotes = projectedFitResult.conflicts
          .filter((conflict) => conflict.leftId === skill.id || conflict.rightId === skill.id)
          .map((conflict) => {
            const counterpartId = conflict.leftId === skill.id ? conflict.rightId : conflict.leftId;
            const counterpart = simulatedLoadout.find((candidate) => candidate.id === counterpartId);
            const dimensions = conflict.reason
              .replace('shared-style-dimensions:', '')
              .split(',')
              .filter(Boolean)
              .map((dimension) => getSkillRoleLabel(dimension));
            return `${counterpart?.name || '另一张卡'} 在 ${dimensions.join(' / ')} 上存在职责冲突`;
          })
          .slice(0, 2);
        const explanation = [
          newlyCoveredDimensions.length > 0
            ? `补足 ${newlyCoveredDimensions.map((dimension) => getSkillRoleLabel(dimension)).join(' / ')} 职责`
            : null,
          projectedFit >= fit.totalScore + 8
            ? `替换后整体适配分提升到 ${projectedFit}`
            : projectedFit > fit.totalScore
              ? `能小幅抬高当前组合适配`
              : null,
          (skill.feedbackScore || 50) >= 70
            ? `历史反馈较稳，保留率更高`
            : (skill.feedbackScore || 50) <= 40
              ? `历史反馈偏弱，建议先试驾再挂载`
              : null,
        ]
          .filter((item): item is string => Boolean(item))
          .slice(0, 2);

        return {
          skill,
          projectedFit,
          recommendationScore,
          explanation,
          conflictNotes,
        };
      })
      .sort((left, right) => right.recommendationScore - left.recommendationScore);
  }, [fit.totalScore, fitNeeds.chapterSignals, fitNeeds.requiredDimensions, loadout, mountedSkills, selectedSlot, skills]);

  const selectedRecommendation = rankedSkills[0];

  const fitExplanation = useMemo(() => {
    if (!selectedRecommendation) return null;
    const matchedTraits = (selectedRecommendation.skill.dimensionTags || [])
      .slice(0, 3)
      .map((dimension) => getSkillRoleLabel(dimension));
    const conflictReduction =
      selectedRecommendation.conflictNotes.length < fit.conflicts.length && fit.conflicts.length > 0
        ? ['节奏或风格冲突减少']
        : [];

    return explainFitScoreDelta({
      previousScore: fit.totalScore,
      nextScore: selectedRecommendation.projectedFit,
      matchedTraits,
      resolvedConflicts: conflictReduction,
      remainingRisks: selectedRecommendation.conflictNotes,
    });
  }, [fit.conflicts.length, fit.totalScore, selectedRecommendation]);

  const fusionSuggestion = useMemo(() => {
    if (mountedSkills.length < 2 || fit.totalScore < 80 || fit.conflicts.length > 0) {
      return null;
    }
    return pickFusionSuggestionPair(mountedSkills, usageRecords, projectPreference);
  }, [fit.conflicts.length, fit.totalScore, mountedSkills, usageRecords, projectPreference]);

  const handlePreferenceAction = (
    action: 'more-like-me' | 'not-for-me' | 'project-only',
  ) => {
    if (!selectedRecommendation?.skill.primaryDimension) return;
    const notes: Record<typeof action, string> = {
      'more-like-me': `本项目更接受 ${getSkillRoleLabel(selectedRecommendation.skill.primaryDimension)} 强化`,
      'not-for-me': `${getSkillRoleLabel(selectedRecommendation.skill.primaryDimension)} 不要压过当前主线`,
      'project-only': `这次 ${selectedRecommendation.skill.name} 只作为当前项目策略`,
    };

    setProjectPreference((prev) => {
      const next = applyPreferenceFeedback(prev, {
        action,
        dimension: selectedRecommendation.skill.primaryDimension || undefined,
        note: notes[action],
      });
      onPreferenceProfileChange?.(next);
      return next;
    });
  };

  return (
    <div className="h-full min-h-0 flex flex-col gap-5">
      <div className="shrink-0 bg-theme-text text-white p-5 rounded-3xl shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-theme-accent/20 blur-3xl -mr-10 -mt-10" />
        <div className="relative z-10 space-y-4">
          <div className="flex justify-between items-start gap-4">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-widest opacity-60">当前叙事 DNA</h3>
              <p className="mt-2 text-sm font-serif leading-relaxed">
                {mountedSkills.length === 0
                  ? '尚未装配任何 Skill，当前仍是系统默认笔调。'
                  : `当前组合以 ${mountedSkills
                      .map((skill) => skill.name)
                      .join(' / ')} 为核心，正在生成一套可组合的写作人格。`}
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="text-2xl font-black text-theme-accent">{fit.totalScore}%</div>
              <div className="text-[10px] uppercase tracking-widest opacity-60">适配得分</div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
            <div className="rounded-xl bg-theme-sidebar/10 px-3 py-2">
              覆盖 {fit.breakdown.coverageScore}%
            </div>
            <div className="rounded-xl bg-theme-sidebar/10 px-3 py-2">
              上下文 {fit.breakdown.contextScore}%
            </div>
            <div className="rounded-xl bg-theme-sidebar/10 px-3 py-2">
              稳定性 {fit.breakdown.stabilityScore}%
            </div>
            <div className="rounded-xl bg-theme-sidebar/10 px-3 py-2">
              惩罚 {fit.breakdown.conflictPenalty}%
            </div>
          </div>

          {fit.conflicts.length > 0 && (
            <div className="rounded-2xl bg-amber-400/10 border border-amber-300/20 px-4 py-3 text-xs text-amber-100 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div>
                检测到 {fit.conflicts.length} 处组合冲突。
                {fit.recommendations[0] ? ` ${fit.recommendations[0]}` : ''}
              </div>
            </div>
          )}
        </div>
      </div>

      {fusionSuggestion && (
        <FusionSuggestionBanner
          mainSkill={fusionSuggestion.mainSkill}
          supportSkill={fusionSuggestion.supportSkill}
          acceptedCoMountCount={fusionSuggestion.acceptedCoMountCount}
          fit={fit}
        />
      )}

      {fitExplanation && (
        <div className="shrink-0 rounded-3xl border border-theme-border bg-theme-sidebar p-5 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-widest text-theme-muted">即时反馈</h3>
              <p className="mt-2 text-sm font-medium text-theme-text">{fitExplanation.summary}</p>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[10px] font-bold text-theme-muted">项目写法</div>
              <div className="mt-1 flex flex-wrap justify-end gap-1.5">
                {projectPreference.tags.length > 0 ? (
                  projectPreference.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-theme-border bg-theme-sidebar px-2 py-0.5 text-[10px] text-theme-muted"
                    >
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="rounded-full border border-theme-border bg-theme-sidebar px-2 py-0.5 text-[10px] text-theme-muted">
                    画像形成中
                  </span>
                )}
              </div>
            </div>
          </div>

          {fitExplanation.highlights.length > 0 && (
            <div className="rounded-2xl border border-theme-accent/15 bg-theme-accent/5 px-4 py-3 text-xs text-theme-text leading-relaxed">
              {fitExplanation.highlights.map((item) => (
                <div key={item}>{item}</div>
              ))}
            </div>
          )}

          {fitExplanation.risks.length > 0 && (
            <div className="rounded-2xl border border-amber-200/50 bg-amber-50 px-4 py-3 text-xs text-amber-700 leading-relaxed">
              {fitExplanation.risks.map((risk) => (
                <div key={risk}>{risk}</div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handlePreferenceAction('more-like-me')}
              className="rounded-full border border-theme-border bg-theme-sidebar px-3 py-2 text-xs font-bold text-theme-text hover:bg-theme-sidebar/45 transition-colors"
            >
              这更像我
            </button>
            <button
              onClick={() => handlePreferenceAction('not-for-me')}
              className="rounded-full border border-theme-border bg-theme-sidebar px-3 py-2 text-xs font-bold text-theme-text hover:bg-theme-sidebar/45 transition-colors"
            >
              这不是我想要的
            </button>
            <button
              onClick={() => handlePreferenceAction('project-only')}
              className="rounded-full border border-theme-border bg-theme-sidebar px-3 py-2 text-xs font-bold text-theme-text hover:bg-theme-sidebar/45 transition-colors"
            >
              仅限本项目
            </button>
          </div>
        </div>
      )}

      <div className="shrink-0 space-y-3">
        <div className="flex justify-between items-center px-1">
          <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">装配卡槽</h3>
          <span className="text-[9px] text-theme-muted bg-theme-sidebar px-2 py-0.5 rounded-full border border-theme-border">
            容量: {mountedSkills.length}/3
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[0, 1, 2].map((slot) => {
            const entry = loadout.find((item) => item.slot === slot);
            const skill = entry ? skills.find((candidate) => candidate.id === entry.skillId) : null;
            return (
              <div
                key={slot}
                onClick={() => setSelectedSlot(slot)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const skillId = event.dataTransfer.getData('text/skill-id');
                  if (skillId) {
                    onAssignSkill(slot, skillId);
                    setSelectedSlot(slot);
                  }
                }}
                className={cn(
                  'rounded-2xl border p-4 min-h-[152px] transition-colors',
                  selectedSlot === slot
                    ? 'border-theme-accent bg-theme-accent/5'
                    : 'border-theme-border bg-theme-sidebar',
                )}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[10px] font-bold text-theme-muted uppercase">卡槽 {slot + 1}</div>
                  {skill && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveSkill(slot);
                      }}
                      className="p-1 rounded-md text-theme-muted hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                {skill ? (
                  <div className="space-y-2">
                    <div className="text-sm font-bold text-theme-text">{skill.name}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {getSkillRoleTags(skill.dimensionTags).slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 rounded-full bg-theme-sidebar text-[10px] text-theme-muted border border-theme-border"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="text-[11px] text-theme-muted leading-relaxed">
                      {skill.description}
                    </div>
                  </div>
                ) : (
                  <div className="h-[96px] rounded-xl border border-dashed border-theme-border/60 bg-theme-sidebar/20 flex items-center justify-center text-xs text-theme-muted">
                    拖拽技能卡到这里
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex flex-col space-y-4">
        <div className="flex justify-between items-center px-1">
          <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">技能卡组</h3>
          <div className="text-[9px] text-theme-muted">点击卡牌装入当前选中卡槽，或直接拖拽替换</div>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain pr-1">
          <div className="grid grid-cols-1 gap-4 pb-4">
          {rankedSkills.map(({ skill, projectedFit, recommendationScore, explanation, conflictNotes }) => {
            const mountedEntry = loadout.find((entry) => entry.skillId === skill.id);
            const isMounted = Boolean(mountedEntry);
            return (
              <div
                key={skill.id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/skill-id', skill.id);
                }}
                onClick={() => onAssignSkill(selectedSlot, skill.id)}
                className={cn(
                  'p-5 rounded-2xl border transition-all cursor-pointer group relative overflow-hidden bg-theme-sidebar',
                  isMounted
                    ? 'border-theme-accent shadow-lg shadow-theme-accent/5 ring-1 ring-theme-accent/20'
                    : 'border-theme-border/40 hover:border-theme-accent/30 hover:shadow-md',
                )}
              >
                <div className="flex justify-between items-start mb-3 gap-3">
                  <div className="min-w-0">
                    <div className={cn('text-sm font-bold tracking-tight', isMounted ? 'text-theme-accent' : 'text-theme-text')}>
                      {skill.name}
                    </div>
                    <div className="text-[8px] text-theme-muted uppercase font-bold tracking-tighter">
                      v{skill.version || 1} · {getSkillRoleLabel(skill.primaryDimension)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={cn('text-xs font-black', isMounted ? 'text-theme-accent' : 'text-theme-muted')}>
                      {skill.stabilityScore}%
                    </div>
                    <div className="text-[7px] text-theme-muted uppercase font-bold">Stability</div>
                  </div>
                </div>

                <p className="text-[10px] text-theme-muted line-clamp-2 leading-relaxed mb-4 min-h-[2.4em]">
                  {skill.description}
                </p>

                <div className="grid grid-cols-3 gap-2 mb-4 text-[9px]">
                  <div className="rounded-lg bg-theme-sidebar/50 px-2 py-1 text-theme-muted border border-theme-border/30">
                    推荐 {recommendationScore}
                  </div>
                  <div className="rounded-lg bg-theme-sidebar/50 px-2 py-1 text-theme-muted border border-theme-border/30">
                    投放后 {projectedFit}
                  </div>
                  <div className="rounded-lg bg-theme-sidebar/50 px-2 py-1 text-theme-muted border border-theme-border/30">
                    反馈 {skill.feedbackScore || 50}
                  </div>
                </div>

                {(explanation.length > 0 || conflictNotes.length > 0) && (
                  <div className="mb-4 space-y-2">
                    {explanation.length > 0 && (
                      <div className="rounded-xl border border-theme-accent/15 bg-theme-accent/5 px-3 py-2 text-[10px] text-theme-text leading-relaxed">
                        {explanation.map((reason, index) => (
                          <div key={reason} className={index > 0 ? 'mt-1' : undefined}>
                            {reason}
                          </div>
                        ))}
                      </div>
                    )}
                    {conflictNotes.length > 0 && (
                      <div className="rounded-xl border border-amber-200/50 bg-amber-50 px-3 py-2 text-[10px] text-amber-700 leading-relaxed">
                        {conflictNotes.map((note, index) => (
                          <div key={note} className={index > 0 ? 'mt-1' : undefined}>
                            {index === 0 ? `冲突提醒：${note}` : note}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-between items-center">
                  <div className="flex gap-1.5 flex-wrap">
                    <span className="text-[9px] px-2 py-0.5 bg-theme-sidebar rounded-full text-theme-muted border border-theme-border/30 font-medium">
                      {getSkillRoleLongLabel(skill.primaryDimension)}
                    </span>
                    {getSkillRoleTags(skill.dimensionTags).slice(0, 2).map((tag) => (
                      <span
                        key={tag}
                        className="text-[9px] px-2 py-0.5 bg-theme-sidebar rounded-full text-theme-muted border border-theme-border/30 font-medium"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="text-[9px] font-bold text-theme-muted/60 flex items-center gap-1">
                    <Grip size={10} /> 拖拽或点击装配
                  </div>
                </div>

                {isMounted && (
                  <div className="absolute top-0 right-0 w-24 h-24 bg-theme-accent/5 rounded-full -mr-12 -mt-12 blur-2xl" />
                )}
              </div>
            );
          })}

          {skills.length === 0 && (
            <div className="text-center py-16 px-8 border-2 border-dashed border-theme-border/30 rounded-3xl bg-theme-sidebar/10">
              <Sparkles size={32} className="mx-auto mb-3 opacity-20 text-theme-text" />
              <p className="text-xs text-theme-muted font-bold">尚未在“拆书工厂”萃取任何 Skill</p>
              <p className="text-[9px] text-theme-muted/60 mt-1">上传名家文稿，解析其文字灵魂</p>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
