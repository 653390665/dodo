/**
 * Plan 262 B2：评分口径单源（shared/lib/prompt-score-policy.ts）与治理目录零漂移。
 */
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  FEATURED_MIN_SCORE,
  PLACEHOLDER_SCORE_CAP,
  SCORE_ADOPT_MIN,
  SCORE_CANDIDATE_MIN,
  SCORE_GRADE_BANDS,
  SCORE_POLICY_SUMMARY,
  describeScorePolicy,
  gradeFromScore,
  isScoreAdoptable,
  scoreAdmissionOf,
  scoreBadgeLabel,
} from '../shared/lib/prompt-score-policy.js';
import { PROMPT_GOVERNANCE_CATALOG } from '../shared/lib/prompt-governance-catalog.js';
import { PUBLIC_SKILL_GOVERNANCE_CATALOG } from '../shared/lib/public-skill-catalog.js';
import {
  FEATURED_MIN_SCORE as PIPELINE_FEATURED_MIN_SCORE,
  PLACEHOLDER_SCORE_CAP as PIPELINE_PLACEHOLDER_SCORE_CAP,
  recalibrateGrade,
} from '../scripts/lib/public-catalog-pipeline.js';

const ROOT = path.resolve(import.meta.dirname, '..');

test('分档边界：A≥90 / B≥80 / C≥70 / D≥60 / F<60（缺分视为 F）', () => {
  const cases: Array<[number | null | undefined, string]> = [
    [120, 'A'],
    [90, 'A'],
    [89, 'B'],
    [80, 'B'],
    [79, 'C'],
    [70, 'C'],
    [69, 'D'],
    [60, 'D'],
    [59, 'F'],
    [0, 'F'],
    [Number.NaN, 'F'],
    [null, 'F'],
    [undefined, 'F'],
  ];
  for (const [score, grade] of cases) {
    assert.equal(gradeFromScore(score), grade, `gradeFromScore(${String(score)})`);
  }
  assert.deepEqual(
    SCORE_GRADE_BANDS.map((band) => band.grade),
    ['A', 'B', 'C', 'D', 'F']
  );
});

test('门槛映射：≥70 可装配 / 60–69 仅候选 / <60 不可用（缺分不可用）', () => {
  assert.equal(SCORE_ADOPT_MIN, 70);
  assert.equal(SCORE_CANDIDATE_MIN, 60);
  assert.equal(isScoreAdoptable(70), true);
  assert.equal(isScoreAdoptable(69), false);
  assert.equal(isScoreAdoptable(undefined), false);
  assert.deepEqual(
    [90, 70, 69, 60, 59, null].map((score) => scoreAdmissionOf(score)),
    ['adopt', 'adopt', 'candidate', 'candidate', 'unusable', 'unusable']
  );
  assert.equal(scoreBadgeLabel(78), 'C级 (78分) · 可装配');
  assert.equal(scoreBadgeLabel(63), 'D级 (63分) · 仅候选');
  assert.equal(scoreBadgeLabel(56), 'F级 (56分) · 不可用');
  assert.equal(scoreBadgeLabel(undefined), '未评分');
  assert.equal(describeScorePolicy(78).gradeLabel, 'C 级（70–79 分）');
  assert.equal(describeScorePolicy(78).summary, SCORE_POLICY_SUMMARY);
  assert.match(SCORE_POLICY_SUMMARY, /≥70 分可装配/);
  assert.match(SCORE_POLICY_SUMMARY, /60–69 分仅候选/);
  assert.match(SCORE_POLICY_SUMMARY, /<60 分不可用/);
});

test('两份治理目录零漂移：grade 一律由 score 推导，且门槛与 runtimeStatus 一致', () => {
  const scoreOf = (asset: { score?: number }) => asset.score ?? Number.NaN;
  const mismatch = (id: string | undefined, score: number | undefined, grade: string | undefined) =>
    `${id}: score=${String(score)} grade=${grade}`;
  for (const asset of [...PROMPT_GOVERNANCE_CATALOG, ...PUBLIC_SKILL_GOVERNANCE_CATALOG]) {
    assert.equal(
      asset.grade,
      gradeFromScore(asset.score),
      mismatch(asset.id, asset.score, asset.grade)
    );
    // 评级与准入门槛同源：A/B/C ⇒ 可装配；D/F ⇒ 未达可装配线。
    if (asset.grade === 'A' || asset.grade === 'B' || asset.grade === 'C') {
      assert.ok(scoreOf(asset) >= SCORE_ADOPT_MIN, `${asset.id} 应为可装配分`);
    } else {
      assert.ok(scoreOf(asset) < SCORE_ADOPT_MIN, `${asset.id} 不应达到可装配分`);
    }
  }
  const activeLow = PROMPT_GOVERNANCE_CATALOG.filter(
    (asset) => asset.runtimeStatus === 'active' && scoreOf(asset) < SCORE_ADOPT_MIN
  );
  assert.deepEqual(
    activeLow.map((asset) => asset.id),
    ['test-fixture-lowscore'],
    'active 资产不得低于可装配分（唯一豁免是 test-fixture 语料，只为验证 F 级拒绝路径）'
  );
});

test('B2 修正的漂移卡钉住（旧实现标错、单源后归位）', () => {
  const byId = new Map(PROMPT_GOVERNANCE_CATALOG.map((asset) => [asset.id, asset]));
  for (const id of ['private-197', 'private-195', 'private-161', 'private-106']) {
    const asset = byId.get(id);
    assert.ok(asset, `${id} 应存在`);
    assert.equal(asset!.score, 56);
    assert.equal(asset!.grade, 'F', `${id}：56 分应为 F（旧实现标 D）`);
  }
  for (const [id, score] of [
    ['opening-templates-library', 78],
    ['knowledge-extract', 78],
    ['foreshadow-settle', 76],
  ] as Array<[string, number]>) {
    const asset = byId.get(id);
    assert.ok(asset, `${id} 应存在`);
    assert.equal(asset!.score, score);
    assert.equal(asset!.grade, 'C', `${id}：${score} 分应为 C（旧实现标 B）`);
  }
});

test('生成管线同源：recalibrateGrade 与常量都来自评分口径模块', () => {
  assert.equal(recalibrateGrade(90), 'A');
  assert.equal(recalibrateGrade(80), 'B');
  assert.equal(recalibrateGrade(70), 'C');
  assert.equal(recalibrateGrade(60), 'D');
  assert.equal(recalibrateGrade(59), 'F');
  assert.equal(PLACEHOLDER_SCORE_CAP, 60);
  assert.equal(FEATURED_MIN_SCORE, 70);
  assert.equal(PIPELINE_PLACEHOLDER_SCORE_CAP, PLACEHOLDER_SCORE_CAP);
  assert.equal(PIPELINE_FEATURED_MIN_SCORE, FEATURED_MIN_SCORE);
});

test('仓内不存在第二处分档实现（源码扫描，只允许单源模块出现 grade 三元式）', () => {
  const dirs = ['shared/lib', 'scripts/lib', 'src/lib', 'src/components', 'server/helpers'];
  const gradeTernary = /score\s*>=\s*\d+\s*\?\s*['"][A-F]['"]/;
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        const text = readFileSync(path.join(ROOT, rel), 'utf8');
        if (gradeTernary.test(text)) offenders.push(rel);
      }
    }
  };
  for (const dir of dirs) walk(dir);
  assert.deepEqual(offenders, [], `分档实现应只在 shared/lib/prompt-score-policy.ts，发现：${offenders.join(', ')}`);
});
