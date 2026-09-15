/**
 * Plan 227 工序签名：把能力卡建模为工序算子——
 * 卡 := (方向 mode, 工位 station, 套牌 series)。
 *
 * 签名由目录既有字段（title/primaryCategory/stage/goal）确定性推导，
 * 显式覆盖表只处理推导歧义的个别卡；228/229 按此签名消费。
 * 输入是最小结构形状：货架投影卡（CuratedProductSkill）与治理目录条目
 * （GovernedPromptAsset）都能直接传入。
 */

export type CraftMode = 'generate' | 'refine' | 'polish' | 'inspect';

export interface CraftInput {
  id: string;
  title: string;
  goal?: string;
  stage?: string;
  primaryCategory?: string;
}

export interface CraftSignature {
  mode: CraftMode;
  /** 工位：同工位的卡相互竞争（同一章只能选一张），跨工位可自由叠加。 */
  station: string;
  seriesId: string | null;
  /** 套牌内的序号（1 起），非套牌卡为 null。 */
  seriesOrder: number | null;
}

/** 推导歧义的显式覆盖（id → 部分签名）。228 落地的重构卡在此登记 mode: 'refine'。 */
const CRAFT_OVERRIDES: Record<string, Partial<CraftSignature>> = {};

const POLISH_PATTERN = /润色|去\s*AI|改写|净化|降\s*AI/;

/** 与 capability-shelf 的 extractSeriesKey 同源：套牌识别靠卡面前缀。 */
function extractSeriesId(title: string): string | null {
  const branded = title.match(/^【([^】]+)】/);
  if (branded) return `【${branded[1]}`;
  const dashed = title.match(/^([A-Za-z]+)-/);
  if (dashed) return dashed[1];
  const cn = title.match(/^([一-龥]{2,6})-(?=[一-龥])/);
  if (cn) return cn[1];
  // Plan 229：无连字符的已知品牌前缀（克苏鲁标题/克苏鲁正文…是一剂方子）。
  const brandedPrefix = BRAND_SERIES_PREFIXES.find((prefix) => title.startsWith(prefix));
  return brandedPrefix ?? null;
}

/** 无连字符的品牌系列前缀（与 dash 规则互补；只列确认成套的品牌，防误归组）。 */
const BRAND_SERIES_PREFIXES = ['克苏鲁', '宝可梦', '锅盖', '猫头鹰', '一次一章'] as const;

/**
 * 工位推导（按文本语义，顺序敏感）：
 * 大纲/拆书/概念（设定与命名）/平台检验/正文 —— 同工位内互斥，跨工位叠加。
 */
function deriveStation(asset: CraftInput): string {
  if (asset.primaryCategory === 'quality-guardrail') return 'guardrail';
  const text = `${asset.title}${asset.goal ?? ''}`;
  if (/大纲|章纲|细纲|卷纲/.test(text)) return 'outline';
  if (/拆书|仿写/.test(text)) return 'deconstruct';
  if (/世界观|人设|角色|配角|主角团|命名|书名|简介|灵感|脑洞|金手指|事件|标题/.test(text)) {
    return 'concept';
  }
  if (/过签|平台检查|完读率|评分卡/.test(text)) return 'platform-check';
  if (/润色|扩写|续写|正文|写作|直出/.test(text)) return 'prose';
  return `misc:${asset.primaryCategory ?? 'unknown'}`;
}

function deriveMode(asset: CraftInput): CraftMode {
  if (asset.primaryCategory === 'quality-guardrail' || asset.primaryCategory === 'platform-criteria') {
    return 'inspect';
  }
  if (POLISH_PATTERN.test(`${asset.title}${asset.goal ?? ''}`)) return 'polish';
  return 'generate';
}

export function getCraftSignature<T extends CraftInput>(asset: T): CraftSignature {
  const override = CRAFT_OVERRIDES[asset.id];
  return {
    mode: override?.mode ?? deriveMode(asset),
    station: override?.station ?? deriveStation(asset),
    seriesId: override?.seriesId ?? extractSeriesId(asset.title),
    seriesOrder: override?.seriesOrder ?? null,
  };
}

export interface SeriesDeck<T extends CraftInput = CraftInput> {
  seriesId: string;
  cards: Array<{ asset: T; order: number; signature: CraftSignature }>;
  stations: string[];
}

/** 套牌聚合：同 seriesId 的卡按传入顺序编号（1 起）。 */
export function getSeriesDecks<T extends CraftInput>(assets: readonly T[]): SeriesDeck<T>[] {
  const grouped = new Map<string, T[]>();
  for (const asset of assets) {
    const seriesId = getCraftSignature(asset).seriesId;
    if (!seriesId) continue;
    const bucket = grouped.get(seriesId) || [];
    bucket.push(asset);
    grouped.set(seriesId, bucket);
  }
  return [...grouped.entries()].map(([seriesId, cards]) => ({
    seriesId,
    cards: cards.map((asset, index) => ({
      asset,
      order: index + 1,
      signature: getCraftSignature(asset),
    })),
    stations: [...new Set(cards.map((asset) => getCraftSignature(asset).station))],
  }));
}

/**
 * Plan 229 同工位互斥检测：incoming 卡与已选集合中任一卡工位相同即冲突。
 * 返回冲突的已选卡列表（空 = 无冲突）。
 */
export function detectStationConflicts<T extends CraftInput>(
  selected: readonly T[],
  incoming: T
): T[] {
  const incomingStation = getCraftSignature(incoming).station;
  return selected.filter((asset) => getCraftSignature(asset).station === incomingStation);
}
