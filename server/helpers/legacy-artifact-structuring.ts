import { parseStoredJson } from '../lib/parse-json';
import { generateId } from '../id.js';
import { normalizeCharacterCore } from '../../shared/lib/character-core.js';
import { fingerprintCreativeArtifact } from '../../shared/lib/creative-artifact-fingerprint.js';
import { normalizeNarrativePromiseCore } from '../../shared/lib/narrative-promise.js';
import { isStructuredOutlineCore } from '../../shared/lib/outline-structure.js';
import { normalizeWorldCore } from '../../shared/lib/world-core.js';
import type { CreativeArtifactKind } from '../../shared/types/creative-artifacts.js';
import type { LegacyArtifactPreview, LegacyArtifactSource } from '../../shared/types/legacy-artifact-structuring.js';
import * as db from '../lib/db.js';
import { getDatabaseGeneration } from '../lib/db-instance.js';
import { acceptCanonPatch, createCanonPatch, getCanonFingerprint } from '../lib/db/canon-patches.js';
import { getArtifactCore, saveArtifactVersion } from '../lib/db/creative-artifacts.js';

const OUTLINE_KINDS = new Set<CreativeArtifactKind>(['master-outline', 'volume-outline', 'chapter-outline']);
const text = (value: unknown) => typeof value === 'string' ? value : '';
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const STRUCTURED_ROOT_HINTS: Record<LegacyArtifactSource['artifactKind'], string> = {
  world: '{"schemaVersion":1,"hardRules":[],"powerConstraints":[],"prohibitions":[],"factionConstraints":[]}',
  character: '{"schemaVersion":1,"desire":"","externalGoal":"","internalNeed":"","fear":"","woundOrFalseBelief":"","strengths":[],"flaws":[],"contradictions":[],"speechPattern":"","habitualActions":[],"decisionPattern":"","relationshipTensions":[],"arc":{"start":"","turns":[],"target":""},"immutableFacts":[]}',
  'master-outline': '{"schemaVersion":1,"nodes":[{"id":"","type":"premise","title":"","intent":"","order":0,"characterIds":[],"foreshadowingIds":[]}]}',
  'volume-outline': '{"schemaVersion":1,"nodes":[{"id":"","type":"turn","title":"","intent":"","order":0,"characterIds":[],"foreshadowingIds":[]}]}',
  'chapter-outline': '{"schemaVersion":1,"nodes":[{"id":"","type":"turn","title":"","intent":"","order":0,"characterIds":[],"foreshadowingIds":[]}]}',
  'scene-beats': '{"schemaVersion":1,"beats":[{"order":1,"summary":"","intent":""}]}',
  'narrative-promise': '{"schemaVersion":1,"plan":{"intent":"","plannedHintRanges":[],"sourceOutlineNodeIds":[]},"evidence":[]}',
};

function sourceFingerprint(source: Omit<LegacyArtifactSource, 'sourceFingerprint'>): string {
  return fingerprintCreativeArtifact({
    kind: source.artifactKind,
    version: source.artifactVersion,
    core: { novelId: source.novelId, artifactId: source.artifactId },
    content: source.originalContent,
  });
}

function makeSource(input: Omit<LegacyArtifactSource, 'sourceFingerprint'>): LegacyArtifactSource {
  return { ...input, sourceFingerprint: sourceFingerprint(input) };
}

function sourceFor(novelId: string, kind: LegacyArtifactSource['artifactKind'], artifactId: string, label: string, content: string, version: number): LegacyArtifactSource | undefined {
  if (!content.trim() || getArtifactCore(novelId, kind, artifactId)) return undefined;
  return makeSource({ novelId, artifactKind: kind, artifactId, label, originalContent: content, artifactVersion: version });
}

export function listLegacyArtifactSources(novelId: string): LegacyArtifactSource[] {
  const novel = db.getNovel(novelId);
  if (!novel) return [];
  const sources: LegacyArtifactSource[] = [];
  const world = sourceFor(novelId, 'world', novel.id, '世界观', text(novel.worldRules), 0);
  if (world) sources.push(world);
  for (const character of db.listCharacters(novelId)) {
    const source = sourceFor(novelId, 'character', character.id, character.name, text(character.bio || character.summary), 0);
    if (source) sources.push(source);
  }
  for (const outline of db.listOutlineArtifacts(novelId, { status: 'active' })) {
    if (outline.core) continue;
    const kind = outline.level === 'master' ? 'master-outline' : outline.level === 'volume' ? 'volume-outline' : 'chapter-outline';
    const source = sourceFor(novelId, kind, outline.id, outline.content.slice(0, 80) || kind, text(outline.content), outline.version ?? 1);
    if (source) sources.push(source);
  }
  for (const chapter of db.listChapters(novelId)) {
    const source = sourceFor(novelId, 'scene-beats', chapter.id, chapter.title, text(chapter.sceneBeats), 0);
    if (source) sources.push(source);
  }
  for (const promise of db.listForeshadowings(novelId)) {
    const source = sourceFor(novelId, 'narrative-promise', promise.id, promise.title, text(promise.description), promise.coreVersion ?? 0);
    if (source) sources.push(source);
  }
  return sources;
}

export function buildLegacyStructuringPrompt(source: LegacyArtifactSource): string {
  return `你正在整理旧有创作资料。artifact kind: ${source.artifactKind}\n只输出 JSON，不得编造，不得补充原文没有的事实。\n必须返回以下 kind-specific structured root；没有原文依据的字段保持空值：\n${STRUCTURED_ROOT_HINTS[source.artifactKind]}\n原文：\n${source.originalContent}`;
}

function parseJson(raw: string): Record<string, unknown> {
  const result = parseStoredJson(raw, { stripFences: true, requireObject: true });
  if (!result.ok) {
    const code = result.code === 'EMPTY'
      ? 'LEGACY_STRUCTURING_EMPTY_OUTPUT'
      : result.code === 'NOT_OBJECT'
        ? 'LEGACY_STRUCTURING_INVALID_CORE'
        : 'LEGACY_STRUCTURING_INVALID_JSON';
    throw new Error(code);
  }
  return result.value as Record<string, unknown>;
}

function nonEmpty(kind: LegacyArtifactSource['artifactKind'], core: Record<string, unknown>): boolean {
  if (kind === 'world') {
    return ['hardRules', 'powerConstraints', 'prohibitions', 'factionConstraints']
      .some((key) => Array.isArray(core[key]) && core[key].length > 0);
  }
  if (kind === 'character') {
    const arc = record(core.arc);
    const scalarFields = ['desire', 'externalGoal', 'internalNeed', 'fear', 'woundOrFalseBelief', 'speechPattern', 'decisionPattern'];
    const listFields = ['strengths', 'flaws', 'contradictions', 'habitualActions', 'relationshipTensions', 'immutableFacts'];
    return scalarFields.some((key) => text(core[key]).trim())
      || listFields.some((key) => Array.isArray(core[key]) && core[key].length > 0)
      || text(arc.start).trim() !== ''
      || text(arc.target).trim() !== ''
      || (Array.isArray(arc.turns) && arc.turns.length > 0);
  }
  if (OUTLINE_KINDS.has(kind)) return Array.isArray(core.nodes) && core.nodes.length > 0;
  if (kind === 'narrative-promise') return text(record(core.plan).intent).trim() !== '';
  return Array.isArray(core.beats) && core.beats.length > 0;
}

export function parseLegacyStructuringOutput(source: LegacyArtifactSource, raw: string): Pick<LegacyArtifactPreview, 'proposedCore' | 'proposedContent'> {
  const parsed = parseJson(raw);
  const coreInput = parsed.core && typeof parsed.core === 'object' && !Array.isArray(parsed.core) ? parsed.core : parsed;
  let core: Record<string, unknown>;
  if (source.artifactKind === 'world') core = normalizeWorldCore(coreInput) as unknown as Record<string, unknown>;
  else if (source.artifactKind === 'character') core = normalizeCharacterCore(coreInput) as unknown as Record<string, unknown>;
  else if (OUTLINE_KINDS.has(source.artifactKind)) {
    if (!isStructuredOutlineCore(coreInput)) throw new Error('LEGACY_STRUCTURING_OUTLINE_CORE_INVALID');
    core = coreInput as unknown as Record<string, unknown>;
  } else if (source.artifactKind === 'narrative-promise') {
    const normalized = normalizeNarrativePromiseCore(coreInput);
    if (!normalized) throw new Error('LEGACY_STRUCTURING_NARRATIVE_PROMISE_INVALID');
    core = normalized as unknown as Record<string, unknown>;
  } else {
    const candidate = record(coreInput);
    if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.beats) || candidate.beats.some((beat) => {
      const item = record(beat); return !Number.isInteger(item.order) || typeof item.summary !== 'string' || !item.summary.trim() || typeof item.intent !== 'string' || !item.intent.trim();
    })) throw new Error('LEGACY_STRUCTURING_SCENE_BEATS_INVALID');
    core = { schemaVersion: 1, beats: candidate.beats };
  }
  if (!nonEmpty(source.artifactKind, core)) throw new Error('LEGACY_STRUCTURING_EMPTY_CORE');
  const proposedContent = typeof parsed.proposedContent === 'string' ? parsed.proposedContent : undefined;
  return { proposedCore: core, ...(proposedContent === undefined ? {} : { proposedContent }) };
}

export interface ConfirmLegacyStructuringInput {
  preview: LegacyArtifactPreview;
  databaseGeneration: number;
}

export async function confirmLegacyStructuringPreview(input: ConfirmLegacyStructuringInput): Promise<{ status: 'accepted'; version?: number; patchId?: string }> {
  const { preview } = input;
  if (preview.expiresAt < Date.now()) throw new Error('LEGACY_STRUCTURING_PREVIEW_EXPIRED');
  if (input.databaseGeneration !== getDatabaseGeneration()) throw new Error('DATABASE_GENERATION_STALE');
  const current = listLegacyArtifactSources(preview.source.novelId).find((item) => item.artifactKind === preview.source.artifactKind && item.artifactId === preview.source.artifactId);
  if (!current || current.sourceFingerprint !== preview.source.sourceFingerprint) throw new Error('LEGACY_STRUCTURING_SOURCE_STALE');
  if (OUTLINE_KINDS.has(preview.source.artifactKind)) {
    const artifact = db.getOutlineArtifact(preview.source.artifactId, preview.source.novelId);
    if (!artifact) throw new Error('LEGACY_STRUCTURING_SOURCE_STALE');
    const patch = createCanonPatch({ novelId: preview.source.novelId, baseFingerprint: getCanonFingerprint(preview.source.novelId), sourceAbilityId: 'legacy-artifact-structuring', operations: [{ operation: 'replace-outline', targetArtifactId: artifact.id, content: preview.proposedContent ?? preview.source.originalContent, core: preview.proposedCore as never }] as never });
    const result = await acceptCanonPatch(preview.source.novelId, patch.id, input.databaseGeneration);
    if (result.status !== 'accepted') throw new Error('LEGACY_STRUCTURING_PATCH_STALE');
    return { status: 'accepted', patchId: patch.id };
  }
  const saved = saveArtifactVersion({ novelId: preview.source.novelId, artifactKind: preview.source.artifactKind, artifactId: preview.source.artifactId, expectedVersion: preview.source.artifactVersion, core: preview.proposedCore, readableContent: preview.source.originalContent, provenance: { source: 'legacy-artifact-structuring' } });
  return { status: 'accepted', version: saved.version };
}

export function createLegacyArtifactPreview(source: LegacyArtifactSource, parsed: Pick<LegacyArtifactPreview, 'proposedCore' | 'proposedContent'>, expiresAt = Date.now() + 15 * 60_000): LegacyArtifactPreview {
  return { previewId: generateId(), source, ...parsed, expiresAt };
}
