import type { Chapter, StoryStateLedger } from '../types';

export function getNextChapterOrder(chapters: Pick<Chapter, 'order'>[]): number {
  if (!chapters.length) return 1;
  return Math.max(...chapters.map((chapter) => chapter.order || 0)) + 1;
}

export function buildChapterProductionTitle(order: number): string {
  return `第 ${order} 章`;
}

export function normalizeProductionIntent(intent: string): string {
  const normalized = intent.trim();
  return normalized || '延续上一章剧情，生成下一章分镜、正文和连续性审计。';
}

export function buildProductionPromptContexts(args: {
  layeredContext: string;
  plannerContext: string;
  writerContext: string;
  continuationPackContext?: string;
}): { planner: string; writer: string } {
  const { layeredContext, plannerContext, writerContext, continuationPackContext } = args;
  return {
    planner: [layeredContext, continuationPackContext, plannerContext].filter(Boolean).join('\n\n'),
    writer: [writerContext, continuationPackContext].filter(Boolean).join('\n\n'),
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
    .slice(0, 4)
    .map((entry) => `- ${entry.title}: ${compact(entry.description, 120)}`)
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
