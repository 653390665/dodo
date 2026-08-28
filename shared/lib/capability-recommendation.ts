import type { CapabilityManifestEntry } from '../types/capability-manifest.js';
import type { CapabilityRecommendation, CapabilityRecommendationDismissal, CapabilityRecommendationInput, CapabilityRecommendationResult } from '../types/capability-recommendation.js';

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return (result >>> 0).toString(16).padStart(8, '0');
}

export function recommendationFingerprint(input: Pick<CapabilityRecommendationInput, 'issue' | 'artifactKind' | 'operation' | 'scope' | 'artifactVersion' | 'upstreamVersion'>): string {
  return `caprec-${hash([input.issue.fingerprint, input.artifactKind, input.operation, input.scope, input.artifactVersion, input.upstreamVersion ?? ''].join('|'))}`;
}

function usageMode(manifest: CapabilityManifestEntry): CapabilityRecommendation['usageMode'] {
  if (manifest.usageModes?.includes('single-run')) return 'single-run';
  if (manifest.usageModes?.includes('persistent-rule')) return 'persistent-rule';
  if (manifest.usageModes?.includes('flow-step') || manifest.kind === 'flow') return 'flow-step';
  return 'single-run';
}

function eligible(input: CapabilityRecommendationInput): CapabilityManifestEntry[] {
  const accessible = input.accessibleCapabilityIds ? new Set(input.accessibleCapabilityIds) : undefined;
  const artifacts = input.availableArtifacts || [];
  const prerequisites = new Set(input.availablePrerequisites || []);
  return input.capabilities.filter((manifest) => {
    const contract = manifest.artifactContract;
    if (manifest.runtimeStatus !== 'active' || !contract) return false;
    if (accessible && !accessible.has(manifest.id)) return false;
    if (!contract.artifactKinds.includes(input.artifactKind) || !contract.operations.includes(input.operation) || !contract.allowedScopes.includes(input.scope)) return false;
    if (contract.requiredInputs.some((kind) => !artifacts.some((artifact) => artifact.kind === kind))) return false;
    const requiredPrerequisites = (manifest.lineage?.requiredPrerequisites as unknown[] | undefined) || [];
    return requiredPrerequisites.every((value) => typeof value === 'string' && prerequisites.has(value));
  });
}

export function buildCapabilityRecommendations(input: CapabilityRecommendationInput): CapabilityRecommendationResult {
  const eligibleEntries = eligible(input);
  const eligibleIds = new Set(eligibleEntries.map((entry) => entry.id));
  const dismissed = new Set(input.dismissedCapabilityIds || []);
  const preferred = input.issue.recommendedCapabilityIds || [];
  const aiOrder = (input.aiRankedCapabilityIds || []).filter((id) => eligibleIds.has(id));
  const order = [...new Set([...aiOrder, ...preferred.filter((id) => eligibleIds.has(id)), ...eligibleEntries.map((entry) => entry.id)])]
    .filter((id) => !dismissed.has(id));
  const byId = new Map(eligibleEntries.map((entry) => [entry.id, entry]));
  const recommendations = order.slice(0, 3).map((id) => {
    const manifest = byId.get(id)!;
    return {
      capabilityId: id, manifest, reason: input.issue.explanation || input.issue.suggestedFix || '可用于处理当前诊断问题',
      diagnosis: input.issue.explanation, expectedArtifactChange: input.issue.suggestedFix, usageMode: usageMode(manifest),
    };
  });
  return {
    fingerprint: recommendationFingerprint(input),
    context: {
      issue: input.issue,
      artifactKind: input.artifactKind,
      operation: input.operation,
      scope: input.scope,
      artifactVersion: input.artifactVersion,
      upstreamVersion: input.upstreamVersion,
    },
    primary: recommendations[0],
    alternatives: recommendations.slice(1),
    recommendations,
    eligibleCapabilityIds: eligibleEntries.map((entry) => entry.id),
  };
}

export function buildCapabilityRecommendationDismissal(result: CapabilityRecommendationResult, novelId: string, databaseGeneration: number): CapabilityRecommendationDismissal & Pick<CapabilityRecommendationInput, 'artifactKind' | 'operation' | 'scope'> {
  return {
    novelId,
    databaseGeneration,
    fingerprint: result.fingerprint,
    issueFingerprint: result.context.issue.fingerprint,
    artifactKind: result.context.artifactKind,
    operation: result.context.operation,
    scope: result.context.scope,
    artifactVersion: result.context.artifactVersion,
    upstreamVersion: result.context.upstreamVersion,
    capabilityId: result.primary?.capabilityId || '',
  };
}
