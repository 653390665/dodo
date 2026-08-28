export type CommercialMode = 'free' | 'paid' | 'strict' | string;

export type EntitlementEnv = Record<string, string | undefined>;
export type CapabilityLimitType = 'extractSkill' | 'generateProse' | 'advancedAudit';
export interface CapabilityUnavailableDetail {
  limitType?: CapabilityLimitType;
  count: number;
  max: number;
  error?: string;
  packageName?: string;
  packageDesc?: string;
  novelId?: string;
}
export type CapabilityUnavailableEventDetail = Omit<CapabilityUnavailableDetail, 'count' | 'max'> & {
  count?: number;
  max?: number;
};

export function isMonetizationEnabled(env: EntitlementEnv = import.meta.env): boolean {
  return env.VITE_INKFLOW_ENABLE_MONETIZATION === 'true';
}

/** Enhanced packages are beta-open until monetization is explicitly enabled. */
export function canUseEnhancedCapability({
  commercialMode,
  env = import.meta.env,
}: {
  commercialMode?: CommercialMode | null;
  env?: EntitlementEnv;
}): boolean {
  if (!isMonetizationEnabled(env)) return true;
  if (commercialMode === 'strict') return false;
  return commercialMode === 'paid';
}

/** Resolve the mode consumed by recommendation routing after platform entitlement rules apply. */
export function getEffectiveCommercialMode(
  commercialMode?: CommercialMode | null,
  env: EntitlementEnv = import.meta.env,
): 'free' | 'paid' | 'strict' {
  if (commercialMode === 'strict') return 'strict';
  if (canUseEnhancedCapability({ commercialMode, env })) return 'paid';
  return 'free';
}

export function filterLicensedAssetsByEntitlement<T extends { sourceType?: string }>(
  assets: T[],
  commercialMode?: CommercialMode | null,
  env: EntitlementEnv = import.meta.env,
): T[] {
  if (canUseEnhancedCapability({ commercialMode, env })) return assets;
  return assets.filter((asset) => asset.sourceType !== 'licensed');
}

export function normalizeCapabilityUnavailableDetail(input: unknown): CapabilityUnavailableDetail {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const limitType = value.limitType === 'extractSkill' || value.limitType === 'generateProse' || value.limitType === 'advancedAudit'
    ? value.limitType
    : undefined;
  const finiteNonNegative = (candidate: unknown, fallback: number) => typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 ? candidate : fallback;
  const stringOrUndefined = (candidate: unknown) => typeof candidate === 'string' ? candidate : undefined;
  return {
    limitType,
    count: finiteNonNegative(value.count, 0),
    max: finiteNonNegative(value.max, 5),
    error: stringOrUndefined(value.error),
    packageName: stringOrUndefined(value.packageName),
    packageDesc: stringOrUndefined(value.packageDesc),
    novelId: stringOrUndefined(value.novelId),
  };
}

export function dispatchCapabilityUnavailable(detail: CapabilityUnavailableEventDetail): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('local-capability-unavailable', { detail }));
  }
}
