import { describe, expect, test } from 'vitest';

import { getOptionalStyleAssets } from '../lib/capability-governance';
import { CAPABILITY_SYMPTOMS, filterBySymptom } from '../lib/capability-symptoms';

const shelf = getOptionalStyleAssets();

describe('capability symptoms mapping', () => {
  test('五个固定症候，标签唯一', () => {
    expect(CAPABILITY_SYMPTOMS).toHaveLength(5);
    expect(new Set(CAPABILITY_SYMPTOMS.map((s) => s.key)).size).toBe(5);
  });

  test('每个症候在真实货架上的命中数在 [1, 30] 区间（226 STOP 门：0 或 >30 不得上线）', () => {
    for (const symptom of CAPABILITY_SYMPTOMS) {
      const hits = filterBySymptom(shelf, symptom.key);
      expect(hits.length, `${symptom.key} 命中 ${hits.length} 张`).toBeGreaterThanOrEqual(1);
      expect(hits.length, `${symptom.key} 命中 ${hits.length} 张`).toBeLessThanOrEqual(30);
    }
  });

  test('去 AI 味必须命中货架上的去AI味痕迹规则卡（95 分官方内置）', () => {
    const hits = filterBySymptom(shelf, 'de-ai');
    expect(hits.some((asset) => /去\s*AI\s*味/.test(asset.title))).toBe(true);
  });

  test('未知症候键返回空数组', () => {
    expect(filterBySymptom(shelf, 'nonexistent')).toEqual([]);
  });
});
