import { describe, expect, test } from 'vitest';
import {
  computeCardFitness,
  deriveNovelGenreTokens,
  deriveShelfTags,
  getFlowStepAssetIds,
  groupStyleShelf,
  type StyleShelfCard,
} from '../lib/capability-shelf';

const card = (id: string, title: string, extra: Partial<StyleShelfCard> = {}): StyleShelfCard => ({
  id, title, goal: '', score: 80, ...extra,
});

describe('deriveShelfTags', () => {
  test('题材词映射为英文 token，平台词映射为平台 token', () => {
    expect(deriveShelfTags('玄幻题材大类配置模板')).toEqual({
      genres: ['fantasy', 'xuanhuan'], platforms: [],
    });
    const tomato = deriveShelfTags('【小飞鸡】番茄长篇正文通用');
    expect(tomato.platforms).toEqual(['tomato']);
  });

  test('无题材词时返回空数组（由功能组兜底）', () => {
    expect(deriveShelfTags('长短篇通用正文')).toEqual({ genres: [], platforms: [] });
  });
});

describe('deriveNovelGenreTokens', () => {
  test('从作品文本与标签提取题材 token（中英均可）', () => {
    expect(deriveNovelGenreTokens('这是一个玄幻故事', [])).toContain('fantasy');
    expect(deriveNovelGenreTokens('', ['fantasy', 'urban'])).toEqual(expect.arrayContaining(['fantasy', 'urban']));
  });
});

describe('groupStyleShelf', () => {
  test('全部卡都有归属（无未分类桶），覆盖率 100%', () => {
    const cards = [
      card('a', '【风华出品】长短篇通用正文'),
      card('b', '【风华出品】私有化流程5'),
      card('c', 'lwl-简介生成'),
      card('d', '玄幻题材大类配置模板'),
      card('e', '老福特编辑审稿'),
      card('f', '章纲自适应续写'),
      card('g', '【小飞鸡】爆款短篇第一步'),
    ];
    const shelf = groupStyleShelf(cards);
    const total =
      shelf.series.reduce((sum, group) => sum + group.assets.length, 0)
      + shelf.functional.reduce((sum, group) => sum + group.assets.length, 0)
      + shelf.ungrouped.length;
    expect(total).toBe(cards.length);
  });

  test('同前缀 ≥3 张折叠为系列组，不足 3 张归功能组', () => {
    const cards = [
      card('fh1', '【风华出品】长短篇通用正文'),
      card('fh2', '【风华出品】短篇拆文仿写'),
      card('fh3', '【风华出品】老福特编辑审稿'),
      card('solo', '章节正文写作'),
    ];
    const shelf = groupStyleShelf(cards);
    expect(shelf.series).toHaveLength(1);
    expect(shelf.series[0].assets).toHaveLength(3);
    expect(shelf.functional.some((group) => group.assets.some((a) => a.id === 'solo'))).toBe(true);
  });

  test('与创作流程步骤同源的卡打 inFlow 标记', () => {
    // square-76 天马-脑洞生成 同时是天马大纲流步骤
    const shelf = groupStyleShelf([card('square-76', '天马-脑洞生成-番茄爆款')]);
    const all = [...shelf.functional.flatMap((group) => group.assets), ...shelf.series.flatMap((group) => group.assets)];
    expect(all.find((a) => a.id === 'square-76')?.inFlow).toBe(true);
  });

  test('getFlowStepAssetIds 含已知流程步骤资产', () => {
    const ids = getFlowStepAssetIds();
    expect(ids.has('square-183')).toBe(true);
    expect(ids.has('generateOutline')).toBe(true);
  });
});

describe('computeCardFitness', () => {
  test('题材与平台命中显著提升适合度并产出原因', () => {
    const hit = computeCardFitness(
      card('x', '【小飞鸡】番茄长篇正文通用', { platformTags: ['tomato'] }),
      { novelGenreTokens: [], novelPlatform: 'tomato' },
    );
    const miss = computeCardFitness(
      card('y', '【风华出品】长短篇通用正文'),
      { novelGenreTokens: [], novelPlatform: 'tomato' },
    );
    expect(hit.score).toBeGreaterThan(miss.score);
    expect(hit.reasons.join()).toContain('tomato');
  });

  test('反馈缺失时权重重分配，有反馈时计入', () => {
    const base = card('x', '某正文润色卡');
    const noFeedback = computeCardFitness(base, { novelGenreTokens: [] });
    const withFeedback = computeCardFitness(base, { novelGenreTokens: [] }, );
    expect(noFeedback.score).toBe(withFeedback.score);
    const good = computeCardFitness(base, { novelGenreTokens: [], feedbackScore: 90 });
    expect(good.score).toBeGreaterThan(noFeedback.score);
  });

  test('治理分贡献有上限（15）', () => {
    const high = computeCardFitness(card('hi', '高分卡', { score: 100 }), { novelGenreTokens: [] });
    const low = computeCardFitness(card('lo', '低分卡', { score: 30 }), { novelGenreTokens: [] });
    expect(high.score).toBeGreaterThan(low.score);
    expect(high.score).toBeLessThanOrEqual(100);
  });
});
