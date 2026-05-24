import { Character, Novel, Location, Item, Faction, PowerLevel, TimelineEvent, Skill } from "../types";
import { getSkillRoleLabel, getSkillRoleTags } from './skill-language';
import type { PromptSurface } from './prompt-stage-routing';

export type SceneType = 'dialogue' | 'action' | 'politics' | 'emotional';

export interface AgentContext {
  novel: Novel;
  characters: Character[];
  locations?: Location[];
  items?: Item[];
  factions?: Faction[];
  powerLevels?: PowerLevel[];
  timelineEvents?: TimelineEvent[];
  previousChaptersSummary?: string;
  activeEntityNames?: string[]; // Used for context pruning
  mountedSkills?: Skill[];
  sceneType?: SceneType;
}

type NamedEntity = Pick<Character | Location | Item | Faction, 'name'>;

export interface ExtractedWorldSetup {
  globalOutline?: string;
  worldRules?: string;
  characters?: Array<Partial<Character>>;
  locations?: Array<Partial<Location>>;
  items?: Array<Partial<Item>>;
  factions?: Array<Partial<Faction>>;
  powerLevels?: Array<Partial<PowerLevel>>;
  timelineEvents?: Array<Partial<TimelineEvent>>;
}

const MAX_WORLD_RULES_CHARS = 1200;
const MAX_GLOBAL_OUTLINE_CHARS = 1800;
const MAX_PREVIOUS_CHAPTERS_CHARS = 2200;
const MAX_SKILLS = 3;
const MAX_CHARACTERS = 8;
const MAX_GENERIC_ENTITIES = 6;
const MAX_TIMELINE_EVENTS = 10;
const MAX_POWER_LEVELS = 10;

function truncateText(text: string | undefined, maxChars: number) {
  if (!text) return '暂无';
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n……（已截断）` : text;
}

export function buildContextPrompt(context: AgentContext): string {
  // Prune entities to maximize context efficiency
  const pruneCharacters = (chars: Character[] | undefined) => {
    if (!chars) return [];
    // Always keep protagonists for global context
    const protagonists = chars.filter(c => c.role === 'protagonist');

    // If not sniffed, return all to be safe, but ideally in a real app would paginate or limit
    if (!context.activeEntityNames) return chars;

    // Filter active characters, excluding protagonists (already added)
    const activeChars = chars.filter(c =>
      context.activeEntityNames!.includes(c.name) && c.role !== 'protagonist'
    );

    return [...protagonists, ...activeChars];
  };

  const filterEntities = <T extends NamedEntity>(entities: T[] | undefined) => {
    if (!entities) return [];
    if (!context.activeEntityNames) return entities;
    return entities.filter(e => context.activeEntityNames!.includes(e.name));
  };

  const activeChars = pruneCharacters(context.characters).slice(0, MAX_CHARACTERS);
  const activeLocations = filterEntities(context.locations).slice(0, MAX_GENERIC_ENTITIES);
  const activeItems = filterEntities(context.items).slice(0, MAX_GENERIC_ENTITIES);
  const activeFactions = filterEntities(context.factions).slice(0, MAX_GENERIC_ENTITIES);

  const charContext = activeChars.map(c => `${c.name} (${c.role || '未定'}): ${c.summary} - ${(c.traits || []).join(',')}`).join('\n') || '无特写角色';
  const locationContext = activeLocations.map(l => `${l.name} (${l.region}): ${l.description}`).join('\n') || '未指定场景';
  const itemContext = activeItems.map(i => `${i.name} [${i.type}]: ${i.description}`).join('\n') || '无特殊道具';
  const factionContext = activeFactions.map(f => `${f.name} [首领:${f.leader}]: 占据 ${f.territory}。 ${f.description}`).join('\n') || '无特写势力';

  let powerLevelContext = '';
  if (context.powerLevels && context.powerLevels.length > 0) {
    powerLevelContext = `\n【境界与力量体系】\n` +
      context.powerLevels.slice(0, MAX_POWER_LEVELS).map(p => `- 第${p.tier}阶 [${p.name}]: ${p.characteristics}。${p.description}`).join('\n') + `\n`;
  }

  let timelineContext = '';
  if (context.timelineEvents && context.timelineEvents.length > 0) {
    timelineContext = `\n【重大历史时间线 (Timeline)】\n` +
      context.timelineEvents.slice(0, MAX_TIMELINE_EVENTS).map(t => `- [${t.timestamp}] ${t.title}: ${t.description}`).join('\n') + `\n`;
  }

  let recentContext = '';
  if (context.previousChaptersSummary) {
    recentContext = `\n【前情提要及剧情内存 (RAG Context)】\n${truncateText(context.previousChaptersSummary, MAX_PREVIOUS_CHAPTERS_CHARS)}\n`;
  }

  let skillsContext = '';
  if (context.mountedSkills && context.mountedSkills.length > 0) {
    skillsContext = `\n【当前挂载的技能插件 (Mounted Skills)】\n` +
      context.mountedSkills.slice(0, MAX_SKILLS).map(s => {
        const profile = s.compositionProfile;
        return `- [${s.name}] (稳定性: ${s.stabilityScore}%) ${s.description}
  写作职责: ${getSkillRoleLabel(s.primaryDimension)}
  职责标签: ${getSkillRoleTags(s.dimensionTags).join('、') || '未标注'}
  文风设定: ${s.style}
  节奏逻辑: ${s.pacing}
  人物构建: ${s.characterTraits || '未指定'}
  世界/力量: ${s.worldBuilding || '未指定'}
  红线禁忌: ${(s.bannedWords || []).join('、')}
  句式特征: ${s.sentenceStructure || ''}
  组合策略画像: 主笔文风=${profile?.styleWeight ?? 0.5}, 人物驱动=${profile?.characterWeight ?? 0.5}, 世界约束=${profile?.worldWeight ?? 0.5}, 体系爆点=${profile?.powerWeight ?? 0.5}, 剧情推进=${profile?.plotWeight ?? 0.5}, 节奏调速=${profile?.pacingWeight ?? 0.5}`;
      }).join('\n') + `\n`;
  }

  // Dynamic entity ordering based on scene type
  const entityOrderByScene: Record<SceneType, string[]> = {
    action:      ['locations', 'items', 'characters', 'factions'],
    dialogue:    ['characters', 'locations', 'items', 'factions'],
    politics:    ['factions', 'characters', 'locations', 'items'],
    emotional:   ['characters', 'locations', 'items', 'factions'],
  };

  const sections: Record<string, string> = {
    characters: `【登场人物记忆库 (Entity Scope)】\n${charContext}`,
    locations: `【关键地点/副本记忆库 (Entity Scope)】\n${locationContext}`,
    items: `【关键道具记忆库 (Entity Scope)】\n${itemContext}`,
    factions: `【网状势力网 (Entity Scope)】\n${factionContext}`,
  };

  return `
【故事核心】
${truncateText(context.novel.summary, 600)}

【世界观法则】
${truncateText(context.novel.worldRules, MAX_WORLD_RULES_CHARS)}

【全局大纲】
${truncateText(context.novel.globalOutline, MAX_GLOBAL_OUTLINE_CHARS)}
${powerLevelContext}
${timelineContext}${recentContext}${skillsContext}
${(() => {
  const sceneType = context.sceneType;
  const order = sceneType ? entityOrderByScene[sceneType] : ['characters', 'locations', 'items', 'factions'];
  return order.map(key => sections[key] || '').filter(Boolean).join('\n\n');
})()}
`;
}

/**
 * 规划层 (Planning Layer): Editor Agent
 * 负责将用户的模糊意图转化为结构化的场景大纲 (Scene Beats)
 */
export async function extractWorldSetupPhase(documentText: string): Promise<ExtractedWorldSetup> {
  try {
    const response = await fetch('/api/extract-world-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentText })
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error || 'Failed to extract world setup');
    }
    return data as ExtractedWorldSetup;
  } catch (error) {
    console.error("Extract World Setup Error:", error);
    throw error;
  }
}

export async function editorAgentPhase(userIntent: string, context: AgentContext): Promise<string> {
  const contextStr = buildContextPrompt(context);

  try {
    const response = await fetch('/api/editor-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIntent, contextStr, surface: 'workspace-beats' satisfies PromptSurface })
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error || 'Failed to generate scene beats');
    }
    return data.text || '';
  } catch (error) {
    console.error("Editor Agent Error:", error);
    throw error;
  }
}
