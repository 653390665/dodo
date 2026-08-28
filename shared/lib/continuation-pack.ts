import type {
  ContinuationPack,
  ContinuationSourceDocument,
  ContinuationSourceKind,
} from '../types';
import { isContinuationContradictionResolved } from './continuation-import-flow';
import type { ContextReceipt } from '../types';

function digest(input: string): string {
  // Deterministic SHA-256 implementation for browser and Node runtimes.
  const words = new Uint32Array(64); const k = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const bytes = new TextEncoder().encode(input); const bitLen = bytes.length * 8; const total = Math.ceil((bytes.length + 9) / 64) * 64; const data = new Uint8Array(total); data.set(bytes); data[bytes.length] = 128; new DataView(data.buffer).setUint32(total - 4, bitLen, false);
  let a=0x6a09e667,b=0xbb67ae85,c=0x3c6ef372,d=0xa54ff53a,e=0x510e527f,f=0x9b05688c,g=0x1f83d9ab,h=0x5be0cd19;
  const ro=(x:number,n:number)=>(x>>>n)|(x<<(32-n));
  for(let off=0;off<total;off+=64){for(let i=0;i<16;i++)words[i]=new DataView(data.buffer).getUint32(off+i*4,false);for(let i=16;i<64;i++){const s0=ro(words[i-15],7)^ro(words[i-15],18)^(words[i-15]>>>3),s1=ro(words[i-2],17)^ro(words[i-2],19)^(words[i-2]>>>10);words[i]=(words[i-16]+s0+words[i-7]+s1)>>>0;}let A=a,B=b,C=c,D=d,E=e,F=f,G=g,H=h;for(let i=0;i<64;i++){const S1=ro(E,6)^ro(E,11)^ro(E,25),ch=(E&F)^(~E&G),t1=(H+S1+ch+k[i]+words[i])>>>0,S0=ro(A,2)^ro(A,13)^ro(A,22),maj=(A&B)^(A&C)^(B&C),t2=(S0+maj)>>>0;H=G;G=F;F=E;E=(D+t1)>>>0;D=C;C=B;B=A;A=(t1+t2)>>>0;}a=(a+A)>>>0;b=(b+B)>>>0;c=(c+C)>>>0;d=(d+D)>>>0;e=(e+E)>>>0;f=(f+F)>>>0;g=(g+G)>>>0;h=(h+H)>>>0;}
  return [a,b,c,d,e,f,g,h].map(x=>x.toString(16).padStart(8,'0')).join('');
}

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
    sha256: digest(text),
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

  if (pack.plotState?.latestScene) {
    parts.push(`当前场景：${pack.plotState.latestScene}`);
  }

  if (pack.plotState?.immediateConflict) {
    parts.push(`即时冲突：${pack.plotState.immediateConflict}`);
  }

  if (pack.plotState?.nextLikelyMove) {
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

export function buildContinuationContext(pack: ContinuationPack, options: { includeStyle?: boolean } = {}): string {
  const hardFacts = (pack.canonFacts || [])
    .filter((fact) => fact.priority === 'hard')
    .slice(0, 20)
    .map((fact) => `- [${fact.category}] ${fact.text}`)
    .join('\n');
  const characters = (pack.characterStates || [])
    .slice(0, 8)
    .map((item) => `- ${item.name}：目标=${item.currentGoal}；情绪=${item.emotionalState}；关系=${(item.relationshipNotes || []).join('、')}`)
    .join('\n');
  const hooks = (pack.plotState?.unresolvedHooks || []).slice(0, 10).map((hook) => `- ${hook}`).join('\n');
  const sp = pack.styleProfile;
  const style = [
    `视角：${sp?.pov || '未设定'}`,
    `节奏：${sp?.pacing || '未设定'}`,
    `对白密度：${sp?.dialogueDensity || '未设定'}`,
    `文风特征：${(sp?.proseTraits || []).join('、') || '未设定'}`,
    `避免：${(sp?.avoidTraits || []).join('、') || '未设定'}`,
  ].join('\n');

  const sourceMap = buildSourceMapContext(pack);
  const readingQuestions = buildReadingQuestionsContext(pack);
  const continuationGaps = buildContinuationGapsContext(pack);
  const conflictResolutions = (pack.contradictions || [])
    .filter(isContinuationContradictionResolved)
    .slice(0, 10)
    .map((contradiction) => `- ${contradiction.summary}：${contradiction.acceptedResolution}`)
    .join('\n');

  return [
    `【资料包续写任务】${pack.continuationTask}`,
    `【硬设定，不可违背】\n${hardFacts || '- 暂无'}`,
    `【当前剧情状态】\n时间线：${pack.plotState?.currentTimeline || '未设定'}\n最近场景：${pack.plotState?.latestScene || '未设定'}\n即时冲突：${pack.plotState?.immediateConflict || '未设定'}\n下一步：${pack.plotState?.nextLikelyMove || '未设定'}`,
    `【未解决伏笔】\n${hooks || '- 暂无'}`,
    `【人物当前状态】\n${characters || '- 暂无'}`,
    options.includeStyle === false ? '' : `【风格约束】\n${style}`,
    conflictResolutions ? `【冲突裁决，优先遵循】\n${conflictResolutions}` : '',
    sourceMap,
    readingQuestions,
    continuationGaps,
  ].filter(Boolean).join('\n\n');
}

export function buildContinuationContextBundle(pack: ContinuationPack, options: number | { maxChars?: number; includeStyle?: boolean; runtimeSources?: Array<{ id: string; label: string; text: string; itemCount?: number; version?: string }> } = 50_000): { text: string; receipt: ContextReceipt } {
  const maxChars = typeof options === 'number' ? options : options.maxChars ?? 50_000;
  const runtimeSources = typeof options === 'number' ? [] : options.runtimeSources || [];
  const packFull = buildContinuationContext(pack, { includeStyle: typeof options === 'number' ? true : options.includeStyle });
  const uniqueRuntimeSources = runtimeSources.filter((source, index, list) => list.findIndex((candidate) => candidate.id === source.id) === index);
  const runtimeSegments = uniqueRuntimeSources.map((source) => `【${source.label}】\n${source.text}`);
  const runtimeText = runtimeSegments.join('\n\n');
  const full = [packFull, runtimeText].filter(Boolean).join('\n\n');
  const text = full.slice(0, maxChars);
  const sourceIds = pack.sourceDocuments.map((doc) => doc.id);
  const sources = [{ id: 'continuation-pack', label: '资料包', sha256: digest(text.slice(0, Math.min(packFull.length, text.length))), chars: Math.min(packFull.length, text.length), itemCount: text.length >= packFull.length ? sourceIds.length : 0, truncated: packFull.length > text.length, version: String(pack.updatedAt) },
    ...uniqueRuntimeSources.map((source, index) => {
      const start = packFull.length + (runtimeText ? 2 : 0) + runtimeSegments.slice(0, index).reduce((sum, value) => sum + value.length + 2, 0);
      const segmentLength = runtimeSegments[index].length;
      const chars = Math.max(0, Math.min(segmentLength, text.length - start));
      return { id: source.id, label: source.label, sha256: digest(text.slice(start, start + chars)), chars, itemCount: chars === segmentLength ? source.itemCount || 0 : 0, truncated: chars < segmentLength, ...(source.version ? { version: source.version } : {}) };
    })].filter((source, index, list) => source.chars > 0 && list.findIndex((candidate) => candidate.id === source.id) === index);
  return { text, receipt: { actual: true, packId: pack.id, packUpdatedAt: pack.updatedAt, sourceIds: text.length >= packFull.length ? sourceIds : [], sources, runtimeSha256: digest(text), injectedChars: text.length, itemCount: sources.reduce((sum, source) => sum + source.itemCount, 0), truncated: text.length < full.length, packTruncatedCount: Math.max(0, packFull.length - Math.min(packFull.length, text.length)), packCharLimit: maxChars } };
}

export function finalizeContextReceipt(receipt: ContextReceipt | undefined, actualText: string, runtimeSources: Array<{ id: string; label: string; text: string; itemCount?: number; version?: string }>): ContextReceipt | undefined {
  if (!receipt) return receipt;
  const additions = runtimeSources
    .filter((source) => source.text.length > 0 && actualText.includes(source.text))
    .map((source) => ({ id: source.id, label: source.label, sha256: digest(source.text), chars: source.text.length, itemCount: source.itemCount || 0, truncated: false, ...(source.version ? { version: source.version } : {}) }));
  const existing: typeof receipt.sources = [];
  const sources = [...existing, ...additions].filter((source, index, list) => list.findIndex((candidate) => candidate.id === source.id) === index);
  return { ...receipt, actual: receipt.actual === true, sources, runtimeSha256: digest(actualText), injectedChars: actualText.length, itemCount: sources.reduce((sum, source) => sum + source.itemCount, 0), truncated: receipt.truncated || sources.some((source) => source.truncated) };
}
