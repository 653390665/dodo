import type {
  ArtifactCandidate,
  ArtifactImpactReport,
  ArtifactOperation,
  CreativeArtifactKind,
} from '../../shared/types/creative-artifacts.js';
import { buildArtifactDiff } from '../../shared/lib/creative-artifact-diff.js';
import { fingerprintCreativeArtifact } from '../../shared/lib/creative-artifact-fingerprint.js';
import { generateId } from '../id.js';
import {
  applyArtifactCandidateDecision,
  createArtifactCandidate,
  CreativeArtifactPersistenceError,
  getArtifactCandidate,
  getArtifactCore,
  markArtifactReviewRequired,
  saveArtifactVersion,
  type ArtifactReviewRequirement,
  type StoredArtifactCore,
} from '../lib/db/creative-artifacts.js';
import { runInSerializedWriteForGeneration, runInTransaction } from '../lib/db-instance.js';

const genericKinds = new Set<CreativeArtifactKind>(['world', 'character']);

export class ArtifactCandidateError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
  }
}

export interface PreviewArtifactCandidateInput {
  id?: string;
  novelId: string;
  target: { kind: 'world' | 'character'; id: string; version: number };
  operation: ArtifactOperation;
  goal: string;
  baseFingerprint: string;
  sourceCapabilityVersions: ArtifactCandidate['sourceCapabilityVersions'];
  proposedCore: Record<string, unknown>;
  proposedContent?: string;
  impactReport: ArtifactImpactReport;
}

export interface AcceptedArtifactVersion {
  candidate: ArtifactCandidate;
  core: StoredArtifactCore;
  reviewRequirements: ArtifactReviewRequirement[];
}

interface StaleArtifactCandidate {
  stale: true;
}

function assertPlainObject(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ArtifactCandidateError('ARTIFACT_CANDIDATE_INVALID_OUTPUT', 'proposed core must be a plain object');
  }
}

function currentFingerprint(input: PreviewArtifactCandidateInput): string {
  const current = getArtifactCore(input.novelId, input.target.kind, input.target.id);
  return fingerprintCreativeArtifact({
    kind: input.target.kind,
    version: current?.version ?? 0,
    core: current?.core,
    content: current?.readableContent,
  });
}

function mapPersistenceError(error: unknown): never {
  if (error instanceof CreativeArtifactPersistenceError) {
    throw new ArtifactCandidateError(error.code, error.message);
  }
  throw error;
}

export async function previewArtifactCandidate(input: PreviewArtifactCandidateInput): Promise<ArtifactCandidate> {
  if (!genericKinds.has(input.target.kind)) {
    throw new ArtifactCandidateError('ARTIFACT_CANDIDATE_UNSUPPORTED_KIND', 'generic candidates support world and character only');
  }
  assertPlainObject(input.proposedCore);
  const current = getArtifactCore(input.novelId, input.target.kind, input.target.id);
  if ((current?.version ?? 0) !== input.target.version) {
    throw new ArtifactCandidateError('ARTIFACT_CANDIDATE_VERSION_STALE', 'target version does not match current artifact');
  }
  if (currentFingerprint(input) !== input.baseFingerprint) {
    throw new ArtifactCandidateError('ARTIFACT_CANDIDATE_FINGERPRINT_STALE', 'base fingerprint does not match current artifact');
  }

  const diff = buildArtifactDiff(
    { core: current?.core, content: current?.readableContent },
    { core: input.proposedCore, content: input.proposedContent },
  );
  try {
    return createArtifactCandidate({
      id: input.id ?? generateId(),
      novelId: input.novelId,
      target: input.target,
      operation: input.operation,
      goal: input.goal,
      baseFingerprint: input.baseFingerprint,
      sourceCapabilityVersions: input.sourceCapabilityVersions,
      proposedCore: input.proposedCore,
      ...(input.proposedContent === undefined ? {} : { proposedContent: input.proposedContent }),
      diff,
      impactReport: input.impactReport,
    });
  } catch (error) {
    return mapPersistenceError(error);
  }
}

export async function acceptArtifactCandidate(input: {
  novelId: string;
  candidateId: string;
  databaseGeneration: number;
}): Promise<AcceptedArtifactVersion> {
  const guarded = await runInSerializedWriteForGeneration(input.databaseGeneration, () => runInTransaction(() => {
    const candidate = getArtifactCandidate(input.novelId, input.candidateId);
    if (!candidate) throw new ArtifactCandidateError('ARTIFACT_CANDIDATE_NOT_FOUND', 'candidate not found for novel');
    if (candidate.status === 'rejected') throw new ArtifactCandidateError('ARTIFACT_CANDIDATE_REJECTED', 'candidate was rejected');
    if (candidate.status === 'stale') throw new ArtifactCandidateError('ARTIFACT_CANDIDATE_STALE', 'candidate is stale');

    const current = getArtifactCore(input.novelId, candidate.target.kind, candidate.target.id);
    if (candidate.status === 'accepted') {
      if (!current) throw new ArtifactCandidateError('ARTIFACT_CANDIDATE_INVALID_DATA', 'accepted candidate has no artifact version');
      return { candidate, core: current, reviewRequirements: [] };
    }
    const fingerprint = fingerprintCreativeArtifact({
      kind: candidate.target.kind,
      version: current?.version ?? 0,
      core: current?.core,
      content: current?.readableContent,
    });
    if (fingerprint !== candidate.baseFingerprint || (current?.version ?? 0) !== candidate.target.version) {
      applyArtifactCandidateDecision(input.novelId, input.candidateId, 'stale');
      return { stale: true } satisfies StaleArtifactCandidate;
    }

    const core = saveArtifactVersion({
      novelId: input.novelId,
      artifactKind: candidate.target.kind,
      artifactId: candidate.target.id,
      expectedVersion: candidate.target.version,
      core: candidate.proposedCore,
      ...(candidate.proposedContent === undefined ? {} : { readableContent: candidate.proposedContent }),
      provenance: {
        sourceCandidateId: candidate.id,
        operation: candidate.operation,
        sourceCapabilityVersions: candidate.sourceCapabilityVersions,
      },
    });
    const acceptedCandidate = applyArtifactCandidateDecision(input.novelId, input.candidateId, 'accepted');
    const reviewRequirements = candidate.impactReport.reviewRequired.map((artifact) => markArtifactReviewRequired({
      novelId: input.novelId, artifact, sourceCandidateId: candidate.id, reason: 'upstream artifact candidate accepted',
    }));
    return { candidate: acceptedCandidate, core, reviewRequirements };
  }));

  if (!guarded.executed) {
    throw new ArtifactCandidateError('ARTIFACT_CANDIDATE_GENERATION_STALE', 'database generation changed');
  }
  if ('stale' in guarded.result) {
    throw new ArtifactCandidateError('ARTIFACT_CANDIDATE_FINGERPRINT_STALE', 'candidate base is stale');
  }
  return guarded.result;
}

export function rejectArtifactCandidate(novelId: string, candidateId: string): ArtifactCandidate {
  try {
    return applyArtifactCandidateDecision(novelId, candidateId, 'rejected');
  } catch (error) {
    return mapPersistenceError(error);
  }
}
