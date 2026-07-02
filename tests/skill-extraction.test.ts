import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFullFallbackSkillResult,
  createSkillExtractionJob,
  skillExtractionJobs,
  type SkillExtractionResult
} from '../server/helpers/skill-extraction';

test('skill-extraction - buildFullFallbackSkillResult throws on empty text', () => {
  assert.throws(() => {
    buildFullFallbackSkillResult('');
  }, /text is too short to analyze/);
});

test('skill-extraction - buildFullFallbackSkillResult produces complete deck structure on long text', () => {
  // Generate some long text to satisfy buildBookEvidenceSegments (requires enough text to segment)
  const longText = '段落一：这长段落文字被用来测试保底拆书卡提取逻辑。动作推开房门，拔出长剑，听见外面停下脚步的声音。'.repeat(15);
  const result = buildFullFallbackSkillResult(longText);

  assert.ok(Array.isArray(result.skills));
  assert.ok(result.deck);
  assert.ok(Array.isArray(result.segments));
  assert.ok(Array.isArray(result.warnings));
  assert.ok(result.quality);
  assert.equal(typeof result.quality.passed, 'boolean');
});

test('skill-extraction - createSkillExtractionJob completed state transition', async () => {
  const mockResult: SkillExtractionResult = {
    skills: [],
    deck: { mainCard: {}, supportCards: [] } as any,
    segments: [{ id: 's1', stage: 'opening', label: '开局段' }],
    warnings: ['测试警告'],
    quality: {
      passed: true,
      anchoringScore: 80,
      genericSkillCount: 0,
      totalSkillCount: 1,
      genericDetails: [],
      fieldCompleteness: 1,
      issue: ''
    }
  };

  const taskPromise = Promise.resolve(mockResult);
  const jobId = createSkillExtractionJob(taskPromise);

  const pendingJob = skillExtractionJobs.get(jobId);
  assert.ok(pendingJob);
  assert.equal(pendingJob.status, 'pending');

  await taskPromise; // Wait for promise microtask to resolve
  // Wait a small timeout to let the event loop process the .then() callback
  await new Promise((resolve) => setTimeout(resolve, 10));

  const completedJob = skillExtractionJobs.get(jobId);
  assert.ok(completedJob);
  assert.equal(completedJob.status, 'completed');
  assert.deepEqual(completedJob.result, mockResult);
  assert.equal(completedJob.error, undefined);
});

test('skill-extraction - createSkillExtractionJob failed state transition', async () => {
  const errorMsg = 'AI Model Out of Context';
  const taskPromise = Promise.reject(new Error(errorMsg));
  const jobId = createSkillExtractionJob(taskPromise);

  const pendingJob = skillExtractionJobs.get(jobId);
  assert.ok(pendingJob);
  assert.equal(pendingJob.status, 'pending');

  try {
    await taskPromise;
  } catch {
    // Expected rejection
  }
  // Wait a small timeout to let the event loop process the .catch() callback
  await new Promise((resolve) => setTimeout(resolve, 10));

  const failedJob = skillExtractionJobs.get(jobId);
  assert.ok(failedJob);
  assert.equal(failedJob.status, 'failed');
  assert.equal(failedJob.error, errorMsg);
  assert.equal(failedJob.result, undefined);
});
