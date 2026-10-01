import fs from 'node:fs';

import { validateCompleteChapterDraftQuality } from '../shared/lib/draft-quality';

const DIR = process.argv[2] ?? '/tmp/cardab3';
const ARMS = ['no-card', 'pacing-card', 'style-card'];
const REPS = 8;

interface Row {
  arm: string;
  rep: number;
  chars: number;
  paragraphs: number;
  sentences: number;
  meanSentence: number;
  sdSentence: number;
  dialogueRatio: number;
  slopHits: number;
  gateOk: boolean;
  gateCodes: string[];
}

const rows: Row[] = [];
for (const arm of ARMS) {
  for (let rep = 1; rep <= REPS; rep += 1) {
    const file = `${DIR}/${arm}-r${rep}.txt`;
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const sents = text.split(/[。！？!?…]+/).map((s) => s.trim()).filter(Boolean);
    const lens = sents.map((s) => s.length);
    const mean = lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length);
    const variance = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, lens.length);
    const paras = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
    const dialogueChars = (text.match(/[“"][^”"]{1,200}[”"]/g) ?? []).reduce((a, s) => a + s.length, 0);
    const slop = text.match(/[^\n]{0,12}(极其|非常|十分|格外|无比|异常|愈发)[^\n]{0,12}/g) ?? [];
    const gate = validateCompleteChapterDraftQuality(text) as { ok?: boolean; findings?: Array<{ code?: string }> };
    rows.push({
      arm,
      rep,
      chars: text.length,
      paragraphs: paras.length,
      sentences: sents.length,
      meanSentence: Number(mean.toFixed(2)),
      sdSentence: Number(Math.sqrt(variance).toFixed(2)),
      dialogueRatio: Number((dialogueChars / Math.max(1, text.length)).toFixed(3)),
      slopHits: slop.length,
      gateOk: gate.ok === true,
      gateCodes: (gate.findings ?? []).map((f) => String(f.code)),
    });
  }
}

const agg = ARMS.map((arm) => {
  const rs = rows.filter((r) => r.arm === arm);
  const avg = (f: (r: Row) => number) => Number((rs.reduce((a, r) => a + f(r), 0) / Math.max(1, rs.length)).toFixed(2));
  const charList = rs.map((r) => r.chars);
  return {
    arm,
    runs: rs.length,
    gatePass: rs.filter((r) => r.gateOk).length,
    charsAvg: avg((r) => r.chars),
    charsRange: [Math.min(...charList), Math.max(...charList)],
    charsSd: Number(Math.sqrt(charList.reduce((a, b) => a + (b - avg((r) => r.chars)) ** 2, 0) / Math.max(1, charList.length)).toFixed(1)),
    meanSentenceAvg: avg((r) => r.meanSentence),
    sdSentenceAvg: avg((r) => r.sdSentence),
    dialogueAvg: avg((r) => r.dialogueRatio),
    slopAvg: avg((r) => r.slopHits),
    parasAvg: avg((r) => r.paragraphs),
    codes: [...new Set(rs.flatMap((r) => r.gateCodes))].sort(),
  };
});

fs.writeFileSync(process.env.CARD_AB_METRICS_OUT ?? '/tmp/cardab3-metrics.json', JSON.stringify({ rows, agg }, null, 1));
for (const r of rows) {
  console.log([r.arm.padEnd(12), `r${r.rep}`, `chars=${r.chars}`, `paras=${r.paragraphs}`, `sd=${r.sdSentence}`, `dlg=${r.dialogueRatio}`, `slop=${r.slopHits}`, `gate=${r.gateOk}`, `codes=${r.gateCodes.join(',') || '-'}`].join('  '));
}
for (const a of agg) console.log(JSON.stringify(a));
console.log('CARDAB3_METRICS_DONE');
