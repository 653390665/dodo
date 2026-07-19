import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('server files should not import from src/ directory to prevent cross-layer dependency', () => {
  const serverDir = path.join(process.cwd(), 'server');

  function scan(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        const content = fs.readFileSync(fullPath, 'utf8');

        // Match import lines referencing src/ or ../src
        const matches = content.match(/(import|from)\s+['\"].*src\/.*['\"]/g) || [];

        assert.equal(
          matches.length,
          0,
          `File ${path.relative(process.cwd(), fullPath)} contains invalid cross-layer import to src/ directory: ${JSON.stringify(matches)}`
        );
      }
    }
  }

  scan(serverDir);
});
