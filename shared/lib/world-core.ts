import type { StructuredWorldCore } from '../types/creative-artifacts.js';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};

function statements(value: unknown, kind: 'rule' | 'power' | 'faction') {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const source = record(item);
    const statement = text(source.statement);
    if (!statement) return [];
    const id = text(source.id) || `${kind}-${index + 1}`;
    if (kind === 'power') return [{ id, statement, ...(text(source.cost) ? { cost: text(source.cost) } : {}) }];
    if (kind === 'faction') return [{ id, factionId: text(source.factionId), statement }];
    return [{ id, statement }];
  });
}

export function emptyWorldCore(): StructuredWorldCore {
  return { schemaVersion: 1, hardRules: [], powerConstraints: [], prohibitions: [], factionConstraints: [] };
}

/** Keeps only explicit structured world facts from an LLM response. */
export function normalizeWorldCore(value: unknown): StructuredWorldCore {
  const source = record(value);
  return {
    schemaVersion: 1,
    hardRules: statements(source.hardRules, 'rule') as StructuredWorldCore['hardRules'],
    powerConstraints: statements(source.powerConstraints, 'power') as StructuredWorldCore['powerConstraints'],
    prohibitions: statements(source.prohibitions, 'rule') as StructuredWorldCore['prohibitions'],
    factionConstraints: statements(source.factionConstraints, 'faction') as StructuredWorldCore['factionConstraints'],
  };
}
