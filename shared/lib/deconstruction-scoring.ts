import type { Skill } from '../types/skills';

export interface DeconstructionScoreReport {
  score: number;
  grade: 'S' | 'A' | 'B' | 'C';
  details: {
    evidenceScore: number;
    evidenceDeductions: string[];
    transferabilityScore: number;
    transferabilityDeductions: string[];
    safetyScore: number;
    safetyDeductions: string[];
  };
}

/**
 * Collects all relevant descriptive text fields from a Skill object,
 * skipping metadata fields like id, timestamp, etc., to avoid false positives.
 */
function collectAllText(card: Partial<Skill>): string {
  const skipKeys = new Set([
    'id',
    'parentSkillId',
    'lineageRootId',
    'deckGroupId',
    'createdAt',
    'updatedAt',
    'version',
    'stabilityScore',
    'feedbackScore'
  ]);
  const texts: string[] = [];

  function traverse(val: unknown, key?: string) {
    if (key && skipKeys.has(key)) {
      return;
    }
    if (typeof val === 'string') {
      texts.push(val);
    } else if (Array.isArray(val)) {
      for (const item of val) {
        traverse(item);
      }
    } else if (val && typeof val === 'object') {
      const record = val as Record<string, unknown>;
      for (const k of Object.keys(record)) {
        traverse(record[k], k);
      }
    }
  }

  traverse(card);
  return texts.join('\n');
}

/**
 * Deterministic scoring engine for deconstruction cards.
 * Max score is 100 points.
 * Grade Tiering:
 * - >= 90: S-Tier (Hall of Fame)
 * - 75 - 89: A-Tier (Elite)
 * - 60 - 74: B-Tier (Passed)
 * - < 60: C-Tier (Warning / Weak fallback)
 */
export function evaluateDeconstructionCard(card: Partial<Skill>): DeconstructionScoreReport {
  const texts = collectAllText(card);

  // 1. Evidence Coverage (Max 30 pts)
  let evidenceScore: number;
  const evidenceDeductions: string[] = [];
  const fewShots = card.fewShots || [];
  const fewShotsCount = fewShots.length;

  if (fewShotsCount === 0) {
    evidenceScore = 0;
    evidenceDeductions.push('未提供 FewShot 示例样本 (0/30分)');
  } else if (fewShotsCount === 1) {
    evidenceScore = 15;
  } else if (fewShotsCount === 2) {
    evidenceScore = 25;
  } else {
    evidenceScore = 30;
  }

  // Penalty: fewShots too short (<20 characters)
  let hasShortFewShot = false;
  for (const shot of fewShots) {
    if (shot && shot.trim().length < 20) {
      hasShortFewShot = true;
      break;
    }
  }
  if (hasShortFewShot && fewShotsCount > 0) {
    evidenceScore = Math.max(0, evidenceScore - 5);
    evidenceDeductions.push('检测到少于 20 字符的弱证据 FewShot 样本 (-5分)');
  }

  // 2. Transferability (Max 35 pts)
  let transferabilityScore = 35;
  const transferabilityDeductions: string[] = [];

  const famousEntities = ['萧炎', '唐三', '石昊', '叶凡', '韩立', '方源', '林动'];
  const testLeaks = ['林天凡', '楚天凡'];

  for (const entity of famousEntities) {
    // We check if the text contains the entity
    if (texts.includes(entity)) {
      transferabilityScore -= 10;
      transferabilityDeductions.push(`检测到著名网文实体泄露：'${entity}' (-10分)`);
    }
  }

  for (const leak of testLeaks) {
    if (texts.includes(leak)) {
      transferabilityScore -= 5;
      transferabilityDeductions.push(`检测到典型占位名泄露：'${leak}' (-5分)`);
    }
  }

  transferabilityScore = Math.max(0, transferabilityScore);

  // 3. Pollution Safety (Max 35 pts)
  let safetyScore = 35;
  const safetyDeductions: string[] = [];

  const slopPhrases = [
    '文笔流畅',
    '描写细腻',
    '人物形象鲜明',
    '情节紧凑',
    '引人入胜',
    '语言精炼',
    '意象丰富',
    '跃然纸上'
  ];

  for (const phrase of slopPhrases) {
    if (texts.includes(phrase)) {
      safetyScore -= 5;
      safetyDeductions.push(`检测到 AI 腔套话/模板废话：'${phrase}' (-5分)`);
    }
  }

  safetyScore = Math.max(0, safetyScore);

  const totalScore = evidenceScore + transferabilityScore + safetyScore;
  let grade: 'S' | 'A' | 'B' | 'C';

  if (totalScore >= 90) {
    grade = 'S';
  } else if (totalScore >= 75) {
    grade = 'A';
  } else if (totalScore >= 60) {
    grade = 'B';
  } else {
    grade = 'C';
  }

  return {
    score: totalScore,
    grade,
    details: {
      evidenceScore,
      evidenceDeductions,
      transferabilityScore,
      transferabilityDeductions,
      safetyScore,
      safetyDeductions
    }
  };
}
