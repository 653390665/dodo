/**
 * 治理评分口径（Plan 262 B2）：分档（grade）与准入门槛的唯一事实源。
 *
 * 为什么存在：`score` 同时是「质量分」与「准入门槛」，仓内此前把分档逻辑散在三处
 * （`prompt-sanitizer.promoteToRuntimeReady` 的完整 A–F 分档、`prompt-governance-catalog`
 * 各家族的截断分档、生成管线的 `recalibrateGrade`），已经造成 7 张卡的 `grade` 与实际
 * 分数不一致（2026-09-28 实测：4 张 56 分标 D、3 张 76–78 分标 B）。本模块给出唯一实现，
 * 目录与管线都必须引用它，卡面/详情文案也从这里取口径说明。
 *
 * 分档（SCORE_GRADE_BANDS，命中第一条 min 即为该级）：
 * - A：≥90；B：80–89；C：70–79；D：60–69；F：<60。
 *
 * 准入门槛（与分档同源）：
 * - `adopt`（可装配）：≥70（C 及以上）；
 * - `candidate`（仅候选）：60–69（D）；
 * - `unusable`（不可用）：<60（F）。
 */

/** 治理评级（与 `GovernedPromptAsset.grade` 字段一致）。 */
export type ScoreGrade = 'A' | 'B' | 'C' | 'D' | 'F';

/** 分档表（唯一事实源；按 min 降序排列，命中第一条即该级）。 */
export const SCORE_GRADE_BANDS: ReadonlyArray<{ readonly min: number; readonly grade: ScoreGrade }> = [
  { min: 90, grade: 'A' },
  { min: 80, grade: 'B' },
  { min: 70, grade: 'C' },
  { min: 60, grade: 'D' },
  { min: Number.NEGATIVE_INFINITY, grade: 'F' },
];

/** 每级的区间说明（界面文案用，与 SCORE_GRADE_BANDS 同源描述）。 */
export const SCORE_GRADE_LABELS: Record<ScoreGrade, string> = {
  A: 'A 级（≥90 分）',
  B: 'B 级（80–89 分）',
  C: 'C 级（70–79 分）',
  D: 'D 级（60–69 分，仅候选）',
  F: 'F 级（<60 分，不可用）',
};

/** 可装配的最低分（C 级门槛）。 */
export const SCORE_ADOPT_MIN = 70;

/** 候选的最低分（D 级门槛；低于此分为不可用）。 */
export const SCORE_CANDIDATE_MIN = 60;

/** 公开目录生成管线沿用的常量（占位正文惩罚封顶 / featured 门槛），从本模块单源。 */
export const PLACEHOLDER_SCORE_CAP = 60;
export const FEATURED_MIN_SCORE = 70;

export type ScoreAdmission = 'adopt' | 'candidate' | 'unusable';

/** 准入结论的中文标签（卡面/详情与错误文案共用）。 */
export const SCORE_ADMISSION_LABELS: Record<ScoreAdmission, string> = {
  adopt: '可装配',
  candidate: '仅候选',
  unusable: '不可用',
};

/** 一句话口径说明（卡面/详情与规格文档共用，避免各处手抄不同版本）。 */
export const SCORE_POLICY_SUMMARY =
  '评分口径：≥70 分可装配（A≥90 / B≥80 / C≥70）；60–69 分仅候选（D）；<60 分不可用（F）。';

/** 评分是否达标（可用于装配）。 */
export function isScoreAdoptable(score: number | null | undefined): boolean {
  return typeof score === 'number' && Number.isFinite(score) && score >= SCORE_ADOPT_MIN;
}

/** 分数 → 评级（唯一分档实现；缺分数视为 F）。 */
export function gradeFromScore(score: number | null | undefined): ScoreGrade {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'F';
  for (const band of SCORE_GRADE_BANDS) {
    if (score >= band.min) return band.grade;
  }
  return 'F';
}

/** 分数 → 准入结论（唯一门槛实现；缺分数视为不可用）。 */
export function scoreAdmissionOf(score: number | null | undefined): ScoreAdmission {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'unusable';
  if (score >= SCORE_ADOPT_MIN) return 'adopt';
  if (score >= SCORE_CANDIDATE_MIN) return 'candidate';
  return 'unusable';
}

/** 卡面徽标文案：`B级 (78分) · 可装配`。 */
export function scoreBadgeLabel(score: number | null | undefined): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '未评分';
  return `${gradeFromScore(score)}级 (${score}分) · ${SCORE_ADMISSION_LABELS[scoreAdmissionOf(score)]}`;
}

export interface ScorePolicyDescription {
  readonly grade: ScoreGrade;
  readonly gradeLabel: string;
  readonly admission: ScoreAdmission;
  readonly admissionLabel: string;
  readonly summary: string;
}

/** 组合口径说明（卡面 title / 详情面板使用）。 */
export function describeScorePolicy(score: number | null | undefined): ScorePolicyDescription {
  const grade = gradeFromScore(score);
  const admission = scoreAdmissionOf(score);
  return {
    grade,
    gradeLabel: SCORE_GRADE_LABELS[grade],
    admission,
    admissionLabel: SCORE_ADMISSION_LABELS[admission],
    summary: SCORE_POLICY_SUMMARY,
  };
}
