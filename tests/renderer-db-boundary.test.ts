import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const rendererRoots = [
  path.join(projectRoot, 'src', 'components'),
  path.join(projectRoot, 'src', 'hooks'),
];

function walkFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

test('vite renderer config does not externalize better-sqlite3', () => {
  const viteConfigSource = fs.readFileSync(path.join(projectRoot, 'vite.config.ts'), 'utf8');

  assert.doesNotMatch(viteConfigSource, /better-sqlite3/);
  assert.doesNotMatch(viteConfigSource, /optimizeDeps\s*:/);
  assert.doesNotMatch(viteConfigSource, /rollupOptions\s*:/);
});

test('renderer source does not import db runtime modules directly', () => {
  const rendererFiles = rendererRoots.flatMap((root) => walkFiles(root));
  const forbiddenPatterns = [
    /from\s+['"].*\/lib\/db['"]/,
    /from\s+['"].*\/better-sqlite3-shim\.cjs['"]/,
    /from\s+['"]better-sqlite3['"]/,
    /require\(['"]better-sqlite3['"]\)/,
  ];

  const violations: string[] = [];

  for (const file of rendererFiles) {
    const source = fs.readFileSync(file, 'utf8');
    if (forbiddenPatterns.some((pattern) => pattern.test(source))) {
      violations.push(path.relative(projectRoot, file));
    }
  }

  assert.deepEqual(violations, []);
});
