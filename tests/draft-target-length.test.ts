import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MIN_COMPLETE_CHAPTER_CHARS,
  MIN_INTENT_DRAFT_CHARS,
  resolveDraftTargetChars,
  resolveEffectiveMinDraftChars,
  validateCompleteChapterDraftQuality,
} from '../shared/lib/draft-quality';
import { ensureMinimumDraftLength } from '../server/helpers/fallback-draft';

// Regression for the plan-172 quality gate deadlock: an intent-declared short
// chapter (e.g. "约800字") must not be padded to the 4000-char full-chapter
// minimum with template text that the gate deterministically rejects.
//
// These tests assert the length-threshold semantics (chapter-below-contract);
// overall gate pass/fail of fixture prose is not a product contract.

const BEATS = [
  '### 场景 1：异动入场',
  '',
  '**核心冲突**：李慕白入店，与说书人初逢。',
].join('\n');

// Shape-rotating prose generator: paragraph openings cycle through pools and
// every sentence embeds the paragraph number, keeping fixture text far enough
// from template noise to isolate the length-threshold behaviour under test.
const OPENINGS = ['雨点敲着瓦檐', '檐角的铁马轻响', '灯影在窗纸上晃', '门轴沉沉转回', '冷风穿过门缝', '茶面的白雾直起'];
const CLUES = ['一枚压在泥里的铜扣', '半张浸湿的布防图', '一道新凿的石缝', '封蜡上倒按的指印'];
const PLACES = ['门后的暗渠入口', '北墙的钟楼基座', '西厢的柴房夹层'];
const FINDINGS = ['纹章的缺口与档案记载互补', '刻痕的走向指向城北', '封蜡的重按方向刻意反了'];
const RISKS = ['雨停之前必须有人先露面', '更声再响两次城门就会换防', '梁上的旁观者随时可能先动'];

const SHAPES = [
  (k: number, n: number) => `第${n}处动静先来：${OPENINGS[k % OPENINGS.length]}。李慕白把${CLUES[k % CLUES.length]}与${PLACES[(k * 2) % PLACES.length]}对在一起看，得出${FINDINGS[k % FINDINGS.length]}的判断。${RISKS[(k * 3) % RISKS.length]}，界线之内谁先伸手谁先暴露。`,
  (k: number, n: number) => `${PLACES[(k * 2) % PLACES.length]}那边有人先动。第${n}轮观察里，${CLUES[(k + 1) % CLUES.length]}被重新掂量了一遍，${RISKS[(k + 1) % RISKS.length]}的说法没有变。同伴把灯拨亮半分，没有人接话。`,
  (k: number, n: number) => `${OPENINGS[(k + 3) % OPENINGS.length]}停了一拍。第${n}处异样浮上来之后，${FINDINGS[(k + 1) % FINDINGS.length]}的判断变得更有分量。他退开半步，给${PLACES[(k + 1) % PLACES.length]}让出视线。`,
  (k: number, n: number) => `${RISKS[(k + 2) % RISKS.length]}。这话一出，第${n}次对照有了新的方向：${CLUES[(k + 2) % CLUES.length]}指向${PLACES[k % PLACES.length]}，与${FINDINGS[(k + 2) % FINDINGS.length]}相互印证。`,
];

function prose(paragraphs: number, offset = 0): string {
  return Array.from({ length: paragraphs }, (_, index) => SHAPES[index % SHAPES.length](index + offset, index + offset + 1)).join('\n\n');
}

test('resolveDraftTargetChars parses declared chapter lengths', () => {
  assert.equal(resolveDraftTargetChars('完成第一章约800字'), 800);
  assert.equal(resolveDraftTargetChars('目标1.5万字'), 15000);
  assert.equal(resolveDraftTargetChars('写3000字'), 3000);
  assert.equal(resolveDraftTargetChars(undefined), null);
  assert.equal(resolveDraftTargetChars('没有声明长度'), null);
  // Below the scene floor the intent is treated as undeclared.
  assert.equal(resolveDraftTargetChars('写300字'), null);
  // The floor itself is the smallest accepted target.
  assert.equal(resolveDraftTargetChars(`写${MIN_INTENT_DRAFT_CHARS}字`), MIN_INTENT_DRAFT_CHARS);
});

test('resolveEffectiveMinDraftChars clamps to the chapter contract', () => {
  assert.equal(resolveEffectiveMinDraftChars(undefined), MIN_COMPLETE_CHAPTER_CHARS);
  assert.equal(resolveEffectiveMinDraftChars('约800字'), 800);
  // 300字 intent is undeclared -> full-chapter minimum.
  assert.equal(resolveEffectiveMinDraftChars('写300字'), MIN_COMPLETE_CHAPTER_CHARS);
  // A 5万字 target cannot exceed the full-chapter contract.
  assert.equal(resolveEffectiveMinDraftChars('写5万字'), MIN_COMPLETE_CHAPTER_CHARS);
});

test('complete-chapter gate applies the intent-aware lower threshold', () => {
  const okText = prose(30); // ~2100 chars
  assert.ok(okText.replace(/\s/g, '').length >= 800);

  // With the short-chapter threshold the text is no longer below contract…
  const shortGate = validateCompleteChapterDraftQuality(okText, undefined, { minChars: 800 });
  assert.equal(shortGate.findings.some((finding) => finding.code === 'chapter-below-contract'), false);

  // …while the default full-chapter threshold still flags it.
  const longGate = validateCompleteChapterDraftQuality(okText);
  assert.equal(longGate.findings.some((finding) => finding.code === 'chapter-below-contract'), true);

  // A draft below the declared target is still below contract.
  const tooShort = prose(6);
  const belowGate = validateCompleteChapterDraftQuality(tooShort, undefined, { minChars: 800 });
  assert.equal(belowGate.findings.some((finding) => finding.code === 'chapter-below-contract'), true);
});

test('ensureMinimumDraftLength no longer force-pads an intent-length draft', async () => {
  const draft = prose(16); // ~1100 chars
  const result = await ensureMinimumDraftLength(draft, BEATS, '李慕白入店', 800);
  const compact = result.replace(/\s/g, '').length;
  // Kept near the declared target: no 4000-char template expansion.
  assert.ok(compact >= 800 && compact < 1500, `expected ~800-1500 chars, got ${compact}`);
  assert.equal(result.includes('屋里先静了一拍'), false, 'no template padding injected');
});

test('a too-short draft is padded to the declared target and passes the gate', async () => {
  const draft = '雨点敲着瓦檐。李慕白收伞，说书人抬眼。';
  const result = await ensureMinimumDraftLength(draft, BEATS, '李慕白入店', 800);
  const compact = result.replace(/\s/g, '').length;
  assert.ok(compact >= 800, `expected >= 800 chars, got ${compact}`);
  const gate = validateCompleteChapterDraftQuality(result, undefined, { minChars: 800 });
  assert.equal(gate.ok, true, gate.violations.join('；'));
});

test('without an intent the full-chapter minimum is preserved', async () => {
  const draft = '雨点敲着瓦檐。李慕白收伞，说书人抬眼。';
  const result = await ensureMinimumDraftLength(draft, BEATS, '李慕白入店');
  assert.ok(result.replace(/\s/g, '').length >= MIN_COMPLETE_CHAPTER_CHARS, 'still pads to the full-chapter minimum');
});