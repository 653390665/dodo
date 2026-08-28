import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChapterProductionRunVersion } from '../shared/types';
import { computeChapterWorkflowHash } from '../shared/lib/chapter-workflow';

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-production-versions-')), 'test.db');
process.env.INKFLOW_DB_PATH = dbPath;

const db = await import('../server/lib/db');
const { getDb, getDatabaseGeneration } = await import('../server/lib/db-instance');
const { registerProductionRoutes } = await import('../server/routes/production');

const now = Date.now();
const emptyProfile = {
  tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
  acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
  quotaLimits: { generateProseMax: 100, generateProseCount: 0 },
};
const report = () => ({
  databaseGeneration: getDatabaseGeneration(), score: 100, auditMeta: { status: 'pass' as const, source: 'model' as const }, issues: [], proposedPatch: {
    characterUpdates: [], itemUpdates: [], foreshadowingUpdates: [], timelineEventsToCreate: [], foreshadowingsToCreate: [],
  },
});
const chapterDraft = (label: string) => Array.from({ length: 28 }, (_, index) => [
  `第${index + 1}段${label}在雨声里留下动作落点，林舟没有立即给出答案，而是先确认门外的脚步是否停在原处。`,
  `他把手从桌沿收回，借着灯影看清水痕的方向，随后改变站位，让退路和唯一的线索同时落进视野。`,
  `对方开口前先碰了碰杯沿，迟疑被这个动作托住，话音落下时局势已经比上一刻更接近危险。`,
  `门缝里的冷光又推进半寸，林舟将那件物品压回袖中，听见远处的锁舌回应了这一决定。`,
].join('')).join('\n\n');
const hash = (version: { sceneBeats: string; draftContent: string; styleAudit: string; continuityReport: unknown }) =>
  crypto.createHash('sha256').update(JSON.stringify({
    sceneBeats: version.sceneBeats, draftContent: version.draftContent,
    styleAudit: version.styleAudit, continuityReport: version.continuityReport,
  })).digest('hex');

db.initDb(dbPath);
db.createNovel({ id: 'novel-v', title: 'Versions', authorId: 'local', summary: '', status: 'ongoing', projectPreferenceProfile: emptyProfile, createdAt: now, updatedAt: now });
db.createNovel({ id: 'novel-other', title: 'Other', authorId: 'local', summary: '', status: 'ongoing', projectPreferenceProfile: emptyProfile, createdAt: now, updatedAt: now });
db.createChapter({ id: 'chapter-v', novelId: 'novel-v', title: 'Chapter', content: 'original', order: 1, wordCount: 8, createdAt: now, updatedAt: now });
db.createChapter({ id: 'chapter-other', novelId: 'novel-other', title: 'Other', content: 'other', order: 1, wordCount: 5, createdAt: now, updatedAt: now });
db.createCharacter({ id: 'character-other', novelId: 'novel-other', name: 'Other Character', role: 'supporting', summary: 'unchanged', traits: [], bio: '', createdAt: now, updatedAt: now });
db.createItem({ id: 'item-other', novelId: 'novel-other', name: 'Other Item', description: 'unchanged', type: 'prop', createdAt: now, updatedAt: now });
db.createForeshadowing({ id: 'foreshadowing-other', novelId: 'novel-other', title: 'Other Foreshadowing', description: '', status: 'planted', relatedCharacterIds: [], createdAt: now, updatedAt: now });

const app = express();
app.use(express.json());
registerProductionRoutes(app);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const baseUrl = `http://127.0.0.1:${address.port}`;

function createRun(id: string, draft = 'run draft') {
  db.createChapterProductionRun({ id, novelId: 'novel-v', targetChapterId: 'chapter-v', status: 'review_required', userIntent: '', sceneBeats: 'run beats', draftContent: draft, styleAudit: 'run audit', continuityReport: report(), createdAt: now, updatedAt: now });
}

function createVersion(id: string, runId: string, source: 'fallback' | 'model', content: string, overrides: Record<string, unknown> = {}) {
  const version = { id, runId, novelId: 'novel-v', targetChapterId: 'chapter-v', source, sceneBeats: `${source} beats`, draftContent: content, styleAudit: `${source} audit`, continuityReport: report(), contentHash: '', createdAt: now, ...overrides } as ChapterProductionRunVersion;
  version.contentHash = hash(version);
  db.createChapterProductionRunVersion(version);
  return version;
}

async function apply(runId: string, body: Record<string, unknown> = {}) {
  return fetch(`${baseUrl}/api/chapter-production-runs/${runId}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ novelId: 'novel-v', chapterId: 'chapter-v', databaseGeneration: getDatabaseGeneration(), ...body }),
  });
}

test('stores fallback and model versions but rejects explicitly selected fallback', async () => {
  createRun('version-choice-run', chapterDraft('model current draft'));
  const fallback = createVersion('version-fallback', 'version-choice-run', 'fallback', chapterDraft('fallback selected'));
  createVersion('version-model', 'version-choice-run', 'model', chapterDraft('model current'));
  assert.equal(db.listChapterProductionRunVersions('version-choice-run')[0].source, 'model');
  const chapterBefore = db.getChapter('chapter-v');
  const versionsBefore = db.listChapterVersions('chapter-v').length;
  const response = await apply('version-choice-run', { versionId: fallback.id, versionHash: fallback.contentHash });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { code: 'FALLBACK_REVIEW_REQUIRED', error: '保底草稿未经过模型审稿，请重试生成模型版本后再接受。', retriable: true });
  assert.deepEqual(db.getChapter('chapter-v'), chapterBefore);
  assert.equal(db.listChapterVersions('chapter-v').length, versionsBefore);
  assert.equal(db.getChapterProductionRun('version-choice-run')?.status, 'review_required');
  assert.equal(db.listChapterProductionRunVersions('version-choice-run').map(v => v.source).sort().join(','), 'fallback,model');
});

test('binds subsequent fact candidates to the selected production version snapshot', async () => {
  db.createCharacter({ id: 'character-version', novelId: 'novel-v', name: 'Version Character', role: 'supporting', summary: '', traits: [], bio: '', createdAt: now, updatedAt: now });
  createRun('version-fact-run', chapterDraft('wrong current draft'));
  const selectedReport = {
    ...report(),
    proposedPatch: { ...report().proposedPatch, characterUpdates: [{ characterId: 'character-version', summaryAppend: '选择版事实', evidenceQuote: '选择版事实' }] },
  };
  const selectedDraft = chapterDraft('选择版事实在正文中。');
  const model = createVersion('version-fact-model', 'version-fact-run', 'model', selectedDraft, { sceneBeats: '选择版节拍', continuityReport: selectedReport });
  const response = await apply('version-fact-run', { versionId: model.id, versionHash: model.contentHash });
  assert.equal(response.status, 200);
  const run = db.getChapterProductionRun('version-fact-run');
  assert.equal(run?.draftContent, selectedDraft);
  assert.equal(run?.sceneBeats, '选择版节拍');
  const preview = await fetch(`${baseUrl}/api/chapter-production-runs/version-fact-run/fact-candidate/preview`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ novelId: 'novel-v', databaseGeneration: getDatabaseGeneration() }),
  });
  assert.equal(preview.status, 200);
  const candidate = await preview.json() as { manuscript: { contentHash: string }; facts: Array<{ evidence: string }> };
  const workflowHash = crypto.createHash('sha256').update(JSON.stringify({ content: selectedDraft, sceneBeats: '选择版节拍' })).digest('hex');
  assert.equal(candidate.manuscript.contentHash, workflowHash);
  assert.equal(candidate.facts[0]?.evidence, '选择版事实');
});

test('rejects an implicit fallback run before any apply writes', async () => {
  createRun('implicit-fallback-run', chapterDraft('fallback run'));
  const run = db.getChapterProductionRun('implicit-fallback-run');
  assert.ok(run);
  db.updateChapterProductionRun(run.id, { continuityReport: { ...run.continuityReport, auditMeta: { status: 'not_run', source: 'fallback' } } });
  const chapterBefore = db.getChapter('chapter-v');
  const versionsBefore = db.listChapterVersions('chapter-v').length;
  const response = await apply('implicit-fallback-run', { acceptUnreviewed: true });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { code: 'FALLBACK_REVIEW_REQUIRED', error: '保底草稿未经过模型审稿，请重试生成模型版本后再接受。', retriable: true });
  assert.deepEqual(db.getChapter('chapter-v'), chapterBefore);
  assert.equal(db.listChapterVersions('chapter-v').length, versionsBefore);
  assert.equal(db.getChapterProductionRun('implicit-fallback-run')?.status, 'review_required');
});

test('rejects a production run with an unknown provenance before any apply writes', async () => {
  createRun('unknown-source-run', chapterDraft('unknown source'));
  const run = db.getChapterProductionRun('unknown-source-run');
  assert.ok(run);
  db.updateChapterProductionRun(run.id, {
    continuityReport: {
      ...run.continuityReport,
      auditMeta: { status: 'pass' } as unknown as typeof run.continuityReport.auditMeta,
    },
  });
  const chapterBefore = db.getChapter('chapter-v');
  const versionsBefore = db.listChapterVersions('chapter-v').length;
  const response = await apply('unknown-source-run', { acceptUnreviewed: true });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    code: 'PRODUCTION_SOURCE_UNKNOWN',
    error: '正文版本来源未知，请重新生成后再接受。',
    retriable: true,
  });
  assert.deepEqual(db.getChapter('chapter-v'), chapterBefore);
  assert.equal(db.listChapterVersions('chapter-v').length, versionsBefore);
  assert.equal(db.getChapterProductionRun('unknown-source-run')?.status, 'review_required');
});

test('keeps a critic PASS without semantic evidence in review-required state', async () => {
  createRun('critic-without-evidence-run', chapterDraft('critic without evidence'));
  const run = db.getChapterProductionRun('critic-without-evidence-run');
  assert.ok(run);
  const audit = {
    scores: {
      可读性: { score: 8, reason: '清晰' },
      分镜执行度: { score: 8, reason: '完整' },
      冲突推进度: { score: 8, reason: '推进' },
      风格契合度: { score: 8, reason: '契合' },
      网文章节感: { score: 8, reason: '有钩子' },
    },
    totalScore: 40,
    pass: true,
    failReason: '',
    fatalIssues: [],
    surgerySuggestions: [],
  };
  db.updateChapterProductionRun(run.id, { styleAudit: JSON.stringify(audit) });
  const chapterBefore = db.getChapter('chapter-v');
  const versionsBefore = db.listChapterVersions('chapter-v').length;
  const response = await apply('critic-without-evidence-run');
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: '这版正文尚未完成审稿确认，请先确认风险后再应用。',
    code: 'AUDIT_CONFIRMATION_REQUIRED',
  });
  assert.deepEqual(db.getChapter('chapter-v'), chapterBefore);
  assert.equal(db.listChapterVersions('chapter-v').length, versionsBefore);
});

test('rejects a mismatched hash with zero chapter writes', async () => {
  createRun('hash-run');
  const version = createVersion('hash-version', 'hash-run', 'fallback', 'should not write');
  const before = db.getChapter('chapter-v');
  const versionsBefore = db.listChapterVersions('chapter-v').length;
  const response = await apply('hash-run', { versionId: version.id, versionHash: 'wrong-hash' });
  assert.equal(response.status, 409);
  assert.deepEqual(db.getChapter('chapter-v'), before);
  assert.equal(db.listChapterVersions('chapter-v').length, versionsBefore);
});

test('rejects a directly inserted unsupported version source with zero chapter writes', async () => {
  createRun('unsupported-source-run');
  const continuityReport = report();
  const version = {
    id: 'unsupported-source-version', runId: 'unsupported-source-run', novelId: 'novel-v', targetChapterId: 'chapter-v',
    source: 'remote', sceneBeats: 'remote beats', draftContent: 'must not write', styleAudit: 'remote audit',
    continuityReport, contentHash: '', createdAt: now,
  };
  version.contentHash = hash(version);
  getDb().prepare(`
    INSERT INTO chapter_production_run_versions
      (id, run_id, novel_id, target_chapter_id, source, scene_beats, draft_content, style_audit, continuity_report, content_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    version.id, version.runId, version.novelId, version.targetChapterId, version.source,
    version.sceneBeats, version.draftContent, version.styleAudit, JSON.stringify(version.continuityReport), version.contentHash, version.createdAt,
  );
  const before = db.getChapter('chapter-v');
  const versionsBefore = db.listChapterVersions('chapter-v').length;
  const response = await apply('unsupported-source-run', { versionId: version.id, versionHash: version.contentHash });
  assert.equal(response.status, 409);
  assert.deepEqual(db.getChapter('chapter-v'), before);
  assert.equal(db.listChapterVersions('chapter-v').length, versionsBefore);
});

test('rejects versions that do not belong to the run, novel, or target chapter', async (t) => {
  createRun('ownership-run');
  createRun('other-run');
  const cases = [
    ['foreign-run', createVersion('foreign-run-version', 'other-run', 'fallback', 'x')],
    ['foreign-novel', createVersion('foreign-novel-version', 'ownership-run', 'fallback', 'x', { novelId: 'novel-other' })],
    ['foreign-chapter', createVersion('foreign-chapter-version', 'ownership-run', 'fallback', 'x', { targetChapterId: 'chapter-other' })],
  ] as const;
  for (const [name, version] of cases) {
    await t.test(name, async () => {
      const before = db.getChapter('chapter-v');
      const versionsBefore = db.listChapterVersions('chapter-v').length;
      const response = await apply('ownership-run', { versionId: version.id, versionHash: version.contentHash });
      assert.equal(response.status, 409);
      assert.deepEqual(db.getChapter('chapter-v'), before);
      assert.equal(db.listChapterVersions('chapter-v').length, versionsBefore);
    });
  }
});

test('rejects a selected version with cross-novel continuity patch before any apply writes', async () => {
  createRun('forged-version-patch-run');
  const version = createVersion('forged-version-patch', 'forged-version-patch-run', 'fallback', 'must not write', {
    continuityReport: {
      ...report(),
      proposedPatch: {
        ...report().proposedPatch,
        characterUpdates: [{ characterId: 'character-other', summaryAppend: 'forged' }],
        itemUpdates: [{ itemId: 'item-other', descriptionAppend: 'forged' }],
        foreshadowingUpdates: [{ foreshadowingId: 'foreshadowing-other', status: 'payoff', notesAppend: 'forged' }],
        foreshadowingsToCreate: [{ title: 'forged', description: '', status: 'planted', plantedChapterId: 'chapter-other' }],
      },
    },
  });
  const chapterBefore = db.getChapter('chapter-v');
  const versionsBefore = db.listChapterVersions('chapter-v').length;
  const response = await apply('forged-version-patch-run', { versionId: version.id, versionHash: version.contentHash });
  assert.equal(response.status, 409);
  assert.deepEqual(db.getChapter('chapter-v'), chapterBefore);
  assert.equal(db.listChapterVersions('chapter-v').length, versionsBefore);
  assert.equal(db.getCharacter('character-other')?.summary, 'unchanged');
  assert.equal(db.getItem('item-other')?.description, 'unchanged');
  assert.equal(db.getForeshadowing('foreshadowing-other')?.notes, null);
  assert.equal(db.getChapterProductionRun('forged-version-patch-run')?.status, 'review_required');
});

test('keeps legacy runs without versions compatible', async () => {
  const legacyDraft = chapterDraft('legacy content');
  createRun('legacy-run', legacyDraft);
  const legacy = db.getChapterProductionRun('legacy-run');
  assert.ok(legacy);
  db.updateChapterProductionRun('legacy-run', { continuityReport: { ...legacy.continuityReport, auditMeta: undefined } });
  const response = await apply('legacy-run');
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    code: 'PRODUCTION_SOURCE_UNKNOWN',
    error: '正文版本来源未知，请重新生成后再接受。',
    retriable: true,
  });
  const confirmed = await apply('legacy-run', { acceptUnreviewed: true });
  assert.equal(confirmed.status, 409);
  assert.deepEqual(await confirmed.json(), {
    code: 'PRODUCTION_SOURCE_UNKNOWN',
    error: '正文版本来源未知，请重新生成后再接受。',
    retriable: true,
  });
  assert.notEqual(db.getChapter('chapter-v')?.content, legacyDraft);
});

test('rejects applying a run when its target chapter changed after generation started', async () => {
  const draft = chapterDraft('stale target draft');
  createRun('stale-target-run', draft);
  const run = db.getChapterProductionRun('stale-target-run');
  assert.ok(run);
  const baselineChapter = db.getChapter('chapter-v');
  assert.ok(baselineChapter);
  db.updateChapterProductionRun(run.id, {
    continuityReport: {
      ...run.continuityReport,
      targetChapterBaselineHash: computeChapterWorkflowHash(baselineChapter.content, baselineChapter.sceneBeats),
    },
  });
  db.updateChapter('chapter-v', { content: '作者编辑后的正文', wordCount: 9, updatedAt: now + 1 });
  const beforeVersions = db.listChapterVersions('chapter-v').length;
  const response = await apply('stale-target-run');
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: '目标章节在生成期间已被修改，预览已失效，请重新生成。',
  });
  assert.equal(db.getChapter('chapter-v')?.content, '作者编辑后的正文');
  assert.equal(db.listChapterVersions('chapter-v').length, beforeVersions);
});

test('applying prose returns narrative promise candidates without mutating foreshadowing Canon', async () => {
  db.createForeshadowing({
    id: 'foreshadowing-local', novelId: 'novel-v', title: '戒指', description: '旧线索', status: 'planted',
    relatedCharacterIds: [], notes: 'unchanged', createdAt: now, updatedAt: now,
  });
  const promiseDraft = chapterDraft('戒面纹章一闪。');
  createRun('promise-candidate-run', promiseDraft);
  const run = db.getChapterProductionRun('promise-candidate-run');
  assert.ok(run);
  db.updateChapterProductionRun(run.id, {
    continuityReport: {
      ...run.continuityReport,
      proposedPatch: {
        ...run.continuityReport.proposedPatch,
        foreshadowingUpdates: [{ foreshadowingId: 'foreshadowing-local', status: 'payoff', notesAppend: 'legacy mutation' }],
        foreshadowingsToCreate: [{ title: 'legacy create', description: 'must remain candidate', status: 'planted' }],
        narrativePromiseCandidates: [
          { targetType: 'existing', foreshadowingId: 'foreshadowing-local', action: 'hint', evidenceQuote: '戒面纹章一闪' },
          { targetType: 'discovered', title: '陌生纹章', description: '纹章来源未知', action: 'plant', evidenceQuote: '戒面纹章一闪' },
        ],
      },
    },
  });
  const beforeCount = db.listForeshadowings('novel-v').length;
  const response = await apply(run.id);
  assert.equal(response.status, 200);
  const body = await response.json() as { narrativePromiseCandidates: unknown[] };
  assert.equal(body.narrativePromiseCandidates.length, 2);
  assert.equal(db.listForeshadowings('novel-v').length, beforeCount);
  assert.equal(db.getForeshadowing('foreshadowing-local')?.status, 'planted');
  assert.equal(db.getForeshadowing('foreshadowing-local')?.notes, 'unchanged');
});

test.after(() => {
  server.close();
  db.closeDb();
});
