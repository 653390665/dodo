import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateExtractSkillInput,
  parseModelRefusal,
  scoreStyleGenericness,
  skillCardIsGeneric,
  extractAnchoringKeywords,
  scoreSkillOutputAnchoring,
  evaluateSkillFieldCompleteness,
  evaluateSkillOutputQuality,
} from '../src/lib/quality-gates';

// ============================================================================
// Layer 1: Input Gate tests
// ============================================================================

test('validateExtractSkillInput rejects empty string', () => {
  const result = validateExtractSkillInput('');
  assert.equal(result.accepted, false);
  assert.ok(result.rejectedReason);
});

test('validateExtractSkillInput rejects whitespace only', () => {
  const result = validateExtractSkillInput('   \n  \t 　 ');
  assert.equal(result.accepted, false);
});

test('validateExtractSkillInput rejects text with no Chinese characters', () => {
  const result = validateExtractSkillInput('Hello world 123 !@#$%');
  assert.equal(result.accepted, false);
  assert.ok(result.rejectedReason?.includes('未检测到中文'));
});

test('validateExtractSkillInput rejects pure punctuation', () => {
  const result = validateExtractSkillInput('。，！？、；：「」『』……——');
  assert.equal(result.accepted, false);
});

test('validateExtractSkillInput rejects too few Chinese characters', () => {
  const result = validateExtractSkillInput('雨夜。');
  assert.equal(result.accepted, false);
  assert.ok(result.rejectedReason?.includes('不足以'));
});

test('validateExtractSkillInput rejects character spam (repeated single char)', () => {
  // Spam check fires before minimum-length check now
  const result = validateExtractSkillInput('啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊');
  assert.equal(result.accepted, false);
  assert.ok(
    result.rejectedReason?.includes('重复单字'),
  );
});

test('validateExtractSkillInput rejects text with very low character diversity', () => {
  // Only 6 unique chars repeated across 100+ characters
  const result = validateExtractSkillInput(
    '了了了了了了了了了了了了了了了了了了了了了了了了了了了了了了了了了了了了了了了了了了在在在在在在在在在在在在在在在在在在在在在在是是是是是是是是是是是是是我我我我我我我我我我我我我我人人人人人人人人人人人人人人人',
  );
  assert.equal(result.accepted, false);
});

test('validateExtractSkillInput rejects function-word-only text', () => {
  const result = validateExtractSkillInput(
    '的的的是是在在了了了我我的的你了了他的的的这也也是是在在了了的不不就就是是在在了了我我的的你的的也也是是在在了了的的不不没有有的的就就的的是是在在了了',
  );
  assert.equal(result.accepted, false);
  assert.ok(result.rejectedReason?.includes('虚词'));
});

test('validateExtractSkillInput accepts valid novel text', () => {
  const result = validateExtractSkillInput(
    '夜雨拍窗，林砚把断潮刀压在膝上，看着掌柜把灯芯拨得更亮了一点。酒馆里只有三个客人：角落里打盹的老乞丐、柜台前自斟自饮的江湖客、还有一个把斗笠压得很低的女子。掌柜用最轻的声音提到玄铁令——那个让半个江湖都红了眼的铁片，现在就在这座酒馆里。门外靴声逼近，每一步都踩在积水里，也踩在林砚的神经上。',
  );
  assert.equal(result.accepted, true);
  assert.ok((result.chineseCharCount ?? 0) > 50);
});

test('validateExtractSkillInput accepts moderately short but valid text', () => {
  const result = validateExtractSkillInput(
    '黑暗中有人推门进来。风声先他一步灌满整间屋子，将所有低语压回喉咙里。来者没有立刻说话，只站在门槛边扫了一眼全场，目光最后落在角落那张空桌上。那才是他的座位——七天前他就预定好了。',
  );
  assert.equal(result.accepted, true);
});

// ============================================================================
// Layer 2: Model Self-Check tests
// ============================================================================

test('parseModelRefusal detects needs_clarification status', () => {
  const refusal = parseModelRefusal({
    status: 'needs_clarification',
    reason: '文本中文内容不足50字，无法提取稳定风格特征',
  });
  assert.ok(refusal);
  assert.equal(refusal?.status, 'needs_clarification');
  assert.ok(refusal?.reason.includes('50字'));
});

test('parseModelRefusal detects unanalyzable status', () => {
  const refusal = parseModelRefusal({
    status: 'unanalyzable',
    reason: '输入为纯对话记录，无叙事段落可分析',
  });
  assert.ok(refusal);
  assert.equal(refusal?.status, 'unanalyzable');
});

test('parseModelRefusal returns null for valid output', () => {
  const refusal = parseModelRefusal({
    status: 'ok',
    skills: [{ name: 'test', primaryDimension: 'style' }],
  });
  assert.equal(refusal, null);
});

test('parseModelRefusal returns null for non-object input', () => {
  assert.equal(parseModelRefusal(null), null);
  assert.equal(parseModelRefusal('string'), null);
  assert.equal(parseModelRefusal(undefined), null);
  assert.equal(parseModelRefusal([]), null);
});

test('parseModelRefusal returns null when reason is missing', () => {
  const refusal = parseModelRefusal({ status: 'needs_clarification' });
  assert.equal(refusal, null);
});

// ============================================================================
// Layer 3: Style genericness tests
// ============================================================================

test('scoreStyleGenericness returns 0 for specific descriptive style', () => {
  const score = scoreStyleGenericness(
    '多用三至五字短句切割动作，雨夜意象反复出现，对话前必有停顿或物件触碰作为前兆',
  );
  assert.equal(score, 0);
});

test('scoreStyleGenericness returns 1 for fully generic "文笔流畅" pattern', () => {
  const score = scoreStyleGenericness('文笔流畅，描写细腻，人物形象鲜明');
  assert.equal(score, 1);
});

test('scoreStyleGenericness returns 1 for "节奏感强" pattern', () => {
  const score = scoreStyleGenericness('节奏感强，张弛有度');
  assert.equal(score, 1);
});

test('scoreStyleGenericness returns 1 for empty style string', () => {
  assert.equal(scoreStyleGenericness(''), 1);
  assert.equal(scoreStyleGenericness('   '), 1);
});

test('scoreStyleGenericness detects individual boilerplate patterns', () => {
  assert.ok(scoreStyleGenericness('文笔流畅') >= 0.5);
  assert.ok(scoreStyleGenericness('情节紧凑，引人入胜') >= 0.5);
  assert.ok(scoreStyleGenericness('语言精炼，意象丰富') >= 0.5);
  assert.ok(scoreStyleGenericness('人物形象鲜明立体') >= 0.5);
});

test('scoreStyleGenericness returns high when generic patterns dominate', () => {
  const score = scoreStyleGenericness(
    '文笔流畅自然，描写细腻入微，节奏把控得当，总体叙事手法巧妙',
  );
  assert.ok(score >= 0.8, `expected >= 0.8, got ${score}`);
});

// ============================================================================
// skillCardIsGeneric tests
// ============================================================================

test('skillCardIsGeneric detects card with empty style and pacing', () => {
  const result = skillCardIsGeneric({ name: 'test', style: '', pacing: '' });
  assert.equal(result.isGeneric, true);
});

test('skillCardIsGeneric detects fully boilerplate card', () => {
  const result = skillCardIsGeneric({
    name: 'test',
    style: '文笔流畅，描写细腻',
    pacing: '节奏感强',
  });
  assert.equal(result.isGeneric, true);
});

test('skillCardIsGeneric passes card with specific content', () => {
  const result = skillCardIsGeneric({
    name: '冷雨短句刀锋文风',
    style: '以三至五字短句推进，对话前必有停顿或物件触碰，雨夜意象反复出现',
    pacing: '以场景末尾的异响或目光转移作为钩子，信息滞后半拍释放',
  });
  assert.equal(result.isGeneric, false);
});

// ============================================================================
// extractAnchoringKeywords tests
// ============================================================================

test('extractAnchoringKeywords returns keywords from Chinese text', () => {
  const keywords = extractAnchoringKeywords('雨夜酒馆，断潮刀压膝，玄铁令藏身');
  assert.ok(keywords.length > 0);
  const joined = keywords.join('');
  assert.ok(joined.includes('雨夜') || joined.includes('酒馆'));
});

test('extractAnchoringKeywords returns empty for short input', () => {
  assert.deepEqual(extractAnchoringKeywords(''), []);
  assert.deepEqual(extractAnchoringKeywords('文'), []);
});

test('extractAnchoringKeywords skips function words', () => {
  // Test that known function-word bigrams are excluded.
  // When function words are concatenated directly, cross-boundary bigrams
  // (e.g. "为所" from "因为所以") are not in the stop set — this is expected.
  const keywords = extractAnchoringKeywords('我的你的他的他们的');
  // '我的', '你的', '他的' are stop words; '们的' is not
  // cross-boundary: '的你的' -> '的你' (not stop), '的他' (not stop)
  // All pure function-word pairs should be filtered
  assert.ok(!keywords.includes('我的'));
  assert.ok(!keywords.includes('你的'));
  assert.ok(!keywords.includes('他的'));
});

// ============================================================================
// scoreSkillOutputAnchoring tests
// ============================================================================

test('scoreSkillOutputAnchoring high when output uses input keywords', () => {
  const skills = [
    {
      name: '冷雨刀锋文风',
      style: '短句切割，掌柜与酒馆场景，断潮刀和夜雨是核心意象',
      pacing: '以物件触碰和靴声作为场景锚点，信息滞后半拍释放',
    },
  ];
  const input = '夜雨拍窗酒馆掌柜把灯芯拨亮，断潮刀压膝，玄铁令藏身，门外靴声逼近林砚。';
  const score = scoreSkillOutputAnchoring(skills, input);
  assert.ok(score >= 0.15, `expected >= 0.15, got ${score}`);
});

test('scoreSkillOutputAnchoring low when output is unrelated', () => {
  const skills = [
    {
      name: '通用文风卡',
      style: '文笔流畅自然，语言优美，情节生动',
      pacing: '节奏把控得当',
    },
  ];
  const input = '雨夜酒馆，断潮刀压膝，玄铁令藏身，靴声逼近，酒馆鸦雀无声';
  const score = scoreSkillOutputAnchoring(skills, input);
  assert.ok(score < 0.15, `expected < 0.15, got ${score}`);
});

test('scoreSkillOutputAnchoring returns 1 when input is too short for keywords', () => {
  const skills = [{ name: 'test', style: 'anything' }];
  const score = scoreSkillOutputAnchoring(skills, '短');
  assert.equal(score, 1);
});

// ============================================================================
// evaluateSkillFieldCompleteness tests
// ============================================================================

test('evaluateSkillFieldCompleteness reports full completeness', () => {
  const skills = [
    { name: 'card1', style: 'style1', pacing: 'pacing1', primaryDimension: 'style' },
    { name: 'card2', style: 'style2', pacing: 'pacing2', primaryDimension: 'character' },
  ];
  const result = evaluateSkillFieldCompleteness(skills);
  assert.equal(result.overall, 1);
  assert.equal(result.perField.name, 1);
  assert.equal(result.perField.style, 1);
  assert.equal(result.perField.pacing, 1);
  assert.equal(result.perField.primaryDimension, 1);
});

test('evaluateSkillFieldCompleteness reports missing fields', () => {
  const skills = [
    { name: 'card1', style: '', pacing: 'fast', primaryDimension: 'style' },
    { name: '', style: 'ok', pacing: '', primaryDimension: '' },
  ];
  const result = evaluateSkillFieldCompleteness(skills);
  assert.ok(result.overall < 1);
  assert.equal(result.perField.name, 0.5);
  assert.equal(result.perField.style, 0.5);
});

test('evaluateSkillFieldCompleteness handles empty skills array', () => {
  const result = evaluateSkillFieldCompleteness([]);
  assert.equal(result.overall, 0);
});

// ============================================================================
// evaluateSkillOutputQuality tests
// ============================================================================

test('evaluateSkillOutputQuality passes high-quality output', () => {
  const skills = [
    {
      name: '冷雨短句刀锋文风',
      primaryDimension: 'style',
      style: '以短句切割动作，断潮刀与靴声酒馆是其标志性场景，对话前必有物件触碰',
      pacing: '以场景末尾的异响作为钩子，信息滞后半拍释放',
    },
    {
      name: '刀客沉默型人物模板',
      primaryDimension: 'character',
      style: '沉默寡言，以动作替代言语，通过站位和物件操作传递情绪',
      pacing: '人物揭示分阶段递进',
    },
  ];
  const input = '断潮刀压在膝上，酒馆掌柜把灯芯拨亮。夜雨拍窗，靴声逼近，林砚按住刀柄。';
  const report = evaluateSkillOutputQuality(skills, input);
  assert.equal(report.passed, true);
  assert.equal(report.genericSkillCount, 0);
  assert.ok(report.anchoringScore >= 0.15);
});

test('evaluateSkillOutputQuality fails for generic output', () => {
  const skills = [
    {
      name: '通用文风卡',
      primaryDimension: 'style',
      style: '文笔流畅，描写细腻，人物形象鲜明',
      pacing: '节奏感强',
    },
    {
      name: '通用人物卡',
      primaryDimension: 'character',
      style: '人物塑造丰满立体，情节紧凑引人入胜',
      pacing: '',
    },
  ];
  const input = '雨夜酒馆，断潮刀压膝，玄铁令藏身';
  const report = evaluateSkillOutputQuality(skills, input);
  assert.equal(report.passed, false);
  assert.ok(report.genericSkillCount >= 1);
  assert.ok(report.issue);
});

test('evaluateSkillOutputQuality fails for empty skills', () => {
  const report = evaluateSkillOutputQuality([], 'some input text here');
  assert.equal(report.passed, false);
});

test('evaluateSkillOutputQuality anchors on unique input terms', () => {
  const skills = [
    {
      name: '玄铁令争夺',
      primaryDimension: 'plot',
      style: '围绕玄铁令的多方博弈，刀锋出鞘必见血，令牌每次易手都伴随反转',
      pacing: '多势力交错推进',
    },
  ];
  const input = '玄铁令是江湖中最危险的铁片，各方势力为争夺玄铁令不惜血洗酒馆。断潮刀出鞘时，没人能全身而退。';
  const report = evaluateSkillOutputQuality(skills, input);
  assert.ok(report.anchoringScore >= 0.3, `expected >= 0.3, got ${report.anchoringScore}`);
});
