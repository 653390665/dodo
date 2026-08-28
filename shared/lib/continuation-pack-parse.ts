export interface ContinuationPackParseAttempt {
  maxCharsPerDocument: number;
  maxTokens: number;
  compactMode: boolean;
}

function isMiniMaxProvider(baseUrl: string): boolean {
  return /api\.minima(xi|x\.io)/.test(baseUrl);
}

export function buildContinuationPackParseAttempts(baseUrl: string): ContinuationPackParseAttempt[] {
  if (isMiniMaxProvider(baseUrl)) {
    return [
      { maxCharsPerDocument: 2500, maxTokens: 2048, compactMode: false },
      { maxCharsPerDocument: 1500, maxTokens: 1536, compactMode: true },
      { maxCharsPerDocument: 800, maxTokens: 1024, compactMode: true },
      { maxCharsPerDocument: 400, maxTokens: 768, compactMode: true },
    ];
  }

  return [
    { maxCharsPerDocument: 15000, maxTokens: 4096, compactMode: false },
    { maxCharsPerDocument: 6000, maxTokens: 3072, compactMode: true },
    { maxCharsPerDocument: 3000, maxTokens: 2048, compactMode: true },
  ];
}

export function buildContinuationPackPrompt(documentsForPrompt: string, compactMode = false): string {
  const outputBudgetRules = compactMode
    ? [
        '6. 这是压缩重试模式：canonFacts 最多 5 条，characterStates 最多 4 条，contradictions 最多 3 条，readingQuestions 最多 2 条，continuationGaps 最多 2 条，sourceMap.sections 最多 4 条。',
        '7. 所有 evidence / summary / suggestedResolution / description 尽量压缩在 24 个汉字以内，能更短就更短。',
        '8. 能省略的解释就省略，优先保证 JSON 完整闭合，不要输出 Markdown，不要输出任何额外说明。',
      ].join('\n')
    : [
        '6. 控制输出体积：canonFacts 最多 8 条，characterStates 最多 6 条，contradictions / readingQuestions / continuationGaps 各最多 4 条，sourceMap.sections 最多 6 条。',
        '7. 每个 evidence / summary / suggestedResolution 尽量压缩在 40 个汉字以内，能短就短。',
        '8. 信息不足时返回空数组或空字符串，不要为了凑满字段而展开说明。',
      ].join('\n');

  return `
你是小说作品接管编辑。用户上传了一个资料包，需要你整理成可续写的结构化上下文。

硬规则：
1. 不要续写正文。
2. 不要补造未在资料中出现的硬设定。
3. 每条 hard canon 必须带 evidence，evidence 必须来自原文短摘。
4. 如果资料冲突，写入 contradictions，不要自行吞掉冲突。
5. 输出严格 JSON，不要 Markdown。
${outputBudgetRules}

输出结构：
{
  "canonFacts": [
    {"priority":"hard","category":"world","text":"...","evidence":"..."}
  ],
  "characterStates": [
    {"name":"...","role":"...","currentGoal":"...","emotionalState":"...","secrets":[],"relationshipNotes":[],"evidence":"..."}
  ],
  "plotState": {
    "currentTimeline":"...",
    "latestScene":"...",
    "unresolvedHooks":[],
    "immediateConflict":"...",
    "nextLikelyMove":"..."
  },
  "styleProfile": {
    "pov":"...",
    "tense":"...",
    "pacing":"...",
    "dialogueDensity":"...",
    "proseTraits":[],
    "avoidTraits":[],
    "sampleEvidence":"..."
  },
  "contradictions": [
    {"severity":"medium","summary":"...","conflictingEvidence":[],"suggestedResolution":"..."}
  ],
  "sourceMap": {
    "sections": [
      {"title":"...","summary":"...","sourceIds":[]}
    ],
    "keyConflicts": []
  },
  "readingQuestions": [
    {"question":"...","context":"...","category":"world|character|plot|style|continuity"}
  ],
  "continuationGaps": [
    {"description":"...","severity":"low|medium|high","suggestedDirection":"...","relatedFacts":[]}
  ],
  "continuationTask":"..."
}

资料包：
${documentsForPrompt}
`;
}
