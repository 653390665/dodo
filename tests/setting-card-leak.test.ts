import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPromptInstructionResidue,
  detectSettingCardLeaks,
  extractSettingCardSources,
  stripPromptInstructionResidue,
  stripSettingCardLeaks,
  validateCompleteChapterDraftQuality,
} from '../shared/lib/draft-quality';

const NEWLINE = String.fromCharCode(10);

function cleanChapterBody(from: number, count: number): string {
  return Array.from({ length: count }, (_, index) => [
    `雨水沿着第${from + index}级石阶退向城外，林舟用刀尖拨开泥里的铜片，确认上面的刻痕与导师留下的暗号不同。`,
    `守门人没有催促，只把半截火把插进墙缝；火星落下时，巷口的脚步换了方向，逼得林舟必须在门和追兵之间作出选择。`,
  ].join('')).join(NEWLINE + NEWLINE);
}

function chapterWith(leaks: string[]): string {
  return [cleanChapterBody(0, 12), ...leaks, cleanChapterBody(13, 48)].join(NEWLINE + NEWLINE);
}

const CONTEXT = [
  '关键人物：',
  '- 左妄：觉醒但未自知的裂隙携带者，能感知事物同源性。',
  '- 顾铁峰：捕捉到左妄身上裂隙残留脉冲的观察者。',
  '',
  '关键道具：',
  '- 青玉扳指：死者指骨上取下的旧物，内壁刻着半个字。',
].join(NEWLINE);

const LEAK_LEFANG = '左妄，觉醒但未自知的裂隙携带者，能感知事物同源性。';
const LEAK_GU = '顾铁峰把帽檐压低，他是捕捉到左妄身上裂隙残留脉冲的观察者。';

test('extractSettingCardSources pulls roster entries out of the production context', () => {
  const sources = extractSettingCardSources(CONTEXT);

  assert.deepEqual(
    sources.map((entry) => entry.name),
    ['左妄', '顾铁峰', '青玉扳指']
  );
  assert.equal(sources[0].sketch, '觉醒但未自知的裂隙携带者，能感知事物同源性。');
  assert.equal(sources[2].sketch, '死者指骨上取下的旧物，内壁刻着半个字。');
});

test('extractSettingCardSources returns nothing when the context carries no roster', () => {
  assert.deepEqual(extractSettingCardSources(undefined), []);
  assert.deepEqual(extractSettingCardSources(''), []);
  assert.deepEqual(extractSettingCardSources('前情提要：林舟带着铜铃走进雨里。'), []);
});

test('detectSettingCardLeaks flags a pasted roster sentence and tolerates a bare name', () => {
  const sources = extractSettingCardSources(CONTEXT);
  const pasted = [cleanChapterBody(0, 1), LEAK_LEFANG].join(NEWLINE + NEWLINE);

  const hits = detectSettingCardLeaks(pasted, sources);

  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, '左妄');
  assert.equal(hits[0].line, 3);
  assert.ok(hits[0].snippet.includes('裂隙携带者'));
  assert.deepEqual(detectSettingCardLeaks('左妄蹲下拨开碎发，看了看桥墩下的青紫印。', sources), []);
});

test('stripSettingCardLeaks removes the leaked sentence and keeps the rest of the chapter', () => {
  const sources = extractSettingCardSources(CONTEXT);
  const chapter = chapterWith([LEAK_LEFANG, LEAK_GU]);

  const stripped = stripSettingCardLeaks(chapter, sources);

  assert.equal(stripped.removed.length, 2);
  assert.ok(!stripped.text.includes('裂隙携带者'));
  assert.ok(stripped.text.includes('雨水沿着第0级石阶退向城外'));
  assert.deepEqual(detectSettingCardLeaks(stripped.text, sources), []);
});

test('complete chapter gate blocks a saturated setting-card leak as P1', () => {
  const result = validateCompleteChapterDraftQuality(chapterWith([LEAK_LEFANG, LEAK_GU]), undefined, {
    minChars: 4000,
    context: CONTEXT,
  });

  const finding = result.findings.find((item) => item.code === 'setting-card-leak');
  assert.ok(finding);
  assert.equal(finding.severity, 'P1');
  assert.equal(finding.category, 'template');
  assert.ok((finding.evidence?.[0]?.snippet || '').includes('裂隙携带者'));
  assert.equal(result.ok, false);
});

test('complete chapter gate leaves a single leaked sentence to the deterministic strip', () => {
  const chapter = chapterWith([LEAK_LEFANG]);
  const result = validateCompleteChapterDraftQuality(chapter, undefined, {
    minChars: 4000,
    context: CONTEXT,
  });

  assert.ok(!result.findings.some((item) => item.code === 'setting-card-leak'));
  assert.equal(result.ok, true);
  const stripped = stripSettingCardLeaks(chapter, extractSettingCardSources(CONTEXT));
  assert.equal(stripped.removed.length, 1);
  assert.ok(!stripped.text.includes('裂隙携带者'));
});

test('stripping the leak clears the gate without touching the prose', () => {
  const sources = extractSettingCardSources(CONTEXT);
  const stripped = stripSettingCardLeaks(chapterWith([LEAK_LEFANG, LEAK_GU]), sources);

  const result = validateCompleteChapterDraftQuality(stripped.text, undefined, {
    minChars: 4000,
    context: CONTEXT,
  });

  assert.ok(!result.findings.some((item) => item.code === 'setting-card-leak'));
  assert.equal(result.ok, true);
});

test('complete chapter gate stays silent when the roster never reaches the prose', () => {
  const result = validateCompleteChapterDraftQuality(chapterWith([]), undefined, {
    minChars: 4000,
    context: CONTEXT,
  });

  assert.ok(!result.findings.some((item) => item.code === 'setting-card-leak'));
  assert.equal(result.ok, true);
});

const INSTRUCTION_ONE = '档案纪律（必须遵守）：以下人物都是设定档案，不是正文素材。';
const INSTRUCTION_TWO = '输出格式：先写场景，再写动作。';

test('detectPromptInstructionResidue flags a copied instruction sentence', () => {
  const chapter = chapterWith([INSTRUCTION_ONE]);
  const hits = detectPromptInstructionResidue(chapter);

  assert.equal(hits.length, 1);
  assert.ok(hits[0].snippet.includes('档案纪律'));
  assert.deepEqual(detectPromptInstructionResidue(cleanChapterBody(0, 2)), []);
});

test('the gate reports prompt-residue-echo only when two instruction echoes survive', () => {
  const one = chapterWith([INSTRUCTION_ONE]);
  const two = chapterWith([INSTRUCTION_ONE, INSTRUCTION_TWO]);
  const single = validateCompleteChapterDraftQuality(one, undefined, { minChars: 800 });

  assert.ok(!single.findings.some((finding) => finding.code === 'prompt-residue-echo'));
  const flagged = validateCompleteChapterDraftQuality(two, undefined, { minChars: 800 });
  const finding = flagged.findings.find((entry) => entry.code === 'prompt-residue-echo');
  assert.ok(finding);
  assert.equal(finding.severity, 'P1');
});

test('stripping instruction residue clears the prompt-residue-echo gate', () => {
  const chapter = chapterWith([INSTRUCTION_ONE, INSTRUCTION_TWO]);
  const stripped = stripPromptInstructionResidue(chapter);

  assert.equal(stripped.removed.length, 2);
  assert.ok(!stripped.text.includes('档案纪律'));
  assert.ok(stripped.text.includes('雨水沿着第0级石阶'));
  const after = validateCompleteChapterDraftQuality(stripped.text, undefined, { minChars: 800 });
  assert.ok(!after.findings.some((finding) => finding.code === 'prompt-residue-echo'));
});
// Plan 279 R-278-3：同一个名字可能在同一章里泄漏多次，剥离必须一次清完。
test('every leak of the same name is reported and stripped', () => {
  const sources = extractSettingCardSources(CONTEXT);
  const leaked = [
    cleanChapterBody(0, 3),
    LEAK_LEFANG,
    cleanChapterBody(4, 3),
    LEAK_LEFANG,
    cleanChapterBody(8, 3),
  ].join(NEWLINE + NEWLINE);

  const hits = detectSettingCardLeaks(leaked, sources);
  assert.equal(hits.length, 2, 'every occurrence of the same name is reported');

  const stripped = stripSettingCardLeaks(leaked, sources);
  assert.equal(stripped.removed.length, 2, 'the strip removes all of them, not just the first');
  assert.deepEqual(detectSettingCardLeaks(stripped.text, sources), []);
});

