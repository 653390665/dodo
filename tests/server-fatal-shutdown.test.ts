import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('fatal backend errors stop accepting requests, drain writes, close DB, and exit non-zero', () => {
  const source = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

  assert.match(source, /fatalShutdownStarted[\s\S]*status\(503\)/);
  assert.match(source, /shutdownAfterFatalError[\s\S]*activeHttpServer\?\.close\(\)/);
  assert.match(source, /shutdownAfterFatalError[\s\S]*drainWriteQueue\(\)/);
  assert.match(source, /shutdownAfterFatalError[\s\S]*closeDb\(\)/);
  assert.match(source, /shutdownAfterFatalError[\s\S]*process\.exit\(1\)/);
  assert.match(source, /uncaughtException[\s\S]*shutdownAfterFatalError/);
  assert.match(source, /unhandledRejection[\s\S]*shutdownAfterFatalError/);
});
