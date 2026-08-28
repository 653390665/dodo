import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { CAPABILITY_KINDS, capabilityManifestFor, validateCapabilityInvocation } from '../server/capabilities/manifest.js';
import { registerUtilityRoutes } from '../server/routes/utilities.js';
import { closeDb, initDb, createNovel, createContinuationPack } from '../server/lib/db.js';
import { createChapter } from '../server/lib/db/chapters.js';
import { getDatabaseGeneration } from '../server/lib/db-instance.js';
import { selectOutlineSource, OutlineSourceSelectionError } from '../server/capabilities/outline-source.js';

test('capability registry exposes the governed kinds and redacts manifest internals', () => {
  assert.deepEqual(CAPABILITY_KINDS, ['flow', 'technique', 'skill-card', 'diagnostic', 'utility', 'guardrail']);
  const manifest = capabilityManifestFor('text-diagnostics');
  assert.equal(manifest?.kind, 'utility');
  assert.equal(manifest?.stages.includes('critic'), true);
  assert.equal('handler' in (manifest || {}), false);
});

test('capability invocation uses manifest action and stage without client heuristics', () => {
  assert.throws(() => validateCapabilityInvocation('text-diagnostics', 'writer'), /CAPABILITY_STAGE_UNSUPPORTED/);
  assert.equal(validateCapabilityInvocation('audit-cliche-detector', 'critic').runtimeStatus, 'active');
  for (const id of ['audit-logical-sanity', 'platform-tomato-scoring', 'platform-webnovel-criteria']) {
    assert.equal(capabilityManifestFor(id)?.runtimeStatus, 'unavailable');
    assert.throws(() => validateCapabilityInvocation(id, 'critic'), /CAPABILITY_NOT_FOUND/);
  }
  assert.throws(() => validateCapabilityInvocation('opening-gold-three', 'planner'), /CAPABILITY_SCOPE_UNSUPPORTED/);
  assert.equal(validateCapabilityInvocation('de-ai-slop-shield', 'critic').output, 'transform-preview');
});

test('utility execute returns a baseline-bound read-only response', async () => {
  closeDb(); initDb(':memory:');
  createNovel({ id: 'n1', title: 'N1', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  createChapter({ id: 'c1', novelId: 'n1', title: 'C1', content: '这不是测试而是套话。', order: 1, wordCount: 10, createdAt: 1, updatedAt: 1 });
  createChapter({ id: 'c2', novelId: 'n1', title: 'C2', content: '他走进屋里，灯影压在肩上，桌边的人没有抬头，窗外的雨还在落，空气沉得像铁。', order: 2, wordCount: 38, createdAt: 1, updatedAt: 1 });
  const app = express();
  app.use(express.json());
  registerUtilityRoutes(app);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const body = { stage: 'critic', chapterId: 'c1', databaseGeneration: getDatabaseGeneration() };
    for (const capabilityId of ['text-diagnostics', 'audit-cliche-detector']) {
      const preview = await fetch(`${base}/api/novels/n1/capabilities/${capabilityId}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(preview.status, 200);
      const result = await preview.json();
      assert.equal(result.kind, 'diagnostic');
      assert.equal(result.report.issueCount, 1);
      assert.equal(result.report.issues[0].category, 'ai_cliche');
      assert.equal(result.readOnly, true);
      assert.equal(typeof result.baselineHash, 'string');
      assert.deepEqual(result.contextReceipt.sourceIds, ['c1', capabilityId]);
      assert.equal(result.contextReceipt.itemCount, 2);
      assert.equal(result.contextReceipt.sources[0].label, '当前章节正文');
      assert.equal(result.contextReceipt.sources[1].label, `审稿卡：${capabilityId}`);
      assert.match(result.contextReceipt.sources[1].sha256, /^[a-f0-9]{64}$/);
    }
    const polish = await fetch(`${base}/api/novels/n1/capabilities/de-ai-slop-shield/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(polish.status, 200);
    const polishResult = await polish.json();
    assert.equal(polishResult.kind, 'transform-preview');
    assert.equal(polishResult.preview, '这是套话。');
    assert.equal(polishResult.quality.ok, true);
    assert.deepEqual(polishResult.quality.findings, []);
    assert.equal(polishResult.readOnly, true);
    assert.deepEqual(polishResult.contextReceipt.sourceIds, ['c1', 'de-ai-slop-shield']);
    assert.equal(polishResult.contextReceipt.sources[1].label, '精修卡：de-ai-slop-shield');
    const rhythm = await fetch(`${base}/api/novels/n1/capabilities/de-ai-rhythm-restorer/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, chapterId: 'c2' }) });
    assert.equal(rhythm.status, 200);
    const rhythmResult = await rhythm.json();
    assert.equal(rhythmResult.kind, 'transform-preview');
    assert.equal(rhythmResult.preview, '他走进屋里，灯影压在肩上。\n桌边的人没有抬头，窗外的雨还在落。\n空气沉得像铁。');
    assert.equal(rhythmResult.contextReceipt.sources[1].label, '精修卡：de-ai-rhythm-restorer');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('outline source selection requires approved pack document IDs and keeps candidates inactive', () => {
  assert.throws(() => selectOutlineSource({ novelId: 'n1', continuationPackId: 'missing', primaryDocumentId: 'x' }), (error: unknown) => error instanceof OutlineSourceSelectionError && error.code === 'OUTLINE_SOURCE_CROSS_NOVEL');
  createContinuationPack({
    id: 'outline-pack', novelId: 'n1', title: 'Outline pack', status: 'approved',
    sourceDocuments: [
      { id: 'primary', packId: 'outline-pack', filename: '主纲.md', kind: 'outline', role: 'outline-candidate', text: '主结构', excerpt: '', createdAt: 1 },
      { id: 'reference', packId: 'outline-pack', filename: '参考.md', kind: 'world', role: 'outline-reference', text: '参考证据', excerpt: '', createdAt: 1 },
      { id: 'report', packId: 'outline-pack', filename: '审查.md', kind: 'outline', role: 'report', text: '问题清单', excerpt: '', createdAt: 1 },
    ],
    canonFacts: [], characterStates: [],
    plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
    styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
    contradictions: [], continuationTask: '', createdAt: 1, updatedAt: 1,
  });
  const selected = selectOutlineSource({ novelId: 'n1', continuationPackId: 'outline-pack', primaryDocumentId: 'primary', referenceDocumentIds: ['reference'] });
  assert.equal(selected.active, false);
  assert.match(selected.content, /【主大纲输入】/);
  assert.deepEqual(selected.referenceDocumentIds, ['reference']);
  assert.throws(() => selectOutlineSource({ novelId: 'n1', continuationPackId: 'outline-pack', primaryDocumentId: 'report' }), /请选择大纲候选作为主来源/);
});

test('outline source selection enforces primary and reference document role allowlists', () => {
  const pack = {
    id: 'role-pack', novelId: 'n1', title: 'Role pack', status: 'approved' as const,
    sourceDocuments: [
      { id: 'manuscript', packId: 'role-pack', filename: '正文.md', kind: 'manuscript' as const, role: 'manuscript', text: '正文', excerpt: '', createdAt: 1 },
      { id: 'outline', packId: 'role-pack', filename: '纲.md', kind: 'outline' as const, role: 'outline-candidate', text: '纲', excerpt: '', createdAt: 1 },
      { id: 'reference', packId: 'role-pack', filename: '事实.md', kind: 'world' as const, role: 'outline-reference', text: '事实', excerpt: '', createdAt: 1 },
    ], canonFacts: [], characterStates: [], plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' }, styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' }, contradictions: [], continuationTask: '', createdAt: 1, updatedAt: 1,
  };
  createContinuationPack(pack as never);
  assert.throws(() => selectOutlineSource({ novelId: 'n1', continuationPackId: 'role-pack', primaryDocumentId: 'manuscript' }), /请选择大纲候选作为主来源/);
  assert.throws(() => selectOutlineSource({ novelId: 'n1', continuationPackId: 'role-pack', primaryDocumentId: 'outline', referenceDocumentIds: ['manuscript'] }), /审查报告或正文资料不能作为大纲来源/);
  assert.doesNotThrow(() => selectOutlineSource({ novelId: 'n1', continuationPackId: 'role-pack', primaryDocumentId: 'outline', referenceDocumentIds: ['reference'] }));
});

test('outline source selection rejects unlabeled report signals in primary and references', () => {
  createContinuationPack({
    id: 'unlabeled-report-pack', novelId: 'n1', title: 'Unlabeled reports', status: 'approved',
    sourceDocuments: [
      { id: 'candidate', packId: 'unlabeled-report-pack', filename: '纲.md', kind: 'outline', text: '主结构', excerpt: '', createdAt: 1 },
      { id: 'primary-report', packId: 'unlabeled-report-pack', filename: 'review.md', kind: 'outline', text: '审稿意见：问题清单', excerpt: '', createdAt: 1 },
      { id: 'reference-report', packId: 'unlabeled-report-pack', filename: 'notes.md', kind: 'world', text: '评分：待改进', excerpt: '', createdAt: 1 },
    ],
    canonFacts: [], characterStates: [], plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
    styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
    contradictions: [], continuationTask: '', sourceMap: { sections: [], keyConflicts: [] }, createdAt: 1, updatedAt: 1,
  });
  assert.throws(
    () => selectOutlineSource({ novelId: 'n1', continuationPackId: 'unlabeled-report-pack', primaryDocumentId: 'primary-report' }),
    (error: unknown) => error instanceof OutlineSourceSelectionError && error.code === 'OUTLINE_SOURCE_REPORT_FORBIDDEN',
  );
  assert.throws(
    () => selectOutlineSource({ novelId: 'n1', continuationPackId: 'unlabeled-report-pack', primaryDocumentId: 'candidate', referenceDocumentIds: ['reference-report'] }),
    (error: unknown) => error instanceof OutlineSourceSelectionError && error.code === 'OUTLINE_SOURCE_REPORT_FORBIDDEN',
  );
});

test('outline source selection rejects compatibility review reports without roles', () => {
  createContinuationPack({
    id: 'compatibility-report-pack', novelId: 'n1', title: 'Compatibility reports', status: 'approved',
    sourceDocuments: [
      { id: 'candidate', packId: 'compatibility-report-pack', filename: '主纲.md', kind: 'outline', text: '主结构', excerpt: '', createdAt: 1 },
      { id: 'outline-report', packId: 'compatibility-report-pack', filename: '左道指南_事务所生态圈兼容性审查报告.md', kind: 'outline', text: '审查结论', excerpt: '', createdAt: 1 },
      { id: 'world-report', packId: 'compatibility-report-pack', filename: '左道指南_事务所生态圈兼容性审查报告-设定.md', kind: 'world', text: '报告内容', excerpt: '', createdAt: 1 },
    ],
    canonFacts: [], characterStates: [],
    plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
    styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
    contradictions: [], continuationTask: '', sourceMap: { sections: [], keyConflicts: [] }, createdAt: 1, updatedAt: 1,
  });
  assert.throws(
    () => selectOutlineSource({ novelId: 'n1', continuationPackId: 'compatibility-report-pack', primaryDocumentId: 'outline-report' }),
    (error: unknown) => error instanceof OutlineSourceSelectionError && error.code === 'OUTLINE_SOURCE_REPORT_FORBIDDEN',
  );
  assert.throws(
    () => selectOutlineSource({ novelId: 'n1', continuationPackId: 'compatibility-report-pack', primaryDocumentId: 'candidate', referenceDocumentIds: ['world-report'] }),
    (error: unknown) => error instanceof OutlineSourceSelectionError && error.code === 'OUTLINE_SOURCE_REPORT_FORBIDDEN',
  );
});

test('utility rejects selections outside chapter content', async () => {
  closeDb(); initDb(':memory:');
  createNovel({ id: 'n1', title: 'N1', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  createChapter({ id: 'empty', novelId: 'n1', title: 'Empty', content: '', order: 1, wordCount: 0, createdAt: 1, updatedAt: 1 });
  const app = express(); app.use(express.json()); registerUtilityRoutes(app);
  const server = app.listen(0); await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const body = (selection: { start: number; end: number }) => ({ chapterId: 'empty', databaseGeneration: getDatabaseGeneration(), stage: 'critic', selection });
    for (const selection of [{ start: 0, end: 1 }, { start: 1, end: 2 }]) {
      const response = await fetch(`${base}/api/novels/n1/capabilities/text-diagnostics/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body(selection)) });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, 'UTILITY_INVALID_SELECTION');
    }
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
