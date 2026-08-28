import { generateId } from '../../id.js';
import {
  notify,
  getDb,
  runInTransaction,
  getDatabaseGeneration,
  runInSerializedWriteForGeneration,
} from '../db-instance.js';
import { getNovel } from './novels.js';
import {
  activateOutlineArtifactInTransaction,
  assertOutlineMirrorIntegrity,
  createOutlineArtifactInTransaction,
  getOutlineArtifact,
  listOutlineArtifacts,
} from './outlines.js';
import { outlineCanonFingerprint } from '../../helpers/outline-fingerprint.js';
import { isStructuredOutlineCore } from '../../../shared/lib/outline-structure.js';
import type { CreativeArtifactRef } from '../../../shared/types/creative-artifacts.js';
import type {
  CanonPatch,
  CanonPatchOperation,
  OutlineArtifact,
  OutlineArtifactScope,
  SourceCapabilityVersion,
} from '../../../shared/types/outline-governance.js';

export class CanonPatchError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
  }
}

type PatchRow = {
  id: string;
  novel_id: string;
  base_fingerprint: string;
  source_ability_id: string | null;
  source_capability_versions: string | null;
  operations: string;
  status: CanonPatch['status'];
  result_fingerprint?: string | null;
  result_json?: string | null;
  created_at: number;
  updated_at: number;
  decided_at?: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function sourceCapabilityVersionsFor(value: unknown, stored: boolean): SourceCapabilityVersion[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => (
    !isRecord(entry)
    || !isNonEmptyString(entry.capabilityId)
    || !isNonEmptyString(entry.version)
  ))) {
    throw new CanonPatchError(stored ? 'CANON_PATCH_INVALID_DATA' : 'CANON_PATCH_INVALID_INPUT', 'source capability versions are invalid');
  }
  return value.map((entry) => ({
    capabilityId: (entry as SourceCapabilityVersion).capabilityId,
    version: (entry as SourceCapabilityVersion).version,
  }));
}

function scopeValid(level: 'volume' | 'chapter', scope: unknown): scope is OutlineArtifactScope {
  if (!isRecord(scope) || Object.keys(scope).some((key) => !['volumeName', 'chapterStart', 'chapterEnd'].includes(key))) return false;
  if (level === 'volume') {
    return isNonEmptyString(scope.volumeName) && scope.chapterStart === undefined && scope.chapterEnd === undefined;
  }
  return scope.volumeName === undefined
    && Number.isInteger(scope.chapterStart)
    && Number.isInteger(scope.chapterEnd)
    && Number(scope.chapterStart) >= 0
    && Number(scope.chapterEnd) >= Number(scope.chapterStart);
}

function operationValid(value: unknown): value is CanonPatchOperation {
  if (!isRecord(value) || !isNonEmptyString(value.operation) || !isNonEmptyString(value.content)) return false;
  if (value.core !== undefined && !isStructuredOutlineCore(value.core)) return false;
  if (value.operation === 'create-master-outline') return Object.keys(value).every((key) => ['operation', 'content', 'core'].includes(key));
  if (value.operation === 'replace-outline') {
    return isNonEmptyString(value.targetArtifactId)
      && Object.keys(value).every((key) => ['operation', 'targetArtifactId', 'content', 'core'].includes(key));
  }
  if (value.operation === 'create-scoped-outline') {
    return (value.level === 'volume' || value.level === 'chapter')
      && scopeValid(value.level, value.scope)
      && Object.keys(value).every((key) => ['operation', 'level', 'scope', 'content', 'core'].includes(key));
  }
  return false;
}

function parseOperations(raw: string, stored = true): readonly CanonPatchOperation[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(operationValid)) throw new Error();
    return parsed;
  } catch {
    throw new CanonPatchError(stored ? 'CANON_PATCH_INVALID_DATA' : 'CANON_PATCH_INVALID_INPUT', 'patch operations are invalid');
  }
}

function operationsFor(value: readonly CanonPatchOperation[]): readonly CanonPatchOperation[] {
  try {
    return parseOperations(JSON.stringify(value), false);
  } catch (error) {
    if (error instanceof CanonPatchError) throw error;
    throw new CanonPatchError('CANON_PATCH_INVALID_INPUT', 'patch operations are invalid');
  }
}

function rowToPatch(row: PatchRow): CanonPatch {
  let sourceCapabilityVersions: SourceCapabilityVersion[] | undefined;
  if (row.source_capability_versions !== null) {
    try {
      sourceCapabilityVersions = sourceCapabilityVersionsFor(JSON.parse(row.source_capability_versions), true);
    } catch (error) {
      if (error instanceof CanonPatchError) throw error;
      throw new CanonPatchError('CANON_PATCH_INVALID_DATA', 'source capability versions are invalid');
    }
  }
  return {
    id: row.id,
    novelId: row.novel_id,
    baseFingerprint: row.base_fingerprint,
    ...(row.source_ability_id ? { sourceAbilityId: row.source_ability_id } : {}),
    ...(sourceCapabilityVersions ? { sourceCapabilityVersions } : {}),
    operations: parseOperations(row.operations),
    status: row.status,
  };
}

function activeArtifacts(novelId: string): OutlineArtifact[] {
  return listOutlineArtifacts(novelId, { status: 'active' });
}

export function getCanonFingerprint(novelId: string): string {
  const novel = getNovel(novelId);
  if (!novel) throw new CanonPatchError('CANON_PATCH_NOVEL_NOT_FOUND', 'novel not found');
  const artifacts = activeArtifacts(novelId);
  assertOutlineMirrorIntegrity(novelId, artifacts);
  return outlineCanonFingerprint(novelId, novel.worldRules || '', artifacts);
}

export function createCanonPatch(input: {
  id?: string;
  novelId: string;
  baseFingerprint: string;
  sourceAbilityId?: string;
  sourceCapabilityVersions?: SourceCapabilityVersion[];
  operations: readonly CanonPatchOperation[];
}): CanonPatch {
  if (!getNovel(input.novelId)) throw new CanonPatchError('CANON_PATCH_NOVEL_NOT_FOUND', 'novel not found');
  if (!isNonEmptyString(input.baseFingerprint)) throw new CanonPatchError('CANON_PATCH_INVALID_INPUT', 'base fingerprint is required');
  const operations = operationsFor(input.operations);
  const sourceCapabilityVersions = sourceCapabilityVersionsFor(input.sourceCapabilityVersions, false);
  if (input.sourceAbilityId !== undefined && !isNonEmptyString(input.sourceAbilityId)) {
    throw new CanonPatchError('CANON_PATCH_INVALID_INPUT', 'source ability id is invalid');
  }
  const id = input.id || generateId();
  const now = Date.now();
  const result = runInTransaction(() => {
    getDb().prepare(`
      INSERT INTO canon_patches (
        id, novel_id, base_fingerprint, source_ability_id, source_capability_versions,
        operations, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      id,
      input.novelId,
      input.baseFingerprint,
      input.sourceAbilityId || null,
      sourceCapabilityVersions ? JSON.stringify(sourceCapabilityVersions) : null,
      JSON.stringify(operations),
      now,
      now,
    );
    return getCanonPatch(id, input.novelId)!;
  });
  notify();
  return result;
}

export function getCanonPatch(id: string, novelId: string): CanonPatch | undefined {
  const row = getDb().prepare('SELECT * FROM canon_patches WHERE id = ? AND novel_id = ?').get(id, novelId) as PatchRow | undefined;
  return row ? rowToPatch(row) : undefined;
}

export function listCanonPatches(novelId: string): CanonPatch[] {
  return (getDb().prepare('SELECT * FROM canon_patches WHERE novel_id = ? ORDER BY created_at ASC, id ASC').all(novelId) as PatchRow[]).map(rowToPatch);
}

interface PatchApplyResult {
  fingerprint: string;
  artifacts: string[];
  acceptedOutlineRefs: CreativeArtifactRef[];
}

function applyPatch(novelId: string, patch: CanonPatch): PatchApplyResult {
  const ids: string[] = [];
  const acceptedOutlineRefs: CreativeArtifactRef[] = [];
  const sourceCapabilityVersions = patch.sourceCapabilityVersions;
  for (const operation of patch.operations) {
    const active = activeArtifacts(novelId);
    let id: string;
    if (operation.operation === 'create-master-outline') {
      if (active.some((artifact) => artifact.level === 'master')) {
        throw new CanonPatchError('CANON_PATCH_CONFLICT', 'active master already exists');
      }
      id = `${patch.id}-master`;
      createOutlineArtifactInTransaction({
        id, novelId, level: 'master', scope: {}, content: operation.content,
        source: 'ai-proposal',
        ...(operation.core ? { core: operation.core } : {}),
        ...(sourceCapabilityVersions ? { sourceCapabilityVersions } : {}),
      });
    } else if (operation.operation === 'replace-outline') {
      const target = active.find((artifact) => artifact.id === operation.targetArtifactId);
      if (!target) throw new CanonPatchError('CANON_PATCH_CONFLICT', 'target outline is not active');
      id = `${patch.id}-${target.id}`;
      createOutlineArtifactInTransaction({
        id, novelId, level: target.level, scope: target.scope, content: operation.content,
        source: 'ai-proposal',
        ...(operation.core ? { core: operation.core } : {}),
        ...(sourceCapabilityVersions ? { sourceCapabilityVersions } : {}),
      });
    } else {
      if (!active.some((artifact) => artifact.level === 'master')) {
        throw new CanonPatchError('CANON_PATCH_CONFLICT', 'active master required');
      }
      if (!scopeValid(operation.level, operation.scope)) {
        throw new CanonPatchError('CANON_PATCH_INVALID_SCOPE', 'scope is invalid');
      }
      id = `${patch.id}-${operation.level}-${ids.length}`;
      createOutlineArtifactInTransaction({
        id,
        novelId,
        level: operation.level,
        scope: operation.scope,
        content: operation.content,
        source: 'ai-proposal',
        ...(operation.core ? { core: operation.core } : {}),
        ...(sourceCapabilityVersions ? { sourceCapabilityVersions } : {}),
      });
    }
    activateOutlineArtifactInTransaction(novelId, id);
    const accepted = getOutlineArtifact(id, novelId)!;
    ids.push(id);
    acceptedOutlineRefs.push({
      kind: accepted.level === 'master'
        ? 'master-outline'
        : accepted.level === 'volume'
          ? 'volume-outline'
          : 'chapter-outline',
      id: accepted.id,
      version: 1,
    });
  }
  return { fingerprint: getCanonFingerprint(novelId), artifacts: ids, acceptedOutlineRefs };
}

function storedAcceptedResult(row: PatchRow): Pick<PatchApplyResult, 'fingerprint' | 'artifacts' | 'acceptedOutlineRefs'> {
  let stored: Partial<PatchApplyResult> = {};
  try {
    stored = row.result_json ? JSON.parse(row.result_json) as Partial<PatchApplyResult> : {};
  } catch {
    // Legacy accepted rows do not lose their terminal state because a result detail is unreadable.
  }
  return {
    fingerprint: row.result_fingerprint || '',
    artifacts: Array.isArray(stored.artifacts) && stored.artifacts.every((id) => typeof id === 'string') ? stored.artifacts : [],
    acceptedOutlineRefs: Array.isArray(stored.acceptedOutlineRefs)
      ? stored.acceptedOutlineRefs.filter((ref): ref is CreativeArtifactRef => (
        isRecord(ref)
        && ['master-outline', 'volume-outline', 'chapter-outline'].includes(ref.kind as string)
        && isNonEmptyString(ref.id)
        && ref.version === 1
      ))
      : [],
  };
}

export async function acceptCanonPatch(
  novelId: string,
  patchId: string,
  generation = getDatabaseGeneration(),
): Promise<{
  status: CanonPatch['status'];
  fingerprint?: string;
  artifacts?: string[];
  acceptedOutlineRefs?: CreativeArtifactRef[];
}> {
  const guarded = await runInSerializedWriteForGeneration(generation, () => runInTransaction(() => {
    const row = getDb().prepare('SELECT * FROM canon_patches WHERE id = ? AND novel_id = ?').get(patchId, novelId) as PatchRow | undefined;
    if (!row) throw new CanonPatchError('CANON_PATCH_NOT_FOUND', 'patch not found');
    if (row.status === 'accepted') {
      const stored = storedAcceptedResult(row);
      return {
        status: row.status,
        ...(stored.fingerprint ? { fingerprint: stored.fingerprint } : {}),
        ...(stored.artifacts.length ? { artifacts: stored.artifacts } : {}),
        ...(stored.acceptedOutlineRefs.length ? { acceptedOutlineRefs: stored.acceptedOutlineRefs } : {}),
        changed: false,
      };
    }
    if (row.status !== 'pending') throw new CanonPatchError('CANON_PATCH_TERMINAL', 'patch is already terminal');
    const patch = rowToPatch(row);
    if (getCanonFingerprint(novelId) !== patch.baseFingerprint) {
      getDb().prepare(
        "UPDATE canon_patches SET status = 'stale', decided_at = ?, updated_at = ? WHERE id = ? AND novel_id = ? AND status = 'pending'",
      ).run(Date.now(), Date.now(), patchId, novelId);
      return { status: 'stale' as const, changed: true };
    }
    const result = applyPatch(novelId, patch);
    getDb().prepare(`
      UPDATE canon_patches
      SET status = 'accepted', result_fingerprint = ?, result_json = ?, decided_at = ?, updated_at = ?
      WHERE id = ? AND novel_id = ? AND status = 'pending'
    `).run(result.fingerprint, JSON.stringify(result), Date.now(), Date.now(), patchId, novelId);
    return { status: 'accepted' as const, ...result, changed: true };
  }));
  if (!guarded.executed) throw new CanonPatchError('CANON_PATCH_GENERATION_STALE', 'database generation changed');
  if (guarded.result.changed) notify();
  return {
    status: guarded.result.status,
    ...('fingerprint' in guarded.result ? { fingerprint: guarded.result.fingerprint } : {}),
    ...('artifacts' in guarded.result ? { artifacts: guarded.result.artifacts } : {}),
    ...('acceptedOutlineRefs' in guarded.result ? { acceptedOutlineRefs: guarded.result.acceptedOutlineRefs } : {}),
  };
}

export function rejectCanonPatch(novelId: string, patchId: string): { status: CanonPatch['status'] } {
  const result = runInTransaction(() => {
    const row = getDb().prepare('SELECT status FROM canon_patches WHERE id = ? AND novel_id = ?').get(patchId, novelId) as { status: CanonPatch['status'] } | undefined;
    if (!row) throw new CanonPatchError('CANON_PATCH_NOT_FOUND', 'patch not found');
    if (row.status === 'rejected') return { status: row.status, changed: false };
    if (row.status !== 'pending') throw new CanonPatchError('CANON_PATCH_TERMINAL', 'patch is already terminal');
    getDb().prepare(
      "UPDATE canon_patches SET status = 'rejected', decided_at = ?, updated_at = ? WHERE id = ? AND novel_id = ? AND status = 'pending'",
    ).run(Date.now(), Date.now(), patchId, novelId);
    return { status: 'rejected' as const, changed: true };
  });
  if (result.changed) notify();
  return { status: result.status };
}
