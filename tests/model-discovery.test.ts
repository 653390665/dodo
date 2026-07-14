import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// ── normalizeModels (pure function, no mocking needed) ───────────────

const { normalizeModels } = await import('../server/helpers/model-discovery');

await test('normalizeModels trims and removes empty', () => {
  const result = normalizeModels([' gpt-4 ', '', '  claude-3  ']);
  assert.deepEqual(result, ['claude-3', 'gpt-4']);
});

await test('normalizeModels deduplicates', () => {
  const result = normalizeModels(['gpt-4', 'gpt-4', 'gpt-4o']);
  assert.deepEqual(result, ['gpt-4', 'gpt-4o']);
});

await test('normalizeModels sorts alphabetically', () => {
  const result = normalizeModels(['z-model', 'a-model', 'm-model']);
  assert.deepEqual(result, ['a-model', 'm-model', 'z-model']);
});

await test('normalizeModels drops non-strings', () => {
  const result = normalizeModels(['gpt-4', null, undefined, 123] as unknown as string[]);
  assert.deepEqual(result, ['gpt-4']);
});

await test('normalizeModels caps at 500', () => {
  const many = Array.from({ length: 600 }, (_, i) => `model-${i}`);
  assert.equal(normalizeModels(many).length, 500);
});

await test('normalizeModels rejects > 500 chars', () => {
  const long = 'a'.repeat(501);
  assert.deepEqual(normalizeModels(['gpt-4', long, 'claude']), ['claude', 'gpt-4']);
});

await test('normalizeModels empty input', () => {
  assert.deepEqual(normalizeModels([]), []);
});

// ── discoverModels (mocked HTTP server without /v1 prefix) ────────────

const { discoverModels } = await import('../server/helpers/model-discovery');
const { DEFAULT_PROMPT_TEMPLATES } = await import('../shared/config/prompt-templates');

function mockConfig(partial: { apiKey: string; baseUrl: string; model: string }) {
  return { ...partial, promptTemplates: DEFAULT_PROMPT_TEMPLATES };
}

let testServer: http.Server;
let serverUrl: string;

await test('setup discoverModels mock server', async () => {
  testServer = http.createServer((req, res) => {
    if (req.url === '/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [
          { id: 'gpt-4o' },
          { id: 'gpt-4-turbo' },
          { id: 'gpt-3.5-turbo' },
        ],
      }));
    } else if (req.url === '/401/models') {
      res.writeHead(401);
      res.end();
    } else if (req.url === '/bad-endpoint/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('not-json');
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => testServer.listen(0, () => resolve()));
  serverUrl = `http://localhost:${(testServer.address() as { port: number }).port}`;
});

await test('discoverOpenAIModels returns sorted model list', async () => {
  const result = await discoverModels(
    mockConfig({ apiKey: 'test-key', baseUrl: serverUrl, model: 'gpt-4o' }),
    new AbortController().signal,
  );
  assert.equal(result.discovery, 'available');
  assert.deepEqual(result.models, ['gpt-3.5-turbo', 'gpt-4-turbo', 'gpt-4o']);
});

await test('discoverOpenAIModels returns unsupported on 404', async () => {
  const result = await discoverModels(
    mockConfig({ apiKey: 'test-key', baseUrl: `${serverUrl}/nonexistent`, model: 'test' }),
    new AbortController().signal,
  );
  // joinUrl(serverUrl + '/nonexistent', '/models') -> serverUrl/nonexistent/models -> 404
  assert.equal(result.discovery, 'unsupported');
  assert.deepEqual(result.models, []);
});

await test('discoverOpenAIModels throws on 401/403', async () => {
  await assert.rejects(
    () => discoverModels(
      mockConfig({ apiKey: 'bad-key', baseUrl: `${serverUrl}/401`, model: 'test' }),
      new AbortController().signal,
    ),
    /401/,
  );
});

await test('discoverOpenAIModels handles malformed JSON gracefully', async () => {
  const result = await discoverModels(
    mockConfig({ apiKey: 'test-key', baseUrl: `${serverUrl}/malformed`, model: 'test' }),
    new AbortController().signal,
  );
  // joinUrl appends /models -> connects to joinUrl(serverUrl+/malformed, /models)
  // = serverUrl/malformed/models -> 404. We need to target the malformed endpoint directly.
  // Replace baseUrl with serverUrl + /malformed so /models becomes a 404.
  // Actually, malformed JSON response returns unsupported, tested via a special case.
  // Let me just verify that a bad fetch target returns unsupported gracefully.
  const badResult = await discoverModels(
    mockConfig({ apiKey: 'test-key', baseUrl: `${serverUrl}/bad-endpoint`, model: 'test' }),
    new AbortController().signal,
  );
  assert.equal(badResult.discovery, 'unsupported');
});

await test('discoverOpenAIModels handles AbortSignal gracefully', async () => {
  const controller = new AbortController();
  controller.abort();
  // AbortError is caught by the discovery function's catch block and returned as unsupported.
  const result = await discoverModels(
    mockConfig({ apiKey: 'test-key', baseUrl: serverUrl, model: 'test' }),
    controller.signal,
  );
  assert.equal(result.discovery, 'unsupported');
  assert.deepEqual(result.models, []);
});

await test('teardown discoverModels server', () => {
  testServer.close();
});

// ── Config route test-connection (mock server with /v1 prefix) ────────

await test('POST /api/config/test-connection integration', async () => {
  // Start a mock provider that handles both discovery AND generation
  const provider = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }, { id: 'another-model' }] }));
    } else if (req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: 'OK' } }],
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => provider.listen(0, () => resolve()));
  const providerUrl = `http://localhost:${(provider.address() as { port: number }).port}`;

  // Start the app with the config route
  const express = (await import('express')).default;
  const { registerConfigRoutes } = await import('../server/routes/config');
  const { getConfig } = await import('../server/lib/config');

  // Save original config state
  const cfg = getConfig();
  const origKey = cfg.apiKey;
  const origUrl = cfg.baseUrl;
  const origModel = cfg.model;

  const app = express();
  app.use(express.json());
  registerConfigRoutes(app);

  const appServer = app.listen(0);
  const apiUrl = `http://localhost:${(appServer.address() as { port: number }).port}`;

  try {
    // Test 1: model not in list returns selection prompt
    {
      const res = await fetch(`${apiUrl}/api/config/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'test-key',
          baseUrl: `${providerUrl}/v1`,
          model: 'non-existent',
        }),
      });
      assert.equal(res.status, 200);
      const d = await res.json();
      assert.equal(d.selectedModelValid, false);
      assert.equal(d.modelTested, false);
      assert.equal(d.modelDiscovery, 'available');
      assert.ok(d.models.includes('mock-model'));
      assert.match(d.message, /不在可用列表中/);
    }

    // Test 2: empty model returns prompt
    {
      const res = await fetch(`${apiUrl}/api/config/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'test-key',
          baseUrl: `${providerUrl}/v1`,
          model: '',
        }),
      });
      assert.equal(res.status, 200);
      const d = await res.json();
      assert.equal(d.selectedModelValid, false);
      assert.equal(d.modelTested, false);
    }

    // Test 3: valid model succeeds
    {
      const res = await fetch(`${apiUrl}/api/config/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'test-key',
          baseUrl: `${providerUrl}/v1`,
          model: 'mock-model',
        }),
      });
      const d = await res.json();
      assert.equal(d.selectedModelValid, true);
      assert.equal(d.modelTested, true);
      assert.equal(d.connectionOk, true);
      assert.equal(d.ok, true);
    }

    // Test 4: missing API Key returns 400
    {
      const res = await fetch(`${apiUrl}/api/config/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: '',
          baseUrl: `${providerUrl}/v1`,
          model: 'mock-model',
        }),
      });
      assert.equal(res.status, 400);
    }
  } finally {
    // Restore config
    cfg.apiKey = origKey;
    cfg.baseUrl = origUrl;
    cfg.model = origModel;
    appServer.close();
    provider.close();
  }
});
