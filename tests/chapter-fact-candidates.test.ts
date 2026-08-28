import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {
  closeDb,
  createChapter,
  createChapterProductionRun,
  createCharacter,
  createForeshadowing,
  createItem,
  createLocation,
  createNovel,
  createPowerLevel,
  getChapter,
  getCharacter,
  getChapterProductionRun,
  initDb,
  listTimelineEvents,
  listLocations,
  listPowerLevels,
  updateCharacter,
  updateChapter,
  updateChapterProductionRun,
} from '../server/lib/db.js';
import { getDatabaseGeneration, getDb } from '../server/lib/db-instance.js';
import { registerProductionRoutes } from '../server/routes/production.js';

function setupNovel(): void {
  closeDb();
  initDb(':memory:');
  createNovel({ id: 'n1', title: '测试作品', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  createChapter({ id: 'c1', novelId: 'n1', title: '第一章', content: '旧正文', order: 1, wordCount: 3, createdAt: 1, updatedAt: 1 });
  createCharacter({ id: 'char-1', novelId: 'n1', name: '阿青', role: 'protagonist', summary: '旧状态', bio: '', traits: [], createdAt: 1, updatedAt: 1 });
}

const acceptedDraft = Array.from({ length: 32 }, (_, index) => {
  const _number = index + 1;
  const openings = [
    '门外的脚步在石阶尽头停住', '炉火忽然塌下一块炭', '窗纸上的人影向左偏了半寸',
    '井绳摩擦木檐的声音断开', '远处的更鼓迟了一拍', '阿青把湿斗笠搁在门槛上',
    '桌上的铜钱滚到茶盏旁', '檐角落下的水珠砸中青砖',
  ];
  const choices = [
    '她没有拔剑，而是把空着的左手按在门栓上',
    '她收起纸条，先问起那匹没有回来的马',
    '她让同伴熄灭灯芯，借着雨声数屋外的人数',
    '她把钥匙推回原处，转身检查墙上的旧地图',
    '她故意报出一个假的地名，等对方自己纠正',
    '她将药瓶藏进袖口，答应只带一名随从出城',
    '她挪开脚边的木箱，露出下面尚未干透的血迹',
    '她先替客人斟满茶，随后才提出真正的条件',
  ];
  const consequences = [
    '这个迟疑让门后的弩机没有立刻扣下',
    '沉默因此有了重量，桌边的人开始交换眼色',
    '地图上的旧标记与昨夜收到的口信对上了',
    '雨水冲开泥印，显出第二双鞋底留下的纹路',
    '那句纠正暴露了对方从未去过传闻中的渡口',
    '瓶塞上的蜡印已经换过，里面装的并不是止血药',
    '血迹一路延向后墙，墙缝里卡着半枚断裂的铜钉',
    '客人接过茶盏时露出戒指，正是失踪账本上的印记',
  ];
  const turns = [
    '阿青把这一点记在心里，决定把原定的会面提前半个时辰。',
    '她没有追问，只在离开前将窗扣换成了另一种方向。',
    '同伴看懂她的手势，悄悄把退路从后门改到了柴房。',
    '新的线索指向城北，原本安全的路线随即失去意义。',
  ];
  const clues = [
    '墙角的灰线缺了一截', '账页边缘沾着松脂', '门轴内侧有新刮痕', '铜锁尚留着盐霜',
    '旧靴的鞋钉少了一枚', '药包里混进了细沙', '窗台压着半片芦苇', '马鞍下藏着蓝线',
    '灯罩背面写着日期', '井沿留有墨色指印', '斗笠里垫着油纸', '刀鞘刻痕朝向城门',
    '茶叶夹着一片干花', '石缝卡着断针', '帘后垂下红绳', '木箱底板比旁边新',
    '雨幕中传来三声短哨', '香灰落在未熄的火星旁', '窗扣上系着陌生结', '纸条少了半行字',
    '桌脚沾着河滩的泥', '墙上地图被人倒转', '铜钱背面磨去了一角', '伞骨里藏有细刃',
    '门槛下压着黑羽', '水盆映出第二盏灯', '衣襟带着北坡的草籽', '砖缝里露出旧印章',
    '马厩的缰绳打过死结', '窗纸内侧留有指节印', '炉灰下埋着湿木片', '井绳上新添了一道结',
  ];
  return [
    `${openings[index % openings.length]}，${clues[index]}在水汽里发亮。`,
    `${choices[(index * 3) % choices.length]}；${consequences[(index * 5) % consequences.length]}，${clues[index]}也被雨水冲了出来。`,
    `${turns[(index * 7) % turns.length]}${clues[index]}让她意识到，这不是偶然的访客。`,
  ].join('');
}).join('\n\n');

test('production acceptance writes manuscript only and leaves continuity patch pending', async () => {
  setupNovel();
  const generation = getDatabaseGeneration();
  createChapterProductionRun({
    id: 'run-1', novelId: 'n1', targetChapterId: 'c1', status: 'review_required', userIntent: '',
    sceneBeats: '新节拍', draftContent: acceptedDraft, styleAudit: '',
    continuityReport: {
      databaseGeneration: generation,
      auditMeta: { status: 'pass', source: 'model' },
      issues: [],
      proposedPatch: {
        characterUpdates: [{ characterId: 'char-1', summaryAppend: '新增状态' }],
        itemUpdates: [], foreshadowingUpdates: [],
        timelineEventsToCreate: [{ title: '新事件', timestamp: '1', description: '事件', statusTag: '发生' }],
        foreshadowingsToCreate: [],
      },
    },
    createdAt: 1, updatedAt: 1,
  });
  const app = express();
  app.use(express.json());
  registerProductionRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/chapter-production-runs/run-1/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'n1', chapterId: 'c1', databaseGeneration: generation, acceptUnreviewed: true }),
    });
    assert.equal(response.status, 200);
    const accepted = await response.json() as { factCandidateId?: string };
    assert.match(accepted.factCandidateId || '', /^[a-f0-9]{64}$/);
    assert.equal(getChapter('c1')?.workflowMeta?.factCandidateId, accepted.factCandidateId);
    assert.equal(getCharacter('char-1')?.summary, '旧状态');
    assert.equal(listTimelineEvents('n1').length, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDb();
  }
});

test('fact candidate preview is read-only and binds evidence and target records', async () => {
  setupNovel();
  const generation = getDatabaseGeneration();
  createChapterProductionRun({
    id: 'run-2', novelId: 'n1', targetChapterId: 'c1', status: 'review_required', userIntent: '',
    sceneBeats: '节拍', draftContent: '正文证据：阿青拔剑', styleAudit: '',
    continuityReport: {
      databaseGeneration: generation,
      issues: [],
      proposedPatch: {
        characterUpdates: [{ characterId: 'char-1', summaryAppend: '拔剑', evidenceQuote: '阿青拔剑' }],
        itemUpdates: [], foreshadowingUpdates: [], timelineEventsToCreate: [], foreshadowingsToCreate: [],
      },
    },
    createdAt: 1, updatedAt: 1,
  });
  const app = express();
  app.use(express.json());
  registerProductionRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/chapter-production-runs/run-2/fact-candidate/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'n1', databaseGeneration: generation }),
    });
    assert.equal(response.status, 200);
    const candidate = await response.json() as { id: string; manuscript: { evidence: string }; facts: Array<{ target: { id: string } }> };
    assert.match(candidate.id, /^[a-f0-9]{64}$/);
    assert.equal(candidate.manuscript.evidence, '正文证据：阿青拔剑');
    assert.equal(candidate.facts[0]?.target.id, 'char-1');
    assert.equal((getDb().prepare('SELECT COUNT(*) AS count FROM chapters').get() as { count: number }).count, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDb();
  }
});

test('fact candidate rejects forged cross-novel target IDs before previewing', async () => {
  setupNovel();
  createNovel({ id: 'n2', title: '其他作品', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  createCharacter({ id: 'other-char', novelId: 'n2', name: '外来角色', role: 'supporting', summary: '', bio: '', traits: [], createdAt: 1, updatedAt: 1 });
  const generation = getDatabaseGeneration();
  createChapterProductionRun({
    id: 'forged-run', novelId: 'n1', targetChapterId: 'c1', status: 'review_required', userIntent: '', sceneBeats: '', draftContent: '正文', styleAudit: '',
    continuityReport: { databaseGeneration: generation, issues: [], proposedPatch: { characterUpdates: [{ characterId: 'other-char', summaryAppend: '伪造' }], itemUpdates: [], foreshadowingUpdates: [], timelineEventsToCreate: [], foreshadowingsToCreate: [] } },
    createdAt: 1, updatedAt: 1,
  });
  const app = express(); app.use(express.json()); registerProductionRoutes(app);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/chapter-production-runs/forged-run/fact-candidate/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'n1', databaseGeneration: generation }),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'CHAPTER_FACT_TARGET_INVALID');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve())); closeDb();
  }
});

test('fact candidate applies selected facts atomically and rejects stale story memory', async () => {
  setupNovel();
  createForeshadowing({ id: 'promise-1', novelId: 'n1', title: '戒指', description: '', status: 'planted', relatedCharacterIds: [], createdAt: 1, updatedAt: 1 });
  const generation = getDatabaseGeneration();
  createChapterProductionRun({
    id: 'atomic-run', novelId: 'n1', targetChapterId: 'c1', status: 'review_required', userIntent: '', sceneBeats: '', draftContent: '阿青看见戒指', styleAudit: '',
    continuityReport: {
      databaseGeneration: generation, issues: [],
      proposedPatch: {
        characterUpdates: [{ characterId: 'char-1', summaryAppend: '看见戒指', evidenceQuote: '看见戒指' }], itemUpdates: [], foreshadowingUpdates: [], timelineEventsToCreate: [], foreshadowingsToCreate: [],
        narrativePromiseCandidates: [{ targetType: 'existing', foreshadowingId: 'promise-1', action: 'hint', evidenceQuote: '看见戒指' }],
      },
    }, createdAt: 1, updatedAt: 1,
  });
  const app = express(); app.use(express.json()); registerProductionRoutes(app);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const preview = await (await fetch(`${base}/api/chapter-production-runs/atomic-run/fact-candidate/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'n1', databaseGeneration: generation }),
    })).json() as { id: string; manuscript: { contentHash: string }; storyMemoryFingerprint: string; facts: Array<{ id: string }> };
    const rejected = await fetch(`${base}/api/chapter-production-runs/atomic-run/fact-candidate/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'n1', runId: 'atomic-run', databaseGeneration: generation, candidateId: preview.id, manuscriptContentHash: preview.manuscript.contentHash, storyMemoryFingerprint: preview.storyMemoryFingerprint, selectedFactIds: preview.facts.map((fact) => fact.id) }),
    });
    assert.equal(rejected.status, 409);
    assert.equal(getCharacter('char-1')?.summary, '旧状态');

    updateCharacter('char-1', { summary: '外部更新', updatedAt: 2 });
    const stale = await fetch(`${base}/api/chapter-production-runs/atomic-run/fact-candidate/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'n1', runId: 'atomic-run', databaseGeneration: generation, candidateId: preview.id, manuscriptContentHash: preview.manuscript.contentHash, storyMemoryFingerprint: preview.storyMemoryFingerprint, selectedFactIds: [] }),
    });
    assert.equal(stale.status, 409);
    assert.equal(getCharacter('char-1')?.summary, '外部更新');

    updateChapterProductionRun('atomic-run', { draftContent: '旧正文已失效' });
    const staleManuscript = await fetch(`${base}/api/chapter-production-runs/atomic-run/fact-candidate/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'n1', runId: 'atomic-run', databaseGeneration: generation, candidateId: preview.id, manuscriptContentHash: preview.manuscript.contentHash, storyMemoryFingerprint: preview.storyMemoryFingerprint, selectedFactIds: [] }),
    });
    assert.equal(staleManuscript.status, 409);

    const staleGeneration = await fetch(`${base}/api/chapter-production-runs/atomic-run/fact-candidate/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'n1', runId: 'atomic-run', databaseGeneration: generation + 1, candidateId: preview.id, manuscriptContentHash: preview.manuscript.contentHash, storyMemoryFingerprint: preview.storyMemoryFingerprint, selectedFactIds: [] }),
    });
    assert.equal(staleGeneration.status, 409);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve())); closeDb();
  }
});

test('fact candidate validates legacy selections and preserves omitted fact decisions as pending', async () => {
  setupNovel();
  createItem({ id: 'item-1', novelId: 'n1', name: '剑', description: '旧剑', type: 'weapon', createdAt: 1, updatedAt: 1 });
  updateChapter('c1', { content: '阿青拔剑，剑出鞘', wordCount: 7, updatedAt: 2 });
  const generation = getDatabaseGeneration();
  createChapterProductionRun({
    id: 'selection-run', novelId: 'n1', targetChapterId: 'c1', status: 'applied', userIntent: '', sceneBeats: '', draftContent: '阿青拔剑，剑出鞘', styleAudit: '',
    continuityReport: { databaseGeneration: generation, issues: [], proposedPatch: {
      characterUpdates: [{ characterId: 'char-1', summaryAppend: '拔剑', evidenceQuote: '阿青拔剑' }], itemUpdates: [{ itemId: 'item-1', descriptionAppend: '出鞘', evidenceQuote: '出鞘' }], foreshadowingUpdates: [],
      timelineEventsToCreate: [{ title: '拔剑', timestamp: '1', description: '阿青拔剑', statusTag: '发生', evidenceQuote: '阿青拔剑' }], foreshadowingsToCreate: [],
    } }, createdAt: 1, updatedAt: 1,
  });
  const app = express(); app.use(express.json()); registerProductionRoutes(app);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const preview = await (await fetch(`${base}/api/chapter-production-runs/selection-run/fact-candidate/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'n1', databaseGeneration: generation }),
    })).json() as { id: string; manuscript: { contentHash: string }; storyMemoryFingerprint: string; facts: Array<{ id: string; kind: string }> };
    updateChapter('c1', { workflowMeta: { version: 1, completionGate: 'ready', factCandidateId: preview.id, factCandidateRunId: 'selection-run' } });
    const characterFact = preview.facts.find((fact) => fact.kind === 'character')!;
    const itemFact = preview.facts.find((fact) => fact.kind === 'item')!;
    const timelineFact = preview.facts.find((fact) => fact.kind === 'timeline')!;
    const applyPayload = {
      novelId: 'n1', runId: 'selection-run', databaseGeneration: generation, candidateId: preview.id,
      manuscriptContentHash: preview.manuscript.contentHash, storyMemoryFingerprint: preview.storyMemoryFingerprint,
    };
    for (const body of [
      { ...applyPayload, selectedFactIds: ['forged-fact'] },
      { ...applyPayload, selectedFactIds: [42] },
      { ...applyPayload, selectedFactIds: [characterFact.id], rejectedFactIds: [characterFact.id] },
      { ...applyPayload, selectedFactIds: [characterFact.id], factDecisions: { [characterFact.id]: 'accepted' } },
    ]) {
      const invalid = await fetch(`${base}/api/chapter-production-runs/selection-run/fact-candidate/apply`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      assert.equal(invalid.status, 409);
    }
    const applied = await fetch(`${base}/api/chapter-production-runs/selection-run/fact-candidate/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...applyPayload, factDecisions: { [characterFact.id]: 'accepted' } }),
    });
    assert.equal(applied.status, 200);
    assert.deepEqual((await applied.json()).factStatuses, { [characterFact.id]: 'accepted', [itemFact.id]: 'pending', [timelineFact.id]: 'pending' });
    assert.equal(getChapter('c1')?.workflowMeta?.factCandidateRunId, 'selection-run');
    const decisions = (getChapterProductionRun('selection-run')!.continuityReport as { factCandidateDecisions?: { factStatuses: Record<string, string> } }).factCandidateDecisions;
    assert.deepEqual(decisions?.factStatuses, { [characterFact.id]: 'accepted', [itemFact.id]: 'pending', [timelineFact.id]: 'pending' });
    assert.equal(getCharacter('char-1')?.summary, '旧状态\n拔剑');
    assert.equal(listTimelineEvents('n1').length, 0);
    const secondPreview = await (await fetch(`${base}/api/chapter-production-runs/selection-run/fact-candidate/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'n1', databaseGeneration: generation }),
    })).json() as { id: string; manuscript: { contentHash: string }; storyMemoryFingerprint: string; facts: Array<{ id: string }> };
    assert.deepEqual(secondPreview.facts.map((fact) => fact.id), [itemFact.id, timelineFact.id]);
    const second = await fetch(`${base}/api/chapter-production-runs/selection-run/fact-candidate/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'n1', runId: 'selection-run', databaseGeneration: generation, candidateId: secondPreview.id, manuscriptContentHash: secondPreview.manuscript.contentHash, storyMemoryFingerprint: secondPreview.storyMemoryFingerprint, factDecisions: { [itemFact.id]: 'rejected' } }),
    });
    assert.equal(second.status, 200);
    const merged = (getChapterProductionRun('selection-run')!.continuityReport as { factCandidateDecisions?: { factStatuses: Record<string, string> } }).factCandidateDecisions;
    assert.deepEqual(merged?.factStatuses, { [characterFact.id]: 'accepted', [itemFact.id]: 'rejected', [timelineFact.id]: 'pending' });
    const thirdPreview = await (await fetch(`${base}/api/chapter-production-runs/selection-run/fact-candidate/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'n1', databaseGeneration: generation }),
    })).json() as { facts: Array<{ id: string }> };
    assert.deepEqual(thirdPreview.facts.map((fact) => fact.id), [timelineFact.id]);
    const final = await fetch(`${base}/api/chapter-production-runs/selection-run/fact-candidate/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'n1', runId: 'selection-run', databaseGeneration: generation, candidateId: secondPreview.id, manuscriptContentHash: secondPreview.manuscript.contentHash, storyMemoryFingerprint: secondPreview.storyMemoryFingerprint, factDecisions: { [timelineFact.id]: 'rejected' } }),
    });
    assert.equal(final.status, 200);
    assert.equal(getChapter('c1')?.workflowMeta?.factCandidateId, undefined);
    assert.equal(getChapter('c1')?.workflowMeta?.factCandidateRunId, undefined);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve())); closeDb();
  }
});

test('fact confirmation rejects a review-only manuscript before Canon writes', async () => {
  setupNovel();
  const generation = getDatabaseGeneration();
  createChapterProductionRun({
    id: 'review-only-run', novelId: 'n1', targetChapterId: 'c1', status: 'review_required', userIntent: '', sceneBeats: '', draftContent: '待接受正文', styleAudit: '',
    continuityReport: { databaseGeneration: generation, issues: [], proposedPatch: { characterUpdates: [{ characterId: 'char-1', summaryAppend: '不应写入' }], itemUpdates: [], foreshadowingUpdates: [], timelineEventsToCreate: [], foreshadowingsToCreate: [] } }, createdAt: 1, updatedAt: 1,
  });
  const app = express(); app.use(express.json()); registerProductionRoutes(app);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const preview = await (await fetch(`${base}/api/chapter-production-runs/review-only-run/fact-candidate/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'n1', databaseGeneration: generation }),
    })).json() as { id: string; manuscript: { contentHash: string }; storyMemoryFingerprint: string; facts: Array<{ id: string }> };
    const response = await fetch(`${base}/api/chapter-production-runs/review-only-run/fact-candidate/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'n1', runId: 'review-only-run', databaseGeneration: generation, candidateId: preview.id, manuscriptContentHash: preview.manuscript.contentHash, storyMemoryFingerprint: preview.storyMemoryFingerprint, selectedFactIds: [] }),
    });
    assert.equal(response.status, 409);
    assert.equal(getCharacter('char-1')?.summary, '旧状态');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve())); closeDb();
  }
});

test('fact confirmation rejects an accepted run whose chapter manuscript changed', async () => {
  setupNovel();
  const generation = getDatabaseGeneration();
  createChapterProductionRun({
    id: 'hash-mismatch-run', novelId: 'n1', targetChapterId: 'c1', status: 'applied', userIntent: '', sceneBeats: '', draftContent: '已接受正文', styleAudit: '',
    continuityReport: { databaseGeneration: generation, issues: [], proposedPatch: { characterUpdates: [{ characterId: 'char-1', summaryAppend: '不应写入' }], itemUpdates: [], foreshadowingUpdates: [], timelineEventsToCreate: [], foreshadowingsToCreate: [] } }, createdAt: 1, updatedAt: 1,
  });
  const app = express(); app.use(express.json()); registerProductionRoutes(app);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const preview = await (await fetch(`${base}/api/chapter-production-runs/hash-mismatch-run/fact-candidate/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'n1', databaseGeneration: generation }),
    })).json() as { id: string; manuscript: { contentHash: string }; storyMemoryFingerprint: string; facts: Array<{ id: string }> };
    const response = await fetch(`${base}/api/chapter-production-runs/hash-mismatch-run/fact-candidate/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'n1', runId: 'hash-mismatch-run', databaseGeneration: generation, candidateId: preview.id, manuscriptContentHash: preview.manuscript.contentHash, storyMemoryFingerprint: preview.storyMemoryFingerprint, selectedFactIds: [] }),
    });
    assert.equal(response.status, 409);
    assert.equal(getCharacter('char-1')?.summary, '旧状态');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve())); closeDb();
  }
});

test('an author can explicitly accept an ambiguous but writable timeline fact', async () => {
  setupNovel();
  updateChapter('c1', { content: '阿青拔剑', wordCount: 4, updatedAt: 2 });
  const generation = getDatabaseGeneration();
  createChapterProductionRun({
    id: 'timeline-run', novelId: 'n1', targetChapterId: 'c1', status: 'applied', userIntent: '', sceneBeats: '', draftContent: '阿青拔剑', styleAudit: '',
    continuityReport: { databaseGeneration: generation, issues: [], proposedPatch: { characterUpdates: [], itemUpdates: [], foreshadowingUpdates: [], timelineEventsToCreate: [{ title: '拔剑', timestamp: '1', description: '阿青拔剑', statusTag: '发生', evidenceQuote: '阿青拔剑' }], foreshadowingsToCreate: [] } }, createdAt: 1, updatedAt: 1,
  });
  const app = express(); app.use(express.json()); registerProductionRoutes(app);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const preview = await (await fetch(`${base}/api/chapter-production-runs/timeline-run/fact-candidate/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'n1', databaseGeneration: generation }),
    })).json() as { id: string; manuscript: { contentHash: string }; storyMemoryFingerprint: string; facts: Array<{ id: string; kind: string }> };
    const timeline = preview.facts.find((fact) => fact.kind === 'timeline')!;
    const response = await fetch(`${base}/api/chapter-production-runs/timeline-run/fact-candidate/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'n1', runId: 'timeline-run', databaseGeneration: generation, candidateId: preview.id, manuscriptContentHash: preview.manuscript.contentHash, storyMemoryFingerprint: preview.storyMemoryFingerprint, selectedFactIds: [timeline.id] }),
    });
    assert.equal(response.status, 200);
    assert.equal(listTimelineEvents('n1').map((event) => event.title).join(','), '拔剑');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve())); closeDb();
  }
});

test('candidate facts use exact manuscript quotes, omit unsupported patches, and hold payoff pending', async () => {
  setupNovel();
  createItem({ id: 'item-evidence', novelId: 'n1', name: '剑', description: '', type: 'weapon', createdAt: 1, updatedAt: 1 });
  createLocation({ id: 'location-evidence', novelId: 'n1', name: '山门', description: '', region: '', createdAt: 1, updatedAt: 1 });
  createPowerLevel({ id: 'power-evidence', novelId: 'n1', name: '炼气', description: '', tier: 1, characteristics: '', createdAt: 1, updatedAt: 1 });
  createForeshadowing({ id: 'promise-evidence', novelId: 'n1', title: '戒指', description: '', status: 'planted', relatedCharacterIds: [], createdAt: 1, updatedAt: 1 });
  const draft = '阿青拔剑，山门缓缓关闭，气息突破至二阶，戒面纹章一闪。';
  updateChapter('c1', { content: draft, wordCount: draft.length, updatedAt: 2 });
  const generation = getDatabaseGeneration();
  createChapterProductionRun({
    id: 'evidence-run', novelId: 'n1', targetChapterId: 'c1', status: 'applied', userIntent: '', sceneBeats: '', draftContent: draft, styleAudit: '',
    continuityReport: { databaseGeneration: generation, issues: [], proposedPatch: {
      characterUpdates: [{ characterId: 'char-1', summaryAppend: '拔剑', evidenceQuote: '拔剑' }], itemUpdates: [{ itemId: 'item-evidence', descriptionAppend: '伪造状态', evidenceQuote: '伪造状态' }],
      locationUpdates: [{ locationId: 'location-evidence', descriptionAppend: '山门已封', evidenceQuote: '山门缓缓关闭' }], powerUpdates: [{ powerLevelId: 'power-evidence', descriptionAppend: '突破至二阶', evidenceQuote: '气息突破至二阶' }],
      foreshadowingUpdates: [], timelineEventsToCreate: [], foreshadowingsToCreate: [],
      narrativePromiseCandidates: [{ targetType: 'existing', foreshadowingId: 'promise-evidence', action: 'payoff', evidenceQuote: ' 戒面纹章一闪 ' }],
    } }, createdAt: 1, updatedAt: 1,
  });
  const app = express(); app.use(express.json()); registerProductionRoutes(app);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/chapter-production-runs/evidence-run/fact-candidate/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'n1', databaseGeneration: generation }),
    });
    const candidate = await response.json() as { id: string; manuscript: { contentHash: string }; storyMemoryFingerprint: string; facts: Array<{ id: string; kind: string; evidence: string; evidenceSpan: { start: number; end: number }; destructive: boolean; target: { kind: string; id: string; label: string }; proposedValue: { evidenceQuote?: string } }> };
    const character = candidate.facts.find((fact) => fact.kind === 'character')!;
    const location = candidate.facts.find((fact) => fact.kind === 'location')!;
    const power = candidate.facts.find((fact) => fact.kind === 'power')!;
    const payoff = candidate.facts.find((fact) => fact.kind === 'narrative-promise')!;
    assert.equal(character.evidence, '拔剑');
    assert.deepEqual(character.evidenceSpan, { start: 2, end: 4 });
    assert.equal(candidate.facts.some((fact) => fact.kind === 'item'), false);
    assert.deepEqual(location.target, { kind: 'location', id: 'location-evidence', label: '山门' });
    assert.equal(location.evidence, '山门缓缓关闭');
    assert.deepEqual(power.target, { kind: 'power', id: 'power-evidence', label: '炼气' });
    assert.equal(power.evidence, '气息突破至二阶');
    assert.equal(payoff.evidence, '戒面纹章一闪');
    assert.equal(payoff.proposedValue.evidenceQuote, '戒面纹章一闪');
    assert.equal(payoff.destructive, true);
    const applied = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/chapter-production-runs/evidence-run/fact-candidate/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'n1', databaseGeneration: generation, candidateId: candidate.id, manuscriptContentHash: candidate.manuscript.contentHash, storyMemoryFingerprint: candidate.storyMemoryFingerprint, selectedFactIds: [location.id, power.id] }),
    });
    assert.equal(applied.status, 200);
    assert.equal(listLocations('n1')[0]?.description, '山门已封');
    assert.equal(listPowerLevels('n1')[0]?.description, '突破至二阶');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve())); closeDb();
  }
});

test('an applied candidate rejects a changed story-memory fingerprint before writes and rolls back a later transaction failure', async () => {
  setupNovel();
  const draft = '阿青拔剑。';
  updateChapter('c1', { content: draft, wordCount: draft.length, updatedAt: 2 });
  const generation = getDatabaseGeneration();
  createChapterProductionRun({
    id: 'atomic-applied-run', novelId: 'n1', targetChapterId: 'c1', status: 'applied', userIntent: '', sceneBeats: '', draftContent: draft, styleAudit: '',
    continuityReport: { databaseGeneration: generation, issues: [], proposedPatch: { characterUpdates: [{ characterId: 'char-1', summaryAppend: '拔剑', evidenceQuote: '拔剑' }], itemUpdates: [], foreshadowingUpdates: [], timelineEventsToCreate: [{ title: '拔剑', timestamp: '1', description: '阿青拔剑', statusTag: '发生', evidenceQuote: '阿青拔剑' }], foreshadowingsToCreate: [] } }, createdAt: 1, updatedAt: 1,
  });
  const app = express(); app.use(express.json()); registerProductionRoutes(app);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const preview = async () => (await (await fetch(`${base}/api/chapter-production-runs/atomic-applied-run/fact-candidate/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'n1', databaseGeneration: generation }) })).json()) as { id: string; manuscript: { contentHash: string }; storyMemoryFingerprint: string; facts: Array<{ id: string; kind: string; target: { id: string } }> };
  try {
    const stalePreview = await preview();
    createItem({ id: 'memory-change', novelId: 'n1', name: '外部物品', description: '', type: 'prop', createdAt: 3, updatedAt: 3 });
    const stale = await fetch(`${base}/api/chapter-production-runs/atomic-applied-run/fact-candidate/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'n1', runId: 'atomic-applied-run', databaseGeneration: generation, candidateId: stalePreview.id, manuscriptContentHash: stalePreview.manuscript.contentHash, storyMemoryFingerprint: stalePreview.storyMemoryFingerprint, selectedFactIds: [] }) });
    assert.equal(stale.status, 409);
    assert.equal(getCharacter('char-1')?.summary, '旧状态');

    const first = await preview();
    const timeline = first.facts.find((fact) => fact.kind === 'timeline')!;
    // Insert before the final preview so the candidate fingerprint is current but the selected write still conflicts.
    getDb().prepare('INSERT INTO timeline_events (id, novel_id, title, description, timestamp, status_tag, "order", created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(timeline.target.id, 'n1', '既有事件', '', '0', '', 1, 4, 4);
    const current = await preview();
    const character = current.facts.find((fact) => fact.kind === 'character')!;
    const conflictingTimeline = current.facts.find((fact) => fact.kind === 'timeline')!;
    const atomic = await fetch(`${base}/api/chapter-production-runs/atomic-applied-run/fact-candidate/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'n1', runId: 'atomic-applied-run', databaseGeneration: generation, candidateId: current.id, manuscriptContentHash: current.manuscript.contentHash, storyMemoryFingerprint: current.storyMemoryFingerprint, selectedFactIds: [character.id, conflictingTimeline.id] }) });
    assert.equal(atomic.status, 500);
    assert.equal(getCharacter('char-1')?.summary, '旧状态');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve())); closeDb();
  }
});
