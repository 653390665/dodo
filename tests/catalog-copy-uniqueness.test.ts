import test from 'node:test';
import assert from 'node:assert/strict';

import { PUBLIC_SKILL_GOVERNANCE_CATALOG } from '../shared/lib/public-skill-catalog.js';

/**
 * Plan 231：目录文案治理守护。
 * 功能定位（goal）必须零占位、跨卡零重复——同一句话描述不了两张不同的卡。
 */
test('catalog goals contain no placeholder copy and are unique across cards', () => {
  const goals = PUBLIC_SKILL_GOVERNANCE_CATALOG.map((asset) => asset.goal || '');
  const placeholder = goals.filter((goal) => goal.includes('发挥广场精品提示词'));
  assert.deepEqual(placeholder, [], '占位文案必须清零');

  const duplicates = new Map<string, number>();
  for (const goal of goals) duplicates.set(goal, (duplicates.get(goal) || 0) + 1);
  const duplicated = [...duplicates.entries()].filter(([, count]) => count > 1);
  assert.deepEqual(
    duplicated,
    [],
    `跨卡重复的 goal：${JSON.stringify(duplicated.slice(0, 5))}`
  );
});
