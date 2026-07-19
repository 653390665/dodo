import { scoreSlop } from '../../shared/lib/slop-scorer';

/**
 * PROMPT_GUARD_RULES
 * Hardcore anti-AI-slop rules injected at the system instruction level.
 * 包含禁词红线、Show Don't Tell 动作描写、长短句结合等最高优先级的写作规范。
 */
export const PROMPT_GUARD_RULES = `
【去AI俗套-提示词质量守卫门控 (Prompt Quality Guard Gate)】
由于当前请求属于创作者写作或润色任务，底座系统已自动加载并激活【去AI味物理级硬核门控】。你必须无条件服从以下写作准则：

1. 🚫 【禁词红线 (Banned Cliches)】：
   在你的生成文本中，绝对禁止出现以下词汇和句式：
   - 瞳孔一缩 / 瞳孔微缩 / 倒戏一口凉气 / 倒吸冷气 / 倒吸凉气
   - 不由得多看了两眼 / 多看了两眼 / 嘴角微扬 / 嘴角上扬 / 嘴角勾起一抹
   - 眼中闪过一丝 / 眼里闪过一抹 / 眼神中闪过 / 心中一凛 / 心头一震
   - 脸色一变 / 脸色微变 / 浑身上下散发 / 说时迟那时快 / 电光火石之间
   - 不由自主 / 咬了咬牙 / 捏了一把汗 / 坚毅的眼神 / 不禁 / 宛如 / 宛若
   - 不是……而是…… / 从某种程度上 / 毋庸置疑 / 总而言之 / 值得一提的是
   - 在……的背景下 / 毫无疑问 / 显而易见 / 可以说 / 不得不讲 / 不得不承认

2. 🎬 【“Show, Don't Tell” 表演级动作细节 (Action Over Emotion Labels)】：
   - 绝不允许使用现成的情感标签（如“他感到非常生气”、“她感到很悲伤”、“心中燃起怒火”）。
   - 必须通过角色的生理反应、视线变化、局部细节和周遭环境变化来表现情绪。
   - 动作描写必须简洁、利落，富有镜头感。避免重复堆列平庸动作（如“他走过去，坐下，叹了口吻”）。

3. 🥁 【句式长短错落与对白张力 (Sentence Variety & Dialogue Subtext)】：
   - 严禁连续出现“他+动词”的单一主谓短段落。
   - 战斗、追逐等冲突场面，段落长度控制在2-3行，大量采用15字以内的短促动作句。
   - 角色台词必须简洁有张力，充满潜台词，严禁说明书式、科普式的大段独白（Info-Dump）。

4. 🛡️ 【自检纠错门控 (Internal Self-Check)】：
   - 在最终输出前，你的大脑必须启动自检扫描机制，筛除所有包含上述禁词的句子。若发现违规，必须在内部自行重写纠错，仅输出重构后最完美的正文，严禁吐露任何自检说明。
`;

export interface OutputGuardResult {
  pass: boolean;
  score: number;
  violations: string[];
}

/**
 * Detects if the prompt or system instruction is related to creative writing or polishing.
 * 如果提示词或系统指令与小说、写作、润色、大纲相关，则自动激活输入守卫注入。
 */
export function isCreativeWritingRequest(prompt: string, systemInstruction?: string): boolean {
  const combined = `${prompt}\n${systemInstruction || ''}`.toLowerCase();
  const creativeKeywords = [
    '小说', '写作', '润色', '续写', '精修', '大纲', '章节', '草稿', 'beats',
    'novel', 'writer', 'chapter', 'draft', 'polish', 'rewrite', 'continuation',
    'critique', 'critic', 'audit',
    // Expanded keywords to ensure robust classification
    '故事', '创作', '主笔', '扩写', '写一', '写篇', '撰写', 'story', 'creative', 'write', 'author'
  ];
  return creativeKeywords.some(keyword => combined.includes(keyword));
}

/**
 * applyInputGuard
 * Injects the prompt guard rules into the systemInstruction (Input Gate).
 * 输入门拦截：若判定为创意写作请求，无缝追加去 AI 味硬核规则。
 */
export function applyInputGuard(prompt: string, systemInstruction?: string): { prompt: string; systemInstruction?: string } {
  if (!isCreativeWritingRequest(prompt, systemInstruction)) {
    return { prompt, systemInstruction };
  }

  const updatedInstruction = systemInstruction
    ? `${systemInstruction}\n\n${PROMPT_GUARD_RULES}`
    : PROMPT_GUARD_RULES;

  return { prompt, systemInstruction: updatedInstruction };
}

/**
 * checkOutputGuard
 * Validates the generated text against quality thresholds (Output Gate).
 * 输出门拦截：对生成的文本执行 Slop 机械特征扫描，若命中严重 AI 腔调或分数极低则触发拦截。
 */
export function checkOutputGuard(text: string): OutputGuardResult {
  const report = scoreSlop(text);

  // Filter hits to focus on high-priority AI writing cliches
  const violations = report.hits
    .filter(hit => ['ai_cliche', 'webnovel_trope', 'style_slop', 'tell_dont_show'].includes(hit.category))
    .map(hit => `第 ${hit.line} 行: "${hit.snippet}" (${hit.suggestion || 'AI俗套'})`);

  // Failed if the score is low (under 75) or has explicit critical cliches/banned words
  const pass = report.score >= 75 && violations.length === 0;

  return {
    pass,
    score: report.score,
    violations: Array.from(new Set(violations)).slice(0, 5), // limit to 5 violations to prevent token bloating
  };
}

/**
 * buildCorrectionPrompt
 * Assembles a highly focused, strict directive for rewriting failed text (Correction Gate).
 * 纠错重写生成器：构造具有高度纪律性的自检重写提示词，迫使 LLM 彻底冲洗俗套词。
 */
export function buildCorrectionPrompt(failedDraft: string, violations: string[]): string {
  return `
[SYSTEM CORRECTION GATE / 去AI俗套自动纠错重写]

你刚才生成的正文未能通过【去AI味质量守卫门控】。你的文本中包含以下 AI 俗套词汇或违反了“Show, Don't Tell”原则：
${violations.map(v => `- ${v}`).join('\n')}

下面是需要修改的原始草稿：
---
${failedDraft}
---

【强制重写指令】：
请你无条件对上述草稿进行深度重写，洗刷干净所有被检测到的俗套词和 AI 腔调。
1. 绝对禁止在重写后的文本中出现上述被点名的禁词或类似表达。
2. 强制使用具体的动作、生理反应和场景渲染（Show, Don't Tell）来替换抽象的情感词。
3. 保持原意和剧情走向，但在文字质感上实现极致的精简化、镜头化。
4. 【极其重要】：你必须直接输出重写后的最完美的纯正文内容，严禁在回复中包含任何道歉、解释、过渡或客套话（如“好的，这是修改后的内容”等）。
`;
}
