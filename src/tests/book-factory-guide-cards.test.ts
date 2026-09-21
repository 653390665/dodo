import { describe, expect, it } from 'vitest';
import {
  MAX_DECONSTRUCT_GUIDE_CARDS,
  toggleDeconstructGuideCard,
} from '../components/book-factory/useBookFactory';
import { getFactoryDeconstructCardOptions } from '../lib/capability-governance';

describe('book factory deconstruct guide cards', () => {
  it('lists built-in curated cards and runtime-ready catalog cards without duplicates', () => {
    const options = getFactoryDeconstructCardOptions();
    const ids = options.map((option) => option.id);
    expect(ids).toContain('deconstruct-golden-climax');
    expect(ids).toContain('deconstruct-suspense-hook');
    expect(ids).toContain('deconstruct-card-pacing');
    expect(ids).toContain('deconstruct-card-hook');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('toggles guide card selection and caps it at the schema limit', () => {
    let current: string[] = [];
    current = toggleDeconstructGuideCard(current, 'a');
    current = toggleDeconstructGuideCard(current, 'b');
    current = toggleDeconstructGuideCard(current, 'c');
    expect(current).toEqual(['a', 'b', 'c']);
    // 达到上限后再选第 4 张无效
    expect(toggleDeconstructGuideCard(current, 'd')).toEqual(['a', 'b', 'c']);
    // 再点一次已选卡则取消
    expect(toggleDeconstructGuideCard(current, 'a')).toEqual(['b', 'c']);
    expect(MAX_DECONSTRUCT_GUIDE_CARDS).toBe(3);
  });
});
