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

  // Verify that better-sqlite3 is not included in the frontend config
  assert.doesNotMatch(viteConfigSource, /better-sqlite3/);
  // Ensure we are not optimizing database dependencies in the client.
  // optimizeDeps.entries 仅限定 dep-scan 入口文件（2026-09-20 用于排除 docs/archive
  // 历史 HTML 导致的预打包失败），不把依赖打进渲染层，故放行；
  // include/exclude 才是真正的优化键，维持禁止。
  assert.doesNotMatch(viteConfigSource, /optimizeDeps\s*:\s*\{[^}]*\b(include|exclude)\s*:/);
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
