import { expect, test, type Page } from '@playwright/test';

const novel = {
  id: 'e2e-novel', title: '协议验收作品', authorId: 'local-user', summary: 'E2E fixture',
  status: 'ongoing' as const, createdAt: 1, updatedAt: Date.now(), globalOutline: '', worldRules: '',
};
const pack = {
  id: 'e2e-pack', novelId: novel.id, title: '协议验收资料包', status: 'approved' as const,
  sourceDocuments: [], canonFacts: [{ id: 'fact-1', priority: 'hard' as const, category: 'world' as const, text: 'fixture', evidence: 'fixture' }],
  characterStates: [], plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
  styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
  contradictions: [], continuationTask: '', createdAt: 1, updatedAt: 1,
};
const snapshot = {
  packId: pack.id, novelId: novel.id, databaseGeneration: 7,
  extraction: { characters: [{ name: '林舟', role: '主角', summary: 'fixture', bio: 'fixture', traits: [] }], locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [], relationships: [], globalOutline: '同步预览大纲', worldRules: '同步预览规则' },
};

async function waitForAppReady(page: Page) {
  await expect(page.getByTestId('app-ready')).toHaveAttribute('data-ready-state', 'true');
}

function installDbMock(page: Page) {
  return page.route('**/api/db', async (route) => {
    const body = route.request().postDataJSON()?.method;
    const result = body === 'listNovels' ? [novel]
      : body === 'getNovel' ? novel
      : body === 'listContinuationPacks' ? [pack]
      : body === 'listCharacters' || body === 'listLocations' || body === 'listItems' || body === 'listFactions' || body === 'listPowerLevels' || body === 'listTimelineEvents' || body === 'listEntityRelationships' ? []
      : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result }) });
  });
}

function installDiagnostics(page: Page, expectedServerErrorCount = 0) {
  const errors: string[] = [];
  let serverErrorCount = 0;
  const expectedServerError = 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)';
  page.on('pageerror', (error: Error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text === expectedServerError && serverErrorCount < expectedServerErrorCount) {
      serverErrorCount++;
      return;
    }
    errors.push(`console: ${text}`);
  });
  return () => {
    expect(serverErrorCount).toBe(expectedServerErrorCount);
    expect(errors, errors.join('\n')).toEqual([]);
  };
}

async function openPackManagement(page: Page) {
  await page.addInitScript(({ novelId }) => {
    localStorage.setItem('inkflow-last-view', 'world');
    localStorage.setItem('inkflow-selected-novel-id', novelId);
    localStorage.setItem('inkflow-world-bible-active-tab', 'pack-management');
  }, { novelId: novel.id });
  await page.goto('/');
  await waitForAppReady(page);
  const packManagementTab = page.getByRole('button', { name: /资料包管理/ }).first();
  await expect(packManagementTab).toBeVisible();
  await packManagementTab.click();
  await page.getByRole('button', { name: new RegExp(pack.title) }).last().click();
  await expect(page.locator(`[aria-label="当前资料包：${pack.title}"]`)).toBeVisible();
}

test.describe('资料包实体提取失败协议', () => {
  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(30_000);
    const warmupPage = await browser.newPage();
    try {
      await warmupPage.goto('http://localhost:3001/');
    } finally {
      await warmupPage.close();
    }
  });

  test('schema mismatch 展示详情，resume 同一 job 后显示同步预览', async ({ page }) => {
    await installDbMock(page);
    await page.route('**/api/db/generation', route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'x-inkflow-database-generation': '7' }, body: JSON.stringify({ databaseGeneration: 7 }) }));
    let mode: 'failed' | 'completed' = 'failed';
    const requests: string[] = [];
    await page.route('**/api/continuation-packs/extract-entities', route => { requests.push('extract'); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'job-schema', databaseGeneration: 7 }) }); });
    await page.route('**/api/continuation-packs/jobs/job-schema/resume', route => { requests.push('resume'); mode = 'completed'; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'job-schema', databaseGeneration: 7 }) }); });
    await page.route('**/api/continuation-packs/jobs/job-schema**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() !== 'GET' || url.pathname !== '/api/continuation-packs/jobs/job-schema') {
        return route.fallback();
      }
      requests.push('job');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mode === 'failed' ? { status: 'failed', currentChunk: 2, totalChunks: 4, code: 'EXTRACTION_SCHEMA_MISMATCH', error: '字段不符合 schema', traceId: 'trace-schema', databaseGeneration: 7, schemaIssues: [{ path: 'characters[0].name', code: 'invalid_type', message: '必须是字符串' }], failedChunk: { attempt: 3 } } : { status: 'completed', progress: 100, stageText: '完成', result: snapshot }) });
    });

    const assertClean = installDiagnostics(page);
    await page.setViewportSize({ width: 737, height: 674 });
    await openPackManagement(page);
    await page.getByLabel(`当前资料包：${pack.title}`).getByRole('button', { name: /提取并预览|同步到设定/ }).click();
    await expect(page.getByRole('alert')).toContainText('EXTRACTION_SCHEMA_MISMATCH');
    await expect(page.getByRole('alert')).toContainText('第 2/4 批');
    await expect(page.getByRole('alert')).toContainText('trace-schema');
    await page.getByText('错误详情').click();
    await expect(page.getByRole('alert')).toContainText('安全详情：字段不符合 schema');
    const alert = page.getByRole('alert');
    const alertDimensions = await alert.evaluate((el: HTMLElement) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(alertDimensions.scrollWidth).toBeLessThanOrEqual(alertDimensions.clientWidth);
    await page.getByRole('button', { name: '修复并重试本批' }).click();
    await expect(page.getByText('同步预览')).toBeVisible();
    expect(requests.filter((r) => r === 'resume')).toHaveLength(1);
    expect(requests.filter((r) => r === 'extract')).toHaveLength(1);
    assertClean();
  });

  test('polling unavailable 的重新查询只发 GET，不 resume 或新建任务', async ({ page }) => {
    await installDbMock(page);
    await page.route('**/api/db/generation', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ databaseGeneration: 7 }) }));
    let pollCount = 0;
    let requeryMode = false;
    let resumeCount = 0;
    let extractCount = 0;
    await page.route('**/api/continuation-packs/extract-entities', route => { extractCount++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'job-poll', databaseGeneration: 7 }) }); });
    const pollMethods: string[] = [];
    await page.route('**/api/continuation-packs/jobs/job-poll**', route => {
      const request = route.request();
      if (request.method() !== 'GET') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected non-GET' }) });
      pollMethods.push(request.method());
      pollCount++;
      if (requeryMode) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'completed', progress: 100, stageText: '完成', result: snapshot }) });
      }
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '暂时不可用' }) });
    });
    await page.route('**/api/continuation-packs/jobs/job-poll/resume', route => { resumeCount++; return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected resume' }) }); });
    const assertClean = installDiagnostics(page, 5);
    await openPackManagement(page);
    await page.getByLabel(`当前资料包：${pack.title}`).getByRole('button', { name: /提取并预览|同步到设定/ }).click();
    await expect(page.getByRole('alert')).toContainText('EXTRACTION_POLLING_UNAVAILABLE', { timeout: 12000 });
    const failedPollCount = pollCount;
    expect(failedPollCount).toBeGreaterThanOrEqual(5);
    requeryMode = true;
    await page.getByRole('button', { name: '重新查询进度' }).click();
    await expect(page.getByText('同步预览')).toBeVisible();
    expect(pollMethods.slice(failedPollCount)).toEqual(['GET']);
    expect(resumeCount).toBe(0);
    expect(extractCount).toBe(1);
    assertClean();
  });
});
