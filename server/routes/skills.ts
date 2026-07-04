import type { Express } from 'express';
import { generateText } from '../lib/server-llm';
import { getConfig } from '../lib/config';
import { renderPromptTemplate, getPromptTemplate, wrapUserInput } from '../helpers/prompt-helpers';
import { rateLimit } from '../middleware/rate-limit';
import { logger } from '../logger';
import { withTimeout } from '../helpers/async-utils';
import {
  skillExtractionJobs,
  createSkillExtractionJob,
  buildFallbackSkillForSegment,
  buildFullFallbackSkillResult,
} from '../helpers/skill-extraction';
import { extractJsonPayload } from '../../shared/lib/extract-skill-json';
import {
  validateExtractSkillInput,
  parseModelRefusal,
  evaluateSkillOutputQuality,
} from '../../shared/lib/quality-gates';
import { buildBookEvidenceSegments } from '../../shared/lib/book-skill-segmentation';
import { buildSkillDeckFromEvidence } from '../../shared/lib/book-skill-aggregation';
import { collectSegmentEvidence } from '../../shared/lib/book-skill-evidence';
import type { SegmentSkillEvidence } from '../../shared/types';
import { validate, extractSkillSchema } from '../validation';
import { checkQuota, consumeQuota } from '../helpers/quota-guard.js';

const SKILL_EXTRACTION_LLM_OPTIONS = {
  timeoutMs: 35_000,
  maxAttempts: 1,
  maxTokens: 2048,
} as const;

async function processModelSkillExtraction(
  text: string,
  segments: ReturnType<typeof buildBookEvidenceSegments>,
) {
  const totalSegments = segments.length;
  const maxModelSegments = Math.min(6, totalSegments);
  const modelSegments: typeof segments = [];

  if (totalSegments <= maxModelSegments) {
    modelSegments.push(...segments);
  } else {
    for (let i = 0; i < maxModelSegments; i++) {
      const index = Math.floor((i * totalSegments) / maxModelSegments);
      modelSegments.push(segments[index]);
    }
  }

  const modelSegmentLabels = new Set(modelSegments.map(s => s.label));
  const fallbackSegments = segments.filter(s => !modelSegmentLabels.has(s.label));

  const segmentEvidence: SegmentSkillEvidence[] = [];
  const failedSegments: string[] = [];
  const modelRefusals: string[] = [];

  for (const segment of modelSegments) {
    try {
      const prompt = renderPromptTemplate(getPromptTemplate('extractSkill'), {
        text: wrapUserInput(segment.excerpt.substring(0, 12000)),
      });

      const responseText = await withTimeout(
        generateText(getConfig(), {
          prompt,
          ...SKILL_EXTRACTION_LLM_OPTIONS,
        }),
        SKILL_EXTRACTION_LLM_OPTIONS.timeoutMs + 2_000,
        '拆书超时：当前模型响应过慢。建议先缩短样本文本，或稍后重试。',
      );

      const parsed = extractJsonPayload(responseText);
      const refusal = parseModelRefusal(parsed);
      if (refusal) {
        modelRefusals.push(`${segment.label}: ${refusal.reason}`);
        const fallbackEvidence = collectSegmentEvidence(
          [buildFallbackSkillForSegment(segment.excerpt, segment.label)],
          segment.stage,
        );
        if (fallbackEvidence) segmentEvidence.push(fallbackEvidence);
        failedSegments.push(`${segment.label}(模型拒绝-保底萃取)`);
        continue;
      }

      const rawSkills = Array.isArray(parsed?.skills)
        ? parsed.skills
        : Array.isArray(parsed)
          ? parsed
          : [parsed];

      const mergedSegmentEvidence = collectSegmentEvidence(rawSkills, segment.stage);
      if (mergedSegmentEvidence) {
        segmentEvidence.push(mergedSegmentEvidence);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallbackEvidence = collectSegmentEvidence(
        [buildFallbackSkillForSegment(segment.excerpt, segment.label)],
        segment.stage,
      );
      if (fallbackEvidence) segmentEvidence.push(fallbackEvidence);
      failedSegments.push(`${segment.label}(${/timed out|拆书超时/i.test(message) ? '超时保底' : '解析保底'})`);
    }
  }

  // Add fallback segments
  for (const segment of fallbackSegments) {
    const fallbackEvidence = collectSegmentEvidence(
      [buildFallbackSkillForSegment(segment.excerpt, segment.label)],
      segment.stage,
    );
    if (fallbackEvidence) {
      segmentEvidence.push(fallbackEvidence);
      failedSegments.push(`${segment.label}(快速保底)`);
    }
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

  const warnings: string[] = [];
  if (failedSegments.length > 0) {
    warnings.push(`部分段落未使用 AI 深度分析：${failedSegments.join('、')}`);
  }
  if (modelRefusals.length > 0) {
    warnings.push(`模型拒绝析段落：${modelRefusals.join('；')}`);
  }
  if (!qualityReport.passed) {
    warnings.push(
      `输出质量门禁未通过：${qualityReport.issue}。建议上传更长或更有风格辨识度的文本重新拆书。`,
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

export function registerSkillsRoutes(app: Express) {
  app.post('/api/extract-skill', validate(extractSkillSchema), async (req, res) => {
    if (!rateLimit('extract-skill')) return res.status(429).json({ error: 'Rate limited', retryAfter: 5 });
    try {
      const { text = '', novelId } = req.body;

      // ================================================================
      // Layer 0: Quota Gate — verify free-tier limitations before LLM run
      // ================================================================
      const quotaCheck = checkQuota(novelId, 'extractSkill');
      if (!quotaCheck.allowed) {
        return res.status(403).json({
          quotaExceeded: true,
          limitType: 'extractSkill',
          count: quotaCheck.count,
          max: quotaCheck.max,
          error: quotaCheck.error,
        });
      }

      // ================================================================
      // Layer 1: Input Gate — reject garbage before calling the model
      // ================================================================
      const inputGate = validateExtractSkillInput(text);
      if (!inputGate.accepted) {
        return res.status(400).json({
          rejected: true,
          reason: inputGate.rejectedReason,
        });
      }

      // 校验通过，消费 1 次额度 (Consume quota count)
      consumeQuota(novelId, 'extractSkill');

      // ================================================================
      // Phase 1 (fast): Build full fallback deck and return immediately.
      // ================================================================
      const fallbackResult = buildFullFallbackSkillResult(text);

      // ================================================================
      // Phase 2 (background): Fire model extraction as an async job.
      // ================================================================
      const segments = buildBookEvidenceSegments(text.substring(0, 120000));
      const modelTask = processModelSkillExtraction(text, segments);
      const jobId = createSkillExtractionJob(modelTask);

      res.json({
        ...fallbackResult,
        source: 'fallback',
        jobId,
        statusNote: '本地保底萃取已就绪，AI 正在后台深度分析——结果就绪后会自动更新。',
      });
    } catch (e) {
      logger.error(String(e));
      const message = e instanceof Error ? e.message : String(e);
      if (/timed out|拆书超时/i.test(message)) {
        return res.status(504).json({
          error: '拆书超时：当前模型响应过慢。建议先缩短样本文本，或稍后重试。',
        });
      }
      if (/JSON|可解析的 JSON|不完整的 JSON/.test(message)) {
        return res.status(502).json({
          error: '拆书失败：模型返回格式不稳定，暂时未能解析为技能卡。',
        });
      }
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/extract-skill/jobs/:jobId', (req, res) => {
    const job = skillExtractionJobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Skill extraction job not found' });
    }
    if (job.status === 'completed') {
      return res.json({
        status: 'completed',
        source: 'model',
        ...job.result,
      });
    }
    res.json({ status: job.status, error: job.error });
  });
}
