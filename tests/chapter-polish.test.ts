import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  extractPolishTargetsFromCritique,
  removeRepeatedQuotedBlocks,
  findPatchWindow,
  applyPatchWindow,
  selectRewriteTargetsForPatch,
  validatePolishCandidate,
} from '../src/lib/chapter-polish';
import { buildRewritePrompt } from '../src/lib/rewrite-prompt';
import { scoreSlop, slopSummary } from '../src/lib/slop-scorer';
import { buildCapabilityPolishPreview, buildSlopContextRewritePrompt, buildSlopRewritePreview } from '../src/lib/slop-rewriter';
import { StructuredAuditIssue } from '../src/lib/audit-structured';
import { embedStructuredAudit } from '../shared/lib/audit-structured';
import { SAMPLE_MOCKS } from '../scripts/run-chapter-acceptance';
import { recommendPromptAssets, getPromptAssetAction, inferNovelGovernanceProfile } from '../shared/lib/prompt-assets-governed';

test('extractPolishTargetsFromCritique extracts duplicate and rewrite targets from markdown critique', () => {
  const critique = `
## 致命问题
> "掌柜的脸色刷地白了一层。"——出现两次
> "门帘被风掀起一角。"——出现两次

### 建议二：重写掌柜三个层次
> 掌柜的眼皮都没抬……
`;

  const result = extractPolishTargetsFromCritique(critique);
  assert.equal(result.duplicateTargets.length, 2);
  assert.equal(result.rewriteTargets.length >= 1, true);
});

test('extractPolishTargetsFromCritique ignores quoted suggestion snippets in surgery section', () => {
  const critique = `
## 致命问题
> "三……三天。" 声音几乎是贴着桌面传过来的。

## 手术建议
建议改成：
> 掌柜的眼皮都没抬，抹布在碗沿上擦过，发出粗糙的声响。
> "谁知道呢，来来往往的人多了。"
`;

  const result = extractPolishTargetsFromCritique(critique);
  assert.deepEqual(result.duplicateTargets, []);
  assert.deepEqual(result.rewriteTargets, ['三……三天。" 声音几乎是贴着桌面传过来的。']);
});

test('removeRepeatedQuotedBlocks keeps first occurrence and removes later exact duplicates', () => {
  const content = `甲\n\n重复段\n\n乙\n\n重复段\n\n丙\n\n重复段`;
  const result = removeRepeatedQuotedBlocks(content, ['重复段']);
  assert.equal(result.content.includes('重复段'), true);
  assert.equal((result.content.match(/重复段/g) || []).length, 1);
});

test('findPatchWindow returns stable before/target/after slices for exact snippet', () => {
  const content = `前文A。\n\n坏句一。\n\n后文B。`;
  const window = findPatchWindow(content, '坏句一。');
  assert.equal(window?.targetText, '坏句一。');
  assert.equal(window?.matchedSnippet, '坏句一。');
  assert.equal(window?.beforeContext.includes('前文A'), true);
  assert.equal(window?.afterContext.includes('后文B'), true);
});

test('findPatchWindow falls back to a stable prefix when critique snippet is more verbose than source text', () => {
  const content = `前文A。\n\n掌柜的眼皮都没抬，抹布在碗沿上擦过。\n\n后文B。`;
  const window = findPatchWindow(content, '掌柜的眼皮都没抬……');
  assert.equal(window?.matchedSnippet, '掌柜的眼皮都没抬');
  assert.equal(window?.targetText, '掌柜的眼皮都没抬，抹布在碗沿上擦过。');
  assert.equal(window?.beforeContext.includes('前文A'), true);
  assert.equal(window?.afterContext.includes('后文B'), true);
});

test('applyPatchWindow replaces only the targeted slice', () => {
  const content = `前文A。\n\n坏句一。\n\n后文B。`;
  const window = findPatchWindow(content, '坏句一。')!;
  const next = applyPatchWindow(content, window, '修好的一句。');
  assert.equal(next.includes('修好的一句。'), true);
  assert.equal(next.includes('坏句一。'), false);
  assert.equal(next.includes('前文A。'), true);
  assert.equal(next.includes('后文B。'), true);
});

test('selectRewriteTargetsForPatch prefers actionable full-sentence targets over risky ellipsis snippets', () => {
  const content = `这身湿法不像是赶路赶的。\n\n“三……三天。”声音几乎是贴着桌面传过来的。\n\n掌柜的眼皮都没抬，抹布在碗沿上擦过。`;
  const selected = selectRewriteTargetsForPatch(content, [
    '掌柜的眼皮都没抬……',
    '三……三天。" 声音几乎是贴着桌面传过来的。',
    '这身湿法不像是赶路赶的',
  ]);

  assert.equal(selected.some((entry) => entry.snippet === '掌柜的眼皮都没抬……'), false);
  assert.equal(selected.some((entry) => entry.snippet === '三……三天。" 声音几乎是贴着桌面传过来的。'), true);
  assert.equal(selected.some((entry) => entry.snippet === '这身湿法不像是赶路赶的'), true);
});

test('selectRewriteTargetsForPatch prioritizes duplicate, dialogue-logic, and syntax issues from critique context', () => {
  const content = [
    '掌柜的脸色刷地白了一层。',
    '“三……三天。”声音几乎是贴着桌面传过来的。',
    '这身湿法不像是赶路赶的。',
    '掌柜的眼皮都没抬，抹布在碗沿上擦过。',
  ].join('\n\n');

  const critique = `
## 致命问题
### 1. 严重段落重复——致命硬伤
> "掌柜的脸色刷地白了一层。"——出现**两次**

### 2. "三天"信息出现突兀——上下文断裂
> "三……三天。" 声音几乎是贴着桌面传过来的。

### 3. "湿法"——疑似病句
> "这身湿法不像是赶路赶的"

### 4. 掌柜"三层次"写弱——分镜失焦
> "掌柜的眼皮都没抬……"

## 手术建议
> 掌柜的眼皮都没抬，抹布在碗沿上擦过，发出粗糙的声响。
`;

  const selected = selectRewriteTargetsForPatch(
    content,
    [
      '掌柜的眼皮都没抬……',
      '三……三天。" 声音几乎是贴着桌面传过来的。',
      '这身湿法不像是赶路赶的',
      '掌柜的脸色刷地白了一层。',
    ],
    4,
    critique,
  );

  assert.deepEqual(
    selected.slice(0, 3).map((entry) => entry.issueType),
    ['duplicate', 'dialogue-logic', 'syntax'],
  );
  assert.deepEqual(
    selected.slice(0, 3).map((entry) => entry.issueSubtype),
    ['duplicate-rupture', 'dialogue-abrupt-info', 'syntax-invalid-phrase'],
  );
});

test('selectRewriteTargetsForPatch keeps scene-execution ellipsis targets as a lower-priority fallback', () => {
  const content = `掌柜的眼皮都没抬，抹布在碗沿上擦过。`;
  const critique = `
## 致命问题
### 4. 掌柜"三层次"写弱——分镜失焦
> "掌柜的眼皮都没抬……"
`;

  const selected = selectRewriteTargetsForPatch(content, ['掌柜的眼皮都没抬……'], 3, critique);
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.issueType, 'scene-execution');
  assert.equal(selected[0]?.issueSubtype, 'scene-layer-missing');
  assert.equal(selected[0]?.window.matchedSnippet, '掌柜的眼皮都没抬');
});

test('selectRewriteTargetsForPatch rejects scene-execution targets with long explanatory paragraphs', () => {
  const content =
    '掌柜的眼皮都没抬，抹布在碗沿上擦过，发出粗糙的声响。那只碗已经擦完了，但他没把抹布换到另一只手上，就那么攥着布角站在原地。片刻后，掌柜的目光往门外飘了一瞬，又很快收回来。与此同时，他还低头看了一眼桌上的铜板，像是在估算什么。最后他偏过头，压低声音说了一句谁也听不清的含糊话。';
  const critique = `
## 致命问题
### 4. 掌柜"三层次"写弱——分镜失焦
> "掌柜的眼皮都没抬……"
`;

  const selected = selectRewriteTargetsForPatch(content, ['掌柜的眼皮都没抬……'], 3, critique);
  assert.equal(selected.length, 0);
});

test('validatePolishCandidate rejects obvious duplication regressions', () => {
  const baseline = `甲\n\n乙\n\n丙`;
  const broken = `甲\n\n乙\n\n乙\n\n乙\n\n丙`;
  const result = validatePolishCandidate(baseline, broken);
  assert.equal(result.ok, false);
  assert.match(result.reason || '', /duplicate/i);
});

test('buildRewritePrompt for surgical-patch forbids whole chapter rewrite', () => {
  const prompt = buildRewritePrompt({
    mode: 'surgical-patch',
    text: '坏句一。',
    beforeContext: '前文A。',
    afterContext: '后文B。',
    auditIssue: '这句指代不稳',
    contextStr: '世界观A',
    sceneBeats: '场景一',
  });

  assert.match(prompt, /只重写这一小段/);
  assert.match(prompt, /不要扩写整章/);
  assert.match(prompt, /前文衔接/);
  assert.match(prompt, /后文衔接/);
});

test('scoreSlop and slopSummary correctly detect and aggregate new slop categories', () => {
  // Test text containing exposition dump (STYLE_SLOP), dialogue without beat (ACTION_CHAIN), and generic ending (HOOK_ENDING)
  const text = [
    '这是因为主角有一些不得不说的解释。也就是说，他的原因在于那个计划。',
    '“你来了。”',
    '“我来了。”',
    '“你本不该来。”',
    '他叹了口气，转身离去，消失在夜色中。'
  ].join('\n');

  const report = scoreSlop(text);
  assert.ok(report);
  assert.ok(report.hits.length > 0);

  // Check specific categories are present
  const categories = report.hits.map(h => h.category);
  assert.ok(categories.includes('style_slop'));
  assert.ok(categories.includes('action_chain'));
  assert.ok(categories.includes('hook_ending'));

  const summary = slopSummary(report);
  assert.match(summary, /AI腔调/);
  assert.match(summary, /动作链缺陷/);
  assert.match(summary, /收尾套路/);
});

test('scoreSlop returns located structural evidence for clean-worded template prose', () => {
  const text = Array.from({ length: 16 }, (_, index) => [
    `雨声压住屋檐，林舟抬眼确认门缝里的灯没有熄灭。`,
    `因此他把手停在刀柄旁，等对面的脚步先露出破绽。`,
    `危险仍在逼近，局面没有因为这次等待而改变。第${index + 1}次判断落回原处。`,
  ].join('')).join('\n\n');
  const report = scoreSlop(text);
  const structural = report.hits.filter((hit) => hit.category === 'structural');
  assert.ok(structural.some((hit) => hit.signal === 'subject-action-chain'));
  assert.ok(structural.some((hit) => hit.signal === 'paragraph-opening' || hit.signal === 'scene-template' || hit.signal === 'abstract-ending'));
  assert.ok(structural.every((hit) => hit.range && hit.range.end > hit.range.start));
  assert.ok(structural.every((hit) => hit.suggestion && hit.snippet));
});

test('scoreSlop keeps time and ratio phrases out of the 十分副词 rule', () => {
  const report = scoreSlop('十分钟后，十分之一的灯光熄灭。十米外响起十秒倒计时，十之八九会失败。她十分冷静地收起纸页。');
  const unitHits = report.hits.filter((hit) => /十分钟|十分之一|十米|十秒|十之八九/.test(hit.snippet));
  assert.equal(unitHits.length, 0);
  assert.ok(report.hits.some((hit) => hit.snippet.includes('十分冷静')));
});

test('structural fixtures distinguish adversarial repetition from an event-driven contrast', () => {
  const fixturesDir = path.join(process.cwd(), 'tests/fixtures');
  const adversarial = fs.readFileSync(path.join(fixturesDir, 'chapter-structural-adversarial.txt'), 'utf8').trim();
  const contrast = fs.readFileSync(path.join(fixturesDir, 'chapter-structural-contrast.txt'), 'utf8').trim();
  assert.ok(adversarial.replace(/\s/g, '').length > 4000);
  assert.ok(scoreSlop(adversarial).hits.some((hit) => hit.category === 'structural' && hit.priority === 'P1'));
  assert.equal(scoreSlop(contrast).hits.some((hit) => hit.signal === 'scene-template'), false);
});

test('buildSlopRewritePreview removes high-confidence AI filler without changing the original text', () => {
  const text = '从某种程度上，这不是测试而是套话。他深吸一口气，目光中闪过一丝迟疑。';
  const preview = buildSlopRewritePreview(text);

  assert.equal(text, '从某种程度上，这不是测试而是套话。他深吸一口气，目光中闪过一丝迟疑。');
  assert.equal(preview, '这是套话。目光带着迟疑。');
  assert.equal(preview.includes('从某种程度上'), false);
  assert.equal(preview.includes('深吸一口气'), false);
});

test('buildCapabilityPolishPreview gives rhythm cards a distinct short-sentence preview', () => {
  const text = '他走进屋里，灯影压在肩上，桌边的人没有抬头，窗外的雨还在落，空气沉得像铁。';
  const preview = buildCapabilityPolishPreview('de-ai-rhythm-restorer', text);

  assert.equal(preview, '他走进屋里，灯影压在肩上。\n桌边的人没有抬头，窗外的雨还在落。\n空气沉得像铁。');
  assert.notEqual(preview, buildCapabilityPolishPreview('de-ai-slop-shield', text));
});

test('de-AI preview does not invent concrete actions for abstract source text', () => {
  const text = '他做出了反应，但没有说明具体动作。她采取了行动，却仍站在原地。';
  const preview = buildSlopRewritePreview(text);

  assert.equal(preview, text);
  assert.equal(preview.includes('退了半步'), false);
  assert.equal(preview.includes('动了手'), false);
});

test('de-AI preview keeps emotion meaning instead of replacing it with an invented gesture', () => {
  const preview = buildSlopRewritePreview('他涌起一股无力感。');

  assert.equal(preview, '他感到无力。');
  assert.equal(preview.includes('指节慢慢松开'), false);
});

test('context rewrite prompt carries a bounded window and fact-preservation contract', () => {
  const prompt = buildSlopContextRewritePrompt({
    beforeContext: '前文动作。',
    targetText: '局面出现新的方向。',
    afterContext: '后文后果。',
    issue: '段末抽象收束重复',
    chapterContext: '人物仍在门口。',
    sceneBeats: '确认灯火来源后进入暗门。',
  });
  assert.match(prompt, /前文动作/);
  assert.match(prompt, /后文后果/);
  assert.match(prompt, /不得新增角色、事实、关系、设定或事件后果/);
  assert.match(prompt, /不要重写整章/);
});

test('QualityTab decision partitioning and overflow merging logic correctly isolates autoFixable and overflow issues', () => {
  const content = '前文A。\n\n坏句一。\n\n坏句二。\n\n坏句三。\n\n坏句四。\n\n后文B。';

  // mock fatalIssues, 4 of them are auto-fixable (exist in content), 1 is manual-fixable (not exist in content)
  const mockIssues: StructuredAuditIssue[] = [
    {
      issueType: 'style-slop',
      issueSubtype: 'ai-cliche',
      severity: 'critical',
      snippet: '坏句一。',
      explanation: '一号问题',
      patchHint: '修一'
    },
    {
      issueType: 'action-chain',
      issueSubtype: 'weak-action-chain',
      severity: 'major',
      snippet: '坏句二。',
      explanation: '二号问题',
      patchHint: '修二'
    },
    {
      issueType: 'hook-ending',
      issueSubtype: 'generic-ending',
      severity: 'moderate',
      snippet: '坏句三。',
      explanation: '三号问题',
      patchHint: '修三'
    },
    {
      issueType: 'style-slop',
      issueSubtype: 'tell-dont-show',
      severity: 'major',
      snippet: '坏句四。',
      explanation: '四号问题',
      patchHint: '修四'
    },
    {
      issueType: 'dialogue-logic',
      issueSubtype: 'dialogue-abrupt-info',
      severity: 'critical',
      snippet: '不存在的坏句。', // Not in content, should be manual fix
      explanation: '无法匹配的问题',
      patchHint: '人工修'
    }
  ];

  // 1. Detect which ones are auto-fixable using findPatchWindow
  const autoFixable = mockIssues.filter(
    (i) => i.snippet && findPatchWindow(content, i.snippet) !== null
  );
  const manualFix = mockIssues.filter(
    (i) => !i.snippet || findPatchWindow(content, i.snippet) === null
  );

  assert.equal(autoFixable.length, 4); // 坏句一、二、三、四
  assert.equal(manualFix.length, 1);   // 不存在的坏句

  // 2. Apply slice limit (max 3)
  const slicedAutoFixable = autoFixable.slice(0, 3);
  const overflowAutoFixable = autoFixable.slice(3);

  assert.equal(slicedAutoFixable.length, 3);
  assert.equal(overflowAutoFixable.length, 1); // 坏句四溢出

  // 3. Merge overflow auto-fixable into manual fixes
  const finalManualFix = [...manualFix, ...overflowAutoFixable];

  assert.equal(finalManualFix.length, 2); // 不存在的坏句 + 坏句四
  assert.equal(finalManualFix[0]?.snippet, '不存在的坏句。');
  assert.equal(finalManualFix[1]?.snippet, '坏句四。');
});

test('SAMPLE_MOCKS fixtures verify extracting targets correctly', () => {
  const fixturesDir = path.join(process.cwd(), 'tests/fixtures');

  // 1. chapter-slop-heavy.txt
  const slopContent = fs.readFileSync(path.join(fixturesDir, 'chapter-slop-heavy.txt'), 'utf-8').trim();
  const mockSlop = SAMPLE_MOCKS['chapter-slop-heavy.txt'];
  const slopCritique = embedStructuredAudit(mockSlop.critique, mockSlop.structured);
  const slopExtracted = extractPolishTargetsFromCritique(slopCritique);
  assert.ok(slopExtracted.rewriteTargets.length >= 1, 'slop heavy rewrite targets should be extracted');
  const slopSelected = selectRewriteTargetsForPatch(slopContent, slopExtracted.rewriteTargets, 3);
  assert.ok(slopSelected.length >= 1, 'slop heavy selected targets should be >= 1');

  // 2. chapter-action-weak.txt
  const actionContent = fs.readFileSync(path.join(fixturesDir, 'chapter-action-weak.txt'), 'utf-8').trim();
  const mockAction = SAMPLE_MOCKS['chapter-action-weak.txt'];
  const actionCritique = embedStructuredAudit(mockAction.critique, mockAction.structured);
  const actionExtracted = extractPolishTargetsFromCritique(actionCritique);
  assert.ok(actionExtracted.rewriteTargets.length >= 1, 'action weak rewrite targets should be extracted');
  const actionSelected = selectRewriteTargetsForPatch(actionContent, actionExtracted.rewriteTargets, 3);
  assert.ok(actionSelected.length >= 1, 'action weak selected targets should be >= 1');

  // 3. chapter-mature.txt
  const mockMature = SAMPLE_MOCKS['chapter-mature.txt'];
  const matureCritique = embedStructuredAudit(mockMature.critique, mockMature.structured);
  const matureExtracted = extractPolishTargetsFromCritique(matureCritique);
  assert.equal(matureExtracted.rewriteTargets.length, 0, 'mature rewrite targets should be 0');
});

test('inferNovelGovernanceProfile checks logic deduction across multiple scenarios', () => {
  // 1. Default blank novel
  const novel1: any = {
    title: '',
    summary: '',
    worldRules: '',
    globalOutline: '',
    projectPreferenceProfile: { tags: [] },
    mountedSkillIds: [],
    mountedSkillLoadout: []
  };
  const profile1 = inferNovelGovernanceProfile(novel1);
  assert.equal(profile1.targetPlatform, undefined);
  assert.equal(profile1.activeSeriesId, 'generic-novel-flow');
  assert.equal(profile1.commercialMode, 'free');
  assert.deepEqual(profile1.genreTags, []);

  // 2. Novel with "Xiaofeiji" tags
  const novel2: any = {
    title: '神秘的书',
    summary: '一个故事',
    projectPreferenceProfile: { tags: ['xiaofeiji-novel'] },
    mountedSkillIds: []
  };
  const profile2 = inferNovelGovernanceProfile(novel2);
  assert.equal(profile2.activeSeriesId, 'xiaofeiji-novel-flow');

  // 3. Novel with Tomato, rebirth and cultivation keywords
  const novel3: any = {
    title: '重生之我在番茄修仙',
    summary: '这是一个修仙的故事',
    projectPreferenceProfile: { tags: ['番茄'] }
  };
  const profile3 = inferNovelGovernanceProfile(novel3);
  assert.equal(profile3.targetPlatform, 'tomato');
  assert.equal(profile3.activeSeriesId, 'tomato-platform-flow');
  assert.equal(profile3.commercialMode, 'strict');
  assert.ok(profile3.genreTags.includes('cultivation'));
  assert.ok(profile3.genreTags.includes('rebirth'));

  // 4. Explicit v3 capability flow wins over keyword inference
  const novel4: any = {
    title: '番茄都市爽文',
    summary: '一个番茄小说连载项目',
    projectPreferenceProfile: {
      tags: ['tomato'],
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        activeFlowId: 'generic-novel-flow',
        projectSkillDeck: {
          mainCardId: 'main-card',
          supportCardIds: ['support-one', 'support-two'],
          updatedAt: 1,
        },
        favoriteTechniqueIds: [],
      },
    },
    mountedSkillIds: [],
    mountedSkillLoadout: [],
  };
  const profile4 = inferNovelGovernanceProfile(novel4);
  assert.equal(profile4.targetPlatform, 'tomato');
  assert.equal(profile4.activeSeriesId, 'generic-novel-flow');
});

test('QualityTab recommended asset execution rules check', () => {
  // 1. 番茄小说画像场景下，推荐资产的动作匹配
  const novel: any = {
    title: '重生之我在番茄修仙',
    projectPreferenceProfile: { tags: ['番茄'] }
  };
  const profile = inferNovelGovernanceProfile(novel);

  const assets = recommendPromptAssets({
    targetPlatform: profile.targetPlatform,
    genreTags: profile.genreTags,
    currentStage: 'polish', // 有质量问题需要修补时的场景
    activeSeriesId: profile.activeSeriesId,
    commercialMode: profile.commercialMode
  });

  // 确保 core-slop-shield 去 AI 腔资产存在且其动作映射到 'polish-rewrite' (精修预览)
  const slopShield = assets.find((a: any) => a.id === 'core-slop-shield');
  if (slopShield) {
    assert.equal(getPromptAssetAction(slopShield), 'polish-rewrite');
  }

  // 确保番茄评分卡资产存在且其动作映射到 'audit-enhance' (审核审计)
  const scorecard = assets.find((a: any) => a.id === 'tomato-scorecard');
  if (scorecard) {
    assert.equal(getPromptAssetAction(scorecard), 'audit-enhance');
  }

  // 2. 其它类型资产的拦截规则验证 (不可执行资产不展示按钮)
  const testFixtureAsset: any = {
    id: 'test-fixture-123',
    primaryCategory: 'quality-guardrail',
    placementTier: 'core-default'
  };
  assert.equal(getPromptAssetAction(testFixtureAsset), null);

  const sanitizeRequiredAsset: any = {
    id: 'private-999',
    primaryCategory: 'author-workflow',
    placementTier: 'sanitize-required'
  };
  assert.equal(getPromptAssetAction(sanitizeRequiredAsset), null);
});
