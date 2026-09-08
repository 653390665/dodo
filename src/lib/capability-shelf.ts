import { SKILL_SERIES_FLOWS } from '../../shared/lib/public-skill-catalog';

/**
 * 013：文风与正文货架的分类学 + 适合度评分（纯展示层计算，不写入资产）。
 *
 * 设计要点：
 * - 题材/平台信号从标题与描述做规则特征化（目录 genreTags 仅 12% 覆盖）；
 * - 系列卡（同前缀 ≥3 张）折叠为一个系列组；
 * - 与创作流程步骤同源的卡打「已含于创作流程」标记（双重身份消重）；
 * - 适合度 = 题材命中(30) + 平台匹配(20) + 阶段匹配(15) + 使用反馈(20) + 治理分(15)；
 *   反馈无样本时其权重按比例分配给题材与平台。
 */

export type StyleShelfGroupName =
  | 'prose-style'
  | 'story-gen'
  | 'outline-setting'
  | 'topic-template'
  | 'deconstruct-imitate';

export const STYLE_SHELF_GROUP_LABELS: Record<StyleShelfGroupName, string> = {
  'prose-style': '正文润色与文风',
  'story-gen': '故事生成',
  'outline-setting': '大纲与设定',
  'topic-template': '题材模板',
  'deconstruct-imitate': '拆书与仿写',
};

/** 题材 token → 中文标签（与 inferNovelGovernanceProfile 的英文 token 对齐）。 */
const GENRE_LABELS: Record<string, string> = {
  fantasy: '玄幻', cultivation: '修真修仙', urban: '都市', mystery: '悬疑推理',
  romance: '言情', scifi: '科幻', apocalypse: '末世', rebirth: '重生',
  transmigration: '穿越', 'quick-transmigration': '快穿', palace: '宫斗宅斗',
  ensemble: '群像剧', history: '权谋历史', gaming: '电竞游戏', 'light-novel': '轻小说',
  drama: '追妻火葬场', xuanhuan: '玄幻', xiuzhen: '修真修仙',
};

const GENRE_RULES: ReadonlyArray<{ token: string; re: RegExp }> = [
  { token: 'fantasy', re: /玄幻/ },
  { token: 'cultivation', re: /修真|修仙/ },
  { token: 'urban', re: /都市/ },
  { token: 'mystery', re: /悬疑|推理/ },
  { token: 'romance', re: /言情/ },
  { token: 'scifi', re: /科幻|末世/ },
  { token: 'rebirth', re: /重生/ },
  { token: 'palace', re: /宫斗|宅斗/ },
  { token: 'history', re: /权谋|历史/ },
  { token: 'gaming', re: /电竞|游戏/ },
  { token: 'light-novel', re: /轻小说/ },
  { token: 'drama', re: /追妻火葬场/ },
  { token: 'xuanhuan', re: /玄幻/ },
];

const PLATFORM_RULES: ReadonlyArray<{ token: string; re: RegExp }> = [
  { token: 'tomato', re: /番茄|tomato/i },
  { token: 'laofeite', re: /老福特/ },
];

/** 从标题/描述特征化出题材与平台 token（仅小写 token，用于与 genreTags 交集）。 */
export function deriveShelfTags(title: string, goal = ''): { genres: string[]; platforms: string[] } {
  const text = `${title}\n${goal}`;
  const genres = GENRE_RULES.filter(({ re }) => re.test(text)).map(({ token }) => token);
  const platforms = PLATFORM_RULES.filter(({ re }) => re.test(text)).map(({ token }) => token);
  return { genres, platforms };
}

/** 作品侧题材 token：扫描标题/简介/标签文本（复用 inferNovelGovernanceProfile 的中文词表思路）。 */
export function deriveNovelGenreTokens(novelText: string, tags: ReadonlyArray<string>): string[] {
  const tokens = new Set<string>();
  const knownTokens = new Set(GENRE_RULES.map(({ token }) => token));
  for (const tag of tags) {
    // 标签本身已是英文 token 时直接收录（作品 tags 为中文，推断走下方规则）
    if (knownTokens.has(tag.toLowerCase())) tokens.add(tag.toLowerCase());
    for (const { token, re } of GENRE_RULES) {
      if (re.test(tag)) tokens.add(token);
    }
    const normalized = tag.toLowerCase();
    for (const { token, re } of GENRE_RULES) {
      if (re.test(normalized)) tokens.add(token);
    }
  }
  for (const { token, re } of GENRE_RULES) {
    if (re.test(novelText)) tokens.add(token);
  }
  return [...tokens];
}

/** 系列前缀：【品牌】、品牌- 前缀。 */
function extractSeriesKey(title: string): string | null {
  const branded = title.match(/^【([^】]+)】/);
  if (branded) return `【${branded[1]}】`;
  const dashed = title.match(/^([A-Za-z]+)-/);
  if (dashed) return dashed[1];
  const cn = title.match(/^([一-龥]{2,6})-(?=[一-龥])/);
  if (cn) return cn[1];
  return null;
}

/** 与创作流程步骤同源的资产 id（双重身份：流程步骤 + 独立卡）。 */
export function getFlowStepAssetIds(): ReadonlySet<string> {
  return new Set(SKILL_SERIES_FLOWS.flatMap((flow) => flow.steps.map((step) => step.assetId)));
}

export interface StyleShelfCard {
  id: string;
  title: string;
  goal?: string;
  score?: number;
  genreTags?: ReadonlyArray<string>;
  platformTags?: ReadonlyArray<string>;
}

export interface StyleShelfGroup<T extends StyleShelfCard = StyleShelfCard> {
  key: string;
  label: string;
  kind: 'series' | 'functional';
  assets: Array<T & { inFlow: boolean; seriesKey: string | null }>;
}

export interface GroupedStyleShelf<T extends StyleShelfCard = StyleShelfCard> {
  series: StyleShelfGroup<T>[];
  functional: StyleShelfGroup<T>[];
  ungrouped: StyleShelfGroup<T>['assets'];
}

function classifyFunctional(title: string, goal = ''): StyleShelfGroupName {
  const text = `${title}\n${goal}`;
  if (/拆书|仿写/.test(text)) return 'deconstruct-imitate';
  if (/题材大类|配置模板/.test(text)) return 'topic-template';
  if (/大纲|章纲|细纲/.test(text)) return 'outline-setting';
  if (/脑洞|世界观|角色|人设|简介|事件|灵感|金手指/.test(text)) return 'story-gen';
  return 'prose-style';
}

/**
 * 把文风与正文货架分组：系列组（同前缀 ≥3 张，折叠展示）+ 功能组（其余卡）。
 * 保证每张卡都有归属（系列组或功能组），无"未分类"桶。
 */
export function groupStyleShelf<T extends StyleShelfCard>(assets: ReadonlyArray<T>): GroupedStyleShelf<T> {
  const enriched = assets.map((asset) => {
    const seriesKey = extractSeriesKey(asset.title);
    return { ...asset, inFlow: getFlowStepAssetIds().has(asset.id), seriesKey };
  });

  type Enriched = T & { inFlow: boolean; seriesKey: string | null };
  const bySeries: Record<string, Enriched[]> = {};
  const rest: Enriched[] = [];
  for (const card of enriched) {
    if (card.seriesKey) {
      (bySeries[card.seriesKey] = bySeries[card.seriesKey] || []).push(card);
    } else {
      rest.push(card);
    }
  }

  const series: StyleShelfGroup<T>[] = Object.entries(bySeries)
    .filter(([, cards]) => cards.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, cards]) => ({ key, label: key, kind: 'series' as const, assets: cards }));

  const seriesKeys = new Set(series.map((group) => group.key));
  const loose = enriched.filter(
    (card) => !card.seriesKey || !seriesKeys.has(card.seriesKey),
  );

  const functionalByGroup: Record<StyleShelfGroupName, typeof loose> = {
    'prose-style': [], 'story-gen': [], 'outline-setting': [],
    'topic-template': [], 'deconstruct-imitate': [],
  };
  for (const card of loose) {
    functionalByGroup[classifyFunctional(card.title, card.goal)].push(card);
  }
  const functional: StyleShelfGroup<T>[] = (
    Object.entries(functionalByGroup) as Array<[StyleShelfGroupName, typeof loose]>
  )
    .filter(([, cards]) => cards.length > 0)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, cards]) => ({ key, label: STYLE_SHELF_GROUP_LABELS[key], kind: 'functional' as const, assets: cards }));

  return { series, functional, ungrouped: [] };
}

export interface CardFitnessContext {
  /** 作品侧题材 token（deriveNovelGenreTokens 产物）。 */
  novelGenreTokens: ReadonlyArray<string>;
  /** 作品侧平台 token（如 'tomato'；空则平台项不计分并重分配）。 */
  novelPlatform?: string;
  /** 当前创作阶段（'planner' | 'drafting' | 'polish'…；空则阶段项不计分并重分配）。 */
  stage?: string;
  /** 使用反馈分 0-100（skill_usage_records 聚合；无样本则不提供，权重重分配）。 */
  feedbackScore?: number;
}

export interface CardFitness {
  score: number;
  reasons: string[];
}

const GENRE_LABEL_FALLBACK = (token: string) => GENRE_LABELS[token] || token;

/** 适合度评分：展示层计算，五信号加权，无样本信号权重自动重分配。 */
export function computeCardFitness(
  asset: StyleShelfCard & { platformTags?: ReadonlyArray<string>; genreTags?: ReadonlyArray<string> },
  ctx: CardFitnessContext,
): CardFitness {
  const derived = deriveShelfTags(asset.title, asset.goal);
  const assetGenres = new Set([...derived.genres, ...(asset.genreTags || [])]);
  const assetPlatforms = new Set([...derived.platforms, ...(asset.platformTags || [])]);

  const reasons: string[] = [];
  let score = 0;
  let activeMax = 0;

  // 题材命中（基础权重 30）
  if (ctx.novelGenreTokens.length > 0) {
    activeMax += 30;
    const hit = [...ctx.novelGenreTokens].find((token) => assetGenres.has(token));
    if (hit) {
      score += 30;
      reasons.push(`✓ 命中题材：${GENRE_LABEL_FALLBACK(hit)}`);
    }
  }

  // 平台匹配（基础权重 20）
  if (ctx.novelPlatform) {
    activeMax += 20;
    if (assetPlatforms.has(ctx.novelPlatform)) {
      score += 20;
      reasons.push(`✓ 适配平台：${ctx.novelPlatform}`);
    }
  }

  // 阶段匹配（基础权重 15；无阶段上下文则重分配给题材与平台各 +7.5）
  if (ctx.stage) {
    activeMax += 15;
    // optional-style 资产以 polish 为主；当前阶段即 polish 时视为匹配
    if (ctx.stage === 'polish' || ctx.stage === 'drafting') {
      score += 15;
      reasons.push('✓ 匹配当前阶段');
    }
  } else {
    activeMax += 15;
  }

  // 使用反馈（基础权重 20；无样本重分配：题材 +12、平台 +8）
  const hasFeedback = typeof ctx.feedbackScore === 'number';
  if (hasFeedback) {
    activeMax += 20;
    score += Math.round((ctx.feedbackScore as number) / 100 * 20);
    reasons.push('✓ 有真实使用反馈');
  } else {
    if (ctx.novelGenreTokens.length > 0) activeMax += 12;
    if (ctx.novelPlatform) activeMax += 8;
  }

  // 治理分（固定 15，归一化）
  activeMax += 15;
  score += Math.round(((asset.score ?? 0) / 100) * 15);

  return { score: activeMax > 0 ? Math.round((score / activeMax) * 100) : 0, reasons };
}
