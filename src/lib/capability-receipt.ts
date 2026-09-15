import {
  CURATED_PRODUCT_SKILLS,
  PUBLIC_SKILL_GOVERNANCE_CATALOG,
  SANITIZED_SKILL_COPIES,
  SKILL_SERIES_FLOWS,
} from '../../shared/lib/public-skill-catalog';

export interface CapabilityReceiptEntry {
  id: string;
  title: string;
  /** false = 目录里已找不到该 id（如提示词模板键或已移除卡），原样展示 id。 */
  resolved: boolean;
}

/**
 * Plan 224 回执出口：把生产 run 执行回执里的 capabilityRefs 解析为可读标题。
 * 回执 refs 混合了货架卡、护栏/治理条目、消毒副本与创作流程，
 * 按此顺序解析；提示词模板键等非目录 id 原样展示。
 */
export function buildCapabilityReceipt(
  refs: readonly string[] | undefined
): CapabilityReceiptEntry[] {
  if (!refs || refs.length === 0) return [];
  return refs.map((id) => {
    const card = CURATED_PRODUCT_SKILLS.find((entry) => entry.id === id);
    if (card) return { id, title: card.title, resolved: true };
    const flow = SKILL_SERIES_FLOWS.find((entry) => entry.id === id);
    if (flow) return { id, title: flow.name, resolved: true };
    const governed = PUBLIC_SKILL_GOVERNANCE_CATALOG.find((entry) => entry.id === id);
    if (governed) return { id, title: governed.title, resolved: true };
    const copy = SANITIZED_SKILL_COPIES.find((entry) => entry.id === id);
    if (copy) return { id, title: copy.title, resolved: true };
    return { id, title: id, resolved: false };
  });
}
