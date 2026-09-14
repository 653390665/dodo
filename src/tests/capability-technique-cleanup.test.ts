import { describe, expect, test } from 'vitest';

import {
  extractUnresolvedTechniqueIds,
  stripUnresolvedTechniqueRefs,
} from '../lib/capability-technique-cleanup';

describe('extractUnresolvedTechniqueIds', () => {
  test('从服务端 warnings 中提取全部失效技法 id', () => {
    expect(
      extractUnresolvedTechniqueIds([
        'TECHNIQUE_UNRESOLVED:square-183',
        'TECHNIQUE_KIND_INVALID:style-ancient-elegance',
        'TECHNIQUE_NOT_RUNTIME_READY:square-9',
        'CAPABILITY_FLOW_UNAVAILABLE',
        'TECHNIQUE_UNRESOLVED:',
      ])
    ).toEqual(['square-183', 'style-ancient-elegance', 'square-9']);
  });

  test('无相关 warnings 时返回空数组', () => {
    expect(extractUnresolvedTechniqueIds([])).toEqual([]);
    expect(extractUnresolvedTechniqueIds(['CAPABILITY_MEMBERSHIP_MISMATCH:x'])).toEqual([]);
  });
});

describe('stripUnresolvedTechniqueRefs', () => {
  test('摘除失效 id 本身及其 membership 关联的落库引用', () => {
    const draft = {
      favoriteTechniqueIds: ['persisted-style-card', 'square-183', 'good-technique'],
      projectTechniqueIds: ['persisted-style-card'],
      capabilityMemberships: [
        { persistedSkillId: 'persisted-style-card', sourceId: 'style-ancient-elegance' },
        { persistedSkillId: 'persisted-good-card', sourceId: 'good-technique' },
      ],
    };
    const cleaned = stripUnresolvedTechniqueRefs(draft, ['square-183', 'style-ancient-elegance']);
    expect(cleaned.favoriteTechniqueIds).toEqual(['good-technique']);
    expect(cleaned.projectTechniqueIds).toEqual([]);
    expect(cleaned.capabilityMemberships).toEqual([
      { persistedSkillId: 'persisted-good-card', sourceId: 'good-technique' },
    ]);
  });

  test('无失效 id 时原样返回', () => {
    const draft = { favoriteTechniqueIds: ['good-technique'] };
    expect(stripUnresolvedTechniqueRefs(draft, [])).toBe(draft);
  });
});
