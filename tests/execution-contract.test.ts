import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_STAGE_MAP } from '../shared/types.js';
import { closeDb, createContinuationPack, createNovel, createSkill, initDb } from '../server/lib/db.js';
import { resolveProjectExecutionContract } from '../server/helpers/writing-style-service.js';
import { PROMPT_GOVERNANCE_CATALOG } from '../shared/lib/prompt-governance-catalog.js';

test('card stage map has one canonical owner for every supported card', () => {
  assert.deepEqual(CARD_STAGE_MAP['character-card'], ['planner']);
  assert.deepEqual(CARD_STAGE_MAP['hook-card'], ['planner']);
  assert.deepEqual(CARD_STAGE_MAP['conflict-card'], ['planner']);
  assert.deepEqual(CARD_STAGE_MAP['worldview-card'], ['planner']);
  assert.deepEqual(CARD_STAGE_MAP['style-card'], ['writer']);
  assert.deepEqual(CARD_STAGE_MAP['pacing-card'], ['planner', 'writer']);
  assert.deepEqual(CARD_STAGE_MAP['platform-card'], ['planner', 'writer']);
});

test('execution contract freezes one stage snapshot and sanitizes critic prompt', () => {
  closeDb(); initDb(':memory:');
  try {
    createSkill({ id: 'writer', name: 'WRITER_ID_SECRET', description: 'DESCRIPTION_SECRET', style: '克制短句', pacing: '紧凑推进', vocabulary: ['冷峻'], sentenceStructure: '短句为主', bannedWords: ['然后'], stabilityScore: 90, evaluationFeedback: 'USAGE_SECRET', version: 1, createdAt: 1 });
    createSkill({ id: 'critic', name: 'Critic', description: '', style: 'critic', pacing: '', stabilityScore: 90, evaluationFeedback: '', version: 1, createdAt: 1 });
    createNovel({ id: 'contract-novel', title: 'Contract', authorId: 'local', summary: '', status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [
      { slot: 1, skillId: 'writer', weight: 1, lockedDimensions: [] },
      { slot: 2, skillId: 'critic', weight: 1, lockedDimensions: [] },
    ], projectPreferenceProfile: { tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 }, acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0, skillLoadoutSchemaVersion: 2 }, createdAt: 1, updatedAt: 1 });
    const contract = resolveProjectExecutionContract('contract-novel');
    assert.equal(Object.isFrozen(contract), true);
    assert.deepEqual(Object.keys(contract).sort(), ['canon', 'capabilityRefs', 'databaseGeneration', 'flowStep', 'guardrails', 'novelId', 'overlays', 'resolvedAtGeneration', 'roleSkills', 'sessionCards', 'skillStack', 'stagePrompts', 'stageSkills', 'techniques', 'writingStyleFingerprint', 'writingStyleSummary'].sort());
    assert.equal(contract.databaseGeneration, 0);
    assert.deepEqual(contract.techniques, { planner: [], writer: [], critic: [] });
    assert.equal(contract.skillStack.mainCard, null);
    assert.equal(Object.isFrozen(contract.roleSkills.writer[0]), true);
    assert.doesNotMatch(JSON.stringify({ roleSkills: contract.roleSkills, stageSkills: contract.stageSkills, stagePrompts: contract.stagePrompts }), /WRITER_ID_SECRET|DESCRIPTION_SECRET|USAGE_SECRET|evaluationFeedback/);
    assert.equal('id' in (contract.roleSkills.writer[0] || {}), false);
    assert.equal(contract.flowStep, null);
    assert.equal(contract.stageSkills.writer[0]?.version, 1);
    assert.equal(contract.stageSkills.writer[0]?.rules.style, '克制短句');
    assert.equal(contract.stageSkills.writer[0]?.rules.pacing, '紧凑推进');
    assert.match(contract.stagePrompts.critic, /\{"style":"critic"\}/);
    assert.match(contract.stagePrompts.critic, /Critic Slot 2 规则/);
    assert.doesNotMatch(contract.stagePrompts.critic, /克制短句|紧凑推进/);
    assert.doesNotMatch(contract.stagePrompts.critic, /WRITER_ID_SECRET|DESCRIPTION_SECRET|USAGE_SECRET/);
    assert.match(contract.stagePrompts.critic, /写法契约标准/);
  } finally { closeDb(); }
});

test('writer stage prompt is a complete safe writer contract and deeply frozen', () => {
  closeDb(); initDb(':memory:');
  try {
    createSkill({ id: 'writer', name: 'WRITER_ID_SECRET', description: 'DESCRIPTION_SECRET', style: '克制基调', pacing: '递进节奏', stabilityScore: 90, evaluationFeedback: 'USAGE_SECRET', version: 2, createdAt: 1 });
    createNovel({ id: 'writer-contract', title: 'Contract', authorId: 'local', summary: '', status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [{ slot: 1, skillId: 'writer', weight: 1, lockedDimensions: [] }], projectPreferenceProfile: { tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 }, acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0, skillLoadoutSchemaVersion: 2, contract: { styleAnchors: ['冷峻', '短句'] } }, createdAt: 1, updatedAt: 1 });
    const contract = resolveProjectExecutionContract('writer-contract', { sessionCardIds: ['deconstruct-card-pacing'] });
    assert.match(contract.stagePrompts.writer, /冷峻|短句/);
    assert.match(contract.stagePrompts.writer, /项目基调 > 主笔能力卡 > 资料包/);
    assert.doesNotMatch(contract.stagePrompts.writer, /主笔技能组/);
    assert.match(contract.stagePrompts.writer, /节奏拆书卡/);
    assert.equal(contract.overlays.some((overlay) => contract.stagePrompts.writer.includes(overlay.prompt)), true);
    assert.equal(Object.isFrozen(contract.roleSkills.writer[0]?.rules), true);
    assert.equal(Object.isFrozen(contract.overlays[0]), true);
    assert.doesNotMatch(contract.stagePrompts.writer, /WRITER_ID_SECRET|DESCRIPTION_SECRET|USAGE_SECRET/);
  } finally { closeDb(); }
});

test('critic receives resolved writing contract standards without writer skill prompt', () => {
  closeDb(); initDb(':memory:');
  try {
    createSkill({ id: 'writer', name: 'WRITER_ID_SECRET', description: 'DESCRIPTION_SECRET', style: 'WRITER_STYLE_RULE', pacing: 'WRITER_PACING_RULE', vocabulary: ['WRITER_VOCAB_RULE'], sentenceStructure: 'WRITER_SENTENCE_RULE', bannedWords: ['WRITER_BANNED_RULE'], stabilityScore: 90, evaluationFeedback: 'USAGE_SECRET', version: 1, createdAt: 1 });
    createNovel({ id: 'critic-contract', title: 'Contract', authorId: 'local', summary: '', status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [{ slot: 1, skillId: 'writer', weight: 1, lockedDimensions: [] }], projectPreferenceProfile: { tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 }, acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0, skillLoadoutSchemaVersion: 2, contract: { styleAnchors: ['克制'] } }, createdAt: 1, updatedAt: 1 });
    const contract = resolveProjectExecutionContract('critic-contract');
    assert.match(contract.stagePrompts.critic, /项目基调|写法契约/);
    assert.match(contract.stagePrompts.critic, /模式：writer-skill|主笔优先/);
    assert.match(contract.stagePrompts.critic, /项目基调：克制/);
    assert.doesNotMatch(contract.stagePrompts.critic, /WRITER_STYLE_RULE|WRITER_PACING_RULE|WRITER_VOCAB_RULE|WRITER_SENTENCE_RULE|WRITER_BANNED_RULE/);
    assert.doesNotMatch(contract.stagePrompts.critic, /WRITER_ID_SECRET|DESCRIPTION_SECRET|USAGE_SECRET/);
  } finally { closeDb(); }
});

test('critic includes writer overlay rule text, not only its title', () => {
  closeDb(); initDb(':memory:');
  try {
    createNovel({ id: 'overlay-contract', title: 'Contract', authorId: 'local', summary: '', status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [], projectPreferenceProfile: { tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 }, acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0, skillLoadoutSchemaVersion: 2 }, createdAt: 1, updatedAt: 1 });
    const contract = resolveProjectExecutionContract('overlay-contract', { sessionCardIds: ['deconstruct-card-pacing'] });
    assert.match(contract.stagePrompts.critic, /本章写法卡规则/);
    assert.doesNotMatch(contract.stagePrompts.critic, /Writer overlay/);
    assert.match(contract.stagePrompts.critic, /节奏拆书卡/);
  } finally { closeDb(); }
});

test('flow step snapshot projects execution inputs and excludes pack style from canon context', () => {
  closeDb(); initDb(':memory:');
  try {
    createNovel({ id: 'flow-contract', title: 'Contract', authorId: 'local', summary: '', status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [], projectPreferenceProfile: { tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 }, acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0, skillLoadoutSchemaVersion: 2, activeSeriesId: 'xiaofeiji-novel-flow' }, createdAt: 1, updatedAt: 1 });
    createContinuationPack({ id: 'flow-pack', novelId: 'flow-contract', title: 'Pack', status: 'approved', sourceDocuments: [], canonFacts: [], characterStates: [], plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' }, styleProfile: { pov: '第一人称', tense: '现在时', pacing: '快', dialogueDensity: '高', proseTraits: ['STYLE_ONLY'], avoidTraits: [], sampleEvidence: '' }, contradictions: [], continuationTask: '续写任务', createdAt: 1, updatedAt: 1 });
    const contract = resolveProjectExecutionContract('flow-contract', { continuationPackId: 'flow-pack' });
    assert.ok(contract.flowStep);
    assert.equal(contract.flowStep?.name, '脑洞灵感闪耀');
    assert.equal(contract.flowStep?.input, 'idea');
    assert.equal(contract.flowStep?.output, 'hook-idea');
    assert.match(contract.flowStep?.prompt || '', /步骤输入.*idea/s);
    assert.match(contract.flowStep?.prompt || '', /预期输出.*hook-idea/s);
    assert.match(contract.flowStep?.prompt || '', /质量门/);
    assert.match(contract.flowStep?.prompt || '', /可运行资产 Prompt/);
    assert.equal(Object.isFrozen(contract.flowStep), true);
    assert.equal(Object.isFrozen(contract.canon.pack), true);
    assert.equal(Object.isFrozen(contract.canon.pack?.receipt), true);
    assert.equal(Object.isFrozen(contract.canon.pack?.receipt.sources), true);
    assert.doesNotMatch(contract.canon.pack?.context || '', /风格约束|STYLE_ONLY/);
    assert.match(contract.canon.pack?.context || '', /续写任务/);
  } finally { closeDb(); }
});

test('unavailable flow asset keeps step metadata and records a stable warning', () => {
  closeDb(); initDb(':memory:');
  const asset = PROMPT_GOVERNANCE_CATALOG.find((item) => item.id === 'square-182');
  assert.ok(asset);
  const original = {
    isRuntimeReady: asset.isRuntimeReady,
    runtimeStatus: asset.runtimeStatus,
    sanitizationStatus: asset.sanitizationStatus,
    template: asset.template,
  };
  try {
    asset.isRuntimeReady = false;
    createNovel({ id: 'flow-degraded', title: 'Contract', authorId: 'local', summary: '', status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [], projectPreferenceProfile: { tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 }, acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0, skillLoadoutSchemaVersion: 2, activeSeriesId: 'xiaofeiji-novel-flow' }, createdAt: 1, updatedAt: 1 });
    const contract = resolveProjectExecutionContract('flow-degraded');
    assert.ok(contract.flowStep);
    assert.equal(contract.flowStep?.warning, 'FLOW_STEP_ASSET_UNAVAILABLE');
    assert.match(contract.flowStep?.prompt || '', /步骤输入.*idea/s);
    assert.match(contract.flowStep?.prompt || '', /预期输出.*hook-idea/s);
    assert.match(contract.flowStep?.prompt || '', /质量门/);
    assert.doesNotMatch(contract.flowStep?.prompt || '', /可运行资产 Prompt/);
    assert.doesNotMatch(contract.flowStep?.prompt || '', new RegExp(original.template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    asset.isRuntimeReady = original.isRuntimeReady;
    asset.runtimeStatus = original.runtimeStatus;
    asset.sanitizationStatus = original.sanitizationStatus;
    asset.template = original.template;
    closeDb();
  }
});

test('flow prompt is routed to the asset stage only', () => {
  closeDb(); initDb(':memory:');
  try {
    createNovel({ id: 'writer-flow-contract', title: 'Contract', authorId: 'local', summary: '', status: 'ongoing', mountedSkillIds: [], mountedSkillLoadout: [], projectPreferenceProfile: { tags: ['current-step:generic-novel-flow:generic-novel-flow-step5'], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 }, acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0, skillLoadoutSchemaVersion: 2, activeSeriesId: 'generic-novel-flow' }, createdAt: 1, updatedAt: 1 });
    const contract = resolveProjectExecutionContract('writer-flow-contract');
    assert.equal(contract.flowStep?.stage, 'writer');
    assert.match(contract.stagePrompts.writer, /正文快速初稿/);
    assert.doesNotMatch(contract.stagePrompts.planner, /正文快速初稿/);
    assert.doesNotMatch(contract.stagePrompts.critic, /正文快速初稿/);
  } finally { closeDb(); }
});
