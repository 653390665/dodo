import type { CapabilityManifestEntry } from '../types/capability-manifest.js';
import type { ArtifactOperation, CreativeArtifactKind, CreativeArtifactRef } from '../types/creative-artifacts.js';

export { composeArtifactCapabilities } from './capability-composition.js';

export type ArtifactCapabilityExecutionCode =
  | 'ARTIFACT_CAPABILITY_NOT_DECLARED'
  | 'ARTIFACT_CAPABILITY_VERSION_STALE'
  | 'ARTIFACT_CAPABILITY_KIND_UNSUPPORTED'
  | 'ARTIFACT_CAPABILITY_OPERATION_UNSUPPORTED'
  | 'ARTIFACT_CAPABILITY_SCOPE_UNSUPPORTED'
  | 'ARTIFACT_CAPABILITY_GAP';

export type ArtifactCapabilityExecutionResult =
  | { ok: true }
  | { ok: false; code: ArtifactCapabilityExecutionCode; missingArtifactKinds?: CreativeArtifactKind[] };

export function validateArtifactCapabilityExecution(input: {
  manifest: CapabilityManifestEntry;
  capabilityVersion: string;
  artifactKind: CreativeArtifactKind;
  operation: ArtifactOperation;
  scope: 'project' | 'volume' | 'chapter' | 'selection' | 'single-run';
  availableArtifacts: readonly CreativeArtifactRef[];
}): ArtifactCapabilityExecutionResult {
  const contract = input.manifest.artifactContract;
  if (!contract) return { ok: false, code: 'ARTIFACT_CAPABILITY_NOT_DECLARED' };
  if (input.manifest.version !== input.capabilityVersion) {
    return { ok: false, code: 'ARTIFACT_CAPABILITY_VERSION_STALE' };
  }
  if (!contract.artifactKinds.includes(input.artifactKind)) {
    return { ok: false, code: 'ARTIFACT_CAPABILITY_KIND_UNSUPPORTED' };
  }
  if (!contract.operations.includes(input.operation)) {
    return { ok: false, code: 'ARTIFACT_CAPABILITY_OPERATION_UNSUPPORTED' };
  }
  if (!contract.allowedScopes.includes(input.scope)) {
    return { ok: false, code: 'ARTIFACT_CAPABILITY_SCOPE_UNSUPPORTED' };
  }
  const missingArtifactKinds = contract.requiredInputs
    .filter((kind) => !input.availableArtifacts.some((artifact) => artifact.kind === kind));
  return missingArtifactKinds.length > 0
    ? { ok: false, code: 'ARTIFACT_CAPABILITY_GAP', missingArtifactKinds }
    : { ok: true };
}
