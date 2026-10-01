import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REASONING_EFFORT_OVERRIDE_ENV,
  reasoningEffortTimeoutScale,
  scaleTimeoutForReasoningEffort,
} from '../server/lib/server-llm.js';
import {
  resolveCriticMaxTimeoutMs,
  resolveCriticTimeoutMs,
  resolveWriterTimeoutMs,
} from '../server/helpers/ai-production-pipeline.js';

/**
 * Plan 268：high 档位的真机故障不是「上游挂了」，而是固定超时把「档位」误判成
 * 「超时故障」（critic 70s 被掐断 → audit unknown → review_required）。
 * 这些用例钉住：① 档位→超时系数的映射；② 三段超时确实随档位缩放；
 * ③ 显式 env 覆盖优先于缩放（运维开关不能被吃掉）。
 */

test('reasoningEffortTimeoutScale maps the thinking tier to a timeout multiplier', () => {
  assert.equal(reasoningEffortTimeoutScale({}), 1);
  assert.equal(reasoningEffortTimeoutScale({ [REASONING_EFFORT_OVERRIDE_ENV]: 'low' }), 1);
  assert.equal(reasoningEffortTimeoutScale({ [REASONING_EFFORT_OVERRIDE_ENV]: 'minimal' }), 1);
  assert.equal(reasoningEffortTimeoutScale({ [REASONING_EFFORT_OVERRIDE_ENV]: 'medium' }), 1.5);
  assert.equal(reasoningEffortTimeoutScale({ [REASONING_EFFORT_OVERRIDE_ENV]: 'high' }), 3);
  assert.equal(reasoningEffortTimeoutScale({ [REASONING_EFFORT_OVERRIDE_ENV]: 'xhigh' }), 4);
  assert.equal(reasoningEffortTimeoutScale({ [REASONING_EFFORT_OVERRIDE_ENV]: 'max' }), 4);
  // 非法取值被 resolveReasoningEffortOverride 忽略 -> 回默认系数（不静默放大超时）
  assert.equal(reasoningEffortTimeoutScale({ [REASONING_EFFORT_OVERRIDE_ENV]: 'HIGH!!' }), 1);
});

test('scaleTimeoutForReasoningEffort scales stage baselines and rounds to whole ms', () => {
  assert.equal(scaleTimeoutForReasoningEffort(35_000, {}), 35_000);
  assert.equal(
    scaleTimeoutForReasoningEffort(35_000, { [REASONING_EFFORT_OVERRIDE_ENV]: 'medium' }),
    52_500
  );
  assert.equal(
    scaleTimeoutForReasoningEffort(35_000, { [REASONING_EFFORT_OVERRIDE_ENV]: 'high' }),
    105_000
  );
  assert.equal(
    scaleTimeoutForReasoningEffort(120_000, { [REASONING_EFFORT_OVERRIDE_ENV]: 'high' }),
    360_000
  );
});

test('writer/critic timeouts follow the tier unless an explicit env override wins', () => {
  assert.equal(resolveWriterTimeoutMs({}), 180_000);
  assert.equal(resolveWriterTimeoutMs({ [REASONING_EFFORT_OVERRIDE_ENV]: 'high' }), 540_000);
  assert.equal(
    resolveWriterTimeoutMs({
      [REASONING_EFFORT_OVERRIDE_ENV]: 'high',
      INKFLOW_WRITER_TIMEOUT_MS: '9000',
    }),
    9_000
  );

  assert.equal(resolveCriticTimeoutMs({}), 35_000);
  assert.equal(resolveCriticTimeoutMs({ [REASONING_EFFORT_OVERRIDE_ENV]: 'high' }), 105_000);
  assert.equal(
    resolveCriticTimeoutMs({
      [REASONING_EFFORT_OVERRIDE_ENV]: 'high',
      INKFLOW_CRITIC_TIMEOUT_MS: '45000',
    }),
    45_000
  );

  assert.equal(resolveCriticMaxTimeoutMs({}), 120_000);
  assert.equal(resolveCriticMaxTimeoutMs({ [REASONING_EFFORT_OVERRIDE_ENV]: 'high' }), 360_000);
  // 重试上限必须高于基线，否则第一次重试的 x2 会被立即夹住（档位白升）
  assert.ok(
    resolveCriticMaxTimeoutMs({ [REASONING_EFFORT_OVERRIDE_ENV]: 'high' }) >
      resolveCriticTimeoutMs({ [REASONING_EFFORT_OVERRIDE_ENV]: 'high' })
  );
});
