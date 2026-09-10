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
        const matches = content.match(/(import|from)\s+['"].*src\/.*['"]/g) || [];

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

// Plan 188: REST/network transport must go through src/lib clients (`./http`,
// `./config-client`, ...). Bare `fetch(` in components is only tolerated in
// whitelisted files with streaming / file-transfer semantics that the unified
// JSON request helper cannot express:
//   - WorldBibleView.tsx: /api/generate-bio streams the body (streamCharacterBio).
//   - IdeaFragmentBoard.tsx: /api/expand-fragment streams (streamIdeaFragment).
//   - EditorStatusBar.tsx: /api/export binary download.
//   - SettingsModal.tsx: multipart import-file upload; embedding retry,
//     prompt-template-test and test-connection LLM probes.
//   - WorldBibleAssistant.tsx / SkillsStudioView.tsx / SkillTestBench.tsx /
//     useBookFactory.ts: legacy direct calls pending their own client extraction.
const COMPONENT_FETCH_WHITELIST = new Set([
  'src/components/WorldBibleView.tsx',
  'src/components/IdeaFragmentBoard.tsx',
  'src/components/EditorStatusBar.tsx',
  'src/components/SettingsModal.tsx',
  'src/components/WorldBibleAssistant.tsx',
  'src/components/SkillsStudioView.tsx',
  'src/components/skills/SkillTestBench.tsx',
  'src/components/book-factory/useBookFactory.ts',
]);

test('components must not add new bare fetch() calls outside the whitelist (plan 188)', () => {
  const componentsDir = path.join(process.cwd(), 'src', 'components');
  const offenders: string[] = [];

  function scan(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        const relPath = path.relative(process.cwd(), fullPath).split(path.sep).join('/');
        const content = fs.readFileSync(fullPath, 'utf8');
        if (COMPONENT_FETCH_WHITELIST.has(relPath)) continue;
        if (/(?<![\w.$])fetch\s*\(/.test(content)) offenders.push(relPath);
      }
    }
  }

  scan(componentsDir);
  assert.deepEqual(
    offenders,
    [],
    `Components must import a src/lib client (e.g. './http' request) instead of calling fetch directly: ${offenders.join(', ')}`,
  );
});
