import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

import { registerWorldRoutes } from '../server/routes/world';
import {
  activateOutlineArtifact,
  closeDb,
  createChapter,
  createCharacter,
  createContinuationPack,
  createForeshadowing,
  createNovel,
  createOutlineArtifact,
  getNovel,
  initDb,
  listCharacters,
  listFactions,
  listItems,
  listLocations,
  listPowerLevels,
  saveNarrativePromiseCoreInTransaction,
} from '../server/lib/db';
import { getDatabaseGeneration } from '../server/lib/db-instance';
import { getConfig } from '../server/lib/config';
import { __rateLimitTestHooks } from '../server/middleware/rate-limit';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJob(baseUrl: string, jobId: string, databaseGeneration: number) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/world/jobs/${jobId}?databaseGeneration=${databaseGeneration}`);
    const job = await response.json() as { status: string; error?: string; result?: { outline?: string; kind?: string; candidate?: { target: { kind: string }; proposedContent?: string; proposedCore?: Record<string, unknown>; diff?: { fields: unknown[] }; impactReport?: { affectedEntities?: unknown[] } } } };
    if (job.status === 'completed' || job.status === 'failed') return job;
    await wait(25);
  }
  throw new Error('outline job did not finish');
}

test('world job routes use author-facing missing-task errors', async () => {
  const app = express();
  app.use(express.json());
  registerWorldRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const status = await fetch(`${baseUrl}/api/world/jobs/missing?databaseGeneration=0`);
    assert.equal(status.status, 404);
    assert.deepEqual(await status.json(), { error: '世界观任务不存在或已过期，请重新提交。' });

    const cancel = await fetch(`${baseUrl}/api/world/jobs/missing/cancel?databaseGeneration=0`, { method: 'POST' });
    assert.equal(cancel.status, 404);
    assert.deepEqual(await cancel.json(), { error: '世界观任务不存在或已过期，请重新提交。' });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('generate-outline validates, budgets, and rejects unusable model output', async () => {
  closeDb();
  const dbPath = path.join(os.tmpdir(), `inkflow-outline-route-${Date.now()}.db`);
  initDb(dbPath);
  createNovel({ id: 'outline-novel', title: 'Outline', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  createNovel({ id: 'other-novel', title: 'Other', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  createChapter({ id: 'outline-chapter', novelId: 'outline-novel', volumeName: '第一卷', title: 'Chapter', content: '', order: 3, wordCount: 0, sceneBeats: '', critique: '', workflowMeta: { version: 1 }, createdAt: 1, updatedAt: 1 });
  createOutlineArtifact({ id: 'outline-master', novelId: 'outline-novel', level: 'master', scope: {}, content: '主纲：王城密道贯穿全书。' });
  activateOutlineArtifact('outline-novel', 'outline-master');
  createOutlineArtifact({ id: 'outline-volume', novelId: 'outline-novel', level: 'volume', scope: { volumeName: '第一卷' }, content: '卷纲：月蚀之夜开启密道。' });
  activateOutlineArtifact('outline-novel', 'outline-volume');
  createOutlineArtifact({ id: 'outline-chapter-scope', novelId: 'outline-novel', level: 'chapter', scope: { chapterStart: 3, chapterEnd: 3 }, content: '章纲：主角在密道发现失落王冠。' });
  activateOutlineArtifact('outline-novel', 'outline-chapter-scope');
  createForeshadowing({
    id: 'outline-promise', novelId: 'outline-novel', title: '王冠来历', description: '王冠上的缺口指向旧王朝。',
    status: 'planted', relatedCharacterIds: [], createdAt: 1, updatedAt: 1,
  });
  saveNarrativePromiseCoreInTransaction({
    novelId: 'outline-novel', foreshadowingId: 'outline-promise',
    plan: {
      intent: '逐步揭开王冠来历', revealConstraint: '本章不得揭示旧王身份',
      plannedPlantRange: { from: 1, to: 1 }, plannedHintRanges: [{ from: 3, to: 4 }],
      plannedPayoffRange: { from: 6, to: 7 }, sourceOutlineNodeIds: ['outline-node-1'],
    },
  });
  createOutlineArtifact({ id: 'other-master', novelId: 'other-novel', level: 'master', scope: {}, content: '不应注入的其他作品主纲。' });
  activateOutlineArtifact('other-novel', 'other-master');
  createContinuationPack({ id: 'draft-pack', novelId: 'outline-novel', title: 'Draft', status: 'draft', sourceDocuments: [], canonFacts: [], characterStates: [], plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' }, styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' }, contradictions: [], continuationTask: '', sourceMap: { sections: [], keyConflicts: [] }, createdAt: 1, updatedAt: 1 });
  createContinuationPack({
    id: 'approved-outline-pack', novelId: 'outline-novel', title: 'Approved', status: 'approved',
    sourceDocuments: [
      { id: 'candidate-outline', packId: 'approved-outline-pack', filename: '主纲.md', kind: 'outline', role: 'outline-candidate', text: '结构化主纲：月蚀之夜开启密道。', excerpt: '', createdAt: 1 },
      { id: 'outline-report', packId: 'approved-outline-pack', filename: '审查.md', kind: 'outline', role: 'report', text: '不应注入的审查报告。', excerpt: '', createdAt: 1 },
    ],
    canonFacts: [], characterStates: [], plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
    styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
    contradictions: [], continuationTask: '', sourceMap: { sections: [], keyConflicts: [] }, createdAt: 1, updatedAt: 1,
  });

  const config = getConfig();
  const originalConfig = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    promptGuardLevel: config.promptGuardLevel,
  };
  const originalFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  let output = '完整的大纲结果。';
  config.apiKey = 'outline-test-key';
  config.baseUrl = 'https://outline-route.test/v1';
  config.model = 'outline-test-model';
  config.promptGuardLevel = 'disabled';
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('http://127.0.0.1:')) return originalFetch(input, init);
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ choices: [{ message: { content: output } }] });
  };

  const app = express();
  app.use(express.json());
  registerWorldRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;
    const databaseGeneration = getDatabaseGeneration();

  try {
    const stale = await fetch(`${baseUrl}/api/generate-outline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'outline-novel', databaseGeneration: databaseGeneration + 1 }),
    });
    assert.equal(stale.status, 409);
    assert.deepEqual(await stale.json(), { error: '数据库已切换，请重新生成大纲', code: 'DATABASE_GENERATION_MISMATCH' });
    assert.equal(requests.length, 0);

    const rejectedPack = await fetch(`${baseUrl}/api/generate-outline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'outline-novel', continuationPackId: 'draft-pack', databaseGeneration }),
    });
    assert.equal(rejectedPack.status, 400);
    assert.deepEqual(await rejectedPack.json(), { error: '只能使用已确认的导入资料生成大纲。' });
    assert.equal(requests.length, 0);

    __rateLimitTestHooks.reset();
    const invalidTechnique = await fetch(`${baseUrl}/api/generate-outline`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'outline-novel', databaseGeneration, techniqueId: 'text-diagnostics', outlineSourceSelection: { continuationPackId: 'approved-outline-pack', primaryDocumentId: 'candidate-outline' } }),
    });
    assert.equal(invalidTechnique.status, 400);
    assert.deepEqual(await invalidTechnique.json(), {
      code: 'OUTLINE_TECHNIQUE_INVALID',
      error: '这张规划能力卡不能用于项目大纲生成。',
    });

    __rateLimitTestHooks.reset();
    const reportSource = await fetch(`${baseUrl}/api/generate-outline`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'outline-novel', databaseGeneration, techniqueId: 'opening-gold-three', outlineSourceSelection: { continuationPackId: 'approved-outline-pack', primaryDocumentId: 'outline-report' } }),
    });
    assert.equal(reportSource.status, 400);
    assert.deepEqual(await reportSource.json(), {
      code: 'OUTLINE_SOURCE_INVALID',
      error: 'OUTLINE_SOURCE_INVALID: 请选择大纲候选作为主来源。',
    });

    const invalid = await fetch(`${baseUrl}/api/generate-outline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'outline-novel', databaseGeneration, expectedWordCount: 0 }),
    });
    assert.equal(invalid.status, 400);

    __rateLimitTestHooks.reset();
    const oversizedContext = await fetch(`${baseUrl}/api/generate-outline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        novelId: 'outline-novel',
        databaseGeneration,
        seedOutline: 'x'.repeat(100_001),
      }),
    });
    assert.equal(oversizedContext.status, 400);
    assert.match((await oversizedContext.json() as { error: string }).error, /输入资料过长/);

    __rateLimitTestHooks.reset();
    const success = await fetch(`${baseUrl}/api/generate-outline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        novelId: 'outline-novel',
        databaseGeneration,
        expectedWordCount: 3_000_000,
        chapterOrder: 3,
        seedOutline: '选中的大纲原文：月蚀之夜，主角发现王城密道。',
      }),
    });
    assert.equal(success.status, 200);
    const started = await success.json() as { jobId: string; databaseGeneration: number };
    const staleJob = await fetch(`${baseUrl}/api/world/jobs/${started.jobId}?databaseGeneration=${started.databaseGeneration + 1}`);
    assert.equal(staleJob.status, 409);
    assert.deepEqual(await staleJob.json(), { error: '世界观任务状态已过期，请重新提交。' });
    const completed = await waitForJob(baseUrl, started.jobId, started.databaseGeneration);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.result?.outline, '完整的大纲结果。');
    assert.match(JSON.stringify(requests[0]?.messages), /选中的大纲原文/);
    assert.match(JSON.stringify(requests[0]?.messages), /主纲：王城密道贯穿全书/);
    assert.match(JSON.stringify(requests[0]?.messages), /卷纲：月蚀之夜开启密道/);
    assert.match(JSON.stringify(requests[0]?.messages), /章纲：主角在密道发现失落王冠/);
    assert.doesNotMatch(JSON.stringify(requests[0]?.messages), /不应注入的其他作品主纲/);
    assert.match(JSON.stringify(requests[0]?.messages), /3000000/);
    assert.match(JSON.stringify(requests[0]?.messages), /plannedAction=hint/);
    assert.match(JSON.stringify(requests[0]?.messages), /计划回收区间：6-7/);
    assert.match(JSON.stringify(requests[0]?.messages), /本章不得揭示旧王身份/);
    assert.doesNotMatch(JSON.stringify(requests[0]?.messages), /plannedAction=payoff/);
    assert.equal(requests[0]?.max_tokens, 8192);

    __rateLimitTestHooks.reset();
    output = '无技法结构化来源的大纲结果。';
    const structuredSourceRun = await fetch(`${baseUrl}/api/generate-outline`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        novelId: 'outline-novel', databaseGeneration,
        outlineSourceSelection: { continuationPackId: 'approved-outline-pack', primaryDocumentId: 'candidate-outline' },
      }),
    });
    assert.equal(structuredSourceRun.status, 200);
    const structuredSourceStarted = await structuredSourceRun.json() as { jobId: string; databaseGeneration: number };
    const structuredSourceJob = await waitForJob(baseUrl, structuredSourceStarted.jobId, structuredSourceStarted.databaseGeneration);
    assert.equal(structuredSourceJob.status, 'completed');
    assert.match(JSON.stringify(requests.at(-1)?.messages), /结构化主纲：月蚀之夜开启密道/);

    __rateLimitTestHooks.reset();
    output = '技法生成的大纲结果。';
    const techniqueRun = await fetch(`${baseUrl}/api/generate-outline`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'outline-novel', databaseGeneration, techniqueId: 'opening-gold-three', outlineSourceSelection: { continuationPackId: 'approved-outline-pack', primaryDocumentId: 'candidate-outline' } }),
    });
    assert.equal(techniqueRun.status, 200);
    const techniqueStarted = await techniqueRun.json() as { jobId: string; databaseGeneration: number };
    const techniqueJob = await waitForJob(baseUrl, techniqueStarted.jobId, techniqueStarted.databaseGeneration);
    assert.equal(techniqueJob.status, 'completed');
    const techniqueRequest = requests.at(-1);
    assert.match(JSON.stringify(techniqueRequest?.messages), /结构化主纲：月蚀之夜开启密道/);
    assert.match(JSON.stringify(techniqueRequest?.messages), /顶流网文导师/);
    assert.doesNotMatch(JSON.stringify(techniqueRequest?.messages), /不应注入的审查报告/);

    __rateLimitTestHooks.reset();
    output = '无导入资料时的技法大纲结果。';
    const techniqueWithoutSelection = await fetch(`${baseUrl}/api/generate-outline`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'outline-novel', databaseGeneration, techniqueId: 'opening-gold-three', seedOutline: '现有草稿大纲。' }),
    });
    assert.equal(techniqueWithoutSelection.status, 200);
    const withoutSelectionStarted = await techniqueWithoutSelection.json() as { jobId: string; databaseGeneration: number };
    const withoutSelectionJob = await waitForJob(baseUrl, withoutSelectionStarted.jobId, withoutSelectionStarted.databaseGeneration);
    assert.equal(withoutSelectionJob.status, 'completed');

    __rateLimitTestHooks.reset();
    output = JSON.stringify({ core: { hardRules: [{ id: 'rule-1', statement: '灵潮每百年复苏一次' }], powerConstraints: [], prohibitions: [], factionConstraints: [] }, proposedContent: '世界观候选：灵潮每百年复苏一次，宗门依灵脉兴衰。' });
    const worldCandidateBefore = getNovel('outline-novel');
    const worldCandidateRun = await fetch(`${baseUrl}/api/generate-outline`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'outline-novel', databaseGeneration, techniqueId: 'bible-world-builder', seedOutline: '现有世界草案。' }),
    });
    assert.equal(worldCandidateRun.status, 200);
    const worldCandidateStarted = await worldCandidateRun.json() as { jobId: string; databaseGeneration: number };
    const worldCandidateJob = await waitForJob(baseUrl, worldCandidateStarted.jobId, worldCandidateStarted.databaseGeneration);
    assert.equal(worldCandidateJob.status, 'completed');
    assert.equal(worldCandidateJob.result?.kind, 'world');
    assert.equal(worldCandidateJob.result?.candidate?.target.kind, 'world');
    assert.equal(worldCandidateJob.result?.candidate?.proposedContent, '世界观候选：灵潮每百年复苏一次，宗门依灵脉兴衰。');
    assert.deepEqual((worldCandidateJob.result?.candidate?.proposedCore as { hardRules?: unknown[] })?.hardRules?.length, 1);
    assert.ok((worldCandidateJob.result?.candidate?.diff?.fields.length || 0) > 0);
    assert.match(JSON.stringify(requests.at(-1)?.messages), /奇幻科幻设定专家/);
    assert.match(JSON.stringify(requests.at(-1)?.messages), /结构化候选输出合同/);
    assert.equal(getNovel('outline-novel')?.globalOutline || '', worldCandidateBefore?.globalOutline || '');
    assert.equal(getNovel('outline-novel')?.worldRules || '', worldCandidateBefore?.worldRules || '');
    assert.equal(listCharacters('outline-novel').length, 0);
    assert.equal(listLocations('outline-novel').length, 0);
    assert.equal(listItems('outline-novel').length, 0);
    assert.equal(listFactions('outline-novel').length, 0);
    assert.equal(listPowerLevels('outline-novel').length, 0);

    __rateLimitTestHooks.reset();
    createCharacter({ id: 'outline-character', novelId: 'outline-novel', name: '主角', role: 'protagonist', summary: '', traits: [], bio: '', createdAt: 1, updatedAt: 1 });
    output = JSON.stringify({ core: { desire: '重获灵脉', externalGoal: '查明古井回声', contradictions: ['自卑却好胜'], speechPattern: '短句', decisionPattern: '先试探', arc: { start: '封闭', turns: ['信任同伴'], target: '承担责任' }, immutableFacts: ['幼年失去灵脉'] }, proposedContent: '人设候选：主角幼年失去灵脉，却能听见古井回声。' });
    const characterCandidateRun = await fetch(`${baseUrl}/api/generate-outline`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'outline-novel', databaseGeneration, techniqueId: 'bible-character-arc', seedOutline: '现有人设草案。' }),
    });
    assert.equal(characterCandidateRun.status, 200);
    const characterCandidateStarted = await characterCandidateRun.json() as { jobId: string; databaseGeneration: number };
    const characterCandidateJob = await waitForJob(baseUrl, characterCandidateStarted.jobId, characterCandidateStarted.databaseGeneration);
    assert.equal(characterCandidateJob.status, 'completed');
    assert.equal(characterCandidateJob.result?.kind, 'character');
    assert.equal(characterCandidateJob.result?.candidate?.target.kind, 'character');
    assert.equal(characterCandidateJob.result?.candidate?.proposedContent, '人设候选：主角幼年失去灵脉，却能听见古井回声。');
    assert.equal((characterCandidateJob.result?.candidate?.proposedCore as { desire?: string })?.desire, '重获灵脉');
    assert.ok((characterCandidateJob.result?.candidate?.diff?.fields.length || 0) > 0);
    assert.match(JSON.stringify(requests.at(-1)?.messages), /多维度立体人设/);
    assert.match(JSON.stringify(requests.at(-1)?.messages), /结构化候选输出合同/);
    assert.equal(listCharacters('outline-novel').length, 1);

    __rateLimitTestHooks.reset();
    output = '';
    const empty = await fetch(`${baseUrl}/api/generate-outline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'outline-novel', databaseGeneration }),
    });
    const emptyStarted = await empty.json() as { jobId: string; databaseGeneration: number };
    const emptyJob = await waitForJob(baseUrl, emptyStarted.jobId, emptyStarted.databaseGeneration);
    assert.equal(emptyJob.status, 'failed');
    assert.match(emptyJob.error || '', /OUTLINE_EMPTY/);

    __rateLimitTestHooks.reset();
    output = '第一章：';
    const truncated = await fetch(`${baseUrl}/api/generate-outline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'outline-novel', databaseGeneration }),
    });
    const truncatedStarted = await truncated.json() as { jobId: string; databaseGeneration: number };
    const truncatedJob = await waitForJob(baseUrl, truncatedStarted.jobId, truncatedStarted.databaseGeneration);
    assert.equal(truncatedJob.status, 'failed');
    assert.match(truncatedJob.error || '', /OUTLINE_TRUNCATED/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    globalThis.fetch = originalFetch;
    Object.assign(config, originalConfig);
    __rateLimitTestHooks.reset();
    closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  }
});
