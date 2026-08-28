import type { CapabilityManifestEntry } from '../types/capability-manifest.js';
import type { CapabilityCompositionConflict } from '../types/creative-artifacts.js';

export interface FrozenArtifactCapability {
  capabilityId: string;
  version: string;
}

export type CapabilityCompositionResult =
  | { ok: true; goal: string; snapshot: FrozenArtifactCapability[] }
  | { ok: false; conflicts: CapabilityCompositionConflict[] };

export function composeArtifactCapabilities(input: {
  manifests: readonly CapabilityManifestEntry[];
  diagnosedGoal: string;
  authorGoal?: string;
  rulesByCapability?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}): CapabilityCompositionResult {
  const rulesByField = new Map<string, Array<{ capabilityId: string; rule: string }>>();
  for (const manifest of input.manifests) {
    for (const [field, rule] of Object.entries(input.rulesByCapability?.[manifest.id] ?? {})) {
      const entries = rulesByField.get(field) ?? [];
      entries.push({ capabilityId: manifest.id, rule });
      rulesByField.set(field, entries);
    }
  }

  const conflicts = [...rulesByField.entries()]
    .filter(([, entries]) => new Set(entries.map((entry) => entry.rule)).size > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([field, entries]) => ({
      field,
      capabilityIds: entries.map((entry) => entry.capabilityId).sort(),
      rules: entries.map((entry) => entry.rule).sort(),
      resolution: 'author-choice-required' as const,
    }));
  if (conflicts.length > 0) return { ok: false, conflicts };

  return {
    ok: true,
    goal: input.authorGoal?.trim() || input.diagnosedGoal,
    snapshot: [...input.manifests]
      .map((manifest) => ({ capabilityId: manifest.id, version: manifest.version }))
      .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId)),
  };
}
