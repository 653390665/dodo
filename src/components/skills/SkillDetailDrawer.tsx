import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Cpu, GitBranch, Layers, Loader2, Save, Sparkles, X } from 'lucide-react';

import { subscribeToChanges } from '../../lib/db-transport';
import { createSkill, listSkillUsageRecords, listSkillVersions, updateSkill } from '../../lib/skill-client';
import { getSkillRoleLabel, getSkillRoleTags } from '../../lib/skill-language';
import { summarizeUsageStats } from '../../lib/skill-model';
import { cn } from '../../lib/utils';
import type { Skill, SkillDimension, SkillUsageStats } from '../../../shared/types';
import { SkillFusionWorkbench } from './SkillFusionWorkbench';
import { SkillTestBench } from './SkillTestBench';
import { SkillVersionTimeline } from './SkillVersionTimeline';

const SKILL_DIMENSIONS: Array<{ value: SkillDimension; label: string }> = [
  { value: 'style', label: '文笔文风' },
  { value: 'character', label: '人物构建' },
  { value: 'world', label: '世界观打造' },
  { value: 'power', label: '战力设定' },
  { value: 'plot', label: '剧情结构' },
  { value: 'pacing', label: '节奏控制' },
];

function buildDraft(skill: Skill | null): Skill | null {
  if (!skill) return null;
  return {
    ...skill,
    dimensionTags: skill.dimensionTags || [],
  };
}

function hasUsageData(stats: SkillUsageStats | null | undefined): stats is SkillUsageStats {
  if (!stats) return false;
  return (
    stats.mountedCount > 0 ||
    stats.acceptedCount > 0 ||
    stats.revisedCount > 0 ||
    stats.rejectedCount > 0 ||
    stats.averageFitScore > 0
  );
}

interface SkillDetailDrawerProps {
  skill: Skill | null;
  allSkills: Skill[];
  open: boolean;
  onClose: () => void;
  onSelectSkill: (skillId: string) => void;
}

export function SkillDetailDrawer({
  skill,
  allSkills,
  open,
  onClose,
  onSelectSkill,
}: SkillDetailDrawerProps) {
  const [draft, setDraft] = useState<Skill | null>(buildDraft(skill));
  const [versions, setVersions] = useState<Skill[]>([]);
  const [usageStats, setUsageStats] = useState<SkillUsageStats | null>(skill?.usageStats || null);
  const [savingMode, setSavingMode] = useState<'update' | 'fork' | null>(null);
  const [fusionPreview, setFusionPreview] = useState<Skill | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing state from props
    setDraft(buildDraft(skill));
    setUsageStats(skill?.usageStats || null);
    setFusionPreview(null);
  }, [skill]);

  useEffect(() => {
    if (!skill) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset state on skill clear
      setVersions([]);
      setUsageStats(null);
      return;
    }
    const refreshSkillMeta = async () => {
      try {
        const [nextVersions, records] = await Promise.all([
          listSkillVersions(skill.id),
          listSkillUsageRecords(skill.id),
        ]);
        const nextUsageStats = summarizeUsageStats(records);
        setVersions(nextVersions);
        setUsageStats(
          hasUsageData(nextUsageStats)
            ? nextUsageStats
            : skill.usageStats || null,
        );
      } catch {
        setVersions([]);
        setUsageStats(skill.usageStats || null);
      }
    };
    refreshSkillMeta();
    return subscribeToChanges(refreshSkillMeta);
  }, [skill]);

  const selectedDimensionSet = useMemo(
    () => new Set(draft?.dimensionTags || []),
    [draft?.dimensionTags],
  );
  const fusionCandidates = useMemo(
    () => {
      if (!draft) return [];
      return allSkills.filter((candidate) => {
        if (candidate.id === draft.id) return false;
        if (!candidate.primaryDimension) return true;
        return candidate.primaryDimension !== draft.primaryDimension || candidate.id !== draft.id;
      });
    },
    [allSkills, draft],
  );
  const testBenchCandidates = useMemo(() => {
    if (!fusionPreview) return versions;
    return [fusionPreview, ...versions.filter((version) => version.id !== fusionPreview.id)];
  }, [fusionPreview, versions]);

  if (!skill || !draft) {
    return (
      <div className="hidden xl:flex w-[380px] shrink-0 border-l border-theme-border bg-theme-sidebar/80 backdrop-blur-sm flex-col p-6 overflow-y-auto">
        <div className="text-center py-6 border-b border-theme-border/50 shrink-0">
          <Sparkles size={32} className="mx-auto mb-3 text-theme-accent animate-pulse" />
          <h3 className="text-sm font-bold text-theme-text">选择一张技能卡</h3>
          <p className="text-xs text-theme-muted mt-1">查看详细内容、进行版本比对并配置写作装配链路</p>
        </div>

        <div className="flex-1 py-6 space-y-5 text-left">
          <div className="text-xs font-bold text-theme-text uppercase tracking-wider text-theme-muted/80">技能卡牌有哪些能力：</div>
          
          <div className="flex gap-3 items-start">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-theme-accent/10 text-theme-accent">
              <BookOpen size={14} />
            </span>
            <div>
              <h4 className="text-xs font-bold text-theme-text">核心写作用途 (Purpose)</h4>
              <p className="text-[11px] text-theme-muted leading-relaxed mt-1">
                限制 AI 写作的叙事边界、字数节奏及描写密度，在不同场景（如打斗、悬疑）下使用对应技能。
              </p>
            </div>
          </div>

          <div className="flex gap-3 items-start">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-theme-accent/10 text-theme-accent">
              <Cpu size={14} />
            </span>
            <div>
              <h4 className="text-xs font-bold text-theme-text">影响维度 (Dimensions)</h4>
              <p className="text-[11px] text-theme-muted leading-relaxed mt-1">
                设定文风、剧情、战力、人物等主次维度，指导 AI 严格贯彻当前段落的核心设定。
              </p>
            </div>
          </div>

          <div className="flex gap-3 items-start">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-theme-accent/10 text-theme-accent">
              <GitBranch size={14} />
            </span>
            <div>
              <h4 className="text-xs font-bold text-theme-text">版本谱系 (Lineage)</h4>
              <p className="text-[11px] text-theme-muted leading-relaxed mt-1">
                保存历次修改的演进记录，防丢防崩；支持通过“技能融合”合成多种技能高级文风卡。
              </p>
            </div>
          </div>

          <div className="flex gap-3 items-start">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-theme-accent/10 text-theme-accent">
              <Layers size={14} />
            </span>
            <div>
              <h4 className="text-xs font-bold text-theme-text">装配路径 (Equipping Path)</h4>
              <p className="text-[11px] text-theme-muted leading-relaxed mt-1">
                将卡片绑定到特定作品，在进入写作工作台时即插即用，提升段落控制力。
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  async function handleSave(mode: 'update' | 'fork') {
    if (!skill) return;
    setSavingMode(mode);
    const now = Date.now();
    try {
      if (mode === 'update') {
        if (draft) {
          await updateSkill(skill.id, {
            ...draft,
            updatedAt: now,
          });
        }
        return;
      }

      const source = fusionPreview || draft;
      if (!source) return;
      const nextVersion = (skill.version || 1) + 1;
      const nextId = `${skill.lineageRootId || skill.id}-${nextVersion}-${now}`;
      await createSkill({
        ...source,
        id: nextId,
        name: source.name || '',
        description: source.description || '',
        style: source.style || '',
        pacing: source.pacing || '',
        stabilityScore: source.stabilityScore ?? 80,
        evaluationFeedback: source.evaluationFeedback || '',
        version: nextVersion,
        parentSkillId: skill.id,
        lineageRootId: skill.lineageRootId || skill.id,
        createdAt: now,
        updatedAt: now,
      });
      onSelectSkill(nextId);
    } finally {
      setSavingMode(null);
    }
  }

  function toggleDimension(tag: SkillDimension) {
    if (!draft) return;
    const next = new Set(draft.dimensionTags || []);
    if (next.has(tag)) {
      next.delete(tag);
    } else {
      next.add(tag);
    }
    setDraft({
      ...draft,
      dimensionTags: Array.from(next),
    });
  }

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 bg-black/20 transition-opacity xl:hidden',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          'fixed xl:static inset-y-0 right-0 z-30 w-full max-w-[460px] shrink-0 border-l border-theme-border bg-theme-sidebar/95 backdrop-blur-sm transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full xl:translate-x-0',
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border">
          <div>
            <div className="text-sm font-bold text-theme-text">{draft.name}</div>
            <div className="text-[11px] text-theme-muted mt-1">
              v{draft.version || 1} · {getSkillRoleLabel(draft.primaryDimension)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="xl:hidden p-2 rounded-lg hover:bg-theme-sidebar/40 transition-colors"
            aria-label="关闭技能详情"
          >
            <X size={18} />
          </button>
        </div>

        <div className="h-[calc(100%-73px)] overflow-y-auto p-5 space-y-6">
          <section className="space-y-3">
            <div className="text-xs font-bold text-theme-muted uppercase tracking-wider">基础信息</div>
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className="w-full rounded-xl border border-theme-border px-4 py-3 text-sm bg-theme-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/40"
              placeholder="技能名称"
            />
            <textarea
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              className="w-full rounded-xl border border-theme-border px-4 py-3 text-sm min-h-[96px] bg-theme-sidebar resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/40"
              placeholder="技能描述"
            />
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-2">
                <span className="text-[11px] font-bold text-theme-muted">主职责</span>
                <select
                  value={draft.primaryDimension || 'style'}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      primaryDimension: event.target.value as SkillDimension,
                    })
                  }
                  className="w-full rounded-xl border border-theme-border px-3 py-3 text-sm bg-theme-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/40"
                >
                  {SKILL_DIMENSIONS.map((dimension) => (
                    <option key={dimension.value} value={dimension.value}>
                      {dimension.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-[11px] font-bold text-theme-muted">稳定性</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.stabilityScore}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      stabilityScore: Number(event.target.value) || 0,
                    })
                  }
                  className="w-full rounded-xl border border-theme-border px-4 py-3 text-sm bg-theme-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/40"
                />
              </label>
            </div>
          </section>

          <section className="space-y-3">
            <div className="text-xs font-bold text-theme-muted uppercase tracking-wider">职责画像</div>
            <div className="flex flex-wrap gap-2">
              {SKILL_DIMENSIONS.map((dimension) => (
                <button
                  key={dimension.value}
                  type="button"
                  onClick={() => toggleDimension(dimension.value)}
                  className={cn(
                    'px-3 py-1.5 rounded-full border text-xs font-bold transition-colors',
                    selectedDimensionSet.has(dimension.value)
                      ? 'border-theme-accent bg-theme-accent/10 text-theme-accent'
                      : 'border-theme-border bg-theme-sidebar text-theme-muted hover:bg-theme-sidebar/20',
                  )}
                >
                  {dimension.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {getSkillRoleTags(draft.dimensionTags).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-theme-accent/20 bg-theme-accent/5 px-2.5 py-1 text-[10px] font-medium text-theme-text"
                >
                  {tag}
                </span>
              ))}
            </div>
            <textarea
              value={draft.style}
              onChange={(event) => setDraft({ ...draft, style: event.target.value })}
              className="w-full rounded-xl border border-theme-border px-4 py-3 text-sm min-h-[96px] bg-theme-sidebar resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/40"
              placeholder="文风设定"
            />
            <textarea
              value={draft.pacing}
              onChange={(event) => setDraft({ ...draft, pacing: event.target.value })}
              className="w-full rounded-xl border border-theme-border px-4 py-3 text-sm min-h-[80px] bg-theme-sidebar resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/40"
              placeholder="节奏逻辑"
            />
            <textarea
              value={draft.characterTraits || ''}
              onChange={(event) => setDraft({ ...draft, characterTraits: event.target.value })}
              className="w-full rounded-xl border border-theme-border px-4 py-3 text-sm min-h-[80px] bg-theme-sidebar resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/40"
              placeholder="人物构建特征"
            />
            <textarea
              value={draft.worldBuilding || ''}
              onChange={(event) => setDraft({ ...draft, worldBuilding: event.target.value })}
              className="w-full rounded-xl border border-theme-border px-4 py-3 text-sm min-h-[80px] bg-theme-sidebar resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/40"
              placeholder="世界观与战力设定"
            />
          </section>

          <section className="space-y-3">
            <div className="text-xs font-bold text-theme-muted uppercase tracking-wider">版本谱系</div>
            <SkillVersionTimeline
              versions={versions}
              activeId={skill.id}
              onSelect={(version) => onSelectSkill(version.id)}
            />
          </section>

          <section className="space-y-3">
            <div className="text-xs font-bold text-theme-muted uppercase tracking-wider">使用反馈摘要</div>
            <div className="rounded-2xl border border-theme-border p-4 bg-theme-sidebar/20">
              {usageStats ? (
                <>
                  <div className="text-sm font-bold text-theme-text">
                    装配 {usageStats.mountedCount} 次
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-3 text-[11px] text-theme-muted">
                    <div>采纳 {usageStats.acceptedCount} 次</div>
                    <div>重写 {usageStats.revisedCount} 次</div>
                    <div>替换 {usageStats.rejectedCount} 次</div>
                    <div>平均适配 {Math.round(usageStats.averageFitScore)} 分</div>
                  </div>
                </>
              ) : (
                <div className="text-xs text-theme-muted">
                  暂无使用反馈数据。后续在创作舞台装配并生成正文后，这里会自动累积统计。
                </div>
              )}
            </div>
          </section>

          <section>
            <SkillFusionWorkbench
              baseSkill={draft}
              candidates={fusionCandidates}
              onPreview={setFusionPreview}
            />
          </section>

          <section>
            <SkillTestBench
              baseSkill={fusionPreview || draft}
              candidates={testBenchCandidates}
            />
          </section>

          <section className="grid grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={() => handleSave('update')}
              disabled={savingMode !== null}
              className="rounded-2xl bg-theme-text text-white px-4 py-3 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {savingMode === 'update' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              保存当前版本
            </button>
            <button
              type="button"
              onClick={() => handleSave('fork')}
              disabled={savingMode !== null}
              className="rounded-2xl bg-theme-accent text-white px-4 py-3 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {savingMode === 'fork' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {fusionPreview ? '保存融合候选' : '保存为新版本'}
            </button>
          </section>
        </div>
      </aside>
    </>
  );
}
