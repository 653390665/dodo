import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Response } from 'express';
import type { Server } from 'node:http';
import {
  createRequestTimeoutMiddleware,
  DEFAULT_REQUEST_TIMEOUT_MS,
  LONG_REQUEST_TIMEOUT_ROUTES,
} from '../server/lib/request-timeout';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const servers: Server[] = [];

function listen(app: express.Express): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      servers.push(server);
      resolve(`http://127.0.0.1:${port}`);
    });
    server.on('error', reject);
  });
}

after(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('production allowlist targets the parse route with a 200s ceiling', () => {
  assert.equal(DEFAULT_REQUEST_TIMEOUT_MS, 120_000);
  assert.equal(LONG_REQUEST_TIMEOUT_ROUTES.get('POST /api/continuation-packs/parse'), 200_000);
});

test('slow route without allowlist entry returns 504 with a timed-out body', async () => {
  const app = express();
  app.use(createRequestTimeoutMiddleware(new Map(), 50));
  app.post('/api/test/slow', (_req, res) => {
    setTimeout(() => {
      // Mirrors the real hazard: the handler must not crash when the safety
      // net already answered 504 while work was still in flight.
      if (!res.headersSent) res.json({ ok: true });
    }, 150);
  });
  const baseUrl = await listen(app);

  const response = await fetch(`${baseUrl}/api/test/slow`, { method: 'POST' });
  assert.equal(response.status, 504);
  const body = await response.json() as { error?: string };
  assert.match(body.error ?? '', /timed out/);
  // Let the in-flight handler timer settle before the server closes.
  await sleep(200);
});

test('allowlisted route keeps its own ceiling; a sibling route still gets the default', async () => {
  const app = express();
  const routeTimeouts = new Map([['POST /api/test/slow', 1000]]);
  app.use(createRequestTimeoutMiddleware(routeTimeouts, 50));
  const slowHandler = (_req: express.Request, res: express.Response) => {
    setTimeout(() => {
      if (!res.headersSent) res.json({ ok: true });
    }, 150);
  };
  app.post('/api/test/slow', slowHandler);
  app.post('/api/test/other', slowHandler);
  const baseUrl = await listen(app);

  const allowlisted = await fetch(`${baseUrl}/api/test/slow`, { method: 'POST' });
  assert.equal(allowlisted.status, 200);
  assert.deepEqual(await allowlisted.json(), { ok: true });

  const notAllowlisted = await fetch(`${baseUrl}/api/test/other`, { method: 'POST' });
  assert.equal(notAllowlisted.status, 504);
  await sleep(200);
});

test('SSE route with immediate headers is protected from the 504 safety net', async () => {
  const app = express();
  app.use(createRequestTimeoutMiddleware(new Map(), 50));
  let hangRes: Response | undefined;
  app.get('/api/test/events', (_req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();
    res.write('data: hello\n\n');
    hangRes = res;
  });
  app.get('/api/test/ping', (_req, res) => {
    res.json({ ok: true });
  });
  const baseUrl = await listen(app);

  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/test/events`, { signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert.ok(reader);
  const first = await reader.read();
  assert.ok(!first.done);
  assert.equal(new TextDecoder().decode(first.value), 'data: hello\n\n');

  // Wait well past the 50ms default ceiling: the headersSent guard must keep
  // the stream open instead of answering (or crashing with) a 504.
  await sleep(250);
  assert.equal(response.status, 200);

  // The server process stays healthy after the protected SSE request.
  const ping = await fetch(`${baseUrl}/api/test/ping`);
  assert.equal(ping.status, 200);

  controller.abort();
  hangRes?.end();
  await sleep(50);
});
