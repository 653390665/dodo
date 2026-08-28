import { describe, expect, it } from 'vitest';
import { countChineseCharacters, MIN_BOOK_FACTORY_TEXT_CHARS } from '../components/book-factory/useBookFactory';

describe('book factory input validation', () => {
  it('counts effective Chinese characters and requires the server minimum', () => {
    expect(countChineseCharacters('雨夜，刀客走进酒馆。')).toBe(8);
    expect(countChineseCharacters('a1 !')).toBe(0);
    expect(MIN_BOOK_FACTORY_TEXT_CHARS).toBe(50);
  });
});
