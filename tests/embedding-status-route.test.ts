import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import { registerConfigRoutes } from '../server/routes/config';
import { getConfig } from '../server/lib/config';

test('GET /api/config exposes embedding status without triggering inference', async () => {
  const config = getConfig();
  const originalKey = config.apiKey;
  config.apiKey = '';
  const app = express();
  registerConfigRoutes(app);
  const server = app.listen(0);
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/config`);
    assert.equal(response.status, 200);
    const body = await response.json() as { embeddingStatus?: { status?: string; metrics?: Record<string, number> } };
    assert.ok(body.embeddingStatus);
    assert.ok(['ready', 'initializing', 'fallback', 'unavailable'].includes(body.embeddingStatus.status || ''));
    assert.ok(body.embeddingStatus.metrics);
  } finally {
    server.close();
    config.apiKey = originalKey;
  }
});

test('POST /api/config/embedding/retry returns a sanitized status snapshot', async () => {
  const app = express();
  registerConfigRoutes(app);
  const server = app.listen(0);
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/config/embedding/retry`, { method: 'POST' });
    assert.ok([200, 503].includes(response.status));
    const body = await response.json() as { embeddingStatus?: { status?: string; reason?: string; metrics?: Record<string, number> } };
    assert.ok(body.embeddingStatus);
    assert.ok(['ready', 'unavailable'].includes(body.embeddingStatus.status || ''));
    assert.ok(body.embeddingStatus.metrics);
    assert.equal('apiKey' in body, false);
  } finally {
    server.close();
  }
});
