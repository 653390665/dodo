// Polyfill node:test for vitest — 3 legacy test files use node:test syntax
import { it, describe, expect } from 'vitest';

// Make test and assert available globally so node:test imports resolve
(globalThis as any).test = it;
(globalThis as any).describe = describe;
(globalThis as any).assert = {
  equal: (a: any, b: any) => expect(a).toBe(b),
  strictEqual: (a: any, b: any) => expect(a).toBe(b),
  deepStrictEqual: (a: any, b: any) => expect(a).toEqual(b),
  deepEqual: (a: any, b: any) => expect(a).toEqual(b),
  ok: (v: any) => expect(v).toBeTruthy(),
  throws: (fn: () => void) => expect(fn).toThrow(),
  rejects: async (fn: () => Promise<any>, pattern?: RegExp) => {
    if (pattern) await expect(fn).rejects.toThrow(pattern);
    else await expect(fn).rejects.toThrow();
  },
};
