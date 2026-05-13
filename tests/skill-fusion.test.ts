import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFusionDraft,
  explainSkillFusion,
  pickFusionSuggestionPair,
  shouldSuggestFusion,
} from '../src/lib/skill-fusion';
import type { Skill, SkillUsageRecord } from '../src/types';

function makeSkill(partial: Partial<Skill> & Pick<Skill, 'id' | 'name'>): Skill {
  return {
    id: partial.id,
    name: partial.name,
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
      styleWeight: 0.8,
      characterWeight: 0.2,
      worldWeight: 0.2,
      powerWeight: 0.1,
      plotWeight: 0.4,
      pacingWeight: 0.6,
      conflictTags: [],
      blendHints: [],
    },
    ...partial,
  };
}

test('buildFusionDraft keeps primary dimension from main skill', () => {
  const mainSkill = makeSkill({
    id: 'style-1',
    name: '冷峻刀锋',
    primaryDimension: 'style',
    dimensionTags: ['style', 'plot'],
    style: '冷峻短句',
  });
  const supportSkill = makeSkill({
    id: 'char-1',
    name: '压抑对峙',
    primaryDimension: 'character',
    dimensionTags: ['character', 'plot'],
    characterTraits: '人物对峙张力',
  });

  const draft = buildFusionDraft(mainSkill, supportSkill);
  assert.equal(draft.primaryDimension, 'style');
  assert.equal(draft.dimensionTags?.includes('character'), true);
  assert.equal(draft.parentSkillId, 'style-1');
  assert.equal(draft.fusionMeta?.supportSkillId, 'char-1');
});

test('buildFusionDraft expresses overlap risk with writing-role language', () => {
  const mainSkill = makeSkill({
    id: 'style-1',
    name: '冷峻刀锋',
    primaryDimension: 'style',
    dimensionTags: ['style'],
  });
  const supportSkill = makeSkill({
    id: 'style-2',
    name: '极简压迫',
    primaryDimension: 'style',
    dimensionTags: ['style'],
  });

  const draft = buildFusionDraft(mainSkill, supportSkill);
  assert.equal(draft.fusionMeta?.risks[0], '同写作职责叠加可能导致表达过载');
});

test('explainSkillFusion describes retained strengths and absorbed benefits', () => {
  const explanation = explainSkillFusion({
    mainSkillName: '冷峻刀锋',
    supportSkillName: '压抑对峙',
    retained: ['冷峻短句', '低解释'],
    absorbed: ['人物对峙张力', '对白前试探动作'],
    risks: ['叠加世界观型 Skill 可能压慢节奏'],
  });

  assert.equal(explanation.retained.length, 2);
  assert.equal(explanation.absorbed[0], '人物对峙张力');
  assert.equal(explanation.risks.length, 1);
});

test('shouldSuggestFusion only returns true for stable and repeated pairings', () => {
  const records: SkillUsageRecord[] = [
    { id: '1', novelId: 'n1', mountedSkillIds: ['style-1', 'char-1'], fitScore: 84, userAction: 'accepted', createdAt: 1 },
    { id: '2', novelId: 'n1', mountedSkillIds: ['style-1', 'char-1'], fitScore: 86, userAction: 'accepted', createdAt: 2 },
    { id: '3', novelId: 'n1', mountedSkillIds: ['style-1', 'char-1'], fitScore: 88, userAction: 'accepted', createdAt: 3 },
  ];

  assert.equal(
    shouldSuggestFusion({
      mainSkillId: 'style-1',
      supportSkillId: 'char-1',
      records,
      minimumFitScore: 80,
      minimumAcceptedCount: 3,
    }),
    true,
  );
});

test('pickFusionSuggestionPair returns null when no pair meets repeated accepted threshold', () => {
  const mountedSkills = [
    makeSkill({ id: 'style-1', name: '冷峻刀锋', stabilityScore: 88 }),
    makeSkill({ id: 'char-1', name: '压抑对峙', stabilityScore: 82, primaryDimension: 'character' }),
  ];
  const records: SkillUsageRecord[] = [
    { id: '1', novelId: 'n1', mountedSkillIds: ['style-1', 'char-1'], fitScore: 84, userAction: 'accepted', createdAt: 1 },
  ];

  assert.equal(pickFusionSuggestionPair(mountedSkills, records), null);
});

test('pickFusionSuggestionPair selects highest accepted pair and orders by stability', () => {
  const styleSkill = makeSkill({ id: 'style-1', name: '冷峻刀锋', stabilityScore: 92 });
  const characterSkill = makeSkill({
    id: 'char-1',
    name: '压抑对峙',
    stabilityScore: 83,
    primaryDimension: 'character',
  });
  const plotSkill = makeSkill({
    id: 'plot-1',
    name: '紧逼推进',
    stabilityScore: 75,
    primaryDimension: 'plot',
  });

  const result = pickFusionSuggestionPair(
    [styleSkill, characterSkill, plotSkill],
    [
      { id: '1', novelId: 'n1', mountedSkillIds: ['style-1', 'char-1'], fitScore: 84, userAction: 'accepted', createdAt: 1 },
      { id: '2', novelId: 'n1', mountedSkillIds: ['style-1', 'char-1'], fitScore: 86, userAction: 'accepted', createdAt: 2 },
      { id: '3', novelId: 'n1', mountedSkillIds: ['style-1', 'plot-1'], fitScore: 88, userAction: 'accepted', createdAt: 3 },
      { id: '4', novelId: 'n1', mountedSkillIds: ['style-1', 'plot-1'], fitScore: 82, userAction: 'accepted', createdAt: 4 },
      { id: '5', novelId: 'n1', mountedSkillIds: ['style-1', 'plot-1'], fitScore: 81, userAction: 'accepted', createdAt: 5 },
    ],
  );

  assert.ok(result);
  assert.equal(result?.mainSkill.id, 'style-1');
  assert.equal(result?.supportSkill.id, 'plot-1');
  assert.equal(result?.acceptedCoMountCount, 3);
});

test('pickFusionSuggestionPair boosts pairs matching accepted dimensions in project profile', () => {
  const styleSkill = makeSkill({ id: 'style-1', name: '冷峻刀锋', stabilityScore: 92, primaryDimension: 'style' });
  const characterSkill = makeSkill({
    id: 'char-1',
    name: '压抑对峙',
    stabilityScore: 83,
    primaryDimension: 'character',
    dimensionTags: ['character'],
  });
  const plotSkill = makeSkill({
    id: 'plot-1',
    name: '紧逼推进',
    stabilityScore: 75,
    primaryDimension: 'plot',
    dimensionTags: ['plot'],
  });

  // Both pairs have same co-mount count, but project prefers plot dimension
  const result = pickFusionSuggestionPair(
    [styleSkill, characterSkill, plotSkill],
    [
      { id: '1', novelId: 'n1', mountedSkillIds: ['style-1', 'char-1'], fitScore: 84, userAction: 'accepted', createdAt: 1 },
      { id: '2', novelId: 'n1', mountedSkillIds: ['style-1', 'char-1'], fitScore: 86, userAction: 'accepted', createdAt: 2 },
      { id: '3', novelId: 'n1', mountedSkillIds: ['style-1', 'plot-1'], fitScore: 88, userAction: 'accepted', createdAt: 3 },
      { id: '4', novelId: 'n1', mountedSkillIds: ['style-1', 'plot-1'], fitScore: 82, userAction: 'accepted', createdAt: 4 },
    ],
    {
      tags: ['更重冲突推进'],
      weights: { styleWeight: 0.8, characterWeight: 0.5, worldWeight: 0.5, plotWeight: 0.8, pacingWeight: 0.5 },
      acceptedDimensions: ['style', 'plot'],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 3,
    },
  );

  assert.ok(result);
  // plot-1 should win as support because plot is accepted and character is neutral
  assert.equal(result?.supportSkill.id, 'plot-1');
  assert.equal(result?.acceptedCoMountCount, 2);
});

test('pickFusionSuggestionPair deprioritizes pairs with rejected dimensions', () => {
  const styleSkill = makeSkill({ id: 'style-1', name: '冷峻刀锋', stabilityScore: 88, primaryDimension: 'style' });
  const characterSkill = makeSkill({
    id: 'char-1',
    name: '压抑对峙',
    stabilityScore: 85,
    primaryDimension: 'character',
    dimensionTags: ['character'],
  });
  const pacingSkill = makeSkill({
    id: 'pacing-1',
    name: '散文化慢节奏',
    stabilityScore: 90,
    primaryDimension: 'pacing',
    dimensionTags: ['pacing'],
  });

  // pacing is rejected by project, character pair should win despite lower stability
  const result = pickFusionSuggestionPair(
    [styleSkill, characterSkill, pacingSkill],
    [
      { id: '1', novelId: 'n1', mountedSkillIds: ['style-1', 'char-1'], fitScore: 84, userAction: 'accepted', createdAt: 1 },
      { id: '2', novelId: 'n1', mountedSkillIds: ['style-1', 'char-1'], fitScore: 86, userAction: 'accepted', createdAt: 2 },
      { id: '3', novelId: 'n1', mountedSkillIds: ['style-1', 'pacing-1'], fitScore: 88, userAction: 'accepted', createdAt: 3 },
      { id: '4', novelId: 'n1', mountedSkillIds: ['style-1', 'pacing-1'], fitScore: 82, userAction: 'accepted', createdAt: 4 },
    ],
    {
      tags: ['不偏慢铺陈'],
      weights: { styleWeight: 0.8, characterWeight: 0.5, worldWeight: 0.5, plotWeight: 0.5, pacingWeight: 0.3 },
      acceptedDimensions: ['style'],
      rejectedDimensions: ['pacing'],
      notes: ['慢节奏不适合这个项目'],
      evidenceCount: 4,
    },
  );

  assert.ok(result);
  // character should win over pacing because pacing is rejected
  assert.equal(result?.supportSkill.id, 'char-1');
});

test('pickFusionSuggestionPair uses role-aware preference boost beyond explicit primary dimension', () => {
  const styleSkill = makeSkill({
    id: 'style-1',
    name: '冷峻刀锋',
    stabilityScore: 88,
    primaryDimension: 'style',
  });
  const hybridPlotSkill = makeSkill({
    id: 'hybrid-plot',
    name: '隐性推进卡',
    stabilityScore: 82,
    primaryDimension: 'character',
    dimensionTags: ['character'],
    compositionProfile: {
      styleWeight: 0.2,
      characterWeight: 0.7,
      worldWeight: 0.2,
      powerWeight: 0.2,
      plotWeight: 0.82,
      pacingWeight: 0.4,
      conflictTags: [],
      blendHints: [],
    },
  });
  const plainCharacterSkill = makeSkill({
    id: 'char-1',
    name: '人物对峙',
    stabilityScore: 84,
    primaryDimension: 'character',
    dimensionTags: ['character'],
  });

  const result = pickFusionSuggestionPair(
    [styleSkill, hybridPlotSkill, plainCharacterSkill],
    [
      { id: '1', novelId: 'n1', mountedSkillIds: ['style-1', 'hybrid-plot'], fitScore: 84, userAction: 'accepted', createdAt: 1 },
      { id: '2', novelId: 'n1', mountedSkillIds: ['style-1', 'hybrid-plot'], fitScore: 86, userAction: 'accepted', createdAt: 2 },
      { id: '3', novelId: 'n1', mountedSkillIds: ['style-1', 'char-1'], fitScore: 84, userAction: 'accepted', createdAt: 3 },
      { id: '4', novelId: 'n1', mountedSkillIds: ['style-1', 'char-1'], fitScore: 86, userAction: 'accepted', createdAt: 4 },
    ],
    {
      tags: ['更重剧情推进力度'],
      weights: { styleWeight: 0.6, characterWeight: 0.5, worldWeight: 0.5, plotWeight: 0.8, pacingWeight: 0.5 },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 4,
    },
  );

  assert.ok(result);
  assert.equal(result?.supportSkill.id, 'hybrid-plot');
});
