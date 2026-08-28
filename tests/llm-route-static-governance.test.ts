import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('high-cost LLM routes are wired through the execution gate', () => {
  const root = process.cwd();
  const expectations: Array<[string, string[]]> = [
    ['server/routes/world.ts', ['generate-bio', 'generate-outline', 'extract-entities', 'detect-foreshadowing', 'analyze-pacing', 'generate-entity-details', 'update-character-state']],
    ['server/routes/simple-llm.ts', ['expand-fragment']],
    ['server/routes/agents.ts', ['inspiration', 'editor-agent']],
    ['server/routes/continuation.ts', ['parse-continuation-pack']],
    ['server/routes/prompt-test.ts', ['prompt-template-test']],
  ];

  for (const [filename, operations] of expectations) {
    const source = fs.readFileSync(path.join(root, filename), 'utf8');
    assert.match(source, /createLlmExecution/);
    for (const operation of operations) {
      assert.ok(source.includes(operation), `${filename} must declare ${operation}`);
    }
  }

  const modelCallFiles = [
    ...fs.readdirSync(path.join(root, 'server/routes')).filter((name) => name.endsWith('.ts')).map((name) => `server/routes/${name}`),
    'server/helpers/ai-production-pipeline.ts',
  ];
  for (const filename of modelCallFiles) {
    const source = fs.readFileSync(path.join(root, filename), 'utf8');
    assert.doesNotMatch(
      source,
      /import\s*\{\s*generateText\s*\}\s*from\s*['"]\.\.\/lib\/server-llm['"]/,
      `${filename} must not import the raw provider entry point`,
    );
    if (source.includes('generateText(')) {
      assert.match(
        source,
        /governedGenerateText as generateText/,
        `${filename} model calls must use the governed entry point`,
      );
    }
  }
});

test('nested governed provider calls do not consume the outer workflow rate bucket', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'server/helpers/governed-llm.ts'), 'utf8');
  assert.match(source, /enforceRateLimit:\s*false/);
});

test('world utility routes consume the frozen execution stage contract', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'server/routes/world.ts'), 'utf8');
  assert.match(source, /function withExecutionStagePrompt/);
  assert.ok((source.match(/withExecutionStagePrompt\(/g) || []).length >= 7);
  assert.match(source, /stagePrompts\[stage\]/);
});
