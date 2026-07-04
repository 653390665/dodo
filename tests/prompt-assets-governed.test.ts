import test from 'node:test';
import assert from 'node:assert/strict';

import {
  whiteLabelSanitize,
  sanitizeGovernedPromptAsset,
  analyzeAndSanitize,
  promoteToRuntimeReady,
  isCoreBuiltInAsset,
  isUserOptionalAsset,
  validateAssetV2,
  GOVERNED_ASSETS_V2_REGISTRY,
  recommendPromptAssets,
  PROMPT_GOVERNANCE_CATALOG,
  SKILL_SERIES_FLOWS,
  getPromptAssetAction,
  recommendOpeningGovernance,
  getNovelCurrentStepId,
  getNovelCompletedStepIds,
  getNextFlowStep,
  inferNovelGovernanceProfile
} from '../shared/lib/prompt-assets-governed.js';
import type { GovernedPromptAsset } from '../shared/types/prompt-assets-governed.js';

test('whiteLabelSanitize physical deletion of WeChat IDs', () => {
  const inputs = [
    '想要了解更多，请联系微信号：wechat_123_abc',
    '微信 : my-vx-id-999，欢迎交流',
    '我的vx号:vx_id_001_test',
    '请添加WeChat: wechat123456',
  ];

  for (const input of inputs) {
    const output = whiteLabelSanitize(input);
    // 物理白标清洗机制：不仅抹除微信号，连带其前缀和后缀相关的无意义推广修饰词（如想要了解更多、欢迎交流等）整体抹去，结果必须完全为空
    assert.equal(output, '');
  }
});

test('whiteLabelSanitize physical deletion of QQ groups', () => {
  const input1 = '加入我们的QQ群：987654321 获取最新小说资讯';
  const output1 = whiteLabelSanitize(input1);
  assert.equal(output1.includes('987654321'), false);
  assert.equal(output1.includes('QQ群'), false);
  assert.equal(output1.includes('***'), false);

  const input2 = '有问题请加Q群: 123456789';
  const output2 = whiteLabelSanitize(input2);
  assert.equal(output2.includes('123456789'), false);
  assert.equal(output2.includes('Q群'), false);
});

test('whiteLabelSanitize physical deletion of phone numbers and emails', () => {
  const input1 = '联系电话: 13812345678 或者 021-65432100';
  const output1 = whiteLabelSanitize(input1);
  assert.equal(output1.includes('13812345678'), false);
  assert.equal(output1.includes('021-65432100'), false);
  assert.equal(output1.includes('***'), false);

  const input2 = '客服邮箱: support_team@inkflow.com';
  const output2 = whiteLabelSanitize(input2);
  assert.equal(output2.includes('support_team@inkflow.com'), false);
});

test('whiteLabelSanitize physical deletion of competitor brand watermarks', () => {
  const inputs = [
    '这是由墨流写作软件生成的默认模板',
    '推荐使用墨流小说写作助手，体验极佳',
    '墨流编辑器是一款好工具',
    'Moliu is a writing assistant competitor.',
  ];

  for (const input of inputs) {
    const output = whiteLabelSanitize(input);
    assert.equal(output.includes('墨流'), false);
    assert.equal(output.toLowerCase().includes('moliu'), false);
    assert.equal(output.includes('***'), false);
  }
});

test('whiteLabelSanitize physical deletion of author real names and badges', () => {
  const inputs = [
    '【风华出品】长篇奇幻小说写作Prompt模板',
    '风华出品的克苏鲁世界观大纲生成器',
    '沐殇专用的高燃对白微调指令',
    '乐乐乐专用的白描精修器',
    '这是牧殇角色提示词，用于塑造饱满配角',
    '作者：风华，版权所有',
    'by:沐殇, 转载请注明',
    'fire定制的黄金三章开局套路',
  ];

  for (const input of inputs) {
    const output = whiteLabelSanitize(input);
    assert.equal(output.includes('风华'), false);
    assert.equal(output.includes('沐殇'), false);
    assert.equal(output.includes('乐乐乐'), false);
    assert.equal(output.includes('fire'), false);
    assert.equal(output.includes('牧殇'), false);
    assert.equal(output.includes('【'), false);
    assert.equal(output.includes('】'), false);
    assert.equal(output.includes('***'), false);
  }
});

test('sanitizeGovernedPromptAsset recursive properties cleaning', () => {
  const rawAsset: GovernedPromptAsset = {
    id: 'test-custom-001',
    title: '【风华出品】克苏鲁正文精修（微信：wx_123_abc）',
    stage: 'polish',
    goal: '清理墨流编辑器残存的翻译腔（微信号: vx_moliu_999）',
    inputs: ['content'],
    template: '你现在是资深小说主编，清除段落中的冗余字眼。作者：风华。Q群: 88888888。',
    outputShape: 'plain-text',
    riskNotes: [
      '由于是风华定制版，需要防误伤。',
      '注意邮箱 test@test.com 安全。'
    ],
    successSignal: '去AI味明显，且不含风华出品痕迹。',
    licenseStatus: 'user-authorized',
    sanitizationStatus: 'needs-sanitization',
    runtimeStatus: 'candidate',
    placementTier: 'sanitize-required'
  };

  const sanitized = sanitizeGovernedPromptAsset(rawAsset);

  // 状态自动扭转为 sanitized
  assert.equal(sanitized.sanitizationStatus, 'sanitized');

  // 所有核心文本字段必须没有作者信息、微信号、QQ群、竞品信息等
  assert.equal(sanitized.title.includes('风华'), false);
  assert.equal(sanitized.title.includes('wx_123_abc'), false);

  assert.equal(sanitized.goal.includes('墨流'), false);
  assert.equal(sanitized.goal.includes('vx_moliu_999'), false);

  assert.equal(sanitized.template.includes('风华'), false);
  assert.equal(sanitized.template.includes('88888888'), false);

  assert.equal(sanitized.riskNotes[0].includes('风华'), false);
  assert.equal(sanitized.riskNotes[1].includes('test@test.com'), false);

  assert.equal(sanitized.successSignal.includes('风华'), false);

  // 确保绝无脱敏保留字
  const allTexts = [
    sanitized.title,
    sanitized.goal,
    sanitized.template,
    ...sanitized.riskNotes,
    sanitized.successSignal
  ].join(' ');

  assert.equal(allTexts.includes('***'), false);
  assert.equal(allTexts.includes('脱敏'), false);
  assert.equal(allTexts.includes('微信'), false);
  assert.equal(allTexts.includes('QQ群'), false);
});

test('analyzeAndSanitize counts hits accurately across categories', () => {
  const text = '微信号：vx_123, QQ群：999999, 墨流编辑器助手。作者：风华，水水印。';
  const { sanitizedText, hits } = analyzeAndSanitize(text);

  // 微信与QQ群 -> contacts (1 + 1 = 2)
  assert.equal(hits.contacts, 2);
  // 墨流编辑器助手 -> brands (1)
  assert.equal(hits.brands, 1);
  // 作者：风华 -> authors (1)
  assert.equal(hits.authors, 1);
  // 水水印 -> watermarks (1)
  assert.equal(hits.watermarks, 1);

  // 确认清洗后不含这些敏感词
  assert.equal(sanitizedText.includes('vx_123'), false);
  assert.equal(sanitizedText.includes('999999'), false);
  assert.equal(sanitizedText.includes('墨流'), false);
  assert.equal(sanitizedText.includes('风华'), false);
  assert.equal(sanitizedText.includes('水水印'), false);
});

test('fire context-locked sanitization safeguards normal English words', () => {
  const inputsNormal = [
    'The building is on fire.',
    'He sets a fire in the fireplace.',
    'The campfire was cozy.',
    'Rapid fire action chain.',
  ];

  for (const input of inputsNormal) {
    const output = whiteLabelSanitize(input);
    // 普通上下文的 "fire" 必须完好无损，严禁误伤
    assert.equal(output.toLowerCase().includes('fire'), true, `Should NOT sanitize "fire" in: "${input}"`);
  }

  const inputsCustom = [
    '【fire出品】黄金三章大纲模板',
    '这是由fire定制的玄幻开局指令',
    '作者：fire出品的提示词',
    '由 by fire 专门设计',
  ];

  for (const input of inputsCustom) {
    const output = whiteLabelSanitize(input);
    // 明显的定制声明上下文中的 "fire" 必须彻底物理抹除
    assert.equal(output.toLowerCase().includes('fire'), false, `Should sanitize "fire" in custom context: "${input}"`);
  }
});

test('promoteToRuntimeReady safety promotion routing and grades', () => {
  const rawAsset: GovernedPromptAsset = {
    id: 'test-prom-01',
    title: '审稿工具',
    stage: 'review',
    goal: '检查AI味',
    inputs: ['content'],
    template: '检查：',
    outputShape: 'plain-text',
    riskNotes: [],
    successSignal: '',
    licenseStatus: 'user-authorized',
    sanitizationStatus: 'needs-sanitization', // 初始未清洗
    runtimeStatus: 'candidate',
    placementTier: 'sanitize-required'
  };

  // 1. 尝试直接对未清洗资产执行跃迁，应该抛错
  assert.throws(() => {
    promoteToRuntimeReady(rawAsset, 95);
  }, /must be sanitized before promoting/);

  // 2. 模拟物理清洗
  const sanitized = sanitizeGovernedPromptAsset(rawAsset);
  assert.equal(sanitized.sanitizationStatus, 'sanitized');

  // 3. 传入 >= 90 评分跃迁，升级至 Grade A + active + runtime-ready
  const promotedA = promoteToRuntimeReady(sanitized, 95);
  assert.equal(promotedA.grade, 'A');
  assert.equal(promotedA.score, 95);
  assert.equal(promotedA.sanitizationStatus, 'runtime-ready');
  assert.equal(promotedA.runtimeStatus, 'active');

  // 4. 传入 75 评分跃迁，升级至 Grade C + active + runtime-ready
  const promotedC = promoteToRuntimeReady(sanitized, 75);
  assert.equal(promotedC.grade, 'C');
  assert.equal(promotedC.sanitizationStatus, 'runtime-ready');
  assert.equal(promotedC.runtimeStatus, 'active');

  // 5. 传入 < 70 评分跃迁，不达标，拒绝 runtime-ready，状态为 sanitized 且 runtimeStatus 置为 rejected
  const rejected = promoteToRuntimeReady(sanitized, 55);
  assert.equal(rejected.grade, 'F');
  assert.equal(rejected.sanitizationStatus, 'sanitized');
  assert.equal(rejected.runtimeStatus, 'rejected');
});

test('isCoreBuiltInAsset and isUserOptionalAsset segment assets correctly', () => {
  const coreAsset: GovernedPromptAsset = {
    id: 'core-01',
    title: '去AI味',
    stage: 'polish',
    goal: '修饰',
    inputs: ['content'],
    template: '段落',
    outputShape: 'plain-text',
    riskNotes: [],
    successSignal: '',
    licenseStatus: 'built-in',
    sanitizationStatus: 'sanitized',
    runtimeStatus: 'active',
    placementTier: 'core-default'
  };

  const optionalAsset: GovernedPromptAsset = {
    id: 'opt-01',
    title: '玄幻风格包',
    stage: 'polish',
    goal: '修饰玄幻',
    inputs: ['content'],
    template: '玄幻段落',
    outputShape: 'plain-text',
    riskNotes: [],
    successSignal: '',
    licenseStatus: 'user-authorized',
    sanitizationStatus: 'sanitized',
    runtimeStatus: 'active',
    placementTier: 'optional-style'
  };

  assert.equal(isCoreBuiltInAsset(coreAsset), true);
  assert.equal(isUserOptionalAsset(coreAsset), false);

  assert.equal(isCoreBuiltInAsset(optionalAsset), false);
  assert.equal(isUserOptionalAsset(optionalAsset), true);
});

test('validateAssetV2 validator rules', () => {
  // Correct V2 asset
  const validAsset: GovernedPromptAsset = {
    id: 'v2-valid-01',
    title: 'V2 Valid Asset',
    stage: 'polish',
    goal: 'None',
    inputs: [],
    template: 'None',
    outputShape: 'plain-text',
    riskNotes: [],
    successSignal: 'None',
    licenseStatus: 'built-in',
    sanitizationStatus: 'runtime-ready',
    runtimeStatus: 'active',
    placementTier: 'core-default',
    score: 95,
    grade: 'A',
    primaryCategory: 'quality-guardrail',
    isWhiteLabeled: true,
    isRuntimeReady: true,
    sourceType: 'built-in'
  };

  assert.equal(validateAssetV2(validAsset), true);

  // 1. Missing primaryCategory
  const missingCategory = { ...validAsset, primaryCategory: undefined };
  assert.equal(validateAssetV2(missingCategory as any), false);

  // 2. Missing sourceType
  const missingSource = { ...validAsset, sourceType: undefined };
  assert.equal(validateAssetV2(missingSource as any), false);

  // 3. runtime-ready but isWhiteLabeled === false
  const unwhitelabeledReady = { ...validAsset, isWhiteLabeled: false };
  assert.equal(validateAssetV2(unwhitelabeledReady), false);

  // 4. runtime-ready but isRuntimeReady === false
  const unreadyReady = { ...validAsset, isRuntimeReady: false };
  assert.equal(validateAssetV2(unreadyReady), false);

  // 5. runtime-ready but grade is 'F' / score < 60
  const failingGradeReady = { ...validAsset, grade: 'F', score: 50 };
  assert.equal(validateAssetV2(failingGradeReady as any), false);

  // 6. needs-sanitization but isWhiteLabeled === true
  const rawAssetWithWhiteLabel: GovernedPromptAsset = {
    ...validAsset,
    sanitizationStatus: 'needs-sanitization',
    isWhiteLabeled: true
  };
  assert.equal(validateAssetV2(rawAssetWithWhiteLabel), false);
});

test('GOVERNED_ASSETS_V2_REGISTRY assets pass validation', () => {
  assert.ok(GOVERNED_ASSETS_V2_REGISTRY.length >= 4);
  for (const asset of GOVERNED_ASSETS_V2_REGISTRY) {
    assert.equal(validateAssetV2(asset), true, `Asset ${asset.id} should pass V2 validation`);
  }
});

test('Prompt Governance Catalog & Selector V2 checks', () => {
  // 1. 物理来源分组精确断言资产数量
  const builtInCount = PROMPT_GOVERNANCE_CATALOG.filter(a => a.sourceGroup === 'built-in').length;
  const squareCount = PROMPT_GOVERNANCE_CATALOG.filter(a => a.sourceGroup === 'square').length;
  const privateCount = PROMPT_GOVERNANCE_CATALOG.filter(a => a.sourceGroup === 'private').length;
  const toolCount = PROMPT_GOVERNANCE_CATALOG.filter(a => a.sourceGroup === 'tool').length;
  const supplementCount = PROMPT_GOVERNANCE_CATALOG.filter(a => a.sourceGroup === 'fanqie-supplement').length;
  const testFixtureCount = PROMPT_GOVERNANCE_CATALOG.filter(a => a.evidenceLevel === 'test-fixture').length;

  assert.equal(builtInCount, 11, `Built-in assets count should be exactly 11, got ${builtInCount}`);
  assert.equal(squareCount, 50, `Square assets count should be exactly 50, got ${squareCount}`);
  assert.equal(privateCount, 78, `Private assets count should be exactly 78, got ${privateCount}`);
  assert.equal(toolCount, 16, `Creative/tool assets count should be exactly 16, got ${toolCount}`);
  assert.equal(supplementCount, 16, `Platform supplement assets count should be exactly 16, got ${supplementCount}`);
  assert.equal(testFixtureCount, 2, `Test fixture assets count should be exactly 2, got ${testFixtureCount}`);
  assert.equal(PROMPT_GOVERNANCE_CATALOG.length, 173, `Total catalog size should be exactly 173, got ${PROMPT_GOVERNANCE_CATALOG.length}`);

  // 2. 断言安全过滤拦截：
  const allRecommended = recommendPromptAssets({ currentStage: 'planning' });
  const unsafeAssets = PROMPT_GOVERNANCE_CATALOG.filter(
    asset =>
      asset.placementTier === 'sanitize-required' ||
      asset.placementTier === 'research-only' ||
      asset.isWhiteLabeled === false
  );

  assert.ok(unsafeAssets.length > 0, 'Unsafe assets should exist in catalog for testing filter logic');
  for (const unsafe of unsafeAssets) {
    const recommendedContainsUnsafe = allRecommended.some(a => a.id === unsafe.id);
    assert.equal(recommendedContainsUnsafe, false, `Recommended list must not contain unsafe asset: ${unsafe.id}`);
  }

  // 3. 断言高分去重优先：
  const polishRecommended = recommendPromptAssets({ currentStage: 'polish' });
  const guardrailsRecommended = polishRecommended.filter(a => a.primaryCategory === 'quality-guardrail');
  if (guardrailsRecommended.length > 1) {
    const maxScore = Math.max(...PROMPT_GOVERNANCE_CATALOG.filter(a => a.primaryCategory === 'quality-guardrail' && a.isWhiteLabeled && a.isRuntimeReady).map(a => a.score || 0));
    for (const asset of guardrailsRecommended) {
      assert.ok((asset.score || 0) >= maxScore, `Asset ${asset.id} score (${asset.score}) should be equal to max score ${maxScore} in its category`);
    }
  }

  // 4. 场景推荐测试：
  // 4.1 番茄开书
  const tomatoOpeningRec = recommendPromptAssets({
    targetPlatform: 'tomato',
    genreTags: ['fantasy'],
    currentStage: 'planning',
    activeSeriesId: 'tomato-platform-flow'
  });
  const hasTomatoOpeningValidator = tomatoOpeningRec.some(a => a.id === 'tomato-opening-validator');
  assert.equal(hasTomatoOpeningValidator, true, 'Tomato planning scenario should recommend tomato-opening-validator');

  // 4.2 长篇通用
  const genericNovelRec = recommendPromptAssets({
    currentStage: 'planning',
    activeSeriesId: 'generic-novel-flow'
  });
  const hasGenericOutlineBuilder = genericNovelRec.some(a => a.id === 'generateOutline');
  assert.equal(hasGenericOutlineBuilder, true, 'Generic novel flow planning stage should recommend generateOutline');

  // 4.3 写完一章
  const polishRec = recommendPromptAssets({
    currentStage: 'polish'
  });
  const firstRecommended = polishRec[0];
  assert.ok(firstRecommended, 'Polish recommended list should not be empty');
  assert.equal(firstRecommended.id, 'core-slop-shield', 'First recommended asset for polish stage must be core-slop-shield');

  // 4.4 卡文挂载（特定拆书卡推荐）
  const cardRec = recommendPromptAssets({
    genreTags: ['fantasy'],
    currentStage: 'planning'
  });
  const hasDeconstructCard = cardRec.some(a => a.id.startsWith('deconstruct-card-'));
  assert.equal(hasDeconstructCard, true, 'Enhancements recommendation should contain at least one deconstruct-card-* asset');

  // 5. 校验推荐原因和动态文案
  for (const asset of tomatoOpeningRec) {
    assert.ok(asset.recommendationReason, `Recommended asset ${asset.id} must have recommendationReason`);
    assert.ok(
      asset.recommendationReason.includes('番茄') ||
      asset.recommendationReason.includes('流程') ||
      asset.recommendationReason.includes('底线'),
      `recommendationReason '${asset.recommendationReason}' must contain expected context tags`
    );
  }
});

test('recommendPromptAssets is side-effect free, immutable and idempotent (V2.1.1 stability)', () => {
  // 1. 调用前确认目录大库资产对象没有 recommendationReason
  for (const asset of PROMPT_GOVERNANCE_CATALOG) {
    assert.equal(asset.recommendationReason, undefined, `Catalog asset ${asset.id} should NOT have recommendationReason before any recommendation call`);
  }

  // 2. 调用推荐函数
  const input = { currentStage: 'polish' as const };
  const res1 = recommendPromptAssets(input);

  // 3. 调用后，确认返回的每一个结果都有 recommendationReason
  assert.ok(res1.length > 0);
  for (const asset of res1) {
    assert.ok(asset.recommendationReason, `Returned asset ${asset.id} must have recommendationReason`);
  }

  // 4. 再次检查，大库原资产仍没有被污染
  for (const asset of PROMPT_GOVERNANCE_CATALOG) {
    assert.equal(asset.recommendationReason, undefined, `Catalog asset ${asset.id} should remain untouched (no side-effects)`);
  }

  // 5. 连续调用两次，确认推荐 ID 和顺序完全一致（幂等性）
  const res2 = recommendPromptAssets(input);
  assert.equal(res1.length, res2.length, 'Idempotency check: result lengths should match');
  for (let i = 0; i < res1.length; i++) {
    assert.equal(res1[i].id, res2[i].id, `Idempotency check at index ${i}: assets should be identical`);
    assert.equal(res1[i].recommendationReason, res2[i].recommendationReason, `Idempotency check at index ${i}: recommendationReason should match`);
  }
});

test('getPromptAssetAction maps asset kinds correctly', () => {
  // Test 1: sanitize-required or research-only or test-fixture -> null
  const assetSanitize: Partial<GovernedPromptAsset> & { id: string } = {
    id: 'some-asset',
    title: 'Test',
    template: 'Test',
    placementTier: 'sanitize-required',
    licenseStatus: 'built-in',
    sanitizationStatus: 'raw',
    runtimeStatus: 'active'
  };
  assert.equal(getPromptAssetAction(assetSanitize), null);

  const assetResearch: Partial<GovernedPromptAsset> & { id: string } = {
    id: 'some-asset',
    title: 'Test',
    template: 'Test',
    placementTier: 'research-only',
    licenseStatus: 'built-in',
    sanitizationStatus: 'raw',
    runtimeStatus: 'active'
  };
  assert.equal(getPromptAssetAction(assetResearch), null);

  const assetFixture: Partial<GovernedPromptAsset> & { id: string } = {
    id: 'test-fixture-123',
    title: 'Test',
    template: 'Test',
    placementTier: 'core-default',
    licenseStatus: 'built-in',
    sanitizationStatus: 'raw',
    runtimeStatus: 'active'
  };
  assert.equal(getPromptAssetAction(assetFixture), null);

  // Test 2: Deconstruction card -> deconstruction-card
  const assetDeconstruct1: Partial<GovernedPromptAsset> & { id: string } = {
    id: 'deconstruct-card-abc',
    title: 'Test',
    template: 'Test',
    placementTier: 'core-default',
    licenseStatus: 'built-in',
    sanitizationStatus: 'raw',
    runtimeStatus: 'active'
  };
  assert.equal(getPromptAssetAction(assetDeconstruct1), 'deconstruction-card');

  const assetDeconstruct2: Partial<GovernedPromptAsset> & { id: string } = {
    id: 'some-id',
    title: 'Test',
    template: 'Test',
    placementTier: 'core-default',
    licenseStatus: 'built-in',
    sanitizationStatus: 'raw',
    runtimeStatus: 'active',
    deconstructionCardType: 'worldview-card'
  };
  assert.equal(getPromptAssetAction(assetDeconstruct2), 'deconstruction-card');

  // Test 3: Quality guardrails
  const assetRewrite: Partial<GovernedPromptAsset> & { id: string } = {
    id: 'core-slop-shield',
    title: 'Test',
    template: 'Test',
    placementTier: 'core-default',
    primaryCategory: 'quality-guardrail',
    licenseStatus: 'built-in',
    sanitizationStatus: 'raw',
    runtimeStatus: 'active'
  };
  assert.equal(getPromptAssetAction(assetRewrite), 'polish-rewrite');

  const assetAudit: Partial<GovernedPromptAsset> & { id: string } = {
    id: 'general-audit',
    title: 'Test',
    template: 'Test',
    placementTier: 'core-default',
    primaryCategory: 'quality-guardrail',
    licenseStatus: 'built-in',
    sanitizationStatus: 'raw',
    runtimeStatus: 'active'
  };
  assert.equal(getPromptAssetAction(assetAudit), 'audit-enhance');

  // Test 4: Author workflow -> open-flow-step
  const assetWorkflow: Partial<GovernedPromptAsset> & { id: string } = {
    id: 'workflow-abc',
    title: 'Test',
    template: 'Test',
    placementTier: 'core-default',
    primaryCategory: 'author-workflow',
    licenseStatus: 'built-in',
    sanitizationStatus: 'raw',
    runtimeStatus: 'active'
  };
  assert.equal(getPromptAssetAction(assetWorkflow), 'open-flow-step');

  // Test 5: Style reference or constellation pack -> mount-skill
  const assetStyle: Partial<GovernedPromptAsset> & { id: string } = {
    id: 'style-abc',
    title: 'Test',
    template: 'Test',
    placementTier: 'core-default',
    primaryCategory: 'style-reference',
    licenseStatus: 'built-in',
    sanitizationStatus: 'raw',
    runtimeStatus: 'active'
  };
  assert.equal(getPromptAssetAction(assetStyle), 'mount-skill');

  const assetPack: Partial<GovernedPromptAsset> & { id: string } = {
    id: 'pack-abc',
    title: 'Test',
    template: 'Test',
    placementTier: 'core-default',
    primaryCategory: 'constellation-pack',
    licenseStatus: 'built-in',
    sanitizationStatus: 'raw',
    runtimeStatus: 'active'
  };
  assert.equal(getPromptAssetAction(assetPack), 'mount-skill');
});

test('recommendOpeningGovernance matches different creation scenarios correctly', () => {
  // Scenario 1: 番茄玄幻长篇
  const recTomato = recommendOpeningGovernance({
    ideaSeed: '这是一个番茄修仙小说，带系统和重生',
    title: '修仙之我有无限寿元',
    targetWordCount: 200000
  });
  assert.equal(recTomato.activeSeriesId, 'tomato-platform-flow');
  assert.equal(recTomato.targetPlatform, 'tomato');
  assert.ok(recTomato.tagsToApply.includes('番茄'));
  assert.ok(recTomato.genreTags.includes('cultivation'));
  assert.ok(recTomato.tagsToApply.includes('修仙'));

  // Scenario 2: 不确定平台长篇 (通用流)
  const recGeneric = recommendOpeningGovernance({
    ideaSeed: '一个凡人修仙传风格的长篇作品',
    title: '凡人问道',
    targetWordCount: 500000
  });
  assert.equal(recGeneric.activeSeriesId, 'generic-novel-flow');
  assert.equal(recGeneric.targetPlatform, undefined);
  assert.ok(!recGeneric.tagsToApply.includes('番茄'));

  // Scenario 3: 小飞鸡定制流长篇
  const recXiaofeiji = recommendOpeningGovernance({
    ideaSeed: '小飞鸡流，高武玄幻脑洞设定',
    title: '武道通天',
    targetWordCount: 300000
  });
  assert.equal(recXiaofeiji.activeSeriesId, 'xiaofeiji-novel-flow');
  assert.ok(recXiaofeiji.tagsToApply.includes('小飞鸡'));

  // Scenario 4: 短篇/知乎/老福特 拦截平台推荐
  const recShortZhihu = recommendOpeningGovernance({
    ideaSeed: '知乎短篇：重生在手撕绿茶系统那天',
    title: '手撕绿茶系统',
    targetWordCount: 15000
  });
  // 即使包含“系统”、“重生”，也应该因为“知乎短篇”或者字数小于 5w 被拦截，退回通用流
  assert.equal(recShortZhihu.activeSeriesId, 'generic-novel-flow');
  assert.equal(recShortZhihu.targetPlatform, undefined);
  assert.ok(!recShortZhihu.tagsToApply.includes('番茄'));

  // Scenario 5: 题材包识别与上限控制 (最多推荐2个)
  const recGenres = recommendOpeningGovernance({
    ideaSeed: '科幻，悬疑，言情，都市，末世大乱斗',
    title: '大杂烩',
    targetWordCount: 100000
  });
  assert.ok(recGenres.genreTags.length <= 2, 'Genre tags count should be capped at 2');
});

test('Skill Series Flow sequence progression, steps fields and pointer calculators work correctly', () => {
  // 1. 验证三大主创作系列注册表完整性与字段
  const xiaofeiji = SKILL_SERIES_FLOWS.find(f => f.id === 'xiaofeiji-novel-flow');
  assert.ok(xiaofeiji);
  assert.equal(xiaofeiji.steps.length, 8);
  for (const s of xiaofeiji.steps) {
    assert.ok(s.id);
    assert.ok(s.qualityGate);
    assert.ok('nextStepId' in s);
    assert.equal(typeof s.switchAllowed, 'boolean');
  }

  const generic = SKILL_SERIES_FLOWS.find(f => f.id === 'generic-novel-flow');
  assert.ok(generic);
  assert.equal(generic.steps.length, 6);

  const tomato = SKILL_SERIES_FLOWS.find(f => f.id === 'tomato-platform-flow');
  assert.ok(tomato);
  assert.equal(tomato.steps.length, 5);

  // 2. 验证 getNovelCurrentStepId
  const mockNovelEmpty: any = { id: '1', title: 'Empty', projectPreferenceProfile: { tags: [] } };
  const stepId1 = getNovelCurrentStepId(mockNovelEmpty, 'xiaofeiji-novel-flow');
  assert.equal(stepId1, 'xiaofeiji-novel-flow-step1');

  const mockNovelWithActive: any = {
    id: '2',
    title: 'Active',
    projectPreferenceProfile: {
      tags: ['current-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step3']
    }
  };
  const stepId3 = getNovelCurrentStepId(mockNovelWithActive, 'xiaofeiji-novel-flow');
  assert.equal(stepId3, 'xiaofeiji-novel-flow-step3');

  // 3. 验证 getNovelCompletedStepIds
  const mockNovelCompleted: any = {
    id: '3',
    title: 'Completed',
    projectPreferenceProfile: {
      tags: [
        'completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step1',
        'completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step2',
        'completed-step:other-flow:some-step'
      ]
    }
  };
  const completedIds = getNovelCompletedStepIds(mockNovelCompleted, 'xiaofeiji-novel-flow');
  assert.deepEqual(completedIds, ['xiaofeiji-novel-flow-step1', 'xiaofeiji-novel-flow-step2']);

  // 4. 验证 getNextFlowStep 向前推演
  // case 4.1: currentStage 在步骤中，有 nextStepId
  const nextStepFrom1 = getNextFlowStep('xiaofeiji-novel-flow', 'xiaofeiji-novel-flow-step1', []);
  assert.ok(nextStepFrom1);
  assert.equal(nextStepFrom1.id, 'xiaofeiji-novel-flow-step2');

  // case 4.2: currentStage 在尾步骤，无 nextStepId
  const nextStepFrom8 = getNextFlowStep('xiaofeiji-novel-flow', 'xiaofeiji-novel-flow-step8', []);
  assert.equal(nextStepFrom8, null);

  // case 4.3: currentStage 不是步骤 ID (非流程内标识)，Fallback 到第一个未完成的步骤
  const nextStepFallbackEmpty = getNextFlowStep('xiaofeiji-novel-flow', 'review', []);
  assert.ok(nextStepFallbackEmpty);
  assert.equal(nextStepFallbackEmpty.id, 'xiaofeiji-novel-flow-step1');

  const nextStepFallbackSome = getNextFlowStep('xiaofeiji-novel-flow', 'review', ['xiaofeiji-novel-flow-step1', 'xiaofeiji-novel-flow-step2']);
  assert.ok(nextStepFallbackSome);
  assert.equal(nextStepFallbackSome.id, 'xiaofeiji-novel-flow-step3');
});

test('recommendOpeningGovernance and inferNovelGovernanceProfile preset flows auto-routing works', () => {
  // 1. 测试 inferNovelGovernanceProfile (风华短篇 & 天马大纲)
  const novelFenghua: any = {
    id: 'n-fh',
    title: '我的老福特短篇小甜饼',
    summary: '高美感风华风',
    projectPreferenceProfile: { tags: [] }
  };
  const profileFenghua = inferNovelGovernanceProfile(novelFenghua);
  assert.equal(profileFenghua.activeSeriesId, 'fenghua-short-flow');

  const novelTianma: any = {
    id: 'n-tm',
    title: '天马行空的世界观',
    summary: '大纲节奏设定',
    projectPreferenceProfile: { tags: [] }
  };
  const profileTianma = inferNovelGovernanceProfile(novelTianma);
  assert.equal(profileTianma.activeSeriesId, 'tianma-outline-flow');

  // 2. 测试 recommendOpeningGovernance
  const recFenghua = recommendOpeningGovernance({
    ideaSeed: '一个在lofter上很火的短篇风华故事',
    title: '老福特短篇',
    targetWordCount: 20000
  });
  assert.equal(recFenghua.activeSeriesId, 'fenghua-short-flow');

  const recTianma = recommendOpeningGovernance({
    ideaSeed: '这是一个天马设定的故事，主线大纲',
    title: '大纲设定',
    targetWordCount: 150000
  });
  assert.equal(recTianma.activeSeriesId, 'tianma-outline-flow');
});


