import type { Character } from '../../shared/types/world.js';
import type { ArtifactCandidate, ArtifactImpactReport, CharacterCore } from '../../shared/types/creative-artifacts.js';
import { diagnoseCharacterCore, emptyCharacterCore, normalizeCharacterCore, type CharacterCoreGap } from '../../shared/lib/character-core.js';
import { fingerprintCreativeArtifact } from '../../shared/lib/creative-artifact-fingerprint.js';
import { getCatalogCapabilityManifest } from '../../shared/lib/capability-manifest-catalog.js';
import { getArtifactCore } from '../lib/db/creative-artifacts.js';
import { listEntityRelationships, listForeshadowings, listOutlineArtifacts } from '../lib/db.js';
import type { PreviewArtifactCandidateInput } from './creative-artifact-candidates.js';

const asRecord = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};

export interface CharacterCandidateNormalization {
  core: CharacterCore;
  proposedContent?: string;
  gaps: CharacterCoreGap[];
}

function tryParseJson(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!cleaned.startsWith('{')) return undefined;
  try { return JSON.parse(cleaned); } catch { return undefined; }
}

/** Normalizes model output without accepting it into readable Canon. */
export function normalizeCharacterCandidateOutput(raw: string): CharacterCandidateNormalization {
  const parsed = tryParseJson(raw);
  if (parsed === undefined) {
    return { core: emptyCharacterCore(), proposedContent: raw.trim(), gaps: diagnoseCharacterCore(emptyCharacterCore()) };
  }
  const parsedRecord = asRecord(parsed);
  const core = normalizeCharacterCore(parsedRecord.core ?? parsedRecord);
  const proposedContent = typeof parsedRecord.proposedContent === 'string'
    ? parsedRecord.proposedContent.trim()
    : typeof parsedRecord.bio === 'string' ? parsedRecord.bio.trim() : undefined;
  return { core, ...(proposedContent ? { proposedContent } : {}), gaps: diagnoseCharacterCore(core) };
}

export function characterImpactReport(novelId: string, characterId: string): ArtifactImpactReport {
  const outlines = listOutlineArtifacts(novelId, { status: 'active' })
    .filter((artifact) => artifact.core?.nodes.some((node) => node.characterIds.includes(characterId)))
    .map((artifact) => ({
      kind: artifact.level === 'master' ? 'master-outline' as const : artifact.level === 'volume' ? 'volume-outline' as const : 'chapter-outline' as const,
      id: artifact.id,
      version: artifact.version ?? 1,
    }));
  const relationships = listEntityRelationships(novelId).filter((item) => item.sourceType === 'character' && item.sourceId === characterId || item.targetType === 'character' && item.targetId === characterId);
  const promises = listForeshadowings(novelId).filter((item) => item.relatedCharacterIds.includes(characterId));
  const promiseRefs = promises.map((item) => ({
    kind: 'narrative-promise' as const,
    id: item.id,
    version: item.coreVersion ?? 1,
  }));
  return {
    downstream: outlines,
    reviewRequired: [...outlines, ...promiseRefs],
    affectedEntities: [
      ...relationships.map((item) => ({ kind: 'relationship' as const, id: item.id, reviewRequired: true })),
      ...promises.map((item) => ({ kind: 'narrative-promise' as const, id: item.id, reviewRequired: true })),
    ],
    manuscriptConflict: false,
    reasons: [
      'character changes can affect active outline nodes',
      relationships.length ? 'character changes affect existing relationships' : 'no existing character relationship is linked',
      promises.length ? 'character changes affect linked narrative promises' : 'no linked narrative promise is available',
    ],
  };
}

export function buildCharacterCandidateInput(input: {
  novelId: string;
  character: Character;
  rawOutput: string;
  operation?: PreviewArtifactCandidateInput['operation'];
  goal?: string;
  capabilityId?: string;
}): PreviewArtifactCandidateInput {
  const capabilityId = input.capabilityId ?? 'bible-character-arc';
  const manifest = getCatalogCapabilityManifest(capabilityId);
  const current = getArtifactCore(input.novelId, 'character', input.character.id);
  const baseFingerprint = fingerprintCreativeArtifact({
    kind: 'character', version: current?.version ?? 0, core: current?.core, content: current?.readableContent,
  });
  const normalized = normalizeCharacterCandidateOutput(input.rawOutput);
  return {
    novelId: input.novelId,
    target: { kind: 'character', id: input.character.id, version: current?.version ?? 0 },
    operation: input.operation ?? 'restructure',
    goal: input.goal ?? '完善角色结构化设定并保留作者可读内容',
    baseFingerprint,
    sourceCapabilityVersions: [{ capabilityId, version: manifest?.version ?? '3' }],
    proposedCore: normalized.core as unknown as Record<string, unknown>,
    ...(normalized.proposedContent === undefined ? {} : { proposedContent: normalized.proposedContent }),
    impactReport: characterImpactReport(input.novelId, input.character.id),
  };
}

export function characterCandidateSummary(candidate: ArtifactCandidate<CharacterCore>): { gaps: CharacterCoreGap[]; changedFields: string[] } {
  return {
    gaps: diagnoseCharacterCore(candidate.proposedCore),
    changedFields: candidate.diff.fields.map((field) => field.path),
  };
}
