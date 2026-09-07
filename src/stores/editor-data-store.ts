import { create } from 'zustand';
import type {
  Character,
  EntityRelationship,
  Faction,
  Item,
  Location,
  Skill,
  SkillUsageRecord,
} from '../../shared/types';

/**
 * 011 Phase 3：辅助设定/资料数据集的状态后端。
 *
 * useEditorData 负责加载（请求序号 + 代际一致性守卫），加载结果经
 * 各 setter 写入本 store；消费端（AgentWorkspace 子树、KnowledgePanel、
 * 状态条相关表面）直接订阅，不再经 EditorView 透传。
 */
export interface EditorDataState {
  characters: Character[];
  locations: Location[];
  items: Item[];
  factions: Faction[];
  librarySkills: Skill[];
  skillUsageRecords: SkillUsageRecord[];
  relationships: EntityRelationship[];
  setCharacters: (value: Character[]) => void;
  setLocations: (value: Location[]) => void;
  setItems: (value: Item[]) => void;
  setFactions: (value: Faction[]) => void;
  setLibrarySkills: (value: Skill[]) => void;
  setSkillUsageRecords: (value: SkillUsageRecord[]) => void;
  setRelationships: (value: EntityRelationship[]) => void;
}

export const useEditorDataStore = create<EditorDataState>((set) => ({
  characters: [],
  locations: [],
  items: [],
  factions: [],
  librarySkills: [],
  skillUsageRecords: [],
  relationships: [],
  setCharacters: (value) => set({ characters: value }),
  setLocations: (value) => set({ locations: value }),
  setItems: (value) => set({ items: value }),
  setFactions: (value) => set({ factions: value }),
  setLibrarySkills: (value) => set({ librarySkills: value }),
  setSkillUsageRecords: (value) => set({ skillUsageRecords: value }),
  setRelationships: (value) => set({ relationships: value }),
}));
