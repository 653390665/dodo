import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closeDb,
  createChapter,
  createChapterProductionRun,
  createCharacter,
  createNovel,
  getChapter,
  initDb,
  listChapterCompletionAttempts,
  listChapterVersions,
  updateChapter,
} from '../server/lib/db.js';
import { getDatabaseGeneration } from '../server/lib/db-instance.js';
import { completeChapter, acceptChapterRisk } from '../server/helpers/chapter-completion.js';
import { deriveChapterCompletionGate } from '../shared/lib/chapter-completion.js';

function setup(): number {
  closeDb();
  initDb(':memory:');
  createNovel({ id: 'n1', title: '测试作品', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  createChapter({ id: 'c1', novelId: 'n1', title: '第一章', content: '已接受正文', sceneBeats: '冲突出现', order: 1, wordCount: 5, createdAt: 1, updatedAt: 1 });
  return getDatabaseGeneration();
}

function input(databaseGeneration: number) { return { novelId: 'n1', chapterId: 'c1', databaseGeneration }; }

function providerAudit(score: number): string {
  return JSON.stringify({ score, fatalIssues: [], sceneChecks: [], surgerySuggestions: [] });
}

test.after(() => closeDb());

test('manual and generated prose share the persisted completion contract', async () => {
  const generation = setup();
  const generated = await completeChapter(input(generation), { review: async () => ({ status: 'pass', proposedPatch: {} }) });
  assert.equal(generated.quality, 'pass');
  assert.equal(generated.gate.completionGate, 'ready');
  assert.equal(getChapter('c1')?.workflowMeta?.completionContentHash, generated.gate.contentHash);
  assert.equal(generated.factCandidateId, undefined);
  assert.equal(generated.factCandidateRunId, undefined);
  assert.ok(getChapter('c1')?.workflowMeta?.completionDecisionAt);
  assert.equal(listChapterVersions('c1').length, 1);
  const attempt = listChapterCompletionAttempts('n1', 'c1')[0]!;
  assert.equal(attempt.phase, 'facts-proposed');
  assert.equal((attempt.result as { factCandidate?: { id: string } }).factCandidate, undefined);
  const retry = await completeChapter(input(generation), { review: async () => { throw new Error('duplicate review'); } });
  assert.deepEqual(retry, generated);
});

test('default provider review requests JSON and sends labeled beginning/middle/end windows', async () => {
  const generation = setup();
  const longContent = [
    'BEGIN_MARKER',
    'a'.repeat(9_000),
    'MIDDLE_MARKER',
    'b'.repeat(9_000),
    'END_MARKER',
  ].join('');
  updateChapter('c1', { content: longContent, wordCount: longContent.length, updatedAt: 2 });
  let providerOptions: { prompt?: string; outputMode?: string; responseMimeType?: string } | undefined;
  const result = await completeChapter(input(generation), {
    reviewProvider: async (_config, options) => {
      providerOptions = options;
      return providerAudit(80);
    },
  });
  assert.equal(result.quality, 'pass');
  assert.equal(providerOptions?.outputMode, 'audit-json');
  assert.equal(providerOptions?.responseMimeType, 'application/json');
  assert.match(providerOptions?.prompt || '', /审稿窗口 opening/);
  assert.match(providerOptions?.prompt || '', /审稿窗口 middle/);
  assert.match(providerOptions?.prompt || '', /审稿窗口 ending/);
  assert.match(providerOptions?.prompt || '', /BEGIN_MARKER/);
  assert.match(providerOptions?.prompt || '', /MIDDLE_MARKER/);
  assert.match(providerOptions?.prompt || '', /END_MARKER/);
});

test('malformed, truncated, and out-of-range provider audits remain unknown', async () => {
  for (const raw of [
    '{"score":80,"fatalIssues":[]',
    providerAudit(-1),
    providerAudit(101),
  ]) {
    const generation = setup();
    const result = await completeChapter(input(generation), { reviewProvider: async () => raw });
    assert.equal(result.quality, 'unknown', raw);
    assert.notEqual(result.gate.completionGate, 'ready', raw);
  }
});

test('completion exposes unresolved run-backed facts through the existing fact API', async () => {
  const generation = setup();
  createCharacter({ id: 'char-1', novelId: 'n1', name: '阿青', role: 'protagonist', summary: '', bio: '', traits: [], createdAt: 1, updatedAt: 1 });
  updateChapter('c1', { content: '阿青拔剑', sceneBeats: '冲突出现', wordCount: 4, updatedAt: 2 });
  createChapterProductionRun({
    id: 'run-facts', novelId: 'n1', targetChapterId: 'c1', status: 'applied', userIntent: '', sceneBeats: '冲突出现', draftContent: '阿青拔剑', styleAudit: '',
    continuityReport: {
      databaseGeneration: generation, issues: [], proposedPatch: {
        characterUpdates: [{ characterId: 'char-1', summaryAppend: '拔剑', evidenceQuote: '阿青拔剑' }],
        itemUpdates: [], foreshadowingUpdates: [], timelineEventsToCreate: [], foreshadowingsToCreate: [],
      },
    },
    createdAt: 1, updatedAt: 1,
  });

  const completed = await completeChapter(input(generation), { review: async () => 'pass' });
  assert.match(completed.factCandidateId || '', /^[a-f0-9]{64}$/);
  assert.equal(completed.factCandidateRunId, 'run-facts');
  assert.equal(getChapter('c1')?.workflowMeta?.factCandidateId, completed.factCandidateId);
  assert.equal(getChapter('c1')?.workflowMeta?.factCandidateRunId, 'run-facts');
});

test('trusted review is reused and stale review is not', async () => {
  const generation = setup();
  const hash = deriveChapterCompletionGate({ content: '已接受正文', sceneBeats: '冲突出现' }).contentHash;
  updateChapter('c1', { workflowMeta: { version: 1, reviewState: { schemaVersion: 1, contentHash: hash, gate: 'pass', issues: [], lastReviewedAt: 10 } } });
  let calls = 0;
  const trusted = await completeChapter(input(generation), { review: async () => { calls += 1; return 'fail'; } });
  assert.equal(trusted.quality, 'pass');
  assert.equal(calls, 0);
  updateChapter('c1', { content: '正文已被作者修改', wordCount: 8, updatedAt: 2 });
  const stale = await completeChapter(input(generation), { review: async () => { calls += 1; return 'unknown'; } });
  assert.equal(stale.quality, 'unknown');
  assert.equal(calls, 1);
  assert.equal(listChapterCompletionAttempts('n1', 'c1').length, 2);
});

test('evidenced review issues remain eligible for local revision', async () => {
  const generation = setup();
  const contentHash = deriveChapterCompletionGate({ content: '已接受正文', sceneBeats: '冲突出现' }).contentHash;
  const reviewState = {
    schemaVersion: 1 as const,
    contentHash,
    gate: 'needs-action' as const,
    issues: [{
      id: 'issue-1', source: 'chapter-audit' as const, category: 'scene', severity: 'major' as const,
      snippet: '已接受正文', explanation: '冲突不明确', suggestedFix: '收紧冲突', recommendedCapabilityIds: [],
      status: 'open' as const, contentHash, createdAt: 1, updatedAt: 1,
    }],
  };
  const result = await completeChapter(input(generation), { review: async () => ({ status: 'fail', reviewState, proposedPatch: {} }) });
  assert.equal(result.quality, 'needs-action');
  assert.equal(result.gate.canAcceptLocalRevision, true);
  assert.equal(getChapter('c1')?.workflowMeta?.reviewState?.issues[0]?.id, 'issue-1');
});

test('retry resumes every durable phase without duplicate versions or AI reviews', async () => {
  const phases = ['writes-flushed', 'version-created', 'deterministic-checked', 'ai-reviewed', 'facts-proposed'] as const;
  for (const interruptedPhase of phases) {
    const generation = setup();
    let reviewCalls = 0;
    let interrupted = false;
    await assert.rejects(
      completeChapter(input(generation), {
        review: async () => { reviewCalls += 1; return { status: 'pass', proposedPatch: {} }; },
        afterPhase: (phase) => { if (phase === interruptedPhase && !interrupted) { interrupted = true; throw new Error('INTERRUPTED'); } },
      }),
      /INTERRUPTED/,
    );
    const resumed = await completeChapter(input(generation), { review: async () => { reviewCalls += 1; return 'fail'; } });
    assert.equal(resumed.phase, 'facts-proposed');
    assert.equal(listChapterVersions('c1').length, 1, interruptedPhase);
    assert.equal(reviewCalls, interruptedPhase === 'writes-flushed' || interruptedPhase === 'version-created' || interruptedPhase === 'deterministic-checked' ? 1 : 1, interruptedPhase);
    assert.equal(listChapterCompletionAttempts('n1', 'c1').length, 1, interruptedPhase);
  }
});

test('changed manuscript hash creates a new inspectable attempt', async () => {
  const generation = setup();
  const first = await completeChapter(input(generation), { review: async () => 'pass' });
  updateChapter('c1', { content: '第二版正文', wordCount: 5, updatedAt: 2 });
  const second = await completeChapter(input(generation), { review: async () => 'unknown' });
  assert.notEqual(first.attemptId, second.attemptId);
  assert.equal(listChapterCompletionAttempts('n1', 'c1').length, 2);
  assert.equal(listChapterVersions('c1').length, 2);
});

test('unknown review supports explicit risk acceptance and edits make it stale', async () => {
  const generation = setup();
  const pending = await completeChapter(input(generation), { review: async () => 'unknown' });
  assert.equal(pending.quality, 'unknown');
  const accepted = await acceptChapterRisk({ ...input(generation), unresolvedIssueIds: ['ai-review'], unknownChecks: ['provider'], contentHash: pending.gate.contentHash, planHash: pending.gate.planHash, authorDecisionAt: 123 });
  assert.equal(accepted.riskAccepted, true);
  assert.equal(accepted.gate.completionGate, 'accepted-risk');
  assert.equal(getChapter('c1')?.workflowMeta?.completionGate, 'accepted-risk');
  assert.equal(getChapter('c1')?.workflowMeta?.completionContentHash, accepted.gate.contentHash);
  updateChapter('c1', { content: '编辑后的正文', updatedAt: 3 });
  await assert.rejects(
    acceptChapterRisk({ ...input(generation), unresolvedIssueIds: [], unknownChecks: [], contentHash: pending.gate.contentHash, planHash: pending.gate.planHash }),
    /RISK_DECISION_STALE/,
  );
});

test('explicit unavailable retry reruns only the AI phase on the same attempt', async () => {
  const generation = setup();
  let reviewCalls = 0;
  const pending = await completeChapter(input(generation), { review: async () => { reviewCalls += 1; return 'unknown'; } });
  const retried = await completeChapter({ ...input(generation), retryUnavailable: true }, { review: async () => { reviewCalls += 1; return 'pass'; } });
  assert.equal(pending.attemptId, retried.attemptId);
  assert.equal(retried.quality, 'pass');
  assert.equal(reviewCalls, 2);
  assert.equal(listChapterVersions('c1').length, 1);
  assert.equal(listChapterCompletionAttempts('n1', 'c1').length, 1);
});

test('unavailable retry resumes after an interruption without a third AI review', async () => {
  const generation = setup();
  let reviewCalls = 0;
  await completeChapter(input(generation), { review: async () => { reviewCalls += 1; return 'unknown'; } });
  await assert.rejects(
    completeChapter({ ...input(generation), retryUnavailable: true }, {
      review: async () => { reviewCalls += 1; return 'pass'; },
      afterPhase: (phase) => { if (phase === 'ai-reviewed') throw new Error('INTERRUPTED_RETRY'); },
    }),
    /INTERRUPTED_RETRY/,
  );
  const resumed = await completeChapter(input(generation), { review: async () => { throw new Error('duplicate review'); } });
  assert.equal(resumed.quality, 'pass');
  assert.equal(reviewCalls, 2);
  assert.equal(listChapterVersions('c1').length, 1);
});

test('does not publish a review result after the author edits during review', async () => {
  const generation = setup();
  let reviewStarted!: () => void;
  let releaseReview!: () => void;
  const started = new Promise<void>((resolve) => { reviewStarted = resolve; });
  const blocked = new Promise<void>((resolve) => { releaseReview = resolve; });
  const completion = completeChapter(input(generation), {
    review: async () => {
      reviewStarted();
      await blocked;
      return 'pass';
    },
  });
  await started;
  updateChapter('c1', { content: '作者刚刚编辑的新正文', wordCount: 10, updatedAt: 2 });
  releaseReview();
  await assert.rejects(completion, /CHAPTER_COMPLETION_STALE/);
  assert.equal(getChapter('c1')?.content, '作者刚刚编辑的新正文');
  assert.equal(getChapter('c1')?.workflowMeta?.completionContentHash, undefined);
});

test('ownership and generation conflicts perform no writes', async () => {
  const generation = setup();
  await assert.rejects(completeChapter({ ...input(generation), novelId: 'wrong' }, { review: async () => 'pass' }), /NOT_FOUND_OR_NOT_OWNED/);
  await assert.rejects(completeChapter({ ...input(generation), databaseGeneration: generation + 1 }, { review: async () => 'pass' }), /DATABASE_GENERATION_STALE/);
  assert.equal(listChapterCompletionAttempts('n1', 'c1').length, 0);
  assert.equal(listChapterVersions('c1').length, 0);
});
