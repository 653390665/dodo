import { expect, test, type Page } from '@playwright/test';

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('app-ready')).toHaveAttribute('data-ready-state', 'true');
}

test.describe('可靠性 API 契约', () => {
  test('模型失败返回结构化错误且不泄露 API key', async ({ page }) => {
    await openApp(page);
    const result = await page.evaluate(async () => {
      const generationResponse = await fetch('/api/db/generation');
      const { databaseGeneration } = await generationResponse.json() as { databaseGeneration: number };
      const sessionResponse = await fetch('/api/onboarding/llm-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'inspiration' }),
      });
      const session = await sessionResponse.json() as { sessionId?: string };
      const response = await fetch('/api/inspiration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'e2e failure',
          surface: 'welcome',
          onboardingSessionId: session.sessionId,
          databaseGeneration,
        }),
      });
      return { status: response.status, body: await response.text() };
    });

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(600);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body.code).toBeTruthy();
    expect(body.traceId).toBeTruthy();
    expect(typeof body.retriable).toBe('boolean');
    expect(result.body.toLowerCase()).not.toContain('apikey');
    expect(result.body.toLowerCase()).not.toContain('api_key');
  });

  test('SSE 断连在 EOF 且无 DONE 时被标记为不完整', async ({ page }) => {
    await openApp(page);
    await page.route('**/api/inspiration', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"token":"partial"}\n\n',
      });
    });

    try {
      const result = await page.evaluate(async () => {
        const response = await fetch('/api/inspiration', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'e2e partial', surface: 'welcome', onboardingSessionId: 'route-mock', databaseGeneration: 1 }),
        });
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let body = '';
        if (reader) {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            body += decoder.decode(chunk.value, { stream: true });
          }
        }
        return { body, complete: body.includes('data: [DONE]') };
      });
      expect(result.body).toContain('partial');
      expect(result.body).not.toContain('[DONE]');
      expect(result.complete).toBe(false);
    } finally {
      await page.unroute('**/api/inspiration');
    }
  });

  test('数据库导出回灌后 generation 递增', async ({ page }) => {
    await openApp(page);
    const result = await page.evaluate(async () => {
      const beforeResponse = await fetch('/api/db/generation');
      const before = await beforeResponse.json() as { databaseGeneration: number };
      const exportResponse = await fetch('/api/db/export-file');
      if (!exportResponse.ok) return { before: before.databaseGeneration, exportStatus: exportResponse.status, importStatus: 0, after: before.databaseGeneration };
      const backup = await exportResponse.arrayBuffer();
      const importResponse = await fetch('/api/db/import-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: backup,
      });
      const afterResponse = await fetch('/api/db/generation');
      const after = await afterResponse.json() as { databaseGeneration: number };
      return {
        before: before.databaseGeneration,
        exportStatus: exportResponse.status,
        importStatus: importResponse.status,
        after: after.databaseGeneration,
      };
    });

    expect(result.exportStatus).toBe(200);
    expect(result.importStatus).toBeGreaterThanOrEqual(200);
    expect(result.importStatus).toBeLessThan(300);
    expect(result.after).toBeGreaterThan(result.before);
  });

  test('空白作品第一章直接写正文后生成分镜并写回', async ({ page }) => {
    test.setTimeout(60000);

    const dialogs: string[] = [];
    const consoleMessages: string[] = [];
    const apiFailures: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    page.on('console', (message) => consoleMessages.push(message.text()));
    page.on('response', (response) => {
      const pathname = new URL(response.url()).pathname;
      if ((pathname === '/api/editor-agent' || pathname === '/api/db') && response.status() >= 400) {
        apiFailures.push(`${response.status()} ${pathname}`);
      }
    });

    await openApp(page);
    await page.getByRole('button', { name: '我的书库', exact: true }).click();
    await expect(page.getByRole('heading', { name: /我的书库/ })).toBeVisible();

    const title = `E2E 空白作品 ${Date.now()}`;
    await page.getByRole('button', { name: '新作品', exact: true }).click();
    await expect(page.getByPlaceholder('在此输入新书名...')).toBeVisible();
    await page.getByPlaceholder('在此输入新书名...').fill(title);
    await page.getByRole('button', { name: '立即创建', exact: true }).click();

    const editor = page.locator('textarea[placeholder="在这里开始书写这一章……"]');
    await expect(editor).toBeVisible({ timeout: 15_000 });
    const content = '夜色压在废墟上，守门人听见远处传来第一声钟响。';
    await editor.fill(content);

    const generateBeats = page.getByTestId('app-shell-main').getByRole('button', { name: '生成分镜', exact: true });
    await expect(generateBeats).toBeVisible();
    await generateBeats.click();

    const sceneBeats = page.getByRole('textbox', { name: '点击上方按钮生成分镜，或在此手动规划情节重点...' });
    await expect(sceneBeats).toHaveValue(/\S/, { timeout: 30000 });
    await expect(page.getByTestId('app-shell-main').getByRole('button', { name: '完成本章', exact: true })).toBeVisible();

    const persisted = await page.evaluate(async (novelTitle) => {
      const response = await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-client-id': 'e2e-beats-verification' },
        body: JSON.stringify({ method: 'listNovels', args: [] }),
      });
      const novels = await response.json() as { result?: Array<{ id: string; title: string }> };
      const novel = novels.result?.find((entry) => entry.title === novelTitle);
      if (!novel) return null;
      const chapterResponse = await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-client-id': 'e2e-beats-verification' },
        body: JSON.stringify({ method: 'listChapters', args: [novel.id] }),
      });
      const chapters = await chapterResponse.json() as { result?: Array<{ order: number; content: string; sceneBeats?: string }> };
      return chapters.result?.find((chapter) => chapter.order === 1) || chapters.result?.[0] || null;
    }, title);

    expect(persisted).not.toBeNull();
    expect(persisted?.content).toContain(content);
    expect(persisted?.sceneBeats?.trim()).toBeTruthy();
    const failures = [...dialogs, ...consoleMessages].join('\n');
    expect(failures).not.toContain('Invalid editor-agent request');
    expect(failures).not.toMatch(/分镜生成失败|分镜保存失败/);
    expect(apiFailures).toEqual([]);
  });
});
