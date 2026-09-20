import { describe, expect, test } from 'vitest';

import { isOfficialSupplyAsset } from '../lib/capability-governance';
import { getCatalogCapabilityManifest } from '../../shared/lib/capability-manifest-catalog';
import { CURATED_PRODUCT_SKILLS } from '../../shared/lib/public-skill-catalog';

// Plan 257：四张白标卡（prose-mouth-flavor / audit-logical-sanity /
// deconstruct-golden-climax / deconstruct-suspense-hook）asset 与 manifest
// 双层转 built-in 后，官方供给分区应按 title 收录四张新内置卡；指定不转的
// de-ai-rhythm-restorer 与 style-ancient-elegance 留在社区分区。

const NEW_BUILTIN_CARDS = [
  { id: 'prose-mouth-flavor', title: '超强口语化推进剧情正文器' },
  { id: 'audit-logical-sanity', title: '段落情节逻辑检测分析器' },
  { id: 'deconstruct-golden-climax', title: '神作黄金高爽节奏与钩子拆书卡' },
  { id: 'deconstruct-suspense-hook', title: '神作高潮段落悬念精细拆解卡' },
] as const;

const STAY_COMMUNITY_IDS = ['de-ai-rhythm-restorer', 'style-ancient-elegance'] as const;

describe('plan257 官方供给分区', () => {
  test('官方分区按 title 含四张新内置卡（asset 层）', () => {
    const official = CURATED_PRODUCT_SKILLS.filter((asset) => isOfficialSupplyAsset(asset));
    const officialTitles = new Set(official.map((asset) => asset.title));
    for (const card of NEW_BUILTIN_CARDS) {
      expect(officialTitles.has(card.title)).toBe(true);
    }
    // 官方分区数量随翻转 7 → 11，无卡片丢失。
    expect(official.length).toBe(11);
    expect(official.length + CURATED_PRODUCT_SKILLS.filter((a) => !isOfficialSupplyAsset(a)).length).toBe(
      CURATED_PRODUCT_SKILLS.length
    );
  });

  test('四张卡 asset 与 manifest 双层 built-in；不转卡双层维持 plaza', () => {
    for (const card of NEW_BUILTIN_CARDS) {
      const asset = CURATED_PRODUCT_SKILLS.find((entry) => entry.id === card.id);
      expect(asset?.sourceType).toBe('built-in');
      expect(getCatalogCapabilityManifest(card.id)?.sourceType).toBe('built-in');
    }
    for (const id of STAY_COMMUNITY_IDS) {
      const asset = CURATED_PRODUCT_SKILLS.find((entry) => entry.id === id);
      expect(asset?.sourceType).toBe('plaza');
      expect(getCatalogCapabilityManifest(id)?.sourceType).toBe('plaza');
    }
  });
});
