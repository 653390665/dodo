/**
 * Mechanical Slop Scorer — zero-API-cost regex-based quality check.
 * Runs before the LLM audit to catch cheap-to-detect issues:
 * 1. AI cliché phrases
 * 2. Webnovel overused tropes
 * 3. Tell-don't-show (emotion-label patterns)
 * 4. Sentence-length monotony
 * 5. Style slop
 * 6. Action chain issues
 * 7. Hook endings
 */

export interface SlopHit {
  category: 'ai_cliche' | 'webnovel_trope' | 'tell_dont_show' | 'sentence_monotony' | 'style_slop' | 'action_chain' | 'hook_ending' | 'structural';
  line: number; // 1-based line in original text
  snippet: string; // the offending text
  suggestion?: string;
  /** P0/P1 block complete output; P2 is an editorial warning. */
  priority?: 'P0' | 'P1' | 'P2';
  /** Stable machine-readable signal for structure-aware consumers. */
  signal?: 'paragraph-opening' | 'abstract-ending' | 'subject-action-chain' | 'abstract-explanation-density' | 'scene-template';
  /** Source range for a local context rewrite request. */
  range?: { start: number; end: number };
  scope?: { paragraphStart: number; paragraphEnd: number; sentenceStart?: number; sentenceEnd?: number };
}

export interface SlopReport {
  hits: SlopHit[];
  score: number; // 0-100, higher = cleaner
}

// ── Category 1: AI cliché phrases ──
const AI_CLICHES: Array<[RegExp, string]> = [
  [/不是[^，。；\n]{0,20}而是/g, 'AI套话「不是X而是Y」'],
  [/从某种程度上/g, 'AI套话「从某种程度上」'],
  [/毋庸置疑/g, 'AI套话「毋庸置疑」'],
  [/总而言之/g, 'AI套话「总而言之」'],
  [/在[^，。；\n]{1,10}的过程中/g, '冗余表达「在...的过程中」'],
  [/值得一提的是/g, 'AI套话「值得一提的是」'],
  [/换句话[说言]/g, 'AI套话「换句话说」'],
  [/在[^，。；\n]{1,15}的背景下/g, 'AI套话「在...的背景下」'],
  [/我们不得不/g, 'AI套话「我们不得不」'],
  [/毫无疑问/g, 'AI套话「毫无疑问」'],
  [/显而易见/g, 'AI套话「显而易见」'],
  [/如此[一而]来/g, 'AI套话「如此一来」'],
  [/可以说[是]?/g, 'AI套话「可以说」'],
  [/在某种程度上/g, 'AI套话「在某种程度上」'],
  [/伴随着[^，。；\n]{1,15}的[发展推进]/g, 'AI套话「伴随着...的发展」'],
  [/悄悄[地]?发生[了]?改变/g, 'AI套话「悄悄发生改变」'],
  [/心中[暗涌翻腾翻江倒海]/g, 'AI套路心理描写'],
  [/一股[^，。；\n]{1,10}涌上心[头间]/g, 'AI套路心理描写'],
  [/他深吸[一]?口气/g, 'AI套路动作「深吸一口气」'],
  [/目光[中里]闪过[一]?丝/g, 'AI套路眼神描写'],
];

// ── Category 2: Webnovel overused tropes ──
const WEBNOVEL_TROPES: Array<[RegExp, string]> = [
  [/倒吸[一]?口[凉冷]气/g, '网文陈词「倒吸一口凉气」'],
  [/瞳孔[微猛]?[一]?缩/g, '网文陈词「瞳孔一缩」'],
  [/不由[得]?多看了[几两]眼/g, '网文陈词「不由得多看了几眼」'],
  [/露出[了一]?抹[微淡苦冷]笑/g, '网文陈词「露出一抹微笑」'],
  [/嘴角[微微]?上扬/g, '网文陈词「嘴角上扬」'],
  [/心中[一]?[凛震惊寒]/g, '网文陈词「心中一凛」'],
  [/脸色[微猛]?[一]?[变沉]/g, '网文陈词「脸色一变」'],
  [/眼神[中里]闪过[一]?丝/g, '网文陈词「眼神闪过」'],
  [/浑[身]?[上]?下[散散发]发[出着]/g, '网文陈词「浑身上下」'],
  [/说时迟那时快/g, '网文陈词「说时迟那时快」'],
  [/电光火石之间/g, '网文陈词「电光火石之间」'],
  [/[不不]由[自得]主/g, '网文陈词「不由自主」'],
  [/咬[了]?咬牙/g, '网文陈词「咬了咬牙」'],
  [/捏[了]?一[把]?汗/g, '网文陈词「捏了一把汗」'],
  [/心头[一]?[震颤]/g, '网文陈词「心头一震」'],
];

// ── Category 3: Tell-don't-show (emotion labels) ──
const TELL_DONT_SHOW: Array<[RegExp, string]> = [
  [/他[感到觉][得很]?[^，。；\n]{1,8}[。，]/g, 'tell-dont-show情感标签（建议用行为/对话替代）'],
  [/她[感到觉][得很]?[^，。；\n]{1,8}[。，]/g, 'tell-dont-show情感标签（建议用行为/对话替代）'],
  [/他[感到觉][得很]?[^，。；\n]{1,8}[了]$/gm, 'tell-dont-show情感标签（建议用行为/对话替代）'],
  [/她[感到觉][得很]?[^，。；\n]{1,8}[了]$/gm, 'tell-dont-show情感标签（建议用行为/对话替代）'],
  [/非常[地]?[^，。；\n]{1,6}/g, '副词弱化「非常...」（建议用具体描写替代）'],
  [/十分(?!钟|米|秒|之)[地]?[^，。；\n]{1,6}/g, '副词弱化「十分...」（建议用具体描写替代）'],
  [/极其[地]?[^，。；\n]{1,6}/g, '副词弱化「极其...」（建议用具体描写替代）'],
];

// ── Category 4: AI style slop (exposition & emotion templates) ──
const STYLE_SLOP: Array<[RegExp, string]> = [
  [/解释道/g, '解释感/Exposition dump「解释道」（建议通过角色行为展现而非作者直叙）'],
  [/意思是说/g, '解释感/Exposition dump「意思是说」（建议通过角色行为展现而非作者直叙）'],
  [/原因在于/g, '解释感/Exposition dump「原因在于」（建议通过角色行为展现而非作者直叙）'],
  [/这意味着/g, '解释感/Exposition dump「这意味着」（建议通过角色行为展现而非作者直叙）'],
  [/这是因为/g, '解释感/Exposition dump「这是因为」（建议通过角色行为展现而非作者直叙）'],
  [/不得不说/g, '解释感/Exposition dump「不得不说」（建议通过角色行为展现而非作者直叙）'],
  [/眼神里充满了/g, '模板情绪「眼神里充满了」（建议写眼神焦点的变化，如微眯、移开等）'],
  [/心中燃起了/g, '模板情绪「心中燃起了」（建议通过外在生理反应展现情绪，避免成套词汇）'],
  [/情感在胸中(?:涌动|翻腾)/g, '模板情绪「情感在胸中涌动/翻腾」（建议通过外在生理反应展现情绪）'],
  [/难以抑制的/g, '模板情绪「难以抑制的」（词汇模板化）'],
  [/涌起一股无力感/g, '模板情绪「涌起一股无力感」（词汇模板化，建议通过具体动作或心率变化展现）'],
];

// ── Category 5: Weak action chains ──
const ACTION_CHAIN_ISSUES: Array<[RegExp, string]> = [
  [/做出了反应/g, '弱动作/抽象描述「做做出反应」（建议写出具体的微动作）'],
  [/采取了行动/g, '弱动作/抽象描述「采取了行动」（建议写出具体的微动作）'],
  [/试图(?:去|做)/g, '弱动作/动作拖沓「试图去/做」（建议使用直接、干脆的主谓动作词）'],
];

// ── Category 6: Generic endings ──
const GENERIC_ENDINGS: Array<[RegExp, string]> = [
  [/消失在夜色中/g, '通用收尾/陈词滥调「消失在夜色中」（建议用更具悬念和信息量的Hook收尾）'],
  [/转身(?:离去|走开)/g, '通用收尾/陈词滥调「转身离去/走开」（建议用更具悬念和信息量的Hook收尾）'],
  [/嘴角勾起一抹/g, '通用收尾/陈词滥调「嘴角勾起一抹」（嘴角上扬等陈词，建议避免千篇一律的弧度描写）'],
];

interface ParagraphRecord {
  text: string;
  start: number;
  end: number;
  line: number;
  sentences: Array<{ text: string; start: number; end: number }>;
}

const ABSTRACT_TERMS = /(?:局面|危险|细节|疑问|方向|答案|选择|压力|沉默|判断|真相|可能性|变化|代价|线索|局势|信息|关系)/;
const EXPLANATION_CONNECTORS = /(?:因此|从而|这让|这意味着|说明|意味着|也就是说|于是)/;
const CONCRETE_MARKERS = /(?:走|跑|抬|放|握|推|拉|撞|砸|落|停|转|看|望|听|闻|摸|抓|按|拔|递|说|问|答|门|灯|刀|杯|纸|雨|脚步|声音|钥匙|铃|“|「|『)/;
const SUBJECT_ACTIONS = /(?:看向|望向|确认|意识到|决定|发现|判断|观察|试探|准备|盯住|抬眼|抬头)/;
const ATMOSPHERE_MARKERS = /(?:风|雨|灯|空气|沉默|脚步|光线|夜色|屋内|窗|水声|火光)/;
const HOOK_MARKERS = /(?:危险|疑问|答案|方向|局面|脚步|声音|影子|门缝|线索|代价)/;

function splitParagraphs(text: string): ParagraphRecord[] {
  const records: ParagraphRecord[] = [];
  const paragraphPattern = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g;
  for (const match of text.matchAll(paragraphPattern)) {
    const value = match[0].trim();
    if (!value) continue;
    const start = match.index || 0;
    const end = start + match[0].length;
    const sentences: ParagraphRecord['sentences'] = [];
    const sentencePattern = /[^。！？!?]+[。！？!?]?/g;
    for (const sentenceMatch of value.matchAll(sentencePattern)) {
      const sentence = sentenceMatch[0].trim();
      if (!sentence) continue;
      const relativeStart = sentenceMatch.index || 0;
      const sentenceStart = start + Math.max(0, match[0].indexOf(sentence, relativeStart));
      sentences.push({ text: sentence, start: sentenceStart, end: sentenceStart + sentence.length });
    }
    records.push({ text: value, start, end, line: text.slice(0, start).split('\n').length, sentences });
  }
  return records;
}

function fingerprint(value: string): string {
  return value
    .replace(/[“”「」『』"'，。！？!?；;：:,、\s]/g, '')
    .replace(/^(?:他|她|它|这|那|有人|对方|众人|屋里|门外)/, '')
    .slice(0, 18);
}

function structureHit(
  signal: SlopHit['signal'],
  paragraphs: ParagraphRecord[],
  priority: SlopHit['priority'],
  suggestion: string,
): SlopHit {
  const first = paragraphs[0]!;
  const last = paragraphs[paragraphs.length - 1] || first;
  const snippet = paragraphs.length === 1
    ? first.text.slice(0, 180)
    : `${first.text.slice(0, 90)} … ${last.text.slice(-90)}`;
  return {
    category: 'structural',
    line: first.line,
    snippet,
    suggestion,
    priority,
    signal,
    range: { start: first.start, end: last.end },
    scope: { paragraphStart: first.line, paragraphEnd: last.line },
  };
}

function scanStructuralSignals(text: string, paragraphs: ParagraphRecord[]): SlopHit[] {
  if (paragraphs.length < 3 || text.replace(/\s/g, '').length < 800) return [];
  const hits: SlopHit[] = [];

  const openings = new Map<string, ParagraphRecord[]>();
  for (const paragraph of paragraphs) {
    const opening = paragraph.sentences[0];
    const key = opening ? fingerprint(opening.text) : '';
    if (key.length >= 6) openings.set(key, [...(openings.get(key) || []), paragraph]);
  }
  for (const group of openings.values()) {
    if (group.length >= 3) {
      hits.push(structureHit('paragraph-opening', group, group.length >= 5 ? 'P1' : 'P2', '段落首句结构重复；请改写入场动作或视角落点，避免每段沿用同一骨架。'));
      break;
    }
  }

  const abstractEndings = paragraphs.filter((paragraph) => {
    const last = paragraph.sentences.at(-1)?.text || '';
    return ABSTRACT_TERMS.test(last) && !CONCRETE_MARKERS.test(last) && !/[“「『]/.test(last);
  });
  if (abstractEndings.length >= 3) {
    hits.push(structureHit('abstract-ending', abstractEndings, abstractEndings.length >= 5 ? 'P1' : 'P2', '段末连续用抽象名词收束；请让结尾落到可见动作、选择或事件后果。'));
  }

  const subjectActionGroups = new Map<string, ParagraphRecord[]>();
  for (const paragraph of paragraphs) {
    const sentence = paragraph.sentences.find((item) => SUBJECT_ACTIONS.test(item.text));
    if (!sentence) continue;
    const action = sentence.text.match(SUBJECT_ACTIONS)?.[0] || '';
    const actionIndex = sentence.text.indexOf(action);
    const subject = sentence.text.slice(Math.max(0, actionIndex - 6), actionIndex).replace(/[^\u4e00-\u9fff]/g, '').slice(-4);
    if (subject.length < 1) continue;
    const key = `${subject}:${action}`;
    subjectActionGroups.set(key, [...(subjectActionGroups.get(key) || []), paragraph]);
  }
  for (const [key, group] of subjectActionGroups) {
    if (group.length >= 4) {
      hits.push(structureHit('subject-action-chain', group, 'P1', `同一主语反复执行“${key.split(':')[1]}”观察链；请补出不同目标、阻碍和后果。`));
      break;
    }
  }

  const explanationSentences = paragraphs.flatMap((paragraph) => paragraph.sentences.filter((sentence) => (
    EXPLANATION_CONNECTORS.test(sentence.text)
      && !/[“「『]/.test(sentence.text)
      && !CONCRETE_MARKERS.test(sentence.text)
  )));
  const totalSentences = paragraphs.reduce((count, paragraph) => count + paragraph.sentences.length, 0);
  if (explanationSentences.length >= 3 && explanationSentences.length / Math.max(totalSentences, 1) >= 0.25) {
    const records = explanationSentences.map((sentence) => ({ text: sentence.text, start: sentence.start, end: sentence.end, line: text.slice(0, sentence.start).split('\n').length, sentences: [sentence] }));
    hits.push(structureHit('abstract-explanation-density', records, 'P2', '抽象解释句密度偏高；请用人物动作、物件变化或对白压力承接信息。'));
  }

  const sceneTemplateParagraphs = paragraphs.filter((paragraph) => {
    const first = paragraph.sentences[0]?.text || '';
    const middle = paragraph.sentences.slice(0, -1).some((sentence) => EXPLANATION_CONNECTORS.test(sentence.text));
    const last = paragraph.sentences.at(-1)?.text || '';
    return ATMOSPHERE_MARKERS.test(first) && middle && HOOK_MARKERS.test(last);
  });
  if (sceneTemplateParagraphs.length >= 3) {
    hits.push(structureHit('scene-template', sceneTemplateParagraphs, 'P1', '段落重复“气氛—解释—悬念”同构；请让每段产生独立选择和可追踪后果。'));
  }

  return hits;
}

/**
 * Score text and return hits + overall score (0-100, higher = cleaner).
 */
export function scoreSlop(text: string): SlopReport {
  const lines = text.split('\n');
  const hits: SlopHit[] = [];
  const paragraphs = splitParagraphs(text);

  let consecutiveDialogueCount = 0;
  let dialogueStartIdx = -1;

  // Process each line through all rule categories
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check dialogue without beat
    const trimmed = line.trim();
    if (trimmed.startsWith('“') || trimmed.startsWith('"')) {
      if (consecutiveDialogueCount === 0) {
        dialogueStartIdx = i;
      }
      consecutiveDialogueCount++;
      if (consecutiveDialogueCount >= 3) {
        hits.push({
          category: 'action_chain',
          line: lineNum,
          snippet: lines.slice(dialogueStartIdx, i + 1).join('\n'),
          suggestion: '对白突兀无前因/无动作穿插（缺少Beat/Narration）— 建议在台词间穿插人物微表情或环境微动作',
        });
        consecutiveDialogueCount = 0;
      }
    } else if (trimmed.length > 0) {
      consecutiveDialogueCount = 0;
    }

    for (const [regex, label] of AI_CLICHES) {
      let m: RegExpExecArray | null;
      regex.lastIndex = 0;
      while ((m = regex.exec(line)) !== null) {
        hits.push({ category: 'ai_cliche', line: lineNum, snippet: m[0], suggestion: label });
      }
    }

    for (const [regex, label] of WEBNOVEL_TROPES) {
      let m: RegExpExecArray | null;
      regex.lastIndex = 0;
      while ((m = regex.exec(line)) !== null) {
        hits.push({ category: 'webnovel_trope', line: lineNum, snippet: m[0], suggestion: label });
      }
    }

    for (const [regex, label] of TELL_DONT_SHOW) {
      let m: RegExpExecArray | null;
      regex.lastIndex = 0;
      while ((m = regex.exec(line)) !== null) {
        hits.push({ category: 'tell_dont_show', line: lineNum, snippet: m[0], suggestion: label, priority: 'P1' });
      }
    }

    for (const [regex, label] of STYLE_SLOP) {
      let m: RegExpExecArray | null;
      regex.lastIndex = 0;
      while ((m = regex.exec(line)) !== null) {
        hits.push({ category: 'style_slop', line: lineNum, snippet: m[0], suggestion: label });
      }
    }

    for (const [regex, label] of ACTION_CHAIN_ISSUES) {
      let m: RegExpExecArray | null;
      regex.lastIndex = 0;
      while ((m = regex.exec(line)) !== null) {
        hits.push({ category: 'action_chain', line: lineNum, snippet: m[0], suggestion: label });
      }
    }

    for (const [regex, label] of GENERIC_ENDINGS) {
      let m: RegExpExecArray | null;
      regex.lastIndex = 0;
      while ((m = regex.exec(line)) !== null) {
        hits.push({ category: 'hook_ending', line: lineNum, snippet: m[0], suggestion: label });
      }
    }
  }

  hits.push(...scanStructuralSignals(text, paragraphs));

  // Category 4: Sentence-length monotony
  const sentences = text.split(/[。！？\n]+/).filter(s => s.trim().length > 0);
  if (sentences.length >= 5) {
    const lengths = sentences.map(s => s.length);
    let lastMonotonyEnd = -1;

    // Check every 5 consecutive sentences
    for (let i = 0; i <= lengths.length - 5; i++) {
      if (i < lastMonotonyEnd) continue;
      const window = lengths.slice(i, i + 5);
      const windowAvg = window.reduce((sum, length) => sum + length, 0) / window.length;
      const threshold = Math.max(3, windowAvg * 0.08);
      const monotone = window.every(length => Math.abs(length - windowAvg) <= threshold);
      if (monotone) {
        const snippet = sentences.slice(i, i + 5).map(s => s.substring(0, 20) + '…').join(' | ');
        const charCount = sentences.slice(0, i).reduce((c, s) => c + s.length + 1, 0);
        const approxLine = text.substring(0, charCount).split('\n').length;
        hits.push({
          category: 'sentence_monotony',
          line: approxLine,
          snippet,
          suggestion: `连续5句长度集中在${windowAvg.toFixed(0)}字附近 — 建议穿插短句、对白或动作停顿`,
        });
        lastMonotonyEnd = i + 5;
      }
    }
  }

  // Score: start at 100, deduct based on hit density
  const totalHits = hits.length;
  const textLength = text.length;
  const hitDensity = totalHits / Math.max(textLength / 1000, 1); // hits per 1k chars
  const score = Math.max(0, Math.min(100, 100 - hitDensity * 15));

  return { hits, score };
}

/** Quick one-line summary for audit display */
export function slopSummary(report: SlopReport): string {
  const byCat = {
    ai_cliche: 0,
    webnovel_trope: 0,
    tell_dont_show: 0,
    sentence_monotony: 0,
    style_slop: 0,
    action_chain: 0,
    hook_ending: 0,
    structural: 0,
  };
  for (const h of report.hits) {
    if (h.category in byCat) {
      byCat[h.category]++;
    }
  }
  const parts: string[] = [];
  if (byCat.ai_cliche > 0) parts.push(`${byCat.ai_cliche} AI套话`);
  if (byCat.webnovel_trope > 0) parts.push(`${byCat.webnovel_trope} 陈词滥调`);
  if (byCat.tell_dont_show > 0) parts.push(`${byCat.tell_dont_show} tell-dont-show`);
  if (byCat.sentence_monotony > 0) parts.push(`${byCat.sentence_monotony} 句长单一`);
  if (byCat.style_slop > 0) parts.push(`${byCat.style_slop} AI腔调`);
  if (byCat.action_chain > 0) parts.push(`${byCat.action_chain} 动作链缺陷`);
  if (byCat.hook_ending > 0) parts.push(`${byCat.hook_ending} 收尾套路`);
  if (byCat.structural > 0) parts.push(`${byCat.structural} 结构同构`);
  if (parts.length === 0) return '机械审查：无问题';
  return `⚠️ 机械审查：${parts.join('，')}`;
}
