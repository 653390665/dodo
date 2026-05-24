import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createJsonLineChunkParser,
  getDevSpawnCommand,
  getServerRestartDelay,
  getWatchdogRetryDelay,
} = require('../electron-startup-utils.cjs') as {
  createJsonLineChunkParser: (onMessage: (message: unknown) => void, onLine?: (line: string) => void) => (chunk: string | Buffer) => void;
  getDevSpawnCommand: (platform: string) => string;
  getServerRestartDelay: (attemptCount: number) => number;
  getWatchdogRetryDelay: (attemptCount: number) => number;
};

test('packaged Electron starts bundled server in Node mode', () => {
  const mainProcessSource = fs.readFileSync('electron.cjs', 'utf8');

  assert.match(mainProcessSource, /process\.execPath/);
  assert.match(mainProcessSource, /ELECTRON_RUN_AS_NODE:\s*'1'/);
});

test('packaged Electron passes packaged static dist path to server', () => {
  const mainProcessSource = fs.readFileSync('electron.cjs', 'utf8');
  const serverSource = fs.readFileSync('server.ts', 'utf8');

  assert.match(mainProcessSource, /INKFLOW_STATIC_DIR:\s*staticDir/);
  assert.match(mainProcessSource, /process\.resourcesPath,\s*'app\.asar',\s*'dist'/);
  assert.match(serverSource, /process\.env\.INKFLOW_STATIC_DIR\s*\|\|\s*path\.join\(process\.cwd\(\),\s*'dist'\)/);
});

test('startup parser resolves JSON messages across split stdout chunks', () => {
  const seenLines: string[] = [];
  const seenMessages: Array<{ port?: number; status?: string }> = [];
  const parseChunk = createJsonLineChunkParser(
    (message) => {
      seenMessages.push(message as { port?: number; status?: string });
    },
    (line) => {
      seenLines.push(line);
    },
  );

  parseChunk('{"sta');
  parseChunk('tus":"booting"}\n{"port":30');
  parseChunk('00}\n');

  assert.deepEqual(seenLines, ['{"status":"booting"}', '{"port":3000}']);
  assert.deepEqual(seenMessages, [{ status: 'booting' }, { port: 3000 }]);
});

test('startup parser ignores incomplete and non-JSON lines without dropping later JSON', () => {
  const seenMessages: Array<{ port?: number }> = [];
  const parseChunk = createJsonLineChunkParser((message) => {
    seenMessages.push(message as { port?: number });
  });

  parseChunk('not-json\n{"port":3');
  parseChunk('001}\n');

  assert.deepEqual(seenMessages, [{ port: 3001 }]);
});

test('dev spawn command switches to npx.cmd on Windows', () => {
  assert.equal(getDevSpawnCommand('win32'), 'npx.cmd');
  assert.equal(getDevSpawnCommand('darwin'), 'npx');
  assert.equal(getDevSpawnCommand('linux'), 'npx');
});

test('restart delays use bounded backoff instead of immediate retries', () => {
  assert.equal(getServerRestartDelay(0), 3000);
  assert.equal(getServerRestartDelay(2), 6000);
  assert.equal(getServerRestartDelay(10), 15000);

  assert.equal(getWatchdogRetryDelay(1), 5000);
  assert.equal(getWatchdogRetryDelay(3), 15000);
  assert.equal(getWatchdogRetryDelay(10), 30000);
});
