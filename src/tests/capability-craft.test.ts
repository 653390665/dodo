import { describe, expect, test } from 'vitest';

import {
  CURATED_PRODUCT_SKILLS,
  PUBLIC_SKILL_GOVERNANCE_CATALOG,
} from '../../shared/lib/public-skill-catalog';
import { getOptionalStyleAssets } from '../lib/capability-governance';
import {
  detectStationConflicts,
  getCraftSignature,
  getSeriesDecks,
} from '../lib/capability-craft';

const byId = new Map(PUBLIC_SKILL_GOVERNANCE_CATALOG.map((a) => [a.id, a]));
const curatedById = new Map(CURATED_PRODUCT_SKILLS.map((a) => [a.id, a]));
const card = (id: string) => {
  const asset = byId.get(id) ?? curatedById.get(id);
  if (!asset) throw new Error(`missing fixture card: ${id}`);
  return asset;
};

describe('craft signature (plan 227)', () => {
  test('全目录签名完备：mode/station 非空', () => {
    for (const asset of PUBLIC_SKILL_GOVERNANCE_CATALOG) {
      const sig = getCraftSignature(asset);
      expect(sig.mode, `${asset.id} mode`).toBeTruthy();
      expect(sig.station, `${asset.id} station`).toBeTruthy();
    }
  });

  test('去AI味卡为护栏类（inspect/guardrail），语义即审校工序', () => {
    expect(getCraftSignature(card('de-ai-tells-guard')).mode).toBe('inspect');
    const guard = getCraftSignature(card('core-slop-shield'));
    expect(guard.mode).toBe('inspect');
    expect(guard.station).toBe('guardrail');
  });

  test('重构卡经覆盖表识别为 refine 模式（plan 228）', () => {
    const charSig = getCraftSignature(card('refine-character-rebuild'));
    expect(charSig.mode).toBe('refine');
    expect(charSig.station).toBe('concept');
    const outlineSig = getCraftSignature(card('refine-outline-rebuild'));
    expect(outlineSig.mode).toBe('refine');
    expect(outlineSig.station).toBe('outline');
  });

  test('克苏鲁品牌前缀识别为同一套牌且按顺序编号（数据源=文风货架）', () => {
    const decks = getSeriesDecks(getOptionalStyleAssets());
    const deck = decks.find((d) => d.seriesId === '克苏鲁');
    expect(deck, '克苏鲁套牌应存在').toBeTruthy();
    expect(deck!.cards.length).toBeGreaterThanOrEqual(3);
    expect(deck!.cards[0].order).toBe(1);
    expect(deck!.cards.map((c) => c.asset.title.startsWith('克苏鲁')).every(Boolean)).toBe(true);
  });

  test('同工位互斥：两套正文配方同为 prose 工位且冲突；去AI味属 guardrail 工位不冲突', () => {
    const proseA = card('square-10'); // 锅盖男频正文直出
    const proseB = card('square-174'); // 番茄长篇正文通用
    const deai = card('de-ai-tells-guard');
    expect(getCraftSignature(proseA).station).toBe('prose');
    expect(getCraftSignature(proseB).station).toBe('prose');
    expect(detectStationConflicts([proseA], proseB)).toHaveLength(1);
    expect(getCraftSignature(deai).station).toBe('guardrail');
  });
});
