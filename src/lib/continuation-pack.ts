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

  return [
    `【资料包续写任务】${pack.continuationTask}`,
    `【硬设定，不可违背】\n${hardFacts || '- 暂无'}`,
    `【当前剧情状态】\n时间线：${pack.plotState.currentTimeline}\n最近场景：${pack.plotState.latestScene}\n即时冲突：${pack.plotState.immediateConflict}\n下一步：${pack.plotState.nextLikelyMove}`,
    `【未解决伏笔】\n${hooks || '- 暂无'}`,
    `【人物当前状态】\n${characters || '- 暂无'}`,
    `【风格约束】\n${style}`,
  ].join('\n\n');
}
