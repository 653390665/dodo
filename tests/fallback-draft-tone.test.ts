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
