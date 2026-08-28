import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-ready')).toHaveAttribute('data-ready-state', 'true');
}

const novel = { id: 'e2e-imported', title: '导入 Canon 作品', authorId: 'local-user', summary: 'imported', status: 'ongoing', createdAt: 1, updatedAt: 1, globalOutline: '原始主纲：城门之后仍有灯光。', worldRules: '原始规则：灯光不会自动熄灭。' };
const pack = { id: 'e2e-imported-pack', novelId: novel.id, title: '导入资料包', status: 'approved', sourceDocuments: [], canonFacts: [{ id: 'canon-1', priority: 'hard', category: 'world', text: '灯光不会自动熄灭。', evidence: '原文第 1 页' }], characterStates: [], plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' }, styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' }, contradictions: [], continuationTask: '继续调查城门', createdAt: 1, updatedAt: 1 };
const chapter = { id: 'chapter-1', novelId: novel.id, volumeId: null, chapterNumber: 1, title: '第一章', content: '导入正文基线', sceneBeats: '导入场景计划：沿灯光前进', status: 'draft', createdAt: 1, updatedAt: 1, workflowMeta: { version: 1, completionContentHash: 'content-hash', completionGate: 'ready', factCandidateId: 'fact-1', factCandidateRunId: 'run-1' } };

async function mockImportedDb(page: Page) {
  let accepted = false;
  let worldAccepted = false;
  let candidateGenerated = false;
  let worldCandidateGenerated = false;
  let factApplied = false;
  let outlineCandidateCreated = false;
  let outlineActivated = false;
  let unexpectedCanonWrites = 0;
  const characterCandidate = { id: 'character-candidate', novelId: novel.id, target: { kind: 'character', id: 'char-1', label: '林舟' }, operation: 'optimize', goal: '补充角色能力', baseFingerprint: 'base-1', sourceCapabilityVersions: [{ capabilityId: 'bible-character-arc', version: '1' }], proposedCore: { identity: '候选能力已确认' }, diff: { changed: true, fields: [{ path: 'identity', after: '候选能力已确认', kind: 'added' }] }, impactReport: { downstream: [{ kind: 'master-outline', id: 'outline-impact', version: 1 }, { kind: 'narrative-promise', id: 'foreshadowing-impact', version: 1 }], reviewRequired: [{ kind: 'master-outline', id: 'outline-impact', version: 1 }, { kind: 'narrative-promise', id: 'foreshadowing-impact', version: 1 }], manuscriptConflict: false, reasons: ['角色变化需要复核大纲与伏笔，但不得自动写入'] }, status: 'pending' };
  const worldCandidate = { id: 'world-candidate', novelId: novel.id, target: { kind: 'world', id: novel.id, label: '导入 Canon 作品' }, operation: 'optimize', goal: '补充灯光规则', baseFingerprint: 'world-base-1', sourceCapabilityVersions: [{ capabilityId: 'bible-world-builder', version: '1' }], proposedCore: { premise: '灯光是城市记忆的锚点', rules: ['灯光不会自动熄灭'] }, proposedContent: '候选世界观：灯光是城市记忆的锚点。', diff: { changed: true, fields: [{ path: 'premise', after: '灯光是城市记忆的锚点', kind: 'added' }] }, impactReport: { downstream: [], reviewRequired: [], manuscriptConflict: false, reasons: ['世界规则候选仅在接受后进入 Canon'] }, status: 'pending' };
  await page.route('**/api/db', async route => {
    const method = route.request().postDataJSON()?.method;
    if (method === 'updateNovel' || method === 'createForeshadowing' || method === 'updateForeshadowing') unexpectedCanonWrites += 1;
    const result = method === 'listNovels' ? [novel]
      : method === 'getNovel' ? novel
        : method === 'listContinuationPacks' ? [pack]
          : method === 'listChapters' ? [chapter]
            : method === 'listChaptersMetadata' ? [{ id: chapter.id, chapterNumber: 1, title: chapter.title, status: chapter.status, wordCount: 10, updatedAt: 1 }]
              : method === 'getChapter' ? chapter
                : method === 'updateChapter' ? chapter
            : method === 'createChapter' ? { ...chapter, id: 'chapter-2', chapterNumber: 2, title: '第 2 章' }
                : method === 'listChapterProductionRuns' ? [{ id: 'run-1', novelId: novel.id, targetChapterId: chapter.id, status: 'applied', draftContent: chapter.content, sceneBeats: chapter.sceneBeats, continuityReport: { issues: [] } }]
                  : method === 'getChapterProductionRun' ? { id: 'run-1', novelId: novel.id, targetChapterId: chapter.id, status: 'applied', draftContent: chapter.content, sceneBeats: chapter.sceneBeats, continuityReport: { issues: [] } }
            : method === 'listCharacters' ? [{ id: 'char-1', novelId: novel.id, name: '林舟', role: 'protagonist', summary: '原始角色摘要', bio: '原始角色传记', traits: [], core: accepted ? { identity: '候选能力已确认' } : undefined, createdAt: 1, updatedAt: 1 }]
            : method === 'listEntityRelationships' ? [{ id: 'relationship-1', novelId: novel.id, sourceType: 'location', sourceId: 'loc-1', targetType: 'faction', targetId: 'faction-1', relationshipType: '守护', description: '城门灯光守护失落城市', createdAt: 1 }]
            : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result }) });
  });
  await page.route('**/api/db/generation', route => route.fulfill({ status: 200, json: { databaseGeneration: 1 } }));
  await page.route('**/api/capability-recommendations/dismissed', route => route.fulfill({ json: { dismissed: false } }));
  await page.route('**/api/novels/*/artifacts?kind=character&status=pending', route => route.fulfill({ json: { cores: [], candidates: candidateGenerated && !accepted ? [characterCandidate] : [] } }));
  await page.route('**/api/novels/*/artifacts?kind=world&status=pending', route => route.fulfill({ json: { cores: worldAccepted ? [{ artifactId: novel.id, version: 2, core: worldCandidate.proposedCore }] : [], candidates: worldCandidateGenerated && !worldAccepted ? [worldCandidate] : [] } }));
  await page.route('**/api/generate-outline', async route => {
    const body = route.request().postDataJSON() as { techniqueId?: string };
    if (body.techniqueId === 'bible-world-builder') worldCandidateGenerated = true;
    else if (body.techniqueId === 'bible-character-arc') candidateGenerated = true;
    if (body.techniqueId === 'bible-world-builder') return route.fulfill({ json: { jobId: 'world-candidate-job', databaseGeneration: 1 } });
    if (body.techniqueId === 'bible-character-arc') return route.fulfill({ json: { jobId: 'character-candidate-job', databaseGeneration: 1 } });
    return route.fulfill({ json: { jobId: 'outline-candidate-job', databaseGeneration: 1 } });
  });
  await page.route('**/api/world/jobs/character-candidate-job**', route => route.fulfill({ json: { status: 'completed', result: { candidate: characterCandidate } } }));
  await page.route('**/api/world/jobs/world-candidate-job**', route => route.fulfill({ json: { status: 'completed', result: { candidate: worldCandidate } } }));
  await page.route('**/api/world/jobs/outline-candidate-job**', route => route.fulfill({ json: { status: 'completed', result: { outline: '候选主纲：林舟沿灯光追查城市记忆，第一卷揭开城门真相。' } } }));
  await page.route('**/api/novels/*/artifacts/candidates/*/accept', async route => {
    const candidateId = route.request().url().split('/').at(-2);
    if (candidateId === worldCandidate.id) {
      worldAccepted = true;
      return route.fulfill({ json: { core: { core: worldCandidate.proposedCore, version: 2 } } });
    }
    accepted = true;
    return route.fulfill({ json: { core: { core: { identity: '候选能力已确认' }, version: 2 } } });
  });
  await page.route('**/api/novels/*/outlines', async route => {
    if (route.request().method() === 'POST') {
      outlineCandidateCreated = true;
      return route.fulfill({ json: { id: 'outline-candidate', novelId: novel.id, level: 'master', scope: {}, content: '候选主纲：林舟沿灯光追查城市记忆，第一卷揭开城门真相。', status: 'candidate', source: 'ai-proposal', version: 1, createdAt: 1, updatedAt: 1 } });
    }
    return route.fulfill({ json: outlineActivated ? [{ id: 'outline-candidate', novelId: novel.id, level: 'master', scope: {}, content: '候选主纲：林舟沿灯光追查城市记忆，第一卷揭开城门真相。', status: 'active', source: 'ai-proposal', version: 1, createdAt: 1, updatedAt: 1 }] : [] });
  });
  await page.route('**/api/novels/*/outlines/*/activate', async route => { outlineActivated = true; await route.fulfill({ json: { archivedIds: [], demotedIds: [] } }); });
  const completion = { quality: 'pass', gate: { contentHash: 'content-hash', planHash: 'plan-hash', quality: 'pass', completionGate: 'ready', deterministicIssues: [], unknownChecks: [], reviewRequired: false, canAcceptLocalRevision: false }, phase: 'facts-proposed', factCandidateId: 'fact-1', factCandidateRunId: 'run-1' };
  const candidate = { id: 'fact-1', novelId: novel.id, runId: 'run-1', databaseGeneration: 1, storyMemoryFingerprint: 'memory', status: 'pending', manuscript: { contentHash: 'content-hash', evidence: '正文证据' }, facts: [{ id: 'fact-safe', kind: 'character', action: 'append', title: '林舟状态', evidence: '林舟继续前进', evidenceSpan: { start: 0, end: 4 }, target: { kind: 'character', id: 'char-1', label: '林舟' }, proposedValue: {}, destructive: false, ambiguous: false, selectable: true }] };
  await page.route('**/api/chapters/*/complete', route => route.fulfill({ json: completion }));
  await page.route(/\/api\/chapter-production-runs\/run-1(?:\?.*)?$/, route => route.fulfill({ json: { id: 'run-1', novelId: novel.id, targetChapterId: chapter.id, status: 'applied', draftContent: chapter.content, sceneBeats: chapter.sceneBeats, continuityReport: { issues: [] } } }));
  await page.route(/\/api\/chapter-production-runs(?:\?.*)?$/, route => route.fulfill({ json: [{ id: 'run-1', novelId: novel.id, targetChapterId: chapter.id, status: 'applied', draftContent: chapter.content, sceneBeats: chapter.sceneBeats, continuityReport: { issues: [] } }] }));
  await page.route('**/api/chapter-production-runs/run-1/fact-candidate/preview', route => route.fulfill({ json: candidate }));
  await page.route('**/api/chapter-production-runs/run-1/fact-candidate/apply', route => { factApplied = true; return route.fulfill({ json: { candidate, factStatuses: { 'fact-safe': 'accepted' } } }); });
  return {
    get accepted() { return accepted; },
    get worldAccepted() { return worldAccepted; },
    get factApplied() { return factApplied; },
    get outlineCandidateCreated() { return outlineCandidateCreated; },
    get outlineActivated() { return outlineActivated; },
    get unexpectedCanonWrites() { return unexpectedCanonWrites; },
    get candidateImpactKinds() { return characterCandidate.impactReport.reviewRequired.map((impact) => impact.kind); },
  };
}

test.describe('统一创作旅程：导入作品', () => {
  test('导入 Canon 保持不变，确认候选后完成章节并打开下一章', async ({ page }) => {
    test.setTimeout(60_000);
    const fixture = await mockImportedDb(page);
    await page.addInitScript(({ novelId }) => {
      localStorage.setItem('inkflow-last-view', 'world');
      localStorage.setItem('inkflow-selected-novel-id', novelId);
      localStorage.setItem('inkflow-world-bible-active-tab', 'overview');
    }, { novelId: novel.id });
    await ready(page);
    await expect(page.getByText(/资料续写总览|已接入资料包|未接入资料包/).first()).toBeVisible();
    await expect(page.getByText(pack.title, { exact: false })).toBeVisible();
    await expect(page.getByText(/资料包已确认|已接入资料包/).first()).toBeVisible();
    await page.getByRole('button', { name: '世界设定', exact: true }).click();
    const worldReview = page.getByRole('region', { name: '世界观候选审阅' });
    await worldReview.getByRole('button', { name: '生成世界观结构候选', exact: true }).click();
    await expect(worldReview).toContainText('候选世界观：灯光是城市记忆的锚点');
    expect(fixture.worldAccepted).toBe(false);
    await worldReview.getByRole('button', { name: '接受世界观候选', exact: true }).click();
    await expect.poll(() => fixture.worldAccepted).toBe(true);
    await expect(page.getByRole('textbox', { name: '描述小说的起承转合、主线任务、结局走向' })).toHaveValue(novel.globalOutline);
    await expect(page.getByRole('textbox', { name: '例如：修仙体系境界、魔法运转原理、科技文明等级' })).toHaveValue(novel.worldRules);
    await page.getByRole('button', { name: /人物档案/ }).click();
    const recommendation = page.getByRole('region', { name: '上下文能力推荐' });
    await expect(recommendation).toContainText('bible-character-arc');
    await recommendation.getByRole('button', { name: /使用 bible-character-arc/ }).click();
    const characterCandidate = page.getByLabel('接受角色候选');
    await expect(characterCandidate).toBeVisible();
    await page.getByLabel('预览角色候选').click();
    await expect(page.getByRole('region', { name: '角色候选预览' })).toContainText('候选能力已确认');
    expect(fixture.accepted).toBe(false);
    await characterCandidate.click();
    await expect.poll(() => fixture.accepted).toBe(true);
    expect(fixture.candidateImpactKinds).toEqual(['master-outline', 'narrative-promise']);
    expect(fixture.unexpectedCanonWrites).toBe(0);
    await page.getByRole('button', { name: '总览', exact: true }).click();
    await page.getByRole('button', { name: '世界设定', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '描述小说的起承转合、主线任务、结局走向' })).toHaveValue(novel.globalOutline);
    await expect(page.getByRole('textbox', { name: '例如：修仙体系境界、魔法运转原理、科技文明等级' })).toHaveValue(novel.worldRules);
    await page.getByRole('button', { name: '总览', exact: true }).click();
    const candidate = page.getByRole('button', { name: /开始按资料续写/ }).first();
    await expect(candidate).toBeVisible();
    await candidate.click();
    const editor = page.locator('textarea[placeholder="在这里开始书写这一章……"]');
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '展开智能管家', exact: true }).click();
    const workspace = page.getByTestId('agent-workspace');
    await workspace.getByRole('button', { name: '更多', exact: true }).click();
    await workspace.getByRole('menuitem', { name: '全书大纲', exact: true }).click();
    await workspace.getByPlaceholder('预计总字数 (如: 1000000)').fill('100000');
    await workspace.getByRole('button', { name: 'AI 生成作品大纲', exact: true }).click();
    await expect(workspace).toContainText('生成结果已作为候选，请确认后才会写入主纲');
    expect(fixture.outlineCandidateCreated).toBe(true);
    expect(fixture.outlineActivated).toBe(false);
    await workspace.getByRole('button', { name: '确认采用候选', exact: true }).click();
    await expect.poll(() => fixture.outlineActivated).toBe(true);
    await expect(workspace.locator('textarea').first()).toHaveValue(/候选主纲：林舟沿灯光追查城市记忆/);
    await workspace.getByRole('button', { name: '收起智能管家', exact: true }).click();
    await editor.fill('林舟沿着原始 Canon 的灯光继续前进。');
    await expect(editor).toHaveValue(/原始 Canon/);
    const save = page.getByRole('button', { name: /保存正文|保存/ }).first();
    if (await save.count()) await save.click();
    const complete = page.getByRole('button', { name: '完成本章', exact: true });
    await expect(complete).toBeVisible();
    await complete.click();
    await expect(page.getByRole('region', { name: '章节完成审阅' })).toBeVisible();
    const facts = page.getByRole('button', { name: '确认事实并写入', exact: true });
    await expect(facts).toBeVisible();
    await expect(facts).toBeEnabled();
    await facts.click();
    await expect.poll(() => fixture.factApplied).toBe(true);
    await page.getByRole('button', { name: '展开智能管家', exact: true }).click();
    const postFactWorkspace = page.getByTestId('agent-workspace');
    await postFactWorkspace.getByRole('button', { name: '当前', exact: true }).click();
    await postFactWorkspace.getByRole('button', { name: '查看完整关系图', exact: true }).click();
    await expect(page.getByText('全局实体关系图谱', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '创作工作台', exact: true }).click();
    await expect(page.locator('textarea[placeholder="在这里开始书写这一章……"]')).toBeVisible();
    await page.getByRole('button', { name: /章节列表/ }).click();
    const next = page.locator('button[title="新建章节"]');
    await expect(next).toBeVisible();
    await next.click();
    await expect(page.locator('#chapter-title')).toHaveValue(/第\s*2\s*章/);
    await page.getByRole('button', { name: '展开智能管家', exact: true }).click();
    await page.getByTestId('agent-workspace').getByRole('button', { name: '生成正文', exact: true }).click();
    const contextReceipt = page.getByTestId('agent-workspace').getByText(/上下文来源未知|生成上下文摘要|生成上下文已就绪/).first();
    await contextReceipt.click();
    await expect(page.getByTestId('agent-workspace')).toContainText('目标章节: 第 2 章');
    await expect(page.getByTestId('agent-workspace')).toContainText(`资料包: ${pack.title}`);
  });
});
