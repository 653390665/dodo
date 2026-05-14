const DEFAULT_BAN_PATTERNS = [
  { pattern: /总而言之/gi, label: 'AI结论词' },
  { pattern: /总的来说/gi, label: 'AI结论词' },
  { pattern: /此外/gi, label: 'AI过渡词' },
  { pattern: /通过(.{1,20})方式/gi, label: 'AI万能句式' },
  { pattern: /在(.{1,20})的过程中/gi, label: 'AI万能句式' },
  { pattern: /主角/gi, label: '元叙事称谓' },
  { pattern: /读者/gi, label: '作者口吻' },
];

export interface BanWordHit {
  word: string;
  label: string;
  index: number;
}

export function scanForBanWords(
  text: string,
  patterns = DEFAULT_BAN_PATTERNS,
): BanWordHit[] {
  const hits: BanWordHit[] = [];
  for (const { pattern, label } of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      hits.push({ word: match[0], label, index: match.index });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

export function formatBanWordReport(hits: BanWordHit[]): string {
  if (hits.length === 0) return '';
  const byLabel: Record<string, string[]> = {};
  for (const hit of hits) {
    (byLabel[hit.label] ||= []).push(`\`${hit.word}\``);
  }
  return Object.entries(byLabel)
    .map(([label, words]) => `- **${label}**: ${words.join('、')}`)
    .join('\n');
}
