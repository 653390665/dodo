import { describe, expect, test } from 'vitest';
import { getCapabilityDisplayText, getMountedRoleSlotState, canEquipSavedSkill } from '../lib/skills-studio-governance';

describe('SkillsStudio current capability state', () => {
  test('keeps legacy slot projection readable without exposing it in the center', () => {
    expect(getMountedRoleSlotState([{ slot: 1, skillId: 'writer-1', weight: 1, lockedDimensions: [] }], [{ id: 'writer-1', name: '正文推进器' }]).writer).toBe('正文推进器');
  });

  test('does not allow saved-skill equipment without a manifest slot', () => {
    expect(canEquipSavedSkill({ id: 'unknown' })).toBe(false);
    expect(canEquipSavedSkill({ id: 'opening-gold-three', parentSkillId: 'opening-gold-three' })).toBe(false);
  });

  test('removes purchase and membership promises from card copy', () => {
    expect(getCapabilityDisplayText('购买会员后无限调用，帮助你完成正文。', 'plaza')).toBe('广场共享能力，具体效果以实际运行结果为准。');
    expect(getCapabilityDisplayText('帮助你检查节奏。', 'built-in')).toBe('帮助你检查节奏。');
  });
});
