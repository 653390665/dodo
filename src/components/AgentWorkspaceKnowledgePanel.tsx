import React from 'react';import Search from 'lucide-react/dist/esm/icons/search.js';
import type {
  AgentTab,
  Chapter,
  Character,
  Item,
  Location,
  MountedSkillLoadoutItem,
  Novel,
  ProjectPreferenceProfile,
  Skill,
  SkillUsageRecord,
} from '../types';
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
  librarySkills,
  skillUsageRecords,
  mountedSkillLoadout,
  onAssignSkill,
  onRemoveSkill,
  projectPreferenceProfile,
  onPreferenceProfileChange,
}: AgentWorkspaceKnowledgePanelProps) {
  if (agentTab === 'bible') {
    return (
      <div className="space-y-4">
        <div className="sticky top-0 bg-white/50 backdrop-blur z-10 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted" size={14} />
            <input
              type="text"
              placeholder="检索角色、地点、道具..."
              value={bibleSearch}
              onChange={(e) => setBibleSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white border border-theme-border rounded-xl text-sm placeholder:text-theme-muted/50 shadow-sm transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20"
            />
          </div>
        </div>
        <div className="space-y-3 pb-8">
          {characters
            .filter((character) => character.name.includes(bibleSearch) || character.summary.includes(bibleSearch))
            .map((character) => (
              <div key={character.id} className="bg-white p-4 rounded-xl border border-theme-border/40 shadow-sm transition-hover hover:border-theme-accent/50">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="text-sm font-bold text-theme-text">{character.name}</div>
                  <div className="text-[10px] bg-theme-sidebar px-1.5 py-0.5 rounded text-theme-muted font-medium tracking-wide">
                    角色 - {character.role}
                  </div>
                </div>
                <div className="text-xs font-semibold text-theme-accent mb-2">{character.summary}</div>
                {character.bio ? <div className="text-xs text-theme-muted/80 leading-relaxed whitespace-pre-wrap">{character.bio}</div> : null}
              </div>
            ))}
          {locations
            .filter((location) => location.name.includes(bibleSearch) || location.description.includes(bibleSearch))
            .map((location) => (
              <div key={location.id} className="bg-white p-4 rounded-xl border border-theme-border/40 shadow-sm transition-hover hover:border-theme-accent/50">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="text-sm font-bold text-theme-text">{location.name}</div>
                  <div className="text-[10px] bg-theme-sidebar px-1.5 py-0.5 rounded text-theme-muted font-medium tracking-wide">地点</div>
                </div>
                <div className="text-xs font-semibold text-theme-accent mb-2">{location.region}</div>
                {location.description ? (
                  <div className="text-xs text-theme-muted/80 leading-relaxed whitespace-pre-wrap">{location.description}</div>
                ) : null}
              </div>
            ))}
          {items
            .filter((item) => item.name.includes(bibleSearch) || item.description.includes(bibleSearch))
            .map((item) => (
              <div key={item.id} className="bg-white p-4 rounded-xl border border-theme-border/40 shadow-sm transition-hover hover:border-theme-accent/50">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="text-sm font-bold text-theme-text">{item.name}</div>
                  <div className="text-[10px] bg-theme-sidebar px-1.5 py-0.5 rounded text-theme-muted font-medium tracking-wide">道具</div>
                </div>
                <div className="text-xs font-semibold text-theme-accent mb-2">{item.type}</div>
                {item.description ? <div className="text-xs text-theme-muted/80 leading-relaxed whitespace-pre-wrap">{item.description}</div> : null}
              </div>
            ))}
          {characters.length === 0 && locations.length === 0 && items.length === 0 ? (
            <div className="text-center text-xs text-theme-muted opacity-60 p-4 border border-dashed border-theme-border rounded-xl">
              暂无设定数据，请前往书库添加
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
