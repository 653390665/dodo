import type { Chapter, ExecutionSnapshot, ProductionExecutionReceipt, StoryStateLedger } from '../types';

export function getNextChapterOrder(chapters: Pick<Chapter, 'order'>[]): number {
  if (!chapters.length) return 1;
  const maxValidOrder = Math.max(
    0,
    ...chapters.map((chapter) => Number.isFinite(chapter.order) ? chapter.order : 0),
  );
  return Math.max(maxValidOrder + 1, chapters.length + 1);
}

export function buildChapterProductionTitle(order: number): string {
  return `第 ${order} 章`;
}

export function normalizeProductionIntent(intent: string): string {
  const normalized = intent.trim();
  // Empty intent is valid; the planner owns the fallback instead of receiving
  // an instruction-shaped placeholder as prose material.
  if (!normalized || normalized === '延续上一章剧情，生成下一章分镜、正文和连续性审计。') return '';
  return normalized;
}

export function buildProductionExecutionReceipt(
  snapshot: Pick<ExecutionSnapshot, 'capabilityRefs' | 'writingStyleFingerprint' | 'resolvedAtGeneration'>,
  ledger: StoryStateLedger,
): ProductionExecutionReceipt {
  const contextDimensions: ProductionExecutionReceipt['contextDimensions'] = [];
  const contextRefs: ProductionExecutionReceipt['contextRefs'] = [];
  if (ledger.worldRules.trim() || ledger.globalOutline.trim()) contextDimensions.push('world');
  if (ledger.worldRules.trim() || ledger.globalOutline.trim()) contextRefs.push({ dimension: 'world', id: ledger.novelId, version: snapshot.resolvedAtGeneration ?? 0 });
  const entityGroups = [
    ['character', ledger.entityStates.characters],
    ['item', ledger.entityStates.items],
  ] as const;
  for (const [dimension, entries] of entityGroups) {
    for (const entry of entries) contextRefs.push({ dimension, id: entry.id, version: entry.updatedAt ?? 0 });
  }
  if (ledger.entityStates.characters.length > 0) contextDimensions.push('character');
  if (ledger.openForeshadowings.length > 0) contextDimensions.push('foreshadowing');
  for (const entry of ledger.openForeshadowings) contextRefs.push({ dimension: 'foreshadowing', id: entry.id, version: entry.updatedAt ?? 0 });
  return {
    version: 1,
    capabilityRefs: [...new Set(snapshot.capabilityRefs || [])],
    writingStyleFingerprint: snapshot.writingStyleFingerprint,
    ...(snapshot.resolvedAtGeneration === undefined ? {} : { resolvedAtGeneration: snapshot.resolvedAtGeneration }),
    contextDimensions,
    contextRefs,
  };
}

const DEFAULT_PRODUCTION_CONTEXT_CHAR_LIMIT = 24_000;

function composeUniqueContext(parts: string[], maxChars: number): string {
  const seen = new Set<string>();
  const unique = parts
    .map((part) => part.trim())
    .filter((part) => {
      if (!part || seen.has(part)) return false;
      seen.add(part);
      return true;
    });
  return unique.join('\n\n').slice(0, Math.max(1, maxChars));
}

export function buildProductionPromptContexts(args: {
  layeredContext: string;
  plannerContext: string;
  writerContext: string;
  criticContext?: string;
  continuationPackContext?: string;
}, maxChars = DEFAULT_PRODUCTION_CONTEXT_CHAR_LIMIT): { planner: string; writer: string; critic: string } {
  const { layeredContext, plannerContext, writerContext, criticContext, continuationPackContext } = args;
  return {
    planner: composeUniqueContext([layeredContext, continuationPackContext || '', plannerContext], maxChars),
    writer: composeUniqueContext([writerContext, continuationPackContext || ''], maxChars),
    critic: composeUniqueContext([criticContext || writerContext, continuationPackContext || ''], maxChars),
  };
}

function compact(text: string | undefined, max: number): string {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '无';
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

export function buildProductionPlannerContext(ledger: StoryStateLedger): string {
  const recentChapters = ledger.recentChapters
    .slice(-2)
    .map((chapter) => `- ${chapter.title}: ${compact(chapter.summary || chapter.sceneBeats, 180)}`)
    .join('\n') || '- 无';
  const characters = ledger.entityStates.characters
    .slice(0, 4)
    .map((entry) => `- ${entry.name}: ${compact(entry.summary, 120)}`)
    .join('\n') || '- 无';
  const items = ledger.entityStates.items
    .slice(0, 3)
    .map((entry) => `- ${entry.name}: ${compact(entry.summary, 100)}`)
    .join('\n') || '- 无';
  const foreshadowings = ledger.openForeshadowings
    .map((entry) => {
      const payoff = entry.plannedPayoffRange ? `；计划回收区间：${entry.plannedPayoffRange.from}-${entry.plannedPayoffRange.to}` : '';
      return `- ${entry.title}${entry.plannedAction ? ` [本章${entry.plannedAction}]` : ''}: ${compact(entry.description, 140)}${payoff}${entry.revealConstraint ? `；揭示约束：${compact(entry.revealConstraint, 120)}` : ''}`;
    })
    .join('\n') || '- 无';

  return [
    `作品：${ledger.title}`,
    `摘要：${compact(ledger.summary, 220)}`,
    `世界规则：${compact(ledger.worldRules, 260)}`,
    `全局大纲：${compact(ledger.globalOutline, 260)}`,
    '近期章节：',
    recentChapters,
    '关键人物：',
    characters,
    '关键道具：',
    items,
    '开放伏笔（规划必须安排提示/回收，不得遗忘）：',
    foreshadowings,
  ].join('\n');
}

export function buildProductionWriterContext(ledger: StoryStateLedger): string {
  const recentChapters = ledger.recentChapters
    .slice(-3)
    .map((chapter) => `- ${chapter.title}: ${compact(chapter.summary || chapter.sceneBeats, 220)}`)
    .join('\n') || '- 无';
  const characters = ledger.entityStates.characters
    .slice(0, 6)
    .map((entry) => `- ${entry.name}: ${compact(entry.summary, 140)}${entry.statusNote ? ` (${compact(entry.statusNote, 80)})` : ''}`)
    .join('\n') || '- 无';
  const items = ledger.entityStates.items
    .slice(0, 4)
    .map((entry) => `- ${entry.name}: ${compact(entry.summary, 120)}`)
    .join('\n') || '- 无';
  const foreshadowings = ledger.openForeshadowings
    .map((entry) => `- ${entry.title}${entry.plannedAction ? ` [本章${entry.plannedAction}]` : ''}: ${compact(entry.description, 120)}${entry.revealConstraint ? `；揭示约束：${compact(entry.revealConstraint, 120)}` : ''}`)
    .join('\n') || '- 无';

  return [
    `作品：${ledger.title}`,
    `摘要：${compact(ledger.summary, 260)}`,
    `世界规则：${compact(ledger.worldRules, 320)}`,
    `全局大纲：${compact(ledger.globalOutline, 320)}`,
    '近期章节：',
    recentChapters,
    '关键人物：',
    characters,
    '关键道具：',
    items,
    '未回收伏笔：',
    foreshadowings,
  ].join('\n');
}
