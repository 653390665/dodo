import type {
  ContinuationPack,
  ContinuationSourceDocument,
  ContinuationSourceKind,
} from '../types';

export function classifyContinuationSource(filename: string, text: string): ContinuationSourceKind {
  const name = filename.toLowerCase();
  const body = text.slice(0, 3000);
  if (/世界观|设定|规则|体系|地图|势力/.test(name + body)) return 'world';
  if (/大纲|细纲|剧情|卷纲|章节/.test(name + body)) return 'outline';
  if (/人物|角色|主角|配角|反派/.test(name + body)) return 'characters';
  if (/正文|第[一二三四五六七八九十\d]+章|chapter/.test(name + body)) return 'manuscript';
  if (/样章|文风|风格|参考段落/.test(name + body)) return 'style_sample';
  return 'other';
}

export function buildContinuationSourceDocument(input: {
  packId: string;
  filename: string;
  text: string;
  now?: number;
}): ContinuationSourceDocument {
  const now = input.now ?? Date.now();
  const text = input.text.trim();
  return {
    id: `${input.packId}-doc-${Math.random().toString(36).slice(2, 10)}`,
    packId: input.packId,
    filename: input.filename,
    kind: classifyContinuationSource(input.filename, text),
    text,
    excerpt: text.slice(0, 500),
    createdAt: now,
  };
}

export function buildSourceMapContext(pack: ContinuationPack): string {
  const map = pack.sourceMap;
  if (!map) return '';
  const sections = map.sections
    .slice(0, 8)
    .map((s) => `- ${s.title}：${s.summary}`)
    .join('\n');
  const conflicts = map.keyConflicts.slice(0, 5).map((c) => `- ${c}`).join('\n');
  return [
    '【资料结构地图】',
    sections || '- 暂无',
    conflicts.length ? `\n【资料间冲突】\n${conflicts}` : '',
  ].filter(Boolean).join('\n');
}

export function buildReadingQuestionsContext(pack: ContinuationPack): string {
  const questions = pack.readingQuestions;
  if (!questions || questions.length === 0) return '';
  return [
    '【资料审读问题】',
    ...questions.slice(0, 8).map((q, i) => `${i + 1}. [${q.category}] ${q.question}\n   上下文：${q.context}`),
  ].join('\n');
}

export function buildContinuationGapsContext(pack: ContinuationPack): string {
  const gaps = pack.continuationGaps;
  if (!gaps || gaps.length === 0) return '';
  return [
    '【续写缺口】',
    ...gaps.slice(0, 6).map((g, i) => `${i + 1}. [${g.severity}] ${g.description}\n   建议方向：${g.suggestedDirection}`),
  ].join('\n');
}

/**
 * Compose a creation intent draft from pack sources.
 * Priority: continuationTask > plotState > gaps.
 * All non-empty sources are included.
 */
export function buildCreationIntentDraft(pack: ContinuationPack | null): string {
  if (!pack) return '';

  const parts: string[] = [];

  if (pack.continuationTask) {
    parts.push(pack.continuationTask);
  }

  if (pack.plotState.latestScene) {
    parts.push(`当前场景：${pack.plotState.latestScene}`);
  }

  if (pack.plotState.immediateConflict) {
    parts.push(`即时冲突：${pack.plotState.immediateConflict}`);
  }

  if (pack.plotState.nextLikelyMove) {
    parts.push(`下一步：${pack.plotState.nextLikelyMove}`);
  }

  const gaps = (pack.continuationGaps || [])
    .filter(g => g.severity === 'high' || g.severity === 'medium')
    .slice(0, 2);
  if (gaps.length > 0) {
    parts.push('续写方向：' + gaps.map(g => g.suggestedDirection).join('；'));
  }

  return parts.join('\n');
}

export function buildContinuationContext(pack: ContinuationPack): string {
  const hardFacts = pack.canonFacts
    .filter((fact) => fact.priority === 'hard')
    .slice(0, 20)
    .map((fact) => `- [${fact.category}] ${fact.text}`)
    .join('\n');
  const characters = pack.characterStates
    .slice(0, 8)
    .map((item) => `- ${item.name}：目标=${item.currentGoal}；情绪=${item.emotionalState}；关系=${item.relationshipNotes.join('、')}`)
    .join('\n');
  const hooks = pack.plotState.unresolvedHooks.slice(0, 10).map((hook) => `- ${hook}`).join('\n');
  const style = [
    `视角：${pack.styleProfile.pov}`,
    `节奏：${pack.styleProfile.pacing}`,
    `对白密度：${pack.styleProfile.dialogueDensity}`,
    `文风特征：${pack.styleProfile.proseTraits.join('、')}`,
    `避免：${pack.styleProfile.avoidTraits.join('、')}`,
  ].join('\n');

  const sourceMap = buildSourceMapContext(pack);
  const readingQuestions = buildReadingQuestionsContext(pack);
  const continuationGaps = buildContinuationGapsContext(pack);

  return [
    `【资料包续写任务】${pack.continuationTask}`,
    `【硬设定，不可违背】\n${hardFacts || '- 暂无'}`,
    `【当前剧情状态】\n时间线：${pack.plotState.currentTimeline}\n最近场景：${pack.plotState.latestScene}\n即时冲突：${pack.plotState.immediateConflict}\n下一步：${pack.plotState.nextLikelyMove}`,
    `【未解决伏笔】\n${hooks || '- 暂无'}`,
    `【人物当前状态】\n${characters || '- 暂无'}`,
    `【风格约束】\n${style}`,
    sourceMap,
    readingQuestions,
    continuationGaps,
  ].filter(Boolean).join('\n\n');
}
