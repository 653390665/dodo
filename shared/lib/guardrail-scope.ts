/**
 * 护栏配置语义的唯一事实源（Plan 262 B1）。
 *
 * 背景（2026-09-28 审计）：`guardrailIds` 里配 core-default 护栏是「假控制」——
 * 运行时早已无条件注入全部 core-default 护栏（`buildGuardrails`），再配置同一条
 * 只会被去重，Δ 恒为 0，且界面上看不出原因（增强护栏计数会把它算进去）。
 *
 * 本模块把护栏分成三类并给出可解释文案，供服务端过滤与界面回执共用：
 * - default-on：core-default + 质量护栏 + 运行时就绪 → 系统无条件注入，配置无净增；
 * - 引用壳：能通过校验，但注入阶段被壳卡过滤丢弃 → 同样无净增；
 * - selectable：非 core-default 的运行时就绪质量护栏 → 可配置、有净增；
 * - 其余（未就绪 / 非质量护栏 / 不存在的 id）→ 不可用，配置被忽略。
 */
import { isRuntimeReadyAsset, type RuntimeReadinessFields } from './capability-runtime-readiness.js';
import { isShellTemplatePrompt } from './prompt-shell.js';

/** 判定所需的最小字段面（源目录与公开目录投影都满足）。 */
export interface GuardrailScopeAsset extends RuntimeReadinessFields {
  readonly id: string;
  readonly title?: string | null;
  readonly primaryCategory?: string | null;
  readonly placementTier?: string | null;
  readonly sourceGroup?: string | null;
  readonly template?: string | null;
  /** 壳目录投影派生标记：template 被清空后由它承载壳判定（见 public-catalog-pipeline）。 */
  readonly isShellBody?: boolean;
}

export const GUARDRAIL_DEFAULT_ON_LABEL = '已自动生效';
export const GUARDRAIL_REDUNDANT_NOTE = '默认已生效：系统无条件注入，配置不产生净增';
export const GUARDRAIL_BUILTIN_PLACEHOLDER_NOTE = '默认护栏占位 id：系统无条件生效，无需配置';
export const GUARDRAIL_UNUSABLE_NOTE = '不可用：非运行时就绪的质量护栏，配置已被忽略';
export const GUARDRAIL_SHELL_NOTE =
  '引用壳：内容为不足 80 字的转投指令，注入时会被丢弃，配置不产生净增';

/** 引用壳护栏：能通过校验、但注入阶段会被丢弃（buildGuardrails 的壳卡过滤），故无净增。 */
export function isShellGuardrail(asset: GuardrailScopeAsset | null | undefined): boolean {
  if (!asset || !isSelectableGuardrail(asset)) return false;
  // 公开壳目录的 template 恒为空串，故优先读生成期固化的派生标记；
  // 源目录（template 完整）仍走模板判定，两侧结论一致。
  if (typeof asset.isShellBody === 'boolean') return asset.isShellBody;
  return isShellTemplatePrompt(asset.template ?? '');
}

export interface GuardrailSelectionEntry {
  readonly id: string;
  readonly title: string;
  readonly note: string;
}

export interface GuardrailSelectionAudit {
  /** 真正生效的增强护栏 id（按声明顺序去重）。 */
  readonly selectable: string[];
  /** 声明了但没有净增的 id（core-default / 默认护栏占位）。 */
  readonly redundant: GuardrailSelectionEntry[];
  /** 声明了但不可用的 id（未就绪 / 非质量护栏 / 不存在）。 */
  readonly unusable: GuardrailSelectionEntry[];
}

/** 运行时就绪的质量护栏（服务端校验/注入判据；core-default 也算，故配置它只是无净增）。 */
export function isReadyQualityGuardrail(
  asset: GuardrailScopeAsset | null | undefined
): boolean {
  return Boolean(asset && asset.primaryCategory === 'quality-guardrail' && isRuntimeReadyAsset(asset));
}

/** core-default 的质量护栏：运行时无条件注入，配置不产生净增。 */
export function isDefaultOnGuardrail(
  asset: GuardrailScopeAsset | null | undefined
): boolean {
  return Boolean(asset && asset.placementTier === 'core-default' && isReadyQualityGuardrail(asset));
}

/** 可配置的增强护栏：非 core-default 的运行时就绪质量护栏（测试夹具不入产品面）。 */
export function isSelectableGuardrail(
  asset: GuardrailScopeAsset | null | undefined
): boolean {
  return Boolean(
    asset &&
      isReadyQualityGuardrail(asset) &&
      asset.placementTier !== 'core-default' &&
      asset.sourceGroup !== 'test-fixture'
  );
}

/** 按声明顺序审计 `guardrailIds` 的净增情况（去空、去重，不改写原数组）。 */
export function auditGuardrailSelection(
  ids: readonly (string | null | undefined)[] | null | undefined,
  catalog: readonly GuardrailScopeAsset[]
): GuardrailSelectionAudit {
  const byId = new Map(catalog.map((asset) => [asset.id, asset]));
  const selectable: string[] = [];
  const redundant: GuardrailSelectionEntry[] = [];
  const unusable: GuardrailSelectionEntry[] = [];
  const seen = new Set<string>();

  for (const raw of ids ?? []) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const asset = byId.get(id);
    const title = asset?.title ?? id;

    if (id === 'default-guardrail') {
      redundant.push({ id, title, note: GUARDRAIL_BUILTIN_PLACEHOLDER_NOTE });
    } else if (asset && isDefaultOnGuardrail(asset)) {
      redundant.push({ id, title, note: GUARDRAIL_REDUNDANT_NOTE });
    } else if (isShellGuardrail(asset)) {
      redundant.push({ id, title, note: GUARDRAIL_SHELL_NOTE });
    } else if (asset && isSelectableGuardrail(asset)) {
      selectable.push(id);
    } else {
      unusable.push({ id, title, note: GUARDRAIL_UNUSABLE_NOTE });
    }
  }

  return { selectable, redundant, unusable };
}
