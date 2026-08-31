import type { Express, Request, Response } from 'express';
import type { Skill } from '../../shared/types';
import { governedGenerateText as generateText } from '../helpers/governed-llm';
import { getConfig } from '../lib/config';
import { resolvePromptAssetForSurface } from '../../shared/lib/prompt-runtime';
import {
  AUDIT_OUTPUT_CONTRACT,
  auditCoversResidueSnippets,
  buildAuditResidueContract,
  buildAuditWindow,
  renderPromptTemplate,
  truncateForAudit,
} from '../helpers/prompt-helpers';
import { rateLimit } from '../middleware/rate-limit';
import { logger } from '../logger';
import { scoreSlop, slopSummary } from '../../shared/lib/slop-scorer';
import { buildSlopContextRewritePrompt } from '../../shared/lib/slop-rewriter';
import {
  convertFiveDimToStructured,
  diagnoseAuditContract,
  embedStructuredAudit,
  evaluateAuditGate,
  parseAuditResponseWithDiagnostics,
  renderFiveDimMarkdown,
  renderStructuredAuditMarkdown,
} from '../../shared/lib/audit-structured';
import { buildRewritePrompt } from '../../shared/lib/rewrite-prompt';
import {
  reserveQuota,
  refundQuota,
  commitQuotaReservation,
  quotaFailureHttpStatus,
} from '../helpers/quota-guard.js';
import { isStreamDisconnected } from '../helpers/stream-disconnect.js';
import * as db from '../lib/db.js';
import { inferNovelGovernanceProfile, getActiveDimensionSignals } from '../../shared/lib/prompt-assets-governed.js';
import { getDatabaseGeneration } from '../lib/db-instance.js';
import { computeChapterWorkflowHash } from '../../shared/lib/chapter-workflow.js';
import {
  requireWritingStyleConfirmation,
  resolveWritingStyleRequest,
  WritingStyleRequestError,
  type ResolvedWritingStyleRequest,
} from '../helpers/writing-style-service.js';
import { buildServerStoryContextWithSemantic } from '../helpers/story-context.js';
import { validate, rewriteSchema } from '../validation';

const GENERIC_CLIENT_ERROR = 'Internal server error';

// ---- In-memory audit job store ----
type AuditJobStatus = 'pending' | 'running' | 'completed' | 'failed';

interface AuditJob {
  id: string;
  status: AuditJobStatus;
  progress: number;
  stageText?: string;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: number;
  databaseGeneration: number;
}

const auditJobs = new Map<string, AuditJob>();
const auditJobAbortControllers = new Map<string, AbortController>();
const JOB_TTL = 15 * 60 * 1000;

function pruneAuditJobs(): void {
  const now = Date.now();
  for (const [id, job] of auditJobs.entries()) {
    if (now - job.createdAt > JOB_TTL) {
      auditJobAbortControllers.get(id)?.abort(new Error('审稿任务已过期，请重新提交。'));
      auditJobAbortControllers.delete(id);
      auditJobs.delete(id);
    }
  }
}

setInterval(pruneAuditJobs, 60 * 1000).unref();

function createAuditJob(controller: AbortController, databaseGeneration: number): string {
  pruneAuditJobs();
  const id = 'audit_' + Math.random().toString(36).substring(2, 15);
  auditJobs.set(id, {
    id,
    status: 'pending',
    progress: 5,
    stageText: '已提交审稿任务，等待总编接单…',
    createdAt: Date.now(),
    databaseGeneration,
  });
  auditJobAbortControllers.set(id, controller);
  return id;
}

function updateAuditJob(id: string, updates: Partial<Omit<AuditJob, 'id' | 'createdAt'>>): void {
  const job = auditJobs.get(id);
  if (job) {
    Object.assign(job, updates);
    if (updates.status === 'completed' || updates.status === 'failed') {
      auditJobAbortControllers.delete(id);
    }
  }
}

function failAuditJob(jobId: string, reservationId: string | undefined, logMessage: string): void {
  logger.error(logMessage);
  void refundQuota(reservationId);
  updateAuditJob(jobId, {
    status: 'failed',
    progress: 100,
    error: GENERIC_CLIENT_ERROR,
  });
}

interface AuditRequestBody {
  draftContent: string;
  sceneBeats: string;
  contextStr: string;
  skills?: Skill[];
  surface?: string;
  novelId: string;
  chapterOrder?: number;
  continuationPackId?: string;
  sessionCardIds?: string[];
  chapterId: string;
  databaseGeneration: number;
  writingStyleFingerprint?: string;
  reviewIssueIds?: string[];
  reviewScope?: 'affected' | 'full';
  reviewContentHash?: string;
}

function validateReviewRequest(body: AuditRequestBody): string | undefined {
  if (body.reviewIssueIds !== undefined && (body.reviewIssueIds.length > 200 || body.reviewIssueIds.some((id) => typeof id !== 'string' || !id.trim()))) return 'invalid reviewIssueIds';
  if (body.reviewScope !== undefined && !['affected', 'full'].includes(body.reviewScope)) return 'invalid reviewScope';
  if (body.reviewContentHash !== undefined && (!/^[a-f0-9]{64}$/.test(body.reviewContentHash) || body.reviewContentHash !== computeChapterWorkflowHash(body.draftContent || '', body.sceneBeats || ''))) return 'reviewContentHash mismatch';
  return undefined;
}

function formatAuditSkillsInfo(skillsInfo: string | undefined): string {
  const normalized = String(skillsInfo || '').trim();
  if (!normalized) return '';
  if (normalized.length <= 900) return normalized;

  const techniqueBlocks = [...normalized.matchAll(/(?:^|\n\n)(【(?:阶段技法|系统护栏)：[^\n]+】\n[\s\S]*?)(?=\n\n【(?:阶段技法|系统护栏)：|$)/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  if (techniqueBlocks.length === 0) return truncateForAudit(normalized, 900);

  const techniqueHeaders = techniqueBlocks.map((block) => block.split('\n', 1)[0].trim());
  const headerText = techniqueHeaders.join('\n\n');
  const techniqueBodyBudget = Math.max(0, 600 - headerText.length - Math.max(0, techniqueHeaders.length - 1) * 2);
  const bodyBudgetPerBlock = techniqueBlocks.length > 0
    ? Math.floor(techniqueBodyBudget / techniqueBlocks.length)
    : 0;
  const techniqueInfo = techniqueBlocks.map((block, index) => {
    const header = techniqueHeaders[index];
    const body = block.slice(header.length).trim();
    if (!body || bodyBudgetPerBlock <= 0) return header;
    const allocation = index === techniqueBlocks.length - 1
      ? techniqueBodyBudget - bodyBudgetPerBlock * (techniqueBlocks.length - 1)
      : bodyBudgetPerBlock;
    return [header, truncateAuditRules(body, allocation)].filter(Boolean).join('\n');
  }).join('\n\n');
  const withoutTechniqueBlocks = techniqueBlocks.reduce(
    (text, block) => text.replace(block, '').replace(/\n{3,}/g, '\n\n').trim(),
    normalized,
  );
  const remainingBudget = Math.max(300, 900 - techniqueInfo.length - 2);
  return [
    truncateAuditRules(techniqueInfo, 600),
    truncateAuditRules(withoutTechniqueBlocks, remainingBudget),
  ].filter(Boolean).join('\n\n');
}

function truncateAuditRules(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const lines = value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const line of lines) {
    const next = kept.concat(line).join('\n');
    if (next.length > maxChars) break;
    kept.push(line);
  }
  return kept.join('\n');
}

async function runAuditJob(
  jobId: string,
  body: AuditRequestBody,
  reservationId: string | undefined,
  writingStyle: ResolvedWritingStyleRequest,
  signal?: AbortSignal,
): Promise<void> {
  updateAuditJob(jobId, {
    status: 'running',
    progress: 20,
    stageText: '总编正在逐段扫描机械感、节奏和人设一致性…',
  });

  try {
    const {
      draftContent,
      sceneBeats,
      contextStr,
      surface = 'chapter-polish',
      chapterOrder,
      novelId,
    } = body;

    const skillsInfo = writingStyle.executionSnapshot.stagePrompts.critic;

    const trimmedContextStr = truncateForAudit(await buildServerStoryContextWithSemantic({
      novelId,
      chapterId: body.chapterId,
      clientContext: contextStr,
    }), 8_400);
    const trimmedSceneBeats = truncateForAudit(sceneBeats, 1400);
    const trimmedDraftContent = buildAuditWindow(draftContent, 7800);
    const trimmedSkillsInfo = formatAuditSkillsInfo(skillsInfo);

    let reviewScopePrompt = '';
    if (body.reviewScope === 'affected') {
      const chapter = db.getChapter(body.chapterId);
      const selectedIds = new Set(body.reviewIssueIds || []);
      const selectedIssues = (chapter?.workflowMeta?.reviewState?.issues || []).filter((issue) => selectedIds.has(issue.id));
      reviewScopePrompt = selectedIssues.length > 0
        ? `\n\n### 复审范围\n这是一次“修正并复审”，只复核以下已处理问题及直接受影响维度，不要把未受影响的普通建议重新判为失败：\n${selectedIssues.map((issue) => `- ${issue.category || issue.issueType || 'general'}：${issue.explanation}`).join('\n')}`
        : '\n\n### 复审范围\n这是一次局部修正复审；仅检查修正可能影响的局部逻辑、场景执行、节奏和文风，不扩大为新的全章问题清单。';
    }

    const slopReport = draftContent ? scoreSlop(draftContent) : null;
    const structuralSignals = slopReport?.hits.filter((hit) => hit.category === 'structural') || [];
    const structuralRewritePrompt = structuralSignals.length > 0
      ? `\n\n## 结构精修上下文要求\n以下每项均为局部证据窗口；不得扩展为整章重写或输出日志。\n${structuralSignals.map((hit) => {
        const start = Math.max(0, hit.range?.start ?? draftContent.indexOf(hit.snippet));
        const end = Math.min(draftContent.length, hit.range?.end ?? (start + hit.snippet.length));
        const targetStart = Math.min(start, Math.max(0, end - 600));
        const targetEnd = Math.min(draftContent.length, Math.max(targetStart, Math.min(end, targetStart + 600)));
        return buildSlopContextRewritePrompt({
          targetText: draftContent.slice(targetStart, targetEnd) || hit.snippet.slice(0, 600),
          beforeContext: draftContent.slice(Math.max(0, targetStart - 300), targetStart),
          afterContext: draftContent.slice(targetEnd, Math.min(draftContent.length, targetEnd + 300)),
          issue: hit.suggestion || hit.signal || '结构同构',
          chapterContext: trimmedContextStr,
          sceneBeats: trimmedSceneBeats,
        });
      }).join('\n\n')}`
      : '';

    const promptAsset = resolvePromptAssetForSurface({
      surface: surface as Parameters<typeof resolvePromptAssetForSurface>[0]['surface'],
      promptTemplates: getConfig().promptTemplates,
      preferredTemplateKey: 'manualAudit',
    });
    const prompt = renderPromptTemplate(promptAsset.template, {
      contextStr: trimmedContextStr,
      skillsInfo: trimmedSkillsInfo,
      sceneBeats: trimmedSceneBeats,
      draftContent: trimmedDraftContent,
    });

    let openingDiagnosticsPrompt = '';
    if (chapterOrder && Number(chapterOrder) <= 10) {
      let isCommercial = false;
      if (novelId) {
        const novel = db.getNovel(novelId);
        if (novel) {
          const gov = inferNovelGovernanceProfile(novel);
          const tagsAndTitle = [
            novel.title || '',
            novel.summary || '',
            ...(novel.projectPreferenceProfile?.tags || []),
          ].join('\n').toLowerCase();
          isCommercial = gov.commercialMode === 'strict' ||
            /番茄|tomato|商业|爽文|新锐|无线/.test(tagsAndTitle);
        }
      }

      const platformTypeLabel = isCommercial
        ? '【番茄/商业爽文平台级审核 (Tomato/Commercial Smart Review)】'
        : '【严肃/精品文学深度健康审查 (Literary/Health Deep Review)】';

      const platformSpecificChecklist = isCommercial
        ? `- **黄金节奏门槛**：冲突爆发必须在开头 2000 字内，反派降智感要用“阶级矛盾/立场利益”合理包装，爽点与情绪发泄要快。
- **金手指极致展现**：金手指（挂/系统/独特挂）必须能带来立竿见影的爽感，严禁在前三章内吃瘪或被配角过分压制。
- **期待感爆发**：在结尾留出极其明确的钩子，给读者拉满下一章必须看的预期。`
        : `- **世界观切面深铺垫**：拒绝套路化、快餐式冲突，通过环境、细节和人物行动侧面勾勒世界质感与规则。
- **人物心理细腻度**：审视主角的内在矛盾和成长空间，拒绝无脑平面化角色。
- **叙事张力与留白**：避免过于密集的直白爽点，保留叙事张力和美学价值。`;

      openingDiagnosticsPrompt = `

### 🚨 黄金前十章深度审读规约 (Opening Chapter Diagnostics: Ch 1-10)
当前章节为第 ${chapterOrder} 章，触发黄金开篇质量评估大门。请总编在审稿时**额外且强制**输出以下评估维度：

【执行模式】：${platformTypeLabel}
【核心评估清单】：
1. **主角驱动力 (Protagonist Drive)**：评估主角的目标是否极其清晰、迫切。主角是否在主动推进剧情，而非被动受虐或随波逐流？
2. **抓人眼眼球的钩子 (Story Hook)**：评估本章开头是否具备立刻拉住读者的张力。世界观切面是否自然展开，拒绝大段干瘪设定硬塞 (Info-dumping)？
3. **金手指局限与反噬 (Cheat Limits & Costs)**：主角若有关键特殊能力（金手指/挂），是否交代了其基础限制、反噬或使用代价？确保有合理的成长阻力，避免战力系统和趣味性崩塌。
4. **反转与核心爆点 (Plot Twists)**：本章内是否存在符合逻辑的情理之中、意料之外的冲突起伏或认知反转？
5. **下一章预期 (Anticipation & Cliffhanger)**：是否在结尾埋下诱人的伏笔或新悬念，牢牢揪住读者的好奇心？

【平台特定校验要求】：
${platformSpecificChecklist}
`;
    }

    let extraDimensionPrompt = '';
    if (novelId) {
      const novel = db.getNovel(novelId);
      if (novel) {
        const signals = getActiveDimensionSignals(novel);
        if (signals.extraAuditChecks.length > 0) {
          extraDimensionPrompt = `\n\n### 🚨 自适应维度追加审读规约 (Adaptive Dimension Review Checklist)\n基于当前小说的具体属性与特征，系统自适应启用了以下高级审读维度，请总编额外进行排查诊断：\n${signals.extraAuditChecks.map((check, index) => `${index + 1}. ${check}`).join('\n')}\n`;
        }
      }
    }

    updateAuditJob(jobId, { progress: 45, stageText: '总编正在深度审读正文与分镜…' });

    const evidenceContract = `

### 结构化证据契约
在 JSON 顶层返回 evidence 数组；每项必须包含 category（仅 hard_canon、character_state、scene_execution、pacing、foreshadowing）、severity（low/medium/high）、quote（正文原文，无法引用则不要输出该项）、explanation、suggestedFix，可选 location。缺字段或未知 category 的证据会被丢弃。`;
    const auditTraceId = `audit_${jobId}`;
    let transportMode: 'json_object' | 'plain_fallback' | 'none' = 'json_object';
    const rawFeedback = await generateText(getConfig(), {
      prompt: prompt + buildAuditResidueContract(draftContent) + openingDiagnosticsPrompt + extraDimensionPrompt + reviewScopePrompt + structuralRewritePrompt + evidenceContract + AUDIT_OUTPUT_CONTRACT,
      novelId,
      disableThinking: true,
      outputMode: 'audit-json',
      responseMimeType: 'application/json',
      traceId: auditTraceId,
      onComplete: (metadata) => {
        transportMode = metadata.outputDiagnostic.responseFormatMode;
      },
    }, {
      operation: 'audit-job',
      novelId,
      timeoutMs: 90_000,
      concurrency: 2,
      signal,
    });

    if (!rawFeedback || !rawFeedback.trim()) {
      failAuditJob(jobId, reservationId, 'Audit returned empty feedback');
      return;
    }

    updateAuditJob(jobId, { progress: 85, stageText: '正在整理审稿报告…' });

    const parsedResponse = parseAuditResponseWithDiagnostics(rawFeedback);
    const fiveDim = parsedResponse.fiveDim;
    if (fiveDim && fiveDim.scores && typeof fiveDim.scores === 'object') {
      const gate = evaluateAuditGate(
        Object.fromEntries(Object.entries(fiveDim.scores).map(([k, v]) => [k, (v as { score: number }).score])),
        (fiveDim.fatalIssues || []) as Array<{ dimension?: string; severity?: string }>,
      );

      let slopFeedback = '';
      if (slopReport) {
        const warningsText = slopReport.hits.length > 0
          ? slopReport.hits.map(h => `- [${h.category}] 行 ${h.line}: ${h.suggestion || h.snippet}`).join('\n')
          : '- 未检测到明显的机械腔调或套话。';
        slopFeedback = `\n\n## 机械审查反馈\n${slopSummary(slopReport)}\n${warningsText}`;
      }

      const structured = convertFiveDimToStructured(fiveDim);
      const contract = diagnoseAuditContract(rawFeedback, 'five-dim');
      const residueCovered = auditCoversResidueSnippets(draftContent, structured.fatalIssues);
      if (!contract.valid || !residueCovered) {
        commitQuotaReservation(reservationId);
        updateAuditJob(jobId, {
          status: 'completed',
          progress: 100,
          stageText: '审稿完成，但结构化契约无法确认',
          result: {
            status: 'unknown',
            errorCategory: contract.violation || (residueCovered ? 'invalid_json' : 'missing_fatal_issues'),
            diagnostic: residueCovered ? '审稿 JSON 未通过结构化合同校验' : '正文残留未被 fatalIssues 覆盖',
            retriable: true,
            traceId: auditTraceId,
            transport: transportMode,
          },
        });
        return;
      }
      const baseFeedback = renderFiveDimMarkdown(fiveDim);
      const feedbackWithSlop = slopFeedback ? `${baseFeedback}${slopFeedback}` : baseFeedback;
      const feedback = embedStructuredAudit(feedbackWithSlop, structured);

      commitQuotaReservation(reservationId);
      const auditResult = {
        feedback,
        score: structured.score,
        status: gate.pass ? 'pass' : 'fail',
        pass: gate.pass,
        failReason: gate.blockReason || fiveDim.failReason || null,
        scores: fiveDim.scores,
        evidence: structured.evidence || [],
        gate,
        slopWarnings: slopReport ? slopReport.hits : [],
        slopSummary: slopReport ? slopSummary(slopReport) : null,
        slopScore: slopReport?.score ?? null,
        slopStructureSignals: structuralSignals,
        slopQualityMode: 'deterministic',
        transport: transportMode,
        contextRewriteStatus: structuralSignals.some((hit) => hit.priority === 'P1') ? 'required' : 'not-required',
      };
      updateAuditJob(jobId, {
        status: 'completed',
        progress: 100,
        stageText: '审稿完成',
        result: auditResult,
      });
      return;
    }

    const structured = parsedResponse.structured;
    if (!structured) {
      commitQuotaReservation(reservationId);
      updateAuditJob(jobId, {
        status: 'completed',
        progress: 100,
        stageText: '审稿完成，但结果未确认',
        result: {
          status: 'unknown',
          errorCategory: parsedResponse.diagnostic?.code || 'invalid_json',
          diagnostic: parsedResponse.diagnostic?.summary || '审稿 JSON 无法确认',
          retriable: true,
          traceId: auditTraceId,
          transport: transportMode,
        },
      });
      return;
    }

    const contract = diagnoseAuditContract(rawFeedback, 'structured');
    const residueCovered = auditCoversResidueSnippets(draftContent, structured.fatalIssues);
    if (!contract.valid || !residueCovered) {
      commitQuotaReservation(reservationId);
      updateAuditJob(jobId, {
        status: 'completed',
        progress: 100,
        stageText: '审稿完成，但结构化契约无法确认',
        result: {
          status: 'unknown',
          errorCategory: contract.violation || (residueCovered ? 'invalid_json' : 'missing_fatal_issues'),
          diagnostic: residueCovered ? '审稿 JSON 未通过结构化合同校验' : '正文残留未被 fatalIssues 覆盖',
          retriable: true,
          traceId: auditTraceId,
          transport: transportMode,
        },
      });
      return;
    }

    const feedback = embedStructuredAudit(renderStructuredAuditMarkdown(structured), structured);
    const hasCriticalIssue = structured.fatalIssues.some((issue) => issue.severity === 'critical');
    const qualityPass = structured.score >= 60 && !hasCriticalIssue;
    commitQuotaReservation(reservationId);
    const auditResult = { feedback, score: structured.score, status: qualityPass ? 'pass' : 'fail', pass: qualityPass, structured, evidence: structured.evidence || [], transport: transportMode };
    updateAuditJob(jobId, {
      status: 'completed',
      progress: 100,
      stageText: '审稿完成',
      result: auditResult,
    });
  } catch (e) {
    failAuditJob(jobId, reservationId, String(e));
  }
}

function attachStreamAbortGuard(
  req: Request,
  res: Response,
  controller: AbortController,
  onAbort: () => void,
): () => void {
  let handled = false;
  const handleAbort = () => {
    if (handled) return;
    handled = true;
    controller.abort();
    onAbort();
  };

  req.on('aborted', handleAbort);

  const interval = setInterval(() => {
    if (isStreamDisconnected(req, res)) {
      clearInterval(interval);
      handleAbort();
    }
  }, 250);
  interval.unref();

  res.on('close', () => {
    clearInterval(interval);
    if (!res.writableEnded) {
      handleAbort();
    }
  });

  return () => {
    clearInterval(interval);
    req.off('aborted', handleAbort);
  };
}

export function registerAuditRoutes(app: Express) {
  app.get('/api/audit/jobs/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = auditJobs.get(jobId);
    if (!job) {
      return res.status(404).json({ error: '审稿任务不存在或已过期，请重新提交。' });
    }
    const requestedGeneration = Number(req.query.databaseGeneration);
    if (!Number.isInteger(requestedGeneration) || requestedGeneration !== job.databaseGeneration) {
      return res.status(409).json({ error: '审稿任务状态已过期，请重新提交。' });
    }
    if (job.databaseGeneration !== getDatabaseGeneration()) {
      auditJobAbortControllers.get(jobId)?.abort(new Error('数据库已在审稿任务期间切换。'));
      updateAuditJob(jobId, { status: 'failed', progress: 100, error: GENERIC_CLIENT_ERROR });
      return res.status(409).json({ error: '数据库已在审稿任务期间切换，请重新审稿。' });
    }
    res.json(job);
  });

  app.post('/api/audit/jobs/:jobId/cancel', (req, res) => {
    const job = auditJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: '审稿任务不存在或已过期，请重新提交。' });
    const requestedGeneration = Number(req.query.databaseGeneration);
    if (!Number.isInteger(requestedGeneration) || requestedGeneration !== job.databaseGeneration) {
      return res.status(409).json({ error: '审稿任务状态已过期，请重新提交。' });
    }
    const controller = auditJobAbortControllers.get(req.params.jobId);
    if (!controller || job.status === 'completed' || job.status === 'failed') {
      return res.status(409).json({ error: '当前审稿任务不能取消。' });
    }
    controller.abort(new Error('审稿任务已取消。'));
    updateAuditJob(req.params.jobId, { status: 'failed', progress: 100, error: '审稿任务已取消。' });
    return res.json({ cancelled: true });
  });

  app.post('/api/audit', async (req, res) => {
    if (!rateLimit('audit')) return res.status(429).json({ error: '审稿请求过于频繁，请稍后再试。', retryAfter: 5 });
    const { novelId } = req.body;
    if (typeof novelId !== 'string' || !novelId.trim()) {
      return res.status(400).json({ error: '请先选择作品，再发起审稿。' });
    }

    const requestedGeneration = req.body.databaseGeneration;
    if (typeof req.body.chapterId !== 'string' || !req.body.chapterId.trim() || !Number.isInteger(requestedGeneration) || requestedGeneration < 0) {
      return res.status(400).json({ code: 'SCOPED_CONTEXT_REQUIRED', error: '请先选择章节并刷新写作上下文。' });
    }
    if (requestedGeneration !== getDatabaseGeneration()) {
      return res.status(409).json({ code: 'DATABASE_GENERATION_MISMATCH', error: '数据库已变化，请刷新后重试' });
    }
    const reviewError = validateReviewRequest(req.body as AuditRequestBody);
    if (reviewError) return res.status(400).json({ code: 'INVALID_REVIEW_REQUEST', error: reviewError });

    let writingStyle;
    try {
      writingStyle = resolveWritingStyleRequest(novelId, {
        chapterId: req.body.chapterId,
        databaseGeneration: requestedGeneration,
        continuationPackId: req.body.continuationPackId,
        sessionCardIds: req.body.sessionCardIds,
      });
      requireWritingStyleConfirmation(writingStyle, req.body.styleConfirmationFingerprint ?? req.body.writingStyleFingerprint);
    } catch (error) {
      if (error instanceof WritingStyleRequestError) {
        return res.status(error.status).json({
          code: error.code,
          error: error.message,
          ...(writingStyle ? { resolution: writingStyle.resolution, candidates: writingStyle.candidates } : {}),
        });
      }
      throw error;
    }

    const reserve = await reserveQuota(novelId, 'advancedAudit');
    if (!reserve.allowed) {
      return res.status(quotaFailureHttpStatus(reserve)).json({
        quotaExceeded: true,
        limitType: 'advancedAudit',
        count: reserve.count,
        max: reserve.max,
        error: reserve.error,
      });
    }

    const databaseGeneration = requestedGeneration;
    if (databaseGeneration !== getDatabaseGeneration() || (reserve.databaseGeneration !== undefined && reserve.databaseGeneration !== databaseGeneration)) {
      await refundQuota(reserve.reservationId);
      return res.status(409).json({ error: '数据库已在审稿准备期间切换，请重新审稿。' });
    }
    const jobController = new AbortController();
    const jobId = createAuditJob(jobController, databaseGeneration);
    void runAuditJob(jobId, req.body as AuditRequestBody, reserve.reservationId, writingStyle, jobController.signal);
    res.json({ jobId, databaseGeneration });
  });

  app.post('/api/rewrite', validate(rewriteSchema), async (req, res) => {
    if (!rateLimit('rewrite')) {
      return res.status(429).json({ error: '精修请求过于频繁，请稍后再试。', retryAfter: 5 });
    }
    const {
      text,
      instruction,
      contextStr,
      auditFeedback = '',
      sceneBeats = '',
      mode = 'selection',
      beforeContext = '',
      afterContext = '',
      auditIssue = '',
      novelId,
      continuationPackId,
      sessionCardIds,
      styleConfirmationFingerprint,
      writingStyleFingerprint,
      chapterId,
      databaseGeneration: requestedDatabaseGeneration,
    } = req.body;
    if (typeof novelId !== 'string' || !novelId.trim()) {
      return res.status(400).json({ error: '请先选择作品，再发起精修。' });
    }
    if (typeof chapterId !== 'string' || !chapterId.trim() || !Number.isInteger(requestedDatabaseGeneration) || requestedDatabaseGeneration < 0) {
      return res.status(400).json({ code: 'SCOPED_CONTEXT_REQUIRED', error: '请先选择章节并刷新写作上下文。' });
    }
    if (requestedDatabaseGeneration !== getDatabaseGeneration()) {
      return res.status(409).json({ code: 'DATABASE_GENERATION_MISMATCH', error: '数据库已变化，请刷新后重试' });
    }

    let writingStyle;
    try {
      writingStyle = resolveWritingStyleRequest(novelId, { chapterId, databaseGeneration: requestedDatabaseGeneration, continuationPackId, sessionCardIds });
      requireWritingStyleConfirmation(writingStyle, styleConfirmationFingerprint ?? writingStyleFingerprint);
    } catch (error) {
      if (error instanceof WritingStyleRequestError) {
        return res.status(error.status).json({ code: error.code, error: error.message, ...(writingStyle ? { resolution: writingStyle.resolution, candidates: writingStyle.candidates } : {}) });
      }
      throw error;
    }

    const reserve = await reserveQuota(novelId, 'advancedAudit');
    if (!reserve.allowed) {
      return res.status(quotaFailureHttpStatus(reserve)).json({
        quotaExceeded: true,
        limitType: 'advancedAudit',
        count: reserve.count,
        max: reserve.max,
        error: reserve.error,
      });
    }

    const reservationId = reserve.reservationId;
    const databaseGeneration = requestedDatabaseGeneration;
    if (databaseGeneration !== getDatabaseGeneration() || (reserve.databaseGeneration !== undefined && reserve.databaseGeneration !== databaseGeneration)) {
      await refundQuota(reservationId);
      return res.status(409).json({ error: '数据库已在精修准备期间切换，请重新精修。' });
    }
    let completed = false;
    const controller = new AbortController();

    const clearGuard = attachStreamAbortGuard(req, res, controller, () => {
      if (!completed) {
        void refundQuota(reservationId);
      }
    });

    try {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-InkFlow-Database-Generation', String(databaseGeneration));
      req.socket.setTimeout(0);
      res.flushHeaders();
      res.write(`data: ${JSON.stringify({ type: 'status', status: 'running', message: '正在生成精修预览…' })}\n\n`);

      const skillsInfo = writingStyle.executionSnapshot.stagePrompts.writer;
      const resolvedContextStr = await buildServerStoryContextWithSemantic({
        novelId,
        chapterId,
        clientContext: contextStr,
      });

      const prompt = buildRewritePrompt({
        text,
        instruction,
        contextStr: resolvedContextStr,
        auditFeedback,
        sceneBeats,
        mode,
        beforeContext,
        afterContext,
        auditIssue,
        skillsInfo,
      });

      let accumulated = '';
      await generateText(getConfig(), {
        prompt,
        signal: controller.signal,
        onToken: (token) => {
          if (databaseGeneration !== getDatabaseGeneration()) {
            controller.abort(new Error('数据库已在精修期间切换。'));
            return;
          }
          if (isStreamDisconnected(req, res)) {
            controller.abort();
            return;
          }
          accumulated += token;
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        },
      }, {
        operation: 'rewrite',
        novelId,
        timeoutMs: 90_000,
        concurrency: 2,
        signal: controller.signal,
      });

      if (databaseGeneration !== getDatabaseGeneration() || isStreamDisconnected(req, res)) {
        await refundQuota(reservationId);
        return;
      }

      if (!accumulated.trim()) {
        await refundQuota(reservationId);
        res.write(`data: ${JSON.stringify({ error: GENERIC_CLIENT_ERROR })}\n\n`);
        res.end();
        return;
      }

      completed = true;
      commitQuotaReservation(reservationId);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (e) {
      logger.error(String(e));
      if (!completed) {
        await refundQuota(reservationId);
      }
      if (!res.headersSent) {
        res.status(500);
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
      }
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: GENERIC_CLIENT_ERROR, code: 'REWRITE_FAILED', retriable: true })}\n\n`);
        res.end();
      }
    } finally {
      clearGuard();
    }
  });
}

/** @internal Test-only helpers */
export const __auditTestHooks = {
  auditJobs,
  pruneAuditJobs,
  runAuditJob,
};
