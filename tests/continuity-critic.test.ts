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
  assert.match(prompt, /"locationUpdates"/);
  assert.match(prompt, /"powerUpdates"/);
  assert.match(prompt, /evidenceQuote/);
  assert.match(prompt, /逐字复制本章草稿中的连续原文/);
});

test('continuity critic prompt contract keeps strict JSON and verbatim evidence guidance', () => {
  const prompt = buildContinuityCriticPrompt({ ledger, sceneBeats: '', draftContent: '正文' });
  assert.match(prompt, /严格输出 JSON/);
  assert.match(prompt, /逐字复制本章草稿中的连续原文/);
  assert.match(prompt, /narrativePromiseCandidates/);
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
  assert.deepEqual(report.proposedPatch.locationUpdates, []);
  assert.deepEqual(report.proposedPatch.powerUpdates, []);
  assert.deepEqual(report.proposedPatch.timelineEventsToCreate, []);
  assert.deepEqual(report.proposedPatch.foreshadowingUpdates, []);
  assert.deepEqual(report.proposedPatch.foreshadowingsToCreate, []);
});

test('continuity critic - normalize dirty input', () => {
  const report = normalizeContinuityReport({
    score: 85,
    issues: [
      {
        severity: 'low',
        category: 'character',
        message: '人物称呼微调',
        suggestion: '建议改成师父',
      }
    ],
    proposedPatch: {
      characterUpdates: 'invalid_string_instead_of_array',
      itemUpdates: [
        { itemId: 'item-1', descriptionAppend: '' },
        { itemId: 'item-2', descriptionAppend: ' 新的道具设定 ', evidenceQuote: ' 新的道具设定 ' },
      ],
      locationUpdates: [{ locationId: 'location-1', descriptionAppend: ' 山门已封 ', evidenceQuote: ' 山门缓缓关闭 ' }],
      powerUpdates: [{ powerLevelId: 'power-1', descriptionAppend: ' 突破至二阶 ', evidenceQuote: ' 气息突破至二阶 ' }],
      foreshadowingUpdates: [
        { foreshadowingId: 'fore-1', status: 'invalid_status', notesAppend: ' 伏笔提示 ' }
      ]
    }
  });

  assert.equal(report.score, 85);
  assert.equal(report.issues[0].suggestedFix, '建议改成师父');
  assert.deepEqual(report.proposedPatch.characterUpdates, []);
  assert.equal(report.proposedPatch.itemUpdates.length, 1);
  assert.equal(report.proposedPatch.itemUpdates[0].itemId, 'item-2');
  assert.equal(report.proposedPatch.itemUpdates[0].descriptionAppend, '新的道具设定');
  assert.deepEqual(report.proposedPatch.locationUpdates, [{ locationId: 'location-1', descriptionAppend: '山门已封', evidenceQuote: '山门缓缓关闭' }]);
  assert.deepEqual(report.proposedPatch.powerUpdates, [{ powerLevelId: 'power-1', descriptionAppend: '突破至二阶', evidenceQuote: '气息突破至二阶' }]);
  assert.equal(report.proposedPatch.foreshadowingUpdates.length, 1);
  assert.equal(report.proposedPatch.foreshadowingUpdates[0].foreshadowingId, 'fore-1');
  assert.equal(report.proposedPatch.foreshadowingUpdates[0].status, 'planted');
  assert.equal(report.proposedPatch.foreshadowingUpdates[0].notesAppend, '伏笔提示');
});

test('continuity critic produces evidence-backed narrative promise candidates', () => {
  const report = normalizeContinuityReport({
    proposedPatch: {
      narrativePromiseCandidates: [
        { targetType: 'existing', foreshadowingId: 'fore-1', action: 'hint', evidenceQuote: '戒面纹章一闪', location: '第二段' },
        { targetType: 'discovered', title: '旧钥匙', description: '钥匙来源不明', action: 'plant', quote: '她攥紧旧钥匙' },
        { targetType: 'existing', foreshadowingId: 'fore-2', action: 'payoff', evidenceQuote: '' },
        { targetType: 'unexpected', foreshadowingId: 'fore-3', action: 'hint', evidenceQuote: '错误目标不能入列' },
      ],
    },
  });
  assert.equal(report.proposedPatch.narrativePromiseCandidates?.length, 2);
  assert.equal(report.proposedPatch.narrativePromiseCandidates?.[0].evidenceQuote, '戒面纹章一闪');
  assert.equal(report.proposedPatch.narrativePromiseCandidates?.[1].targetType, 'discovered');
  const prompt = buildContinuityCriticPrompt({ ledger, sceneBeats: '', draftContent: '戒面纹章一闪' });
  assert.match(prompt, /计划不等于正文证据/);
  assert.match(prompt, /narrativePromiseCandidates/);
});
