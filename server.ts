import express from 'express';
import path from 'path';
import { initDb } from './src/lib/db';
import * as db from './src/lib/db';
import { getConfig, getLastConfigError, reloadConfig, saveConfig } from './src/lib/config';
import { generateText } from './src/lib/server-llm';
import { PLANNER_SOUL, WRITER_SOUL, CRITIC_SOUL } from './src/config/souls.js';
import { mergePromptTemplates, type PromptTemplateKey } from './src/config/prompt-templates';
import { buildRewritePrompt } from './src/lib/rewrite-prompt';
import { resolvePromptAssetForSurface } from './src/lib/prompt-runtime';
import {
  buildChapterProductionTitle,
  buildProductionPromptContexts,
  buildProductionPlannerContext,
  buildProductionWriterContext,
  getNextChapterOrder,
  normalizeProductionIntent,
} from './src/lib/chapter-production';
import {
  buildLayeredLedgerSummary,
  buildStoryStateLedger,
  summarizeStoryStateLedger,
} from './src/lib/story-state-ledger';
import {
  buildContinuityCriticPrompt,
  extractContinuityReportJson,
  normalizeContinuityReport,
} from './src/lib/continuity-critic';
import {
  embedStructuredAudit,
  evaluateAuditGate,
  parseAuditFiveDim,
  parseStructuredAuditResponse,
  renderFiveDimMarkdown,
  renderStructuredAuditMarkdown,
} from './src/lib/audit-structured';
import { extractJsonPayload } from './src/lib/extract-skill-json';
import { parseModelJsonPayload } from './src/lib/model-json';
import {
  buildContinuationPackParseAttempts,
  buildContinuationPackPrompt,
} from './src/lib/continuation-pack-parse';
import {
  validateExtractSkillInput,
  parseModelRefusal,
  evaluateSkillOutputQuality,
} from './src/lib/quality-gates';
import { buildBookEvidenceSegments } from './src/lib/book-skill-segmentation';
import { buildSkillDeckFromEvidence } from './src/lib/book-skill-aggregation';
import { collectSegmentEvidence } from './src/lib/book-skill-evidence';
import { buildContinuationContext, classifyContinuationSource } from './src/lib/continuation-pack';
import { assessStorySeedQuality, sanitizeIdeaSeed } from './src/lib/story-seed';
import type { SegmentSkillEvidence, StoryIdeaCard } from './src/types';

// Initialize local database on startup
initDb();

type StoryCardJob = {
  status: 'pending' | 'completed' | 'failed';
  createdAt: number;
  cards?: StoryIdeaCard[];
  error?: string;
};

const STORY_CARD_FALLBACK_MS = 2_000;
const STORY_CARD_MODEL_TIMEOUT_MS = 90_000;
const STORY_CARD_JOB_TTL_MS = 10 * 60_000;
const storyCardJobs = new Map<string, StoryCardJob>();

function createStoryCardJob(task: Promise<StoryIdeaCard[]>): string {
  const jobId = `story-cards-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  storyCardJobs.set(jobId, { status: 'pending', createdAt: Date.now() });

  task
    .then((cards) => {
      storyCardJobs.set(jobId, { status: 'completed', createdAt: Date.now(), cards });
    })
    .catch((error) => {
      storyCardJobs.set(jobId, {
        status: 'failed',
        createdAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      });
    });

  setTimeout(() => storyCardJobs.delete(jobId), STORY_CARD_JOB_TTL_MS);
  return jobId;
}

// ---- Skill extraction async job store ----
type SkillExtractionJob = {
  status: 'pending' | 'completed' | 'failed';
  createdAt: number;
  result?: {
    skills: any[];
    deck: any;
    segments: any[];
    warnings: string[];
    quality: any;
  };
  error?: string;
};

const SKILL_EXTRACTION_JOB_TTL_MS = 10 * 60_000;
const skillExtractionJobs = new Map<string, SkillExtractionJob>();

function createSkillExtractionJob(task: Promise<{
  skills: any[];
  deck: any;
  segments: any[];
  warnings: string[];
  quality: any;
}>): string {
  const jobId = `skill-extract-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

  setTimeout(() => skillExtractionJobs.delete(jobId), SKILL_EXTRACTION_JOB_TTL_MS);
  return jobId;
}

function buildSkillsPrompt(skills: any[]) {
  if (!skills || skills.length === 0) return "";

  const allBannedElements = Array.from(new Set(skills.flatMap(s => [...(s.bannedWords || []), ...(s.bannedElements || [])])));
  const allImagery = Array.from(new Set(skills.flatMap(s => s.imagery || [])));
  const allVocabulary = Array.from(new Set(skills.flatMap(s => s.vocabulary || [])));
  const allCorePatterns = Array.from(new Set(skills.flatMap(s => s.corePatterns || [])));

  const primarySkill = skills[0];
  const secondarySkills = skills.slice(1);

  let prompt = `\n【当前挂载的复合叙事 DNA (Composite Narrative Signature)】\n`;
  prompt += `你现在的文字灵魂由以下 ${skills.length} 个维度交织而成，请进行深度化学反应式的融合：\n\n`;

  prompt += `核心描述基调 (Primary Voice)：\n`;
  prompt += `- 基于《${primarySkill.name}》：${primarySkill.style}\n`;
  if (primarySkill.sentenceStructure) prompt += `  句法要求：“${primarySkill.sentenceStructure}”\n`;
  prompt += `  节奏推进遵循：“${primarySkill.pacing}”\n`;
  if (primarySkill.characterTraits) prompt += `  核心人物特征模版：“${primarySkill.characterTraits}”\n`;
  if (primarySkill.worldBuilding) prompt += `  世界观/力量体系感：“${primarySkill.worldBuilding}”\n`;
  if (primarySkill.plotPattern) prompt += `  剧情/爽点套路结构：“${primarySkill.plotPattern}”\n`;
  if (primarySkill.foreshadowing) prompt += `  悬念及伏笔手法：“${primarySkill.foreshadowing}”\n`;
  prompt += `\n`;

  if (secondarySkills.length > 0) {
    prompt += `质感滤镜与大纲补强 (Flavor Overlays)：\n`;
    secondarySkills.forEach(s => {
      prompt += `- 融合《${s.name}》：在描写层引入其“${s.style}”的色彩。`;
      if (s.characterTraits) prompt += `引入人物特征：${s.characterTraits}。`;
      if (s.plotPattern) prompt += `借鉴剧情节奏：${s.plotPattern}。`;
      prompt += `\n`;
    });
    prompt += `\n`;
  }

  prompt += `全局语法规约 (Global Constraints)：\n`;
  if (allImagery.length > 0) prompt += `- 【核心意象群】：${allImagery.join("、")} (在描写中高频出现这些符号)\n`;
  if (allVocabulary.length > 0) prompt += `- 【标志性词汇】：${allVocabulary.join("、")} (优先使用这些具有辨识度的词汇)\n`;
  if (allCorePatterns.length > 0) prompt += `- 【核心行文套路】：${allCorePatterns.join("、")} (在构建桥段时，请采纳这些模式)\n`;
  if (allBannedElements.length > 0) prompt += `- 【绝对禁忌红线】：${allBannedElements.join("、")} (如果你在文中写出这些设定或词汇，总编会立刻撕碎草稿)\n\n`;

  prompt += `风格对标样例 (Composite Few-Shots)：\n`;
  skills.forEach(s => {
    (s.fewShots || []).slice(0, 2).forEach((fs: string) => {
      prompt += `  * "${fs}" (来自 ${s.name})\n`;
    });
  });

  prompt += `\n指令：不要生硬堆砌，要把上面提到的《人物特征》、《世界观》、《剧情》、《设定》和写作方式有机相融，打造独属于你的复合风格。`;
  return prompt;
}

function getPromptTemplate(key: PromptTemplateKey): string {
  return mergePromptTemplates(getConfig().promptTemplates)[key];
}

function renderPromptTemplate(template: string, values: Record<string, string | number | undefined>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, rawKey) => {
    const key = rawKey as keyof typeof values;
    const value = values[key];
    return value == null ? '' : String(value);
  });
}

function truncateForAudit(text: string | undefined, maxChars: number) {
  if (!text) return '';
  const normalized = String(text).trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}\n……（审计输入已截断）`;
}

function buildPromptTemplateTest(key: PromptTemplateKey, template: string): { prompt?: string; systemInstruction?: string } {
  const sampleValues = {
    PLANNER_SOUL,
    WRITER_SOUL,
    CRITIC_SOUL,
    contextStr: '【世界观】雨夜江湖，玄铁令搅动各方势力。\n【人物】林砚寡言、克制、擅长后发制人。',
    userIntent: '这一章要写林砚在雨夜酒馆试探掌柜，最后听见门外靴声逼近。',
    skillsInfo: '【技能】雨夜刀锋式氛围悬疑武侠：冷峻短句、雨夜意象、以静制动。',
    sceneBeats: '1. 林砚入酒馆试探掌柜。2. 掌柜吐露玄铁令线索。3. 门外靴声逼近，危机压顶。',
    draftContent: '夜雨拍窗，林砚把断潮刀压在膝上，看着掌柜把灯芯拨得更亮了一点。',
    criticFeedback: '初稿阶段，请全力输出。',
    currentDraft: '夜雨拍窗，林砚把断潮刀压在膝上，看着掌柜把灯芯拨得更亮了一点。',
    text: '夜雨拍窗，林砚把断潮刀压在膝上，掌柜用最轻的声音提到玄铁令。门外靴声逼近，酒馆像被无形的手攥紧。',
    expectedWordCount: 120000,
    title: '小说名称：雨夜玄令',
    worldRules: '世界观及设定：江湖势力围绕玄铁令争斗，刀法讲究出手时机。',
    seedOutline: '用户的初始构思/种子创意：一个沉默刀客卷入关于玄铁令的连环危机。',
  };

  if (key === 'inspirationSystem') {
    return {
      systemInstruction: template,
      prompt: '请为“雨夜武侠 + 悬疑酒馆”构思三个不同气质的开篇灵感。',
    };
  }

  return {
    prompt: renderPromptTemplate(template, sampleValues),
  };
}

const CHAPTER_PRODUCTION_LLM_OPTIONS = {
  timeoutMs: 90_000,
  maxAttempts: 1,
} as const;

const SKILL_EXTRACTION_LLM_OPTIONS = {
  timeoutMs: 35_000,
  maxAttempts: 1,
  maxTokens: 2048,
} as const;

const ORCHESTRATE_WRITER_LLM_OPTIONS = {
  timeoutMs: 45_000,
  maxAttempts: 1,
  maxTokens: 1800,
} as const;

const ORCHESTRATE_CRITIC_LLM_OPTIONS = {
  timeoutMs: 35_000,
  maxAttempts: 1,
  maxTokens: 1200,
} as const;

const MAX_SKILL_LLM_SEGMENTS = 2;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function emitTextAsTokens(res: express.Response, text: string) {
  const chunks = text.match(/.{1,24}/gs) || [];
  for (const chunk of chunks) {
    res.write(`data: ${JSON.stringify({ type: 'token', content: chunk })}\n\n`);
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
}

function buildFallbackDraft(sceneBeats: string, contextStr: string) {
  const normalizedBeats = String(sceneBeats || '').trim();
  const intentHint = normalizedBeats.match(/\*\*核心冲突\*\*[：:]\s*([^\n。]+)/)?.[1]?.trim()
    || '一场试探正在逼近真正的危险';

  // Detect fallback template markers — if the scene beats are AI-generated templates
  // rather than real content, use natural prose fallback instead
  const isFallbackTemplate = /异动入场|试探加深|悬念收束/.test(normalizedBeats);
  if (isFallbackTemplate) {
    const userIntent = normalizedBeats.match(/\*\*核心冲突\*\*[：:]\s*([^\n。，]+)/)?.[1]?.trim() || '';
    const hintText = userIntent ? ` —— ${userIntent}` : '';
    return [
      `门轴轻轻一响，屋里的声音同时低了下去。`,
      ``,
      `他停在门边，没有急着往里走，只先看了一眼光线最暗的角落。那里有人挪开杯盏，像是早就等着这一刻${hintText}。`,
      `空气里压着未说出口的消息，也压着即将逼近的危险。`,
    ].join('\n');
  }
  const sceneBlocks = normalizedBeats
    .split(/\n\s*---\s*\n|(?=###\s*场景)/)
    .map((block) => block.trim())
    .filter(Boolean)
    .slice(0, 4);
  const beats = sceneBlocks.length > 0
    ? sceneBlocks.map((block, index) => {
        const title = block.match(/###\s*场景\s*\d+[：:]\s*([^\n（(]+)/)?.[1]?.trim() || `第 ${index + 1} 个转折`;
        const conflict = block.match(/\*\*核心冲突\*\*[：:]\s*([^\n]+)/)?.[1]?.trim();
        const actions = block.match(/\*\*关键动作链\*\*[：:]\s*([^\n]+)/)?.[1]?.trim();
        const exitHook = block.match(/\*\*退场钩子\*\*[：:]\s*([^\n]+)/)?.[1]?.trim();
        return [title, conflict, actions, exitHook].filter(Boolean).join('。');
      })
    : normalizedBeats
        .split(/\n+/)
        .map((line) => line.replace(/^[-*\d.、\s]+/, '').replace(/\*\*/g, '').trim())
        .filter(Boolean)
        .slice(0, 4);
  if (beats.length === 0) {
    return '门轴轻轻一响，屋里的声音同时低了下去。\n\n他停在门边，没有急着往里走，只先看了一眼光线最暗的角落。那里有人挪开杯盏，像是早就等着这一刻。空气里压着未说出口的消息，也压着即将逼近的危险。';
  }

  const firstBeat = beats[0] || intentHint;
  const secondBeat = beats[1] || '试探被接住，旧线索浮出水面';
  const thirdBeat = beats[2] || '危险逼近，角色必须做出选择';

  return [
    `门外的风声先一步撞进来，灯火跟着晃了一下。屋里的人没有立刻说话，只在那一瞬间各自收住了动作。${firstBeat}没有被摊开讲明，它先藏在桌边的一次停顿里，藏在对方避开的眼神里。`,
    `试探从一句不重的话开始。有人故意把问题说得很轻，像只是随口问起；另一个人却在杯沿上停住了手指。${secondBeat}，局势因此往前挪了一寸。没人承认自己知道真相，可每个人都在用沉默承认，今晚的平静已经被撕开了口子。`,
    `${thirdBeat}。远处传来的声音越来越近，像靴底踩过积水，也像刀鞘擦过门槛。最后一盏灯猛地暗下去时，所有人都停住了呼吸。真正的麻烦，还没有进门。`,
  ].join('\n\n');
}

function buildFallbackSceneBeats(userIntent: string) {
  const intent = String(userIntent || '').trim() || '主角面对新的局势变化，被迫做出选择';
  return [
    `### 场景 1：异动入场\n\n**入场钩子**：一个异常声音或突发消息打断原本平静的局面。\n\n**核心冲突**：${intent}，但信息并不完整，角色只能先试探。\n\n**关键动作链**：角色观察异常；对方给出含糊回应；一个细节暴露真正风险。\n\n**退场钩子**：新的脚步声、信物或消息把局势推向下一场。`,
    `### 场景 2：试探加深\n\n**入场钩子**：角色主动抛出一个问题或动作诱饵。\n\n**核心冲突**：双方围绕真实目的互相遮掩。\n\n**关键动作链**：试探被接住；旧线索浮出；角色意识到眼前不是偶然。\n\n**退场钩子**：关键人物或危险信号正式出现。`,
    `### 场景 3：悬念收束\n\n**入场钩子**：危险逼近，角色必须决定留下还是行动。\n\n**核心冲突**：保全自身与追查真相发生冲突。\n\n**关键动作链**：角色做出选择；关键道具或信息被确认；局势留下更大的疑问。\n\n**退场钩子**：以一个未解释的动作或声音结束本章。`,
  ].join('\n\n---\n\n');
}

// ---- Input quality gate helpers ----

// ---- Output quality gate ----

/** Extract key bigrams/trigrams from ideaSeed for relevance matching. */
function extractSeedKeywords(seed: string): string[] {
  const cleaned = seed.replace(/[，,。！？、；：\s]+/g, '').trim();
  if (cleaned.length < 2) return [];
  const result: string[] = [];
  // bigrams
  for (let i = 0; i < cleaned.length - 1; i++) {
    result.push(cleaned.slice(i, i + 2));
  }
  // trigrams
  for (let i = 0; i < cleaned.length - 2; i++) {
    result.push(cleaned.slice(i, i + 3));
  }
  // Deduplicate, favoring longer forms
  const seen = new Set<string>();
  return result.filter((k) => {
    if (seen.has(k) || k.length < 2) return false;
    seen.add(k);
    return true;
  });
}

/** Generic/boilerplate hook patterns the model must not produce. */
const GENERIC_HOOK_PATTERNS = [
  /^一个关于.{1,10}的(传奇|故事|传说|篇章|史诗)/,
  /^这是一个.{1,10}的(传奇|故事|传说)/,
  /^命运的.{1,8}(故事|传奇|篇章|交响)/,
  /^一段.{1,8}的(旅程|冒险|传说|故事|史诗)/,
  /^.{1,5}的(传奇|故事|传说)由此(展开|开始|拉开)/,
  /^当.{1,10}遇上.{1,10}会(怎样|如何|发生什么)/,
  /^.{1,3}(和|与).{1,3}的.{1,5}(故事|传奇)/,
  /^.{1,8}之(路|旅|谜|歌|光|影|殇)/,
];

function hookIsGeneric(hook: string): boolean {
  const trimmed = hook.trim();
  return GENERIC_HOOK_PATTERNS.some((p) => p.test(trimmed));
}

/** Check if hook contains at least one keyword from the seed. */
function hookMatchesSeed(hook: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true; // can't check, pass
  const cleaned = hook.replace(/[，,。！？、；：\s]+/g, '');
  return keywords.some((kw) => cleaned.includes(kw));
}

/** True when hook is too short or just repeats the seed verbatim with no expansion. */
function hookIsTrivial(hook: string, seed: string): boolean {
  const cleanedHook = hook.replace(/[，,。！？、；：\s]+/g, '').trim();
  const cleanedSeed = seed.replace(/[，,。！？、；：\s]+/g, '').trim();
  if (cleanedHook.length < 5) return true;
  // Hook is just the seed + trash suffix
  if (cleanedHook.startsWith(cleanedSeed) && cleanedHook.length <= cleanedSeed.length + 6) return true;
  return false;
}

function parseStoryCardsFromModel(raw: string, ideaSeed: string): StoryIdeaCard[] {
  const parsed = extractJsonPayload(raw);
  // Model returned needs_clarification — user input not usable as story seed
  if (parsed?.status === 'needs_clarification') {
    throw new Error(JSON.stringify({
      type: 'needs_clarification',
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    }));
  }
  const cards = Array.isArray(parsed?.cards) ? parsed.cards : Array.isArray(parsed) ? parsed : [parsed];
  const validCards = cards.filter((card: any) => card && typeof card.hook === 'string' && typeof card.whyItWorks === 'string');
  if (validCards.length === 0) {
    throw new Error('Model returned no valid story cards');
  }
  // Post-model quality gate: reject noise/hallucination
  const hooks = validCards.map((c: any) => c.hook || '');
  const uniqueHooks = new Set(hooks.map((h: string) => h.slice(0, 10)));
  if (uniqueHooks.size < 2 && validCards.length >= 3) {
    throw new Error('Post-model quality gate: cards too similar');
  }
  // Reject cards where hook is just repeating gibberish
  const gibberish = /^[a-zA-Z0-9]{1,4}$|^[啊嗯哦哎哈嘿啧]{1,3}$|^不补|啵$/;
  if (hooks.some((h: string) => gibberish.test(h.trim()))) {
    throw new Error('Post-model quality gate: hook contains noise/gibberish');
  }

  // --- New output quality gates ---

  const seedKeywords = extractSeedKeywords(ideaSeed.trim());
  const seedNormalized = ideaSeed.replace(/[，,。！？、；：\s]+/g, '').trim();

  // Gate 1: reject generic/boilerplate hooks
  const genericHooks = hooks.filter((h) => hookIsGeneric(h));
  if (genericHooks.length >= hooks.length) {
    throw new Error('Post-model quality gate: all hooks are boilerplate/generic patterns');
  }

  // Gate 2: reject hooks that don't reference any keyword from the input seed
  if (seedKeywords.length > 0) {
    const matchingHooks = hooks.filter((h) => hookMatchesSeed(h, seedKeywords));
    if (matchingHooks.length === 0 && seedNormalized.length >= 4) {
      throw new Error('Post-model quality gate: no hook references input seed keywords');
    }
  }

  // Gate 3: reject trivial hooks (too short, or just repeat the seed)
  const trivialHooks = hooks.filter((h) => hookIsTrivial(h, seedNormalized));
  if (trivialHooks.length >= hooks.length) {
    throw new Error('Post-model quality gate: all hooks are too trivial / just repeat the seed');
  }

  // Gate 4: if majority of hooks are generic, downgrade to fallback
  if (genericHooks.length >= 2 && validCards.length === 3) {
    throw new Error('Post-model quality gate: majority of hooks are generic boilerplate');
  }

  // Auto-populate structural fields the model no longer outputs (reduced output schema)
  const seedKeyTerms = extractKeywords(ideaSeed);
  const mainTerm = seedKeyTerms[0] || ideaSeed.slice(0, 4);
  const secondTerm = seedKeyTerms[1] || mainTerm;
  const tones = ['冷峻悬疑', '热血逆袭', '慢热铺陈'];

  return validCards.map((card: any, i: number) => ({
    id: `model-card-${Date.now()}-${i + 1}`,
    hook: card.hook || '',
    protagonist: card.protagonist || '',
    coreConflict: card.coreConflict || '',
    tone: card.tone || tones[i % tones.length],
    whyItWorks: card.whyItWorks || '',
    riskNote: card.riskNote || '开局冲突不够尖锐，需要第一章迅速建立具体威胁。',
    mixTags: Array.isArray(card.mixTags) ? card.mixTags : [],
    starterSeeds: {
      worldSeed: card.coreConflict
        ? `以${mainTerm}为核心的世界设定，${card.coreConflict.slice(0, 20)}`
        : `以${mainTerm}为核心背景`,
      relationshipSeed: i === 0
        ? '主角与他人之间既有利益交集也有信息差，合作中藏着试探。'
        : i === 1
          ? '主角被迫与对立角色周旋，每次对白都是双向刺探。'
          : '关键人物关系充满不信任，所有交谈都是博弈。',
      chapterOneSeed: `第一章从${card.hook ? card.hook.slice(0, 20) : mainTerm}的信号开场，快速建立冲突，留下悬念钩子。`,
    },
    planningFit: {
      recommendedLength: '中长篇',
      recommendedFocus: '剧情推进',
      recommendedPacing: '紧推进',
      reason: `该方向能围绕核心冲突展开，与输入意自然衔接。`,
    },
    signals: {
      tone: card.tone || '冷峻悬疑',
      conflictType: i === 0 ? '事件引爆' : i === 1 ? '利益博弈' : '秘密羁绊',
      worldWeight: 0.5,
      characterWeight: 0.5,
      pacingPreference: 'tight' as const,
    },
  }));
}

function extractKeywords(seed: string): string[] {
  // Extract meaningful 2-4 char Chinese substrings, skip common stop words
  const stop = new Set(['一个', '这个', '那个', '什么', '怎么', '为什么', '可以', '还是', '或者', '但是', '因为', '所以', '如果', '虽然', '已经', '而且', '我的', '你的', '他的', '我们', '他们', '你们', '关于', '自己', '没有', '不是', '就是', '的话', '来说', '这样', '那样', '如何']);
  const cleaned = seed.replace(/[，,。！？、；：””''（）\s]+/g, ' ').trim();
  const segments = cleaned.split(' ').filter(s => s.length >= 2 && !stop.has(s));
  // Also split longer segments into bigrams for better coverage
  const bigrams: string[] = [];
  for (const seg of segments) {
    for (let i = 0; i < seg.length - 1; i++) {
      bigrams.push(seg.slice(i, i + 2));
    }
  }
  // Deduplicate, prefer original segments first, then bigrams
  const seen = new Set<string>();
  const result: string[] = [];
  for (const s of [...segments, ...bigrams]) {
    if (!seen.has(s) && s.length >= 2) {
      seen.add(s);
      result.push(s);
    }
  }
  return result.slice(0, 6);
}

function buildFallbackStoryCards(
  ideaSeed: string,
  planning: Partial<{
    expectedWordCount: number;
    pacingPreference: 'tight' | 'balanced' | 'slow-burn';
    storyFocus: 'plot' | 'character' | 'world';
  }>,
  batchIndex = 0,
  previousHookTexts: string[] = [],
) {
  const seed = String(ideaSeed || '').trim() || '一个尚未成形的新故事';
  const keywords = extractKeywords(seed);
  const mainTerm = keywords[0] || '故事核心';
  const secondTerm = keywords[1] || mainTerm;
  const thirdTerm = keywords[2] || secondTerm;

  const expectedWordCount = Number(planning.expectedWordCount || 180000);
  const pacing = planning.pacingPreference || 'tight';
  const focus = planning.storyFocus || 'plot';
  const pacingText = pacing === 'slow-burn' ? '慢热铺陈' : pacing === 'balanced' ? '均衡推进' : '紧推进';
  const focusText = focus === 'character' ? '人物关系' : focus === 'world' ? '世界设定' : '剧情推进';
  const lengthText = expectedWordCount >= 500000 ? '长篇连载' : expectedWordCount >= 180000 ? '中长篇' : '中短篇';

  // Direction pools — selected based on storyFocus
  const directionPools: Record<string, Array<{
    label: string;
    hookTemplate: (main: string, second: string) => string;
    protagonistTemplate: (main: string) => string;
    conflictTemplate: (main: string, second: string) => string;
    tone: string;
    whyTemplate: (seed: string) => string;
    risk: string;
  }>> = {
    character: [
      {
        label: '双人对峙',
        hookTemplate: (m) => `${m}让两个本不该有交集的人绑在一起`,
        protagonistTemplate: () => '一个习惯沉默观察的主角，一个话多但每次都说到痛处的对照角色。',
        conflictTemplate: (m) => `两人围绕${m}各怀目的，合作中藏着试探。`,
        tone: '对手戏强、对白驱动、关系递进。',
        whyTemplate: (s) => `把”${s}”从事件转为人际张力，每章人物关系都有新裂痕或新理解。`,
        risk: '不能太快信任——每次合作都要留一道新疤。',
      },
      {
        label: '秘密羁绊',
        hookTemplate: (m) => `${m}揭开了一段无人知晓的过往`,
        protagonistTemplate: () => '一个被迫隐藏身份的主角，一个意外知晓秘密的闯入者。',
        conflictTemplate: (m) => `关于${m}的秘密一旦泄露，双方的关系会立刻翻转。`,
        tone: '情感层次丰富、秘密逐层剥开。',
        whyTemplate: (s) => `”${s}”天然有秘密属性，适合构建”只有你知道”的羁绊张力。`,
        risk: '秘密不能拖太久——到中段必须有代价显现。',
      },
      {
        label: '利益博弈',
        hookTemplate: (m) => `${m}让所有人的利益重新洗牌`,
        protagonistTemplate: () => '一个站在利益交叉点的主角，身边每个人都在押注。',
        conflictTemplate: (m) => `${m}改变了原有的利益格局，盟友和敌人开始重新站位。`,
        tone: '理智博弈、利益交换、人情与算计交织。',
        whyTemplate: (s) => `”${s}”能制造持续的利益张力，每章都有人在押新的赌注。`,
        risk: '利益冲突要具体——不能只写”他们各怀鬼胎”，要写出谁想要什么。',
      },
    ],
    world: [
      {
        label: '规则异变',
        hookTemplate: (m) => `${m}正在改写这个世界的规则`,
        protagonistTemplate: () => '一个在旧规则下成长的主角，突然发现世界运作的方式变了。',
        conflictTemplate: (m) => `${m}揭示的力量/规则与原有体系产生根本冲突。`,
        tone: '宏大设定、规则驱动、层层展开。',
        whyTemplate: (s) => `”${s}”可以作为世界规则的突破口，第一章就建立独特设定感。`,
        risk: '设定不能全在第一章倾倒——让主角逐步发现规则，读者同步理解。',
      },
      {
        label: '势力交错',
        hookTemplate: (m) => `${m}打破了旧势力的平衡`,
        protagonistTemplate: () => '一个夹在多股势力之间的棋子，被迫学会在夹缝中求生。',
        conflictTemplate: (m) => `${m}成为各方势力争夺的关键，主角必须在站位中做选择。`,
        tone: '格局宏大、多线交织、派系博弈。',
        whyTemplate: (s) => `以”${s}”为锚点展开势力图，每卷都能引入新的派系和冲突。`,
        risk: '派系太多会让读者记不住——每卷聚焦2-3个主要势力。',
      },
      {
        label: '未知领域',
        hookTemplate: (m) => `${m}指向了一个从未被探索的领域`,
        protagonistTemplate: () => '一个被好奇心或生存压力逼入未知世界的主角，每步都在发现新规则。',
        conflictTemplate: (m) => `探索${m}的过程中，主角不断遇到违背原有认知的存在。`,
        tone: '探索感强、未知与惊奇、世界逐步展开。',
        whyTemplate: (s) => `”${s}”自带未知属性，适合让读者随主角一起探索新世界。`,
        risk: '不能只写”主角震惊了”——每次探索要有一个可被记住的新规则或新存在。',
      },
    ],
    plot: [
      {
        label: '事件引爆',
        hookTemplate: (m) => `当${m}成为不可回避的导火索`,
        protagonistTemplate: (m) => `一个被${m}卷入漩涡的主角，不得不直面这场危机。`,
        conflictTemplate: (m) => `围绕${m}展开的核心冲突，每章局势都在升级。`,
        tone: '紧张、高节奏、冲突密集。',
        whyTemplate: (s) => `直接围绕”${s}”打造高冲突开局，第一章冲突明确，读者容易代入。`,
        risk: '冲突密度过高可能导致疲劳，需要在关键节点留喘息空间。',
      },
      {
        label: '多米诺链',
        hookTemplate: (m) => `${m}引发的连锁反应刚刚开始`,
        protagonistTemplate: (m) => `一个以为解决了${m}就能脱身的主角，发现每解决一件事又引出两件。`,
        conflictTemplate: (m) => `${m}不是终点而是起点，每步处理都牵出新危机。`,
        tone: '快节奏、一环扣一环、爆点密集。',
        whyTemplate: (s) => `让”${s}”像多米诺骨牌一样推倒后续事件，适合紧凑连载。`,
        risk: '需要控制链的长度——3-5个节点后要有一个阶段性收束。',
      },
      {
        label: '时间紧迫',
        hookTemplate: (m) => `${m}设下了一个倒计时的局`,
        protagonistTemplate: (m) => `一个必须在时限内解决${m}的主角，每一步都面对倒计时压力。`,
        conflictTemplate: (m) => `${m}的时限越来越近，主角必须在资源不足的情况下做选择。`,
        tone: '紧迫感强、节奏紧凑、每一步都是赌注。',
        whyTemplate: (s) => `给”${s}”加上时间压力，天然制造章节钩子和紧张感。`,
        risk: '倒计时不能一直延——到高潮时必须真的有人付出代价。',
      },
    ],
  };

  const directions = directionPools[focus] || directionPools.plot;

  // Rotate directions per batch for variation
  const rotated = [...directions];
  for (let r = 0; r < batchIndex % directions.length; r++) rotated.push(rotated.shift()!);

  const batchSuffix = batchIndex > 0 ? ['', '（变体）', '（另辟蹊径）'][Math.min(batchIndex, 2)] : '';

  const base = rotated.map((dir, i) => ({
    id: `fallback-card-${batchIndex}-${i + 1}`,
    hook: dir.hookTemplate(mainTerm, secondTerm) + batchSuffix,
    protagonist: dir.protagonistTemplate(mainTerm),
    coreConflict: dir.conflictTemplate(mainTerm, secondTerm),
    tone: dir.tone,
    whyItWorks: dir.whyTemplate(seed),
    riskNote: dir.risk,
    mixTags: keywords.slice(0, 4),
    signals: {
      tone: (['sharp', 'grim', 'lyrical'] as const)[i],
      conflictType: dir.label,
      worldWeight: 0.45 + i * 0.1,
      characterWeight: 0.6 + i * 0.1,
      pacingPreference: pacing,
    },
  }));

  return base.map((card, i) => ({
    ...card,
    starterSeeds: {
      worldSeed: `以${mainTerm}为核心构建的世界背景，${secondTerm ? `与${secondTerm}交织` : ''}。`,
      relationshipSeed: i === 2
        ? '主角与同伴之间保持不信任的合作关系，一边共事一边试探。'
        : '主角与关键人物之间既有利益交集也有信息差。',
      chapterOneSeed: `第一章从${mainTerm}的异常信号开场，迅速建立${card.signals.conflictType}冲突，留下第一枚悬念钩子。`,
    },
    planningFit: {
      recommendedLength: `${lengthText}，约 ${expectedWordCount.toLocaleString('zh-CN')} 字`,
      recommendedFocus: focusText,
      recommendedPacing: pacingText,
      reason: `该方向适合${pacingText}节奏，能把叙事重心放在${focusText}上，与"${seed}"自然衔接。`,
    },
  })).map(card => ({
    ...card,
    hook: cleanCardField(card.hook),
    protagonist: cleanCardField(card.protagonist),
    coreConflict: cleanCardField(card.coreConflict),
  }));
}

function cleanCardField(text: string): string {
  return text
    .replace(/我想写一个?\s*/g, '')
    .replace(/我想写\s*/g, '')
    .replace(/^当当\s*/g, '')
    .replace(/作者/g, '')
    .replace(/这个故事/g, '这个故事')  // keep for now but flag
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function buildFallbackSkillForSegment(excerpt: string, label: string) {
  const normalized = String(excerpt || '').replace(/\s+/g, ' ').trim();
  const sample = normalized.slice(0, 120);
  const hasDialogue = /[“”"']|说|问|答|喊|低声/.test(normalized);
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

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const allowPortRetry = !process.env.PORT || process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '50mb' })); // Increase limit for text upload
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Global request timeout safety net — prevents hung requests from blocking the server
  app.use((_req, res, next) => {
    const timeoutMs = 120_000; // 2 minutes max for any request
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({ error: 'Request timed out — server took too long to respond' });
      }
    }, timeoutMs);
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));
    next();
  });

  // DB method whitelist — only methods used by the frontend are allowed
  const DB_WHITELIST = new Set([
    'listNovels', 'getNovel', 'createNovel', 'updateNovel', 'deleteNovel',
    'listChapters', 'getChapter', 'createChapter', 'updateChapter', 'deleteChapter',
    'listChapterVersions', 'createChapterVersion',
    'listCharacters', 'createCharacter', 'updateCharacter', 'deleteCharacter',
    'listLocations', 'createLocation', 'updateLocation', 'deleteLocation',
    'listItems', 'createItem', 'updateItem', 'deleteItem',
    'listFactions', 'createFaction', 'updateFaction', 'deleteFaction',
    'listPowerLevels', 'createPowerLevel', 'updatePowerLevel', 'deletePowerLevel',
    'listTimelineEvents', 'createTimelineEvent', 'updateTimelineEvent', 'deleteTimelineEvent',
    'listSkills', 'getSkill', 'createSkill', 'updateSkill', 'deleteSkill', 'listSkillVersions',
    'listSkillUsageRecords', 'syncSkillFeedbackScores', 'createSkillUsageRecord',
    'listIdeaFragments', 'createIdeaFragment', 'updateIdeaFragment', 'deleteIdeaFragment',
    'listForeshadowings', 'createForeshadowing', 'updateForeshadowing', 'deleteForeshadowing',
    'listChapterProductionRuns', 'getChapterProductionRun', 'createChapterProductionRun', 'updateChapterProductionRun',
    'listContinuationPacks', 'getContinuationPack', 'createContinuationPack', 'updateContinuationPack', 'deleteContinuationPack',
  ]);

  // DB proxy — only exposes whitelisted methods
  app.post('/api/db', (req, res) => {
    const { method, args = [] } = req.body;
    if (!DB_WHITELIST.has(method)) {
      return res.status(400).json({ error: `Unknown method: ${method}` });
    }
    const fn = (db as Record<string, Function>)[method];
    if (typeof fn !== 'function') {
      return res.status(500).json({ error: `Method not a function: ${method}` });
    }
    try {
      const result = fn(...args);
      res.json({ result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // SSE endpoint for change notifications (replaces the subscribe() pattern)
  app.get('/api/db/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write('retry: 3000\n\n');
    req.socket.setTimeout(0);

    const { subscribe } = db;
    const unsub = subscribe(() => {
      res.write('data: {}\n\n');
    });

    const heartbeat = setInterval(() => {
      res.write(':ping\n\n');
    }, 30_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsub();
    });
  });

  app.get('/api/config', (_req, res) => {
    const config = getConfig();
    const configError = getLastConfigError();
    res.json({
      hasApiKey: !!config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      promptTemplates: config.promptTemplates,
      ...(configError ? { configError } : {}),
    });
  });

  app.post('/api/config', (req, res) => {
    const { apiKey, baseUrl, model, promptTemplates } = req.body;
    const existing = getConfig();
    saveConfig({
      apiKey: apiKey || existing.apiKey,
      baseUrl: baseUrl || existing.baseUrl,
      model: model || existing.model,
      promptTemplates: mergePromptTemplates(promptTemplates),
    });
    reloadConfig();
    res.json({ ok: true });
  });

  app.post('/api/prompt-template-test', async (req, res) => {
    let promptPreview = '';
    try {
      const { key, template } = req.body as { key?: PromptTemplateKey; template?: string };
      if (!key || typeof key !== 'string') {
        return res.status(400).json({ error: 'Template key is required' });
      }
      const baseTemplate = getPromptTemplate(key);
      const effectiveTemplate = typeof template === 'string' && template.trim() ? template : baseTemplate;
      const payload = buildPromptTemplateTest(key, effectiveTemplate);
      if (!payload.prompt?.trim()) {
        return res.status(400).json({ error: 'Template rendered to empty prompt' });
      }
      promptPreview = payload.prompt.slice(0, 4000);
      const text = await withTimeout(
        generateText(getConfig(), payload as { prompt: string; systemInstruction?: string }),
        25000,
        '模板试跑超时：上游模型响应过慢，请稍后重试或先用渲染预览检查模板结构。',
      );
      res.json({
        text,
        promptPreview,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e), promptPreview });
    }
  });

  app.post('/api/inspiration', async (req, res) => {
    try {
      const { prompt = '', surface = 'workspace-draft' } = req.body;
      if (!prompt.trim()) {
        return res.status(400).json({ error: 'Prompt is required' });
      }
      const promptAsset = resolvePromptAssetForSurface({
        surface,
        promptTemplates: getConfig().promptTemplates,
        preferredTemplateKey: 'inspirationSystem',
      });
      const text = await generateText(getConfig(), {
        prompt,
        systemInstruction: promptAsset.template,
        timeoutMs: 90_000,
        maxAttempts: 2,
        maxTokens: 2048,
      });
      res.json({ text });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/story-cards', async (req, res) => {
    try {
      const { ideaSeed: rawSeed = '', chatContext = '', planning = {}, surface = 'welcome', previousHookTexts = [], batchIndex = 0 } = req.body;
      const ideaSeed = sanitizeIdeaSeed(rawSeed) || rawSeed.trim();

      if (!ideaSeed.trim()) {
        return res.status(400).json({ error: 'ideaSeed is required' });
      }
      const seedQuality = assessStorySeedQuality(ideaSeed);
      if (seedQuality.status === 'needs_clarification') {
        return res.status(400).json({
          status: 'needs_clarification',
          error: seedQuality.error,
          questions: seedQuality.questions,
        });
      }
      const promptAsset = resolvePromptAssetForSurface({
        surface,
        promptTemplates: getConfig().promptTemplates,
        preferredTemplateKey: 'storyCards',
      });
      const prompt = renderPromptTemplate(promptAsset.template, {
        ideaSeed,
        chatContext,
        expectedWordCount: planning.expectedWordCount || 180000,
        storyFocus:
          planning.storyFocus === 'character'
            ? '人物关系'
            : planning.storyFocus === 'world'
              ? '世界设定'
              : '剧情推进',
        pacingPreference:
          planning.pacingPreference === 'slow-burn'
            ? '慢热铺陈'
            : planning.pacingPreference === 'balanced'
              ? '均衡推进'
              : '紧推进',
      });
      const modelTask = generateText(getConfig(), {
        prompt,
        timeoutMs: STORY_CARD_MODEL_TIMEOUT_MS,
        maxAttempts: 2,
        maxTokens: 2048,
      }).then((raw) => parseStoryCardsFromModel(raw, ideaSeed));

      const jobId = createStoryCardJob(modelTask);

      // Return fallback immediately; model result arrives via job polling
      res.json({
        cards: buildFallbackStoryCards(ideaSeed, planning, batchIndex, previousHookTexts),
        source: 'fallback',
        jobId,
        warnings: ['模型响应较慢，已先生成本地保底开坑方向，后台仍在等待模型版。'],
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.get('/api/story-cards/jobs/:jobId', (req, res) => {
    const job = storyCardJobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Story card job not found' });
    }
    res.json(job);
  });

  app.post('/api/setup-task-refine', async (req, res) => {
    try {
      const { taskTitle = '', currentDraft = '', userRequest = '', storyContext = '', surface = 'world-onboarding' } = req.body;
      if (!taskTitle.trim()) {
        return res.status(400).json({ error: 'taskTitle is required' });
      }
      const promptAsset = resolvePromptAssetForSurface({
        surface,
        promptTemplates: getConfig().promptTemplates,
        preferredTemplateKey: 'setupTaskRefine',
      });
      const prompt = renderPromptTemplate(promptAsset.template, {
        taskTitle,
        currentDraft,
        userRequest,
        storyContext,
      });
      const text = await generateText(getConfig(), { prompt, timeoutMs: 90_000, maxAttempts: 2, maxTokens: 2048 });
      try {
        const parsed = JSON.parse(text);
        res.json({ text: parsed.result || text, changedFields: parsed.changedFields, reason: parsed.reason });
      } catch {
        res.json({ text });
      }
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/extract-world-setup', async (req, res) => {
    try {
      const { documentText = '' } = req.body;
      if (!documentText.trim()) {
        return res.status(400).json({ error: 'documentText is required' });
      }
      const prompt = `
你是一个世界观与设定提取分析师。
请阅读下面用户上传的小说设定文档/大纲，并提取出标准化的结构数据。
必须输出为合法的 JSON 格式，不要包含任何 json 代码块标记（如 \`\`\`json ），直接输出纯 JSON 字符串。

期望的 JSON 结构如下：
{
  "globalOutline": "提取的整体故事大纲（如果没有，则根据已有线索总结，如果完全没有则为空字符串）",
  "worldRules": "提取的世界观法则、力量体系等（如果没有则为空字符串）",
  "characters": [
    {
      "name": "角色名",
      "role": "protagonist" | "antagonist" | "supporting" | "extra",
      "summary": "一句话简介",
      "bio": "详细背景设定、性格",
      "traits": ["词条1", "词条2"]
    }
  ],
  "locations": [
    {
      "name": "地点名",
      "region": "所属势力/区域",
      "description": "详细描述"
    }
  ],
  "items": [
    {
      "name": "道具/物品名",
      "type": "类型(如法宝、科技造物等)",
      "description": "功能与外貌描述"
    }
  ],
  "timelineEvents": [
    {
      "title": "事件名称",
      "timestamp": "发生时间",
      "description": "事件详情",
      "statusTag": "已发生",
      "order": 1
    }
  ]
}

【设定文档内容】：
${documentText}
      `;
      const raw = await generateText(getConfig(), {
        prompt,
        timeoutMs: 90_000,
        maxAttempts: 2,
        maxTokens: 4096,
        responseMimeType: 'application/json',
        disableThinking: true,
      });
      const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
      res.json(JSON.parse(cleaned));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/editor-agent', async (req, res) => {
    try {
      const { userIntent = '', contextStr = '', surface = 'workspace-beats', continuationPackId } = req.body;
      if (!userIntent.trim()) {
        return res.status(400).json({ error: 'userIntent is required' });
      }

      // Load continuation pack context if provided
      let packContext = '';
      if (continuationPackId) {
        const pack = db.getContinuationPack(continuationPackId);
        if (pack) {
          packContext = buildContinuationContext(pack);
        }
      }

      const effectiveContextStr = packContext
        ? `${contextStr}\n\n${packContext}`
        : contextStr;

      const promptAsset = resolvePromptAssetForSurface({
        surface,
        promptTemplates: getConfig().promptTemplates,
        preferredTemplateKey: 'editorAgent',
      });
      const prompt = renderPromptTemplate(promptAsset.template, {
        PLANNER_SOUL,
        contextStr: effectiveContextStr,
        userIntent,
      });
      let text = '';
      try {
        text = await generateText(getConfig(), {
          prompt,
          timeoutMs: 8_000,
          maxAttempts: 1,
          maxTokens: 1600,
        });
      } catch (error) {
        console.warn('Editor agent fell back:', error);
        text = buildFallbackSceneBeats(userIntent);
      }
      res.json({ text });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/expand-fragment', async (req, res) => {
    try {
      const { content, type } = req.body;
      if (!content || typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ error: 'Content is required' });
      }
      const config = getConfig();
      const prompts: Record<string, string> = {
        scene: `你是一个小说创意扩展助手。请将以下场景灵感扩展为一段 200-300 字的场景细纲，包含：环境氛围、关键动作、情绪基调。\n灵感：${content}`,
        dialogue: `你是一个小说创意扩展助手。请将以下对话灵感扩展为一段 150-250 字的对话场景草案，包含：说话人、对话内容、对话中的潜台词。\n灵感：${content}`,
        character: `你是一个小说创意扩展助手。请将以下角色灵感扩展为一份 200-300 字的角色小传草案，包含：外貌、性格、核心欲望、背景故事。\n灵感：${content}`,
        plot_hook: `你是一个小说创意扩展助手。请将以下剧情创意扩展为一段 200-300 字的剧情展开方案，包含：起因、发展、高潮雏形、可能的转折。\n灵感：${content}`,
        world: `你是一个小说创意扩展助手。请将以下世界观灵感扩展为一段 200-300 字的设定描述，包含：规则逻辑、视觉特征、对故事的影响。\n灵感：${content}`,
      };
      const prompt = prompts[type] || prompts.scene;

      const expansion = await generateText(config, { prompt });
      if (!expansion) {
        return res.status(500).json({ error: 'AI returned empty response' });
      }
      res.json({ expansion });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/parse-doc', async (req, res) => {
    try {
      const { filename, filedata } = req.body;
      let text = '';

      if (filename.endsWith('.txt')) {
        text = Buffer.from(filedata, 'base64').toString('utf8');
      } else if (filename.endsWith('.docx')) {
        const mammoth = await import('mammoth');
        const buffer = Buffer.from(filedata, 'base64');
        const result = await mammoth.extractRawText({ buffer });
        text = result.value;
      } else {
        return res.status(400).json({ error: 'Unsupported file type.' });
      }

      // Now use AI to parse this text into World Bible Entities
      const prompt = `
你是一个小说世界观设定解析专家。用户上传了一份设定文档（内容在下方）。
请提取其中的世界观设定、角色信息、大纲、以及时间线等。

【提取要求】:
1. "globalOutline" (全局大纲): 一段概括性的长文。
2. "worldRules" (世界观设定): 一段概括性的长文。
3. "characters" (角色): name, role(protagonist|antagonist|supporting|extra), summary, bio(长文字), traits(数组)
4. "locations" (地点/地域): name, region, description
5. "items" (物品/法宝): name, type, description
6. "factions" (势力): name, leader, territory, description
7. "powerLevels" (境界等级): name, tier(数字), characteristics(特征描述), description
8. "timelineEvents" (时间线): title, timestamp, description, order(数字)

文档内容：
"""
${text.substring(0, 30000)}
"""

请严格以JSON格式输出，结构如下：
{
  "globalOutline": "...",
  "worldRules": "...",
  "characters": [...],
  "locations": [...],
  "items": [...],
  "factions": [...],
  "powerLevels": [...],
  "timelineEvents": [...]
}
`;

      let rawText = await generateText(getConfig(), { prompt });
      rawText = rawText.replace(/```(json)?/g, '').trim();

      res.json(JSON.parse(rawText));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  async function extractUploadedText(filename: string, filedata: string): Promise<string> {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.json')) {
      return Buffer.from(filedata, 'base64').toString('utf8');
    }
    if (lower.endsWith('.docx')) {
      const mammoth = await import('mammoth');
      const buffer = Buffer.from(filedata, 'base64');
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    throw new Error('Unsupported file type.');
  }

  app.post('/api/continuation-packs/parse', async (req, res) => {
    try {
      const { novelId = '', title = '', documents = [] } = req.body;
      if (!novelId.trim()) return res.status(400).json({ error: 'novelId is required' });
      if (!documents.length) return res.status(400).json({ error: 'At least one document is required' });

      const parsedDocs = await Promise.all(documents.map(async (doc: any) => {
        const text = await extractUploadedText(doc.filename, doc.filedata);
        const trimmed = text.slice(0, 60000);
        const chineseChars = trimmed.replace(/[^一-鿿]/g, '');
        if (chineseChars.length < 20) {
          throw new Error(`"${doc.filename}" 内容过短或无可识别中文文本，请检查文件。`);
        }
        return { filename: doc.filename, text: trimmed };
      }));

      const llmConfig = getConfig();
      const buildDocumentsForPrompt = (maxCharsPerDocument: number) =>
        parsedDocs.map((d: any) =>
          `【${d.filename}】\n${d.text.slice(0, maxCharsPerDocument)}\n`
        ).join('\n---\n');

      const shouldRetryWithShorterPrompt = (message: string) =>
        /only thinking\/reasoning content|empty response|可解析的 JSON|不完整的 JSON|LLM returned empty response/i.test(message);
      const promptAttempts = buildContinuationPackParseAttempts(llmConfig.baseUrl);

      let parsed: any = null;
      let lastParseError: unknown = null;
      for (const attempt of promptAttempts) {
        try {
          const raw = await generateText(llmConfig, {
            prompt: buildContinuationPackPrompt(
              buildDocumentsForPrompt(attempt.maxCharsPerDocument),
              attempt.compactMode,
            ),
            timeoutMs: 90_000,
            maxAttempts: 3,
            maxTokens: attempt.maxTokens,
            responseMimeType: 'application/json',
            disableThinking: true,
          });
          parsed = parseModelJsonPayload<any>(raw);
          break;
        } catch (error) {
          lastParseError = error;
          const message = error instanceof Error ? error.message : String(error);
          if (!shouldRetryWithShorterPrompt(message) || attempt === promptAttempts[promptAttempts.length - 1]) {
            throw error;
          }
        }
      }
      if (!parsed) {
        throw lastParseError instanceof Error ? lastParseError : new Error(String(lastParseError || '模型未返回可用 JSON，请重试。'));
      }

      const now = Date.now();
      const packId = `cont-pack-${now}`;
      const pack = {
        id: packId,
        novelId,
        title: title || '续写资料包',
        status: 'draft' as const,
        sourceDocuments: parsedDocs.map((d: any, i: number) => ({
          id: `${packId}-doc-${i}`,
          packId,
          filename: d.filename,
          kind: classifyContinuationSource(d.filename, d.text),
          text: d.text,
          excerpt: d.text.slice(0, 500),
          createdAt: now,
        })),
        canonFacts: (parsed.canonFacts || []).map((f: any, i: number) => ({ id: `${packId}-fact-${i}`, ...f })),
        characterStates: parsed.characterStates || [],
        plotState: parsed.plotState || { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
        styleProfile: parsed.styleProfile || { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
        contradictions: (parsed.contradictions || []).map((c: any, i: number) => ({ id: `${packId}-contra-${i}`, ...c })),
        sourceMap: parsed.sourceMap || { sections: [], keyConflicts: [] },
        readingQuestions: (parsed.readingQuestions || []).map((q: any, i: number) => ({ id: `${packId}-question-${i}`, ...q })),
        continuationGaps: (parsed.continuationGaps || []).map((g: any, i: number) => ({ id: `${packId}-gap-${i}`, ...g })),
        continuationTask: parsed.continuationTask || '',
        sourceBadge: 'user-uploaded' as const,
        createdAt: now,
        updatedAt: now,
      };

      db.createContinuationPack(pack);
      res.json({ pack });
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : String(e);
      if (/only thinking\/reasoning content|empty response|可解析的 JSON|不完整的 JSON|LLM returned empty response/i.test(message)) {
        return res.status(502).json({
          error: '模型未返回可用 JSON，请重试。',
        });
      }
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/audit', async (req, res) => {
    try {
      const { draftContent, sceneBeats, contextStr, skills = [], surface = 'chapter-polish' } = req.body;
      const skillsInfo = skills.length > 0
        ? `\n【当前挂载的叙事 DNA 插件】\n${skills.map((s: any) => `
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

      // Try new 5-dimension format first, fall back to legacy format
      const fiveDim = parseAuditFiveDim(rawFeedback);
      if (fiveDim) {
        const gate = evaluateAuditGate(
          Object.fromEntries(Object.entries(fiveDim.scores).map(([k, v]) => [k, (v as { score: number }).score])),
          (fiveDim as any).fatalIssues || [],
        );
        const feedback = renderFiveDimMarkdown(fiveDim);
        return res.json({
          feedback,
          score: fiveDim.totalScore,
          pass: gate.pass,
          failReason: gate.blockReason || fiveDim.failReason || null,
          scores: fiveDim.scores,
          gate,
        });
      }

      const structured = parseStructuredAuditResponse(rawFeedback);
      if (!structured) {
        return res.json({ feedback: rawFeedback });
      }

      const feedback = embedStructuredAudit(renderStructuredAuditMarkdown(structured), structured);
      res.json({ feedback, score: structured.score, structured });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  // API Route setup
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
      } = req.body;
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
      res.json({ text: rewritten });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  function buildEmptyContinuityReport() {
    return {
      score: 70,
      issues: [],
      proposedPatch: {
        characterUpdates: [],
        itemUpdates: [],
        foreshadowingUpdates: [],
        timelineEventsToCreate: [],
        foreshadowingsToCreate: [],
      },
    };
  }

function parseJsonOrEmptyReport(raw: string) {
  try {
    return extractContinuityReportJson(raw);
  } catch {
    return normalizeContinuityReport(buildEmptyContinuityReport());
  }
}

  app.post('/api/orchestrate', async (req, res) => {
    const {
      contextStr,
      sceneBeats,
      maxIterations = 2,
      draftContent = "",
      skills = [],
      includeCritic = true,
      draftingSurface = 'workspace-draft',
      reviewSurface = 'chapter-review',
    } = req.body;
    let orchestrateHeartbeat: ReturnType<typeof setInterval> | null = null;
    const clientAbortController = new AbortController();

    try {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      req.socket.setTimeout(0);
      orchestrateHeartbeat = setInterval(() => {
        if (!res.writableEnded) {
          res.write(':ping\n\n');
        }
      }, 30_000);

      req.on('close', () => {
        clientAbortController.abort();
        if (orchestrateHeartbeat) {
          clearInterval(orchestrateHeartbeat);
          orchestrateHeartbeat = null;
        }
      });

      const skillsInfo = buildSkillsPrompt(skills || []);
      let currentDraft = draftContent || "";
      let criticFeedback = "";
      let isValid = false;

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        const writerAsset = resolvePromptAssetForSurface({
          surface: draftingSurface,
          promptTemplates: getConfig().promptTemplates,
          preferredTemplateKey: 'orchestrateWriter',
        });
        const writerPrompt = renderPromptTemplate(writerAsset.template, {
          WRITER_SOUL,
          contextStr,
          skillsInfo,
          sceneBeats,
          criticFeedback: criticFeedback || '初稿阶段，请全力输出。',
        });

        res.write(`data: ${JSON.stringify({ type: 'status', message: 'Writer Agent 正在生成正文…' })}\n\n`);
        try {
          currentDraft = await generateText(getConfig(), {
            prompt: writerPrompt,
            ...ORCHESTRATE_WRITER_LLM_OPTIONS,
            signal: clientAbortController.signal,
          });
        } catch (error) {
          console.warn('Writer generation fell back to local draft:', error);
          currentDraft = buildFallbackDraft(sceneBeats, contextStr);
          res.write(`data: ${JSON.stringify({
            type: 'status',
            message: '模型响应过慢，已切换到本地保底草稿，建议稍后重试以获得更完整版本。',
          })}\n\n`);
        }
        await emitTextAsTokens(res, currentDraft);
        res.write(`data: ${JSON.stringify({ type: 'writer_done' })}\n\n`);

        if (!includeCritic) {
          break;
        }

        const criticAsset = resolvePromptAssetForSurface({
          surface: reviewSurface,
          promptTemplates: getConfig().promptTemplates,
          preferredTemplateKey: 'orchestrateCritic',
        });
        const criticPrompt = renderPromptTemplate(criticAsset.template, {
          CRITIC_SOUL,
          contextStr,
          skillsInfo,
          sceneBeats,
          currentDraft,
        });

        criticFeedback = await generateText(getConfig(), {
          prompt: criticPrompt,
          ...ORCHESTRATE_CRITIC_LLM_OPTIONS,
          signal: clientAbortController.signal,
        });
        isValid = criticFeedback.includes("PASS");
        res.write(`data: ${JSON.stringify({ type: 'critic_done', feedback: criticFeedback, isValid })}\n\n`);

        if (isValid) break;
      }
      clearInterval(orchestrateHeartbeat);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch (err) {
      clearInterval(orchestrateHeartbeat);
      console.error(err);
      res.write(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`);
      res.end();
    }
  });

  app.post('/api/chapter-production-runs/start', async (req, res) => {
    let runId: string | null = null;
    try {
      const { novelId = '', targetChapterId = '', userIntent = '', continuationPackId = '', surface = 'workspace-draft' } = req.body;
      if (!novelId.trim()) {
        return res.status(400).json({ error: 'novelId is required' });
      }

      const novel = db.getNovel(novelId);
      if (!novel) {
        return res.status(404).json({ error: 'Novel not found' });
      }

      // Load continuation pack context if provided
      let packContext = '';
      if (continuationPackId) {
        const pack = db.getContinuationPack(continuationPackId);
        if (pack) {
          packContext = buildContinuationContext(pack);
        }
      }

      const chapters = db.listChapters(novelId);
      const characters = db.listCharacters(novelId);
      const locations = db.listLocations(novelId);
      const items = db.listItems(novelId);
      const factions = db.listFactions(novelId);
      const powerLevels = db.listPowerLevels(novelId);
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
      const ledgerSummary = summarizeStoryStateLedger(ledger);
      const layered = buildLayeredLedgerSummary(ledger, chapters.length);
      const plannerContext = buildProductionPlannerContext(ledger);
      const writerContext = buildProductionWriterContext(ledger);
      const intent = normalizeProductionIntent(userIntent);
      runId = Date.now().toString();
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

      const plannerAsset = resolvePromptAssetForSurface({
        surface: 'workspace-beats',
        promptTemplates: getConfig().promptTemplates,
        preferredTemplateKey: 'editorAgent',
      });
      const layeredContext = [
        `【世界观(L1)】${layered.world}`,
        `【当前卷(L2)】${layered.currentArc}`,
        `【最近章节(L3)】${layered.recentChapters}`,
      ].join('\n\n');
      const productionPromptContexts = buildProductionPromptContexts({
        layeredContext,
        plannerContext,
        writerContext,
        continuationPackContext: packContext,
      });
      const plannerPrompt = renderPromptTemplate(plannerAsset.template, {
        PLANNER_SOUL,
        contextStr: productionPromptContexts.planner,
        userIntent: intent,
      });
      let sceneBeats = '';
      try {
        sceneBeats = await generateText(getConfig(), {
          prompt: plannerPrompt,
          timeoutMs: 30_000,
          maxAttempts: 1,
          maxTokens: 1600,
        });
      } catch (error) {
        console.warn('Chapter production planner fell back:', error);
        sceneBeats = buildFallbackSceneBeats(intent);
      }
      db.updateChapterProductionRun(runId, {
        sceneBeats,
      });

      const writerAsset = resolvePromptAssetForSurface({
        surface,
        promptTemplates: getConfig().promptTemplates,
        preferredTemplateKey: 'orchestrateWriter',
      });
      const writerPrompt = renderPromptTemplate(writerAsset.template, {
        WRITER_SOUL,
        contextStr: productionPromptContexts.writer,
        skillsInfo: buildSkillsPrompt(skills),
        sceneBeats,
        criticFeedback: '初稿阶段，请全力输出。',
      });
      let draftContent = '';
      try {
        draftContent = await generateText(getConfig(), {
          prompt: writerPrompt,
          timeoutMs: 60_000,
          maxAttempts: 1,
          maxTokens: 1600,
        });
      } catch (error) {
        console.warn('Chapter production writer fell back:', error);
        draftContent = buildFallbackDraft(sceneBeats, writerContext);
      }
      db.updateChapterProductionRun(runId, {
        sceneBeats,
        draftContent,
      });

      const styleAuditAsset = resolvePromptAssetForSurface({
        surface: 'chapter-polish',
        promptTemplates: getConfig().promptTemplates,
        preferredTemplateKey: 'manualAudit',
      });
      const styleAuditPrompt = renderPromptTemplate(styleAuditAsset.template, {
        contextStr: ledgerSummary.slice(0, 1200),
        skillsInfo: buildSkillsPrompt(skills).slice(0, 900),
        sceneBeats: sceneBeats.slice(0, 1400),
        draftContent: draftContent.slice(0, 2600),
      });
      let styleAudit = '';
      try {
        styleAudit = await generateText(getConfig(), {
          prompt: styleAuditPrompt,
          timeoutMs: 20_000,
          maxAttempts: 1,
          maxTokens: 800,
        });
      } catch (error) {
        console.warn('Chapter production style audit fell back:', error);
        styleAudit = '## 保底审计\n- 模型响应过慢，本次生产先生成可编辑草稿。\n- 建议稍后单独运行 AI 审计，检查人物一致性、分镜执行和节奏问题。';
      }
      db.updateChapterProductionRun(runId, {
        sceneBeats,
        draftContent,
        styleAudit,
      });

      const continuityPrompt = buildContinuityCriticPrompt({
        ledger,
        sceneBeats,
        draftContent,
      });
      let continuityReport = buildEmptyContinuityReport();
      try {
        const rawContinuity = await generateText(getConfig(), {
          prompt: continuityPrompt,
          timeoutMs: 20_000,
          maxAttempts: 1,
          maxTokens: 1200,
        });
        continuityReport = parseJsonOrEmptyReport(rawContinuity);
      } catch (error) {
        console.warn('Chapter production continuity critic fell back:', error);
      }

      const run = {
        status: 'review_required' as const,
        sceneBeats,
        draftContent,
        styleAudit,
        continuityReport,
      };

      db.updateChapterProductionRun(runId, run);
      res.json({ run: db.getChapterProductionRun(runId) });
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : String(e);
      if (runId) {
        db.updateChapterProductionRun(runId, {
          status: 'failed',
          errorMessage: message,
        });
      }
      res.status(500).json({ error: String(e) });
    }
  });

  // SSE helper for production run streaming
  function sseWrite(res: express.Response, payload: Record<string, unknown>) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  async function emitTextAsTokensWithType(res: express.Response, text: string, eventType: string) {
    const chunks = text.match(/.{1,24}/gs) || [];
    for (const chunk of chunks) {
      sseWrite(res, { type: eventType, content: chunk });
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
  }

  app.post('/api/chapter-production-runs/start-stream', async (req, res) => {
    let runId: string | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const clientAbortController = new AbortController();

    try {
      const {
        novelId = '',
        targetChapterId = '',
        userIntent = '',
        continuationPackId = '',
        surface = 'workspace-draft',
      } = req.body;
      if (!novelId.trim()) {
        res.status(400).json({ error: 'novelId is required' });
        return;
      }

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

      req.on('close', () => {
        clientAbortController.abort();
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      });

      // --- Data loading (same as non-streaming endpoint) ---
      const chapters = db.listChapters(novelId);
      const characters = db.listCharacters(novelId);
      const locations = db.listLocations(novelId);
      const items = db.listItems(novelId);
      const factions = db.listFactions(novelId);
      const powerLevels = db.listPowerLevels(novelId);
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
      const ledgerSummary = summarizeStoryStateLedger(ledger);
      const layered = buildLayeredLedgerSummary(ledger, chapters.length);
      const plannerContext = buildProductionPlannerContext(ledger);
      const writerContext = buildProductionWriterContext(ledger);
      const intent = normalizeProductionIntent(userIntent);
      runId = Date.now().toString();
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
        sceneBeats: fallbackBeats,
        draftContent: fallbackDraft,
        styleAudit: fallbackAudit,
        continuityReport: fallbackContinuity,
      });

      sseWrite(res, { type: 'status', message: '保底草稿已就绪，AI 正在后台生成更优版本...' });

      // ============================================================
      // Phase 2: Model calls (stream results as they arrive)
      // ============================================================

      // --- Planner ---
      const plannerAsset = resolvePromptAssetForSurface({
        surface: 'workspace-beats',
        promptTemplates: getConfig().promptTemplates,
        preferredTemplateKey: 'editorAgent',
      });
      const layeredContext = [
        `【世界观(L1)】${layered.world}`,
        `【当前卷(L2)】${layered.currentArc}`,
        `【最近章节(L3)】${layered.recentChapters}`,
      ].join('\n\n');
      const productionPromptContexts = buildProductionPromptContexts({
        layeredContext,
        plannerContext,
        writerContext,
        continuationPackContext: packContext,
      });
      const plannerPrompt = renderPromptTemplate(plannerAsset.template, {
        PLANNER_SOUL,
        contextStr: productionPromptContexts.planner,
        userIntent: intent,
      });

      let modelBeats = fallbackBeats;
      try {
        sseWrite(res, { type: 'status', message: 'AI 正在规划分镜...' });
        modelBeats = await generateText(getConfig(), {
          prompt: plannerPrompt,
          timeoutMs: 30_000,
          maxAttempts: 1,
          maxTokens: 1600,
          signal: clientAbortController.signal,
        });
        sseWrite(res, { type: 'model_beats', content: modelBeats });
        db.updateChapterProductionRun(runId, { sceneBeats: modelBeats });
      } catch (error) {
        console.warn('Chapter production stream planner fell back:', error);
        sseWrite(res, { type: 'status', message: '分镜模型响应过慢，继续使用保底分镜。' });
      }

      // --- Writer ---
      const writerAsset = resolvePromptAssetForSurface({
        surface,
        promptTemplates: getConfig().promptTemplates,
        preferredTemplateKey: 'orchestrateWriter',
      });
      const writerPrompt = renderPromptTemplate(writerAsset.template, {
        WRITER_SOUL,
        contextStr: productionPromptContexts.writer,
        skillsInfo: buildSkillsPrompt(skills),
        sceneBeats: modelBeats,
        criticFeedback: '初稿阶段，请全力输出。',
      });

      let modelDraft = fallbackDraft;
      try {
        sseWrite(res, { type: 'status', message: 'AI 正在撰写正文...' });
        modelDraft = await generateText(getConfig(), {
          prompt: writerPrompt,
          timeoutMs: 60_000,
          maxAttempts: 1,
          maxTokens: 1600,
          signal: clientAbortController.signal,
        });
        await emitTextAsTokensWithType(res, modelDraft, 'model_draft_token');
        sseWrite(res, { type: 'model_draft_done' });
        db.updateChapterProductionRun(runId, {
          sceneBeats: modelBeats,
          draftContent: modelDraft,
        });
      } catch (error) {
        console.warn('Chapter production stream writer fell back:', error);
        sseWrite(res, { type: 'status', message: '正文模型响应过慢，继续使用保底草稿。' });
      }

      // --- Style Audit ---
      const styleAuditAsset = resolvePromptAssetForSurface({
        surface: 'chapter-polish',
        promptTemplates: getConfig().promptTemplates,
        preferredTemplateKey: 'manualAudit',
      });
      const styleAuditPrompt = renderPromptTemplate(styleAuditAsset.template, {
        contextStr: ledgerSummary.slice(0, 1200),
        skillsInfo: buildSkillsPrompt(skills).slice(0, 900),
        sceneBeats: modelBeats.slice(0, 1400),
        draftContent: modelDraft.slice(0, 2600),
      });

      let modelAudit = fallbackAudit;
      try {
        sseWrite(res, { type: 'status', message: 'AI 正在审计文风...' });
        modelAudit = await generateText(getConfig(), {
          prompt: styleAuditPrompt,
          timeoutMs: 20_000,
          maxAttempts: 1,
          maxTokens: 800,
          signal: clientAbortController.signal,
        });
        sseWrite(res, { type: 'model_audit', content: modelAudit });
        db.updateChapterProductionRun(runId, {
          sceneBeats: modelBeats,
          draftContent: modelDraft,
          styleAudit: modelAudit,
        });
      } catch (error) {
        console.warn('Chapter production stream style audit fell back:', error);
      }

      // --- Continuity ---
      const continuityPrompt = buildContinuityCriticPrompt({
        ledger,
        sceneBeats: modelBeats,
        draftContent: modelDraft,
      });

      let continuityReport = fallbackContinuity;
      try {
        sseWrite(res, { type: 'status', message: 'AI 正在检查连续性...' });
        const rawContinuity = await generateText(getConfig(), {
          prompt: continuityPrompt,
          timeoutMs: 20_000,
          maxAttempts: 1,
          maxTokens: 1200,
          signal: clientAbortController.signal,
        });
        continuityReport = parseJsonOrEmptyReport(rawContinuity);
        sseWrite(res, { type: 'model_continuity', report: continuityReport });
      } catch (error) {
        console.warn('Chapter production stream continuity critic fell back:', error);
      }

      // --- Finalize ---
      const finalRun = {
        status: 'review_required' as const,
        sceneBeats: modelBeats,
        draftContent: modelDraft,
        styleAudit: modelAudit,
        continuityReport,
      };
      db.updateChapterProductionRun(runId, finalRun);

      sseWrite(res, { type: 'done', run: db.getChapterProductionRun(runId) });
      clearInterval(heartbeat);
      res.end();
    } catch (e) {
      clearInterval(heartbeat);
      console.error('Chapter production stream fatal error:', e);
      const message = e instanceof Error ? e.message : String(e);
      if (runId) {
        try {
          db.updateChapterProductionRun(runId, {
            status: 'failed',
            errorMessage: message,
          });
        } catch {}
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
      if (run.status !== 'review_required') {
        return res.status(400).json({ error: `Production run is not reviewable: ${run.status}` });
      }

      const chapters = db.listChapters(run.novelId);
      const now = Date.now();
      let chapterId = run.targetChapterId;
      const wordCount = run.draftContent.replace(/\s/g, '').length;

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

      const existingTimeline = db.listTimelineEvents(run.novelId);
      run.continuityReport.proposedPatch.timelineEventsToCreate.forEach((event, index) => {
        db.createTimelineEvent({
          id: `${now + 10 + index}`,
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

      run.continuityReport.proposedPatch.foreshadowingsToCreate.forEach((entry, index) => {
        db.createForeshadowing({
          id: `${now + 100 + index}`,
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

      db.updateChapterProductionRun(run.id, {
        status: 'applied',
        targetChapterId: chapterId,
      });

      res.json({ chapterId });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  // ---- Helper: build a full fallback skill deck from all segments (no model calls) ----
  function buildFullFallbackSkillResult(text: string) {
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

  // ---- Helper: process model segments and merge with fallback segments ----
  async function processModelSkillExtraction(
    text: string,
    segments: ReturnType<typeof buildBookEvidenceSegments>,
  ) {
    const modelSegments = segments.slice(0, MAX_SKILL_LLM_SEGMENTS);
    const fallbackSegments = segments.slice(MAX_SKILL_LLM_SEGMENTS);

    const segmentEvidence: SegmentSkillEvidence[] = [];
    const failedSegments: string[] = [];
    const modelRefusals: string[] = [];

    for (const segment of modelSegments) {
      try {
        const prompt = renderPromptTemplate(getPromptTemplate('extractSkill'), {
          text: segment.excerpt.substring(0, 12000),
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

  app.post('/api/extract-skill', async (req, res) => {
    try {
      const { text = '' } = req.body;

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

      // ================================================================
      // Phase 1 (fast): Build full fallback deck and return immediately.
      // This guarantees the user sees results within ~50ms, never a
      // blank screen. The source badge tells them it's local extraction.
      // ================================================================
      const fallbackResult = buildFullFallbackSkillResult(text);

      // ================================================================
      // Phase 2 (background): Fire model extraction as an async job.
      // When the model finishes, the client polls and replaces fallback
      // cards with AI-deep-analyzed versions.
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
      console.error(e);
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

  // Poll endpoint for skill extraction background jobs
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

  app.post('/api/generate-bio', async (req, res) => {
    try {
      const { name, role, summary, traits = [], background, features, habits, personality, inventory, abilities, globalOutline, worldRules } = req.body;

      const prompt = `
你是一个专业的创作协助 AI，擅长深度刻画小说角色。
请根据以下碎片的角色信息以及世界观设定，撰写一段富有深度、细节丰富且具有文学色彩的角色背景故事（Biography / 详细背景设定）。

【全局故事大纲】：${globalOutline || '无'}
【世界观法则】：${worldRules || '无'}

【角色名称】：${name}
【身份定位】：${role}
【核心简介】：${summary}
【性格特质】：${traits.join('、')}
${background ? `【背景经历】：${background}` : ''}
${features ? `【外貌特征】：${features}` : ''}
${habits ? `【行为习惯】：${habits}` : ''}
${personality ? `【人格魅力】：${personality}` : ''}
${inventory ? `【随身道具】：${inventory}` : ''}
${abilities ? `【独特能力】：${abilities}` : ''}

要求：
1. 语言精炼且富有张力，适合放在小说设定集中。
2. 不要只是简单罗列信息，要结合“世界观法则”和“主线大纲”通过描述勾勒出一个有血有肉的人物形象，或者为其补充符合世界观的过去经历片段。
3. 重点突出该角色与其身份定位（${role}）相符的独特性。
4. 字数在 200-400 字之间。
5. 直接输出故事内容，不要包含任何前导词（如“好的，这是为您生成的...”）。
      `;

      const bio = await generateText(getConfig(), { prompt });
      res.json({ bio });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/generate-outline', async (req, res) => {
    try {
      const { title, worldRules, seedOutline, expectedWordCount, surface = 'workspace-beats', continuationPackId } = req.body;

      // Load continuation pack context if provided
      let packContext = '';
      if (continuationPackId) {
        const pack = db.getContinuationPack(continuationPackId);
        if (pack) {
          packContext = buildContinuationContext(pack);
        }
      }

      const promptAsset = resolvePromptAssetForSurface({
        surface,
        promptTemplates: getConfig().promptTemplates,
        preferredTemplateKey: 'generateOutline',
      });
      const prompt = renderPromptTemplate(promptAsset.template, {
        expectedWordCount,
        title: title ? `小说名称：${title}` : '',
        worldRules: [
          worldRules ? `世界观及设定：${worldRules}` : '',
          packContext,
        ].filter(Boolean).join('\n\n'),
        seedOutline: seedOutline ? `用户的初始构思/种子创意：\n${seedOutline}` : '',
      });

      const outline = await generateText(getConfig(), { prompt });
      res.json({ outline });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/extract-entities', async (req, res) => {
    try {
      const { text = '', existingNames = [] } = req.body;

      const prompt = `
你是一个极为敏锐的设定集萃取 AI。请阅读下方的网文片段，从中提取所有的专有名词（包括：人物姓名、地点/据点/组织名称、特殊功法/道具/武器名称）。

网文片段：
"""
${text.substring(0, 15000)}
"""

当前数据库中已经存在的实体名称列表（Existing Entities）：
${existingNames && existingNames.length > 0 ? existingNames.join(', ') : '无'}

请仔细比对：
1. 本次片段中出现的名称，如果在“当前存在的实体名称”中，请归入 activeExisting。
2. 本次片段中出现的【新名称】（不在存量列表中），请归入 newEntities，并附带它在文中的简单上下文解释（50字以内）以及猜测的类型（如：character, location, item）。

请严格以 JSON 格式输出，不要包含 markdown 标记：
{
  "activeExisting": ["名字1", "名字2"],
  "newEntities": [
    { "name": "新名字A", "type": "character", "context": "在某酒馆出场的神秘老者大能" }
  ]
}
      `;

      let rawText = await generateText(getConfig(), { prompt });
      rawText = rawText.replace(/```(json)?/g, '').trim();

      res.json(JSON.parse(rawText));
    } catch (e) {
      console.error('Extract entities error:', e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/detect-foreshadowing', async (req, res) => {
    try {
      const { chapterContent, chapterTitle, existingForeshadowings } = req.body;
      if (!chapterContent || typeof chapterContent !== 'string' || !chapterContent.trim()) {
        return res.status(400).json({ error: 'Chapter content is required' });
      }
      const config = getConfig();
      const prompt = `你是一个小说伏笔分析专家。请阅读以下章节内容，找出其中可能的伏笔埋设点和伏笔回收点。

【已有伏笔列表】：${existingForeshadowings ? JSON.stringify(existingForeshadowings) : '无'}

【章节标题】：${chapterTitle}
【章节内容】：
${chapterContent.substring(0, 15000)}

请分析并输出 JSON 数组，每个元素包含：
- title: 伏笔标题（简短）
- description: 伏笔描述
- type: "planted"（新埋设）或 "payoff"（回收已有伏笔）
- relatedTo: 如果 type 是 payoff，填写对应的已有伏笔标题（或留空）

严格只输出 JSON 数组，不要包含 markdown 标记：
[{"title": "...", "description": "...", "type": "planted", "relatedTo": ""}]`;

      let raw = (await generateText(config, { prompt })).trim();
      raw = raw.replace(/```(json)?/g, '').trim();
      res.json(JSON.parse(raw));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/analyze-pacing', async (req, res) => {
    try {
      const { chapters } = req.body;
      if (!chapters || !Array.isArray(chapters) || chapters.length === 0) {
        return res.status(400).json({ error: 'Chapters array is required' });
      }
      const config = getConfig();
      const MAX_CHAPTERS = 50;
      const limited = chapters.slice(-MAX_CHAPTERS);
      const chapterList = limited.map((c: any) =>
        `第${c.order ?? '?'}章「${c.title ?? '无标题'}」(字数:${c.wordCount ?? 0})：${(c.content || '').substring(0, 500)}...`
      ).join('\n---\n');

      const prompt = `你是一个小说节奏分析专家。请对以下章节列表进行节奏诊断。

${chapterList}

请输出 JSON 数组，每个章节一个对象：
[
  {
    "chapterId": "章节 ID",
    "tensionScore": 0-100 的张力评分（冲突强度、悬念密度）,
    "payoffCount": 爽点/爆点数量,
    "emotionLabel": "情绪标签（如：紧张/温馨/压抑/燃/爽/悲）",
    "suggestion": "一句话节奏建议"
  }
]

严格只输出 JSON 数组，不要包含 markdown 标记。`;

      let raw = (await generateText(config, { prompt })).trim();
      raw = raw.replace(/```(json)?/g, '').trim();
      res.json(JSON.parse(raw));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  function escapeXml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  app.post('/api/export', async (req, res) => {
    try {
      const { novelId, format } = req.body;
      if (!novelId || !format) {
        return res.status(400).json({ error: 'novelId and format are required' });
      }
      const novel = db.getNovel(novelId);
      if (!novel) return res.status(404).json({ error: 'Novel not found' });
      const chapters = db.listChapters(novelId).sort((a, b) => a.order - b.order);

      if (format === 'txt') {
        let txt = `${novel.title}\n\n`;
        txt += `${novel.summary || ''}\n\n`;
        txt += `${'='.repeat(40)}\n\n`;
        for (const ch of chapters) {
          txt += `第${ch.order}章 ${ch.title}\n\n`;
          txt += `${ch.content || ''}\n\n`;
          txt += `${'-'.repeat(30)}\n\n`;
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(novel.title)}.txt"`);
        res.send(txt);
      } else if (format === 'epub') {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();

        // mimetype (must be first, uncompressed)
        zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

        // container.xml
        zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

        const escTitle = escapeXml(novel.title);

        // content.opf
        const manifestItems = chapters.map((ch, i) =>
          `<item id="ch${i}" href="ch${i}.xhtml" media-type="application/xhtml+xml"/>`
        ).join('\n');
        const spineItems = chapters.map((_, i) => `<itemref idref="ch${i}"/>`).join('\n');
        const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escTitle}</dc:title>
    <dc:creator>InkFlow</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="book-id">urn:inkflow:${novelId}</dc:identifier>
  </metadata>
  <manifest>
    ${manifestItems}
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`;
        zip.file('OEBPS/content.opf', opf);

        // Navigation
        const navLinks = chapters.map((ch, i) =>
          `<li><a href="ch${i}.xhtml">第${ch.order}章 ${escapeXml(ch.title)}</a></li>`
        ).join('\n');
        const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head>
<body><nav epub:type="toc"><h2>目录</h2><ol>${navLinks}</ol></nav></body>
</html>`;
        zip.file('OEBPS/nav.xhtml', nav);

        // Chapter files
        for (let i = 0; i < chapters.length; i++) {
          const ch = chapters[i];
          const escChapterTitle = escapeXml(ch.title);
          const paragraphs = (ch.content || '').split('\n').map(line =>
            `<p>${line ? escapeXml(line) : '&nbsp;'}</p>`
          ).join('\n');
          const html = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>第${ch.order}章 ${escChapterTitle}</title></head>
<body><h2>第${ch.order}章 ${escChapterTitle}</h2>
${paragraphs}
</body>
</html>`;
          zip.file(`OEBPS/ch${i}.xhtml`, html);
        }

        const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
        res.setHeader('Content-Type', 'application/epub+zip');
        res.setHeader('Content-Length', String(buf.length));
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(novel.title)}.epub"`);
        res.send(buf);
      } else {
        res.status(400).json({ error: 'Unsupported format' });
      }
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/generate-entity-details', async (req, res) => {
    try {
      const { name, type, context } = req.body;

      const prompt = `你是一个网文世界观架构师。系统在一个新章节中扫描到了一个新设定实体，请根据上下文为其生成一份初始的万物词典（World Bible）条目。

实体名称：${name}
初步判断的类型：${type} (可能是人物 character、地点 location、物品 item、概念等，你可以根据上下文自行调整)
提取的上下文：${context}

请严格根据类型输出不同的 JSON 结构（直接输出 JSON，不要 Markdown 标记）：

如果它最可能是【人物 Character】：
{
  "entityType": "character",
  "name": "${name}",
  "role": "supporting",
  "summary": "一句话简介",
  "traits": ["特性1", "特性2"],
  "bio": "根据上下文生成的背景设定补全（100字左右）"
}

如果它最可能是【地点 Location】：
{
  "entityType": "location",
  "name": "${name}",
  "region": "所属区域（根据上下文推理）",
  "description": "详细描述（100字左右）"
}

如果它最可能是【物品/概念 Item/Concept】：
{
  "entityType": "item",
  "name": "${name}",
  "type": "法宝、武器、丹药、功法等",
  "description": "详细描述及功能（100字左右）"
}
`;

      let rawText = await generateText(getConfig(), { prompt });
      rawText = rawText.replace(/```(json)?/g, '').trim();

      res.json(JSON.parse(rawText));
    } catch (e) {
      console.error('Generate entity details error:', e);
      res.status(500).json({ error: String(e) });
    }
  });

  const serveStaticApp = () => {
    const distPath = process.env.INKFLOW_STATIC_DIR || path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  };

  const disableDevViteMiddleware = process.env.DISABLE_VITE_DEV_MIDDLEWARE === '1';

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production" && !disableDevViteMiddleware) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log('Vite dev middleware enabled');
  } else {
    serveStaticApp();
  }

  const listen = (port: number) => {
    const server = app.listen(port, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${port}`);
      // In production (Electron), notify the main process of the port via stdout JSON
      if (process.env.NODE_ENV === 'production') {
        console.log(JSON.stringify({ port }));
      }
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && allowPortRetry && port < PORT + 50) {
        listen(port + 1);
        return;
      }
      throw error;
    });
  };

  listen(PORT);
}

startServer();
