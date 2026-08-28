import assert from 'node:assert/strict';
import test from 'node:test';

import { MIN_COMPLETE_CHAPTER_SLOP_SCORE, evaluateDraftAcceptance, sanitizeFallbackContext, semanticReviewFromContinuityReport, semanticReviewFromStructuredAudit, validateCandidateDraftQuality, validateChapterDraftQuality, validateCompleteChapterDraftQuality, validateDraftQuality } from '../shared/lib/draft-quality';
import type { StructuredAudit } from '../shared/lib/audit-structured';
import { buildFallbackDraft } from '../server/helpers/fallback-draft';

test('draft quality rejects metadata, explanatory fragments and internal labels anywhere', () => {
  const result = validateDraftQuality('他推门进去。作品：冷雨夜。\n\n答案：这是修改后的正文。\n\nfantasy system');

  assert.equal(result.ok, false);
  assert.ok(result.violations.includes('正文包含作品/摘要等上下文元数据'));
  assert.ok(result.violations.includes('正文包含问答或说明性残片'));
  assert.ok(result.violations.includes('正文包含内部题材或平台标签'));
});

test('draft quality rejects long prompt context and generation parameters', () => {
  const polluted = `${'门外传来脚步，林舟握紧铜铃，雨水顺着墙缝流下。\n\n'.repeat(120)}\n前情提要及剧情内存 (RAG Context)\n平台：mystery tomato，篇幅：80000字，文风参数：剧情高能\n第一章从暴雨夜的异常信号开场，直接围绕主角打造。`;
  const result = validateChapterDraftQuality(polluted);
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((finding) => finding.code === 'context-residue'));
  assert.ok(result.findings.some((finding) => finding.code === 'parameter-residue'));
});

test('draft quality exposes severity and category without breaking legacy violations', () => {
  const result = validateDraftQuality('他推门进去。作品：冷雨夜。\n\n@@@');

  assert.ok(result.violations.includes('正文包含作品/摘要等上下文元数据'));
  assert.ok(result.findings.some((finding) => (
    finding.message === '正文包含作品/摘要等上下文元数据'
      && finding.severity === 'P0'
      && finding.category === 'metadata'
  )));
  assert.ok(result.findings.some((finding) => (
    finding.message === '正文包含异常符号噪声'
      && finding.severity === 'P1'
      && finding.category === 'noise'
  )));
});

test('semantic continuity checks remain explicitly unknown', () => {
  const result = validateDraftQuality('门轴轻轻一响。屋里的灯灭了一盏。');

  assert.equal(result.ok, true);
  assert.equal(result.semanticReview.status, 'unknown');
  assert.deepEqual(
    result.semanticReview.checks.map((check) => [check.id, check.status, check.category]),
    [
      ['chapter-goal', 'unknown', 'semantic-review'],
      ['character-consistency', 'unknown', 'semantic-review'],
      ['world-rule-consistency', 'unknown', 'semantic-review'],
      ['foreshadowing', 'unknown', 'semantic-review'],
    ],
  );
});

test('chapter draft quality rejects a short evidence-label payload as non-fiction residue', () => {
  const result = validateChapterDraftQuality(
    '世界证据-潮汐城每逢午夜倒流。角色证据-林舟握紧导师留下的青铜铃。伏笔证据-青铜铃第三次响起会打开地下城门。',
  );

  assert.equal(result.ok, false);
  assert.ok(result.findings.some((finding) => finding.code === 'evidence-label-only'));
});

test('complete chapter quality keeps the 4000-character delivery contract separate from scene quality', () => {
  const shortScene = Array.from({ length: 8 }, (_, index) => `第${index + 1}次钟响压过雨声，林舟确认门后的脚步没有停。`).join('\n\n');
  const result = validateCompleteChapterDraftQuality(shortScene);

  assert.equal(result.ok, false);
  assert.ok(result.findings.some((finding) => finding.code === 'chapter-below-contract'));
});

test('complete chapter quality blocks a mechanically repetitive candidate and returns evidence', () => {
  const repetitive = Array.from({ length: 70 }, (_, index) => [
    `他深吸一口气，眼神里闪过一丝迟疑，不是因为害怕，而是因为这意味着门后的代价更高。`,
    `第${index + 1}次确认仍然没有带来新的选择，危险却没有退去。`,
  ].join('')).join('\n\n');
  const result = validateCompleteChapterDraftQuality(repetitive);

  assert.ok(result.mechanicalReview);
  assert.equal(result.mechanicalReview?.status, 'needs-action');
  assert.ok((result.mechanicalReview?.score ?? 100) < MIN_COMPLETE_CHAPTER_SLOP_SCORE);
  assert.equal(result.ok, false);
  const finding = result.findings.find((item) => item.code === 'mechanical-quality');
  assert.equal(finding?.severity, 'P1');
  assert.ok(finding?.evidence?.[0]?.snippet);
});

test('complete chapter blocks a high-confidence AI cliche even when score density stays above threshold', () => {
  const chapter = [
    '他深吸一口气，抬手按住门闩，听见门后的水声停了一拍。',
    ...Array.from({ length: 62 }, (_, index) => [
      `第${index + 1}级石阶从雨里露出来，林舟用刀尖拨开积水，确认铜片上的刻痕没有被冲掉。`,
      `守门人把火把移到墙角，火星落在湿泥上；巷口的脚步换了方向，逼得林舟把退路让给门后的回声。`,
    ].join('')),
  ].join('\n\n');

  const result = validateCompleteChapterDraftQuality(chapter);

  assert.ok((result.mechanicalReview?.score || 0) >= MIN_COMPLETE_CHAPTER_SLOP_SCORE);
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((finding) => finding.code === 'literary-slop' && finding.severity === 'P1'));
});

test('draft acceptance keeps short fragments preview-only', () => {
  const result = evaluateDraftAcceptance('林舟扣住门框，把青铜铃压回掌心。', { source: 'model' });

  assert.equal(result.accepted, false);
  assert.equal(result.status, 'review-required');
  assert.equal(result.completeChapter, false);
  assert.match(result.reasons[0] || '', /只能作为预览/);
});

test('draft acceptance rejects an unreviewed complete chapter', () => {
  const chapter = Array.from({ length: 60 }, (_, index) => [
    `雨水沿着第${index + 1}级石阶退向城外，林舟用刀尖拨开泥里的铜片，确认上面的刻痕与导师留下的暗号不同。`,
    `守门人没有催促，只把半截火把插进墙缝；火星落下时，巷口的脚步换了方向，逼得林舟必须在门和追兵之间作出选择。`,
  ].join('')).join('\n\n');
  const result = evaluateDraftAcceptance(chapter, { source: 'model' });

  assert.equal(result.completeChapter, true);
  assert.equal(result.accepted, false);
  assert.equal(result.status, 'review-required');
  assert.ok(result.reasons.some((reason) => reason.includes('尚未完成语义审阅')));
});

test('draft acceptance keeps unknown review blocked unless the author explicitly accepts the risk', () => {
  const chapter = Array.from({ length: 60 }, (_, index) => [
    `雨水沿着第${index + 1}级石阶退向城外，林舟用刀尖拨开泥里的铜片，确认上面的刻痕与导师留下的暗号不同。`,
    `守门人没有催促，只把半截火把插进墙缝；火星落下时，巷口的脚步换了方向，逼得林舟必须在门和追兵之间作出选择。`,
  ].join('')).join('\n\n');
  const blocked = evaluateDraftAcceptance(chapter, { source: 'model' });
  assert.equal(blocked.status, 'review-required');

  const riskAccepted = evaluateDraftAcceptance(chapter, {
    source: 'user',
    allowRiskAcceptance: true,
  });
  assert.equal(riskAccepted.accepted, true);
  assert.equal(riskAccepted.status, 'risk-accepted');
});

test('draft acceptance blocks a semantic needs-action result even when mechanical checks pass', () => {
  const chapter = Array.from({ length: 60 }, (_, index) => [
    `雨水沿着第${index + 1}级石阶退向城外，林舟用刀尖拨开泥里的铜片，确认上面的刻痕与导师留下的暗号不同。`,
    `守门人没有催促，只把半截火把插进墙缝；火星落下时，巷口的脚步换了方向，逼得林舟必须在门和追兵之间作出选择。`,
  ].join('')).join('\n\n');
  const semanticReview = {
    status: 'needs-action' as const,
    checks: ['chapter-goal', 'character-consistency', 'world-rule-consistency', 'foreshadowing'].map((id) => ({
      id: id as 'chapter-goal' | 'character-consistency' | 'world-rule-consistency' | 'foreshadowing',
      status: id === 'foreshadowing' ? 'needs-action' as const : 'pass' as const,
      category: 'semantic-review' as const,
      reason: id === 'foreshadowing' ? '章末伏笔未回收。' : '已完成审阅。',
    })),
  };
  const result = evaluateDraftAcceptance(chapter, { source: 'model', semanticReview });
  assert.equal(result.accepted, false);
  assert.equal(result.status, 'review-required');
});

test('draft acceptance does not trust a top-level semantic pass with missing dimensions', () => {
  const chapter = Array.from({ length: 60 }, (_, index) => [
    `雨水沿着第${index + 1}级石阶退向城外，林舟用刀尖拨开泥里的铜片，确认上面的刻痕与导师留下的暗号不同。`,
    `守门人没有催促，只把半截火把插进墙缝；火星落下时，巷口的脚步换了方向，逼得林舟必须在门和追兵之间作出选择。`,
  ].join('')).join('\n\n');
  const result = evaluateDraftAcceptance(chapter, {
    source: 'model',
    semanticReview: {
      status: 'pass',
      checks: [{
        id: 'chapter-goal', status: 'pass', category: 'semantic-review', reason: '只覆盖一个维度。',
      }],
    },
  });
  assert.equal(result.accepted, false);
  assert.equal(result.status, 'review-required');
  assert.equal(result.quality.semanticReview.status, 'unknown');
});

test('draft acceptance requires complete quality and semantic pass, and rejects fallback source', () => {
  const chapter = Array.from({ length: 50 }, (_, index) => [
    `${index + 1}号石阶忽然塌下一角。`,
    `林舟没有后退，他把铜片贴在门锁上，听见里面传出与潮声错开的回响；守门人抬手指向地下，追兵的喊声随即在石墙后停住。`,
    index % 3 === 0
      ? '他记下缺口。'
      : index % 3 === 1
        ? '他将火把压低，沿着新露出的缝隙寻找第二枚刻痕。'
        : '他把湿透的袖口拧紧，先确认退路，再把铜片推进锁芯。',
    `门后的水声${index % 2 === 0 ? '突然' : '隔了片刻'}改变了方向，像有什么东西在黑暗里回应。`,
  ].join('')).join('\n\n');
  const semanticReview = {
    status: 'pass' as const,
    checks: ['chapter-goal', 'character-consistency', 'world-rule-consistency', 'foreshadowing'].map((id) => ({
      id: id as 'chapter-goal' | 'character-consistency' | 'world-rule-consistency' | 'foreshadowing',
      status: 'pass' as const,
      category: 'semantic-review' as const,
      reason: '已完成审阅。',
    })),
  };
  const accepted = evaluateDraftAcceptance(chapter, { source: 'model', semanticReview });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.status, 'eligible');

  const fallback = evaluateDraftAcceptance(chapter, { source: 'fallback', semanticReview });
  assert.equal(fallback.accepted, false);
  assert.equal(fallback.status, 'blocked');
  assert.ok(fallback.reasons.some((reason) => reason.includes('保底草稿')));

  const shortFallback = evaluateDraftAcceptance('保底片段', { source: 'fallback', operation: 'rewrite' });
  assert.equal(shortFallback.status, 'blocked');
});

test('draft acceptance blocks a complete chapter with unknown provenance', () => {
  const chapter = Array.from({ length: 50 }, (_, index) => [
    `${index + 1}号石阶忽然塌下一角。`,
    `林舟没有后退，他把铜片贴在门锁上，听见里面传出与潮声错开的回响；守门人抬手指向地下，追兵的喊声随即在石墙后停住。`,
    '他将火把压低，先确认退路，再把铜片推进锁芯。',
    `门后的水声${index % 2 === 0 ? '突然' : '隔了片刻'}改变了方向，像有什么东西在黑暗里回应。`,
  ].join('')).join('\n\n');
  const semanticReview = {
    status: 'pass' as const,
    checks: ['chapter-goal', 'character-consistency', 'world-rule-consistency', 'foreshadowing'].map((id) => ({
      id: id as 'chapter-goal' | 'character-consistency' | 'world-rule-consistency' | 'foreshadowing',
      status: 'pass' as const,
      category: 'semantic-review' as const,
      reason: '已完成审阅。',
    })),
  };
  const result = evaluateDraftAcceptance(chapter, { semanticReview });
  assert.equal(result.accepted, false);
  assert.equal(result.status, 'blocked');
  assert.ok(result.reasons.some((reason) => reason.includes('来源未知')));
});

test('chapter draft quality rejects prose that is too short to form a complete scene', () => {
  const result = validateChapterDraftQuality('门轴一响，林舟握住青铜铃。门外脚步逼近，他没有回头。');

  assert.equal(result.ok, false);
  assert.ok(result.findings.some((finding) => finding.code === 'chapter-too-short'));
});

test('chapter draft quality accepts a complete multi-paragraph scene while semantic review stays unknown', () => {
  const scene = Array.from({ length: 8 }, (_, index) => [
    `第${index + 1}次钟响压过雨声，林舟沿着潮湿的城墙往前挪了两步，鞋底碰到一截埋在水里的铁链。`,
    `他没有立刻弯腰，只借水面的倒影确认身后那盏灯的位置。守门人把手从门闩上移开，视线却仍压在他握铃的左手上。`,
    `青铜铃在掌心轻轻震了一下，城内倒流的潮水随即漫过第二级石阶。林舟改变站位，让铁链横在两人之间，也把退路留在自己脚边。`,
    `守门人听见巷口的脚步加快，才低声报出一段导师用过的暗号。林舟没有回答，只把铃口转向城门，第三声余音从砖缝深处传了回来。`,
  ].join('')).join('\n\n');
  const result = validateChapterDraftQuality(scene);

  assert.equal(result.ok, true);
  assert.equal(result.semanticReview.status, 'unknown');
});

test('candidate quality preserves the complete-scene boundary for an already complete chapter', () => {
  const baseline = Array.from({ length: 28 }, () => '雨声压过门外的脚步，林舟握紧青铜铃，沿着湿滑的石阶继续向下。').join('\n\n');
  const shortened = '林舟扣住门框，把青铜铃压回掌心。';
  const result = validateCandidateDraftQuality(shortened, baseline);

  assert.equal(result.ok, false);
  assert.ok(result.findings.some((finding) => finding.code === 'chapter-too-short'));
});

test('candidate quality keeps short working fragments usable', () => {
  const result = validateCandidateDraftQuality('林舟扣住门框，把青铜铃压回掌心。', '短片段');

  assert.equal(result.ok, true);
});

test('fallback context removes structural labels before prose generation', () => {
  const context = [
    '作品：测试作品',
    '摘要：这是不应进入正文的摘要',
    '**核心冲突**：主角必须在天亮前找到失踪的账册',
    '世界规则：所有魔法都要支付代价',
  ].join('\n');

  assert.deepEqual(sanitizeFallbackContext(context.replace(/\*\*/g, '')), [
    '主角必须在天亮前找到失踪的账册',
    '所有魔法都要支付代价',
  ]);

  const draft = buildFallbackDraft(context, context);
  assert.doesNotMatch(draft, /作品\s*[:：]|摘要\s*[:：]|世界规则\s*[:：]|核心冲突\s*[:：]/);
});

test('fallback context removes structured entity fields and workflow instructions', () => {
  const draft = buildFallbackDraft(
    '### 场景 1：异动入场\n\n**核心冲突**：主角必须在天亮前找到失踪的账册\n\n**关键动作链**：角色观察异常；对方给出含糊回应',
    '关键人物：\n- 林舟：只用左手解读导师暗号 (role=protagonist; traits=克制)\n开放伏笔：\n- 青铜铃：第三次响起会打开地下城门',
  );
  assert.doesNotMatch(draft, /role=|traits=|关键动作链|异动入场|场景\s*1/);
  assert.match(draft, /林舟/);
  assert.match(draft, /青铜铃/);
});

test('fallback context removes evidence labels and empty chapter placeholders', () => {
  const sanitized = sanitizeFallbackContext([
    'Chapter：无',
    '世界证据-潮汐城每逢午夜倒流',
    '角色证据-林舟，只用左手解读导师暗号',
    '伏笔证据-青铜铃第三次响起会打开地下城门',
  ].join('\n'));

  assert.deepEqual(sanitized, [
    '潮汐城每逢午夜倒流',
    '林舟，只用左手解读导师暗号',
    '青铜铃第三次响起会打开地下城门',
  ]);
  assert.equal(validateDraftQuality('世界证据-潮汐城每逢午夜倒流。').ok, false);
});

test('draft quality rejects duplicate paragraphs and reasoning blocks', () => {
  const paragraph = '雨点砸在窗纸上，他把账册压进袖口。';
  const result = validateDraftQuality(`${paragraph}\n\n<think>先分析再写</think>\n\n${paragraph}`);

  assert.equal(result.ok, false);
  assert.ok(result.violations.includes('正文包含模型推理标签'));
  assert.ok(result.violations.includes('正文包含重复段落'));
});

test('draft quality rejects mojibake, symbol noise and generation residue', () => {
  const result = validateDraftQuality([
    '门外传来ä¸€é˜µå£°éŸ³。',
    '—— 延续上一章剧情。',
    '@@### ???',
    '空',
  ].join('\n\n'));

  assert.equal(result.ok, false);
  assert.ok(result.violations.includes('正文包含疑似 UTF-8 解码乱码'));
  assert.ok(result.violations.includes('正文包含异常符号噪声'));
  assert.ok(result.violations.includes('正文包含生成过程提示或空占位'));
});

test('draft quality rejects markdown and scene template residue', () => {
  const result = validateDraftQuality('### 场景 1：异动入场\n\n**核心冲突**：有人逼近。\n\n门外传来脚步。');
  assert.equal(result.ok, false);
  assert.match(result.violations.join('；'), /Markdown/);
});

test('draft quality keeps ordinary Chinese prose valid', () => {
  const result = validateDraftQuality('门轴轻轻一响。屋里的灯灭了一盏，桌边的人抬起头，没有说话。');
  assert.equal(result.ok, true);
});

test('draft quality rejects mechanical repeated sentence openings without rejecting dialogue cadence', () => {
  const result = validateDraftQuality([
    '雨水沿着檐角落下，院门始终没有打开。',
    '雨水沿着檐角落下，灯影在门缝里晃动。',
    '雨水沿着檐角落下，桌上的铜铃忽然停了。',
  ].join('\n\n'));
  assert.equal(result.ok, true);
  assert.equal(result.findings.some((finding) => finding.code === 'repeated-opening' && finding.severity === 'P2'), true);
  assert.ok(result.violations.includes('正文包含重复句式开头'));
  assert.equal(validateDraftQuality('“你先走。”\n\n“我不走。”').ok, true);
});

test('draft quality blocks dense fallback cadence but permits a single natural phrase', () => {
  const result = validateDraftQuality(Array.from({ length: 3 }, () => [
    '他没有追问，先看向门缝。',
    '没有人愿意回答，屋里只剩雨声。',
    '这一次，脚步停在了门外。',
    '危险却没有退去，反而逼近。',
  ].join('\n\n')).join('\n\n'));
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((finding) => finding.code === 'mechanical-cadence'));
});

test('fallback output does not repeat a complete bridge sentence across template cycles', () => {
  const draft = buildFallbackDraft(
    '### 场景 1：异动入场\n\n**核心冲突**：主角必须找到账册\n\n**关键动作链**：观察异常；试探来客\n\n**退场钩子**：脚步逼近',
    '关键人物：林舟：守门人',
  );
  const result = validateChapterDraftQuality(draft);
  assert.equal(result.ok, false, 'mechanical fallback remains blocked until a real model draft is available');
  assert.ok(result.findings.some((finding) => finding.severity === 'P1'));
  for (const bridge of [
    '局面再次偏转，没人再把它当作巧合。',
    '新的细节压上来，先前的判断必须重新排列。',
    '局面没有回到原点，所有人的选择都留下了痕迹。',
    '下一步已经逼到门口，沉默也不再提供遮掩。',
  ]) {
    assert.ok((draft.match(new RegExp(bridge, 'g')) || []).length <= 1, `bridge repeated: ${bridge}`);
  }
});

test('semantic review maps structured audit evidence into four explicit checks', () => {
  const audit: StructuredAudit = {
    score: 48,
    fatalIssues: [{
      issueType: 'hook-ending', issueSubtype: 'generic-ending', severity: 'major',
      snippet: '门外的脚步声渐渐远去', explanation: '结尾没有兑现悬念', patchHint: '补出新的行动钩子',
    }],
    sceneChecks: [{ scene: '冲突落点', status: 'weak', note: '主角没有完成本章动作目标' }],
    surgerySuggestions: [],
    evidence: [{
      category: 'character_state', severity: 'medium', quote: '他答应了',
      explanation: '角色动机没有铺垫', suggestedFix: '补充角色的犹豫和代价', location: '第 2 段',
    }],
  };

  const review = semanticReviewFromStructuredAudit(audit);
  assert.equal(review.status, 'needs-action');
  assert.deepEqual(review.checks.map((check) => [check.id, check.status]), [
    ['chapter-goal', 'needs-action'],
    ['character-consistency', 'needs-action'],
    ['world-rule-consistency', 'unknown'],
    ['foreshadowing', 'needs-action'],
  ]);
  assert.equal(review.checks.find((check) => check.id === 'character-consistency')?.evidence?.[0]?.quote, '他答应了');
  assert.equal(validateDraftQuality('他答应了。', review).semanticReview.status, 'needs-action');
});

test('semantic review maps production continuity evidence without claiming an unrun audit passed', () => {
  const review = semanticReviewFromContinuityReport({
    auditMeta: { status: 'unknown', source: 'fallback' },
    issues: [{ category: 'character', severity: 'high', message: '角色状态冲突', evidence: '他已经受伤却立刻拔刀', suggestedFix: '补充恢复或代价' }],
    proposedPatch: { characterUpdates: [], itemUpdates: [], foreshadowingUpdates: [], timelineEventsToCreate: [], foreshadowingsToCreate: [] },
  });
  assert.equal(review.status, 'needs-action');
  assert.equal(review.checks.find((check) => check.id === 'character-consistency')?.evidence?.[0]?.quote, '他已经受伤却立刻拔刀');
  assert.equal(review.checks.find((check) => check.id === 'world-rule-consistency')?.status, 'unknown');
});

test('structured audit does not claim untouched dimensions passed without evidence', () => {
  const review = semanticReviewFromStructuredAudit({
    score: 86,
    fatalIssues: [],
    sceneChecks: [],
    surgerySuggestions: [],
    evidence: [],
  });
  assert.equal(review.status, 'unknown');
  assert.deepEqual(review.checks.map((check) => check.status), ['unknown', 'unknown', 'unknown', 'unknown']);
});
