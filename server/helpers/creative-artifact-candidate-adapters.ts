import type {
  ArtifactCandidate,
  ArtifactImpactReport,
  CreativeArtifactRef,
} from '../../shared/types/creative-artifacts.js';
import type { CanonPatchOperation, SourceCapabilityVersion } from '../../shared/types/outline-governance.js';
import { acceptCanonPatch, createCanonPatch } from '../lib/db/canon-patches.js';
import { getChapterProductionRun } from '../lib/db/production.js';
import { getChapterProductionRunVersion } from '../lib/db/production-versions.js';

export class ArtifactCandidateAdapterError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
  }
}

function emptyImpact(manuscriptConflict: boolean, reasons: string[]): ArtifactImpactReport {
  return { downstream: [], reviewRequired: [], manuscriptConflict, reasons };
}

export async function previewOutlineCandidate(input: {
  novelId: string;
  baseFingerprint: string;
  operations: readonly CanonPatchOperation[];
  sourceAbilityId?: string;
  sourceCapabilityVersions?: SourceCapabilityVersion[];
}) {
  return createCanonPatch(input);
}

export async function acceptOutlineCandidate(input: {
  novelId: string;
  patchId: string;
  databaseGeneration: number;
}) {
  return acceptCanonPatch(input.novelId, input.patchId, input.databaseGeneration);
}

export function previewManuscriptCandidate(input: {
  novelId: string;
  runId: string;
  versionId: string;
}): Pick<ArtifactCandidate, 'target' | 'impactReport' | 'status'> {
  const run = getChapterProductionRun(input.runId);
  const version = getChapterProductionRunVersion(input.versionId);
  if (!run || run.novelId !== input.novelId || !version || version.runId !== run.id || version.novelId !== input.novelId) {
    throw new ArtifactCandidateAdapterError('ARTIFACT_CANDIDATE_MANUSCRIPT_NOT_FOUND', 'production run version not found for novel');
  }

  const target: CreativeArtifactRef = { kind: 'scene-beats', id: version.id, version: 1 };
  return {
    target,
    status: 'pending',
    impactReport: emptyImpact(true, ['manuscript changes require a separate production revision']),
  };
}
