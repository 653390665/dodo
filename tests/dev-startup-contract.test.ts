import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
  scripts?: Record<string, string>;
};

test('dev startup does not use tsx watch that follows external node_modules symlinks', () => {
  const command = packageJson.scripts?.dev ?? '';

  assert.match(command, /(?:^|\s)tsx\s+server\.ts(?:\s|$)/, 'dev must use the stable tsx server entrypoint');
  assert.doesNotMatch(command, /\btsx\s+watch\b/, 'dev must not start tsx watch over a symlinked node_modules tree');
  assert.doesNotMatch(command, /inkflow-task11-completion|node_modules[\\/]/, 'dev command must not target an external dependency tree');
});
