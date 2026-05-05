import { GoogleGenAI } from "@google/genai";
import { Character, Novel, Location, Item, Faction, PowerLevel, TimelineEvent, Skill } from "../types";
import { PLANNER_SOUL, WRITER_SOUL, CRITIC_SOUL } from "../config/souls";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

  const filterEntities = (entities: any[] | undefined) => {
    if (!entities) return [];
    if (!context.activeEntityNames) return entities;
    return entities.filter(e => context.activeEntityNames!.includes(e.name));
  };

  const activeChars = pruneCharacters(context.characters);
  const activeLocations = filterEntities(context.locations);
  const activeItems = filterEntities(context.items);
  const activeFactions = filterEntities(context.factions);

  const charContext = activeChars.map(c => `${c.name} (${c.role || '未定'}): ${c.summary} - ${(c.traits || []).join(',')}`).join('\n') || '无特写角色';
  const locationContext = activeLocations.map(l => `${l.name} (${l.region}): ${l.description}`).join('\n') || '未指定场景';
  const itemContext = activeItems.map(i => `${i.name} [${i.type}]: ${i.description}`).join('\n') || '无特殊道具';
  const factionContext = activeFactions.map(f => `${f.name} [首领:${f.leader}]: 占据 ${f.territory}。 ${f.description}`).join('\n') || '无特写势力';
  
  let powerLevelContext = '';
  if (context.powerLevels && context.powerLevels.length > 0) {
    powerLevelContext = `\n【境界与力量体系】\n` + 
      context.powerLevels.map(p => `- 第${p.tier}阶 [${p.name}]: ${p.characteristics}。${p.description}`).join('\n') + `\n`;
  }

  let timelineContext = '';
  if (context.timelineEvents && context.timelineEvents.length > 0) {
    timelineContext = `\n【重大历史时间线 (Timeline)】\n` + 
      context.timelineEvents.map(t => `- [${t.timestamp}] ${t.title}: ${t.description}`).join('\n') + `\n`;
  }

  let recentContext = '';
  if (context.previousChaptersSummary) {
    recentContext = `\n【前情提要及剧情内存 (RAG Context)】\n${context.previousChaptersSummary}\n`;
  }

  let skillsContext = '';
  if (context.mountedSkills && context.mountedSkills.length > 0) {
    skillsContext = `\n【当前挂载的技能插件 (Mounted Skills)】\n` + 
      context.mountedSkills.map(s => `- [${s.name}] (稳定性: ${s.stabilityScore}%) ${s.description}\n  文风设定: ${s.style}\n  节奏逻辑: ${s.pacing}\n  红线禁忌: ${(s.bannedWords || []).join('、')}\n  句式特征: ${s.sentenceStructure || ''}`).join('\n') + `\n`;
  }

  return `
【故事核心】
${context.novel.summary || '暂无'}

【世界观法则】
${context.novel.worldRules || '暂无'}

【全局大纲】
${context.novel.globalOutline || '暂无'}
${powerLevelContext}
${timelineContext}${recentContext}${skillsContext}
【登场人物记忆库 (Entity Scope)】
${charContext}

【网状势力网 (Entity Scope)】
${factionContext}

【关键地点/副本记忆库 (Entity Scope)】
${locationContext}

【关键道具记忆库 (Entity Scope)】
${itemContext}
`;
}

/**
 * 规划层 (Planning Layer): Editor Agent
 * 负责将用户的模糊意图转化为结构化的场景大纲 (Scene Beats)
 */
export async function extractWorldSetupPhase(documentText: string): Promise<any> {
  const prompt = `
你是一个世界观与设定提取分析师。
请阅读下面用户上传的小说设定文档/大纲，并提取出标准化的结构数据。
必须输出为合法的 JSON 格式，不要包含任何 json 代码块标记（如 \`\`\`json ），直接输出纯 JSON 字符串。

期望的 JSON 结构如下：
{
  "globalOutline": "提取的整体故事大纲（如果没有，则根据已有线索总结，如果完全没有则为空字符串）",
  "worldRules": "提取的世界观法则、力量体系等（如果没有则为空字符串）",
  "characters": [
    {
      "name": "角色名",
      "role": "protagonist" | "antagonist" | "supporting" | "extra",
      "summary": "一句话简介",
      "bio": "详细背景设定、性格",
      "traits": ["词条1", "词条2"]
    }
  ],
  "locations": [
    {
      "name": "地点名",
      "region": "所属势力/区域",
      "description": "详细描述"
    }
  ],
  "items": [
    {
      "name": "道具/物品名",
      "type": "类型(如法宝、科技造物等)",
      "description": "功能与外貌描述"
    }
  ],
  "timelineEvents": [
    {
      "title": "事件名称",
      "timestamp": "发生时间",
      "description": "事件详情",
      "statusTag": "已发生",
      "order": 1
    }
  ]
}

【设定文档内容】：
${documentText}
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
    });
    
    let text = response.text || "{}";
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(text);
  } catch (error) {
    console.error("Extract World Setup Error:", error);
    throw error;
  }
}

export async function editorAgentPhase(userIntent: string, context: AgentContext): Promise<string> {
  const contextStr = buildContextPrompt(context);
  
  const prompt = `
${PLANNER_SOUL}

【当前任务】
请利用以下小说的信息记忆库，根据用户的创作意图，拆解出这一章的场景分镜（Scene Beats）。
包含3-5个场景，每个场景说明出场人物、核心冲突、道具运用和情绪转折。务必严格遵循全局大纲、人物设定和世界观，绝不偏离主线轨迹。

${contextStr}

【用户本章创作意图】
${userIntent}
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview", // 规划和逻辑使用 Pro 模型
      contents: prompt,
    });
    return response.text || '';
  } catch (error) {
    console.error("Editor Agent Error:", error);
    throw error;
  }
}

/**
 * 执行层 (Execution Layer): Writer Agent
 * 根据 Editor生成的大纲，执笔写出富有文采的正文正文
 */
export async function writerAgentPhase(sceneBeats: string, context: AgentContext): Promise<string> {
  const contextStr = buildContextPrompt(context);
  const prompt = `
${WRITER_SOUL}

【当前任务】
请根据以下场景分镜（Scene Beats），扩写成完整的章节正文。
要求：文笔流畅，注重动作、神态描写和环境渲染，符合小说角色的性格设定（OOC绝对禁止）。利用记忆库中的地点和道具细节增加真实感。

${contextStr}

【本章场景大纲/分镜】
${sceneBeats}

请直接输出正文，不要包含多余的分析和寒暄。
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", // 文本生成使用 Flash 保障速度和丰富度
      contents: prompt,
    });
    return response.text || '';
  } catch (error) {
    console.error("Writer Agent Error:", error);
    throw error;
  }
}

/**
 * 质量层 (Quality Layer): Critic / Reader Agent
 * 毒舌批评家，审查文本逻辑和人设
 */
export async function criticAgentPhase(draftContent: string, sceneBeats: string, context: AgentContext): Promise<string> {
  const contextStr = buildContextPrompt(context);
  const prompt = `
${CRITIC_SOUL}

【当前任务】
你是一名极其严格的文字主编（AI 审计）。请对照小说的全局设定（World Bible）和挂载的 Skill（文风、句式、红线等），对当前章节的正文和分镜进行严苛的毒舌审查。
你的输出必须包含以下三部分（请使用 Markdown 格式）：
1. 评分 (Score)：给出 0-100 的评分，并附带评语。
2. 具体问题点 (Vulnerabilities)：扫描文中的病毒点，如逻辑漏洞、人物 OOC、节奏拖沓、文风偏离等。
3. 修改建议 (Suggestions)：提供手术级的修改方案，指出需要大改或者精修的地方。

${contextStr}

【本章场景大纲/分镜】
${sceneBeats || '未提供'}

【草稿正文】
${draftContent || '未提供'}
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview", 
      contents: prompt,
    });
    return response.text || '';
  } catch (error) {
    console.error("Critic Agent Error:", error);
    throw error;
  }
}