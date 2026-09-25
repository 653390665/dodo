/**
 * 卡片角色投影（规格 docs/specs/capability-flow-graph-consolidation.md §4.2）。
 *
 * 对外只暴露四个角色：rule / transform / diagnostic / guardrail。
 * 角色同时决定作用域、注入阶段与注入语义（本文件只做「旧 kind → 角色」的确定性投影，
 * 不改变任何运行时行为；新装配字段与注入语义在后续小类落地）。
 */
import {
  CAPABILITY_KINDS,
  LEGACY_CAPABILITY_KINDS,
  type CapabilityKind,
  type CapabilityManifestEntry,
} from '../types/capability-manifest.js';
import type { PromptCategoryV2 } from '../types/prompt-assets-governed.js';

export const CARD_ROLES = ['rule', 'transform', 'diagnostic', 'guardrail'] as const;
export type CardRole = (typeof CARD_ROLES)[number];

/** 链路层不是卡：flow 不参与卡角色投影。 */
export type CardRoleProjection = CardRole | null;

/**
 * 旧 kind → 卡角色。
 *
 * - guardrail → guardrail（自动常驻）
 * - diagnostic → diagnostic（单次运行出报告）
 * - utility → transform（单次运行出产物/预览）
 * - technique → 看输出语义：transform-preview 走 transform（chapter/single-run 一次性预览）；
 *   其余为 rule —— 含 output=outline-candidate/artifact-candidate 的 7 张 project 技法
 *   （bible-world-builder / refine-outline-rebuild / opening-gold-three 等），它们当前确实以
 *   「原文」常驻注入 project 阶段；批次 A 不改运行时行为，故保守投影为 rule，
 *   其真实产出语义留待批次 B 卡槽位落地后复审。
 * - skill-card / role-skill / overlay → rule
 * - flow → null（链路层）
 * - 未知 kind → null（不静默兜底，由覆盖度断言把新枚举显式登记）
 */
export function cardRoleForKind(
  kind: CapabilityKind,
  options?: { output?: CapabilityManifestEntry['output'] }
): CardRoleProjection {
  switch (kind) {
    case 'guardrail':
      return 'guardrail';
    case 'diagnostic':
      return 'diagnostic';
    case 'utility':
      return 'transform';
    case 'technique':
      return options?.output === 'transform-preview' ? 'transform' : 'rule';
    case 'skill-card':
    case 'role-skill':
    case 'overlay':
      return 'rule';
    case 'flow':
      return null;
    default:
      return null;
  }
}

export function cardRoleForManifest(entry: CapabilityManifestEntry): CardRoleProjection {
  return cardRoleForKind(entry.kind, { output: entry.output });
}

/**
 * 治理货架资产（无 kind 字段）→ 卡角色，按 primaryCategory 投影。
 * 未知分类返回 null，由覆盖度脚本断言「现有 174 张零未映射」而不是静默兜底。
 */
export function cardRoleForGovernedCategory(
  category: PromptCategoryV2 | string | undefined
): CardRoleProjection {
  switch (category) {
    case 'quality-guardrail':
      return 'guardrail';
    case 'platform-criteria':
      return 'diagnostic';
    case 'utility-tool':
      return 'transform';
    case 'author-workflow':
    case 'constellation-pack':
    case 'style-reference':
      return 'rule';
    default:
      return null;
  }
}

/**
 * 供审计/脚本使用：列出 kind 枚举（现行 + legacy 兼容层）到角色的全量投影。
 * flow 显式为 null；不遗漏 legacy，否则「读取兼容层」的覆盖度会虚高。
 */
export function listKindRoleProjections(): Array<{
  kind: CapabilityKind;
  role: CardRoleProjection;
}> {
  return [...CAPABILITY_KINDS, ...LEGACY_CAPABILITY_KINDS].map((kind) => ({
    kind,
    role: cardRoleForKind(kind),
  }));
}
