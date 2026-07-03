import type { SegmentSkillEvidence, Skill } from '../../shared/types';
import { generateId } from '../id.ts';
import { buildBookEvidenceSegments } from '../../shared/lib/book-skill-segmentation';
import { collectSegmentEvidence } from '../../shared/lib/book-skill-evidence';
import { buildSkillDeckFromEvidence } from '../../shared/lib/book-skill-aggregation';
import { evaluateSkillOutputQuality } from '../../shared/lib/quality-gates';

// ---- Skill extraction async job store ----

export type SkillExtractionResult = ReturnType<typeof buildFullFallbackSkillResult>;

export type SkillExtractionJob = {
  status: 'pending' | 'completed' | 'failed';
  createdAt: number;
  result?: SkillExtractionResult;
  error?: string;
};

export const SKILL_EXTRACTION_JOB_TTL_MS = 10 * 60_000;
export const skillExtractionJobs = new Map<string, SkillExtractionJob>();

export function createSkillExtractionJob(task: Promise<SkillExtractionResult>): string {
  const jobId = `skill-extract-${generateId()}`;
  skillExtractionJobs.set(jobId, { status: 'pending', createdAt: Date.now() });

  task
    .then((result) => {
      skillExtractionJobs.set(jobId, { status: 'completed', createdAt: Date.now(), result });
    })
    .catch((error) => {
      skillExtractionJobs.set(jobId, {
        status: 'failed',
        createdAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      });
    });

  const timer = setTimeout(() => skillExtractionJobs.delete(jobId), SKILL_EXTRACTION_JOB_TTL_MS);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  return jobId;
}

// ---- Fallback skill extraction helper ----

export function buildFallbackSkillForSegment(
  excerpt: string,
  label: string
): Omit<Skill, 'id' | 'createdAt' | 'version'> {
  const normalized = String(excerpt || '').replace(/\s+/g, ' ').trim();
  const sample = normalized.slice(0, 120);
  const hasDialogue = /["""']|说|问|答|喊|低声/.test(normalized);
  const hasAction = /推|走|看|握|拔|冲|落|响|停|转|退|杀|打/.test(normalized);
  const hasWorld = /城|门|宗|派|令|法|阵|灵|江湖|王朝|学院|系统|异能/.test(normalized);

  return {
    name: `${label}保底拆书卡`,
    description: '模型响应不稳定时由本地文本信号生成的保底技能卡，用于保证拆书流程可继续。',
    style: `文本呈现出${hasAction ? '动作驱动' : '叙述驱动'}的段落推进方式，画面通常围绕具体物件、声音或人物反应展开。证据：${sample}`,
    pacing: hasAction
      ? '节奏偏紧，依靠动作、异响和场面变化推动读者继续阅读。'
      : '节奏偏稳，更多依靠铺垫、说明和氛围递进形成阅读惯性。',
    characterTraits: hasDialogue
      ? '人物关系通过对话、停顿和反应显影，适合提炼成试探式互动模板。'
      : '人物塑造更依赖动作选择和环境反应，适合做沉默型角色行动模板。',
    worldBuilding: hasWorld
      ? '文本中存在较强设定词和世界规则信号，需要在生成时保留名词、势力和规则边界。'
      : '世界观信号较弱，生成时应优先补足地点、规则和冲突背景。',
    plotPattern: '常见推进模式是先给异常信号，再通过人物动作或信息差放大冲突，最后留下下一步悬念。',
    foreshadowing: '适合使用物件、声音、眼神和未解释的异常作为伏笔锚点。',
    corePatterns: ['异常入场', '动作试探', '信息差推进', '悬念收束'],
    bannedElements: ['空泛解释', '直接喊出主角目的', '只写氛围不兑现动作'],
    vocabulary: Array.from(new Set((normalized.match(/[\u4e00-\u9fa5]{2,4}/g) || []).slice(0, 12))),
    fewShots: [normalized.slice(0, 120)].filter(Boolean),
    stabilityScore: 62,
    evaluationFeedback: '这是保底萃取结果，建议后续在模型稳定时重新拆书以获得更精确的风格卡。',
    compositionProfile: {
      styleWeight: 0.72,
      characterWeight: hasDialogue ? 0.7 : 0.45,
      worldWeight: hasWorld ? 0.72 : 0.4,
      powerWeight: hasWorld ? 0.55 : 0.35,
      plotWeight: 0.68,
      pacingWeight: hasAction ? 0.76 : 0.5,
      conflictTags: [],
      blendHints: [],
    },
  };
}

// ---- Helper: build a full fallback skill deck from all segments (no model calls) ----

export function buildFullFallbackSkillResult(text: string) {
  const segments = buildBookEvidenceSegments(text.substring(0, 120000));
  if (segments.length === 0) {
    throw new Error('text is too short to analyze');
  }

  const segmentEvidence: SegmentSkillEvidence[] = [];
  const failedSegments: string[] = [];

  for (const segment of segments) {
    const fallbackEvidence = collectSegmentEvidence(
      [buildFallbackSkillForSegment(segment.excerpt, segment.label)],
      segment.stage,
    );
    if (fallbackEvidence) {
      segmentEvidence.push(fallbackEvidence);
      failedSegments.push(`${segment.label}(保底萃取)`);
    }
  }

  if (segmentEvidence.length === 0) {
    throw new Error('所有段落保底萃取均未产出有效证据，请上传更长或更有风格辨识度的文本。');
  }

  const deck = buildSkillDeckFromEvidence(segmentEvidence);
  const skills = [deck.mainCard, ...deck.supportCards].map((skill, index) => ({
    ...skill,
    id: skill.id || `deck-skill-${index + 1}`,
    version: skill.version || 1,
  }));

  const qualityReport = evaluateSkillOutputQuality(
    skills as Array<Record<string, unknown>>,
    text.substring(0, 8000),
  );

  const warnings: string[] = [
    `全部段落使用本地保底萃取：${failedSegments.join('、')}`,
  ];
  if (!qualityReport.passed) {
    warnings.push(
      `输出质量门禁未通过：${qualityReport.issue}。AI 深度分析完成后可能会改善。`,
    );
  }

  return {
    skills,
    deck,
    segments: segments.map((s) => ({ id: s.id, stage: s.stage, label: s.label })),
    warnings,
    quality: {
      passed: qualityReport.passed,
      anchoringScore: qualityReport.anchoringScore,
      genericSkillCount: qualityReport.genericSkillCount,
      totalSkillCount: qualityReport.totalSkillCount,
      genericDetails: qualityReport.genericDetails,
      fieldCompleteness: qualityReport.fieldCompleteness,
      issue: qualityReport.issue,
    },
  };
}
