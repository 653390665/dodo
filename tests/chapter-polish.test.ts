import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPolishTargetsFromCritique,
  removeRepeatedQuotedBlocks,
  findPatchWindow,
  applyPatchWindow,
  selectRewriteTargetsForPatch,
  validatePolishCandidate,
} from '../src/lib/chapter-polish';
import { buildRewritePrompt } from '../src/lib/rewrite-prompt';

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
