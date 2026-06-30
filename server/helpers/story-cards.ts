import type { StoryIdeaCard } from '../../shared/types';
import { generateId } from '../id.ts';
import { extractJsonPayload } from '../../src/lib/extract-skill-json';

// ---- Story card async job types and store ----

export type StoryCardJob = {
  status: 'pending' | 'completed' | 'failed';
  createdAt: number;
  cards?: StoryIdeaCard[];
  error?: string;
};

export const STORY_CARD_FALLBACK_MS = 2_000;
export const STORY_CARD_MODEL_TIMEOUT_MS = 90_000;
export const STORY_CARD_JOB_TTL_MS = 10 * 60_000;
export const storyCardJobs = new Map<string, StoryCardJob>();

export function createStoryCardJob(task: Promise<StoryIdeaCard[]>): string {
  const jobId = `story-cards-${generateId()}`;
  storyCardJobs.set(jobId, { status: 'pending', createdAt: Date.now() });

  task
    .then((cards) => {
      storyCardJobs.set(jobId, { status: 'completed', createdAt: Date.now(), cards });
    })
    .catch((error) => {
      storyCardJobs.set(jobId, {
        status: 'failed',
        createdAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      });
    });

  setTimeout(() => storyCardJobs.delete(jobId), STORY_CARD_JOB_TTL_MS);
  return jobId;
}

// ---- Input quality gate helpers ----

/** Extract key bigrams/trigrams from ideaSeed for relevance matching. */
export function extractSeedKeywords(seed: string): string[] {
  const cleaned = seed.replace(/[，,。！？、；：\s]+/g, '').trim();
  if (cleaned.length < 2) return [];
  const result: string[] = [];
  // bigrams
  for (let i = 0; i < cleaned.length - 1; i++) {
    result.push(cleaned.slice(i, i + 2));
  }
  // trigrams
  for (let i = 0; i < cleaned.length - 2; i++) {
    result.push(cleaned.slice(i, i + 3));
  }
  // Deduplicate, favoring longer forms
  const seen = new Set<string>();
  return result.filter((k) => {
    if (seen.has(k) || k.length < 2) return false;
    seen.add(k);
    return true;
  });
}

/** Generic/boilerplate hook patterns the model must not produce. */
const GENERIC_HOOK_PATTERNS = [
  /^一个关于.{1,10}的(传奇|故事|传说|篇章|史诗)/,
  /^这是一个.{1,10}的(传奇|故事|传说)/,
  /^命运的.{1,8}(故事|传奇|篇章|交响)/,
  /^一段.{1,8}的(旅程|冒险|传说|故事|史诗)/,
  /^.{1,5}的(传奇|故事|传说)由此(展开|开始|拉开)/,
  /^当.{1,10}遇上.{1,10}会(怎样|如何|发生什么)/,
  /^.{1,3}(和|与).{1,3}的.{1,5}(故事|传奇)/,
  /^.{1,8}之(路|旅|谜|歌|光|影|殇)/,
];

export function hookIsGeneric(hook: string): boolean {
  const trimmed = hook.trim();
  return GENERIC_HOOK_PATTERNS.some((p) => p.test(trimmed));
}

/** Check if hook contains at least one keyword from the seed. */
export function hookMatchesSeed(hook: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true; // can't check, pass
  const cleaned = hook.replace(/[，,。！？、；：\s]+/g, '');
  return keywords.some((kw) => cleaned.includes(kw));
}

/** True when hook is too short or just repeats the seed verbatim with no expansion. */
export function hookIsTrivial(hook: string, seed: string): boolean {
  const cleanedHook = hook.replace(/[，,。！？、；：\s]+/g, '').trim();
  const cleanedSeed = seed.replace(/[，,。！？、；：\s]+/g, '').trim();
  if (cleanedHook.length < 5) return true;
  // Hook is just the seed + trash suffix
  if (cleanedHook.startsWith(cleanedSeed) && cleanedHook.length <= cleanedSeed.length + 6) return true;
  return false;
}

export function parseStoryCardsFromModel(raw: string, ideaSeed: string): StoryIdeaCard[] {
  const parsed = extractJsonPayload(raw);
  // Model returned needs_clarification — user input not usable as story seed
  if (parsed?.status === 'needs_clarification') {
    throw new Error(JSON.stringify({
      type: 'needs_clarification',
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    }));
  }
  const cards = Array.isArray(parsed?.cards) ? parsed.cards : Array.isArray(parsed) ? parsed : [parsed];
  const validCards = cards.filter((card: any) => card && typeof card.hook === 'string' && typeof card.whyItWorks === 'string');
  if (validCards.length === 0) {
    throw new Error('Model returned no valid story cards');
  }
  // Post-model quality gate: reject noise/hallucination
  const hooks = validCards.map((c: any) => c.hook || '');
  const uniqueHooks = new Set(hooks.map((h: string) => h.slice(0, 10)));
  if (uniqueHooks.size < 2 && validCards.length >= 3) {
    throw new Error('Post-model quality gate: cards too similar');
  }
  // Reject cards where hook is just repeating gibberish
  const gibberish = /^[a-zA-Z0-9]{1,4}$|^[啊嗯哦哎哈嘿啧]{1,3}$|^不补|啵$/;
  if (hooks.some((h: string) => gibberish.test(h.trim()))) {
    throw new Error('Post-model quality gate: hook contains noise/gibberish');
  }

  // --- New output quality gates ---

  const seedKeywords = extractSeedKeywords(ideaSeed.trim());
  const seedNormalized = ideaSeed.replace(/[，,。！？、；：\s]+/g, '').trim();

  // Gate 1: reject generic/boilerplate hooks
  const genericHooks = hooks.filter((h: string) => hookIsGeneric(h));
  if (genericHooks.length >= hooks.length) {
    throw new Error('Post-model quality gate: all hooks are boilerplate/generic patterns');
  }

  // Gate 2: reject hooks that don't reference any keyword from the input seed
  if (seedKeywords.length > 0) {
    const matchingHooks = hooks.filter((h: string) => hookMatchesSeed(h, seedKeywords));
    if (matchingHooks.length === 0 && seedNormalized.length >= 4) {
      throw new Error('Post-model quality gate: no hook references input seed keywords');
    }
  }

  // Gate 3: reject trivial hooks (too short, or just repeat the seed)
  const trivialHooks = hooks.filter((h: string) => hookIsTrivial(h, seedNormalized));
  if (trivialHooks.length >= hooks.length) {
    throw new Error('Post-model quality gate: all hooks are too trivial / just repeat the seed');
  }

  // Gate 4: if majority of hooks are generic, downgrade to fallback
  if (genericHooks.length >= 2 && validCards.length === 3) {
    throw new Error('Post-model quality gate: majority of hooks are generic boilerplate');
  }

  // Auto-populate structural fields the model no longer outputs (reduced output schema)
  const seedKeyTerms = extractKeywords(ideaSeed);
  const mainTerm = seedKeyTerms[0] || ideaSeed.slice(0, 4);
  const secondTerm = seedKeyTerms[1] || mainTerm;
  const tones = ['冷峻悬疑', '热血逆袭', '慢热铺陈'];

  return validCards.map((card: any, i: number) => ({
    id: `model-card-${generateId()}`,
    hook: card.hook || '',
    protagonist: card.protagonist || '',
    coreConflict: card.coreConflict || '',
    tone: card.tone || tones[i % tones.length],
    whyItWorks: card.whyItWorks || '',
    riskNote: card.riskNote || '开局冲突不够尖锐，需要第一章迅速建立具体威胁。',
    mixTags: Array.isArray(card.mixTags) ? card.mixTags : [],
    starterSeeds: {
      worldSeed: card.coreConflict
        ? `以${mainTerm}为核心的世界设定，${card.coreConflict.slice(0, 20)}`
        : `以${mainTerm}为核心背景`,
      relationshipSeed: i === 0
        ? '主角与他人之间既有利益交集也有信息差，合作中藏着试探。'
        : i === 1
          ? '主角被迫与对立角色周旋，每次对白都是双向刺探。'
          : '关键人物关系充满不信任，所有交谈都是博弈。',
      chapterOneSeed: `第一章从${card.hook ? card.hook.slice(0, 20) : mainTerm}的信号开场，快速建立冲突，留下悬念钩子。`,
    },
    planningFit: {
      recommendedLength: '中长篇',
      recommendedFocus: '剧情推进',
      recommendedPacing: '紧推进',
      reason: `该方向能围绕核心冲突展开，与输入意自然衔接。`,
    },
    signals: {
      tone: card.tone || '冷峻悬疑',
      conflictType: i === 0 ? '事件引爆' : i === 1 ? '利益博弈' : '秘密羁绊',
      worldWeight: 0.5,
      characterWeight: 0.5,
      pacingPreference: 'tight' as const,
    },
  }));
}

export function extractKeywords(seed: string): string[] {
  // Extract meaningful 2-4 char Chinese substrings, skip common stop words
  const stop = new Set(['一个', '这个', '那个', '什么', '怎么', '为什么', '可以', '还是', '或者', '但是', '因为', '所以', '如果', '虽然', '已经', '而且', '我的', '你的', '他的', '我们', '他们', '你们', '关于', '自己', '没有', '不是', '就是', '的话', '来说', '这样', '那样', '如何']);
  const cleaned = seed.replace(/[，,。！？、；：""''（）\s]+/g, ' ').trim();
  const segments = cleaned.split(' ').filter(s => s.length >= 2 && !stop.has(s));
  // Also split longer segments into bigrams for better coverage
  const bigrams: string[] = [];
  for (const seg of segments) {
    for (let i = 0; i < seg.length - 1; i++) {
      bigrams.push(seg.slice(i, i + 2));
    }
  }
  // Deduplicate, prefer original segments first, then bigrams
  const seen = new Set<string>();
  const result: string[] = [];
  for (const s of [...segments, ...bigrams]) {
    if (!seen.has(s) && s.length >= 2) {
      seen.add(s);
      result.push(s);
    }
  }
  return result.slice(0, 6);
}

export function buildFallbackStoryCards(
  ideaSeed: string,
  planning: Partial<{
    expectedWordCount: number;
    pacingPreference: 'tight' | 'balanced' | 'slow-burn';
    storyFocus: 'plot' | 'character' | 'world';
  }>,
  batchIndex = 0,
  previousHookTexts: string[] = [],
) {
  const seed = String(ideaSeed || '').trim() || '一个尚未成形的新故事';
  const keywords = extractKeywords(seed);
  const mainTerm = keywords[0] || '故事核心';
  const secondTerm = keywords[1] || mainTerm;
  const thirdTerm = keywords[2] || secondTerm;

  const expectedWordCount = Number(planning.expectedWordCount || 180000);
  const pacing = planning.pacingPreference || 'tight';
  const focus = planning.storyFocus || 'plot';
  const pacingText = pacing === 'slow-burn' ? '慢热铺陈' : pacing === 'balanced' ? '均衡推进' : '紧推进';
  const focusText = focus === 'character' ? '人物关系' : focus === 'world' ? '世界设定' : '剧情推进';
  const lengthText = expectedWordCount >= 500000 ? '长篇连载' : expectedWordCount >= 180000 ? '中长篇' : '中短篇';

  // Direction pools — selected based on storyFocus
  const directionPools: Record<string, Array<{
    label: string;
    hookTemplate: (main: string, second: string) => string;
    protagonistTemplate: (main: string) => string;
    conflictTemplate: (main: string, second: string) => string;
    tone: string;
    whyTemplate: (seed: string) => string;
    risk: string;
  }>> = {
    character: [
      {
        label: '双人对峙',
        hookTemplate: (m) => `${m}让两个本不该有交集的人绑在一起`,
        protagonistTemplate: () => '一个习惯沉默观察的主角，一个话多但每次都说到痛处的对照角色。',
        conflictTemplate: (m) => `两人围绕${m}各怀目的，合作中藏着试探。`,
        tone: '对手戏强、对白驱动、关系递进。',
        whyTemplate: (s) => `把"${s}"从事件转为人际张力，每章人物关系都有新裂痕或新理解。`,
        risk: '不能太快信任——每次合作都要留一道新疤。',
      },
      {
        label: '秘密羁绊',
        hookTemplate: (m) => `${m}揭开了一段无人知晓的过往`,
        protagonistTemplate: () => '一个被迫隐藏身份的主角，一个意外知晓秘密的闯入者。',
        conflictTemplate: (m) => `关于${m}的秘密一旦泄露，双方的关系会立刻翻转。`,
        tone: '情感层次丰富、秘密逐层剥开。',
        whyTemplate: (s) => `"${s}"天然有秘密属性，适合构建"只有你知道"的羁绊张力。`,
        risk: '秘密不能拖太久——到中段必须有代价显现。',
      },
      {
        label: '利益博弈',
        hookTemplate: (m) => `${m}让所有人的利益重新洗牌`,
        protagonistTemplate: () => '一个站在利益交叉点的主角，身边每个人都在押注。',
        conflictTemplate: (m) => `${m}改变了原有的利益格局，盟友和敌人开始重新站位。`,
        tone: '理智博弈、利益交换、人情与算计交织。',
        whyTemplate: (s) => `"${s}"能制造持续的利益张力，每章都有人在押新的赌注。`,
        risk: '利益冲突要具体——不能只写"他们各怀鬼胎"，要写出谁想要什么。',
      },
    ],
    world: [
      {
        label: '规则异变',
        hookTemplate: (m) => `${m}正在改写这个世界的规则`,
        protagonistTemplate: () => '一个在旧规则下成长的主角，突然发现世界运作的方式变了。',
        conflictTemplate: (m) => `${m}揭示的力量/规则与原有体系产生根本冲突。`,
        tone: '宏大设定、规则驱动、层层展开。',
        whyTemplate: (s) => `"${s}"可以作为世界规则的突破口，第一章就建立独特设定感。`,
        risk: '设定不能全在第一章倾倒——让主角逐步发现规则，读者同步理解。',
      },
      {
        label: '势力交错',
        hookTemplate: (m) => `${m}打破了旧势力的平衡`,
        protagonistTemplate: () => '一个夹在多股势力之间的棋子，被迫学会在夹缝中求生。',
        conflictTemplate: (m) => `${m}成为各方势力争夺的关键，主角必须在站位中做选择。`,
        tone: '格局宏大、多线交织、派系博弈。',
        whyTemplate: (s) => `以"${s}"为锚点展开势力图，每卷都能引入新的派系和冲突。`,
        risk: '派系太多会让读者记不住——每卷聚焦2-3个主要势力。',
      },
      {
        label: '未知领域',
        hookTemplate: (m) => `${m}指向了一个从未被探索的领域`,
        protagonistTemplate: () => '一个被好奇心或生存压力逼入未知世界的主角，每步都在发现新规则。',
        conflictTemplate: (m) => `探索${m}的过程中，主角不断遇到违背原有认知的存在。`,
        tone: '探索感强、未知与惊奇、世界逐步展开。',
        whyTemplate: (s) => `"${s}"自带未知属性，适合让读者随主角一起探索新世界。`,
        risk: '不能只写"主角震惊了"——每次探索要有一个可被记住的新规则或新存在。',
      },
    ],
    plot: [
      {
        label: '事件引爆',
        hookTemplate: (m) => `当${m}成为不可回避的导火索`,
        protagonistTemplate: (m) => `一个被${m}卷入漩涡的主角，不得不直面这场危机。`,
        conflictTemplate: (m) => `围绕${m}展开的核心冲突，每章局势都在升级。`,
        tone: '紧张、高节奏、冲突密集。',
        whyTemplate: (s) => `直接围绕"${s}"打造高冲突开局，第一章冲突明确，读者容易代入。`,
        risk: '冲突密度过高可能导致疲劳，需要在关键节点留喘息空间。',
      },
      {
        label: '多米诺链',
        hookTemplate: (m) => `${m}引发的连锁反应刚刚开始`,
        protagonistTemplate: (m) => `一个以为解决了${m}就能脱身的主角，发现每解决一件事又引出两件。`,
        conflictTemplate: (m) => `${m}不是终点而是起点，每步处理都牵出新危机。`,
        tone: '快节奏、一环扣一环、爆点密集。',
        whyTemplate: (s) => `让"${s}"像多米诺骨牌一样推倒后续事件，适合紧凑连载。`,
        risk: '需要控制链的长度——3-5个节点后要有一个阶段性收束。',
      },
      {
        label: '时间紧迫',
        hookTemplate: (m) => `${m}设下了一个倒计时的局`,
        protagonistTemplate: (m) => `一个必须在时限内解决${m}的主角，每一步都面对倒计时压力。`,
        conflictTemplate: (m) => `${m}的时限越来越近，主角必须在资源不足的情况下做选择。`,
        tone: '紧迫感强、节奏紧凑、每一步都是赌注。',
        whyTemplate: (s) => `给"${s}"加上时间压力，天然制造章节钩子和紧张感。`,
        risk: '倒计时不能一直延——到高潮时必须真的有人付出代价。',
      },
    ],
  };

  const directions = directionPools[focus] || directionPools.plot;

  // Rotate directions per batch for variation
  const rotated = [...directions];
  for (let r = 0; r < batchIndex % directions.length; r++) rotated.push(rotated.shift()!);

  const batchSuffix = batchIndex > 0 ? ['', '（变体）', '（另辟蹊径）'][Math.min(batchIndex, 2)] : '';

  const base = rotated.map((dir, i) => ({
    id: `fallback-card-${batchIndex}-${i + 1}`,
    hook: dir.hookTemplate(mainTerm, secondTerm) + batchSuffix,
    protagonist: dir.protagonistTemplate(mainTerm),
    coreConflict: dir.conflictTemplate(mainTerm, secondTerm),
    tone: dir.tone,
    whyItWorks: dir.whyTemplate(seed),
    riskNote: dir.risk,
    mixTags: keywords.slice(0, 4),
    signals: {
      tone: (['sharp', 'grim', 'lyrical'] as const)[i],
      conflictType: dir.label,
      worldWeight: 0.45 + i * 0.1,
      characterWeight: 0.6 + i * 0.1,
      pacingPreference: pacing,
    },
  }));

  return base.map((card, i) => ({
    ...card,
    starterSeeds: {
      worldSeed: `以${mainTerm}为核心构建的世界背景，${secondTerm ? `与${secondTerm}交织` : ''}。`,
      relationshipSeed: i === 2
        ? '主角与同伴之间保持不信任的合作关系，一边共事一边试探。'
        : '主角与关键人物之间既有利益交集也有信息差。',
      chapterOneSeed: `第一章从${mainTerm}的异常信号开场，迅速建立${card.signals.conflictType}冲突，留下第一枚悬念钩子。`,
    },
    planningFit: {
      recommendedLength: `${lengthText}，约 ${expectedWordCount.toLocaleString('zh-CN')} 字`,
      recommendedFocus: focusText,
      recommendedPacing: pacingText,
      reason: `该方向适合${pacingText}节奏，能把叙事重心放在${focusText}上，与"${seed}"自然衔接。`,
    },
  })).map(card => ({
    ...card,
    hook: cleanCardField(card.hook),
    protagonist: cleanCardField(card.protagonist),
    coreConflict: cleanCardField(card.coreConflict),
  }));
}

export function cleanCardField(text: string): string {
  return text
    .replace(/我想写一个?\s*/g, '')
    .replace(/我想写\s*/g, '')
    .replace(/^当当\s*/g, '')
    .replace(/作者/g, '')
    .replace(/这个故事/g, '这个故事')  // keep for now but flag
    .replace(/\s{2,}/g, ' ')
    .trim();
}
