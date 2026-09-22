import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractForeshadowingLedger,
  extractPowerHolderEdges,
  extractRelicHolderEdges,
  extractXigangEntries,
  normalizeRelationshipType,
} from '../server/helpers/knowledge-lineage';

const FIXTURE = `
# 《左道指南》逐章细纲数据库

| 卷 | 单元 | 章节区间 | 条目数 |
|---|---|---|---|
| 入队 | 入队 (Ch1-20) | Ch001–Ch018 | 19 |

---

## 卷一

### U01 · 入队 (Ch1-20)

### Ch001 · 立交桥下的尸体——外卖订单编号：112【物化灵案件·开场】
**卷 · 幕**：I · 入队 (1-20) | **纪元**：灰纪 7 春 | **压力**：🔴 高
- **核心事件**：凌晨立交桥下发现一具男尸。
- **场景锚点**：立交桥下 / 老街112号楼下
- **伏笔埋点**：死者眼眶青紫色淤痕=与左妄手腕同源。订单地址112号=左妄住址；302门上便利贴=第一个「有人在暗处看着你」的信号
- **回收章**：Ch005（暴走骑手首次击退）/ Ch006（差评破局）
- **红线自查**：红1 不点破、红5 慢火节奏
- **章末钩子**：老城区里从「加班」到「消失」的阈值，正好是三天。

---

### U02 · 摸底 (Ch21-40)

### Ch002 · 苏记的欠条
**核心冲突**：赊账博弈。
`;

test('extractXigangEntries parses chapter entries with fields', () => {
  const entries = extractXigangEntries(FIXTURE);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].chapterNo, 'Ch001');
  assert.match(entries[0].title, /立交桥下的尸体/);
  assert.match(entries[0].fields['核心事件'], /男尸/);
  assert.match(entries[0].fields['伏笔埋点'], /同源/);
  assert.match(entries[1].fields['核心冲突'], /赊账/);
  // 回归：单元标题（非 Ch 小节）不得中断后续章节解析
  assert.equal(entries[1].chapterNo, 'Ch002');
});

test('extractForeshadowingLedger splits plant sentences and merges payoffs', () => {
  const entries = extractXigangEntries(FIXTURE);
  const rows = extractForeshadowingLedger(entries);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].plantedChapter, 'Ch001');
  assert.equal(rows[0].payoffChapter, 'Ch005');
  assert.match(rows[0].title, /死者眼眶青紫色淤痕/);
  assert.ok(rows[0].payoffNote.includes('差评破局'));
});

test('extractRelicHolderEdges parses the relic index table', () => {
  const doc = [
    '## 二、完整索引表（52 行标准表）',
    '| NO. | 名称 | 等级 | 来源 | 当前持有人 | 登场单元 | 功能简述 | 代价/次数 | 定稿版状态 |',
    '|---|---|---|---|---|---|---|---|---|',
    '| 010 | 外卖员的超时计时器 | 执念级 | BOSS-01 暴走骑手析出 | 左妄（使用中） | Ch006 | 计时 | 代价 | 定稿 |',
    '| 022 | 渣男的海王叉 | 执念级 | 日常 | 左妄 | 卷 II | 关系切割 | — | 定稿 |',
  ].join('\n');
  const edges = extractRelicHolderEdges(doc);
  assert.equal(edges.length, 2);
  assert.equal(edges[0].holderName, '左妄');
  assert.equal(edges[0].itemName, '外卖员的超时计时器');
  assert.equal(edges[0].level, '执念级');
});

test('extractPowerHolderEdges matches holders against character names', () => {
  const edges = extractPowerHolderEdges(
    [
      { name: '第零·理智', description: '左妄持有，不锻炼' },
      { name: '第一·虚无', description: '无名氏持有' },
    ],
    new Set(['左妄'])
  );
  assert.equal(edges.length, 1);
  assert.equal(edges[0].powerName, '第零·理智');
  assert.equal(edges[0].holderName, '左妄');
});

test('normalizeRelationshipType merges exact synonyms only', () => {
  assert.equal(normalizeRelationshipType('债主'), '债务');
  assert.equal(normalizeRelationshipType('租户-房东'), '房东-房客');
  assert.equal(normalizeRelationshipType('镜像关系'), '镜像');
  assert.equal(normalizeRelationshipType('敌对'), '敌对', '非同义词保持原样');
});
