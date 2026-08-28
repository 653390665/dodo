import type { ArtifactDiff } from '../types/creative-artifacts.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function copyValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copyValue) as T;
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyValue(item)])) as T;
  }
  return value;
}

function valuesEqual(before: unknown, after: unknown): boolean {
  if (Object.is(before, after)) return true;
  if (Array.isArray(before) && Array.isArray(after)) {
    return before.length === after.length && before.every((item, index) => valuesEqual(item, after[index]));
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const beforeKeys = Object.keys(before);
    const afterKeys = Object.keys(after);
    return beforeKeys.length === afterKeys.length
      && beforeKeys.every((key) => key in after && valuesEqual(before[key], after[key]));
  }
  return false;
}

export function buildArtifactDiff(base: unknown, proposed: unknown): ArtifactDiff {
  const fields: ArtifactDiff['fields'] = [];

  function visit(before: unknown, after: unknown, path: string): void {
    if (isPlainObject(before) && isPlainObject(after)) {
      const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
      for (const key of keys) {
        const childPath = path ? `${path}.${key}` : key;
        if (!(key in before)) {
          fields.push({ path: childPath, after: copyValue(after[key]), kind: 'added' });
        } else if (!(key in after)) {
          fields.push({ path: childPath, before: copyValue(before[key]), kind: 'removed' });
        } else {
          visit(before[key], after[key], childPath);
        }
      }
      return;
    }
    if (!valuesEqual(before, after)) {
      fields.push({ path, before: copyValue(before), after: copyValue(after), kind: 'changed' });
    }
  }

  visit(base, proposed, '');
  return { changed: fields.length > 0, fields };
}
