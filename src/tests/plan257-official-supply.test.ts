import { describe, expect, test } from 'vitest';

import { isOfficialSupplyAsset } from '../lib/capability-governance';
import { getCatalogCapabilityManifest } from '../../shared/lib/capability-manifest-catalog';
import { CURATED_PRODUCT_SKILLS } from '../../shared/lib/public-skill-catalog';

// Plan 257 + Plan 259：白标卡 asset 与 manifest 双层转 built-in 后，官方供给分区
// 应按 title 收录七张新内置卡。Plan 257：prose-mouth-flavor / audit-logical-sanity /
// deconstruct-golden-climax / deconstruct-suspense-hook；Plan 259（功能类单卡转内置，
// 题材/平台类留付费）：bible-world-builder / opening-novelty-hook /
// de-ai-rhythm-restorer。题材（古言/克苏鲁）与平台（番茄/海外）双层维持非 built-in。

const NEW_BUILTIN_CARDS = [
  { id: 'prose-mouth-flavor', title: '超强口语化推进剧情正文器' },
  { id: 'audit-logical-sanity', title: '段落情节逻辑检测分析器' },
  { id: 'deconstruct-golden-climax', title: '神作黄金高爽节奏与钩子拆书卡' },
  { id: 'deconstruct-suspense-hook', title: '神作高潮段落悬念精细拆解卡' },
  { id: 'bible-world-builder', title: '长篇超宏大世界观设定器' },
  { id: 'opening-novelty-hook', title: '网文黄金前三章爽点质检仪' },
  { id: 'de-ai-rhythm-restorer', title: '文字灵性语流节奏重建增强包' },
] as const;

// 古言（plaza）/克苏鲁（licensed）/番茄（licensed）/海外（licensed）留付费侧。
const STAY_COMMUNITY_IDS = [
  'style-ancient-elegance',
  'style-cthulhu-mystique',
  'platform-tomato-scoring',
  'platform-webnovel-criteria',
] as const;

describe('plan257/259 官方供给分区', () => {
  test('官方分区按 title 含七张新内置卡（asset 层）', () => {
    const official = CURATED_PRODUCT_SKILLS.filter((asset) => isOfficialSupplyAsset(asset));
    const officialTitles = new Set(official.map((asset) => asset.title));
    for (const card of NEW_BUILTIN_CARDS) {
      expect(officialTitles.has(card.title)).toBe(true);
    }
    // 官方分区数量随 Plan 257（7→11）与 Plan 259（11→14）两次翻转递增，无卡片丢失。
    expect(official.length).toBe(14);
    expect(official.length + CURATED_PRODUCT_SKILLS.filter((a) => !isOfficialSupplyAsset(a)).length).toBe(
      CURATED_PRODUCT_SKILLS.length
    );
  });

  test('七张卡 asset 与 manifest 双层 built-in；题材/平台卡双层维持非 built-in', () => {
    for (const card of NEW_BUILTIN_CARDS) {
      const asset = CURATED_PRODUCT_SKILLS.find((entry) => entry.id === card.id);
      expect(asset?.sourceType).toBe('built-in');
      expect(getCatalogCapabilityManifest(card.id)?.sourceType).toBe('built-in');
    }
    for (const id of STAY_COMMUNITY_IDS) {
      const asset = CURATED_PRODUCT_SKILLS.find((entry) => entry.id === id);
      expect(asset?.sourceType).not.toBe('built-in');
      expect(getCatalogCapabilityManifest(id)?.sourceType).not.toBe('built-in');
    }
  });
});
