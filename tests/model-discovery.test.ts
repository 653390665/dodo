import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

// Directly import the pure function from the server helper
const { normalizeModels } = await import('../server/helpers/model-discovery');

describe('normalizeModels', () => {
  test('trims whitespace and removes empty strings', () => {
    const result = normalizeModels([' gpt-4 ', '', '  claude-3  ']);
    assert.deepEqual(result, ['claude-3', 'gpt-4']);
  });

  test('deduplicates models', () => {
    const result = normalizeModels(['gpt-4', 'gpt-4', 'gpt-4o']);
    assert.deepEqual(result, ['gpt-4', 'gpt-4o']);
  });

  test('sorts alphabetically', () => {
    const result = normalizeModels(['z-model', 'a-model', 'm-model']);
    assert.deepEqual(result, ['a-model', 'm-model', 'z-model']);
  });

  test('drops non-string entries', () => {
    const result = normalizeModels(['gpt-4', null, undefined, 123] as unknown as string[]);
    assert.deepEqual(result, ['gpt-4']);
  });

  test('caps at MAX_MODELS and limits item length', () => {
    // Generate 600 items — should be capped to 500
    const many = Array.from({ length: 600 }, (_, i) => `model-${String(i).padStart(3, '0')}`);
    const result = normalizeModels(many);
    assert.equal(result.length, 500);
    // The first sorted entry should still be there
    assert.ok(result[0] === 'model-000');
    assert.ok(result[499] === 'model-499');
  });

  test('rejects items exceeding max length (500 chars)', () => {
    const long = 'a'.repeat(501);
    const result = normalizeModels(['gpt-4', long, 'claude']);
    assert.deepEqual(result, ['claude', 'gpt-4']);
  });

  test('returns empty array for empty input', () => {
    assert.deepEqual(normalizeModels([]), []);
  });
});
