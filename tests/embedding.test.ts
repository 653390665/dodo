import assert from 'node:assert/strict';
import test from 'node:test';
import { cosineSimilarity, embed, getEmbeddingStatus } from '../server/embedding';
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
  assert.equal(cosineSimilarity([1, 0], [1]), 0);
  assert.equal(cosineSimilarity([1, Number.NaN], [1, 0]), 0);
});

test('embedding status exposes an honest initial state without triggering inference', () => {
  const status = getEmbeddingStatus();
  assert.equal(typeof status.status, 'string');
  assert.ok(['ready', 'initializing', 'fallback', 'unavailable'].includes(status.status));
  assert.ok('modelId' in status);
  assert.ok('provider' in status);
  assert.equal(typeof status.metrics.localInitializationFailures, 'number');
  if (status.status === 'unavailable') assert.equal(status.reason, 'not_initialized');
});

test('embed calls generateEmbedding on fallback when WASM pipeline is not ready', async () => {
  const originalFetch = globalThis.fetch;
  const originalModel = config.model;
  config.model = 'bge-m3';
  let calledUrl = '';
  let calledBody: { model?: string } = {};
  let markFetchStarted!: () => void;
  let resolveFetch!: (response: Response) => void;
  const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve; });
  const fetchResponse = new Promise<Response>((resolve) => { resolveFetch = resolve; });

  globalThis.fetch = async (url, init) => {
    calledUrl = String(url);
    calledBody = JSON.parse(String(init?.body || '{}')) as { model?: string };
    markFetchStarted();
    return fetchResponse;
  };

  try {
    const pendingEmbedding = embed('test text');
    await fetchStarted;
    const pendingStatus = getEmbeddingStatus();
    assert.equal(pendingStatus.status, 'unavailable');
    assert.equal(pendingStatus.reason, 'local_pipeline_unavailable');

    resolveFetch(new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] })));
    const embedding = await pendingEmbedding;
    assert.deepEqual(embedding, [0.1, 0.2, 0.3]);
    assert.match(calledUrl, /\/embeddings/);
    assert.equal(calledBody.model, 'bge-m3');
    const status = getEmbeddingStatus();
    assert.equal(status.modelId, 'openai-compatible:bge-m3');
    assert.equal(status.status, 'fallback');
    assert.ok(status.lastFallbackAt);
  } finally {
    globalThis.fetch = originalFetch;
    config.model = originalModel;
  }
});
