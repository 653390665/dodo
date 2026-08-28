import { describe, expect, test } from 'vitest';

import {
  buildAssistantActionPlan,
  getAssistantQuickActions,
} from '../lib/assistant-action-plan';

describe('assistant action plan', () => {
  test('hides chapter-only actions when no chapter is bound', () => {
    const actions = getAssistantQuickActions({ hasNovel: true, hasChapter: false });

    expect(actions.map((action) => action.intent)).toEqual([
      'build-setting',
      'plan-structure',
      'save-fragment',
    ]);
    expect(actions.some((action) => action.intent === 'draft-prose')).toBe(false);
    expect(actions.some((action) => action.intent === 'plan-scene')).toBe(false);
  });

  test('binds chapter creation actions to chapter scope and governed capabilities', () => {
    const prose = buildAssistantActionPlan('draft-prose', '补一段冲突', {
      novelId: 'novel-a',
      chapterId: 'chapter-a',
    });
    const scene = buildAssistantActionPlan('plan-scene', '补分镜', {
      novelId: 'novel-a',
      chapterId: 'chapter-a',
    });

    expect(prose).toMatchObject({
      intent: 'draft-prose',
      scope: 'chapter',
      executionMode: 'single-run',
      outputArtifact: 'chapter-prose-candidate',
      recommendedCapabilityId: 'prose-mouth-flavor',
      chapterId: 'chapter-a',
    });
    expect(scene).toMatchObject({
      intent: 'plan-scene',
      scope: 'chapter',
      outputArtifact: 'scene-beat-candidate',
      recommendedCapabilityId: 'opening-gold-three',
    });
  });

  test('routes setting work to a project candidate instead of a direct canon write', () => {
    expect(buildAssistantActionPlan('build-setting', '补充世界规则', { novelId: 'novel-a' })).toMatchObject({
      scope: 'project',
      executionMode: 'single-run',
      outputArtifact: 'world-candidate',
      recommendedCapabilityId: 'bible-world-builder',
      requiresReview: true,
    });
  });
});
