import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('continuation pack prompt enforces evidence and no drafting', () => {
  const promptModule = fs.readFileSync('shared/lib/continuation-pack-parse.ts', 'utf8');
  assert.match(promptModule, /不要续写正文/);
  assert.match(promptModule, /每条 hard canon 必须带 evidence/);
  assert.match(promptModule, /如果资料冲突，写入 contradictions/);
  assert.match(promptModule, /输出严格 JSON/);
});
