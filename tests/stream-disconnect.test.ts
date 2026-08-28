import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { bindClientDisconnect } from '../server/helpers/stream-disconnect';
import { notify } from '../server/lib/db-instance';
import { startDbEventStream } from '../server/routes/db';

type MockRequest = EventEmitter & {
  aborted: boolean;
  socket: { setTimeout: (timeout: number) => void };
};

type MockResponse = EventEmitter & {
  writableEnded: boolean;
  closed: boolean;
  writes: string[];
  setHeader: () => void;
  flushHeaders: () => void;
  write: (chunk: string) => boolean;
};

function createStreamPair(): { req: MockRequest; res: MockResponse } {
  const req = Object.assign(new EventEmitter(), {
    aborted: false,
    socket: { setTimeout: (_timeout: number) => {} },
  });
  const res = Object.assign(new EventEmitter(), {
    writableEnded: false,
    closed: false,
    writes: [] as string[],
    setHeader() {},
    flushHeaders() {},
    write(chunk: string) {
      this.writes.push(chunk);
      return true;
    },
  });
  return { req, res };
}

test('bindClientDisconnect ignores normal request completion and handles abort once', () => {
  const { req, res } = createStreamPair();
  let disconnects = 0;
  const dispose = bindClientDisconnect(
    req as unknown as Request,
    res as unknown as Response,
    () => { disconnects += 1; },
  );

  req.emit('close');
  assert.equal(disconnects, 0, 'normal request-stream completion is not a disconnect');

  req.aborted = true;
  req.emit('aborted');
  req.emit('aborted');
  res.emit('close');
  assert.equal(disconnects, 1, 'all disconnect signals share one idempotent callback');

  dispose();
  assert.equal(req.listenerCount('aborted'), 0);
  assert.equal(res.listenerCount('close'), 0);
});

test('bindClientDisconnect dispose prevents later disconnect callbacks', () => {
  const { req, res } = createStreamPair();
  let disconnects = 0;
  const dispose = bindClientDisconnect(
    req as unknown as Request,
    res as unknown as Response,
    () => { disconnects += 1; },
  );

  req.emit('close');
  dispose();
  req.aborted = true;
  req.emit('aborted');
  res.closed = true;
  res.emit('close');

  assert.equal(disconnects, 0);
  assert.equal(req.listenerCount('aborted'), 0);
  assert.equal(res.listenerCount('close'), 0);
});

test('database events unsubscribe and stop heartbeat only after a real disconnect', async () => {
  const { req, res } = createStreamPair();
  const cleanup = startDbEventStream(
    req as unknown as Request,
    res as unknown as Response,
    5,
  );

  try {
    req.emit('close');
    notify();
    assert.ok(
      res.writes.some((chunk) => chunk.startsWith('data: ')),
      'normal request completion must not unsubscribe the live event stream',
    );

    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.ok(res.writes.some((chunk) => chunk === ':ping\n\n'));

    res.closed = true;
    res.emit('close');
    const writesAfterDisconnect = res.writes.length;

    notify();
    req.aborted = true;
    req.emit('aborted');
    await new Promise((resolve) => setTimeout(resolve, 15));

    assert.equal(
      res.writes.length,
      writesAfterDisconnect,
      'disconnect cleanup removes the database subscription and heartbeat exactly once',
    );
    assert.equal(req.listenerCount('aborted'), 0);
    assert.equal(res.listenerCount('close'), 0);
  } finally {
    cleanup();
  }
});

test('server routes must not listen to request close for stream disconnects', () => {
  const routesDir = path.join(process.cwd(), 'server', 'routes');
  const offenders = fs.readdirSync(routesDir)
    .filter((name) => name.endsWith('.ts'))
    .filter((name) => /req\.on\(['"]close['"]/.test(
      fs.readFileSync(path.join(routesDir, name), 'utf8'),
    ));

  assert.deepEqual(offenders, []);
});
