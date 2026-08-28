import type {
  CreationFlowDefinition,
  CreationFlowDefinitionDraft,
  CreationFlowMigrationCandidate,
  CreationFlowReadiness,
  CreationFlowSession,
  CreationFlowStep,
  CreativeArtifactKind,
  CreativeArtifactRef,
} from '../../../shared/types.js';
import { capabilityManifestFor } from '../../capabilities/manifest.js';
import { generateId } from '../../id.js';
import { getArtifactCore } from './creative-artifacts.js';
import { getOutlineArtifact } from './outlines.js';
import { getDb, getDatabaseGeneration, notify, runInTransaction } from '../db-instance.js';

const ARTIFACT_KINDS: readonly CreativeArtifactKind[] = [
  'world',
  'character',
  'master-outline',
  'volume-outline',
  'chapter-outline',
  'scene-beats',
];

type FlowRow = {
  id: string;
  novel_id: string;
  flow_id: string;
  frozen_definition_json: string;
  current_step_id: string | null;
  accepted_output_refs_json: string;
  status: string;
  database_generation: number;
  created_at: number;
  updated_at: number;
};

export type CreationFlowErrorCode =
  | 'CREATION_FLOW_INVALID_INPUT'
  | 'CREATION_FLOW_INVALID_DATA'
  | 'CREATION_FLOW_NOVEL_NOT_FOUND'
  | 'CREATION_FLOW_NOT_FOUND'
  | 'CREATION_FLOW_ACTIVE_EXISTS'
  | 'CREATION_FLOW_CAPABILITY_NOT_FOUND'
  | 'CREATION_FLOW_CAPABILITY_INCOMPATIBLE'
  | 'CREATION_FLOW_PREREQUISITES_MISSING'
  | 'CREATION_FLOW_OUTPUT_KIND_MISMATCH'
  | 'CREATION_FLOW_OUTPUT_NOT_ACCEPTED'
  | 'CREATION_FLOW_OUTPUT_CAPABILITY_MISMATCH'
  | 'CREATION_FLOW_SESSION_TERMINAL'
  | 'CREATION_FLOW_GENERATION_STALE';

export class CreationFlowError extends Error {
  constructor(
    public readonly code: CreationFlowErrorCode,
    message: string,
    public readonly missingArtifactKinds?: CreativeArtifactKind[],
  ) {
    super(`${code}: ${message}`);
  }
}

function invalidInput(message: string): never {
  throw new CreationFlowError('CREATION_FLOW_INVALID_INPUT', message);
}

function invalidData(message: string): never {
  throw new CreationFlowError('CREATION_FLOW_INVALID_DATA', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isArtifactKind(value: unknown): value is CreativeArtifactKind {
  return typeof value === 'string' && ARTIFACT_KINDS.includes(value as CreativeArtifactKind);
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return invalidData(`${label} JSON is invalid`);
  }
}

function parseArtifactRef(value: unknown): CreativeArtifactRef {
  if (!isRecord(value) || !isArtifactKind(value.kind) || !isNonEmptyString(value.id)
    || !Number.isInteger(value.version) || Number(value.version) <= 0) {
    return invalidData('stored artifact reference is invalid');
  }
  return { kind: value.kind, id: value.id, version: Number(value.version) };
}

function parseStep(value: unknown): CreationFlowStep {
  if (!isRecord(value)
    || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.capabilityId)
    || !isNonEmptyString(value.capabilityVersion)
    || !Array.isArray(value.dependsOn)
    || !value.dependsOn.every(isNonEmptyString)
    || !Array.isArray(value.requiredArtifactKinds)
    || !value.requiredArtifactKinds.every(isArtifactKind)
    || !isArtifactKind(value.producedArtifactKind)
    || typeof value.required !== 'boolean') {
    return invalidData('stored flow step is invalid');
  }
  return {
    id: value.id,
    capabilityId: value.capabilityId,
    capabilityVersion: value.capabilityVersion,
    dependsOn: [...value.dependsOn],
    requiredArtifactKinds: [...value.requiredArtifactKinds],
    producedArtifactKind: value.producedArtifactKind,
    required: value.required,
  };
}

function parseDefinition(value: unknown): CreationFlowDefinition {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.version)
    || !Array.isArray(value.steps) || value.steps.length === 0) {
    return invalidData('stored flow definition is invalid');
  }
  return { id: value.id, version: value.version, steps: value.steps.map(parseStep) };
}

function rowToSession(row: FlowRow): CreationFlowSession {
  if (!isNonEmptyString(row.id) || !isNonEmptyString(row.novel_id) || !isNonEmptyString(row.flow_id)
    || !['active', 'completed'].includes(row.status)
    || !Number.isInteger(row.database_generation)
    || !Number.isInteger(row.created_at)
    || !Number.isInteger(row.updated_at)) {
    return invalidData('stored flow session is invalid');
  }
  const definition = parseDefinition(parseJson(row.frozen_definition_json, 'flow definition'));
  if (definition.id !== row.flow_id) invalidData('stored flow identity is inconsistent');
  const accepted = parseJson(row.accepted_output_refs_json, 'accepted output references');
  if (!Array.isArray(accepted)) invalidData('stored accepted output references are invalid');
  if (row.current_step_id !== null && !definition.steps.some((step) => step.id === row.current_step_id)) {
    invalidData('stored current step does not exist in frozen definition');
  }
  if ((row.status === 'active') !== (row.current_step_id !== null)) {
    invalidData('stored flow status and current step are inconsistent');
  }
  return {
    id: row.id,
    novelId: row.novel_id,
    definition,
    ...(row.current_step_id === null ? {} : { currentStepId: row.current_step_id }),
    acceptedOutputRefs: accepted.map(parseArtifactRef),
    status: row.status as CreationFlowSession['status'],
    databaseGeneration: row.database_generation,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateDraft(definition: CreationFlowDefinitionDraft): void {
  if (!isNonEmptyString(definition?.id) || !isNonEmptyString(definition?.version)
    || !Array.isArray(definition.steps) || definition.steps.length === 0) {
    invalidInput('flow identity and at least one step are required');
  }
  const seen = new Set<string>();
  const producedKinds = new Set<CreativeArtifactKind>();
  for (const step of definition.steps) {
    if (!isNonEmptyString(step.id) || !isNonEmptyString(step.capabilityId)
      || !Array.isArray(step.dependsOn) || !step.dependsOn.every(isNonEmptyString)
      || !Array.isArray(step.requiredArtifactKinds) || !step.requiredArtifactKinds.every(isArtifactKind)
      || !isArtifactKind(step.producedArtifactKind) || typeof step.required !== 'boolean') {
      invalidInput('flow step is invalid');
    }
    if (seen.has(step.id)) invalidInput(`duplicate flow step: ${step.id}`);
    if (step.dependsOn.some((dependency) => !seen.has(dependency))) {
      invalidInput(`flow dependency must reference an earlier step: ${step.id}`);
    }
    if (producedKinds.has(step.producedArtifactKind)) {
      invalidInput(`flow output kind must be unique: ${step.producedArtifactKind}`);
    }
    seen.add(step.id);
    producedKinds.add(step.producedArtifactKind);
  }
}

export function freezeCreationFlowDefinition(definition: CreationFlowDefinitionDraft): CreationFlowDefinition {
  validateDraft(definition);
  const steps = definition.steps.map((step) => {
    const manifest = capabilityManifestFor(step.capabilityId);
    if (!manifest || manifest.runtimeStatus !== 'active') {
      throw new CreationFlowError('CREATION_FLOW_CAPABILITY_NOT_FOUND', `capability is unavailable: ${step.capabilityId}`);
    }
    const contract = manifest.artifactContract;
    if (!manifest.usageModes?.includes('flow-step') || !contract
      || !contract.artifactKinds.includes(step.producedArtifactKind)
      || contract.requiredInputs.some((kind) => !step.requiredArtifactKinds.includes(kind))
      || step.producedArtifactKind === 'scene-beats') {
      throw new CreationFlowError('CREATION_FLOW_CAPABILITY_INCOMPATIBLE', `capability contract is incompatible with step: ${step.id}`);
    }
    return {
      id: step.id,
      capabilityId: step.capabilityId,
      capabilityVersion: manifest.version,
      dependsOn: [...step.dependsOn],
      requiredArtifactKinds: [...step.requiredArtifactKinds],
      producedArtifactKind: step.producedArtifactKind,
      required: step.required,
    };
  });
  return { id: definition.id, version: definition.version, steps };
}

function activeArtifactRefs(novelId: string): CreativeArtifactRef[] {
  const database = getDb();
  const refs = (database.prepare(`
    SELECT core.artifact_kind AS kind, core.artifact_id AS id, core.version
    FROM creative_artifact_cores core
    WHERE core.novel_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM artifact_review_requirements review
        WHERE review.novel_id = core.novel_id
          AND review.artifact_kind = core.artifact_kind
          AND review.artifact_id = core.artifact_id
          AND review.artifact_version = core.version
          AND review.status = 'review-required'
      )
    ORDER BY core.artifact_kind, core.artifact_id
  `).all(novelId) as Array<{ kind: unknown; id: unknown; version: unknown }>).map(parseArtifactRef);

  const outlineKind = (level: string): CreativeArtifactKind | undefined => level === 'master'
    ? 'master-outline'
    : level === 'volume' ? 'volume-outline' : level === 'chapter' ? 'chapter-outline' : undefined;
  const outlines = database.prepare(`
    SELECT level, id FROM outline_artifacts
    WHERE novel_id = ? AND status = 'active'
    ORDER BY level, id
  `).all(novelId) as Array<{ level: string; id: string }>;
  for (const outline of outlines) {
    const kind = outlineKind(outline.level);
    if (!kind) continue;
    const stale = database.prepare(`
      SELECT 1 FROM artifact_review_requirements
      WHERE novel_id = ? AND artifact_kind = ? AND artifact_id = ?
        AND artifact_version = 1 AND status = 'review-required'
    `).get(novelId, kind, outline.id);
    if (!stale) refs.push({ kind, id: outline.id, version: 1 });
  }

  return [...new Map(refs.map((ref) => [`${ref.kind}:${ref.id}:${ref.version}`, ref])).values()];
}

function outlineMatchesFrozenStep(
  novelId: string,
  step: CreationFlowStep,
  artifact: CreativeArtifactRef,
): boolean {
  const expectedLevel = artifact.kind === 'master-outline'
    ? 'master'
    : artifact.kind === 'volume-outline'
      ? 'volume'
      : artifact.kind === 'chapter-outline'
        ? 'chapter'
        : undefined;
  if (!expectedLevel) return false;
  const outline = getOutlineArtifact(artifact.id, novelId);
  return outline?.level === expectedLevel
    && outline.status === 'active'
    && outline.version === artifact.version
    && Boolean(outline.sourceCapabilityVersions?.some((version) => (
      version.capabilityId === step.capabilityId && version.version === step.capabilityVersion
    )));
}

function nextStepId(
  novelId: string,
  definition: CreationFlowDefinition,
  refs: readonly CreativeArtifactRef[],
): string | undefined {
  return definition.steps.find((step) => !refs.some((ref) => (
    ref.kind === step.producedArtifactKind
    && (ref.kind === 'world' || ref.kind === 'character' || outlineMatchesFrozenStep(novelId, step, ref))
  )))?.id;
}

export function getCreationFlowSession(novelId: string, sessionId: string): CreationFlowSession | undefined {
  const row = getDb().prepare(`
    SELECT * FROM creation_flow_sessions WHERE id = ? AND novel_id = ?
  `).get(sessionId, novelId) as FlowRow | undefined;
  return row ? rowToSession(row) : undefined;
}

export function getActiveCreationFlowSession(novelId: string): CreationFlowSession | undefined {
  const row = getDb().prepare(`
    SELECT * FROM creation_flow_sessions
    WHERE novel_id = ? AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `).get(novelId) as FlowRow | undefined;
  return row ? rowToSession(row) : undefined;
}

export function getCreationFlowReadiness(session: CreationFlowSession): CreationFlowReadiness {
  if (!session.currentStepId) return { ready: true, missingArtifactKinds: [] };
  const step = session.definition.steps.find((candidate) => candidate.id === session.currentStepId);
  if (!step) invalidData('current step is absent from frozen definition');
  const acceptedKinds = new Set(session.acceptedOutputRefs.map((ref) => ref.kind));
  const dependencyKinds = step.dependsOn.map((dependencyId) => {
    const dependency = session.definition.steps.find((candidate) => candidate.id === dependencyId);
    if (!dependency) invalidData('flow dependency is absent from frozen definition');
    return dependency.producedArtifactKind;
  });
  const missingArtifactKinds = [...new Set([...dependencyKinds, ...step.requiredArtifactKinds])]
    .filter((kind) => !acceptedKinds.has(kind));
  return { ready: missingArtifactKinds.length === 0, missingArtifactKinds };
}

export function startCreationFlow(input: {
  id?: string;
  novelId: string;
  definition: CreationFlowDefinitionDraft;
  databaseGeneration: number;
}): CreationFlowSession {
  if (input.databaseGeneration !== getDatabaseGeneration()) {
    throw new CreationFlowError('CREATION_FLOW_GENERATION_STALE', 'database generation changed');
  }
  const definition = freezeCreationFlowDefinition(input.definition);
  const result = runInTransaction(() => {
    const novel = getDb().prepare('SELECT 1 FROM novels WHERE id = ?').get(input.novelId);
    if (!novel) throw new CreationFlowError('CREATION_FLOW_NOVEL_NOT_FOUND', 'novel not found');
    if (getActiveCreationFlowSession(input.novelId)) {
      throw new CreationFlowError('CREATION_FLOW_ACTIVE_EXISTS', 'novel already has an active flow session');
    }
    const acceptedOutputRefs = activeArtifactRefs(input.novelId);
    const currentStepId = nextStepId(input.novelId, definition, acceptedOutputRefs);
    const status: CreationFlowSession['status'] = currentStepId ? 'active' : 'completed';
    const now = Date.now();
    const id = input.id || generateId();
    getDb().prepare(`
      INSERT INTO creation_flow_sessions (
        id, novel_id, flow_id, frozen_definition_json, current_step_id,
        accepted_output_refs_json, status, database_generation, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.novelId, definition.id, JSON.stringify(definition), currentStepId ?? null,
      JSON.stringify(acceptedOutputRefs), status, input.databaseGeneration, now, now,
    );
    return getCreationFlowSession(input.novelId, id)!;
  });
  notify();
  return result;
}

function verifyAcceptedOutput(step: CreationFlowStep, novelId: string, artifact: CreativeArtifactRef): void {
  if (artifact.kind !== step.producedArtifactKind) {
    throw new CreationFlowError('CREATION_FLOW_OUTPUT_KIND_MISMATCH', 'accepted artifact kind does not match current step');
  }
  if (artifact.kind === 'master-outline' || artifact.kind === 'volume-outline' || artifact.kind === 'chapter-outline') {
    if (!outlineMatchesFrozenStep(novelId, step, artifact)) {
      const outline = getOutlineArtifact(artifact.id, novelId);
      if (!outline || outline.status !== 'active' || outline.version !== artifact.version) {
        throw new CreationFlowError('CREATION_FLOW_OUTPUT_NOT_ACCEPTED', 'accepted outline version was not found');
      }
      throw new CreationFlowError('CREATION_FLOW_OUTPUT_CAPABILITY_MISMATCH', 'outline was not accepted from the frozen capability version');
    }
    return;
  }
  if (artifact.kind !== 'world' && artifact.kind !== 'character') {
    throw new CreationFlowError('CREATION_FLOW_OUTPUT_NOT_ACCEPTED', 'artifact authority cannot yet prove this accepted version');
  }
  const stored = getArtifactCore(novelId, artifact.kind, artifact.id);
  if (!stored || stored.version !== artifact.version) {
    throw new CreationFlowError('CREATION_FLOW_OUTPUT_NOT_ACCEPTED', 'accepted artifact version was not found');
  }
  const versions = stored.provenance.sourceCapabilityVersions;
  const matches = Array.isArray(versions) && versions.some((value) => isRecord(value)
    && value.capabilityId === step.capabilityId && value.version === step.capabilityVersion);
  if (!matches) {
    throw new CreationFlowError('CREATION_FLOW_OUTPUT_CAPABILITY_MISMATCH', 'artifact was not accepted from the frozen capability version');
  }
}

export function recordAcceptedFlowOutput(input: {
  novelId: string;
  sessionId: string;
  artifact: CreativeArtifactRef;
  databaseGeneration: number;
}): CreationFlowSession {
  if (input.databaseGeneration !== getDatabaseGeneration()) {
    throw new CreationFlowError('CREATION_FLOW_GENERATION_STALE', 'database generation changed');
  }
  if (!isArtifactKind(input.artifact?.kind) || !isNonEmptyString(input.artifact?.id)
    || !Number.isInteger(input.artifact?.version) || input.artifact.version <= 0) {
    invalidInput('accepted artifact reference is invalid');
  }
  const result = runInTransaction(() => {
    const session = getCreationFlowSession(input.novelId, input.sessionId);
    if (!session) throw new CreationFlowError('CREATION_FLOW_NOT_FOUND', 'flow session not found');
    if (session.databaseGeneration !== input.databaseGeneration) {
      throw new CreationFlowError('CREATION_FLOW_GENERATION_STALE', 'flow session belongs to a different database generation');
    }
    if (session.status !== 'active' || !session.currentStepId) {
      const alreadyRecorded = session.acceptedOutputRefs.some((ref) => ref.kind === input.artifact.kind
        && ref.id === input.artifact.id && ref.version === input.artifact.version);
      if (alreadyRecorded) return session;
      throw new CreationFlowError('CREATION_FLOW_SESSION_TERMINAL', 'flow session is not active');
    }
    const readiness = getCreationFlowReadiness(session);
    if (!readiness.ready) {
      throw new CreationFlowError(
        'CREATION_FLOW_PREREQUISITES_MISSING',
        'current step prerequisites are missing',
        readiness.missingArtifactKinds,
      );
    }
    const step = session.definition.steps.find((candidate) => candidate.id === session.currentStepId)!;
    verifyAcceptedOutput(step, input.novelId, input.artifact);
    const acceptedOutputRefs = [...session.acceptedOutputRefs, input.artifact];
    const currentStepId = nextStepId(input.novelId, session.definition, acceptedOutputRefs);
    const status: CreationFlowSession['status'] = currentStepId ? 'active' : 'completed';
    const updatedAt = Date.now();
    getDb().prepare(`
      UPDATE creation_flow_sessions
      SET current_step_id = ?, accepted_output_refs_json = ?, status = ?, updated_at = ?
      WHERE id = ? AND novel_id = ? AND status = 'active'
    `).run(currentStepId ?? null, JSON.stringify(acceptedOutputRefs), status, updatedAt, session.id, input.novelId);
    return getCreationFlowSession(input.novelId, input.sessionId)!;
  });
  notify();
  return result;
}

export function buildFlowMigrationCandidate(
  session: CreationFlowSession,
  proposedDefinition: CreationFlowDefinition,
): CreationFlowMigrationCandidate {
  if (proposedDefinition.id !== session.definition.id) {
    invalidInput('migration candidate must preserve the active flow identity');
  }
  const currentByStep = new Map(session.definition.steps.map((step) => [step.id, step]));
  const changedCapabilities = proposedDefinition.steps.flatMap((step) => {
    const current = currentByStep.get(step.id);
    if (!current || current.capabilityId !== step.capabilityId || current.capabilityVersion === step.capabilityVersion) return [];
    return [{
      capabilityId: step.capabilityId,
      fromVersion: current.capabilityVersion,
      toVersion: step.capabilityVersion,
    }];
  });
  return {
    sessionId: session.id,
    flowId: session.definition.id,
    currentDefinition: session.definition,
    proposedDefinition,
    changedCapabilities,
  };
}
