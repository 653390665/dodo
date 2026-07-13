import type { Express, Request, Response } from 'express';
import type { Skill } from '../../shared/types';
import { generateText } from '../lib/server-llm';
import { getConfig } from '../lib/config';
import { resolvePromptAssetForSurface } from '../../shared/lib/prompt-runtime';
import { renderPromptTemplate, truncateForAudit, buildSkillsPrompt } from '../helpers/prompt-helpers';
import { rateLimit } from '../middleware/rate-limit';
import { logger } from '../logger';
import { scoreSlop, slopSummary } from '../../shared/lib/slop-scorer';
import {
  convertFiveDimToStructured,
  embedStructuredAudit,
  evaluateAuditGate,
  parseAuditFiveDim,
  parseStructuredAuditResponse,
  renderFiveDimMarkdown,
  renderStructuredAuditMarkdown,
} from '../../shared/lib/audit-structured';
import { buildRewritePrompt } from '../../shared/lib/rewrite-prompt';
import {
  reserveQuota,
  refundQuota,
  commitQuotaReservation,
} from '../helpers/quota-guard.js';
import { isStreamDisconnected } from '../helpers/stream-disconnect.js';
import * as db from '../lib/db.js';
import { inferNovelGovernanceProfile, getActiveDimensionSignals } from '../../shared/lib/prompt-assets-governed.js';
import { resolveRuntimeCuratedPrompts } from '../helpers/curated-skill-runtime.js';

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
}

const auditJobs = new Map<string, AuditJob>();
const JOB_TTL = 15 * 60 * 1000;

function pruneAuditJobs(): void {
  const now = Date.now();
  for (const [id, job] of auditJobs.entries()) {
    if (now - job.createdAt > JOB_TTL) {
      auditJobs.delete(id);
    }
  }
}

setInterval(pruneAuditJobs, 60 * 1000).unref();

function createAuditJob(): string {
  pruneAuditJobs();
  const id = 'audit_' + Math.random().toString(36).substring(2, 15);
  auditJobs.set(id, {
    id,
    status: 'pending',
    progress: 5,
    stageText: '已提交审稿任务，等待总编接单…',
    createdAt: Date.now(),
  });
  return id;
}

function updateAuditJob(id: string, updates: Partial<Omit<AuditJob, 'id' | 'createdAt'>>): void {
  const job = auditJobs.get(id);
  if (job) Object.assign(job, updates);
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
}

async function runAuditJob(
  jobId: string,
  body: AuditRequestBody,
  reservationId: string | undefined,
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
      skills = [],
      surface = 'chapter-polish',
      chapterOrder,
      novelId,
    } = body;

    const resolvedSkills = resolveRuntimeCuratedPrompts(skills);

    const skillsInfo = resolvedSkills.length > 0
      ? `\n【当前挂载的叙事 DNA 插件】\n${resolvedSkills.map((s: Skill) => `
- 技能名：${s.name}
- 核心笔调：${s.style}
- 句式特征：${s.sentenceStructure}
- 禁用红线：${(s.bannedWords || []).join('、')}
- 意象/符号：${s.imagery?.join('、')}
        `).join('\n')}\n` : '';

    const trimmedContextStr = truncateForAudit(contextStr, 1200);
    const trimmedSceneBeats = truncateForAudit(sceneBeats, 1400);
    const trimmedDraftContent = truncateForAudit(draftContent, 2600);
    const trimmedSkillsInfo = truncateForAudit(skillsInfo, 900);

    const slopReport = draftContent ? scoreSlop(draftContent) : null;

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
          extraDimensionPrompt = `\n\n### 🚨 自适应维度追加审读规约 (Adaptive Dimension Review Checklist)\n基于当前小说的具体属性与特征，系统自适应挂载了以下高级审读维度，请总编额外进行排查诊断：\n${signals.extraAuditChecks.map((check, index) => `${index + 1}. ${check}`).join('\n')}\n`;
        }
      }
    }

    updateAuditJob(jobId, { progress: 45, stageText: '总编正在深度审读正文与分镜…' });

    const rawFeedback = await generateText(getConfig(), {
      prompt: prompt + openingDiagnosticsPrompt + extraDimensionPrompt,
    });

    if (!rawFeedback || !rawFeedback.trim()) {
      failAuditJob(jobId, reservationId, 'Audit returned empty feedback');
      return;
    }

    updateAuditJob(jobId, { progress: 85, stageText: '正在整理审稿报告…' });

    const fiveDim = parseAuditFiveDim(rawFeedback);
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
      const baseFeedback = renderFiveDimMarkdown(fiveDim);
      const feedbackWithSlop = slopFeedback ? `${baseFeedback}${slopFeedback}` : baseFeedback;
      const feedback = embedStructuredAudit(feedbackWithSlop, structured);

      commitQuotaReservation(reservationId);
      updateAuditJob(jobId, {
        status: 'completed',
        progress: 100,
        stageText: '审稿完成',
        result: {
          feedback,
          score: fiveDim.totalScore,
          pass: gate.pass,
          failReason: gate.blockReason || fiveDim.failReason || null,
          scores: fiveDim.scores,
          gate,
          slopWarnings: slopReport ? slopReport.hits : [],
          slopSummary: slopReport ? slopSummary(slopReport) : null,
          slopScore: slopReport?.score ?? null,
        },
      });
      return;
    }

    const structured = parseStructuredAuditResponse(rawFeedback);
    if (!structured) {
      commitQuotaReservation(reservationId);
      updateAuditJob(jobId, {
        status: 'completed',
        progress: 100,
        stageText: '审稿完成',
        result: { feedback: rawFeedback },
      });
      return;
    }

    const feedback = embedStructuredAudit(renderStructuredAuditMarkdown(structured), structured);
    commitQuotaReservation(reservationId);
    updateAuditJob(jobId, {
      status: 'completed',
      progress: 100,
      stageText: '审稿完成',
      result: { feedback, score: structured.score, structured },
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

  return () => clearInterval(interval);
}

export function registerAuditRoutes(app: Express) {
  app.get('/api/audit/jobs/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = auditJobs.get(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(job);
  });

  app.post('/api/audit', async (req, res) => {
    if (!rateLimit('audit')) return res.status(429).json({ error: 'Rate limited', retryAfter: 5 });
    const { novelId } = req.body;

    const reserve = await reserveQuota(novelId, 'advancedAudit');
    if (!reserve.allowed) {
      return res.status(403).json({
        quotaExceeded: true,
        limitType: 'advancedAudit',
        count: reserve.count,
        max: reserve.max,
        error: reserve.error,
      });
    }

    const jobId = createAuditJob();
    void runAuditJob(jobId, req.body as AuditRequestBody, reserve.reservationId);
    res.json({ jobId });
  });

  app.post('/api/rewrite', async (req, res) => {
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
      skills = [],
    } = req.body;

    const reserve = await reserveQuota(novelId, 'advancedAudit');
    if (!reserve.allowed) {
      return res.status(403).json({
        quotaExceeded: true,
        limitType: 'advancedAudit',
        count: reserve.count,
        max: reserve.max,
        error: reserve.error,
      });
    }

    const reservationId = reserve.reservationId;
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
      req.socket.setTimeout(0);

      let activeSkills = skills || [];
      if ((!activeSkills || activeSkills.length === 0) && novelId) {
        const novel = db.getNovel(novelId);
        if (novel && novel.mountedSkillLoadout) {
          activeSkills = novel.mountedSkillLoadout
            .map((item: { skillId: string }) => db.getSkill(item.skillId))
            .filter(Boolean);
        }
      }
      const skillsInfo = buildSkillsPrompt(activeSkills);

      const prompt = buildRewritePrompt({
        text,
        instruction,
        contextStr,
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
          if (isStreamDisconnected(req, res)) {
            controller.abort();
            return;
          }
          accumulated += token;
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        },
      });

      if (isStreamDisconnected(req, res)) {
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
        res.status(500).json({ error: GENERIC_CLIENT_ERROR });
      } else if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: GENERIC_CLIENT_ERROR })}\n\n`);
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
