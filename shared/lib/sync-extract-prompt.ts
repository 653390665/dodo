export interface SyncExtractionResult {
  characters: Array<{ name: string; role: string; summary: string; bio: string; traits: string[]; sourceDocumentIds?: string[] }>;
  locations: Array<{ name: string; region: string; description: string }>;
  items: Array<{ name: string; type: string; description: string }>;
  factions: Array<{ name: string; leader: string; territory: string; description: string }>;
  powerLevels: Array<{ name: string; tier: number; characteristics: string; description: string }>;
  timelineEvents: Array<{ title: string; timestamp: string; description: string; order: number }>;
  relationships: Array<{ sourceName: string; sourceType: string; targetName: string; targetType: string; relationshipType: string; description: string }>;
  globalOutline: string;
  worldRules: string;
}

export interface SyncExtractionPromptOptions {
  repairIssues?: Array<{ path: string; code: string; message: string }>;
  repairKind?: 'json_syntax' | 'schema';
  compact?: boolean;
}

export function buildSyncExtractionPrompt(sourceTexts: string[], options: SyncExtractionPromptOptions = {}): string {
  const repairInstruction = options.repairIssues?.length
    ? `\n## 上一次输出的格式问题\n只修复以下字段格式，不新增资料中没有的事实；仍然输出完整顶层结构：\n${options.repairIssues.map(issue => `- ${issue.path || '(根)'}：${issue.code}，${issue.message}`).join('\n')}`
    : '';
  const jsonSyntaxRepairInstruction = options.repairKind === 'json_syntax'
    ? '\n## JSON 语法修复要求\n上一次输出无法解析。本次只修复 JSON 语法，不新增资料中没有的事实。必须输出单一 JSON 根对象和完整顶层结构；所有键和值使用双引号（数字字段除外）。不得输出 Markdown、注释或尾逗号，不得输出多个 JSON，不得自动截断或省略数组。'
    : '';
  const compactRetryInstruction = options.compact
    ? '\n## 压缩重试模式\n这是一次输出长度压缩重试。保留所有顶层键和资料中可核实的实体，不任意裁剪实体数量；仅删除字段冗余，将 summary、bio、description、characteristics、relationship description 等改为最短事实短语。不要把推断写成证据，不要省略数组或用省略号代替内容。'
    : '';
  return `你是一个世界观实体提取专家。从以下续写资料文本中，提取所有世界观相关的实体和关系。

## 提取规则

1. **人物**：名字、角色类型(protagonist/antagonist/supporting/extra)、一句话简介、详细背景、性格标签，以及事实所在资料块标注的 sourceDocumentId
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
  "characters": [{"name":"林默","role":"protagonist","summary":"一句话简介","bio":"背景","traits":["冷静"],"sourceDocumentIds":["doc-1"]}],
  "locations": [{"name":"临河城","region":"北境","description":"地点描述"}],
  "items": [{"name":"青锋剑","type":"weapon","description":"道具描述"}],
  "factions": [{"name":"玄霜盟","leader":"沈闻","territory":"北境","description":"势力描述"}],
  "powerLevels": [{"name":"筑基","tier":1,"characteristics":"力量特征","description":"体系描述"}],
  "timelineEvents": [{"title":"城门之战","timestamp":"第三年春","description":"事件描述","order":1}],
  "relationships": [{"sourceName":"林默","sourceType":"character","targetName":"玄霜盟","targetType":"faction","relationshipType":"敌对","description":"关系描述"}],
  "globalOutline": "",
  "worldRules": ""
}
所有顶层数组都必须存在；没有内容使用 []，可选文本使用空字符串。tier/order 必须是整数；tier 范围是 0–100；traits/sourceDocumentIds 必须是字符串数组；sourceDocumentIds 只能复制人物事实实际来源资料块中的 [sourceDocumentId:...]，不得编造；sourceType/targetType 只能是 character、location、item、faction；每个对象必须有名称（事件使用 title）。所有实体与关系数组合计不得超过 180 条。
\n## 输出精简与完整性
- 每个字段只写资料中可核实的最短信息；summary、description、bio、characteristics 等文本保持简短，避免背景复述、分析过程和重复解释。
- 不要把同一事实重复写入多个字段；不要输出证据说明、免责声明、推理过程或 Markdown。
- 即使资料很多，也必须输出完整且可解析的单一 JSON 根对象，包含上方列出的全部顶层键；不得在中途截断、用省略号代替内容或省略数组。
${repairInstruction}${jsonSyntaxRepairInstruction}${compactRetryInstruction}

## 资料文本
${sourceTexts.join('\n\n---\n\n')}`;
}
