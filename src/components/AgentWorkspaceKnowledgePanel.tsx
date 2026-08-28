import React from 'react';
import { ScanSearch, Search } from 'lucide-react';
import type {
  AgentTab,
  Chapter,
  Character,
  ContinuationPack,
  Item,
  Location,
  MountedSkillLoadoutItem,
  Novel,
  ProjectPreferenceProfile,
  Skill,
  SkillUsageRecord,
} from '../../shared/types';
import { buildKnowledgeSearchEntries } from '../lib/agent-workspace-knowledge';
import { buildEffectiveCapabilitySummary, resolveCapabilityDisplayName } from '../lib/capability-stage-cards';
import { ProjectPreferencePanel } from './skills/ProjectPreferencePanel';
import { normalizeProjectPreferenceProfile } from '../../shared/lib/project-preference-profile';
import { SKILL_SERIES_FLOWS } from '../../shared/lib/public-skill-catalog';

type KnowledgeAgentTab = Extract<AgentTab, 'bible' | 'skills'>;

interface AgentWorkspaceKnowledgePanelProps {
  agentTab: KnowledgeAgentTab;
  novel: Novel;
  currentChapter: Chapter | null;
  bibleSearch: string;
  setBibleSearch: (search: string) => void;
  characters: Character[];
  locations: Location[];
  items: Item[];
  continuationPacks: ContinuationPack[];
  selectedContinuationPackId: string;
  librarySkills: Skill[];
  skillUsageRecords: SkillUsageRecord[];
  mountedSkillLoadout: MountedSkillLoadoutItem[];
  onAssignSkill: (slot: number, skillId: string) => Promise<void>;
  onRemoveSkill: (slot: number) => Promise<void>;
  projectPreferenceProfile: ProjectPreferenceProfile;
  onPreferenceProfileChange: (profile: ProjectPreferenceProfile) => Promise<void>;
  onOpenTrace?: () => void;
  onOpenCapabilityCenter?: () => void;
  pendingSkillIds?: string[];
  onResolvePendingSkill?: (skillId: string, slot: number) => void;
}

export function AgentWorkspaceKnowledgePanel({
  agentTab,
  currentChapter,
  bibleSearch,
  setBibleSearch,
  characters,
  locations,
  items,
  continuationPacks,
  selectedContinuationPackId,
  librarySkills,
  projectPreferenceProfile,
  onOpenTrace,
  onOpenCapabilityCenter,
  pendingSkillIds,
}: AgentWorkspaceKnowledgePanelProps) {
  const normalizedProfile = normalizeProjectPreferenceProfile(projectPreferenceProfile);
  const capabilityProfile = normalizedProfile.capabilityProfile;
  const activeFlowId = capabilityProfile?.activeFlowId || normalizedProfile.activeSeriesId;
  const activeFlow = SKILL_SERIES_FLOWS.find((flow) => flow.id === activeFlowId);
  const activeFlowLabel = activeFlow?.name || (activeFlowId ? '未识别流程' : '未选择流程');
  const chapterCapabilityState = currentChapter?.workflowMeta?.capabilityState;
  const effectiveCapabilitySummary = buildEffectiveCapabilitySummary({
    projectPreferenceProfile: normalizedProfile,
    currentChapter,
    librarySkills,
  });
  const skillName = (id: string | undefined) => {
    return resolveCapabilityDisplayName(id, librarySkills);
  };
  const favoriteTechniqueNames = capabilityProfile?.favoriteTechniqueIds.length
    ? capabilityProfile.favoriteTechniqueIds.map((id) => skillName(id))
    : [];
  // Local state to keep track of user input instantly.
  const [localSearch, setLocalSearch] = React.useState(bibleSearch);
  const [prevBibleSearch, setPrevBibleSearch] = React.useState(bibleSearch);

  // Synchronize local search state during rendering when the parent `bibleSearch` prop changes.
  // This avoids cascading renders in useEffect and complies with React best practices.
  if (bibleSearch !== prevBibleSearch) {
    setLocalSearch(bibleSearch);
    setPrevBibleSearch(bibleSearch);
  }

  // Debounce updating the parent's `bibleSearch` state by 150ms.
  // This avoids triggering expensive search logic and parent re-renders on every keystroke.
  // CRITICAL OPTIMIZATION: Only notify parent of updates when localSearch differs from bibleSearch (prevents feedback loops).
  React.useEffect(() => {
    if (localSearch === bibleSearch) {
      return;
    }

    const handler = setTimeout(() => {
      setBibleSearch(localSearch);
    }, 150);

    return () => {
      clearTimeout(handler);
    };
  }, [localSearch, bibleSearch, setBibleSearch]);

  if (agentTab === 'bible') {
    const knowledgeEntries = buildKnowledgeSearchEntries({
      bibleSearch,
      characters,
      locations,
      items,
      continuationPacks,
      selectedContinuationPackId,
    });

    return (
      <div className="space-y-4">
        <div className="sticky top-0 bg-theme-sidebar/50 backdrop-blur z-10 pb-2">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted" size={14} />
              <input
                type="text"
                placeholder="检索资料包、角色、地点、道具..."
                aria-label="检索设定和资料包"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-theme-sidebar border border-theme-border rounded-xl text-sm placeholder:text-theme-muted/50 shadow-sm transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20"
              />
            </div>
            {onOpenTrace && (
              <button type="button" onClick={onOpenTrace} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-theme-border px-2 py-2 text-[10px] text-theme-muted hover:bg-theme-border/20">
                <ScanSearch size={12} /> 扫描本章实体
              </button>
            )}
          </div>
        </div>
        <div className="space-y-3 pb-8">
          {knowledgeEntries.map((entry) => (
            <div key={entry.id} className="bg-theme-sidebar p-4 rounded-xl border border-theme-border/40 shadow-sm transition-hover hover:border-theme-accent/50">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <div className="text-sm font-bold text-theme-text">{entry.title}</div>
                <div className="text-[10px] bg-theme-sidebar px-1.5 py-0.5 rounded text-theme-muted font-medium tracking-wide">
                  {entry.tag}
                </div>
                {entry.source === 'continuation-pack' ? (
                  <div className="text-[10px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded font-medium tracking-wide border border-violet-200/60">
                    资料包
                  </div>
                ) : null}
                <div className="text-[10px] text-theme-muted">{entry.sourceLabel}</div>
              </div>
              {entry.summary ? <div className="text-xs font-semibold text-theme-accent mb-2">{entry.summary}</div> : null}
              {entry.detail ? <div className="text-xs text-theme-muted/80 leading-relaxed whitespace-pre-wrap">{entry.detail}</div> : null}
            </div>
          ))}
          {knowledgeEntries.length === 0 ? (
            <div className="text-center text-xs text-theme-muted opacity-60 p-4 border border-dashed border-theme-border rounded-xl">
              暂无可检索设定。先补书库实体，或先导入一份资料包在这里查看沉淀结果。
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-4">
      <div className="shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-theme-text">本章写法与能力</h2>
          {onOpenCapabilityCenter ? (
            <button
              type="button"
              onClick={onOpenCapabilityCenter}
              className="shrink-0 rounded-lg border border-theme-border px-2.5 py-1.5 text-[11px] font-semibold text-theme-text hover:bg-theme-border/20"
            >
              进入作品能力中心
            </button>
          ) : null}
        </div>
        <ProjectPreferencePanel profile={normalizedProfile} />
        <section className="border-y border-theme-border/60 py-2" aria-label="本章能力来源摘要">
          <div className="text-[11px] font-semibold text-theme-text">{effectiveCapabilitySummary.summaryText}</div>
          {effectiveCapabilitySummary.names.length > 0 ? (
            <p className="mt-1 text-[11px] leading-5 text-theme-muted">
              {effectiveCapabilitySummary.names.join('、')}
              {effectiveCapabilitySummary.overflowCount > 0 ? ` 等 ${effectiveCapabilitySummary.overflowCount} 项` : ''}
            </p>
          ) : null}
        </section>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pb-6">
        <section className="border-y border-theme-border/60 py-3" aria-labelledby="chapter-capability-flow">
          <h3 id="chapter-capability-flow" className="text-[11px] font-semibold text-theme-muted">当前流程</h3>
          <p className="mt-1 text-sm text-theme-text">{activeFlowLabel}</p>
        </section>

        <section className="border-b border-theme-border/60 pb-3" aria-labelledby="chapter-capability-deck">
          <h3 id="chapter-capability-deck" className="text-[11px] font-semibold text-theme-muted">作品默认卡</h3>
          <p className="mt-1 text-[11px] leading-5 text-theme-muted">
            主卡决定后续正文的主导口吻与节奏；辅卡补充世界观、人物或钩子约束。
          </p>
          <dl className="mt-2 grid grid-cols-[5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
            <dt className="text-theme-muted">作品主卡</dt>
            <dd className="min-w-0 break-words text-theme-text">{skillName(capabilityProfile?.projectSkillDeck.mainCardId)}</dd>
            <dt className="text-theme-muted">辅助卡</dt>
            <dd className="min-w-0 break-words text-theme-text">
              {capabilityProfile?.projectSkillDeck.supportCardIds.length
                ? capabilityProfile.projectSkillDeck.supportCardIds.map((id) => skillName(id)).join('、')
                : '未设置'}
            </dd>
          </dl>
        </section>

        <section className="border-b border-theme-border/60 pb-3" aria-labelledby="chapter-capability-techniques">
          <h3 id="chapter-capability-techniques" className="text-[11px] font-semibold text-theme-muted">常用技法</h3>
          <p className="mt-1 text-xs leading-5 text-theme-text">
            {favoriteTechniqueNames.length ? favoriteTechniqueNames.join('、') : '未收藏常用技法'}
          </p>
          <p className="mt-1 text-[11px] text-theme-muted">
            常用技法会作为作品偏好参与后续正文生成；本章使用规则只影响当前章节。
          </p>
        </section>

        <section className="border-b border-theme-border/60 pb-3" aria-labelledby="chapter-capability-overlays">
          <h3 id="chapter-capability-overlays" className="text-[11px] font-semibold text-theme-muted">本章使用卡</h3>
          <p className="mt-1 text-xs leading-5 text-theme-text">
            {chapterCapabilityState?.overlayCardIds.length
              ? chapterCapabilityState.overlayCardIds.map((id) => skillName(id)).join('、')
              : '本章未使用能力卡'}
          </p>
          <p className="mt-1 text-[11px] text-theme-muted">
            本章使用规则 {chapterCapabilityState?.techniqueIds.length || 0} 项
          </p>
        </section>

        <section className="border-b border-theme-border/60 pb-3" aria-labelledby="chapter-capability-guardrails">
          <h3 id="chapter-capability-guardrails" className="text-[11px] font-semibold text-theme-muted">系统检查规则</h3>
          <p className="mt-1 text-xs leading-5 text-theme-text">
            {effectiveCapabilitySummary.guardrailIds.length
              ? effectiveCapabilitySummary.guardrailIds.map((id) => skillName(id)).join('、')
              : '未配置系统检查规则'}
          </p>
        </section>

        <section className="border-b border-theme-border/60 pb-3" aria-labelledby="chapter-capability-confirmation">
          <h3 id="chapter-capability-confirmation" className="text-[11px] font-semibold text-theme-muted">写法确认</h3>
          <p className="mt-1 text-xs text-theme-text">
            {normalizedProfile.writingStyleConfirmation ? '已有确认记录' : '首次 AI 正文生成前需确认'}
          </p>
        </section>

        {(pendingSkillIds?.length || 0) > 0 ? (
          <div role="status" className="border-b border-amber-300 pb-3 text-xs text-amber-700">
            有 {pendingSkillIds?.length} 项历史能力记录待整理，请前往作品能力中心确认。
          </div>
        ) : null}
      </div>
    </div>
  );
}
