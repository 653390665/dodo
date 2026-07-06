import React from 'react';
import { Search } from 'lucide-react';
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
import { SkillLoadoutBoard } from './skills/SkillLoadoutBoard';
import { ProjectPreferencePanel } from './skills/ProjectPreferencePanel';

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
}

export function AgentWorkspaceKnowledgePanel({
  agentTab,
  novel,
  currentChapter,
  bibleSearch,
  setBibleSearch,
  characters,
  locations,
  items,
  continuationPacks,
  selectedContinuationPackId,
  librarySkills,
  skillUsageRecords,
  mountedSkillLoadout,
  onAssignSkill,
  onRemoveSkill,
  projectPreferenceProfile,
  onPreferenceProfileChange,
}: AgentWorkspaceKnowledgePanelProps) {
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
          <div className="relative">
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
      <div className="shrink-0">
        <ProjectPreferencePanel profile={projectPreferenceProfile} />
      </div>
      <div className="flex-1 min-h-0">
        <SkillLoadoutBoard
          novel={{ ...novel, projectPreferenceProfile }}
          currentChapter={currentChapter}
          skills={librarySkills}
          usageRecords={skillUsageRecords}
          loadout={mountedSkillLoadout}
          onAssignSkill={onAssignSkill}
          onRemoveSkill={onRemoveSkill}
          onPreferenceProfileChange={onPreferenceProfileChange}
        />
      </div>
    </div>
  );
}
