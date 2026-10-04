import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FALLBACK_CADENCE_LINES,
  FALLBACK_CYCLE_BRIDGES,
  FALLBACK_DETAIL_HINTS,
  FALLBACK_PARAGRAPH_TEMPLATES,
  FALLBACK_REFLECTION_LINES,
  FALLBACK_TEMPO_BEATS,
  FALLBACK_TEXTURE_LINES,
  FALLBACK_TURN_LINES,
  buildFallbackDraft,
  buildFallbackSceneBeats,
  countDraftChars,
  extractFallbackCast,
} from '../server/helpers/fallback-draft';

// Plan 279（R-278-1）：确定性保底稿是作者真的会看到的正文（模型路径彻底失败时交付），
// 所以它不能带年代/地域道具与腔调——「更漏、银票、马厩、算命摊、梆子」这类句子会让
// 现代背景的稿子读起来像另一部书（真机 pro 档位实测：稿尾成片出现，critic 直接判崩）。
const PERIOD_PROPS = [
  '更鼓',
  '更夫',
  '更漏',
  '更声',
  '打更',
  '二更',
  '梆子',
  '马厩',
  '骡子',
  '渡船',
  '艄公',
  '算命',
  '签筒',
  '布庄',
  '琴声',
  '火漆',
  '铜锁',
  '铜钱',
  '铜铃',
  '铁马',
  '灯花',
  '砚台',
  '井绳',
  '药炉',
  '灶膛',
  '火盆',
  '窗纸',
  '铜扣',
  '刀鞘',
  '账房',
  '账页',
  '掌柜',
  '灰袍',
  '草帽',
  '檐角',
  '檐下',
  '柴灰',
  '酒过三巡',
  '布袖',
  '笼头',
  '靴筒',
  '银票',
  '渡口',
  '铜盆',
  '怀表',
  '字据',
  '门房',
  '厨下',
  '铜台',
  '灯笼',
  '棋子',
  '烛泪',
  '月色',
];

function renderPools(): string {
  return [
    ...FALLBACK_PARAGRAPH_TEMPLATES.map((build) => build('他注意到门边的一点动静')),
    ...FALLBACK_CADENCE_LINES,
    ...FALLBACK_DETAIL_HINTS,
    ...FALLBACK_TEXTURE_LINES,
    ...FALLBACK_REFLECTION_LINES,
    ...FALLBACK_TURN_LINES,
    ...FALLBACK_CYCLE_BRIDGES,
    ...FALLBACK_TEMPO_BEATS,
  ].join('\n');
}

test('fallback filler pools carry no period-specific props', () => {
  const rendered = renderPools();

  for (const prop of PERIOD_PROPS) {
    assert.ok(!rendered.includes(prop), `filler pool leaks the period prop ${prop}`);
  }
  assert.ok(countDraftChars(rendered) > 2000, 'the filler pools are still substantial');
});

test('a deterministic fallback draft stays prop-free end to end', () => {
  const beats = buildFallbackSceneBeats('林舟必须在追兵合围之前把证据交出去');
  const context = '关键人物：\n- 林舟：潜伏在港务署的旧值班室，负责核对每一条船期。';
  const draft = buildFallbackDraft(beats, context, 6000);

  for (const prop of PERIOD_PROPS) {
    assert.ok(!draft.includes(prop), `fallback draft leaks the period prop ${prop}`);
  }
  assert.ok(countDraftChars(draft) >= 6000, 'the fallback draft still fills the length contract');
});

// Plan 281（R-279-1）：保底稿也要有人在场。花名册（Plan 278 起只写「- 名字」）是唯一
// 允许的取名来源，档案摘要一律不取——那正是 setting-card 泄漏门禁堵住的路径。
test('extractFallbackCast reads the roster block and nothing else', () => {
  const NL = String.fromCharCode(10);
  const context = [
    '作品：夜航',
    '关键人物：',
    '- 林舟（港务署旧值班室）：负责核对每一条船期。',
    '- 苏晚',
    '- 第三个名字',
    '关键道具：',
    '- 黄铜钥匙：开了三号仓。',
  ].join(NL);

  assert.deepEqual(extractFallbackCast(context), ['林舟', '苏晚']);
  assert.deepEqual(extractFallbackCast(context, 1), ['林舟']);
  assert.deepEqual(extractFallbackCast(['关键人物：', '- 无'].join(NL)), []);
  assert.deepEqual(extractFallbackCast('作品：夜航'), []);
});

test('a deterministic fallback draft puts the roster cast on stage and keeps the archive out', () => {
  const NL = String.fromCharCode(10);
  const beats = buildFallbackSceneBeats('林舟必须在追兵合围之前把证据交出去');
  const context = ['关键人物：', '- 林舟（港务署旧值班室）：负责核对每一条船期。', '- 苏晚'].join(NL);
  const draft = buildFallbackDraft(beats, context, 6000);

  assert.ok(draft.includes('林舟停在门边'), 'the lead from the roster is on stage');
  assert.ok(draft.includes('苏晚挪开杯盏'), 'the second roster name is on stage');
  assert.ok(!draft.includes('负责核对每一条船期'), 'the archive sketch never becomes prose');
  for (const prop of PERIOD_PROPS) {
    assert.ok(!draft.includes(prop), 'fallback draft leaks the period prop ' + prop);
  }
  assert.ok(countDraftChars(draft) >= 6000, 'the grounded fallback still fills the length contract');
});

test('evidence-label sentinels never become fallback cast members', () => {
  const NL = String.fromCharCode(10);
  const context = [
    '关键人物：',
    '- 角色证据-林舟：只用左手解读导师暗号',
    '- 世界证据-潮汐城',
    '- 伏笔证据-青铜铃',
  ].join(NL);

  assert.deepEqual(extractFallbackCast(context), []);

  const beats = buildFallbackSceneBeats('写一个雨夜场景');
  const draft = buildFallbackDraft(beats, context, 6000);
  for (const sentinel of ['角色证据', '世界证据', '伏笔证据']) {
    assert.ok(!draft.includes(sentinel), 'fallback draft leaks the sentinel ' + sentinel);
  }
  assert.ok(
    countDraftChars(draft) >= 6000,
    'the ungrounded fallback still fills the length contract'
  );
});
