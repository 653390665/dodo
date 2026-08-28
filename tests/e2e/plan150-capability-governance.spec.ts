import { test, expect, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-ready')).toHaveAttribute('data-ready-state', 'true');
}

async function mockOnboardingStoryCards(page: Page) {
  await Promise.all([
    page.route('**/api/onboarding/llm-session', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({ json: { sessionId: 'e2e-plan150-story-cards' }, status: 201 });
    }),
    page.route('**/api/story-cards', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        json: {
          source: 'fallback',
          cards: [{
            id: 'e2e-plan150-card',
            hook: '废墟深处藏着一座仍在运转的城市。',
            protagonist: '在边境长大的调查者',
            coreConflict: '寻找城市真相，同时逃离追捕。',
            tone: '紧张、克制',
            whyItWorks: '便于快速进入冲突并建立世界谜团。',
            starterSeeds: {
              worldSeed: '雨夜废墟与失落城市入口。',
              relationshipSeed: '调查者与失踪者留下的线索。',
              chapterOneSeed: '调查者在城门前发现仍亮着的灯。',
            },
            planningFit: {
              recommendedLength: '中长篇规划',
              recommendedFocus: '剧情推进',
              recommendedPacing: '紧推进',
              reason: '以明确冲突启动故事。',
            },
            riskNote: '避免一次性解释全部谜团。',
            mixTags: ['悬疑', '废墟'],
            signals: {
              tone: '紧张',
              conflictType: '探索与追捕',
              worldWeight: 0.6,
              characterWeight: 0.4,
              pacingPreference: 'tight',
            },
            sourceBadge: 'manual',
          }],
        },
      });
    }),
  ]);
}

async function createNovel(page: Page) {
  await mockOnboardingStoryCards(page);
  await page.locator('#story-seed-input').fill('离线治理链路：主角在废墟中寻找失落的城市。');
  await page.getByRole('button', { name: /下一步：选择发布平台/ }).click();
  await page.getByRole('button', { name: /番茄平台/ }).first().click();
  await page.getByRole('button', { name: /下一步：篇幅与文风/ }).click();
  await page.getByRole('button', { name: /中长篇规划/ }).first().click();
  await page.getByRole('button', { name: /剧情高能/ }).first().click();
  await page.getByRole('button', { name: /唤醒灵感，智能开书立项/ }).click();
  await expect(page.getByRole('heading', { name: /立项推荐方案方向/ })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /选择此立项/ }).first().click();
  await page.getByRole('button', { name: /接受治理规划立项/ }).click();
  await page.getByRole('button', { name: '确认选项并继续', exact: true }).click();
  const enable = page.getByRole('button', { name: /选择推荐创作流程/ });
  if (await enable.count()) await enable.click();
  await expect(page.locator('textarea[placeholder="在这里开始书写这一章……"]')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '展开智能管家', exact: true }).click();
}

function mockGovernance(page: Page, mode: 'accept' | 'reject' | 'stale' = 'accept') {
  let activated = false;
  const activatedScoped = new Set<string>();
  let patchStatus: 'pending' | 'stale' | 'accepted' | 'rejected' = mode === 'stale' ? 'stale' : 'pending';
  let activationCalls = 0;
  let patchActionCalls = 0;
  let beatGenerationCalls = 0;
  return Promise.all([
    page.route(/\/api\/novels\/[^/]+\/outlines(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({ json: [
        { id: 'master-active', novelId: 'n', level: 'master', scope: {}, content: '唯一主纲：失落城市', source: 'user', status: 'active' },
        { id: 'master-candidate', novelId: 'n', level: 'master', scope: {}, content: '候选主纲：边境风暴', source: 'user', status: activated ? 'active' : 'candidate' },
        { id: 'report-candidate', novelId: 'n', level: 'master', scope: {}, content: '审稿报告：问题清单与评分', source: 'user', status: 'candidate' },
        { id: 'volume-1', novelId: 'n', level: 'volume', scope: { volumeName: '第一卷' }, content: '卷纲：寻找入口', source: 'user', status: activatedScoped.has('volume-1') ? 'active' : 'candidate' },
        { id: 'chapter-1', novelId: 'n', level: 'chapter', scope: { chapterStart: 1, chapterEnd: 1 }, content: '章纲：进入废墟', source: 'user', status: activatedScoped.has('chapter-1') ? 'active' : 'candidate' },
      ] });
    }),
    page.route(/\/api\/novels\/[^/]+\/outlines\/[^/]+\/activate$/, async (route) => {
      activationCalls += 1;
      const artifactId = route.request().url().split('/').at(-2);
      if (artifactId === 'volume-1' || artifactId === 'chapter-1') activatedScoped.add(artifactId);
      else activated = true;
      await route.fulfill({ json: { archivedIds: [], demotedIds: [] } });
    }),
    page.route(/\/api\/novels\/[^/]+\/canon-patches$/, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({ json: patchStatus === 'rejected' || patchStatus === 'accepted' ? [] : [{ id: 'patch-1', novelId: 'n', baseFingerprint: 'base-1', operations: [], status: patchStatus }] });
    }),
    page.route(/\/api\/novels\/[^/]+\/canon-patches\/[^/]+\/(accept|reject)$/, async (route) => {
      patchActionCalls += 1;
      patchStatus = mode === 'accept' ? 'accepted' : 'rejected';
      await route.fulfill({ json: { status: patchStatus, fingerprint: 'base-2' } });
    }),
    page.route('**/api/editor-agent', async (route) => {
      beatGenerationCalls += 1;
      const body = route.request().postDataJSON() as { databaseGeneration?: number };
      await route.fulfill({ json: { jobId: 'offline-beats-1', databaseGeneration: body.databaseGeneration ?? 1 } });
    }),
    page.route('**/api/agents/jobs/offline-beats-1**', async (route) => {
      await route.fulfill({ json: { id: 'offline-beats-1', status: 'completed', progress: 1, result: { text: '固定分镜：雨夜进入废墟；发现城市入口。' } } });
    }),
    page.route('**/api/novels/*/writing-style/resolve', async (route) => {
      await route.fulfill({ json: { resolution: { mode: 'default', fingerprint: 'style-1', summary: '离线写法', confirmed: false, sources: [{ label: '系统默认' }] }, candidates: [{ mode: 'default', summary: '系统默认' }] } });
    }),
    page.route('**/api/novels/*/writing-style/confirm', async (route) => {
      await route.fulfill({ json: { fingerprint: 'style-1', resolution: { mode: 'default', fingerprint: 'style-1', summary: '离线写法', confirmed: true, sources: [{ label: '系统默认' }] } } });
    }),
  ]).then(() => ({
    get activationCalls() { return activationCalls; },
    get patchActionCalls() { return patchActionCalls; },
    get beatGenerationCalls() { return beatGenerationCalls; },
    get patchStatus() { return patchStatus; },
  }));
}

test.describe('Plan150 capability governance', () => {
  test('desktop governance chain preserves user text and scene beats', async ({ page }) => {
    test.setTimeout(60000);
    const state = await mockGovernance(page);
    await ready(page);
    await createNovel(page);
    const workspace = page.getByTestId('agent-workspace');
    await workspace.getByRole('button', { name: '更多', exact: true }).click();
    await workspace.getByRole('menuitem', { name: '全书大纲', exact: true }).click();
    await expect(workspace).toContainText('大纲治理');
    await expect(workspace).toContainText('第一卷');
    await expect(workspace).toContainText('章 1-1');
    const candidate = workspace.getByLabel('主大纲 master-candidate');
    await candidate.check();
    await workspace.getByRole('button', { name: '设为主纲', exact: true }).nth(0).click();
    await expect.poll(() => state.activationCalls).toBe(1);
    const volumeRow = workspace.getByText('卷 第一卷', { exact: true }).locator('..');
    await volumeRow.getByRole('button', { name: '激活', exact: true }).click();
    await expect.poll(() => state.activationCalls).toBe(2);
    const chapterRow = workspace.getByText('章 1-1', { exact: true }).locator('..');
    await chapterRow.getByRole('button', { name: '激活', exact: true }).click();
    await expect.poll(() => state.activationCalls).toBe(3);
    await workspace.getByLabel('接受补丁').click();
    await expect.poll(() => state.patchActionCalls).toBe(1);
    expect(state.patchStatus).toBe('accepted');
    await expect(workspace).toContainText('暂无待确认补丁');
    await workspace.getByRole('button', { name: '分镜', exact: true }).click();
    const beats = workspace.getByRole('button', { name: /生成场景分镜/ });
    await expect(beats).toBeVisible();
    await beats.click();
    const sceneBeats = page.locator('textarea[placeholder="点击上方按钮生成分镜，或在此手动规划情节重点..."]');
    await expect.poll(() => state.beatGenerationCalls).toBe(1);
    await expect(sceneBeats).toHaveValue('固定分镜：雨夜进入废墟；发现城市入口。');
    const editor = page.locator('textarea[placeholder="在这里开始书写这一章……"]');
    await editor.fill('用户正文保留：城门在雨中开启。');
    await expect(editor).toHaveValue('用户正文保留：城门在雨中开启。');
  });

  test('desktop Canon patch reject is exposed through real UI', async ({ page }) => {
    test.setTimeout(60000);
    const state = await mockGovernance(page, 'reject');
    await ready(page);
    await createNovel(page);
    const workspace = page.getByTestId('agent-workspace');
    await workspace.getByRole('button', { name: '更多', exact: true }).click();
    await workspace.getByRole('menuitem', { name: '全书大纲', exact: true }).click();
    await expect(workspace.getByLabel('拒绝补丁')).toBeVisible();
    await workspace.getByLabel('拒绝补丁').click();
    await expect.poll(() => state.patchActionCalls).toBe(1);
    expect(state.patchStatus).toBe('rejected');
    await expect(workspace).toContainText('暂无待确认补丁');
  });

  test('report candidates stay read-only until explicitly shown', async ({ page }) => {
    test.setTimeout(60000);
    await mockGovernance(page);
    await ready(page);
    await createNovel(page);
    const workspace = page.getByTestId('agent-workspace');
    await workspace.getByRole('button', { name: '更多', exact: true }).click();
    await workspace.getByRole('menuitem', { name: '全书大纲', exact: true }).click();
    const toggle = workspace.getByRole('checkbox', { name: /显示报告类候选/ });
    await expect(toggle).toBeVisible();
    await expect(workspace.getByText(/报告候选 · 审稿报告/)).toHaveCount(0);
    await toggle.check();
    const report = workspace.getByText(/报告候选 · 审稿报告/);
    await expect(report).toBeVisible();
    const reportRow = report.locator('..');
    await expect(reportRow.locator('input')).toHaveCount(0);
    await expect(reportRow.getByRole('button')).toHaveCount(0);
  });

  test('stale Canon patch is visible and can be rejected', async ({ page }) => {
    test.setTimeout(60000);
    const state = await mockGovernance(page, 'stale');
    await ready(page);
    await createNovel(page);
    const workspace = page.getByTestId('agent-workspace');
    await workspace.getByRole('button', { name: '更多', exact: true }).click();
    await workspace.getByRole('menuitem', { name: '全书大纲', exact: true }).click();
    await expect(workspace.getByText(/Canon 基线已变化，失效补丁需重新生成或拒绝/)).toBeVisible();
    await expect(workspace.getByText(/patch-1 · 已失效，基线已变化/)).toBeVisible();
    await workspace.getByLabel('拒绝失效补丁').click();
    await expect.poll(() => state.patchActionCalls).toBe(1);
    expect(state.patchStatus).toBe('rejected');
    await expect(workspace).toContainText('暂无待确认补丁');
  });

});
