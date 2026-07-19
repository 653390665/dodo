import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSetupTasksFromStoryCard,
  buildProjectPreferenceProfileFromPlanning,
  countCompletedSetupTasks,
  recommendSkillsForStoryCard,
} from '../src/lib/onboarding-model';
import type { Skill, StoryIdeaCard, StoryPlanningInput } from '../shared/types';

function makePlanning(overrides: Partial<StoryPlanningInput> = {}): StoryPlanningInput {
  return {
    expectedWordCount: 180000,
    pacingPreference: 'tight',
    storyFocus: 'plot',
    ...overrides,
  };
}

function makeCard(overrides: Partial<StoryIdeaCard> = {}): StoryIdeaCard {
  return {
    id: 'card-1',
    hook: '雨夜刀客误拿玄铁令，被各方势力逼入死局。',
    protagonist: '一个寡言、克制、总在后发制人的年轻刀客。',
    coreConflict: '主角必须在洗清嫌疑和守住令牌之间做选择。',
    tone: '冷峻、悬疑、压迫感强',
    whyItWorks: '开篇就有危机，人物目标和外部追杀同时成立。',
    starterSeeds: {
      worldSeed: '江湖势力围绕玄铁令争斗，刀法讲究时机与代价。',
      relationshipSeed: '主角与酒馆掌柜表面试探、实则互相钓话。',
      chapterOneSeed: '第一章从雨夜入酒馆开始，以门外靴声逼近收尾。',
    },
    riskNote: '如果先把令牌秘密说穿，悬疑感会塌。',
    mixTags: ['rain-night', 'martial', 'suspense'],
    planningFit: {
      recommendedLength: '120000-200000 字',
      recommendedFocus: '冲突推进优先',
      recommendedPacing: '紧推进',
      reason: '题眼清晰，适合中长篇高压推进。',
    },
    signals: {
      tone: 'grim',
      conflictType: 'survival-mystery',
      worldWeight: 0.82,
      characterWeight: 0.68,
      pacingPreference: 'tight',
    },
    ...overrides,
  };
}

function makeSkill(partial: Partial<Skill> & Pick<Skill, 'id' | 'name'>): Skill {
  return {
    description: '',
    style: '',
    pacing: '',
    stabilityScore: 80,
    evaluationFeedback: '',
    version: 1,
    createdAt: 1,
    primaryDimension: 'style',
    dimensionTags: ['style'],
    compositionProfile: {
      styleWeight: 0.5,
      characterWeight: 0.5,
      worldWeight: 0.5,
      powerWeight: 0.5,
      plotWeight: 0.5,
      pacingWeight: 0.5,
      conflictTags: [],
      blendHints: [],
    },
    ...partial,
  };
}

test('buildSetupTasksFromStoryCard adds planning task when onboarding includes a writing plan', () => {
  const tasks = buildSetupTasksFromStoryCard(makeCard(), makePlanning());
  assert.equal(tasks.length, 7);
  assert.equal(tasks[0].key, 'protagonist');
  assert.equal(tasks[0].status, 'drafted');
  assert.equal(tasks[2].key, 'world-rules');
  assert.equal(tasks[4].key, 'chapter-one');
  assert.equal(tasks[6].key, 'story-scale');
  assert.match(tasks[6].summary, /18万字/);
  assert.match(tasks[6].summary, /剧情推进优先/);
});

test('buildSetupTasksFromStoryCard keeps original six tasks when no writing plan is provided', () => {
  const tasks = buildSetupTasksFromStoryCard(makeCard());
  assert.equal(tasks.length, 6);
});

test('countCompletedSetupTasks only counts confirmed tasks', () => {
  const tasks = buildSetupTasksFromStoryCard(makeCard());
  tasks[0].status = 'confirmed';
  tasks[1].status = 'confirmed';
  tasks[2].status = 'drafted';
  assert.equal(countCompletedSetupTasks(tasks), 2);
});

test('recommendSkillsForStoryCard returns top three ranked skills with reasons', () => {
  const card = makeCard();
  const skills = [
    makeSkill({
      id: 'style-1',
      name: '冷峻刀锋',
      primaryDimension: 'style',
      dimensionTags: ['style', 'plot'],
      compositionProfile: {
        styleWeight: 0.92,
        characterWeight: 0.2,
        worldWeight: 0.1,
        powerWeight: 0.1,
        plotWeight: 0.6,
        pacingWeight: 0.75,
        conflictTags: [],
        blendHints: ['grim'],
      },
    }),
    makeSkill({
      id: 'world-1',
      name: '铁血江湖',
      primaryDimension: 'world',
      dimensionTags: ['world', 'power'],
      compositionProfile: {
        styleWeight: 0.1,
        characterWeight: 0.1,
        worldWeight: 0.88,
        powerWeight: 0.8,
        plotWeight: 0.4,
        pacingWeight: 0.3,
        conflictTags: [],
        blendHints: ['martial'],
      },
    }),
    makeSkill({
      id: 'char-1',
      name: '压抑型对峙',
      primaryDimension: 'character',
      dimensionTags: ['character', 'plot'],
      compositionProfile: {
        styleWeight: 0.2,
        characterWeight: 0.85,
        worldWeight: 0.1,
        powerWeight: 0.1,
        plotWeight: 0.78,
        pacingWeight: 0.6,
        conflictTags: [],
        blendHints: ['suspense'],
      },
    }),
    makeSkill({
      id: 'slow-1',
      name: '散文化慢节奏',
      primaryDimension: 'pacing',
      dimensionTags: ['pacing'],
      compositionProfile: {
        styleWeight: 0.4,
        characterWeight: 0.2,
        worldWeight: 0.1,
        powerWeight: 0.1,
        plotWeight: 0.2,
        pacingWeight: 0.2,
        conflictTags: [],
        blendHints: ['lyrical'],
      },
    }),
  ];

  const ranked = recommendSkillsForStoryCard(card, skills);
  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].skillId, 'style-1');
  assert.equal(ranked.every((entry) => entry.reason.length > 0), true);
}
);

test('buildProjectPreferenceProfileFromPlanning turns onboarding plan into initial project preference notes', () => {
  const profile = buildProjectPreferenceProfileFromPlanning(
    makePlanning({
      expectedWordCount: 500000,
      pacingPreference: 'slow-burn',
      storyFocus: 'world',
    }),
  );

  assert.deepEqual(profile.tags, ['长篇推进', '世界设定优先', '慢热铺陈']);
  assert.equal(profile.notes[0], '预计总字数：50万字');
  assert.equal(profile.weights.worldWeight, 0.8);
  assert.equal(profile.weights.plotWeight, 0.35);
  assert.equal(profile.weights.pacingWeight, 0.35);
  assert.equal(profile.evidenceCount, 1);
});
