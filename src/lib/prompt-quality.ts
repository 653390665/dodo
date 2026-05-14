export interface PromptQualityReport {
  latencyBucket: 'fast' | 'ok' | 'slow' | 'timeout';
  parseSuccess: boolean;
  jsonComplete: boolean;
  inputAnchoringScore: number;
  fieldCompleteness: Record<string, boolean>;
  overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export function classifyLatency(elapsedMs: number): PromptQualityReport['latencyBucket'] {
  if (elapsedMs <= 8000) return 'fast';
  if (elapsedMs <= 30000) return 'ok';
  if (elapsedMs <= 60000) return 'slow';
  return 'timeout';
}

function extractKeywords(input: string): string[] {
  const stop = new Set(['一个', '的', '了', '是', '在', '和', '这', '那', '我', '你', '他', '她', '它', '们', '吗', '吧', '呢', '啊', '故事', '关于', '如何', '什么']);
  const cleaned = input.replace(/[，,。！？、；：""''（）\s]+/g, '');
  // Extract bigrams that aren't stop words
  const seen = new Set<string>();
  const bigrams: string[] = [];
  for (let i = 0; i < cleaned.length - 1; i++) {
    const bg = cleaned.slice(i, i + 2);
    if (!stop.has(bg) && !seen.has(bg)) {
      seen.add(bg);
      bigrams.push(bg);
    }
  }
  return bigrams.slice(0, 8);
}

export function scoreInputAnchoring(output: string, inputSeed: string): number {
  const keywords = extractKeywords(inputSeed);
  if (keywords.length === 0) return 0;
  const hits = keywords.filter(k => output.includes(k)).length;
  return Math.min(1, hits / Math.max(1, Math.ceil(keywords.length * 0.3)));
}

export function evaluateFieldCompleteness(
  parsed: Record<string, unknown>,
  requiredFields: string[],
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const field of requiredFields) {
    const val = parsed[field];
    result[field] = val !== undefined && val !== null && val !== '';
  }
  return result;
}

export function gradeOutput(report: PromptQualityReport): PromptQualityReport['overallGrade'] {
  if (!report.parseSuccess) return 'F';
  if (report.latencyBucket === 'timeout') return 'D';
  const completeness = Object.values(report.fieldCompleteness).filter(Boolean).length /
    Math.max(1, Object.values(report.fieldCompleteness).length);
  if (report.latencyBucket === 'fast' && completeness >= 0.9 && report.inputAnchoringScore >= 0.6) return 'A';
  if (report.latencyBucket !== 'slow' && completeness >= 0.7 && report.inputAnchoringScore >= 0.3) return 'B';
  if (completeness >= 0.5) return 'C';
  return 'D';
}
