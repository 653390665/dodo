import assert from 'node:assert/strict';
import test from 'node:test';
import type { GovernedPromptAsset } from '../shared/types/prompt-assets-governed.js';
import {
  PLACEHOLDER_TEMPLATE_MARKER,
  PLACEHOLDER_SCORE_CAP,
  isPlaceholderSourceBody,
  isPlaceholderRuntimeBody,
  applyPlaceholderScorePenalty,
  applyFeaturedGuard,
} from '../scripts/lib/public-catalog-pipeline.js';

// ─────────────────────────────────────────────────────────────────────────────
// Plan 258 散卡层治理单测：占位空壳评分惩罚 + featured 授予守卫。
//
// 单源（2026-09-24）：这些纯函数从 scripts/lib/public-catalog-pipeline.ts 导入，
// 生成脚本 scripts/generate-public-catalog.ts 用的是同一实现——本文件旧版曾镜像
// 一份副本（脚本 import 即执行 generate()，测试无法直接导入），镜像漂移是真实
// 风险面，已删除。规则变更只需改管线一处，本测试与 freshness 守卫自动跟随。
// ─────────────────────────────────────────────────────────────────────────────


function makeCard(overrides: Partial<GovernedPromptAsset>): GovernedPromptAsset {
  return {
    id: 'test-card',
    title: '测试卡',
    template: '真实正文模板，覆盖完整可执行的提示词指令。',
    score: 85,
    grade: 'B',
    ...overrides,
  } as GovernedPromptAsset;
}

// ─── 占位评分惩罚（Step 1）──────────────────────────────────────────────────

test('占位标记命中的高分卡封顶 60 并校准 grade', () => {
  const card = makeCard({
    template: '[广场优秀提示词模版体] 围绕 XX 执行，对标网文审美要求。',
    score: 88,
    grade: 'B',
  });
  const governed = applyPlaceholderScorePenalty(card, isPlaceholderSourceBody);
  assert.equal(governed.score, 60);
  assert.equal(governed.grade, 'C');
});

test('真实正文短卡不受源级惩罚（不依赖长度阈值，不误伤内置工具卡形态）', () => {
  const card = makeCard({ template: '短但真实的工具提示词。', score: 98, grade: 'A' });
  const governed = applyPlaceholderScorePenalty(card, isPlaceholderSourceBody);
  assert.equal(governed.score, 98);
  assert.equal(governed.grade, 'A');
  assert.equal(governed, card, '非占位卡必须原样返回，不产生新对象');
});

test('空模板按占位空壳封顶', () => {
  const card = makeCard({ template: '', score: 76, grade: 'C' });
  const governed = applyPlaceholderScorePenalty(card, isPlaceholderSourceBody);
  assert.equal(governed.score, 60);
});

test('已低于封顶值的占位卡原样保留（封顶只降不升）', () => {
  const card = makeCard({ template: '如有问题联系 。推荐使用。', score: 45, grade: 'F' });
  const governed = applyPlaceholderScorePenalty(card, isPlaceholderRuntimeBody);
  assert.equal(governed.score, 45);
  assert.equal(governed.grade, 'F', '低分卡的 grade 语义不被惩罚改写');
  assert.equal(governed, card);
});

test('副本运行时正文长度边界：79 字占位、80 字可信', () => {
  const short = makeCard({ template: '字'.repeat(79), score: 72, grade: 'C' });
  assert.equal(
    applyPlaceholderScorePenalty(short, isPlaceholderRuntimeBody).score,
    PLACEHOLDER_SCORE_CAP
  );
  const exact = makeCard({ template: '字'.repeat(80), score: 72, grade: 'C' });
  assert.equal(
    applyPlaceholderScorePenalty(exact, isPlaceholderRuntimeBody),
    exact,
    '达到可信长度的正文不算占位'
  );
});

test('副本级判定继承源级规则：标记命中与空模板同样占位', () => {
  const marked = makeCard({ template: `[${PLACEHOLDER_TEMPLATE_MARKER}] 残句。`, score: 80, grade: 'B' });
  assert.equal(applyPlaceholderScorePenalty(marked, isPlaceholderRuntimeBody).score, 60);
  const empty = makeCard({ template: undefined, score: 80, grade: 'B' });
  assert.equal(applyPlaceholderScorePenalty(empty, isPlaceholderRuntimeBody).score, 60);
});

// ─── featured 授予守卫（Step 2）────────────────────────────────────────────

test('featured 且 score 低于门槛 → 降 standard', () => {
  const card = makeCard({ curationTier: 'featured', score: 45, grade: 'F' });
  assert.equal(applyFeaturedGuard(card, isPlaceholderSourceBody).curationTier, 'standard');
});

test('featured 但正文占位 → 即使高分也降 standard', () => {
  const card = makeCard({
    curationTier: 'featured',
    score: 88,
    grade: 'B',
    template: '[广场优秀提示词模版体] 占位句。',
  });
  assert.equal(applyFeaturedGuard(card, isPlaceholderSourceBody).curationTier, 'standard');
});

test('featured 且高分真实正文 → 保留 featured', () => {
  const card = makeCard({ curationTier: 'featured', score: 85, grade: 'B' });
  assert.equal(applyFeaturedGuard(card, isPlaceholderSourceBody), card);
});

test('featured 分数门槛边界：70 保留、69 降档', () => {
  const atThreshold = makeCard({ curationTier: 'featured', score: 70, grade: 'C' });
  assert.equal(applyFeaturedGuard(atThreshold, isPlaceholderSourceBody), atThreshold);
  const below = makeCard({ curationTier: 'featured', score: 69, grade: 'C' });
  assert.equal(applyFeaturedGuard(below, isPlaceholderSourceBody).curationTier, 'standard');
});

test('非 featured 档位不受守卫影响', () => {
  const standard = makeCard({ curationTier: 'standard', score: 30, grade: 'F' });
  assert.equal(applyFeaturedGuard(standard, isPlaceholderSourceBody), standard);
  const suspect = makeCard({ curationTier: 'suspect-duplicate', score: 65, grade: 'C' });
  assert.equal(applyFeaturedGuard(suspect, isPlaceholderRuntimeBody), suspect);
});


