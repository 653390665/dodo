export interface SyncExtractionResult {
  characters: Array<{ name: string; role: string; summary: string; bio: string; traits: string[] }>;
  locations: Array<{ name: string; region: string; description: string }>;
  items: Array<{ name: string; type: string; description: string }>;
  factions: Array<{ name: string; leader: string; territory: string; description: string }>;
  powerLevels: Array<{ name: string; tier: number; characteristics: string; description: string }>;
  timelineEvents: Array<{ title: string; timestamp: string; description: string; order: number }>;
  relationships: Array<{ sourceName: string; sourceType: string; targetName: string; targetType: string; relationshipType: string; description: string }>;
  globalOutline: string;
  worldRules: string;
}

export function buildSyncExtractionPrompt(sourceTexts: string[]): string {
  return `你是一个世界观实体提取专家。从以下续写资料文本中，提取所有世界观相关的实体和关系。

## 提取规则

1. **人物**：名字、角色类型(protagonist/antagonist/supporting/extra)、一句话简介、详细背景、性格标签
2. **地点**：名字、区域、描述
3. **道具**：名字、类型(weapon/artifact/consumable/tool/other)、描述
4. **势力**：名字、首领、领地、描述
5. **力量体系**：名字、等级(tier数字)、特征、描述
6. **时间线事件**：标题、时间戳、描述、顺序
7. **关系**：源实体名、源类型(character/location/item/faction)、目标实体名、目标类型、关系类型、描述
8. **世界大纲**：从文本中归纳的世界观概述（如有）
9. **世界规则**：从文本中提取的设定规则（如有）

## 关系规则
- 关系中的实体名必须在上述实体列表中出现
- 禁止自关联
- 关系类型用中文描述（如"敌对"、"盟友"、"师徒"、"恋人"等）

## 输出格式
严格输出 JSON，不要包含任何其他文本。JSON 结构：
{
  "characters": [...],
  "locations": [...],
  "items": [...],
  "factions": [...],
  "powerLevels": [...],
  "timelineEvents": [...],
  "relationships": [...],
  "globalOutline": "",
  "worldRules": ""
}

## 资料文本
${sourceTexts.join('\n\n---\n\n')}`;
}
