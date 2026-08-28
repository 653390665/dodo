import type { CharacterCore } from '../types/creative-artifacts.js';

export type CharacterCoreGap =
  | 'desire'
  | 'externalGoal'
  | 'fearOrFalseBelief'
  | 'contradictions'
  | 'speechPattern'
  | 'decisionPattern'
  | 'arc'
  | 'immutableFacts';

export const CHARACTER_CORE_GAP_LABELS: Record<CharacterCoreGap, string> = {
  desire: '核心欲望',
  externalGoal: '外部目标',
  fearOrFalseBelief: '恐惧或错误信念',
  contradictions: '性格矛盾',
  speechPattern: '说话模式',
  decisionPattern: '决策模式',
  arc: '人物弧光',
  immutableFacts: '不可变事实',
};

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const texts = (value: unknown): string[] => Array.isArray(value)
  ? value.map(text).filter(Boolean)
  : [];
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};

export function emptyCharacterCore(): CharacterCore {
  return {
    schemaVersion: 1,
    desire: '', externalGoal: '', internalNeed: '', fear: '', woundOrFalseBelief: '',
    strengths: [], flaws: [], contradictions: [], speechPattern: '', habitualActions: [], decisionPattern: '',
    relationshipTensions: [], arc: { start: '', turns: [], target: '' }, immutableFacts: [],
  };
}

/** Drops malformed LLM fields; it never infers a fact from readable character prose. */
export function normalizeCharacterCore(value: unknown): CharacterCore {
  const source = record(value);
  const arc = record(source.arc);
  return {
    schemaVersion: 1,
    desire: text(source.desire), externalGoal: text(source.externalGoal), internalNeed: text(source.internalNeed),
    fear: text(source.fear), woundOrFalseBelief: text(source.woundOrFalseBelief),
    strengths: texts(source.strengths), flaws: texts(source.flaws), contradictions: texts(source.contradictions),
    speechPattern: text(source.speechPattern), habitualActions: texts(source.habitualActions), decisionPattern: text(source.decisionPattern),
    relationshipTensions: Array.isArray(source.relationshipTensions)
      ? source.relationshipTensions.flatMap((item) => {
        const relation = record(item);
        const characterId = text(relation.characterId);
        const tension = text(relation.tension);
        return characterId && tension ? [{ characterId, tension }] : [];
      })
      : [],
    arc: { start: text(arc.start), turns: texts(arc.turns), target: text(arc.target) },
    immutableFacts: texts(source.immutableFacts),
  };
}

export function diagnoseCharacterCore(value: unknown): CharacterCoreGap[] {
  const core = normalizeCharacterCore(value);
  const gaps: CharacterCoreGap[] = [];
  if (!core.desire) gaps.push('desire');
  if (!core.externalGoal) gaps.push('externalGoal');
  if (!core.fear && !core.woundOrFalseBelief) gaps.push('fearOrFalseBelief');
  if (!core.contradictions.length) gaps.push('contradictions');
  if (!core.speechPattern) gaps.push('speechPattern');
  if (!core.decisionPattern) gaps.push('decisionPattern');
  if (!core.arc.start || !core.arc.turns.length || !core.arc.target) gaps.push('arc');
  if (!core.immutableFacts.length) gaps.push('immutableFacts');
  return gaps;
}

export const getCharacterCoreGaps = diagnoseCharacterCore;

export interface CharacterCompletenessReport {
  complete: boolean;
  gaps: CharacterCoreGap[];
}

export function diagnoseCharacterCompleteness(value: unknown): CharacterCompletenessReport {
  const gaps = diagnoseCharacterCore(value);
  return { complete: gaps.length === 0, gaps };
}

export const checkCharacterCompleteness = diagnoseCharacterCompleteness;
