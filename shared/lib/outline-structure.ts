import type {
  OutlineArtifact,
  OutlineArtifactLevel,
  OutlineArtifactScope,
  StructuredOutlineCore,
} from '../types/outline-governance.js';

const NODE_TYPES = new Set([
  'premise', 'conflict', 'turn', 'climax', 'resolution', 'character-arc', 'foreshadowing',
]);
const PROMISE_ACTIONS = new Set(['plant', 'hint', 'payoff']);

export type OutlineValidationIssueCode =
  | 'OUTLINE_CORE_INVALID'
  | 'OUTLINE_SCOPE_INVALID'
  | 'OUTLINE_SCOPE_OVERLAP'
  | 'OUTLINE_NODE_ID_REQUIRED'
  | 'OUTLINE_NODE_ID_DUPLICATE'
  | 'OUTLINE_NODE_ORDER_INVALID'
  | 'OUTLINE_NODE_ORDER_DUPLICATE'
  | 'OUTLINE_MASTER_PARENT_FORBIDDEN'
  | 'OUTLINE_UPSTREAM_PARENT_REQUIRED'
  | 'OUTLINE_UPSTREAM_NODE_MISSING'
  | 'OUTLINE_CHARACTER_MISSING'
  | 'OUTLINE_FORESHADOWING_MISSING'
  | 'OUTLINE_PROMISE_NOT_FOUND'
  | 'OUTLINE_PROMISE_RANGE_INVALID'
  | 'OUTLINE_PROMISE_PAYOFF_PREMATURE';

export interface OutlineValidationIssue {
  code: OutlineValidationIssueCode;
  detail: string;
}

export interface OutlineHierarchyValidationInput {
  artifact: Pick<OutlineArtifact, 'id' | 'level' | 'scope' | 'core'>;
  upstreamNodeIds?: readonly string[];
  siblingScopes?: readonly Pick<OutlineArtifact, 'id' | 'level' | 'scope'>[];
  characterIds?: readonly string[];
  foreshadowings?: ReadonlyArray<{
    id: string;
    plannedPayoffRange?: { from: number; to: number };
  }>;
}

export interface OutlineHierarchyValidationResult {
  ok: boolean;
  issues: OutlineValidationIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isChapterRange(value: unknown): value is { from: number; to: number } {
  return isRecord(value)
    && Number.isInteger(value.from)
    && Number.isInteger(value.to)
    && Number(value.from) >= 0
    && Number(value.to) >= Number(value.from);
}

function isOutlineScope(level: OutlineArtifactLevel, scope: unknown): scope is OutlineArtifactScope {
  if (!isRecord(scope) || Object.keys(scope).some((key) => !['volumeName', 'chapterStart', 'chapterEnd'].includes(key))) return false;
  if (level === 'master') return Object.keys(scope).length === 0;
  if (level === 'volume') return isNonEmptyString(scope.volumeName) && scope.chapterStart === undefined && scope.chapterEnd === undefined;
  return scope.volumeName === undefined && isChapterRange({ from: scope.chapterStart, to: scope.chapterEnd });
}

function isOutlineNode(value: unknown): boolean {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || (value.parentNodeId !== undefined && typeof value.parentNodeId !== 'string')
    || !NODE_TYPES.has(value.type as string)
    || typeof value.title !== 'string'
    || typeof value.intent !== 'string'
    || typeof value.order !== 'number'
    || !Array.isArray(value.characterIds)
    || !value.characterIds.every((characterId) => typeof characterId === 'string')
    || !Array.isArray(value.foreshadowingIds)
    || !value.foreshadowingIds.every((foreshadowingId) => typeof foreshadowingId === 'string')) return false;
  return true;
}

function isPromiseAction(value: unknown): boolean {
  return isRecord(value)
    && typeof value.foreshadowingId === 'string'
    && PROMISE_ACTIONS.has(value.action as string)
    && (value.chapterRange === undefined || (isRecord(value.chapterRange)
      && Number.isInteger(value.chapterRange.from)
      && Number.isInteger(value.chapterRange.to)));
}

export function isStructuredOutlineCore(value: unknown): value is StructuredOutlineCore {
  return isRecord(value)
    && value.schemaVersion === 1
    && Array.isArray(value.nodes)
    && value.nodes.every(isOutlineNode)
    && (value.promiseActions === undefined || (Array.isArray(value.promiseActions) && value.promiseActions.every(isPromiseAction)));
}

function scopeIssue(
  artifact: OutlineHierarchyValidationInput['artifact'],
  siblings: readonly Pick<OutlineArtifact, 'id' | 'level' | 'scope'>[],
): OutlineValidationIssue | undefined {
  if (!isOutlineScope(artifact.level, artifact.scope)) {
    return { code: 'OUTLINE_SCOPE_INVALID', detail: `${artifact.level} scope is invalid` };
  }
  for (const sibling of siblings) {
    if (sibling.id === artifact.id || sibling.level !== artifact.level || !isOutlineScope(sibling.level, sibling.scope)) continue;
    if (artifact.level === 'volume') {
      if (artifact.scope.volumeName?.trim() === sibling.scope.volumeName?.trim()) continue;
      continue;
    }
    if (artifact.level !== 'chapter') continue;
    if (artifact.scope.chapterStart === sibling.scope.chapterStart && artifact.scope.chapterEnd === sibling.scope.chapterEnd) continue;
    if ((artifact.scope.chapterStart as number) <= (sibling.scope.chapterEnd as number)
      && (sibling.scope.chapterStart as number) <= (artifact.scope.chapterEnd as number)) {
      return { code: 'OUTLINE_SCOPE_OVERLAP', detail: `chapter range overlaps active sibling ${sibling.id}` };
    }
  }
  return undefined;
}

export function validateOutlineHierarchy(input: OutlineHierarchyValidationInput): OutlineHierarchyValidationResult {
  const issues: OutlineValidationIssue[] = [];
  const scope = scopeIssue(input.artifact, input.siblingScopes || []);
  if (scope) issues.push(scope);
  const core = input.artifact.core;
  if (core === undefined) return { ok: issues.length === 0, issues };
  if (!isStructuredOutlineCore(core)) {
    issues.push({ code: 'OUTLINE_CORE_INVALID', detail: 'structured outline core is invalid' });
    return { ok: false, issues };
  }

  const nodeIds = new Set<string>();
  const orders = new Set<number>();
  for (const node of core.nodes) {
    if (!isNonEmptyString(node.id)) issues.push({ code: 'OUTLINE_NODE_ID_REQUIRED', detail: 'outline node id is required' });
    else if (nodeIds.has(node.id)) issues.push({ code: 'OUTLINE_NODE_ID_DUPLICATE', detail: `duplicate outline node id ${node.id}` });
    else nodeIds.add(node.id);
    if (!Number.isInteger(node.order) || node.order < 0) issues.push({ code: 'OUTLINE_NODE_ORDER_INVALID', detail: `node ${node.id} has an invalid order` });
    else if (orders.has(node.order)) issues.push({ code: 'OUTLINE_NODE_ORDER_DUPLICATE', detail: `duplicate outline node order ${node.order}` });
    else orders.add(node.order);
  }

  const upstream = new Set(input.upstreamNodeIds || []);
  const characters = new Set(input.characterIds || []);
  const promises = new Map((input.foreshadowings || []).map((promise) => [promise.id, promise]));
  for (const node of core.nodes) {
    if (input.artifact.level === 'master') {
      if (node.parentNodeId !== undefined) {
        issues.push({ code: 'OUTLINE_MASTER_PARENT_FORBIDDEN', detail: `master node ${node.id} cannot reference an upstream parent` });
      }
    } else if (!node.parentNodeId) {
      issues.push({ code: 'OUTLINE_UPSTREAM_PARENT_REQUIRED', detail: `node ${node.id} must reference an upstream parent` });
    } else if (!upstream.has(node.parentNodeId)) {
      issues.push({ code: 'OUTLINE_UPSTREAM_NODE_MISSING', detail: `node ${node.id} references missing upstream node ${node.parentNodeId}` });
    }
    for (const characterId of node.characterIds) {
      if (!characters.has(characterId)) issues.push({ code: 'OUTLINE_CHARACTER_MISSING', detail: `node ${node.id} references missing character ${characterId}` });
    }
    for (const foreshadowingId of node.foreshadowingIds) {
      if (!promises.has(foreshadowingId)) issues.push({ code: 'OUTLINE_FORESHADOWING_MISSING', detail: `node ${node.id} references missing foreshadowing ${foreshadowingId}` });
    }
  }

  for (const action of core.promiseActions || []) {
    const promise = promises.get(action.foreshadowingId);
    if (!promise) {
      issues.push({ code: 'OUTLINE_PROMISE_NOT_FOUND', detail: `promise action references missing foreshadowing ${action.foreshadowingId}` });
    }
    if (action.chapterRange !== undefined && !isChapterRange(action.chapterRange)) {
      issues.push({ code: 'OUTLINE_PROMISE_RANGE_INVALID', detail: `promise action ${action.foreshadowingId} has an invalid chapter range` });
      continue;
    }
    if (action.action === 'payoff' && action.chapterRange && promise?.plannedPayoffRange
      && action.chapterRange.to < promise.plannedPayoffRange.from) {
      issues.push({ code: 'OUTLINE_PROMISE_PAYOFF_PREMATURE', detail: `payoff for ${action.foreshadowingId} precedes its planned payoff range` });
    }
  }
  return { ok: issues.length === 0, issues };
}
