import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const readSource = (relativePath: string) => fs.readFileSync(path.resolve(relativePath), 'utf8');

test('application shortcuts use the guarded navigation entry point', () => {
  const appSource = readSource('src/App.tsx');
  const shellSource = readSource('src/components/AppShell.tsx');
  assert.doesNotMatch(appSource, /SHORTCUTS|matchesShortcut/);
  assert.match(shellSource, /void handleNavigate\(target\.view, target\.navKey\)/);
});

test('editor world navigation and Electron about version are wired to live sources', () => {
  const shellSource = readSource('src/components/AppShell.tsx');
  const electronSource = readSource('electron.cjs');
  assert.match(shellSource, /onNavigate=\{\(view\) => \{ void handleNavigate\(view\); \}\}/);
  assert.match(electronSource, /版本 \$\{app\.getVersion\(\)\}/);
  assert.doesNotMatch(electronSource, /版本 1\.0\.0/);
});
