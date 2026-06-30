import { logger } from '../logger';
import { rateLimit } from '../middleware/rate-limit';
import type { Express } from 'express';
import { generateId } from '../id';
import { generateText } from '../lib/server-llm';
import { getConfig } from '../lib/config';
import {
  buildChapterProductionTitle,
  buildProductionPlannerContext,
  buildProductionWriterContext,
  getNextChapterOrder,
  normalizeProductionIntent,
} from '../../src/lib/chapter-production';
import {
  buildStoryStateLedger,
} from '../../src/lib/story-state-ledger';
import { buildFallbackSceneBeats, buildFallbackDraft } from '../helpers/fallback-draft';
import { buildEmptyContinuityReport, buildContractPrompt } from '../helpers/production-helpers';
import { recordChapterDecision } from '../../src/lib/preference-flywheel';
import { addChunk } from '../vector-store';
import { summarizeChapterDecisions } from '../../src/lib/preference-flywheel';
import { runProductionPipeline } from '../helpers/ai-production-pipeline';
import { buildContinuationContext } from '../../src/lib/continuation-pack';
import * as db from '../lib/db';
import { validate, chapterProductionSchema } from '../validation';

function sseWrite(res: Express['response'], payload: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function emitTextAsTokensWithType(res: Express['response'], text: string, eventType: string) {
  const chunks = text.match(/.{1,24}/gs) || [];
  for (const chunk of chunks) {
    sseWrite(res, { type: eventType, content: chunk });
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
}

export function registerProductionRoutes(app: Express) {
  app.post('/api/chapter-production-runs/start', validate(chapterProductionSchema), async (req, res) => {
    if (!rateLimit('chapter-production')) {
      return res.status(429).json({ error: 'Rate limited — please wait before starting another production run', retryAfter: 30 });
    }
    let runId: string | null = null;
    try {
      const { novelId = '', targetChapterId = '', userIntent = '', activeEntityNames } = req.body;
      if (!novelId.trim()) {
        return res.status(400).json({ error: 'novelId is required' });
      }

      // Run Reflexion evolution in the background to learn from the previous chapter's edits
      runEvolutionReflexion(novelId).catch(err => logger.error('Reflexion background task error:', err));

      const novel = db.getNovel(novelId);
      if (!novel) {
        return res.status(404).json({ error: 'Novel not found' });
      }

      const chapters = db.listChapters(novelId);
      const characters = db.listCharacters(novelId).filter((c: any) => !activeEntityNames || activeEntityNames.includes(c.name) || c.role === 'protagonist');
      const locations = db.listLocations(novelId).filter((l: any) => !activeEntityNames || activeEntityNames.includes(l.name));
      const items = db.listItems(novelId).filter((i: any) => !activeEntityNames || activeEntityNames.includes(i.name));
      const factions = db.listFactions(novelId).filter((f: any) => !activeEntityNames || activeEntityNames.includes(f.name));
      const powerLevels = db.listPowerLevels(novelId).filter((p: any) => !activeEntityNames || activeEntityNames.includes(p.name));
      const timelineEvents = db.listTimelineEvents(novelId);
      const foreshadowings = db.listForeshadowings(novelId);

      const ledger = buildStoryStateLedger({
        novel,
        chapters,
        characters,
        locations,
        items,
        factions,
        powerLevels,
        timelineEvents,
        foreshadowings,
      });
      const writerContext = buildProductionWriterContext(ledger);
      const intent = normalizeProductionIntent(userIntent);
      runId = generateId();
      const now = Date.now();
      const baseRun = {
        id: runId,
        novelId,
        targetChapterId: targetChapterId || undefined,
        status: 'running' as const,
        userIntent: intent,
        sceneBeats: '',
        draftContent: '',
        styleAudit: '',
        continuityReport: buildEmptyContinuityReport(),
        createdAt: now,
        updatedAt: now,
      };

      db.createChapterProductionRun(baseRun);

      const fallbackBeats = buildFallbackSceneBeats(intent);
      const fallbackDraft = buildFallbackDraft(fallbackBeats, writerContext);
      const fallbackAudit = '## 保底审计\n- 模型响应过慢，本次生产先生成可编辑草稿。\n- 建议稍后单独运行 AI 审计，检查人物一致性、分镜执行和节奏问题。';
      const fallbackContinuity = buildEmptyContinuityReport();

      db.updateChapterProductionRun(runId, {
        status: 'review_required',
        sceneBeats: fallbackBeats,
        draftContent: fallbackDraft,
        styleAudit: fallbackAudit,
        continuityReport: fallbackContinuity,
      });

      return res.json({ run: db.getChapterProductionRun(runId) });
    } catch (e) {
      logger.error(String(e));
      const message = e instanceof Error ? e.message : String(e);
      if (runId) {
        db.updateChapterProductionRun(runId, {
          status: 'failed',
          errorMessage: message,
        });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post('/api/chapter-production-runs/start-stream', validate(chapterProductionSchema), async (req, res) => {
    let runId: string | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const clientAbortController = new AbortController();

    try {
      const {
        novelId = '',
        targetChapterId = '',
        userIntent = '',
        continuationPackId = '',
        activeEntityNames,
      } = req.body;
      if (!novelId.trim()) {
        res.status(400).json({ error: 'novelId is required' });
        return;
      }

      // Run Reflexion evolution in the background to learn from the previous chapter's edits
      runEvolutionReflexion(novelId).catch(err => logger.error('Reflexion background task error:', err));

      const novel = db.getNovel(novelId);
      if (!novel) {
        res.status(404).json({ error: 'Novel not found' });
        return;
      }

      let packContext = '';
      if (continuationPackId) {
        const pack = db.getContinuationPack(continuationPackId);
        if (pack) {
          packContext = buildContinuationContext(pack);
        }
      }

      // SSE setup
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      req.socket.setTimeout(0);

      heartbeat = setInterval(() => {
        if (!res.writableEnded) {
          res.write(':ping\n\n');
        }
      }, 30_000);

      res.on('close', () => {
        if (!res.writableEnded) {
          clientAbortController.abort();
        }
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      });

      // --- Data loading (same as non-streaming endpoint) ---
      const chapters = db.listChapters(novelId);
      const characters = db.listCharacters(novelId).filter((c: any) => !activeEntityNames || activeEntityNames.includes(c.name) || c.role === 'protagonist');
      const locations = db.listLocations(novelId).filter((l: any) => !activeEntityNames || activeEntityNames.includes(l.name));
      const items = db.listItems(novelId).filter((i: any) => !activeEntityNames || activeEntityNames.includes(i.name));
      const factions = db.listFactions(novelId).filter((f: any) => !activeEntityNames || activeEntityNames.includes(f.name));
      const powerLevels = db.listPowerLevels(novelId).filter((p: any) => !activeEntityNames || activeEntityNames.includes(p.name));
      const timelineEvents = db.listTimelineEvents(novelId);
      const foreshadowings = db.listForeshadowings(novelId);
      const mountedSkillIds = novel.mountedSkillIds || [];
      const skills = db.listSkills().filter((skill: any) => mountedSkillIds.includes(skill.id));

      const ledger = buildStoryStateLedger({
        novel,
        chapters,
        characters,
        locations,
        items,
        factions,
        powerLevels,
        timelineEvents,
        foreshadowings,
      });
      const plannerContext = buildProductionPlannerContext(ledger);
      const writerContext = buildProductionWriterContext(ledger);
      const intent = normalizeProductionIntent(userIntent);
      runId = generateId();
      const now = Date.now();

      const baseRun = {
        id: runId,
        novelId,
        targetChapterId: targetChapterId || undefined,
        status: 'running' as const,
        userIntent: intent,
        sceneBeats: '',
        draftContent: '',
        styleAudit: '',
        continuityReport: buildEmptyContinuityReport(),
        createdAt: now,
        updatedAt: now,
      };
      db.createChapterProductionRun(baseRun);

      sseWrite(res, { type: 'run_created', runId });

      // ============================================================
      // Phase 1: Immediate fallback (synchronous, no model calls)
      // ============================================================
      sseWrite(res, { type: 'status', message: '正在准备保底草稿...' });

      const fallbackBeats = buildFallbackSceneBeats(intent);
      sseWrite(res, { type: 'fallback_beats', content: fallbackBeats });

      const fallbackDraft = buildFallbackDraft(fallbackBeats, writerContext);
      await emitTextAsTokensWithType(res, fallbackDraft, 'fallback_draft_token');
      sseWrite(res, { type: 'fallback_draft_done' });

      const fallbackAudit = '## 保底审计\n- 模型响应过慢，本次生产先生成可编辑草稿。\n- 建议稍后单独运行 AI 审计，检查人物一致性、分镜执行和节奏问题。';
      sseWrite(res, { type: 'fallback_audit', content: fallbackAudit });

      const fallbackContinuity = buildEmptyContinuityReport();
      sseWrite(res, { type: 'fallback_continuity', report: fallbackContinuity });

      db.updateChapterProductionRun(runId, {
        status: 'review_required',
        sceneBeats: fallbackBeats,
        draftContent: fallbackDraft,
        styleAudit: fallbackAudit,
        continuityReport: fallbackContinuity,
      });

      sseWrite(res, { type: 'status', message: '草稿已就绪，可以先审阅或接受写入。' });

      // ============================================================
      // Phase 2: AI pipeline (async — Planner → Writer → Critic)
      // Runs after fallback; updates the run when complete
      // ============================================================
      const pipelineContextStr = [
        packContext,
        plannerContext,
      ].filter(Boolean).join('\n\n');

      // Load story contract
      const contract = (novel.projectPreferenceProfile as any)?.contract;
      const contractStr = contract ? buildContractPrompt(contract) : '';

      // Build character state summary from current_state
      const characterStates = characters
        .filter((c: any) => c.current_state)
        .map((c: any) => `- ${c.name}：${c.current_state}`)
        .join('\n');
      const characterStateStr = characterStates
        ? `\n【角色当前状态】\n${characterStates}`
        : '';

      // Extract learned preferences from past decisions
      const learnedPreferences = summarizeChapterDecisions(
        (novel.projectPreferenceProfile || {}) as any,
      );

      runProductionPipeline({
        userIntent: intent,
        contextStr: pipelineContextStr + characterStateStr + (contractStr ? `\n\n${contractStr}` : ''),
        skills,
        learnedPreferences,
        progress: {
          onPhase: (phase) => {
            if (!res.writableEnded) sseWrite(res, { type: 'status', message: `AI ${phase} 进行中...` });
          },
          onWriterToken: (chunk) => {
            if (!res.writableEnded) sseWrite(res, { type: 'model_draft_token', content: chunk });
          },
          onWriterDone: () => {
            if (!res.writableEnded) sseWrite(res, { type: 'model_draft_done' });
          },
          onCriticDone: (feedback, isValid) => {
            if (!res.writableEnded) sseWrite(res, { type: 'model_audit', content: feedback, isValid });
          },
          signal: clientAbortController.signal,
        },
      }).then((result) => {
        if (res.writableEnded) return;
        sseWrite(res, { type: 'model_beats', content: result.sceneBeats });
        sseWrite(res, { type: 'model_score', score: result.score, attempts: result.attempts });
        try {
          const currentRun = db.getChapterProductionRun(runId!);
          if (currentRun && currentRun.status !== 'applied') {
            db.updateChapterProductionRun(runId!, {
            sceneBeats: result.sceneBeats,
            draftContent: result.draft,
            styleAudit: result.audit,
            status: 'review_required',
          });
          }
        } catch (e) { logger.error('Production pipeline DB update failed:', e); }
        sseWrite(res, { type: 'done', run: db.getChapterProductionRun(runId!) });
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        res.end();
      }).catch((err) => {
        if (res.writableEnded) return;
        logger.error('AI pipeline error:', err);
        sseWrite(res, { type: 'error', message: err instanceof Error ? err.message : String(err) });
        sseWrite(res, { type: 'done', run: db.getChapterProductionRun(runId!) });
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        res.end();
      });

      // NOTE: stream stays open; heartbeat keeps connection alive until AI pipeline completes
      return;
    } catch (e) {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      logger.error('Chapter production stream fatal error:', e);
      const message = e instanceof Error ? e.message : String(e);
      if (runId) {
        try {
          db.updateChapterProductionRun(runId, {
            status: 'failed',
            errorMessage: message,
          });
        } catch (e) { logger.error('Decision record failed:', e); }
      }
      if (res.headersSent && !res.writableEnded) {
        sseWrite(res, { type: 'error', message });
        res.end();
      }
    }
  });

  app.post('/api/chapter-production-runs/:runId/apply', async (req, res) => {
    try {
      const run = db.getChapterProductionRun(req.params.runId);
      if (!run) {
        return res.status(404).json({ error: 'Production run not found' });
      }
      const hasReviewableDraft = Boolean(run.draftContent.trim());
      const canApplyRun = run.status === 'review_required' || (run.status === 'failed' && hasReviewableDraft);
      if (!canApplyRun) {
        return res.status(400).json({ error: `Production run is not reviewable: ${run.status}` });
      }

      const chapters = db.listChapters(run.novelId);
      const now = Date.now();
      let chapterId = run.targetChapterId;
      const wordCount = run.draftContent.replace(/\s/g, '').length;

      db.runInTransaction(() => {
        if (chapterId && db.getChapter(chapterId)) {
          db.updateChapter(chapterId, {
            sceneBeats: run.sceneBeats,
            content: run.draftContent,
            critique: run.styleAudit,
            wordCount,
          });
        } else {
          const nextOrder = getNextChapterOrder(chapters);
          chapterId = `${now}`;
          db.createChapter({
            id: chapterId,
            novelId: run.novelId,
            title: buildChapterProductionTitle(nextOrder),
            volumeName: chapters.at(-1)?.volumeName || '正文卷',
            content: run.draftContent,
            order: nextOrder,
            wordCount,
            sceneBeats: run.sceneBeats,
            critique: run.styleAudit,
            createdAt: now,
            updatedAt: now,
          });
        }

        db.createChapterVersion({
          id: `${now + 1}`,
          chapterId,
          content: run.draftContent,
          wordCount,
          author: 'auto',
          createdAt: now,
        });

        db.updateNovel(run.novelId, { updatedAt: now });

        const existingTimeline = db.listTimelineEvents(run.novelId);
        run.continuityReport.proposedPatch.timelineEventsToCreate.forEach((event, index) => {
          db.createTimelineEvent({
            id: generateId(),
            novelId: run.novelId,
            title: event.title,
            timestamp: event.timestamp,
            description: event.description,
            statusTag: event.statusTag,
            order: existingTimeline.length + index + 1,
            createdAt: now,
            updatedAt: now,
          });
        });

        run.continuityReport.proposedPatch.foreshadowingsToCreate.forEach((entry, _index) => {
          db.createForeshadowing({
            id: generateId(),
            novelId: run.novelId,
            title: entry.title,
            description: entry.description,
            status: entry.status,
            plantedChapterId: entry.plantedChapterId || chapterId,
            relatedCharacterIds: [],
            createdAt: now,
            updatedAt: now,
          });
        });

        // Apply character updates from continuity report
        if (run.continuityReport.proposedPatch.characterUpdates) {
          run.continuityReport.proposedPatch.characterUpdates.forEach((upd) => {
            const char = db.getCharacter(upd.characterId);
            if (char) {
              const currentSummary = char.summary || '';
              const separator = currentSummary && !currentSummary.endsWith('\n') ? '\n' : '';
              db.updateCharacter(upd.characterId, {
                summary: currentSummary + separator + upd.summaryAppend,
                updatedAt: now,
              });
            }
          });
        }

        // Apply item updates from continuity report
        if (run.continuityReport.proposedPatch.itemUpdates) {
          run.continuityReport.proposedPatch.itemUpdates.forEach((upd) => {
            const item = db.getItem(upd.itemId);
            if (item) {
              const currentDesc = item.description || '';
              const separator = currentDesc && !currentDesc.endsWith('\n') ? '\n' : '';
              db.updateItem(upd.itemId, {
                description: currentDesc + separator + upd.descriptionAppend,
                updatedAt: now,
              });
            }
          });
        }

        // Apply foreshadowing updates from continuity report (e.g. payoff)
        if (run.continuityReport.proposedPatch.foreshadowingUpdates) {
          run.continuityReport.proposedPatch.foreshadowingUpdates.forEach((upd) => {
            const fore = db.getForeshadowing(upd.foreshadowingId);
            if (fore) {
              const currentNotes = fore.notes || '';
              const separator = currentNotes && !currentNotes.endsWith('\n') ? '\n' : '';
              const nextNotes = upd.notesAppend ? currentNotes + separator + upd.notesAppend : currentNotes;
              db.updateForeshadowing(upd.foreshadowingId, {
                status: upd.status,
                notes: nextNotes,
                payoffChapterId: upd.status === 'payoff' ? chapterId : fore.payoffChapterId,
                updatedAt: now,
              });
            }
          });
        }

        db.updateChapterProductionRun(run.id, {
          status: 'applied',
          targetChapterId: chapterId,
        });

        // Record user decision for preference learning
        const { decisionAction, decisionInstruction, decisionReason } = req.body;
        if (decisionAction) {
          const novel = db.getNovel(run.novelId);
          if (novel) {
            const profile = novel.projectPreferenceProfile || {};
            const updated = recordChapterDecision(profile as any, {
              chapterId: chapterId!,
              timestamp: Date.now(),
              action: decisionAction,
              instruction: decisionInstruction,
              rejectedReason: decisionReason,
            });
            db.updateNovel(run.novelId, { projectPreferenceProfile: updated as any });
          }
        }
      });

      // Background-index chapter for vector RAG (don't block the response)
      addChunk(run.novelId, chapterId!, 0, run.draftContent).catch((e) => logger.error('Failed to add chunk to vector store:', e));

      res.json({ chapterId });
    } catch (e) {
      logger.error(String(e));
      res.status(500).json({ error: "Internal server error" });
    }
  });
}

async function runEvolutionReflexion(novelId: string): Promise<void> {
  try {
    const novel = db.getNovel(novelId);
    if (!novel) return;

    const appliedRuns = db.listChapterProductionRuns(novelId)
      .filter(r => r.status === 'applied')
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const latestApplied = appliedRuns[0];
    if (!latestApplied || !latestApplied.targetChapterId) return;

    const chapter = db.getChapter(latestApplied.targetChapterId);
    if (!chapter || !chapter.content) return;

    const original = latestApplied.draftContent;
    const final = chapter.content;

    if (original.trim() === final.trim()) {
      return; // No changes made by the user
    }

    const prompt = `你是一个写作进化分析器 (Evolution Agent)。
以下是 AI 自动生成的原稿与作者最终修改并发表的成品之间的对比。
请分析作者的修改意图，找出作者不喜欢的 AI 写作风格（例如：大段设定说教、过多情绪性废话、禁忌词汇、不自然的长句等），并提炼成 3 条具体的“写作避坑红线规则”。

【AI 原稿】
${original.substring(0, 3000)}

【作者修改后的成品】
${final.substring(0, 3000)}

请以 JSON 格式返回避坑规则，格式如下：
{
  "bannedWords": ["词语1", "词语2"],
  "rules": ["规则1", "规则2"]
}
只输出 JSON，不要有任何解释。`;

    const response = await generateText(getConfig(), {
      prompt,
      maxTokens: 1024,
      responseMimeType: 'application/json',
    });

    const parsed = JSON.parse(response.replace(/```(json)?/g, '').trim());
    if (parsed && (Array.isArray(parsed.bannedWords) || Array.isArray(parsed.rules))) {
      const profile = novel.projectPreferenceProfile || { tags: [], weights: { characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1, styleWeight: 1 }, acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0 };
      const newNotes = [...(profile.notes || [])];
      if (Array.isArray(parsed.rules)) {
        parsed.rules.forEach((r: string) => {
          if (!newNotes.includes(r)) newNotes.push(r);
        });
      }

      db.updateNovel(novelId, {
        projectPreferenceProfile: {
          ...profile,
          notes: newNotes.slice(-20),
        }
      });
      logger.info('Reflexion evolution complete, updated preference profile notes');
    }
  } catch (e) {
    logger.error('Reflexion evolution failed:', e);
  }
}
