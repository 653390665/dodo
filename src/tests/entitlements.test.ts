import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canUseEnhancedCapability, filterLicensedAssetsByEntitlement, getEffectiveCommercialMode, isMonetizationEnabled, normalizeCapabilityUnavailableDetail } from '../lib/entitlements';
import { recommendPromptAssets } from '../../shared/lib/prompt-recommender';

const source = (relativePath: string) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

describe('entitlements', () => {
  it('defaults to open beta when monetization is disabled', () => {
    expect(isMonetizationEnabled({ VITE_INKFLOW_ENABLE_MONETIZATION: 'false' })).toBe(false);
    expect(canUseEnhancedCapability({ commercialMode: 'free', env: { VITE_INKFLOW_ENABLE_MONETIZATION: 'false' } })).toBe(true);
    expect(canUseEnhancedCapability({ commercialMode: 'strict', env: { VITE_INKFLOW_ENABLE_MONETIZATION: 'false' } })).toBe(true);
    expect(canUseEnhancedCapability({ commercialMode: 'strict', env: {} })).toBe(true);
  });

  it('requires paid mode when monetization is enabled', () => {
    const env = { VITE_INKFLOW_ENABLE_MONETIZATION: 'true' };
    expect(canUseEnhancedCapability({ commercialMode: 'free', env })).toBe(false);
    expect(canUseEnhancedCapability({ commercialMode: 'paid', env })).toBe(true);
    expect(canUseEnhancedCapability({ commercialMode: 'strict', env })).toBe(false);
  });

  it('maps the effective recommendation mode from monetization and real entitlement state', () => {
    const enabled = { VITE_INKFLOW_ENABLE_MONETIZATION: 'true' };
    expect(getEffectiveCommercialMode('paid', enabled)).toBe('paid');
    expect(getEffectiveCommercialMode('free', enabled)).toBe('free');
    expect(getEffectiveCommercialMode('strict', enabled)).toBe('strict');
    expect(getEffectiveCommercialMode('unknown', enabled)).toBe('free');

    const beta = { VITE_INKFLOW_ENABLE_MONETIZATION: 'false' };
    for (const mode of ['free', 'paid', 'unknown']) {
      expect(getEffectiveCommercialMode(mode, beta)).toBe('paid');
    }
    expect(getEffectiveCommercialMode('strict', beta)).toBe('strict');
  });

  it('keeps the licensed Fenghua polish asset open in beta only', () => {
    const input = { activeSeriesId: 'fenghua-short-flow' as const, currentStage: 'polish' as const };
    const betaFree = recommendPromptAssets({ ...input, commercialMode: getEffectiveCommercialMode('free', { VITE_INKFLOW_ENABLE_MONETIZATION: 'false' }) });
    const commercialFree = recommendPromptAssets({ ...input, commercialMode: getEffectiveCommercialMode('free', { VITE_INKFLOW_ENABLE_MONETIZATION: 'true' }) });
    expect(betaFree.some((asset) => asset.id === 'private-163')).toBe(true);
    expect(commercialFree.some((asset) => asset.id === 'private-163')).toBe(false);
  });

  it('filters licensed recommendations by the real entitlement axis', () => {
    const input = { activeSeriesId: 'fenghua-short-flow' as const, currentStage: 'polish' as const };
    const betaEnv = { VITE_INKFLOW_ENABLE_MONETIZATION: 'false' };
    const commercialEnv = { VITE_INKFLOW_ENABLE_MONETIZATION: 'true' };
    const recommend = (mode: string, env: Record<string, string>) => filterLicensedAssetsByEntitlement(
      recommendPromptAssets({ ...input, commercialMode: getEffectiveCommercialMode(mode, env) }),
      mode,
      env,
    );

    expect(recommend('free', betaEnv).some((asset) => asset.id === 'private-163')).toBe(true);
    expect(recommend('strict', betaEnv).some((asset) => asset.id === 'private-163')).toBe(true);
    expect(recommend('paid', commercialEnv).some((asset) => asset.id === 'private-163')).toBe(true);
    expect(recommend('free', commercialEnv).some((asset) => asset.id === 'private-163')).toBe(false);
    expect(recommend('strict', commercialEnv).some((asset) => asset.id === 'private-163')).toBe(false);
  });

  it('preserves strict governance routing in beta for generic flows', () => {
    const beta = { VITE_INKFLOW_ENABLE_MONETIZATION: 'false' };
    const effective = getEffectiveCommercialMode('strict', beta);
    expect(effective).toBe('strict');
    const input = { activeSeriesId: 'generic-novel-flow' as const, currentStage: 'polish' as const };
    expect(recommendPromptAssets({ ...input, commercialMode: effective })).toEqual(
      recommendPromptAssets({ ...input, commercialMode: 'strict' }),
    );
  });

  it('normalizes capability event payloads at the boundary', () => {
    expect(normalizeCapabilityUnavailableDetail({ limitType: 'advancedAudit', count: 2, max: 4, error: 'x', packageName: 'p' })).toEqual({
      limitType: 'advancedAudit', count: 2, max: 4, error: 'x', packageName: 'p', packageDesc: undefined, novelId: undefined,
    });
    expect(normalizeCapabilityUnavailableDetail({ limitType: 'bad', count: Number.NaN, max: -1, error: 42 })).toEqual({
      limitType: undefined, count: 0, max: 5, error: undefined, packageName: undefined, packageDesc: undefined, novelId: undefined,
    });
  });

  it('keeps user-facing entitlement copy neutral', () => {
    const files = [
      '../components/book-factory/PlanningTab.tsx',
      '../components/book-factory/QualityTab.tsx',
      '../components/SkillsStudioView.tsx',
      '../components/commercial/PremiumUpgradeModal.tsx',
      '../components/SettingsModal.tsx',
    ].map(source).join('\n');
    for (const forbidden of ['立即升级', '升舱', '无限次', 'VIP', '永久会员', '超级权限', '免费受限版', 'Premium 专属']) {
      expect(files).not.toContain(forbidden);
    }
    expect(files).not.toMatch(/>\s*PREMIUM\s*</i);
    expect(source('../components/book-factory/QualityTab.tsx')).toContain('filterLicensedAssetsByEntitlement');
    expect(source('../components/book-factory/QualityTab.tsx')).toContain('if (isRestricted)');
    const modal = source('../components/commercial/PremiumUpgradeModal.tsx');
    expect(modal).toContain('当前版本未开放在线购买');
    expect(modal).toContain('基础写作和 BYOK 主链仍可继续');
    expect(source('../components/SettingsModal.tsx')).toContain('Beta 默认开放，无需访问码');
    expect(source('../components/SettingsModal.tsx')).not.toMatch(/activateGlobalPremium|deactivateGlobalPremium|立即激活/);
  });

  it('removes local premium licensing dead code from the app store', () => {
    const appStore = source('../stores/app-store.ts');
    for (const forbidden of [
      'isGlobalPremium',
      'activateGlobalPremium',
      'deactivateGlobalPremium',
      'computeTamperProofSignature',
      'DODO-DODO',
      'inkflow-global-premium',
      'inkflow-premium-signature',
      'inkflow-premium-code',
    ]) {
      expect(appStore).not.toContain(forbidden);
    }
  });
});
