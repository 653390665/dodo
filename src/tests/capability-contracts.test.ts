import { describe, expect, test } from 'vitest';

import { ENHANCEMENT_PACKAGES, getEnhancementPackageSteps } from '../../shared/lib/enhancement-packages';
import { projectCapabilityManifest } from '../../shared/lib/capability-manifest-catalog';
import { isCapabilityApplicationResult } from '../../shared/types/capability-execution';

describe('capability contracts', () => {
  test('keeps legacy assets packages readable as ordered recipes', () => {
    expect(getEnhancementPackageSteps({ id: 'pack', name: 'p', type: 'free', description: 'd', assets: ['a', 'b'] }))
      .toMatchObject([{ assetId: 'a', mode: 'recommend', trigger: 'milestone', scope: 'single-run', order: 1, required: false }, { assetId: 'b', order: 2 }]);
  });

  test('ships an ordered recipe for every enhancement package', () => {
    expect(ENHANCEMENT_PACKAGES).toHaveLength(9);
    for (const pkg of ENHANCEMENT_PACKAGES) {
      expect(pkg.version).toBeTruthy();
      expect(pkg.intendedOutcome).toBeTruthy();
      const steps = getEnhancementPackageSteps(pkg);
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.map((step) => step.order)).toEqual(steps.map((_step, index) => index + 1));
      for (const step of steps) expect(step).toEqual(expect.objectContaining({ mode: expect.any(String), trigger: expect.any(String), scope: expect.any(String), required: expect.any(Boolean) }));
    }
  });

  test('projects legacy persistence into allowed scopes for utility and guardrail manifests', () => {
    expect(projectCapabilityManifest({
      id: 'u', version: '1', kind: 'utility', stages: ['critic'], input: 'text', output: 'diagnostic',
      action: 'run-diagnostic', persistence: 'single-run', sideEffect: 'none', runtimeStatus: 'active', sourceType: 'built-in',
      allowedScopes: [],
    }).allowedScopes).toEqual(['single-run']);
  });

  test('validates itemized application results and idempotency', () => {
    expect(isCapabilityApplicationResult({ applied: true, idempotent: true, databaseGeneration: 4, items: [{ capabilityId: 'u', status: 'configured' }] })).toBe(true);
    expect(isCapabilityApplicationResult({ applied: true, idempotent: true, databaseGeneration: 4, items: [{ capabilityId: 'u', status: 'unknown' }] })).toBe(false);
  });
});
