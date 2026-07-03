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
import { StructuredAuditIssue } from '../src/lib/audit-structured';
import { embedStructuredAudit } from '../shared/lib/audit-structured';
import { SAMPLE_MOCKS } from '../scripts/run-chapter-acceptance';

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
