import type { Novel, ProjectCapabilityProfile, ProjectPreferenceProfile, Skill } from '../../shared/types.js';
import { capabilityManifestFor, validateSkillCardForScope } from './manifest.js';
import { validateCapabilityProfile } from '../helpers/writing-style-service.js';

export interface MigrationConflict { id: string; reason: string; relatedIds?: string[] }
export interface MigrationPreview {
  flow?: { id: string; source: string };
  techniques: Array<{ id: string; source: string }>;
  skillCards: { main?: { id: string; source: string }; support: Array<{ id: string; source: string }> };
  mainCard?: { id: string; source: string };
  supportCards: Array<{ id: string; source: string }>;
  migrationPendingIds: string[];
  conflicts: MigrationConflict[];
  capabilityProfile: ProjectCapabilityProfile;
  suggestion?: string;
}

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const unique = (ids: string[]): string[] => [...new Set(ids.filter((id) => id.trim().length > 0))];

function skillIsRuntimeReady(skill: Skill): boolean {
  try {
    validateSkillCardForScope(skill, 'project');
    return true;
  } catch {
    return false;
  }
}

function sourceOf(skill: Skill | undefined): string {
  return skill?.sourceType || skill?.sourceBadge || 'historical';
}

export function buildCapabilityMigrationPreview(novel: Novel, skills: Skill[] = []): MigrationPreview {
  const profile = asRecord(novel.projectPreferenceProfile);
  const existing = profile.capabilityModelVersion === 3 && profile.capabilityProfile && typeof profile.capabilityProfile === 'object'
    ? profile.capabilityProfile as ProjectCapabilityProfile : undefined;
  if (existing) {
    const mainCard = existing.projectSkillDeck?.mainCardId ? { id: existing.projectSkillDeck.mainCardId, source: 'v3' } : undefined;
    const supportCards = (existing.projectSkillDeck?.supportCardIds || []).map((id) => ({ id, source: 'v3' }));
    validateCapabilityProfile(novel.id, existing);
    const projectTechniqueIds = existing.projectTechniqueIds ?? existing.favoriteTechniqueIds ?? [];
    return { flow: existing.activeFlowId ? { id: existing.activeFlowId, source: 'v3' } : undefined, techniques: projectTechniqueIds.map((id) => ({ id, source: 'v3' })), skillCards: { main: mainCard, support: supportCards }, mainCard, supportCards, migrationPendingIds: existing.migrationPendingIds || [], conflicts: [], capabilityProfile: existing };
  }
  const loadout = Array.isArray(novel.mountedSkillLoadout) ? novel.mountedSkillLoadout : [];
  const mountedIds = Array.isArray(novel.mountedSkillIds) ? novel.mountedSkillIds.filter((id): id is string => typeof id === 'string') : [];
  const ids = unique([...loadout.map((entry) => typeof entry?.skillId === 'string' ? entry.skillId : ''), ...mountedIds]);
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const pending: string[] = [];
  const conflicts: MigrationConflict[] = [];
  const techniques: Array<{ id: string; source: string }> = [];
  const cards: Array<{ id: string; source: string; slot?: number }> = [];
  const flows: Array<{ id: string; source: string }> = [];
  const invalidIds = new Set<string>();
  const duplicateIds = new Set<string>();
  if (new Set(mountedIds).size !== mountedIds.length) conflicts.push({ id: 'mountedSkillIds', reason: 'duplicate-mounted-id', relatedIds: mountedIds });
  for (const entry of loadout) {
    if (typeof entry?.skillId === 'string' && (!Number.isInteger(entry.slot) || entry.slot < 0 || entry.slot > 2)) {
      invalidIds.add(entry.skillId); conflicts.push({ id: entry.skillId, reason: 'out-of-range-slot', relatedIds: [String(entry.slot)] });
    }
  }
  for (const id of ids) {
    if (loadout.filter((entry) => entry?.skillId === id).length > 1) {
      duplicateIds.add(id); pending.push(id); conflicts.push({ id, reason: 'duplicate-mounted-entry' });
    }
  }

  for (const id of ids) {
    if (invalidIds.has(id) || duplicateIds.has(id)) continue;
    const skill = byId.get(id);
    const manifest = capabilityManifestFor(id);
    const loadoutEntries = loadout.filter((entry) => entry?.skillId === id);
    const slot = loadoutEntries.length === 1 && Number.isInteger(loadoutEntries[0]?.slot) ? loadoutEntries[0].slot : undefined;
    if (loadoutEntries.length > 1) conflicts.push({ id, reason: 'duplicate-mounted-entry', relatedIds: loadoutEntries.map((entry) => String(entry.slot)) });
    if (manifest?.kind === 'flow') flows.push({ id, source: manifest.sourceType });
    else if (manifest?.kind === 'technique') techniques.push({ id, source: manifest.sourceType });
    else if (manifest?.kind === 'skill-card' && skill && skillIsRuntimeReady(skill)) cards.push({ id, source: sourceOf(skill), slot });
    else if (skill && skillIsRuntimeReady(skill)) cards.push({ id, source: sourceOf(skill), slot });
    else pending.push(id);
  }

  if (flows.length > 1) {
    conflicts.push({ id: flows[0].id, reason: 'multiple-flow-candidates', relatedIds: flows.map((item) => item.id) });
    pending.push(...flows.map((item) => item.id));
  }
  if (cards.filter((card) => card.slot === 0).length > 1) {
    conflicts.push({ id: 'skill-deck', reason: 'multiple-main-candidates', relatedIds: cards.filter((card) => card.slot === 0).map((item) => item.id) });
    pending.push(...cards.filter((card) => card.slot === 0).map((item) => item.id));
  }
  const mainCandidates = cards.filter((card) => card.slot === 0);
  const main = mainCandidates.length === 1 ? mainCandidates[0] : undefined;
  if (mainCandidates.length === 0 && cards.length > 0) {
    conflicts.push({ id: 'skill-deck', reason: 'main-card-selection-required', relatedIds: cards.map((item) => item.id) });
    pending.push(...cards.map((item) => item.id));
  }
  const supports = main ? cards.filter((card) => card.id !== main.id) : [];
  if (supports.length > 2) {
    conflicts.push({ id: 'skill-deck', reason: 'too-many-support-candidates', relatedIds: supports.map((item) => item.id) });
    pending.push(...supports.map((item) => item.id));
  }
  const support = supports.length > 2 ? [] : supports;
  const activeFlow = flows.length === 1 ? flows[0] : undefined;
  if (!main && mainCandidates.length > 1) pending.push(...cards.map((item) => item.id));
  const migrationPendingIds = unique([...pending, ...conflicts.flatMap((item) => item.relatedIds || []).filter((id) => id !== activeFlow?.id && !techniques.some((item) => item.id === id) && id !== main?.id && !support.some((item) => item.id === id))]);
  const capabilityProfile: ProjectCapabilityProfile = {
    version: 3,
    ...(activeFlow ? { activeFlowId: activeFlow.id } : {}),
    projectSkillDeck: { ...(main ? { mainCardId: main.id } : {}), supportCardIds: support.map((item) => item.id), updatedAt: Date.now() },
    favoriteTechniqueIds: unique(techniques.map((item) => item.id)),
    projectTechniqueIds: unique(techniques.map((item) => item.id)),
    ...(migrationPendingIds.length ? { migrationPendingIds } : {}),
  };
  const mainCard = main && { id: main.id, source: main.source };
  const supportCards = support.map((item) => ({ id: item.id, source: item.source }));
  return { flow: activeFlow, techniques, skillCards: { main: mainCard, support: supportCards }, mainCard, supportCards, migrationPendingIds, conflicts, capabilityProfile, ...(loadout.length === 0 ? { suggestion: 'mountedSkillIds-only-order' } : {}) };
}

export function mergeMigratedProfile(current: ProjectPreferenceProfile | undefined, capabilityProfile: ProjectCapabilityProfile): ProjectPreferenceProfile {
  return { ...(current || { tags: [], weights: { styleWeight: 0, characterWeight: 0, worldWeight: 0, plotWeight: 0, pacingWeight: 0 }, acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0 }), capabilityModelVersion: 3, capabilityProfile };
}

export function migrationProfileFingerprint(profile: ProjectCapabilityProfile): string {
  return JSON.stringify({ ...profile, projectSkillDeck: { ...profile.projectSkillDeck, updatedAt: 0 } });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

/** Binds a migration preview to the complete persisted project profile. */
export function migrationProjectProfileFingerprint(profile: ProjectPreferenceProfile | undefined): string {
  return JSON.stringify(canonicalize(profile || null));
}
