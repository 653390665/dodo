import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContinuityCriticPrompt,
  extractContinuityReportJson,
  normalizeContinuityReport,
} from '../src/lib/continuity-critic';
import type { StoryStateLedger } from '../shared/types';

const ledger: StoryStateLedger = {
  novelId: 'novel-1',
  title: '雨夜玄令',
  summary: '沉默刀客卷入玄铁令争夺。',
  worldRules: '玄铁令不能复制。',
  globalOutline: '第一卷围绕玄铁令失窃展开。',
  recentChapters: [
    {
      id: 'chapter-1',
      title: '第一章',
      order: 1,
      sceneBeats: '林砚入酒馆。',
      summary: '林砚持有玄铁令。',
    },
  ],
  entityStates: {
    characters: [
      {
        id: 'char-1',
        name: '林砚',
        kind: 'character',
        summary: '寡言刀客。',
        statusNote: '持有玄铁令',
      },
    ],
    locations: [],
    items: [
      {
        id: 'item-1',
        name: '玄铁令',
        kind: 'item',
        summary: '唯一铁令。',
        statusNote: 'type=信物',
      },
    ],
    factions: [],
    powerLevels: [],
  },
  timeline: [],
  openForeshadowings: [],
};

test('buildContinuityCriticPrompt asks for strict JSON and includes ledger facts', () => {
  const prompt = buildContinuityCriticPrompt({
    ledger,
    sceneBeats: '林砚把玄铁令交给掌柜。',
    draftContent: '林砚从怀里取出两枚玄铁令。',
  });

  assert.match(prompt, /严格输出 JSON/);
  assert.match(prompt, /雨夜玄令/);
  assert.match(prompt, /玄铁令不能复制/);
  assert.match(prompt, /两枚玄铁令/);
});

test('extractContinuityReportJson parses fenced model output', () => {
  const parsed = extractContinuityReportJson(`
\`\`\`json
{
  "score": 62,
  "issues": [
    {
      "severity": "high",
      "category": "item",
      "message": "玄铁令此前设定为唯一，草稿出现两枚。",
      "evidence": "两枚玄铁令"
    }
  ],
  "proposedPatch": {
    "characterUpdates": [],
    "itemUpdates": [],
    "timelineEventsToCreate": [],
    "foreshadowingUpdates": [],
    "foreshadowingsToCreate": []
  }
}
\`\`\`
`);

  assert.equal(parsed.score, 62);
  assert.equal(parsed.issues[0].category, 'item');
});

test('normalizeContinuityReport clamps score and fills missing arrays', () => {
  const report = normalizeContinuityReport({
    score: 120,
    issues: [
      {
        severity: 'urgent',
        category: 'unknown',
        message: 'bad',
      },
    ],
  });

  assert.equal(report.score, 100);
  assert.equal(report.issues[0].severity, 'medium');
  assert.equal(report.issues[0].category, 'logic');
  assert.deepEqual(report.proposedPatch.characterUpdates, []);
  assert.deepEqual(report.proposedPatch.itemUpdates, []);
  assert.deepEqual(report.proposedPatch.timelineEventsToCreate, []);
  assert.deepEqual(report.proposedPatch.foreshadowingUpdates, []);
  assert.deepEqual(report.proposedPatch.foreshadowingsToCreate, []);
});
