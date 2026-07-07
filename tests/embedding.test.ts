import assert from 'node:assert/strict';
import test from 'node:test';
import { cosineSimilarity, embed } from '../server/embedding';
import { DEFAULT_PROMPT_TEMPLATES } from '../shared/config/prompt-templates';
import { getConfig } from '../server/lib/config';

// Ensure standard mock configuration is populated for hermetic CI tests
const config = getConfig();
config.apiKey = config.apiKey || 'sk-mock-key-for-test-12345';
config.baseUrl = 'https://api.deepseek.com'; // Unconditionally force non-Google API to use fetch mock

test('cosineSimilarity calculates correct similarity', () => {
  const v1 = [1, 0, 0];
  const v2 = [1, 0, 0];
  const v3 = [0, 1, 0];
  const v4 = [-1, 0, 0];

  assert.equal(cosineSimilarity(v1, v2), 1);
  assert.equal(cosineSimilarity(v1, v3), 0);
  assert.equal(cosineSimilarity(v1, v4), -1);
});

test('embed calls generateEmbedding on fallback when WASM pipeline is not ready', async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = '';

  globalThis.fetch = async (url, init) => {
    calledUrl = String(url);
    return new Response(JSON.stringify({
      data: [{ embedding: [0.1, 0.2, 0.3] }]
    }));
  };

  try {
    const embedding = await embed('test text');
    assert.deepEqual(embedding, [0.1, 0.2, 0.3]);
    assert.match(calledUrl, /\/embeddings/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
