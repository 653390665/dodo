import { generateId } from '../../id.js';
import { getDb, notify, runInTransaction } from '../db-instance.js';
import { getNovel } from './novels.js';
import { listCharacters } from './world.js';
import { listForeshadowings } from './ideas.js';
import {
  outlineMasterBaseFingerprint,
  stableOutlineScope,
} from '../../helpers/outline-fingerprint.js';
import { buildOutlineImpactReport } from '../../helpers/outline-impact.js';
import {
  isStructuredOutlineCore,
  validateOutlineHierarchy,
} from '../../../shared/lib/outline-structure.js';
import type { CreativeArtifactRef } from '../../../shared/types/creative-artifacts.js';
import type {
  OutlineArtifact,
  OutlineArtifactLevel,
  OutlineArtifactScope,
  OutlineArtifactSource,
  OutlineArtifactStatus,
  SourceCapabilityVersion,
  StructuredOutlineCore,
} from '../../../shared/types/outline-governance.js';

export class OutlineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

function scopeFor(level: OutlineArtifactLevel, scope: OutlineArtifactScope): OutlineArtifactScope {
  const clean = { ...(scope || {}) } as OutlineArtifactScope;
  if (Object.keys(clean).some((key) => !['volumeName', 'chapterStart', 'chapterEnd'].includes(key))) {
    throw new OutlineError('OUTLINE_INVALID_SCOPE', 'scope contains unknown keys');
  }
  if (clean.volumeName !== undefined) {
    if (typeof clean.volumeName !== 'string') throw new OutlineError('OUTLINE_INVALID_SCOPE', 'scope is invalid');
    clean.volumeName = clean.volumeName.trim();
  }
  if (level === 'master' && Object.keys(clean).length) {
    throw new OutlineError('OUTLINE_INVALID_SCOPE', 'master scope must be empty');
  }
  if (
    level === 'volume'
    && (!clean.volumeName?.trim() || clean.chapterStart !== undefined || clean.chapterEnd !== undefined)
  ) {
    throw new OutlineError('OUTLINE_INVALID_SCOPE', 'volume scope is invalid');
  }
  if (
    level === 'chapter'
    && (clean.volumeName !== undefined
      || !Number.isInteger(clean.chapterStart)
      || !Number.isInteger(clean.chapterEnd)
      || (clean.chapterStart as number) < 0
      || (clean.chapterEnd as number) < 0
      || (clean.chapterStart as number) > (clean.chapterEnd as number))
  ) {
    throw new OutlineError('OUTLINE_INVALID_SCOPE', 'chapter scope is invalid');
  }
  return clean;
}

function sourceCapabilityVersionsFor(value: unknown, stored = false): SourceCapabilityVersion[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return true;
    const version = entry as Record<string, unknown>;
    return typeof version.capabilityId !== 'string'
      || !version.capabilityId.trim()
      || typeof version.version !== 'string'
      || !version.version.trim();
  })) {
    throw new OutlineError(stored ? 'OUTLINE_INVALID_DATA' : 'OUTLINE_INVALID_INPUT', 'source capability versions are invalid');
  }
  return value.map((entry) => ({
    capabilityId: (entry as SourceCapabilityVersion).capabilityId,
    version: (entry as SourceCapabilityVersion).version,
  }));
}

function coreFor(value: unknown, stored = false): StructuredOutlineCore | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isStructuredOutlineCore(value)) {
    throw new OutlineError(stored ? 'OUTLINE_INVALID_DATA' : 'OUTLINE_INVALID_INPUT', 'structured outline core is invalid');
  }
  return value;
}

interface OutlineRow {
  id: string;
  novel_id: string;
  level: OutlineArtifactLevel;
  scope: string;
  content: string;
  source: OutlineArtifactSource;
  status: OutlineArtifactStatus;
  base_fingerprint: string | null;
  core_json: string | null;
  source_capability_versions: string | null;
}

function rowToArtifact(row: OutlineRow): OutlineArtifact {
  let parsedScope: unknown;
  try {
    parsedScope = JSON.parse(row.scope);
  } catch {
    throw new OutlineError('OUTLINE_INVALID_DATA', 'outline scope data is invalid');
  }
  if (
    parsedScope === null
    || typeof parsedScope !== 'object'
    || Array.isArray(parsedScope)
    || Object.getPrototypeOf(parsedScope) !== Object.prototype
  ) {
    throw new OutlineError('OUTLINE_INVALID_DATA', 'outline scope data is invalid');
  }
  let normalizedScope: OutlineArtifactScope;
  try {
    normalizedScope = scopeFor(row.level, parsedScope as OutlineArtifactScope);
  } catch {
    throw new OutlineError('OUTLINE_INVALID_DATA', 'outline scope data is invalid');
  }
  let core: StructuredOutlineCore | undefined;
  if (row.core_json !== null) {
    try {
      core = coreFor(JSON.parse(row.core_json), true);
    } catch (error) {
      if (error instanceof OutlineError) throw error;
      throw new OutlineError('OUTLINE_INVALID_DATA', 'outline core data is invalid');
    }
  }
  let sourceCapabilityVersions: SourceCapabilityVersion[] | undefined;
  if (row.source_capability_versions !== null) {
    try {
      sourceCapabilityVersions = sourceCapabilityVersionsFor(JSON.parse(row.source_capability_versions), true);
    } catch (error) {
      if (error instanceof OutlineError) throw error;
      throw new OutlineError('OUTLINE_INVALID_DATA', 'outline source capability versions are invalid');
    }
  }
  return {
    id: row.id,
    novelId: row.novel_id,
    level: row.level,
    scope: normalizedScope,
    content: row.content,
    source: row.source,
    status: row.status,
    version: 1,
    ...(row.base_fingerprint ? { baseFingerprint: row.base_fingerprint } : {}),
    ...(core ? { core } : {}),
    ...(sourceCapabilityVersions ? { sourceCapabilityVersions } : {}),
  };
}

export interface CreateOutlineInput {
  id?: string;
  novelId: string;
  level: OutlineArtifactLevel;
  scope: OutlineArtifactScope;
  content: string;
  source?: OutlineArtifactSource;
  baseFingerprint?: string;
  core?: StructuredOutlineCore;
  sourceCapabilityVersions?: SourceCapabilityVersion[];
}

export function createOutlineArtifactInTransaction(input: CreateOutlineInput): OutlineArtifact {
  const scope = scopeFor(input.level, input.scope);
  if (!getNovel(input.novelId)) {
    throw new OutlineError('OUTLINE_NOVEL_NOT_FOUND', 'novel not found');
  }
  const core = coreFor(input.core);
  const sourceCapabilityVersions = sourceCapabilityVersionsFor(input.sourceCapabilityVersions);
  if (core) {
    const validation = validateOutlineHierarchy({
      artifact: { id: input.id || '__candidate__', level: input.level, scope, core },
      characterIds: listCharacters(input.novelId).map((character) => character.id),
      foreshadowings: listForeshadowings(input.novelId).map((promise) => ({
        id: promise.id,
        ...(promise.narrativeCore?.plan.plannedPayoffRange
          ? { plannedPayoffRange: promise.narrativeCore.plan.plannedPayoffRange }
          : {}),
      })),
    });
    const missingPromise = validation.issues.find((issue) =>
      issue.code === 'OUTLINE_FORESHADOWING_MISSING' || issue.code === 'OUTLINE_PROMISE_NOT_FOUND');
    if (missingPromise) throw new OutlineError('OUTLINE_INVALID_INPUT', missingPromise.detail);
  }
  const now = Date.now();
  const id = input.id || generateId();
  getDb()
    .prepare(
      `INSERT INTO outline_artifacts (
        id, novel_id, level, scope, content, source, status, base_fingerprint,
        core_json, source_capability_versions, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.novelId,
      input.level,
      stableOutlineScope(scope),
      input.content,
      input.source || 'user',
      'candidate',
      input.baseFingerprint || null,
      core ? JSON.stringify(core) : null,
      sourceCapabilityVersions ? JSON.stringify(sourceCapabilityVersions) : null,
      now,
      now,
    );
  return getOutlineArtifact(id, input.novelId)!;
}

export function createOutlineArtifact(input: CreateOutlineInput): OutlineArtifact {
  const result = runInTransaction(() => createOutlineArtifactInTransaction(input));
  notify();
  return result;
}

export function getOutlineArtifact(id: string, novelId: string): OutlineArtifact | undefined {
  const row = getDb()
    .prepare('SELECT * FROM outline_artifacts WHERE id = ? AND novel_id = ?')
    .get(id, novelId) as OutlineRow | undefined;
  return row ? rowToArtifact(row) : undefined;
}

export function listOutlineArtifacts(
  novelId: string,
  filters: { level?: OutlineArtifactLevel; status?: OutlineArtifactStatus } = {},
): OutlineArtifact[] {
  const clauses = ['novel_id = ?'];
  const args: unknown[] = [novelId];
  if (filters.level) {
    clauses.push('level = ?');
    args.push(filters.level);
  }
  if (filters.status) {
    clauses.push('status = ?');
    args.push(filters.status);
  }
  return (
    getDb()
      .prepare(`SELECT * FROM outline_artifacts WHERE ${clauses.join(' AND ')} ORDER BY created_at ASC, id ASC`)
      .all(...args) as OutlineRow[]
  ).map(rowToArtifact);
}

export function assertOutlineMirrorIntegrity(
  novelId: string,
  artifacts = listOutlineArtifacts(novelId),
): void {
  const master = artifacts.find((artifact) => artifact.level === 'master' && artifact.status === 'active');
  if (!master) return;
  const novel = getNovel(novelId);
  if (!novel) throw new OutlineError('OUTLINE_NOVEL_NOT_FOUND', 'novel not found');
  if ((novel.globalOutline || '') !== master.content) {
    throw new OutlineError('OUTLINE_MIRROR_DIVERGED', 'active master and global outline mirror diverged');
  }
}

function validationIssue(input: {
  target: OutlineArtifact;
  artifacts: readonly OutlineArtifact[];
}): { code: string; detail: string } | undefined {
  const { target, artifacts } = input;
  const activeMaster = artifacts.find((artifact) => artifact.level === 'master' && artifact.status === 'active');
  if (target.level !== 'master' && !activeMaster) {
    return { code: 'OUTLINE_MASTER_REQUIRED', detail: 'active master required' };
  }
  const activeVolumes = artifacts.filter((artifact) => artifact.level === 'volume' && artifact.status === 'active');
  if (target.level === 'chapter' && target.core && activeVolumes.length === 0) {
    return { code: 'OUTLINE_VOLUME_REQUIRED', detail: 'active volume required for structured chapter outline' };
  }
  const upstreamNodeIds = target.level === 'master'
    ? []
    : target.level === 'volume'
      ? activeMaster?.core?.nodes.map((node) => node.id) || []
      : activeVolumes.flatMap((artifact) => artifact.core?.nodes.map((node) => node.id) || []);
  const result = validateOutlineHierarchy({
    artifact: target,
    upstreamNodeIds,
    siblingScopes: artifacts.filter((artifact) => artifact.status === 'active' && artifact.id !== target.id),
    characterIds: listCharacters(target.novelId).map((character) => character.id),
    foreshadowings: listForeshadowings(target.novelId).map((promise) => ({
      id: promise.id,
      ...(promise.narrativeCore?.plan.plannedPayoffRange
        ? { plannedPayoffRange: promise.narrativeCore.plan.plannedPayoffRange }
        : {}),
    })),
  });
  return result.issues[0];
}

function refFor(artifact: OutlineArtifact): CreativeArtifactRef {
  return {
    kind: artifact.level === 'master'
      ? 'master-outline'
      : artifact.level === 'volume'
        ? 'volume-outline'
        : 'chapter-outline',
    id: artifact.id,
    version: 1,
  };
}

function markOutlineReviewRequired(novelId: string, refs: readonly CreativeArtifactRef[]): void {
  const unique = new Map(refs.map((ref) => [`${ref.kind}:${ref.id}:${ref.version}`, ref]));
  const now = Date.now();
  for (const ref of unique.values()) {
    getDb().prepare(`
      INSERT INTO artifact_review_requirements (
        id, novel_id, artifact_kind, artifact_id, artifact_version,
        source_candidate_id, reason, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, 'review-required', ?, ?)
    `).run(
      generateId(), novelId, ref.kind, ref.id, ref.version,
      'upstream outline changed', now, now,
    );
  }
}

export interface OutlineActivationResult {
  archivedIds: string[];
  demotedIds: string[];
}

function activateOutlineArtifactInTransactionResult(novelId: string, id: string): OutlineActivationResult & { changed: boolean } {
  const target = getOutlineArtifact(id, novelId);
  if (!target) throw new OutlineError('OUTLINE_NOT_FOUND', 'outline not found');
  const artifacts = listOutlineArtifacts(novelId);
  assertOutlineMirrorIntegrity(novelId, artifacts);
  if (target.status === 'active') return { archivedIds: [], demotedIds: [], changed: false };
  const issue = validationIssue({ target, artifacts });
  if (issue) throw new OutlineError(issue.code, issue.detail);

  const archivedIds: string[] = [];
  const demotedIds: string[] = [];
  const now = Date.now();
  if (target.level === 'master') {
    for (const artifact of artifacts) {
      if (artifact.level === 'master' && artifact.status === 'active' && artifact.id !== id) {
        getDb().prepare(
          "UPDATE outline_artifacts SET status = 'archived', updated_at = ? WHERE id = ? AND novel_id = ?",
        ).run(now, artifact.id, novelId);
        archivedIds.push(artifact.id);
      }
    }
    getDb().prepare(
      "UPDATE outline_artifacts SET status = 'active', updated_at = ? WHERE id = ? AND novel_id = ?",
    ).run(now, id, novelId);
    const novel = getNovel(novelId);
    if (!novel) throw new OutlineError('OUTLINE_NOT_FOUND', 'novel not found');
    getDb().prepare('UPDATE novels SET global_outline = ?, updated_at = ? WHERE id = ?').run(target.content, now, novelId);
    const fingerprint = outlineMasterBaseFingerprint(novelId, novel.worldRules || '', target);
    const reviewRefs: CreativeArtifactRef[] = [];
    for (const artifact of artifacts) {
      if (artifact.level !== 'master' && artifact.status === 'active' && artifact.baseFingerprint !== fingerprint) {
        getDb().prepare(
          "UPDATE outline_artifacts SET status = 'candidate', updated_at = ? WHERE id = ? AND novel_id = ?",
        ).run(now, artifact.id, novelId);
        demotedIds.push(artifact.id);
        reviewRefs.push(refFor(artifact));
      }
    }
    const linked = buildOutlineImpactReport({
      proposedUpstreamNodeIds: target.core?.nodes.map((node) => node.id) || [],
      activeDownstream: artifacts.filter((artifact) => artifact.level !== 'master'),
    });
    markOutlineReviewRequired(novelId, [...reviewRefs, ...linked.reviewRequired]);
    return { archivedIds, demotedIds, changed: true };
  }

  for (const artifact of artifacts) {
    if (
      artifact.id !== id
      && artifact.level === target.level
      && artifact.status === 'active'
      && stableOutlineScope(artifact.scope) === stableOutlineScope(target.scope)
    ) {
      getDb().prepare(
        "UPDATE outline_artifacts SET status = 'archived', updated_at = ? WHERE id = ? AND novel_id = ?",
      ).run(now, artifact.id, novelId);
      archivedIds.push(artifact.id);
    }
  }
  const master = artifacts.find((artifact) => artifact.level === 'master' && artifact.status === 'active')!;
  const novel = getNovel(novelId)!;
  const fingerprint = outlineMasterBaseFingerprint(novelId, novel.worldRules || '', master);
  getDb().prepare(
    "UPDATE outline_artifacts SET status = 'active', base_fingerprint = ?, updated_at = ? WHERE id = ? AND novel_id = ?",
  ).run(fingerprint, now, id, novelId);
  if (target.level === 'volume') {
    const linked = buildOutlineImpactReport({
      proposedUpstreamNodeIds: target.core?.nodes.map((node) => node.id) || [],
      activeDownstream: artifacts.filter((artifact) => artifact.level === 'chapter'),
    });
    markOutlineReviewRequired(novelId, linked.reviewRequired);
  }
  return { archivedIds, demotedIds, changed: true };
}

export function activateOutlineArtifactInTransaction(novelId: string, id: string): OutlineActivationResult {
  const result = activateOutlineArtifactInTransactionResult(novelId, id);
  return { archivedIds: result.archivedIds, demotedIds: result.demotedIds };
}

export function activateOutlineArtifact(novelId: string, id: string): OutlineActivationResult {
  const result = runInTransaction(() => activateOutlineArtifactInTransactionResult(novelId, id));
  if (result.changed) notify();
  return { archivedIds: result.archivedIds, demotedIds: result.demotedIds };
}

export function archiveOutlineArtifact(novelId: string, id: string): { archived: boolean } {
  const result = runInTransaction(() => {
    const target = getOutlineArtifact(id, novelId);
    if (!target) throw new OutlineError('OUTLINE_NOT_FOUND', 'outline not found');
    const artifacts = listOutlineArtifacts(novelId);
    assertOutlineMirrorIntegrity(novelId, artifacts);
    if (target.status === 'archived') return { archived: false, changed: false };
    getDb().prepare(
      "UPDATE outline_artifacts SET status = 'archived', updated_at = ? WHERE id = ? AND novel_id = ?",
    ).run(Date.now(), id, novelId);
    if (target.level === 'master' && target.status === 'active') {
      getDb().prepare("UPDATE novels SET global_outline = '', updated_at = ? WHERE id = ?").run(Date.now(), novelId);
    }
    return { archived: true, changed: true };
  });
  if (result.changed) notify();
  return { archived: result.archived };
}
