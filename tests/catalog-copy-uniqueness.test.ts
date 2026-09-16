import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PUBLIC_SKILL_GOVERNANCE_CATALOG,
  SANITIZED_SKILL_COPIES,
  sanitizeWhiteLabelText,
} from '../shared/lib/public-skill-catalog.js';
import { COMMERCIAL_COPY_PATTERN } from '../shared/lib/prompt-sanitizer.js';

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

/**
 * Plan 233：目录准入守护——垃圾标题与中英混排文案不得入册。
 */
test('catalog rejects junk titles, cross-ASCII mixed copy, and duplicate submissions', () => {
  const junkPattern = /(^测试)|(^内测)|(^test)|(测试$)|(内测$)|(test$)/i;
  for (const pool of [PUBLIC_SKILL_GOVERNANCE_CATALOG, SANITIZED_SKILL_COPIES]) {
    const junk = pool.filter((asset) => junkPattern.test((asset.title || '').trim()));
    assert.deepEqual(junk, [], `垃圾标题不得入册：${junk.map((a) => a.id).join(', ')}`);

    // 中英混排定位语（「… and fallback profile。」类模板泄漏）
    const mixed = pool.filter((asset) => / and | fallback | fallback profile\./.test(asset.goal || ''));
    assert.deepEqual(mixed, [], `中英混排 goal：${mixed.map((a) => a.id).join(', ')}`);
  }

  // 消毒副本标准化标题（渲染 sanitizer 剥品牌后去空白/去结尾数字）不得重复——换皮重投只留一张
  const keys = new Map<string, number>();
  for (const copy of SANITIZED_SKILL_COPIES) {
    const key = sanitizeWhiteLabelText(copy.title || '')
      .replace(/\s+/g, '')
      .replace(/\d+$/, '');
    keys.set(key, (keys.get(key) || 0) + 1);
  }
  const dupKeys = [...keys.entries()].filter(([, count]) => count > 1);
  assert.deepEqual(dupKeys, [], `消毒副本标准化标题重复：${JSON.stringify(dupKeys)}`);
});

/**
 * Plan 234：消毒副本构建期改写守护——商业承诺词构建期清除，
 * 变体改写后不得再塌缩成同一句话墙（同句 goal ≤ 6 张）。
 */
test('sanitized copies are de-commercialized with distinct variant copy', () => {
  const withCommercial = SANITIZED_SKILL_COPIES.filter(
    (copy) =>
      COMMERCIAL_COPY_PATTERN.test(copy.goal || '') ||
      COMMERCIAL_COPY_PATTERN.test(copy.successSignal || '')
  );
  assert.deepEqual(
    withCommercial,
    [],
    `消毒副本仍含商业词：${withCommercial.map((c) => c.id).join(', ')}`
  );

  const goalCounts = new Map<string, number>();
  for (const copy of SANITIZED_SKILL_COPIES) {
    const goal = copy.goal || '';
    goalCounts.set(goal, (goalCounts.get(goal) || 0) + 1);
  }
  const overused = [...goalCounts.entries()].filter(([, count]) => count > 6);
  assert.deepEqual(
    overused,
    [],
    `同句 goal 超过 6 张：${JSON.stringify(overused)}`
  );
});
