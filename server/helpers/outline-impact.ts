import type { ArtifactImpactReport, CreativeArtifactRef } from '../../shared/types/creative-artifacts.js';
import type { OutlineArtifact } from '../../shared/types/outline-governance.js';

export interface OutlineImpactInput {
  proposedUpstreamNodeIds: readonly string[];
  activeDownstream: readonly OutlineArtifact[];
}

function outlineRef(artifact: OutlineArtifact): CreativeArtifactRef | undefined {
  const kind = artifact.level === 'master'
    ? 'master-outline'
    : artifact.level === 'volume'
      ? 'volume-outline'
      : artifact.level === 'chapter'
        ? 'chapter-outline'
        : undefined;
  return kind ? { kind, id: artifact.id, version: artifact.version || 1 } : undefined;
}

export function buildOutlineImpactReport(input: OutlineImpactInput): ArtifactImpactReport {
  const upstreamNodeIds = new Set(input.proposedUpstreamNodeIds);
  const affected = new Map<string, CreativeArtifactRef>();
  const reasons = new Set<string>();
  for (const artifact of input.activeDownstream) {
    if (artifact.status !== 'active' || !artifact.core) continue;
    const missing = [...new Set(artifact.core.nodes
      .map((node) => node.parentNodeId)
      .filter((parentNodeId): parentNodeId is string => parentNodeId !== undefined && !upstreamNodeIds.has(parentNodeId)))]
      .sort();
    if (missing.length === 0) continue;
    const ref = outlineRef(artifact);
    if (!ref) continue;
    affected.set(`${ref.kind}:${ref.id}:${ref.version}`, ref);
    for (const nodeId of missing) reasons.add(`missing upstream node: ${nodeId}`);
  }
  const reviewRequired = [...affected.values()].sort((left, right) => (
    `${left.kind}:${left.id}:${left.version}`.localeCompare(`${right.kind}:${right.id}:${right.version}`)
  ));
  return {
    downstream: reviewRequired,
    reviewRequired,
    manuscriptConflict: false,
    reasons: [...reasons].sort(),
  };
}
