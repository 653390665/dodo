import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

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
