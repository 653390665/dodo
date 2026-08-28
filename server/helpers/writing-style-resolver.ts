import { createHash } from 'node:crypto';
import type { WritingStyleMode } from '../../shared/types/preferences.js';

export const WRITING_STYLE_RESOLVER_VERSION = 1 as const;

export interface WritingStyleInput {
  novelId: string;
  mode?: WritingStyleMode;
  styleAnchors?: string[];
  writerSkill?: Record<string, unknown>;
  pack?: { id?: string; novelId: string; status: 'draft' | 'approved'; styleProfile?: Record<string, unknown> };
  sessionCards?: Array<Record<string, unknown>>;
  /** Resolved project skill-deck cards. Only writer-relevant cards should be supplied. */
  skillDeck?: Array<Record<string, unknown>>;
  /** Only writer-stage techniques participate in writing-style confirmation. */
  techniques?: Array<Record<string, unknown>>;
  /** Accepted for compatibility only; never used as authoritative input. */
  clientSkills?: unknown;
}

export interface WritingStyleSlot {
  source: 'default' | 'skill-deck' | 'writer-skill' | 'continuation-pack' | 'writer-session';
  id?: string;
  value: Record<string, unknown>;
}

export interface WritingStyleResolution {
  resolverVersion: typeof WRITING_STYLE_RESOLVER_VERSION;
  mode: WritingStyleMode;
  styleAnchors: string[];
  slots: [WritingStyleSlot, WritingStyleSlot?, WritingStyleSlot?];
  sessionCards: Array<Record<string, unknown>>;
  techniques: Array<Record<string, unknown>>;
  warnings: string[];
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

function normalizeStringCollection(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map(normalizeText).filter(Boolean))].sort();
}

function normalizeStyleProfile(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value) return {};
  // Only style-bearing fields participate in the contract. Pack bookkeeping
  // (for example updatedAt/import metadata) must not force reconfirmation.
  const profile: Record<string, unknown> = {};
  for (const key of ['pov', 'tense', 'pacing', 'dialogueDensity', 'sampleEvidence']) {
    if (typeof value[key] === 'string') profile[key] = normalizeText(value[key] as string);
  }
  profile.proseTraits = normalizeStringCollection(value.proseTraits);
  profile.avoidTraits = normalizeStringCollection(value.avoidTraits);
  return profile;
}

function stable(value: unknown): unknown {
  if (typeof value === 'string') return normalizeText(value);
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
  }
  return value;
}

export function canonicalWritingStyleFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export function resolveWritingStyle(input: WritingStyleInput): WritingStyleResolution {
  const mode = input.mode ?? 'writer-skill';
  const warnings: string[] = [];
  if (input.pack && input.pack.novelId !== input.novelId) throw new Error('Continuation pack belongs to another novel');
  if (input.pack?.status === 'draft') warnings.push('continuation-pack-draft');
  const styleAnchors = [...new Set((input.styleAnchors || []).map(normalizeText).filter(Boolean))].sort();
  const rawCards = input.sessionCards || [];
  if (rawCards.length > 6) throw new Error('TOO_MANY_SESSION_CARDS');
  const cards = rawCards
    .map((card) => stable(card) as Record<string, unknown>)
    .sort((left, right) => String(left.id || '').localeCompare(String(right.id || '')));
  const deckCards = (input.skillDeck || [])
    .map((card) => stable(card) as Record<string, unknown>)
    .sort((left, right) => String(left.id || '').localeCompare(String(right.id || '')));
  const techniques = (input.techniques || [])
    .map((technique) => stable(technique) as Record<string, unknown>)
    .sort((left, right) => String(left.id || '').localeCompare(String(right.id || '')));
  const slots: WritingStyleResolution['slots'] = [{ source: 'default', value: {} }];
  if (deckCards.length > 0) slots[0] = { source: 'skill-deck', value: { cards: deckCards } };
  else if (input.writerSkill) slots[0] = { source: 'writer-skill', id: String(input.writerSkill.id || ''), value: stable(input.writerSkill) as Record<string, unknown> };
  if (input.pack) slots[1] = {
    source: 'continuation-pack',
    id: input.pack.id,
    value: { status: input.pack.status, styleProfile: normalizeStyleProfile(input.pack.styleProfile) },
  };
  if (cards.length > 0) slots[2] = { source: 'writer-session', value: { cards } };
  if (mode === 'continuation-pack' && !input.pack) warnings.push('continuation-pack-missing');
  return { resolverVersion: WRITING_STYLE_RESOLVER_VERSION, mode, styleAnchors, slots, sessionCards: cards, techniques, warnings };
}

export function checkWritingStyleConfirmation(input: {
  currentFingerprint: string;
  storedFingerprint?: string;
  providedFingerprint?: string;
}): { ok: true } | { ok: false; fingerprint: string } {
  const { currentFingerprint, storedFingerprint, providedFingerprint } = input;
  return storedFingerprint === currentFingerprint && providedFingerprint === currentFingerprint
    ? { ok: true }
    : { ok: false, fingerprint: currentFingerprint };
}
