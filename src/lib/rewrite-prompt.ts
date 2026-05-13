export interface RewritePromptInput {
  text: string;
  instruction?: string;
  contextStr?: string;
  auditFeedback?: string;
  sceneBeats?: string;
  mode?: 'selection' | 'chapter-polish' | 'surgical-patch';
  beforeContext?: string;
  afterContext?: string;
  auditIssue?: string;
}

export function buildRewritePrompt({
  text,
  instruction,
  contextStr = '',
  auditFeedback = '',
  sceneBeats = '',
  mode = 'selection',
  beforeContext = '',
  afterContext = '',
  auditIssue = '',
}: RewritePromptInput): string {
  const baseInstruction = instruction?.trim()
    ? `【用户的改写要求 / 改写方向】\n${instruction}`
    : '【润色要求】：请在保持原意和主线剧情不变的前提下，优化词境、修整重复词汇，使文字更加流畅、富有画面感和情绪张力。';

  const modeInstruction = mode === 'chapter-polish'
    ? `这次不是局部润色，而是“根据审计意见对整章做一次手术式精修”。

精修原则：
1. 以【需要改写的原段落】为底稿，但允许为了解决问题而重写“被点名的段落”及其前后 1-2 段衔接。
2. 优先处理【总编审计意见】里点名的硬伤；没有被点名的段落不要大动，但如果前后衔接会因此受损，可以顺手补一刀让章节读起来更顺。
3. 必须保住原有剧情顺序、分镜骨架、关键信息和悬念落点，不要新增支线，不要擅自改设定。
4. 如果审计指出“信息释出太快/藏得不够”，允许你重写那一小段的动作链、视线链、停顿链，把压力和留白真正补出来，而不是只换几个词。
5. 如果审计指出“动作语义空白”，要么赋予动作明确意图与上下文，要么删掉并换成更清晰的动作。
6. 如果审计指出“称谓重复、表达别扭、旁白说教”，请直接把相关句子改写得更自然，不要机械保留原句。
7. 对已经成立的好句、有效气氛、有效钩子尽量保留，但不要为了“保留”而放过已经影响可读性的坏句。
8. 精修后的版本必须仍然像一章完整正文，而不是“修过的摘要”或“批注版草稿”。`
    : mode === 'surgical-patch'
      ? `这次是局部手术式修补，请只重写这一小段。

【前文衔接】
${beforeContext}

【后文衔接】
${afterContext}

${auditIssue ? `【本段对应的审计问题】\n${auditIssue}\n` : ''}

修补原则：
1. 你只允许重写【需要改写的原段落】这一小段。
2. 你必须参考【前文衔接】和【后文衔接】，让改写后的段落自然接上。
3. 不要扩写整章，不要重复前后段，不要新增支线。
4. 如果审计问题是“重复/冗余”，请直接压缩掉重复信息。
5. 如果审计问题是“信息过直白/动作空白/指代不稳”，请只修这一处，并保持原剧情落点。
6. 直接输出替换后的目标段落，不要输出解释、标题、引号或 Markdown。`
      : '这次是局部改写，请只重写选中的片段，不要擅自扩写整章。';

  const finalInstruction = mode === 'surgical-patch'
    ? '你的任务是让这一小段接得更顺、更准、更像已成稿正文，只输出修好的替换段。'
    : mode === 'chapter-polish'
      ? '你的任务是“保留这章的骨架和有效气氛，但把被审计点名的坏段落真正修到位”。不要写成全新章节，也不要只做表面换词。'
      : '字数应该与原段落大体相当（也可以稍作合理的增删以圆润文笔）。';

  return `
你是一个顶级的网文主编及文学润色大师。用户正在创作一部长篇小说，并希望你改写或润色下面提供的一段文字。

【整体世界观与上下文背景】
${contextStr}

${sceneBeats ? `【本节分镜蓝图】\n${sceneBeats}\n` : ''}

${auditFeedback ? `【总编审计意见】\n${auditFeedback}\n` : ''}

【需要改写的原段落】
"""
${text}
"""

${baseInstruction}

${modeInstruction}

请结合以上【整体世界观与上下文背景】（尤其是其中挂载的技能插件、文风、红线等设定）、【本节分镜蓝图】以及【总编审计意见】，直接输出改写后的文本。不要输出任何多余的客套话或前导词。${finalInstruction}
  `;
}
