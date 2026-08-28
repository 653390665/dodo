import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('audit unknown contract redacts raw feedback without persistence', () => {
  const route = fs.readFileSync('server/routes/audit.ts', 'utf8');
  assert.match(route, /status: 'unknown'/);
  assert.doesNotMatch(route, /status: 'unknown', rawFeedback/);
  assert.match(route, /errorCategory:/);
  assert.match(route, /retriable: true/);
  const hook = fs.readFileSync('src/lib/hooks/generation/useAuditPolishActions.ts', 'utf8');
  assert.match(hook, /setAuditUnknownFeedback\(`审稿结果未确认/);
  assert.doesNotMatch(hook, /jobResult\.rawFeedback/);
  const unknownBlock = hook.slice(hook.indexOf("error.name === 'AuditUnknownError'"), hook.indexOf("void recordProductEvent({", hook.indexOf("error.name === 'AuditUnknownError'") + 1));
  assert.doesNotMatch(unknownBlock, /updateChapter\(/);
});

test('audit appends the shared JSON contract and disables thinking', () => {
  const route = fs.readFileSync('server/routes/audit.ts', 'utf8');
  assert.match(route, /evidenceContract \+ AUDIT_OUTPUT_CONTRACT/);
  assert.match(route, /disableThinking: true/);
});
