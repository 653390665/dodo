import { mergePromptTemplates, type PromptTemplateKey } from '../../shared/config/prompt-templates';
import { PLANNER_SOUL, WRITER_SOUL, CRITIC_SOUL } from '../../shared/config/souls.js';
import { getConfig } from '../lib/config';
import type { Skill } from '../../shared/types';

import { resolveRuntimeCuratedPrompts } from './curated-skill-runtime.js';

export function buildSkillsPrompt(skills: Skill[]) {
  if (!skills || skills.length === 0) return "";

  const resolvedSkills = resolveRuntimeCuratedPrompts(skills);

  const allBannedElements = Array.from(new Set(resolvedSkills.flatMap(s => [
    ...(Array.isArray(s.bannedWords) ? s.bannedWords : []),
    ...(Array.isArray(s.bannedElements) ? s.bannedElements : [])
  ])));
  const allImagery = Array.from(new Set(resolvedSkills.flatMap(s => Array.isArray(s.imagery) ? s.imagery : [])));
  const allVocabulary = Array.from(new Set(resolvedSkills.flatMap(s => Array.isArray(s.vocabulary) ? s.vocabulary : [])));
  const allCorePatterns = Array.from(new Set(resolvedSkills.flatMap(s => Array.isArray(s.corePatterns) ? s.corePatterns : [])));

  const primarySkill = resolvedSkills[0];
  const secondarySkills = resolvedSkills.slice(1);

  let prompt = `\n【当前启用的写作能力卡组】\n`;
  prompt += `以下 ${resolvedSkills.length} 张能力卡会共同影响本次写作，请把它们融合成统一、自然的行文效果：\n\n`;

  prompt += `核心描述基调 (Primary Voice):\n`;
  prompt += `- 基于《${primarySkill.name}》：${primarySkill.style}\n`;
  if (primarySkill.sentenceStructure) prompt += `  句法要求："${primarySkill.sentenceStructure}"\n`;
  prompt += `  节奏推进遵循："${primarySkill.pacing}"\n`;
  if (primarySkill.characterTraits) prompt += `  核心人物特征模版："${primarySkill.characterTraits}"\n`;
  if (primarySkill.worldBuilding) prompt += `  世界观/力量体系感："${primarySkill.worldBuilding}"\n`;
  if (primarySkill.plotPattern) prompt += `  剧情/爽点套路结构："${primarySkill.plotPattern}"\n`;
  if (primarySkill.foreshadowing) prompt += `  悬念及伏笔手法："${primarySkill.foreshadowing}"\n`;
  prompt += `\n`;

  if (secondarySkills.length > 0) {
    prompt += `辅助能力卡：\n`;
    secondarySkills.forEach(s => {
      prompt += `- 融合《${s.name}》：在描写层引入其"${s.style}"的色彩。`;
      if (s.characterTraits) prompt += `引入人物特征：${s.characterTraits}。`;
      if (s.plotPattern) prompt += `借鉴剧情节奏：${s.plotPattern}。`;
      prompt += `\n`;
    });
    prompt += `\n`;
  }

  prompt += `全局语法规约 (Global Constraints):\n`;
  if (allImagery.length > 0) prompt += `- 【核心意象群】：${allImagery.join("、")} (在描写中高频出现这些符号)\n`;
  if (allVocabulary.length > 0) prompt += `- 【标志性词汇】：${allVocabulary.join("、")} (优先使用这些具有辨识度的词汇)\n`;
  if (allCorePatterns.length > 0) prompt += `- 【核心行文套路】：${allCorePatterns.join("、")} (在构建桥段时，请采纳这些模式)\n`;
  if (allBannedElements.length > 0) prompt += `- 【绝对禁忌红线】：${allBannedElements.join("、")} (如果你在文中写出这些设定或词汇，总编会立刻撕碎草稿)\n\n`;

  prompt += `风格对标样例 (Composite Few-Shots):\n`;
  resolvedSkills.forEach(s => {
    (Array.isArray(s.fewShots) ? s.fewShots : []).slice(0, 2).forEach((fs: string) => {
      prompt += `  * "${fs}" (来自 ${s.name})\n`;
    });
  });

  // ---- Deconstruction Card Runtime Rules ----
  const deconstructionCards = resolvedSkills.filter(s => s.deconstructionCardType);
  if (deconstructionCards.length > 0) {
    prompt += `\n【当前启用的拆书卡规则】\n`;
    prompt += `检测到已启用 ${deconstructionCards.length} 张专业拆书卡。请严格遵循以下卡牌规约：只吸收其交互规律、描写规律、信息铺垫方法与语言手感，绝对不能直接套用任何原有小说中的角色名、专有名词、地点等实体，避免产生冲突性污染。\n\n`;

    deconstructionCards.forEach(s => {
      const type = s.deconstructionCardType!;
      prompt += `<deconstruction_${type} name="${s.name}">\n`;
      prompt += `  <card_scope>${s.description}</card_scope>\n`;

      if (type === 'style-card' && s.style) {
        prompt += `  <style_rendering_rules>\n`;
        prompt += `    ${s.style}\n`;
        prompt += `  </style_rendering_rules>\n`;
      }
      if (type === 'character-card' && s.characterTraits) {
        prompt += `  <character_interaction_rules>\n`;
        prompt += `    ${s.characterTraits}\n`;
        prompt += `  </character_interaction_rules>\n`;
      }
      if (type === 'pacing-card' && s.pacing) {
        prompt += `  <pacing_density_rules>\n`;
        prompt += `    ${s.pacing}\n`;
        prompt += `  </pacing_density_rules>\n`;
      }
      if (type === 'worldview-card' && s.worldBuilding) {
        prompt += `  <world_logic_rules>\n`;
        prompt += `    ${s.worldBuilding}\n`;
        prompt += `  </world_logic_rules>\n`;
      }
      if (type === 'conflict-card' && s.plotPattern) {
        prompt += `  <conflict_tension_rules>\n`;
        prompt += `    ${s.plotPattern}\n`;
        prompt += `  </conflict_tension_rules>\n`;
      }
      if (type === 'hook-card' && s.foreshadowing) {
        prompt += `  <hook_suspense_rules>\n`;
        prompt += `    ${s.foreshadowing}\n`;
        prompt += `  </hook_suspense_rules>\n`;
      }
      if (type === 'platform-card') {
        prompt += `  <platform_preference_rules>\n`;
        if (s.style) prompt += `    风格规约: ${s.style}\n`;
        if (s.pacing) prompt += `    节奏规约: ${s.pacing}\n`;
        if (s.plotPattern) prompt += `    情节爽点: ${s.plotPattern}\n`;
        prompt += `  </platform_preference_rules>\n`;
      }

      if (Array.isArray(s.fewShots) && s.fewShots.length > 0) {
        prompt += `  <transferable_few_shots>\n`;
        s.fewShots.forEach((shot: string, idx: number) => {
          prompt += `    <shot_${idx + 1}>${shot}</shot_${idx + 1}>\n`;
        });
        prompt += `  </transferable_few_shots>\n`;
      }
      prompt += `</deconstruction_${type}>\n\n`;
    });
  }

  prompt += `\n指令：不要生硬堆砌，要把上面提到的《人物特征》、《世界观》、《剧情》、《设定》和写作方式有机相融，打造独属于你的复合风格。`;
  return prompt;
}

export function getPromptTemplate(key: PromptTemplateKey): string {
  return mergePromptTemplates(getConfig().promptTemplates)[key];
}

export function renderPromptTemplate(template: string, values: Record<string, string | number | undefined>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, rawKey) => {
    const key = rawKey as keyof typeof values;
    const value = values[key];
    return value == null ? '' : String(value);
  });
}

export const AUDIT_OUTPUT_CONTRACT = `

### 最终输出契约（覆盖旧模板中的冲突格式）
只输出一个 JSON 对象；第一字符必须是 {，最后一字符必须是 }。禁止 markdown、解释文字和思考标签。
顶层必须完整包含 scores、totalScore、pass、failReason、fatalIssues、surgerySuggestions、evidence。scores 必须且只能包含可读性、分镜执行度、冲突推进度、风格契合度、网文章节感五项，每项包含 0-10 的 score 和具体 reason；totalScore 必须等于五项之和。
任一维度<4或totalScore<30时 pass 必须为 false，fatalIssues 至少1条。正文含创作元数据或问答残留时，即使五维分数较高也必须 pass=false 并至少报告一条对应 fatalIssues。每条 fatalIssues 必须完整包含 issueType、issueSubtype、severity、snippet、explanation、patchHint；六个字段一个都不能省略，禁止用 reason、suggestion 或 suggestedFix 替代 explanation、patchHint；snippet 必须原字原样来自正文。没有问题时 fatalIssues 输出空数组。
evidence 必须是数组，并至少各包含一条 scene_execution、character_state、hard_canon、foreshadowing 证据；每项必须包含 category、severity、quote、explanation、suggestedFix，quote 必须原字原样来自正文。缺少任一类别时，即使五维分数达标也不得声明 pass=true。
fatalIssues 条目骨架（每一条都必须填满六个字段）：[{"issueType":"style-slop","issueSubtype":"ai-cliche","severity":"major","snippet":"正文原句","explanation":"具体说明问题","patchHint":"给出可执行的局部修补"}]
JSON 顶层骨架（请严格按此结构填值，不要改字段名）：
{"scores":{"可读性":{"score":0,"reason":""},"分镜执行度":{"score":0,"reason":""},"冲突推进度":{"score":0,"reason":""},"风格契合度":{"score":0,"reason":""},"网文章节感":{"score":0,"reason":""}},"totalScore":0,"pass":false,"failReason":"","fatalIssues":[],"surgerySuggestions":[],"evidence":[]}`;

/** Build a bounded audit input that preserves source offsets for evidence snippets. */
export function buildAuditWindow(text: string | undefined, maxChars = 7800): string {
  const normalized = String(text || '').trim();
  if (!normalized) return '';
  if (normalized.length <= maxChars) {
    return `【审稿窗口 full chars=0-${normalized.length}】\n${normalized}`;
  }

  // Reserve explicit separators and labels, while guaranteeing the final
  // section contains the chapter ending and its hook/foreshadowing.
  const labelOverhead = 480;
  const contentBudget = Math.max(900, maxChars - labelOverhead);
  const openingLength = Math.min(2200, Math.floor(contentBudget * 0.3));
  const endingLength = Math.min(3000, Math.max(900, Math.floor(contentBudget * 0.4)));
  const middleLength = Math.max(400, contentBudget - openingLength - endingLength);
  const middleStart = Math.max(openingLength, Math.floor((normalized.length - middleLength) / 2));
  const middleEnd = Math.min(normalized.length - endingLength, middleStart + middleLength);
  const sections = [
    { label: 'opening', start: 0, end: openingLength },
    { label: 'middle', start: middleStart, end: middleEnd },
    { label: 'ending', start: Math.max(0, normalized.length - endingLength), end: normalized.length },
  ];
  return sections
    .map(({ label, start, end }) => `【审稿窗口 ${label} chars=${start}-${end}】\n${normalized.slice(start, end)}`)
    .join('\n\n【审稿窗口分隔：非连续原文，禁止补写省略段】\n\n');
}

const AUDIT_RESIDUE_LINE = /^(?:作品|作者|摘要|章节标题|提纲|全局大纲|关键人物|关键道具|开放伏笔|人物状态|地点状态|道具状态|势力状态|力量体系|时间线|问题|答案|问|答|说明|注释|analysis|answer|question)\s*[:：]/i;

/** Return exact source lines that must be reported as blocking audit issues. */
export function findAuditResidueSnippets(text: string | undefined): string[] {
  const lines = String(text || '')
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return Array.from(new Set(lines.filter((line) => AUDIT_RESIDUE_LINE.test(line)))).slice(0, 3);
}

/** Add a deterministic, source-linked reminder for residue the provider must not overlook. */
export function buildAuditResidueContract(text: string | undefined): string {
  const snippets = findAuditResidueSnippets(text);
  if (snippets.length === 0) return '';
  return `\n\n### 强制残留拦截（不可跳过）\n正文窗口命中以下原文行：\n${snippets.map((snippet) => `- ${snippet}`).join('\n')}\n这些行属于创作元数据或问答残留，必须至少生成一条 fatalIssues；snippet 必须逐字复制命中的原文行，issueType/issueSubtype 使用 general 也不能省略 explanation 与 patchHint。即使其他五维评分较高，pass 仍必须为 false。`;
}

/** Check that a structured result contains evidence for every deterministic residue hit. */
export function auditCoversResidueSnippets(
  text: string | undefined,
  issues: Array<{ snippet?: string }>,
): boolean {
  const snippets = findAuditResidueSnippets(text);
  if (snippets.length === 0) return true;
  return snippets.every((source) => issues.some((issue) => {
    const reported = String(issue.snippet || '').trim();
    return Boolean(reported) && (reported.includes(source) || source.includes(reported));
  }));
}

export function truncateForAudit(text: string | undefined, maxChars: number) {
  if (!text) return '';
  const normalized = String(text).trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}\n……（审计输入已截断）`;
}

/**
 * Resolve a chain module to its focused prompt template.
 * Each module gets only the context relevant to its scope,
 * producing shorter, more targeted prompts than the monolithic versions.
 */
export function resolveChainPrompt(
  module: string,
  context: Record<string, string>,
): { template: string; prompt: string } {
  const key = module as PromptTemplateKey;
  const template = getPromptTemplate(key);
  const prompt = renderPromptTemplate(template, context);
  return { template, prompt };
}

/** Keep user text data-only when embedded in XML-like prompt delimiters. */
export function wrapUserInput(text: string): string {
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  return `<user_input>\n${escaped}\n</user_input>`;
}

export function buildPromptTemplateTest(key: PromptTemplateKey, template: string): { prompt?: string; systemInstruction?: string } {
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
      prompt: '请为"雨夜武侠 + 悬疑酒馆"构思三个不同气质的开篇灵感。',
    };
  }

  return {
    prompt: renderPromptTemplate(template, sampleValues),
  };
}
