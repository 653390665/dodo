// Plan 267 experiment 2: structural readout for the multi-scene card A/B.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateCompleteChapterDraftQuality } from '../shared/lib/draft-quality.js';

const DIR = process.argv[2] ?? '/tmp/cardab4';

const SCENE_ANCHORS: Array<{ scene: number; anchors: string[] }> = [
  { scene: 1, anchors: ['销户'] },
  { scene: 2, anchors: ['登记簿', '车次'] },
  { scene: 3, anchors: ['死亡确认书', '最后一班车'] },
];

interface Row {
  file: string;
  arm: string;
  rep: string;
  chars: number;
  paras: number;
  sentenceMean: number;
  sentenceSd: number;
  dialogueRatio: number;
  anchorsFound: string[];
  anchorsMissing: string[];
  coverage: number;
  sceneOrderOk: boolean;
  scenePositions: number[];
  gateOk: boolean;
  gateCodes: string[];
}

function stats(text: string): Row | null {
  const base = text.trim();
  if (!base) return null;
  const paras = base.split(/\n+/).filter((line) => line.trim());
  const sentences = base
    .split(/[。！？…]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const lens = sentences.map((s) => s.length);
  const mean = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
  const sd = Math.sqrt(
    lens.reduce((a, b) => a + (b - mean) ** 2, 0) / (lens.length || 1),
  );
  const dialogueChars = (base.match(/“[^”]*”/g) ?? []).join('').length;
  const anchorsFound: string[] = [];
  const anchorsMissing: string[] = [];
  const scenePositions: number[] = [];
  for (const group of SCENE_ANCHORS) {
    let best = Number.POSITIVE_INFINITY;
    for (const anchor of group.anchors) {
      const idx = base.indexOf(anchor);
      if (idx >= 0) {
        anchorsFound.push(anchor);
        best = Math.min(best, idx);
      } else {
        anchorsMissing.push(anchor);
      }
    }
    scenePositions.push(best === Number.POSITIVE_INFINITY ? -1 : Math.round((best / base.length) * 100) / 100);
  }
  const gate = validateCompleteChapterDraftQuality(base);
  return {
    file: '',
    arm: '',
    rep: '',
    chars: base.length,
    paras: paras.length,
    sentenceMean: Math.round(mean * 100) / 100,
    sentenceSd: Math.round(sd * 100) / 100,
    dialogueRatio: Math.round((dialogueChars / base.length) * 1000) / 1000,
    anchorsFound,
    anchorsMissing,
    coverage: anchorsFound.length / (anchorsFound.length + anchorsMissing.length),
    sceneOrderOk:
      scenePositions[0] >= 0 &&
      scenePositions[1] >= 0 &&
      scenePositions[2] >= 0 &&
      scenePositions[0] < scenePositions[1] &&
      scenePositions[1] < scenePositions[2],
    scenePositions,
    gateOk: gate.ok,
    gateCodes: gate.findings.map((f) => f.code),
  };
}

const rows: Row[] = [];
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.txt')).sort()) {
  const match = /^(.*)-r(\d+)\.txt$/.exec(file);
  const row = stats(readFileSync(join(DIR, file), 'utf8'));
  if (!row) continue;
  row.file = file;
  row.arm = match ? match[1] : file;
  row.rep = match ? match[2] : '';
  rows.push(row);
}

const arms = [...new Set(rows.map((r) => r.arm))];
const summary = arms.map((arm) => {
  const group = rows.filter((r) => r.arm === arm);
  const avg = (pick: (r: Row) => number) =>
    Math.round((group.reduce((a, r) => a + pick(r), 0) / (group.length || 1)) * 100) / 100;
  return {
    arm,
    runs: group.length,
    charsAvg: avg((r) => r.chars),
    parasAvg: avg((r) => r.paras),
    sentenceSdAvg: avg((r) => r.sentenceSd),
    dialogueAvg: avg((r) => r.dialogueRatio),
    coverageAvg: avg((r) => r.coverage),
    gatePass: group.filter((r) => r.gateOk).length,
    orderOk: group.filter((r) => r.sceneOrderOk).length,
    codes: [...new Set(group.flatMap((r) => r.gateCodes))],
  };
});

writeFileSync(process.env.CARD_AB_STRUCTURE_OUT ?? '/tmp/cardab4-struct.json', JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log('CARDAB4_STRUCT_DONE');
