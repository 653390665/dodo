import { mergePromptTemplates, type PromptTemplateKey } from '../../shared/config/prompt-templates';
import { PLANNER_SOUL, WRITER_SOUL, CRITIC_SOUL } from '../../shared/config/souls.js';
import { getConfig } from '../lib/config';
import type { Skill } from '../../shared/types';

export function buildSkillsPrompt(skills: Skill[]) {
  if (!skills || skills.length === 0) return "";

  const allBannedElements = Array.from(new Set(skills.flatMap(s => [
    ...(Array.isArray(s.bannedWords) ? s.bannedWords : []),
    ...(Array.isArray(s.bannedElements) ? s.bannedElements : [])
  ])));
  const allImagery = Array.from(new Set(skills.flatMap(s => Array.isArray(s.imagery) ? s.imagery : [])));
  const allVocabulary = Array.from(new Set(skills.flatMap(s => Array.isArray(s.vocabulary) ? s.vocabulary : [])));
  const allCorePatterns = Array.from(new Set(skills.flatMap(s => Array.isArray(s.corePatterns) ? s.corePatterns : [])));

  const primarySkill = skills[0];
  const secondarySkills = skills.slice(1);

  let prompt = `\n【当前挂载的复合叙事 DNA (Composite Narrative Signature)】\n`;
  prompt += `你现在的文字灵魂由以下 ${skills.length} 个维度交织而成，请进行深度化学反应式的融合：\n\n`;

  prompt += `核心描述基调 (Primary Voice)：\n`;
  prompt += `- 基于《${primarySkill.name}》：${primarySkill.style}\n`;
  if (primarySkill.sentenceStructure) prompt += `  句法要求："${primarySkill.sentenceStructure}"\n`;
  prompt += `  节奏推进遵循："${primarySkill.pacing}"\n`;
  if (primarySkill.characterTraits) prompt += `  核心人物特征模版："${primarySkill.characterTraits}"\n`;
  if (primarySkill.worldBuilding) prompt += `  世界观/力量体系感："${primarySkill.worldBuilding}"\n`;
  if (primarySkill.plotPattern) prompt += `  剧情/爽点套路结构："${primarySkill.plotPattern}"\n`;
  if (primarySkill.foreshadowing) prompt += `  悬念及伏笔手法："${primarySkill.foreshadowing}"\n`;
  prompt += `\n`;

  if (secondarySkills.length > 0) {
    prompt += `质感滤镜与大纲补强 (Flavor Overlays)：\n`;
    secondarySkills.forEach(s => {
      prompt += `- 融合《${s.name}》：在描写层引入其"${s.style}"的色彩。`;
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
    (Array.isArray(s.fewShots) ? s.fewShots : []).slice(0, 2).forEach((fs: string) => {
      prompt += `  * "${fs}" (来自 ${s.name})\n`;
    });
  });

  // ---- Deconstruction Card Injector (XML Overlays) ----
  const deconstructionCards = skills.filter(s => s.deconstructionCardType);
  if (deconstructionCards.length > 0) {
    prompt += `\n【Deconstruction Card Injector】\n`;
    prompt += `检测到挂载了 ${deconstructionCards.length} 张专业拆书卡。为了实现最佳的白标迁移（White-Label Transfer），请严格遵循以下卡牌规约与注入指令（你必须仅吸收其交互规律、描写规律、信息铺垫方法与语言手感，绝对不能直接套用任何原有小说中的角色名、专有名词、地点等实体，避免产生冲突性污染）：\n\n`;

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
        s.fewShots.forEach((shot, idx) => {
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

/** Wrap user-supplied text in XML tags to prevent prompt injection */
export function wrapUserInput(text: string): string {
  return `<user_input>\n${text}\n</user_input>`;
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
