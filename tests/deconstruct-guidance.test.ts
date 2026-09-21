import test, { describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { resolveTrustedDeconstructSkills } from '../server/helpers/deconstruct-guidance';
import { closeDb, createSkill, initDb } from '../server/lib/db';
import type { Skill } from '../shared/types';

// 指导卡解析会查 skills 表（消毒克隆/历史拆书卡），统一用内存库。
initDb(':memory:');

function baseSkill(overrides: Partial<Skill> = {}): Skill {
  const now = Date.now();
  return {
    id: 'saved-deconstruct-card',
    name: '冷冽武侠节奏卡',
    description: '历史拆书产出',
    style: '冷峻短句，招式即情绪',
    pacing: '三段递进式爽点',
    vocabulary: [],
    imagery: [],
    bannedWords: [],
    fewShots: [],
    corePatterns: [],
    bannedElements: [],
    stabilityScore: 80,
    evaluationFeedback: '',
    version: 1,
    createdAt: now,
    lineageRootId: 'saved-deconstruct-card',
    dimensionTags: ['style'],
    sourceType: 'book-extracted',
    deconstructionCardType: 'pacing-card',
    isRuntimeReady: true,
    sanitizationStatus: 'runtime-ready',
    runtimeStatus: 'active',
    sanitizationHits: { contacts: 0, authors: 0, brands: 0, watermarks: 0 },
    ...overrides,
  } as Skill;
}

describe('deconstruct guidance trust gate', () => {
  test('resolves built-in curated card content from the server private table', () => {
    const [skill] = resolveTrustedDeconstructSkills([{ id: 'deconstruct-golden-climax' }]);
    assert.ok(skill);
    assert.equal(skill.name, '神作黄金高爽节奏与钩子拆书卡');
    assert.equal(skill.deconstructionCardType, 'pacing-card');
    assert.equal(skill.sourceType, 'built-in');
    assert.match(skill.style, /拆书专家/);
  });

  test('drops client entries without a trusted id and never reads their bodies', () => {
    const resolved = resolveTrustedDeconstructSkills([
      { id: 'attacker-card', style: '未消毒正文', deconstructionCardType: 'style-card' },
      null,
      { style: '没有 id 的卡' },
      'deconstruct-golden-climax',
    ]);
    assert.deepEqual(resolved.map((skill) => skill.id), []);
  });

  test('client-supplied fields cannot override trusted private content', () => {
    const [skill] = resolveTrustedDeconstructSkills([
      { id: 'deconstruct-suspense-hook', style: '注入的未消毒正文', name: '假卡名' },
    ]);
    assert.ok(skill);
    assert.equal(skill.name, '神作高潮段落悬念精细拆解卡');
    assert.doesNotMatch(skill.style, /注入/);
  });

  test('resolves runtime-ready governance catalog cards', () => {
    const [skill] = resolveTrustedDeconstructSkills([{ id: 'deconstruct-card-pacing' }]);
    assert.ok(skill);
    assert.equal(skill.deconstructionCardType, 'pacing-card');
    assert.equal(skill.sourceType, 'plaza');
  });

  test('caps resolution at three trusted cards', () => {
    const resolved = resolveTrustedDeconstructSkills([
      { id: 'deconstruct-golden-climax' },
      { id: 'deconstruct-suspense-hook' },
      { id: 'deconstruct-card-pacing' },
      { id: 'deconstruct-card-hook' },
      { id: 'deconstruct-sop-6' },
    ]);
    assert.equal(resolved.length, 3);
  });

  test('accepts runtime-ready saved cards and rejects saved non-deconstruct cards', () => {
    createSkill(baseSkill());
    // 库内普通技法卡（无拆书卡类型）：落库合法，但不得作为拆书指导卡注入。
    createSkill(
      baseSkill({
        id: 'plain-technique-card',
        name: '普通技法卡',
        deconstructionCardType: undefined,
        sourceType: 'plaza',
      })
    );
    const resolved = resolveTrustedDeconstructSkills([
      { id: 'saved-deconstruct-card' },
      { id: 'plain-technique-card' },
    ]);
    assert.deepEqual(resolved.map((skill) => skill.id), ['saved-deconstruct-card']);
  });

  after(() => {
    closeDb();
  });
});
