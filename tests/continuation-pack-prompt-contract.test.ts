import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('continuation pack prompt enforces evidence and no drafting', () => {
  const server = fs.readFileSync('server.ts', 'utf8');
  assert.match(server, /不要续写正文/);
  assert.match(server, /每条 hard canon 必须带 evidence/);
  assert.match(server, /如果资料冲突，写入 contradictions/);
  assert.match(server, /输出严格 JSON/);
});
