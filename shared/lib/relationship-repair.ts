export type RelationshipEntityType = 'character' | 'location' | 'item' | 'faction';

export interface RelationshipRepairInput {
  index: number;
  sourceName: string;
  sourceType: RelationshipEntityType;
  targetName: string;
  targetType: RelationshipEntityType;
  relationshipType: string;
  description: string;
}

export interface RelationshipRepairDocument { filename: string; text: string; }
export interface RelationshipEvidence { evidenceId: string; filename: string; quote: string; }
export interface RelationshipRecommendation {
  index: number;
  action: 'map' | 'skip';
  sourceName?: string;
  targetName?: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  evidence: Array<{ filename: string; quote: string }>;
}

const ENTITY_TYPES: readonly RelationshipEntityType[] = ['character', 'location', 'item', 'faction'];

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function cleanQuote(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function extractRelationshipEvidence(
  relationship: RelationshipRepairInput,
  documents: RelationshipRepairDocument[],
): RelationshipEvidence[] {
  const names = [relationship.sourceName, relationship.targetName].filter(Boolean);
  const evidenceByName = names.map(() => [] as RelationshipEvidence[]);
  for (const document of documents) {
    const text = typeof document.text === 'string' ? document.text : '';
    names.forEach((name, nameIndex) => {
      let cursor = 0;
      while (evidenceByName[nameIndex].length < 4) {
        const matchIndex = text.indexOf(name, cursor);
        if (matchIndex < 0) break;
        const start = Math.max(0, matchIndex - 100);
        const quote = cleanQuote(text.slice(start, Math.min(text.length, matchIndex + 180)));
        if (quote) {
          const evidenceId = `rel-evidence-${stableHash(`${document.filename}\n${quote}`)}`;
          if (!evidenceByName[nameIndex].some(item => item.evidenceId === evidenceId)) {
            evidenceByName[nameIndex].push({ evidenceId, filename: document.filename, quote });
          }
        }
        cursor = matchIndex + Math.max(name.length, 1);
      }
    });
  }
  const evidence: RelationshipEvidence[] = [];
  const seen = new Set<string>();
  for (let offset = 0; evidence.length < 4; offset += 1) {
    let added = false;
    for (const candidates of evidenceByName) {
      const item = candidates[offset];
      if (!item || seen.has(item.evidenceId)) continue;
      seen.add(item.evidenceId);
      evidence.push(item);
      added = true;
      if (evidence.length >= 4) break;
    }
    if (!added) break;
  }
  return evidence;
}

export function buildRelationshipRepairPrompt(
  relationships: RelationshipRepairInput[],
  candidates: Record<RelationshipEntityType, string[]>,
  evidenceByIndex: Record<number, RelationshipEvidence[]>,
): string {
  const evidence = relationships.map(relationship => ({
    index: relationship.index,
    source: relationship.sourceName,
    target: relationship.targetName,
    sourceType: relationship.sourceType,
    targetType: relationship.targetType,
    relationshipType: relationship.relationshipType,
    description: relationship.description,
    evidence: (evidenceByIndex[relationship.index] || []).map(item => ({ evidenceId: item.evidenceId, filename: item.filename, quote: item.quote })),
  }));
  return `你是小说资料关系修复助手。只能从给定候选中精确选择实体，不能新增事实或改写名称。无证据、证据不足或存在歧义时必须 skip。不得自关联。请严格输出 JSON 数组，每项字段为 index、action(map|skip)、sourceName、targetName、confidence(high|medium|low)、reason、evidenceIds(string[])。map 必须引用提供的 evidenceIds。\n候选实体：${JSON.stringify(candidates)}\n待处理关系与原文证据：${JSON.stringify(evidence)}`;
}

export function normalizeRelationshipRecommendations(
  relationships: RelationshipRepairInput[],
  candidates: Record<RelationshipEntityType, string[]>,
  evidenceByIndex: Record<number, RelationshipEvidence[]>,
  modelOutput: unknown,
): RelationshipRecommendation[] {
  const modelItems = Array.isArray(modelOutput)
    ? modelOutput
    : (modelOutput && typeof modelOutput === 'object' && Array.isArray((modelOutput as { recommendations?: unknown }).recommendations)
      ? (modelOutput as { recommendations: unknown[] }).recommendations : []);
  const byIndex = new Map<number, Record<string, unknown>>();
  for (const value of modelItems) {
    if (value && typeof value === 'object' && Number.isInteger((value as { index?: unknown }).index)) {
      byIndex.set((value as { index: number }).index, value as Record<string, unknown>);
    }
  }
  return relationships.map(relationship => {
    const model = byIndex.get(relationship.index);
    const evidence = evidenceByIndex[relationship.index] || [];
    const skip = (reason = '资料证据不足'): RelationshipRecommendation => ({ index: relationship.index, action: 'skip', confidence: 'low', reason, evidence: [] });
    if (!model) return skip();
    if (model.action === 'skip') {
      const suppliedIds = Array.isArray(model.evidenceIds) ? model.evidenceIds.filter((id): id is string => typeof id === 'string') : [];
      const validEvidence = evidence.filter(item => suppliedIds.includes(item.evidenceId));
      if (!validEvidence.length) return skip(typeof model.reason === 'string' && model.reason.trim() ? model.reason.trim() : undefined);
      const confidence = model.confidence === 'high' || model.confidence === 'medium' || model.confidence === 'low' ? model.confidence : 'low';
      return {
        index: relationship.index,
        action: 'skip',
        confidence,
        reason: typeof model.reason === 'string' && model.reason.trim() ? model.reason.trim() : '基于资料证据建议跳过',
        evidence: validEvidence.map(item => ({ filename: item.filename, quote: item.quote })),
      };
    }
    if (model.action !== 'map') return skip();
    const sourceName = typeof model.sourceName === 'string' ? model.sourceName : '';
    const targetName = typeof model.targetName === 'string' ? model.targetName : '';
    const sourceAllowed = (candidates[relationship.sourceType] || []).includes(sourceName);
    const targetAllowed = (candidates[relationship.targetType] || []).includes(targetName);
    if (!sourceAllowed || !targetAllowed || !sourceName || !targetName || sourceName === targetName) return skip('候选实体无效，已跳过');
    const suppliedIds = Array.isArray(model.evidenceIds) ? model.evidenceIds.filter((id): id is string => typeof id === 'string') : [];
    const validEvidence = evidence.filter(item => suppliedIds.includes(item.evidenceId));
    if (!validEvidence.length) return skip('缺少有效原文证据，已跳过');
    const confidence = model.confidence === 'high' || model.confidence === 'medium' || model.confidence === 'low' ? model.confidence : 'low';
    const hadInvalidEvidence = suppliedIds.length !== validEvidence.length;
    return {
      index: relationship.index,
      action: 'map',
      sourceName,
      targetName,
      confidence: hadInvalidEvidence ? 'low' : confidence,
      reason: typeof model.reason === 'string' && model.reason.trim() ? model.reason.trim() : '基于资料证据的关系映射',
      evidence: validEvidence.map(item => ({ filename: item.filename, quote: item.quote })),
    };
  });
}

export function isRelationshipEntityType(value: string): value is RelationshipEntityType {
  return ENTITY_TYPES.includes(value as RelationshipEntityType);
}
