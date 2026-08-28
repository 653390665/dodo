import { expect, test, type Page } from '@playwright/test';
import { DETERMINISTIC_PRODUCTION_DRAFT } from './fixtures/deterministic-production-draft';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-ready')).toHaveAttribute('data-ready-state', 'true');
}

async function mockProviderBoundaries(page: Page, availability: 'unknown' | 'available' = 'available') {
  let reviewCalls = 0;
  let completionCalls = 0;
  let productionApplyCalls = 0;
  let productionApplied = false;
  let productionAppliedChapterId = '';
  const completion = { quality: 'unknown', gate: { contentHash: 'content-hash', planHash: 'plan-hash', quality: 'unknown', completionGate: 'review-required', deterministicIssues: [], unknownChecks: ['ai-review'], reviewRequired: true, canAcceptLocalRevision: false }, phase: 'facts-proposed', factCandidateId: 'fact-1', factCandidateRunId: 'run-1' };
  const candidate = { id: 'fact-1', novelId: 'local', runId: 'run-1', databaseGeneration: 1, storyMemoryFingerprint: 'memory', status: 'pending', manuscript: { contentHash: 'content-hash', evidence: '正文证据' }, facts: [{ id: 'fact-safe', kind: 'character', action: 'append', title: '调查者状态', evidence: '调查者继续前进', evidenceSpan: { start: 0, end: 4 }, target: { kind: 'character', id: 'char-1', label: '调查者' }, proposedValue: {}, destructive: false, ambiguous: false, selectable: true }] };
  await page.route('**/api/onboarding/llm-session', route => route.fulfill({ status: 201, json: { sessionId: 'e2e-unified-session' } }));
  await page.route('**/api/story-cards', route => route.fulfill({ json: { source: 'fallback', cards: [{ id: 'e2e-card', hook: '废墟中的灯', protagonist: '调查者', coreConflict: '寻找城市真相', tone: '紧张', whyItWorks: '明确冲突', starterSeeds: { worldSeed: '废墟', relationshipSeed: '调查者与失踪者', chapterOneSeed: '发现灯光' }, planningFit: { recommendedLength: '中长篇规划', recommendedFocus: '剧情推进', recommendedPacing: '紧推进', reason: '快速进入冲突' }, riskNote: '保留谜团', mixTags: ['悬疑'], signals: { tone: '紧张', conflictType: '探索', worldWeight: 0.5, characterWeight: 0.5, pacingPreference: 'tight' }, sourceBadge: 'manual' }] } }));
  await page.route('**/api/audit', async route => { reviewCalls += 1; await route.fulfill({ json: availability === 'unknown' ? { status: 'unknown', auditMeta: { status: 'unknown', source: 'model' } } : { status: 'completed', score: 92, auditMeta: { status: 'pass', source: 'model' } } }); });
  await page.route('**/api/audit/jobs/**', route => route.fulfill({ json: { status: 'completed', result: { score: 92, issues: [] } } }));
  await page.route('**/api/orchestrate-draft', async route => {
    const body = route.request().postDataJSON() as { databaseGeneration?: number };
    const events = [
      { type: 'status', message: '确定性测试正文已生成' },
      { type: 'token', content: '' },
      { type: 'done', text: DETERMINISTIC_PRODUCTION_DRAFT },
    ];
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'x-inkflow-database-generation': String(body.databaseGeneration ?? 1) },
      body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    });
  });
  await page.route('**/api/chapter-production-runs/start-stream', async route => {
    const body = route.request().postDataJSON() as { novelId?: string; chapterId?: string; databaseGeneration?: number; userIntent?: string };
    const now = Date.now();
    const report = {
      score: 82,
      issues: [],
      proposedPatch: {
        characterUpdates: [],
        itemUpdates: [],
        foreshadowingUpdates: [],
        timelineEventsToCreate: [],
        foreshadowingsToCreate: [],
      },
      auditMeta: { status: 'pass', source: 'model' },
      databaseGeneration: body.databaseGeneration ?? 1,
    };
    const run = {
      id: 'run-1',
      novelId: body.novelId || 'local',
      targetChapterId: body.chapterId || '',
      status: 'review_required',
      userIntent: body.userIntent || '',
      sceneBeats: '调查者进入废墟；发现未熄灭的灯；追兵逼近，暗门开启。',
      draftContent: DETERMINISTIC_PRODUCTION_DRAFT,
      styleAudit: '',
      continuityReport: report,
      createdAt: now,
      updatedAt: now,
    };
    const events = [
      { type: 'run_created', runId: run.id },
      { type: 'status', message: '确定性测试正文已生成' },
      { type: 'model_beats', content: run.sceneBeats },
      { type: 'model_draft_start' },
      { type: 'model_draft_token', content: run.draftContent },
      { type: 'model_draft_done' },
      { type: 'model_audit', content: '结构化审稿通过', status: 'pass', score: 92 },
      { type: 'model_continuity', report },
      { type: 'done', run },
    ];
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'x-inkflow-database-generation': String(body.databaseGeneration ?? 1) },
      body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    });
  });
  await page.route(/\/api\/chapter-production-runs\/[^/]+\/apply$/, async route => {
    productionApplyCalls += 1;
    const body = route.request().postDataJSON() as { chapterId?: string; targetChapterId?: string };
    productionApplied = true;
    productionAppliedChapterId = body.chapterId || body.targetChapterId || 'chapter-1';
    await route.fulfill({ status: 200, json: { chapterId: productionAppliedChapterId } });
  });
  await page.route('**/api/db', async route => {
    if (!productionApplied || route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON() as { method?: string; args?: unknown[] };
    if (body.method !== 'getChapter' || body.args?.[0] !== productionAppliedChapterId) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const payload = await response.json() as { result?: Record<string, unknown> };
    await route.fulfill({
      response,
      json: {
        ...payload,
        result: {
          ...payload.result,
          content: DETERMINISTIC_PRODUCTION_DRAFT,
          wordCount: DETERMINISTIC_PRODUCTION_DRAFT.replace(/\s/g, '').length,
        },
      },
    });
  });
  await page.route('**/api/chapters/*/complete', route => { completionCalls += 1; return route.fulfill({ json: completion }); });
  await page.route('**/api/chapters/*/complete/risk', route => route.fulfill({ json: { ...completion, gate: { ...completion.gate, completionGate: 'accepted-risk', reviewRequired: false }, riskAccepted: true } }));
  await page.route('**/api/chapter-production-runs/run-1/fact-candidate/preview', route => route.fulfill({ json: candidate }));
  await page.route('**/api/chapter-production-runs/run-1/fact-candidate/apply', route => route.fulfill({ json: { candidate, factStatuses: { 'fact-safe': 'accepted' } } }));
  return {
    get reviewCalls() { return reviewCalls; },
    get completionCalls() { return completionCalls; },
    get productionApplyCalls() { return productionApplyCalls; },
  };
}

test.describe('统一创作旅程：新建作品', () => {
  test('创建、确认、完成本章并进入下一章', async ({ page }) => {
    test.setTimeout(60_000);
    const provider = await mockProviderBoundaries(page);
    await ready(page);
    await page.locator('#story-seed-input').fill('统一创作旅程：调查者在废墟中寻找失落城市。');
    await page.getByRole('button', { name: /下一步：选择发布平台/ }).click();
    await page.getByRole('button', { name: /番茄平台/ }).first().click();
    await page.getByRole('button', { name: /下一步：篇幅与文风/ }).click();
    await page.getByRole('button', { name: /中长篇规划/ }).first().click();
    await page.getByRole('button', { name: /剧情高能/ }).first().click();
    await page.getByRole('button', { name: /唤醒灵感，智能开书立项/ }).click();
    await expect(page.getByRole('heading', { name: /立项推荐方案方向/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /选择此立项/ }).first().click();
    await expect(page.getByText(/世界|角色|主纲|规划/).first()).toBeVisible();
    await page.getByRole('button', { name: /接受治理规划立项/ }).click();
    await page.getByRole('button', { name: '确认选项并继续', exact: true }).click();
    const flow = page.getByRole('button', { name: /选择推荐创作流程/ });
    if (await flow.count()) await flow.click();

    const editor = page.locator('textarea[placeholder="在这里开始书写这一章……"]');
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('app-shell-main').getByRole('button', { name: '能力商店', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '展开智能管家', exact: true }).click();
    const workspace = page.getByTestId('agent-workspace');
    await workspace.getByRole('button', { name: '分镜', exact: true }).click();
    await workspace.locator('textarea[placeholder^="请描述本章创作意图"]').fill('本章目标：调查者进入废墟并发现未熄灭的灯。');
    const acceptedPlan = workspace.locator('textarea[placeholder="点击上方按钮生成分镜，或在此手动规划情节重点..."]');
    await acceptedPlan.fill('固定分镜：调查者进入废墟；发现未熄灭的灯。');
    await expect(acceptedPlan).toHaveValue('固定分镜：调查者进入废墟；发现未熄灭的灯。');
    await workspace.getByRole('button', { name: '生成正文', exact: true }).click();
    await workspace.getByRole('textbox', { name: '生产意图' }).fill('按已确认分镜生成第一章正文。');
    const generate = workspace.getByRole('button', { name: /确认并生成|按「.*」扩写正文/ }).first();
    await generate.click();
    const styleDialog = workspace.getByRole('dialog', { name: '确认本次写法' });
    if (await styleDialog.count()) await styleDialog.getByRole('button', { name: '确认并生成', exact: true }).click();
    const acceptProse = workspace.getByRole('button', { name: '接受并写入', exact: true });
    await expect(acceptProse).toBeEnabled({ timeout: 30_000 });
    await acceptProse.click();
    const confirmUnreviewed = workspace.getByRole('button', { name: '确认写入', exact: true });
    if (await confirmUnreviewed.count()) await confirmUnreviewed.click();
    await expect.poll(() => provider.productionApplyCalls).toBe(1);
    await expect(editor).not.toHaveValue('');
    await workspace.getByRole('button', { name: '收起智能管家', exact: true }).click();
    await expect(page.getByRole('button', { name: '完成本章', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '完成本章', exact: true }).click();
    const completion = page.getByRole('region', { name: '章节完成审阅' });
    await expect(completion).toBeVisible();
    const acceptRisk = page.getByRole('button', { name: '接受未审阅风险', exact: true });
    await completion.getByRole('checkbox', { name: '确认接受未审阅风险' }).check();
    await expect(acceptRisk).toBeEnabled();
    await acceptRisk.click();
    const factConfirm = page.getByRole('button', { name: '确认事实并写入', exact: true });
    await expect(factConfirm).toBeVisible();
    await expect(factConfirm).toBeEnabled();
    await factConfirm.click();
    await page.getByRole('button', { name: /章节列表/ }).click();
    await page.locator('button[title="新建章节"]').click();
    await expect(page.locator('#chapter-title')).toHaveValue(/第\s*2\s*章/);
    expect(provider.completionCalls).toBe(1);
    expect(provider.reviewCalls).toBeLessThanOrEqual(1);
  });

  test('provider unknown 时仍可手动写作、接受风险并创建下一章', async ({ page }) => {
    test.setTimeout(60_000);
    await mockProviderBoundaries(page, 'unknown');
    await ready(page);
    await page.locator('#story-seed-input').fill('未知模型降级旅程。');
    await page.getByRole('button', { name: /下一步：选择发布平台/ }).click();
    await page.getByRole('button', { name: /番茄平台/ }).first().click();
    await page.getByRole('button', { name: /下一步：篇幅与文风/ }).click();
    await page.getByRole('button', { name: /中长篇规划/ }).first().click();
    await page.getByRole('button', { name: /剧情高能/ }).first().click();
    await page.getByRole('button', { name: /唤醒灵感，智能开书立项/ }).click();
    await expect(page.getByRole('heading', { name: /立项推荐方案方向/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /选择此立项/ }).first().click();
    await page.getByRole('button', { name: /接受治理规划立项/ }).click();
    await page.getByRole('button', { name: '确认选项并继续', exact: true }).click();
    const flow = page.getByRole('button', { name: /选择推荐创作流程/ });
    if (await flow.count()) await flow.click();
    const editor = page.locator('textarea[placeholder="在这里开始书写这一章……"]');
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.fill('模型不可用时仍保留手动正文。');
    await page.getByRole('button', { name: '完成本章', exact: true }).click();
    const completion = page.getByRole('region', { name: '章节完成审阅' });
    await expect(completion).toContainText(/部分 AI 检查暂不可用/);
    const acceptRisk = completion.getByRole('button', { name: '接受未审阅风险', exact: true });
    await completion.getByRole('checkbox', { name: '确认接受未审阅风险' }).check();
    await expect(acceptRisk).toBeEnabled();
    await acceptRisk.click();
    const facts = page.getByRole('button', { name: '确认事实并写入', exact: true });
    await expect(facts).toBeVisible();
    await expect(facts).toBeEnabled();
    await facts.click();
    await page.getByRole('button', { name: /章节列表/ }).click();
    await page.locator('button[title="新建章节"]').click();
    await expect(page.locator('#chapter-title')).toHaveValue(/第\s*2\s*章/);
  });
});
