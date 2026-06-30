import type { Skill, SkillDimension } from '../../shared/types';

export type SkillRoleKey =
  | 'lead-style'
  | 'character-drive'
  | 'world-rule'
  | 'power-beat'
  | 'plot-advance'
  | 'pace-control';

const ROLE_KEY_BY_DIMENSION: Record<SkillDimension, SkillRoleKey> = {
  style: 'lead-style',
  character: 'character-drive',
  world: 'world-rule',
  power: 'power-beat',
  plot: 'plot-advance',
  pacing: 'pace-control',
};

const ROLE_LABELS: Record<SkillDimension, string> = {
  style: '主笔文风',
  character: '人物驱动',
  world: '世界约束',
  power: '体系爆点',
  plot: '剧情推进',
  pacing: '节奏调速',
};

const ROLE_LONG_LABELS: Record<SkillDimension, string> = {
  style: '主笔文风卡',
  character: '人物驱动卡',
  world: '世界约束卡',
  power: '体系爆点卡',
  plot: '剧情推进卡',
  pacing: '节奏调速卡',
};

const ROLE_LABELS_BY_KEY: Record<SkillRoleKey, string> = {
  'lead-style': '主笔文风',
  'character-drive': '人物驱动',
  'world-rule': '世界约束',
  'power-beat': '体系爆点',
  'plot-advance': '剧情推进',
  'pace-control': '节奏调速',
};

const ROLE_WEIGHT_KEYS: Record<SkillDimension, keyof NonNullable<Skill['compositionProfile']>> = {
  style: 'styleWeight',
  character: 'characterWeight',
  world: 'worldWeight',
  power: 'powerWeight',
  plot: 'plotWeight',
  pacing: 'pacingWeight',
};

const RESPONSIBILITY_COVERAGE_THRESHOLD = 0.72;

export function normalizeRoleKey(input?: SkillDimension | SkillRoleKey | string): SkillRoleKey | undefined {
  if (!input) return undefined;
  if (input in ROLE_LABELS_BY_KEY) return input as SkillRoleKey;
  if (input in ROLE_KEY_BY_DIMENSION) return ROLE_KEY_BY_DIMENSION[input as SkillDimension];
  return undefined;
}

export function getSkillRoleLabel(dimension?: SkillDimension | string): string {
  if (!dimension) return '综合策略';
  const normalized = normalizeRoleKey(dimension);
  if (normalized) return ROLE_LABELS_BY_KEY[normalized];
  return ROLE_LABELS[dimension as SkillDimension] || String(dimension);
}

export function getSkillRoleLongLabel(dimension?: SkillDimension | string): string {
  if (!dimension) return '综合策略卡';
  return ROLE_LONG_LABELS[dimension as SkillDimension] || `${dimension}卡`;
}

export function getSkillRoleTags(tags?: Array<SkillDimension | string>): string[] {
  return Array.from(new Set((tags || []).map((tag) => getSkillRoleLabel(tag))));
}

export function collectSkillRoleKeys(skill: Partial<Skill>): SkillRoleKey[] {
  const roles = new Set<SkillRoleKey>();

  const addRole = (input?: SkillDimension | SkillRoleKey | string) => {
    const normalized = normalizeRoleKey(input);
    if (normalized) roles.add(normalized);
  };

  addRole(skill.primaryDimension);
  for (const tag of skill.dimensionTags || []) {
    addRole(tag);
  }

  const profile = skill.compositionProfile;
  if (profile) {
    (Object.keys(ROLE_WEIGHT_KEYS) as SkillDimension[]).forEach((dimension) => {
      const weightKey = ROLE_WEIGHT_KEYS[dimension];
      if ((profile[weightKey] as number) >= RESPONSIBILITY_COVERAGE_THRESHOLD) {
        addRole(dimension);
      }
    });
  }

  return Array.from(roles);
}
