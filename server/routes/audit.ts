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
import * as db from '../lib/db.js';
import { inferNovelGovernanceProfile } from '../../shared/lib/prompt-assets-governed.js';

export function registerAuditRoutes(app: Express) {
  app.post('/api/audit', async (req, res) => {
    if (!rateLimit('audit')) return res.status(429).json({ error: 'Rate limited', retryAfter: 5 });
    try {
      const { draftContent, sceneBeats, contextStr, skills = [], surface = 'chapter-polish', novelId, chapterOrder } = req.body;

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

      let openingDiagnosticsPrompt = '';
      if (chapterOrder && Number(chapterOrder) <= 10) {
        // Resolve commercial or literary style
        let isCommercial = false;
        if (novelId) {
          const novel = db.getNovel(novelId);
          if (novel) {
            const gov = inferNovelGovernanceProfile(novel);
            const tagsAndTitle = [
              novel.title || '',
              novel.summary || '',
              ...(novel.projectPreferenceProfile?.tags || [])
            ].join('\n').toLowerCase();
            isCommercial = gov.commercialMode === 'strict' ||
              /番茄|tomato|商业|爽文|新锐|无线/.test(tagsAndTitle);
          }
        }

        const platformTypeLabel = isCommercial
          ? "【番茄/商业爽文平台级审核 (Tomato/Commercial Smart Review)】"
          : "【严肃/精品文学深度健康审查 (Literary/Health Deep Review)】";

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

      const rawFeedback = await generateText(getConfig(), { prompt: prompt + openingDiagnosticsPrompt });

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
