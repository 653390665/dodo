import type {
  NarrativePromiseCore,
  NarrativePromiseEvidence,
  NarrativePromisePlan,
} from '../types/story-memory.js';
import type { Foreshadowing } from '../types/world.js';

export type NarrativePromisePlanIssueCode =
  | 'INTENT_REQUIRED'
  | 'RANGE_INVALID'
  | 'SOURCE_OUTLINE_NODE_INVALID'
  | 'WINDOW_ORDER_INVALID';

export interface NarrativePromisePlanIssue {
  code: NarrativePromisePlanIssueCode;
  path: string;
}

export interface NarrativePromiseImpact {
  action: NarrativePromiseEvidence['action'];
  range: { from: number; to: number };
  status: 'scheduled' | 'due' | 'overdue' | 'deferred' | 'satisfied';
}

const isRange = (value: unknown): value is { from: number; to: number } => {
  if (!value || typeof value !== 'object') return false;
  const range = value as { from?: unknown; to?: unknown };
  return Number.isInteger(range.from) && Number.isInteger(range.to)
    && Number(range.from) >= 0 && Number(range.to) >= Number(range.from);
};

export function validateNarrativePromisePlan(plan: NarrativePromisePlan): NarrativePromisePlanIssue[] {
  const issues: NarrativePromisePlanIssue[] = [];
  const source = plan && typeof plan === 'object' ? plan as Partial<NarrativePromisePlan> : {};
  if (typeof source.intent !== 'string' || !source.intent.trim()) issues.push({ code: 'INTENT_REQUIRED', path: 'intent' });
  const hintRanges = Array.isArray(source.plannedHintRanges) ? source.plannedHintRanges : undefined;
  const ranges = [
    ...(source.plannedPlantRange !== undefined ? [{ path: 'plannedPlantRange', value: source.plannedPlantRange }] : []),
    ...(hintRanges ? hintRanges.map((value, index) => ({ path: `plannedHintRanges.${index}`, value })) : []),
    ...(source.plannedPayoffRange !== undefined ? [{ path: 'plannedPayoffRange', value: source.plannedPayoffRange }] : []),
  ];
  if (!hintRanges) issues.push({ code: 'RANGE_INVALID', path: 'plannedHintRanges' });
  ranges.forEach(({ path, value }) => {
    if (!isRange(value)) issues.push({ code: 'RANGE_INVALID', path });
  });
  const sourceIds = Array.isArray(source.sourceOutlineNodeIds) ? source.sourceOutlineNodeIds : [];
  const normalizedIds = sourceIds.map((id) => typeof id === 'string' ? id.trim() : '');
  if (!normalizedIds.length || normalizedIds.some((id) => !id) || new Set(normalizedIds).size !== normalizedIds.length) {
    issues.push({ code: 'SOURCE_OUTLINE_NODE_INVALID', path: 'sourceOutlineNodeIds' });
  }
  const validRanges = ranges.filter(({ value }) => isRange(value));
  for (let index = 1; index < validRanges.length; index += 1) {
    if (validRanges[index].value.from <= validRanges[index - 1].value.to) {
      issues.push({ code: 'WINDOW_ORDER_INVALID', path: validRanges[index].path });
    }
  }
  return issues;
}

export function deriveForeshadowingCompatibilityStatus(
  evidence: NarrativePromiseEvidence[],
): Foreshadowing['status'] {
  if (evidence.some((item) => item.action === 'payoff')) return 'payoff';
  if (evidence.some((item) => item.action === 'hint')) return 'hinted';
  return 'planted';
}

export function buildNarrativePromiseImpacts(
  core: NarrativePromiseCore,
  chapterOrder: number,
): NarrativePromiseImpact[] {
  const entries = [
    ...(core.plan.plannedPlantRange ? [{ action: 'plant' as const, range: core.plan.plannedPlantRange }] : []),
    ...core.plan.plannedHintRanges.map((range) => ({ action: 'hint' as const, range })),
    ...(core.plan.plannedPayoffRange ? [{ action: 'payoff' as const, range: core.plan.plannedPayoffRange }] : []),
  ];
  const confirmedCounts = core.evidence.reduce<Record<string, number>>((counts, item) => {
    counts[item.action] = (counts[item.action] || 0) + 1;
    return counts;
  }, {});
  const consumedCounts: Record<string, number> = {};
  return entries.map((entry, index) => {
    const consumed = consumedCounts[entry.action] || 0;
    const satisfied = consumed < (confirmedCounts[entry.action] || 0);
    consumedCounts[entry.action] = consumed + 1;
    if (satisfied) return { ...entry, status: 'satisfied' as const };
    if (chapterOrder < entry.range.from) return { ...entry, status: 'scheduled' as const };
    if (chapterOrder <= entry.range.to) return { ...entry, status: 'due' as const };
    const laterSameAction = entries.slice(index + 1).some((next) => next.action === entry.action);
    return { ...entry, status: laterSameAction ? 'deferred' as const : 'overdue' as const };
  });
}

export function normalizeNarrativePromiseCore(value: unknown): NarrativePromiseCore | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<NarrativePromiseCore>;
  if (source.schemaVersion !== 1 || !source.plan || typeof source.plan !== 'object' || !Array.isArray(source.evidence)) return undefined;
  if (validateNarrativePromisePlan(source.plan).length) return undefined;
  const evidence = source.evidence.flatMap((item): NarrativePromiseEvidence[] => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as NarrativePromiseEvidence;
    const chapterId = typeof candidate.chapterId === 'string' ? candidate.chapterId.trim() : '';
    const quote = typeof candidate.quote === 'string' ? candidate.quote.trim() : '';
    const location = typeof candidate.location === 'string' ? candidate.location.trim() : '';
    if (!chapterId || !quote
      || !['plant', 'hint', 'payoff'].includes(candidate.action)
      || !Number.isFinite(candidate.confirmedAt)) return [];
    return [{ ...candidate, chapterId, quote, location: location || undefined }];
  });
  return { schemaVersion: 1, plan: source.plan, evidence };
}
