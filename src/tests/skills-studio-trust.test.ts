import { describe, expect, test } from 'vitest';
import { getTrustedSessionCardIds, getGovernanceCapabilityType, getGovernedStageRecommendations, getGovernanceStageForWorkflowPhase, getGovernanceActionLabel, getCapabilityScopeLabel, filterGovernedAssets, getCapabilityManifest } from '../lib/capability-governance';
import { getRoleSkillSlots, buildRoleSkillLoadout, isCapabilityRunnable } from '../lib/skills-studio-governance';
import type { Skill } from '../../shared/types/skills';
import { CURATED_PRODUCT_SKILLS } from '../../shared/lib/public-skill-catalog';

describe('SkillsStudioView score trust guard', () => {
  test('rejects unscored clones instead of synthesizing a score', () => {
    const ordinary: Skill = { id: 'ordinary', name: 'x', description: 'x', style: 'rule', pacing: '', stabilityScore: 1, evaluationFeedback: '', version: 1, createdAt: 0 };
    expect(getTrustedSessionCardIds(['ordinary'], [ordinary])).toEqual([]);
  });

  test('accepts only governed or runtime-ready extracted cards', () => {
    const base: Skill = { id: 'saved', name: 'x', description: 'x', style: 'rule', pacing: '', stabilityScore: 1, evaluationFeedback: '', version: 1, createdAt: 0, sourceBadge: 'book-extracted', deconstructionCardType: 'style-card', executionScore: 60 };
    expect(getTrustedSessionCardIds(['saved'], [base])).toEqual(['saved']);
    expect(getTrustedSessionCardIds(['ordinary'], [{ ...base, id: 'ordinary', sourceBadge: 'manual' }])).toEqual([]);
  });

  test('accepts runtime-ready governed catalog clones saved from the capability store', () => {
    const clone: Skill = {
      id: 'saved-governed-card',
      parentSkillId: 'deconstruct-golden-climax',
      name: 'x',
      description: 'x',
      style: 'rule',
      pacing: '',
      stabilityScore: 1,
      evaluationFeedback: '',
      version: 3,
      createdAt: 0,
      sourceType: 'plaza',
      sourceBadge: 'manual',
      deconstructionCardType: 'pacing-card',
      executionScore: 80,
      isRuntimeReady: true,
      sanitizationStatus: 'runtime-ready',
      runtimeStatus: 'active',
    };

    expect(getTrustedSessionCardIds(['saved-governed-card'], [clone])).toEqual(['saved-governed-card']);
  });

  test('accepts active catalog skill-card ids without requiring a saved clone', () => {
    expect(getTrustedSessionCardIds(['style-ancient-elegance'], [])).toEqual(['style-ancient-elegance']);
  });

  test('uses the authoritative manifest for deconstruction overlays', () => {
    expect(getGovernanceCapabilityType({ id: 'deconstruct-golden-climax', title: 'x', curatedCategory: 'deconstruct', goal: '', successSignal: '', score: 1, grade: 'A', sourceType: 'plaza', primaryCategory: 'utility-tool', inputs: [], actionType: 'equip' })).toBe('skill-card');
  });

  test('does not infer a capability from id, category, or action type', () => {
    const unknown = { id: 'looks-like-a-flow', title: 'x', curatedCategory: 'audit' as const, goal: '', successSignal: '', score: 1, grade: 'A', sourceType: 'plaza' as const, primaryCategory: 'quality-guardrail', inputs: [], actionType: 'direct-exec' as const };
    expect(() => getGovernanceCapabilityType(unknown)).toThrow('CAPABILITY_MANIFEST_MISSING');
    expect(getGovernanceCapabilityType({ ...unknown, id: 'platform-tomato-scoring', curatedCategory: 'platform' as const })).toBe('diagnostic');
    expect(getGovernanceCapabilityType({ ...unknown, id: 'de-ai-slop-shield', curatedCategory: 'de-ai' as const, sourceType: 'built-in' as const, actionType: 'equip' as const })).toBe('technique');
  });

  test('does not present unavailable utilities as runnable', () => {
    const asset = { id: 'platform-tomato-scoring', title: 'x', curatedCategory: 'platform' as const, goal: '', successSignal: '', score: 1, grade: 'A', sourceType: 'licensed' as const, primaryCategory: 'platform-criteria' as const, inputs: [], actionType: 'direct-exec' as const };
    expect(isCapabilityRunnable(asset)).toBe(false);
    expect(isCapabilityRunnable({ ...asset, id: 'audit-cliche-detector' })).toBe(true);
  });

  test('maps each capability to its product action', () => {
    expect(getGovernanceActionLabel('flow')).toBe('选择流程');
    expect(getGovernanceActionLabel('skill-card')).toBe('应用到作品卡组');
    expect(getGovernanceActionLabel('role-skill')).toBe('待整理');
    expect(getGovernanceActionLabel('overlay')).toBe('本章使用');
    expect(getGovernanceActionLabel('utility')).toBe('运行工具');
    expect(getGovernanceActionLabel('guardrail')).toBe('保存为系统检查候选');
  });

  test('shows every declared capability scope instead of only the first one', () => {
    expect(getCapabilityScopeLabel(['project', 'chapter', 'single-run'])).toBe('作品默认 / 本章使用 / 仅运行一次');
  });

  test('projects runtime-ready quality guardrails into the governed shelf', () => {
    const guardrails = filterGovernedAssets(CURATED_PRODUCT_SKILLS, 'guardrail');
    expect(guardrails.length).toBeGreaterThan(0);
    expect(getGovernanceCapabilityType(guardrails[0])).toBe('guardrail');
    expect(getCapabilityManifest(guardrails[0])).toMatchObject({
      kind: 'guardrail',
      action: 'automatic',
      allowedScopes: ['system'],
      runtimeStatus: 'active',
    });
  });

  test('returns one governed recommendation per primary capability for the current stage', () => {
    const recommendations = getGovernedStageRecommendations('active-drafting');
    expect(recommendations.map((entry) => entry.capability)).toEqual(['technique', 'skill-card']);
    expect(recommendations.every((entry) => entry.asset.id && entry.asset.title)).toBe(true);
  });

  test('recommends guardrails for the style-polish stage', () => {
    const recommendations = getGovernedStageRecommendations('style-polish');
    expect(recommendations.some((entry) => entry.capability === 'guardrail')).toBe(true);
    expect(recommendations.every((entry) => getCapabilityManifest(entry.asset).runtimeStatus === 'active')).toBe(true);
    expect(recommendations.find((entry) => entry.capability === 'diagnostic')?.asset.id).toBe('audit-cliche-detector');
  });

  test('maps every workflow phase through one canonical governance-stage helper', () => {
    expect(getGovernanceStageForWorkflowPhase('import')).toBe('creative-setup');
    expect(getGovernanceStageForWorkflowPhase('review')).toBe('creative-setup');
    expect(getGovernanceStageForWorkflowPhase('sync')).toBe('creative-setup');
    expect(getGovernanceStageForWorkflowPhase('planning')).toBe('creative-setup');
    expect(getGovernanceStageForWorkflowPhase('drafting')).toBe('active-drafting');
    expect(getGovernanceStageForWorkflowPhase('audit')).toBe('style-polish');
    expect(getGovernanceStageForWorkflowPhase('polish')).toBe('style-polish');
    expect(getGovernanceStageForWorkflowPhase('next_chapter')).toBe('style-polish');
  });

  test('does not borrow a recommendation from another stage', () => {
    const recommendations = getGovernedStageRecommendations('commercial-sign');
    expect(recommendations.every((entry) => entry.stage === 'commercial-sign')).toBe(true);
    expect(recommendations).toHaveLength(0);
  });

  test('derives role slots from the manifest stages, never from array position', () => {
    expect(getRoleSkillSlots('opening-gold-three')).toEqual([]);
    expect(getRoleSkillSlots('prose-mouth-flavor')).toEqual([]);
    expect(getRoleSkillSlots('missing-manifest')).toEqual([]);
  });

  test('replaces the explicitly selected slot and preserves other slots', () => {
    const next = buildRoleSkillLoadout([
      { slot: 0, skillId: 'old-planner', weight: 1, lockedDimensions: [] },
      { slot: 1, skillId: 'writer', weight: 1, lockedDimensions: [] },
    ], 'new-planner', 'planner');
    expect(next).toEqual([
      { slot: 0, skillId: 'new-planner', weight: 1, lockedDimensions: [] },
      { slot: 1, skillId: 'writer', weight: 1, lockedDimensions: [] },
    ]);
  });
});
