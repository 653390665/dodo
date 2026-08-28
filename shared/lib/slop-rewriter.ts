/**
 * Deterministic, zero-API polish preview for the one-shot de-AI cards.
 * It only removes or tightens high-confidence filler phrases and keeps plot
 * content intact. Deep rewriting still belongs to the normal audit polish flow.
 */
export function buildSlopRewritePreview(text: string): string {
  let preview = text.replace(/\r\n?/g, '\n');
  const replacements: Array<[RegExp, string]> = [
    [/这不是([^，。；\n]{1,20})而是([^，。；\n]+)([，。；]?)/g, '这是$2$3'],
    [/不是([^，。；\n]{1,20})而是([^，。；\n]+)([，。；]?)/g, '是$2$3'],
    [/(?:从某种程度上|在某种程度上|毋庸置疑|毫无疑问|显而易见|值得一提的是|总而言之|换句话说|不得不说|可以说是|可以说)[，,]*/g, ''],
    [/伴随着([^，。；\n]{1,15})的(?:发展|推进)[，,]?/g, '$1推进中，'],
    [/在([^，。；\n]{1,10})的过程中/g, '$1时'],
    [/这意味着/g, '这说明'],
    [/原因在于/g, '因为'],
    [/意思是说/g, '也就是'],
    [/他深吸一口气[，,]?/g, ''],
    [/她深吸一口气[，,]?/g, ''],
    [/眼神里充满了/g, '眼神带着'],
    [/目光[中里]闪过一丝([^，。；\n]+)/g, '目光带着$1'],
    [/眼神[中里]闪过一丝([^，。；\n]+)/g, '眼神带着$1'],
    [/情感在胸中(?:涌动|翻腾)[，,]?/g, '胸口发紧，'],
    // Do not invent a physical action when the source only names an emotion.
    // Semantic rewriting belongs to the audit/polish flow, where the model
    // receives character and scene context. This deterministic card stays
    // loss-minimizing and only removes the filler wrapper.
    [/涌起一股无力感/g, '感到无力'],
    [/非常[地]?/g, ''],
    [/十分(?!钟|米|秒|之)[地]?/g, ''],
    [/极其[地]?/g, ''],
    // Weak actions are diagnostic findings, not safe substitutions. Replacing
    // them with a concrete movement would change plot facts and character
    // intent without enough context.
    [/试图(?:去|做)/g, '准备'],
  ];

  for (const [pattern, replacement] of replacements) {
    preview = preview.replace(pattern, replacement);
  }

  return preview
    .replace(/[ \t]+/g, ' ')
    .replace(/([，。；！？])\1+/g, '$1')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitLongCommaSentence(sentence: string): string {
  const end = sentence.match(/[。！？]$/)?.[0] || '';
  const body = end ? sentence.slice(0, -1) : sentence;
  const clauses = body.split('，').map((clause) => clause.trim()).filter(Boolean);
  if (clauses.length < 3 || body.length < 28) return sentence;

  const lines: string[] = [];
  for (let index = 0; index < clauses.length; index += 2) {
    lines.push(clauses.slice(index, index + 2).join('，'));
  }
  return `${lines.join('。\n')}${end}`;
}

export function buildRhythmRewritePreview(text: string): string {
  const preview = buildSlopRewritePreview(text);
  return preview
    .split('\n')
    .map((paragraph) => {
      if (paragraph.trim().length < 28) return paragraph;
      return (paragraph.match(/[^。！？]+[。！？]?/g) || [paragraph])
        .map(splitLongCommaSentence)
        .join('');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildCapabilityPolishPreview(capabilityId: string, text: string): string {
  return capabilityId === 'de-ai-rhythm-restorer'
    ? buildRhythmRewritePreview(text)
    : buildSlopRewritePreview(text);
}

export interface SlopContextRewriteInput {
  targetText: string;
  beforeContext?: string;
  afterContext?: string;
  issue: string;
  chapterContext?: string;
  sceneBeats?: string;
}

/**
 * Build the narrow prompt used by the normal context-aware rewrite flow.
 * This helper only describes the edit window; it never manufactures prose.
 */
export function buildSlopContextRewritePrompt(input: SlopContextRewriteInput): string {
  return [
    '【结构去AI腔局部精修】',
    '只修改目标片段，不要重写整章，不得新增角色、事实、关系、设定或事件后果。',
    '保持原叙事视角、时间顺序和人物声口；若无法在事实无损前提下修复，原样返回目标片段并标记需要人工处理。',
    '仅依据以下局部证据作答，不要引用日志、内部提示、平台参数或其他未提供正文。',
    `问题证据：${input.issue}`,
    `前文上下文：${input.beforeContext || '（无）'}`,
    `目标片段：${input.targetText}`,
    `后文上下文：${input.afterContext || '（无）'}`,
    input.chapterContext ? `章节/人物上下文：${input.chapterContext}` : '',
    input.sceneBeats ? `本场景目标：${input.sceneBeats}` : '',
    '只输出替换后的目标片段，不要输出分析、标题、解释或 Markdown。',
  ].filter(Boolean).join('\n');
}
