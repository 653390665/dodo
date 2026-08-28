import test from 'node:test';
import assert from 'node:assert/strict';
import { continuityToReviewIssues, stableIssueId, structuredAuditToReviewIssues } from '../shared/lib/review-issues.js';
import type { StructuredAudit } from '../shared/lib/audit-structured.js';

test('review issue ids are stable and structured issues preserve actionable fields', () => {
  const audit: StructuredAudit = {
    score: 40,
    fatalIssues: [{ issueType: 'syntax', issueSubtype: 'general', severity: 'major', snippet: '句子', explanation: '问题', patchHint: '修改' }],
    sceneChecks: [],
    surgerySuggestions: [],
    evidence: [{ category: 'foreshadowing', severity: 'high', quote: '门外一声响', explanation: '伏笔没有回收', suggestedFix: '补充回收动作', location: '末段' }],
  };
  const issues = structuredAuditToReviewIssues(audit);
  assert.equal(issues[0]?.id, stableIssueId(issues[0]!));
  assert.equal(issues[0]?.status, 'open');
  assert.equal(issues[0]?.suggestedFix, '修改');
  assert.equal(issues[1]?.category, 'foreshadowing');
  assert.equal(issues[1]?.severity, 'major');
  assert.equal(issues[1]?.location, '末段');
});

test('continuity issues are converted to the shared review contract', () => {
  const issues = continuityToReviewIssues({ issues: [{ category: 'logic', severity: 'high', message: '矛盾', evidence: '证据', suggestedFix: '修复' }], proposedPatch: { characterUpdates: [], itemUpdates: [], foreshadowingUpdates: [], timelineEventsToCreate: [], foreshadowingsToCreate: [] } });
  assert.equal(issues[0]?.source, 'production-audit');
  assert.equal(issues[0]?.category, 'logic');
  assert.equal(issues[0]?.suggestedFix, '修复');
  assert.equal(issues[0]?.status, 'open');
});

test('structured evidence enriches matching fatal issue without duplicating it', () => {
  const issues = structuredAuditToReviewIssues({
    score: 40,
    fatalIssues: [{ issueType: 'hook-ending', issueSubtype: 'generic-ending', severity: 'major', snippet: '门外一声响', explanation: '伏笔没有回收', patchHint: '补充回收动作' }],
    sceneChecks: [],
    surgerySuggestions: [],
    evidence: [{ category: 'foreshadowing', severity: 'high', quote: '门外一声响', explanation: '伏笔没有回收', suggestedFix: '补充回收动作', location: '末段' }],
  });

  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.location, '末段');
});
