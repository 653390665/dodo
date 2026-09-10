import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

type Layer = 'src' | 'server' | 'tests';

type Violation = { file: string; specifiers: string[] };

function listTsFiles(rootDirs: string[]): string[] {
  const files: string[] = [];
  for (const rootDir of rootDirs) {
    const absoluteRoot = path.join(process.cwd(), rootDir);
    if (!fs.existsSync(absoluteRoot)) continue;
    (function scan(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath);
        } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
          files.push(fullPath);
        }
      }
    })(absoluteRoot);
  }
  return files;
}

function importSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) specifiers.push(match[1]);
  return specifiers;
}

/** True when the specifier resolves into the layer directory (path-segment exact). */
function specifierTargetsLayer(specifier: string, layer: Layer): boolean {
  return specifier.split('/').includes(layer);
}

function findLayerImports(files: string[], layers: Layer[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const specifiers = importSpecifiers(fs.readFileSync(file, 'utf8'))
      .filter((specifier) => layers.some((layer) => specifierTargetsLayer(specifier, layer)));
    if (specifiers.length > 0) {
      violations.push({ file: path.relative(process.cwd(), file).split(path.sep).join('/'), specifiers });
    }
  }
  return violations;
}

function formatViolations(violations: Violation[]): string {
  return violations.map((violation) => `${violation.file}: ${JSON.stringify(violation.specifiers)}`).join('; ');
}

// Plan 189: four-direction layer boundary matrix. Dependencies may only point
// one way: shared -> (nothing), server -> shared, src -> shared. Frontend
// Vitest suites live under src/tests but still count as src/ for these rules.
test('server/** (and root server.ts, env-bootstrap.ts) must not import src/', () => {
  const violations = findLayerImports(
    listTsFiles(['server']).concat(
      ['server.ts', 'env-bootstrap.ts']
        .map((entry) => path.join(process.cwd(), entry))
        .filter((entry) => fs.existsSync(entry)),
    ),
    ['src'],
  );
  assert.deepEqual(
    violations,
    [],
    `server code must not depend on src/: ${formatViolations(violations)}`,
  );
});

// Known exception (audit finding, plan 189): this frontend test verifies the
// server-side critic classifier directly. Registered here so the matrix stays
// enforceable; do not add new entries without an explicit decision.
const SRC_IMPORTS_SERVER_EXCEPTIONS = new Set([
  'src/tests/p0-ai-trust.test.ts',
]);

test('src/** must not import server/', () => {
  const violations = findLayerImports(listTsFiles(['src']), ['server'])
    .filter((violation) => !SRC_IMPORTS_SERVER_EXCEPTIONS.has(violation.file));
  assert.deepEqual(
    violations,
    [],
    `src code must not depend on server/: ${formatViolations(violations)}`,
  );
});

test('shared/** must not import src/ or server/', () => {
  const violations = findLayerImports(listTsFiles(['shared']), ['src', 'server']);
  assert.deepEqual(
    violations,
    [],
    `shared code must stay layer-free: ${formatViolations(violations)}`,
  );
});

test('src/** and server/** must not import tests/', () => {
  const violations = findLayerImports(listTsFiles(['src', 'server']), ['tests']);
  assert.deepEqual(
    violations,
    [],
    `production code must not depend on tests/: ${formatViolations(violations)}`,
  );
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
