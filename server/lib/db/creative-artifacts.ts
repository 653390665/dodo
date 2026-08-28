import type {
  ArtifactCandidate,
  ArtifactDiff,
  ArtifactImpactReport,
  ArtifactOperation,
  CreativeArtifactKind,
  CreativeArtifactRef,
} from '../../../shared/types/creative-artifacts.js';
import { generateId } from '../../id.js';
import { getDb, notify, runInTransaction } from '../db-instance.js';

export type GovernedCoreKind = CreativeArtifactKind;
export type GenericCandidateKind = 'world' | 'character';

export interface StoredArtifactCore<T = unknown> {
  id: string;
  novelId: string;
  artifactKind: GovernedCoreKind;
  artifactId: string;
  version: number;
  core: T;
  readableContent?: string;
  provenance: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ArtifactReviewRequirement {
  id: string;
  novelId: string;
  artifactKind: CreativeArtifactKind;
  artifactId: string;
  artifactVersion: number;
  sourceCandidateId?: string;
  reason: string;
  status: 'review-required' | 'resolved';
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
}

export type CreativeArtifactPersistenceErrorCode =
  | 'CREATIVE_ARTIFACT_NOVEL_NOT_FOUND'
  | 'CREATIVE_ARTIFACT_INVALID_KIND'
  | 'CREATIVE_ARTIFACT_INVALID_INPUT'
  | 'CREATIVE_ARTIFACT_INVALID_DATA'
  | 'CREATIVE_ARTIFACT_VERSION_STALE'
  | 'CREATIVE_ARTIFACT_CANDIDATE_NOT_FOUND'
  | 'CREATIVE_ARTIFACT_CANDIDATE_TERMINAL'
  | 'CREATIVE_ARTIFACT_SOURCE_CANDIDATE_NOT_FOUND';

export class CreativeArtifactPersistenceError extends Error {
  constructor(public readonly code: CreativeArtifactPersistenceErrorCode, message: string) {
    super(`${code}: ${message}`);
  }
}

type CoreRow = {
  id: string;
  novel_id: string;
  artifact_kind: string;
  artifact_id: string;
  version: number;
  core_json: string;
  readable_content: string | null;
  provenance_json: string;
  created_at: number;
  updated_at: number;
};

type CandidateRow = {
  id: string;
  novel_id: string;
  artifact_kind: string;
  artifact_id: string;
  target_version: number;
  operation: string;
  goal: string;
  base_fingerprint: string;
  source_capability_versions: string;
  proposed_core: string;
  proposed_content: string | null;
  diff: string;
  impact_report: string;
  status: string;
  created_at: number;
  updated_at: number;
  decided_at: number | null;
};

type ReviewRow = {
  id: string;
  novel_id: string;
  artifact_kind: string;
  artifact_id: string;
  artifact_version: number;
  source_candidate_id: string | null;
  reason: string;
  status: string;
  created_at: number;
  updated_at: number;
  resolved_at: number | null;
};

const ARTIFACT_KINDS: readonly CreativeArtifactKind[] = [
  'world',
  'character',
  'master-outline',
  'volume-outline',
  'chapter-outline',
  'scene-beats',
  'narrative-promise',
];
const CANDIDATE_KINDS: readonly GenericCandidateKind[] = ['world', 'character'];
const OPERATIONS: readonly ArtifactOperation[] = ['diagnose', 'generate', 'restructure', 'optimize', 'validate'];
const CANDIDATE_STATUSES: readonly ArtifactCandidate['status'][] = ['pending', 'accepted', 'rejected', 'stale'];
const REVIEW_STATUSES: readonly ArtifactReviewRequirement['status'][] = ['review-required', 'resolved'];

function invalidInput(message: string): never {
  throw new CreativeArtifactPersistenceError('CREATIVE_ARTIFACT_INVALID_INPUT', message);
}

function invalidData(message: string): never {
  throw new CreativeArtifactPersistenceError('CREATIVE_ARTIFACT_INVALID_DATA', message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isArtifactKind(value: unknown): value is CreativeArtifactKind {
  return typeof value === 'string' && ARTIFACT_KINDS.includes(value as CreativeArtifactKind);
}

function isCandidateKind(value: unknown): value is GenericCandidateKind {
  return typeof value === 'string' && CANDIDATE_KINDS.includes(value as GenericCandidateKind);
}

function isOperation(value: unknown): value is ArtifactOperation {
  return typeof value === 'string' && OPERATIONS.includes(value as ArtifactOperation);
}

function isCandidateStatus(value: unknown): value is ArtifactCandidate['status'] {
  return typeof value === 'string' && CANDIDATE_STATUSES.includes(value as ArtifactCandidate['status']);
}

function assertArtifactKind(value: unknown, stored = false): asserts value is CreativeArtifactKind {
  if (!isArtifactKind(value)) {
    if (stored) invalidData('stored artifact kind is invalid');
    throw new CreativeArtifactPersistenceError('CREATIVE_ARTIFACT_INVALID_KIND', 'artifact kind is invalid');
  }
}

function assertCandidateKind(value: unknown, stored = false): asserts value is GenericCandidateKind {
  if (!isCandidateKind(value)) {
    if (stored) invalidData('stored candidate kind is invalid');
    throw new CreativeArtifactPersistenceError('CREATIVE_ARTIFACT_INVALID_KIND', 'candidate kind is invalid');
  }
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return invalidData(`${label} is invalid JSON`);
  }
}

function parseObject(raw: string, label: string): Record<string, unknown> {
  const value = parseJson(raw, label);
  if (!isPlainObject(value)) invalidData(`${label} must be an object`);
  return value;
}

function isArtifactRef(value: unknown, allowZero: boolean): value is CreativeArtifactRef {
  if (!isPlainObject(value) || !isArtifactKind(value.kind) || !isNonEmptyString(value.id)) return false;
  return Number.isInteger(value.version) && (allowZero ? (value.version as number) >= 0 : (value.version as number) > 0);
}

function isSourceCapabilityVersions(value: unknown): value is ArtifactCandidate['sourceCapabilityVersions'] {
  return Array.isArray(value) && value.every((item) => (
    isPlainObject(item)
    && isNonEmptyString(item.capabilityId)
    && isNonEmptyString(item.version)
  ));
}

function isDiff(value: unknown): value is ArtifactDiff {
  return isPlainObject(value)
    && typeof value.changed === 'boolean'
    && Array.isArray(value.fields)
    && value.fields.every((field) => (
      isPlainObject(field)
      && isNonEmptyString(field.path)
      && ['added', 'removed', 'changed'].includes(field.kind as string)
    ));
}

function isImpactReport(value: unknown): value is ArtifactImpactReport {
  return isPlainObject(value)
    && Array.isArray(value.downstream)
    && value.downstream.every((ref) => isArtifactRef(ref, false))
    && Array.isArray(value.reviewRequired)
    && value.reviewRequired.every((ref) => isArtifactRef(ref, false))
    && (value.affectedEntities === undefined || (
      Array.isArray(value.affectedEntities)
      && value.affectedEntities.every((ref) => isPlainObject(ref)
        && (ref.kind === 'relationship' || ref.kind === 'narrative-promise')
        && isNonEmptyString(ref.id)
        && typeof ref.reviewRequired === 'boolean')
    ))
    && typeof value.manuscriptConflict === 'boolean'
    && Array.isArray(value.reasons)
    && value.reasons.every((reason) => typeof reason === 'string');
}

function stringifyObject(value: unknown, label: string): string {
  if (!isPlainObject(value)) invalidInput(`${label} must be an object`);
  try {
    return JSON.stringify(value);
  } catch {
    return invalidInput(`${label} must be JSON serializable`);
  }
}

function stringifyValue(value: unknown, label: string): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return invalidInput(`${label} must be JSON serializable`);
    return serialized;
  } catch {
    return invalidInput(`${label} must be JSON serializable`);
  }
}

function assertNovelExists(novelId: string): void {
  if (!getDb().prepare('SELECT 1 FROM novels WHERE id = ?').get(novelId)) {
    throw new CreativeArtifactPersistenceError('CREATIVE_ARTIFACT_NOVEL_NOT_FOUND', 'novel not found');
  }
}

function rowToCore(row: CoreRow): StoredArtifactCore {
  assertArtifactKind(row.artifact_kind, true);
  if (!Number.isInteger(row.version) || row.version <= 0) invalidData('stored core version is invalid');
  if (!isNonEmptyString(row.id) || !isNonEmptyString(row.novel_id) || !isNonEmptyString(row.artifact_id)) {
    invalidData('stored core identity is invalid');
  }
  if (row.readable_content !== null && typeof row.readable_content !== 'string') invalidData('stored readable content is invalid');
  if (!Number.isInteger(row.created_at) || !Number.isInteger(row.updated_at)) invalidData('stored core timestamps are invalid');
  return {
    id: row.id,
    novelId: row.novel_id,
    artifactKind: row.artifact_kind,
    artifactId: row.artifact_id,
    version: row.version,
    core: parseObject(row.core_json, 'stored core'),
    ...(row.readable_content === null ? {} : { readableContent: row.readable_content }),
    provenance: parseObject(row.provenance_json, 'stored provenance'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCandidate(row: CandidateRow): ArtifactCandidate {
  assertCandidateKind(row.artifact_kind, true);
  if (!Number.isInteger(row.target_version) || row.target_version < 0) invalidData('stored candidate version is invalid');
  if (!isOperation(row.operation)) invalidData('stored candidate operation is invalid');
  if (!isCandidateStatus(row.status)) invalidData('stored candidate status is invalid');
  if (!isNonEmptyString(row.id) || !isNonEmptyString(row.novel_id) || !isNonEmptyString(row.artifact_id)) {
    invalidData('stored candidate identity is invalid');
  }
  if (typeof row.goal !== 'string' || typeof row.base_fingerprint !== 'string') invalidData('stored candidate text is invalid');
  if (row.proposed_content !== null && typeof row.proposed_content !== 'string') invalidData('stored candidate content is invalid');

  const sourceCapabilityVersions = parseJson(row.source_capability_versions, 'stored source capability versions');
  const proposedCore = parseObject(row.proposed_core, 'stored proposed core');
  const diff = parseJson(row.diff, 'stored candidate diff');
  const impactReport = parseJson(row.impact_report, 'stored candidate impact report');
  if (!isSourceCapabilityVersions(sourceCapabilityVersions)) invalidData('stored source capability versions are invalid');
  if (!isDiff(diff)) invalidData('stored candidate diff is invalid');
  if (!isImpactReport(impactReport)) invalidData('stored candidate impact report is invalid');

  return {
    id: row.id,
    novelId: row.novel_id,
    target: { kind: row.artifact_kind, id: row.artifact_id, version: row.target_version },
    operation: row.operation,
    goal: row.goal,
    baseFingerprint: row.base_fingerprint,
    sourceCapabilityVersions,
    proposedCore,
    ...(row.proposed_content === null ? {} : { proposedContent: row.proposed_content }),
    diff,
    impactReport,
    status: row.status,
  };
}

function rowToReviewRequirement(row: ReviewRow): ArtifactReviewRequirement {
  assertArtifactKind(row.artifact_kind, true);
  if (!Number.isInteger(row.artifact_version) || row.artifact_version <= 0) invalidData('stored review version is invalid');
  if (!REVIEW_STATUSES.includes(row.status as ArtifactReviewRequirement['status'])) invalidData('stored review status is invalid');
  if (!isNonEmptyString(row.id) || !isNonEmptyString(row.novel_id) || !isNonEmptyString(row.artifact_id)) {
    invalidData('stored review identity is invalid');
  }
  if (typeof row.reason !== 'string') invalidData('stored review reason is invalid');
  if (!Number.isInteger(row.created_at) || !Number.isInteger(row.updated_at)) invalidData('stored review timestamps are invalid');
  if (row.resolved_at !== null && !Number.isInteger(row.resolved_at)) invalidData('stored review decision time is invalid');
  return {
    id: row.id,
    novelId: row.novel_id,
    artifactKind: row.artifact_kind,
    artifactId: row.artifact_id,
    artifactVersion: row.artifact_version,
    ...(row.source_candidate_id === null ? {} : { sourceCandidateId: row.source_candidate_id }),
    reason: row.reason,
    status: row.status as ArtifactReviewRequirement['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.resolved_at === null ? {} : { resolvedAt: row.resolved_at }),
  };
}

export function getArtifactCore(
  novelId: string,
  artifactKind: CreativeArtifactKind,
  artifactId: string,
): StoredArtifactCore | undefined {
  assertArtifactKind(artifactKind);
  if (!isNonEmptyString(novelId) || !isNonEmptyString(artifactId)) invalidInput('artifact identity is required');
  const row = getDb().prepare(`
    SELECT * FROM creative_artifact_cores
    WHERE novel_id = ? AND artifact_kind = ? AND artifact_id = ?
  `).get(novelId, artifactKind, artifactId) as CoreRow | undefined;
  return row ? rowToCore(row) : undefined;
}

export function listArtifactCores(
  novelId: string,
  artifactKind: GenericCandidateKind,
): StoredArtifactCore[] {
  if (!isNonEmptyString(novelId)) invalidInput('novel identity is required');
  assertCandidateKind(artifactKind);
  const rows = getDb().prepare(`
    SELECT * FROM creative_artifact_cores
    WHERE novel_id = ? AND artifact_kind = ?
    ORDER BY updated_at DESC
  `).all(novelId, artifactKind) as CoreRow[];
  return rows.map(rowToCore);
}

export function saveArtifactVersion(input: {
  novelId: string;
  artifactKind: CreativeArtifactKind;
  artifactId: string;
  expectedVersion?: number;
  core: unknown;
  readableContent?: string;
  provenance: Record<string, unknown>;
}): StoredArtifactCore {
  assertArtifactKind(input.artifactKind);
  if (!isNonEmptyString(input.novelId) || !isNonEmptyString(input.artifactId)) invalidInput('artifact identity is required');
  if (input.expectedVersion !== undefined && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0)) {
    invalidInput('expected version must be a non-negative integer');
  }
  if (input.readableContent !== undefined && typeof input.readableContent !== 'string') invalidInput('readable content must be a string');
  const coreJson = stringifyObject(input.core, 'core');
  const provenanceJson = stringifyObject(input.provenance, 'provenance');

  const result = runInTransaction(() => {
    assertNovelExists(input.novelId);
    const current = getDb().prepare(`
      SELECT * FROM creative_artifact_cores
      WHERE novel_id = ? AND artifact_kind = ? AND artifact_id = ?
    `).get(input.novelId, input.artifactKind, input.artifactId) as CoreRow | undefined;
    if (current) rowToCore(current);
    const currentVersion = current?.version ?? 0;
    const expectedMatches = current
      ? input.expectedVersion === currentVersion
      : input.expectedVersion === undefined || input.expectedVersion === 0;
    if (!expectedMatches) {
      throw new CreativeArtifactPersistenceError('CREATIVE_ARTIFACT_VERSION_STALE', 'expected version does not match current version');
    }

    const now = Date.now();
    const version = currentVersion + 1;
    getDb().prepare(`
      INSERT INTO creative_artifact_versions (
        id, novel_id, artifact_kind, artifact_id, version, core_json,
        readable_content, provenance_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      generateId(), input.novelId, input.artifactKind, input.artifactId, version,
      coreJson, input.readableContent ?? null, provenanceJson, now,
    );

    if (current) {
      getDb().prepare(`
        UPDATE creative_artifact_cores
        SET version = ?, core_json = ?, readable_content = ?, provenance_json = ?, updated_at = ?
        WHERE id = ?
      `).run(version, coreJson, input.readableContent ?? null, provenanceJson, now, current.id);
    } else {
      getDb().prepare(`
        INSERT INTO creative_artifact_cores (
          id, novel_id, artifact_kind, artifact_id, version, core_json,
          readable_content, provenance_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        generateId(), input.novelId, input.artifactKind, input.artifactId, version,
        coreJson, input.readableContent ?? null, provenanceJson, now, now,
      );
    }
    return getArtifactCore(input.novelId, input.artifactKind, input.artifactId)!;
  });
  notify();
  return result;
}

export function createArtifactCandidate<T>(
  input: Omit<ArtifactCandidate<T>, 'status'>,
): ArtifactCandidate<T> {
  assertCandidateKind(input.target?.kind);
  if (!isNonEmptyString(input.id) || !isNonEmptyString(input.novelId) || !isNonEmptyString(input.target.id)) {
    invalidInput('candidate identity is required');
  }
  if (!Number.isInteger(input.target.version) || input.target.version < 0) invalidInput('candidate target version is invalid');
  if (!isOperation(input.operation)) invalidInput('candidate operation is invalid');
  if (typeof input.goal !== 'string' || typeof input.baseFingerprint !== 'string') invalidInput('candidate text is invalid');
  if (input.proposedContent !== undefined && typeof input.proposedContent !== 'string') invalidInput('proposed content is invalid');
  if (!isSourceCapabilityVersions(input.sourceCapabilityVersions)) invalidInput('source capability versions are invalid');
  if (!isPlainObject(input.proposedCore)) invalidInput('proposed core must be an object');
  if (!isDiff(input.diff)) invalidInput('candidate diff is invalid');
  if (!isImpactReport(input.impactReport)) invalidInput('candidate impact report is invalid');

  const sourceCapabilityVersions = stringifyValue(input.sourceCapabilityVersions, 'source capability versions');
  const proposedCore = stringifyObject(input.proposedCore, 'proposed core');
  const diff = stringifyObject(input.diff, 'candidate diff');
  const impactReport = stringifyObject(input.impactReport, 'candidate impact report');
  const result = runInTransaction(() => {
    assertNovelExists(input.novelId);
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO creative_artifact_candidates (
        id, novel_id, artifact_kind, artifact_id, target_version, operation,
        goal, base_fingerprint, source_capability_versions, proposed_core,
        proposed_content, diff, impact_report, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      input.id, input.novelId, input.target.kind, input.target.id, input.target.version,
      input.operation, input.goal, input.baseFingerprint, sourceCapabilityVersions,
      proposedCore, input.proposedContent ?? null, diff, impactReport, now, now,
    );
    return getArtifactCandidate(input.novelId, input.id) as ArtifactCandidate<T>;
  });
  notify();
  return result;
}

export function getArtifactCandidate(
  novelId: string,
  candidateId: string,
): ArtifactCandidate | undefined {
  if (!isNonEmptyString(novelId) || !isNonEmptyString(candidateId)) invalidInput('candidate identity is required');
  const row = getDb().prepare(`
    SELECT * FROM creative_artifact_candidates WHERE novel_id = ? AND id = ?
  `).get(novelId, candidateId) as CandidateRow | undefined;
  return row ? rowToCandidate(row) : undefined;
}

export function listArtifactCandidates(
  novelId: string,
  filters: { artifactKind?: GenericCandidateKind; status?: ArtifactCandidate['status'] } = {},
): ArtifactCandidate[] {
  if (!isNonEmptyString(novelId)) invalidInput('novel identity is required');
  if (filters.artifactKind !== undefined) assertCandidateKind(filters.artifactKind);
  if (filters.status !== undefined && !isCandidateStatus(filters.status)) invalidInput('candidate status is invalid');
  const conditions = ['novel_id = ?'];
  const values: string[] = [novelId];
  if (filters.artifactKind !== undefined) {
    conditions.push('artifact_kind = ?');
    values.push(filters.artifactKind);
  }
  if (filters.status !== undefined) {
    conditions.push('status = ?');
    values.push(filters.status);
  }
  return (getDb().prepare(`
    SELECT * FROM creative_artifact_candidates
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at ASC, id ASC
  `).all(...values) as CandidateRow[]).map(rowToCandidate);
}

export function applyArtifactCandidateDecision(
  novelId: string,
  candidateId: string,
  decision: 'accepted' | 'rejected' | 'stale',
): ArtifactCandidate {
  if (!isNonEmptyString(novelId) || !isNonEmptyString(candidateId)) invalidInput('candidate identity is required');
  if (!['accepted', 'rejected', 'stale'].includes(decision)) invalidInput('candidate decision is invalid');
  const result = runInTransaction(() => {
    const row = getDb().prepare(`
      SELECT * FROM creative_artifact_candidates WHERE novel_id = ? AND id = ?
    `).get(novelId, candidateId) as CandidateRow | undefined;
    if (!row) {
      throw new CreativeArtifactPersistenceError('CREATIVE_ARTIFACT_CANDIDATE_NOT_FOUND', 'candidate not found');
    }
    const candidate = rowToCandidate(row);
    if (candidate.status === decision) return { candidate, changed: false };
    if (candidate.status !== 'pending') {
      throw new CreativeArtifactPersistenceError('CREATIVE_ARTIFACT_CANDIDATE_TERMINAL', 'candidate is already terminal');
    }
    const now = Date.now();
    getDb().prepare(`
      UPDATE creative_artifact_candidates
      SET status = ?, updated_at = ?, decided_at = ?
      WHERE novel_id = ? AND id = ? AND status = 'pending'
    `).run(decision, now, now, novelId, candidateId);
    return { candidate: getArtifactCandidate(novelId, candidateId)!, changed: true };
  });
  if (result.changed) notify();
  return result.candidate;
}

export function markArtifactReviewRequired(input: {
  novelId: string;
  artifact: CreativeArtifactRef;
  sourceCandidateId?: string;
  reason: string;
}): ArtifactReviewRequirement {
  assertArtifactKind(input.artifact?.kind);
  if (!isNonEmptyString(input.novelId) || !isNonEmptyString(input.artifact.id)) invalidInput('review identity is required');
  if (!Number.isInteger(input.artifact.version) || input.artifact.version <= 0) invalidInput('review artifact version is invalid');
  if (input.sourceCandidateId !== undefined && !isNonEmptyString(input.sourceCandidateId)) invalidInput('source candidate identity is invalid');
  if (!isNonEmptyString(input.reason)) invalidInput('review reason is required');

  const result = runInTransaction(() => {
    assertNovelExists(input.novelId);
    if (input.sourceCandidateId && !getDb().prepare(`
      SELECT 1 FROM creative_artifact_candidates WHERE novel_id = ? AND id = ?
    `).get(input.novelId, input.sourceCandidateId)) {
      throw new CreativeArtifactPersistenceError(
        'CREATIVE_ARTIFACT_SOURCE_CANDIDATE_NOT_FOUND',
        'source candidate not found for novel',
      );
    }
    const id = generateId();
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO artifact_review_requirements (
        id, novel_id, artifact_kind, artifact_id, artifact_version,
        source_candidate_id, reason, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'review-required', ?, ?)
    `).run(
      id, input.novelId, input.artifact.kind, input.artifact.id, input.artifact.version,
      input.sourceCandidateId ?? null, input.reason, now, now,
    );
    const row = getDb().prepare('SELECT * FROM artifact_review_requirements WHERE id = ?').get(id) as ReviewRow;
    return rowToReviewRequirement(row);
  });
  notify();
  return result;
}
