/**
 * 装配字段收敛（批次 A）：`projectCards` / `chapterCards` / `singleRunCard` 三字段的读写单一事实源，
 * 同时保留旧装配字段的「合并读取」与「幂等迁移」。见 docs/specs/capability-flow-graph-consolidation.md §4.2。
 *
 * 读取优先级（新字段权威，存在即生效，含显式空数组）：
 * - projectCards: profile.projectCards → 旧路径 projectSkillDeck（主卡 + 辅卡，去重）
 *   → mountedSkillLoadout（按 slot 升序）→ mountedSkillIds
 * - chapterCards: profile.chapterCards → 章节 capabilityState（techniqueIds + overlayCardIds，按原顺序）
 * - singleRunCard: profile.singleRunCard → 请求期 sessionCardIds 首项
 *
 * 迁移（migrateCapabilityAssembly）只补写 projectCards：chapterCards / singleRunCard 的旧来源分别是
 * 「章节态」与「请求期」数据，落进作品 profile 会擅自扩大作用域，故不迁移（不捏造）。迁移幂等：
 * projectCards 已存在、或旧装配字段为空时不写入（原样返回、changed=false，避免显式空数组盖住后续旧字段写入）；
 * 写入值按新字段语义归一化（去空白、去重），迁移后读取为归一后的固定点。
 */

import type { ProjectCapabilityProfile } from '../types/preferences.js';
import type { MountedSkillLoadoutItem } from '../types/skills.js';

type LoadoutSlot = Pick<MountedSkillLoadoutItem, 'slot' | 'skillId'>;

export interface ChapterCapabilityCardState {
  techniqueIds?: readonly string[];
  overlayCardIds?: readonly string[];
}

export interface CapabilityAssemblyInput {
  capabilityProfile?: ProjectCapabilityProfile | null;
  /** 已按旧规则算出的卡组 ID（调用方已持有 getProjectDeckIds 结果时传入；缺省时由 profile 现算）。 */
  projectDeckIds?: readonly string[] | null;
  mountedSkillLoadout?: readonly LoadoutSlot[] | null;
  mountedSkillIds?: readonly string[] | null;
  chapterCapabilityState?: ChapterCapabilityCardState | null;
  sessionCardIds?: readonly string[] | null;
}

export type ProjectCardsSource =
  | 'project-cards'
  | 'project-deck'
  | 'mounted-loadout'
  | 'mounted-skill-ids'
  | 'empty';

export type ChapterCardsSource = 'chapter-cards' | 'chapter-capability-state' | 'empty';

export type SingleRunCardSource = 'single-run-card' | 'session-cards' | 'none';

export interface CapabilityAssembly {
  projectCards: string[];
  chapterCards: string[];
  singleRunCard?: string;
  sources: {
    projectCards: ProjectCardsSource;
    chapterCards: ChapterCardsSource;
    singleRunCard: SingleRunCardSource;
  };
}

/** 规范化新字段：去空白、去空串、按首次出现去重（旧路径分支不做任何规范化，保持逐项一致）。 */
function normalizeCardIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

function normalizeOptionalCardId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim() || undefined;
}

/**
 * P0-①：装配三字段的运行时通道（作品级 projectCards 的 kind → 既有三通道映射）。
 * 未声明 projectCards 时三通道完全沿用旧路径（projectSkillDeck / projectTechniqueIds / guardrailIds），
 * 声明时只在对应通道里「增补」，不替换旧字段（避免卡组 UI 后续写入失效）。
 */
export type CapabilityAssemblyChannel = 'deck' | 'technique' | 'guardrail';

export function assemblyChannelForKind(kind: string | undefined): CapabilityAssemblyChannel | null {
  if (kind === 'technique') return 'technique';
  if (kind === 'guardrail') return 'guardrail';
  if (kind === 'skill-card' || kind === 'role-skill' || kind === 'overlay') return 'deck';
  return null;
}

/** 分流凭证：manifest kind 之外还看治理分类（货架 quality-guardrail 资产的 manifest kind 是 technique）。 */
export interface CapabilityAssemblyCardRef {
  kind?: string;
  primaryCategory?: string;
}

export function assemblyChannelForCard(
  card: CapabilityAssemblyCardRef | undefined
): CapabilityAssemblyChannel | null {
  if (!card) return null;
  if (card.primaryCategory === 'quality-guardrail') return 'guardrail';
  return assemblyChannelForKind(card.kind);
}

/** 按 kind/分类把 projectCards 分流为三通道 id（无 manifest 的 id 归卡组面，与旧 deck 的可解析语义一致）。 */
export function projectCardsByChannel(
  ids: readonly string[] | undefined | null,
  cardOf: (id: string) => CapabilityAssemblyCardRef | undefined
): Record<CapabilityAssemblyChannel, string[]> {
  const channelIds: Record<CapabilityAssemblyChannel, string[]> = {
    deck: [],
    technique: [],
    guardrail: [],
  };
  for (const id of normalizeCardIds(ids)) {
    const card = cardOf(id);
    const channel = card === undefined ? 'deck' : assemblyChannelForCard(card);
    if (!channel) continue;
    channelIds[channel].push(id);
  }
  return channelIds;
}

/** 卡组 ID：主卡 + 辅卡（去重、去空）。与 src/lib/skills-studio-governance.ts 的 getProjectDeckIds 同规则同源。 */
export function getProjectDeckCardIds(
  profile: ProjectCapabilityProfile | null | undefined
): string[] {
  if (!profile) return [];
  const ids = [profile.projectSkillDeck.mainCardId, ...profile.projectSkillDeck.supportCardIds];
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/**
 * 旧路径的 project 卡 ID（与 plan158 时期的 getProjectCapabilityCardIds 逐项一致）：
 * 卡组非空则卡组优先，否则按 slot 升序取挂载槽，最后回退 mountedSkillIds。
 * 本分支刻意不做去重/裁剪/trim，以免改变既有数据下的读取结果。
 */
export function readLegacyProjectCardIds(input: CapabilityAssemblyInput): {
  ids: string[];
  source: ProjectCardsSource;
} {
  const deckIds = input.projectDeckIds
    ? [...input.projectDeckIds]
    : getProjectDeckCardIds(input.capabilityProfile);
  if (deckIds.length > 0) return { ids: deckIds, source: 'project-deck' };
  if (input.mountedSkillLoadout) {
    return {
      ids: input.mountedSkillLoadout
        .slice()
        .sort((a, b) => a.slot - b.slot)
        .map((slot) => slot.skillId)
        .filter((skillId): skillId is string => Boolean(skillId)),
      source: 'mounted-loadout',
    };
  }
  if (input.mountedSkillIds) {
    return { ids: [...input.mountedSkillIds], source: 'mounted-skill-ids' };
  }
  return { ids: [], source: 'empty' };
}

export function resolveProjectCards(input: CapabilityAssemblyInput): {
  ids: string[];
  source: ProjectCardsSource;
} {
  const declared = input.capabilityProfile?.projectCards;
  if (declared !== undefined) return { ids: normalizeCardIds(declared), source: 'project-cards' };
  return readLegacyProjectCardIds(input);
}

export function resolveChapterCards(input: CapabilityAssemblyInput): {
  ids: string[];
  source: ChapterCardsSource;
} {
  const declared = input.capabilityProfile?.chapterCards;
  if (declared !== undefined) return { ids: normalizeCardIds(declared), source: 'chapter-cards' };
  const state = input.chapterCapabilityState;
  if (state) {
    return {
      ids: [...(state.techniqueIds ?? []), ...(state.overlayCardIds ?? [])],
      source: 'chapter-capability-state',
    };
  }
  return { ids: [], source: 'empty' };
}

export function resolveSingleRunCard(input: CapabilityAssemblyInput): {
  id?: string;
  source: SingleRunCardSource;
} {
  const declared = input.capabilityProfile?.singleRunCard;
  if (declared !== undefined) {
    return { id: normalizeOptionalCardId(declared), source: 'single-run-card' };
  }
  const sessionCardId = input.sessionCardIds?.[0];
  if (sessionCardId) return { id: sessionCardId, source: 'session-cards' };
  return { id: undefined, source: 'none' };
}

export function resolveCapabilityAssembly(input: CapabilityAssemblyInput): CapabilityAssembly {
  const projectCards = resolveProjectCards(input);
  const chapterCards = resolveChapterCards(input);
  const singleRunCard = resolveSingleRunCard(input);
  return {
    projectCards: projectCards.ids,
    chapterCards: chapterCards.ids,
    singleRunCard: singleRunCard.id,
    sources: {
      projectCards: projectCards.source,
      chapterCards: chapterCards.source,
      singleRunCard: singleRunCard.source,
    },
  };
}

/** 三字段是否已就位（projectCards 已声明即视为已迁移；chapter/singleRun 允许缺省）。 */
export function isCapabilityAssemblyMigrated(
  profile: ProjectCapabilityProfile | null | undefined
): boolean {
  return Boolean(profile && profile.projectCards !== undefined);
}

/**
 * 幂等迁移：仅当 projectCards 未声明、且旧装配字段（卡组 → 挂载槽 → mountedSkillIds）确有内容时，
 * 按新字段语义（去空白、去重）写入 projectCards。已声明或旧字段为空时原样返回（同一引用）、
 * changed=false——「无卡」保持未声明，避免用显式空数组永久盖住后续旧字段写入。
 * 不触碰其它字段，不捏造 chapterCards/singleRunCard（作用域不放大）。
 * 注：旧 mountedSkillIds 若含重复/带空白项，迁移会按新字段语义归一（卡数可能与旧读取路径差 1），
 * 迁移后读取为归一后的固定点。
 */
export function migrateCapabilityAssembly(
  profile: ProjectCapabilityProfile | null | undefined,
  legacy: Omit<CapabilityAssemblyInput, 'capabilityProfile'> = {}
): { profile: ProjectCapabilityProfile | null | undefined; changed: boolean } {
  if (!profile || profile.projectCards !== undefined) return { profile, changed: false };
  const { ids } = readLegacyProjectCardIds({ ...legacy, capabilityProfile: profile });
  const normalized = normalizeCardIds(ids);
  if (normalized.length === 0) return { profile, changed: false };
  return { profile: { ...profile, projectCards: normalized }, changed: true };
}
