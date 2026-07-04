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
  SKILL_SERIES_FLOWS
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
    // 必须被删除，且绝对不保留 [微信号] 或 *** 占位
    assert.equal(output.includes('wechat_123_abc'), false);
    assert.equal(output.includes('my-vx-id-999'), false);
    assert.equal(output.includes('vx_id_001_test'), false);
    assert.equal(output.includes('wechat123456'), false);
    assert.equal(output.includes('***'), false);
    assert.equal(output.includes('脱敏'), false);
    assert.equal(output.includes('微信号：'), false);
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
  // 1. 断言目录总数：断言 PROMPT_GOVERNANCE_CATALOG 长度至少在 149 以上。
  assert.ok(PROMPT_GOVERNANCE_CATALOG.length >= 149, `Catalog size should be at least 149, got ${PROMPT_GOVERNANCE_CATALOG.length}`);

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
  const hasGenericOutlineBuilder = genericNovelRec.some(a => a.id === 'generic-outline-builder-1');
  assert.equal(hasGenericOutlineBuilder, true, 'Generic novel flow planning stage should recommend generic-outline-builder-1');

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
});

