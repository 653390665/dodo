import type { Express } from 'express';
import type { Skill } from '../../shared/types';
import { generateText } from '../lib/server-llm';
import { getConfig } from '../lib/config';
import { resolvePromptAssetForSurface } from '../../shared/lib/prompt-runtime';
import { renderPromptTemplate, truncateForAudit } from '../helpers/prompt-helpers';
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
import { checkQuota, consumeQuota } from '../helpers/quota-guard.js';

export function registerAuditRoutes(app: Express) {
  app.post('/api/audit', async (req, res) => {
    if (!rateLimit('audit')) return res.status(429).json({ error: 'Rate limited', retryAfter: 5 });
    try {
      const { draftContent, sceneBeats, contextStr, skills = [], surface = 'chapter-polish', novelId } = req.body;

      // ================================================================
      // Quota Gate — verify free-tier limitations before LLM run
      // ================================================================
      const quotaCheck = checkQuota(novelId, 'advancedAudit');
      if (!quotaCheck.allowed) {
        return res.status(403).json({
          quotaExceeded: true,
          limitType: 'advancedAudit',
          count: quotaCheck.count,
          max: quotaCheck.max,
          error: quotaCheck.error,
        });
      }

      const skillsInfo = skills.length > 0
        ? `\n【当前挂载的叙事 DNA 插件】\n${skills.map((s: Skill) => `
- 技能名：${s.name}
- 核心笔调：${s.style}
- 句式特征：${s.sentenceStructure}
- 禁用红线：${(s.bannedWords || []).join('、')}
- 意象/符号：${s.imagery?.join('、')}
        `).join('\n')}\n` : "";

      const trimmedContextStr = truncateForAudit(contextStr, 1200);
      const trimmedSceneBeats = truncateForAudit(sceneBeats, 1400);
      const trimmedDraftContent = truncateForAudit(draftContent, 2600);
      const trimmedSkillsInfo = truncateForAudit(skillsInfo, 900);

      // Mechanical slop check — zero API cost, runs before LLM audit
      const slopReport = draftContent ? scoreSlop(draftContent) : null;

      const promptAsset = resolvePromptAssetForSurface({
        surface,
        promptTemplates: getConfig().promptTemplates,
        preferredTemplateKey: 'manualAudit',
      });
      const prompt = renderPromptTemplate(promptAsset.template, {
        contextStr: trimmedContextStr,
        skillsInfo: trimmedSkillsInfo,
        sceneBeats: trimmedSceneBeats,
        draftContent: trimmedDraftContent,
      });

      const rawFeedback = await generateText(getConfig(), { prompt });

      // 智能审稿调用成功，消费 1 次额度 (Consume quota count)
      consumeQuota(novelId, 'advancedAudit');

      // Try new 5-dimension format first, fall back to legacy format
      const fiveDim = parseAuditFiveDim(rawFeedback);
      if (fiveDim) {
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

        return res.json({
          feedback,
          score: fiveDim.totalScore,
          pass: gate.pass,
          failReason: gate.blockReason || fiveDim.failReason || null,
          scores: fiveDim.scores,
          gate,
          slopWarnings: slopReport ? slopReport.hits : [],
          slopSummary: slopReport ? slopSummary(slopReport) : null,
          slopScore: slopReport?.score ?? null,
        });
      }

      const structured = parseStructuredAuditResponse(rawFeedback);
      if (!structured) {
        return res.json({ feedback: rawFeedback });
      }

      const feedback = embedStructuredAudit(renderStructuredAuditMarkdown(structured), structured);
      res.json({ feedback, score: structured.score, structured });
    } catch (e) {
      logger.error(String(e));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post('/api/rewrite', async (req, res) => {
    try {
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
      } = req.body;

      // ================================================================
      // Quota Gate — verify free-tier limitations before LLM run
      // ================================================================
      const quotaCheck = checkQuota(novelId, 'advancedAudit');
      if (!quotaCheck.allowed) {
        return res.status(403).json({
          quotaExceeded: true,
          limitType: 'advancedAudit',
          count: quotaCheck.count,
          max: quotaCheck.max,
          error: quotaCheck.error,
        });
      }

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
      });

      const rewritten = await generateText(getConfig(), { prompt });

      // 高级润色重写成功，消费 1 次额度 (Consume quota count)
      consumeQuota(novelId, 'advancedAudit');

      res.json({ text: rewritten });
    } catch (e) {
      logger.error(String(e));
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
