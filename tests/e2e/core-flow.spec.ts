import { test, expect, type Page } from '@playwright/test';
import { DETERMINISTIC_PRODUCTION_DRAFT } from './fixtures/deterministic-production-draft';

async function waitForAppReady(page: Page) {
  await expect(page.getByTestId('app-ready')).toHaveAttribute('data-ready-state', 'true');
}

async function installDeterministicProductionFixture(page: Page) {
  let chapterId = '';
  let applied = false;
  await page.route('**/api/chapter-production-runs/start-stream', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}') as { novelId?: string; chapterId?: string; databaseGeneration?: number; userIntent?: string };
    chapterId = body.chapterId || '';
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
      auditMeta: { status: 'unknown', source: 'fallback' },
      databaseGeneration: body.databaseGeneration ?? 1,
    };
    const run = {
      id: 'core-flow-production-run',
      novelId: body.novelId || 'core-flow-novel',
      targetChapterId: chapterId,
      status: 'review_required',
      userIntent: body.userIntent || '',
      sceneBeats: '钟声引发异动；林舟取得地图；追兵逼近，暗门开启。',
      draftContent: DETERMINISTIC_PRODUCTION_DRAFT,
      styleAudit: '',
      continuityReport: report,
      createdAt: now,
      updatedAt: now,
    };
    const events = [
      { type: 'run_created', runId: run.id },
      { type: 'status', message: '确定性测试正文已生成' },
      { type: 'fallback_beats', content: run.sceneBeats },
      { type: 'fallback_draft_token', content: run.draftContent },
      { type: 'fallback_draft_done' },
      { type: 'fallback_continuity', report },
      { type: 'done', run },
    ];
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'x-inkflow-database-generation': String(body.databaseGeneration ?? 1) },
      body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    });
  });
  await page.route('**/api/chapter-production-runs/*/apply', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}') as { chapterId?: string };
    applied = true;
    chapterId = body.chapterId || chapterId;
    await route.fulfill({ status: 200, json: { chapterId } });
  });
  await page.route('**/api/db', async (route) => {
    if (!applied || !chapterId || route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = JSON.parse(route.request().postData() || '{}') as { method?: string; args?: unknown[] };
    if (body.method !== 'getChapter' || body.args?.[0] !== chapterId) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const payload = await response.json() as { result?: Record<string, unknown> };
    await route.fulfill({
      response,
      json: { ...payload, result: { ...payload.result, content: DETERMINISTIC_PRODUCTION_DRAFT, wordCount: DETERMINISTIC_PRODUCTION_DRAFT.length } },
    });
  });
}

test.describe('InkFlow Core End-to-End & Interaction Flow', () => {
  test('Should load landing page and toggle SettingsModal successfully', async ({ page }) => {
    // 1. Visit integrated developer web app
    await page.goto('/');
    await waitForAppReady(page);

    // 2. Validate essential branding element or text is present on Welcome view
    await expect(page.locator('h2').first()).toContainText('INKFLOW');

    const advancedToolsButton = page.getByRole('button', { name: '高级工具', exact: true });
    await expect(advancedToolsButton).toHaveAttribute('aria-expanded', 'false');

    // 3. Trigger system settings using its designated button
    const settingsButton = page.locator('button[aria-label="系统设置"]');
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    // 4. Validate Settings Dialog exists and has appropriate ARIA attributes
    const settingsDialog = page.locator('#settings-dialog-container');
    await expect(settingsDialog).toBeVisible();
    await expect(settingsDialog).toHaveAttribute('role', 'dialog');
    await expect(settingsDialog).toHaveAttribute('aria-modal', 'true');

    // 5. Test Focus Trap - Verify first input/button gets active focus
    const firstInput = settingsDialog.locator('input, select, textarea, button').first();
    await expect(firstInput).toBeFocused();

    await settingsDialog.getByRole('tab', { name: '数据备份与管理', exact: true }).click();
    await page.setViewportSize({ width: 522, height: 674 });
    const localMetrics = settingsDialog.getByRole('region', { name: '本地创作指标', exact: true });
    await expect(localMetrics).toBeVisible();
    const settingsOverflow = await page.evaluate(() => ({
      dialog: (() => {
        const dialog = document.querySelector('#settings-dialog-container');
        return dialog ? dialog.scrollWidth <= dialog.clientWidth : false;
      })(),
      document: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      body: document.body.scrollWidth <= document.body.clientWidth,
    }));
    expect(settingsOverflow.dialog).toBe(true);
    expect(settingsOverflow.document).toBe(true);
    expect(settingsOverflow.body).toBe(true);
    await expect(settingsDialog.getByRole('button', { name: '导出本地创作指标', exact: true })).toBeVisible();
    await expect(settingsDialog.getByRole('button', { name: '清除本地创作指标', exact: true })).toBeVisible();

    // 6. Escape key should close SettingsDialog smoothly
    await page.keyboard.press('Escape');
    await expect(settingsDialog).not.toBeVisible();
  });

  test('Should execute full novel happy path end-to-end', async ({ page }) => {
    test.setTimeout(45000);

    // Attach console listener to surface browser errors
    page.on('console', async msg => {
      try {
        const serializedArgs = [];
        for (const arg of msg.args()) {
          try {
            const val = await arg.jsonValue();
            if (val && typeof val === 'object') {
              serializedArgs.push(JSON.stringify(val));
            } else {
              serializedArgs.push(String(val));
            }
          } catch {
            serializedArgs.push(arg.toString());
          }
        }
        console.log(`[BROWSER CONSOLE] [${msg.type().toUpperCase()}] ${serializedArgs.join(' ')}`);
      } catch (_err) {
        console.log(`[BROWSER CONSOLE ERROR LOGGING FAILED] ${msg.text()}`);
      }
    });
    page.on('pageerror', err => {
      console.log('[BROWSER UNHANDLED ERROR] ' + err.stack);
    });

    // 1. Visit integrated developer web app
    // 访问集成的开发者 Web 应用
    await page.goto('/');
    await waitForAppReady(page);
    await installDeterministicProductionFixture(page);

    // 2. Validate essential branding element or text is present on Welcome view
    // 验证欢迎页面上是否存在核心品牌元素或文本
    await expect(page.locator('h1')).toContainText('InkFlow 智能写作终端');

    // 3. Create a new project named "荒原黎明"
    // 创建一个名为 "荒原黎明" 的新作品
    const seedInput = page.locator('#story-seed-input');
    await expect(seedInput).toBeVisible();
    await seedInput.fill('荒原黎明：主角在末日废墟中觉醒了异能，开始复仇。');

    // Press Enter or click next step to proceed to step 2 (Target Platform)
    // 锁定灵感并进入下一步
    await page.locator('button:has-text("下一步：选择发布平台")').click();

    // Select target platform (e.g. Tomato platform)
    // 选择目标平台（如：番茄平台）
    await page.locator('button:has-text("番茄平台")').first().click();

    // Proceed to step 3 (Size and Style)
    // 进入下一步：篇幅与文风
    await page.locator('button:has-text("下一步：篇幅与文风")').click();

    // Select size and writing style
    // 选择预计篇幅与核心写作调性
    await page.locator('button:has-text("中长篇规划")').first().click();
    await page.locator('button:has-text("剧情高能")').first().click();

    // Trigger final generation and project initialization
    // 唤醒灵感，智能开书立项并等待生成
    await page.locator('button:has-text("唤醒灵感，智能开书立项")').click();

    // Wait for the local fallback or model direction cards to generate and show up
    // 等待本地保底或模型生成的方向卡片渲染显示
    const selectDirectionTitle = page.locator('h2:has-text("立项推荐方案方向")');
    await expect(selectDirectionTitle).toBeVisible({ timeout: 15000 });

    // Click the first direction card's button containing "选择此立项"
    // 点击包含 "选择此立项" 的第一个方向卡片按钮
    const firstDirectionCard = page.locator('button:has-text("选择此立项")').first();
    await expect(firstDirectionCard).toBeVisible();
    await firstDirectionCard.click();

    // Handle "智能开书配置推荐" modal dialog and accept recommendation
    // 处理 "智能开书配置推荐" 模态框并接受推荐
    const acceptRecommendationButton = page.locator('button:has-text("接受治理规划立项")');
    await expect(acceptRecommendationButton).toBeVisible();
    await acceptRecommendationButton.click();

    // Handle "生成设定确认单" (confirm checklist) modal.
    // 处理“生成设定确认单”，确认本次实际勾选的立项摘要。
    const confirmWriteButton = page.getByRole('button', { name: '确认选项并继续', exact: true });
    await expect(confirmWriteButton).toBeVisible();
    await confirmWriteButton.click();

    // Choose the recommended flow inside the onboarding bubble and enter the editor.
    // 在智能引导弹窗中选择推荐创作流程并进入编辑器。
    const enableFlowButton = page.locator('button:has-text("选择推荐创作流程")');
    await expect(enableFlowButton).toBeVisible();
    await enableFlowButton.click();

    // 4. Creating a project now lands directly in the Editor View.
    // 创建作品后直接进入编辑器主写作视图。
    const editorTextarea = page.locator('textarea[placeholder="在这里开始书写这一章……"]');
    await expect(editorTextarea).toBeVisible({ timeout: 10000 });
    await expect(editorTextarea).toBeEditable();
    await expect(page.getByText('待审计/未开始', { exact: true })).toHaveCount(0);

    const responsiveViewports = [
      { width: 1087, height: 814 },
      { width: 797, height: 674 },
      { width: 522, height: 674 },
    ];
    for (const viewport of responsiveViewports) {
      await page.setViewportSize(viewport);
      await expect(editorTextarea).toBeVisible();
      await expect(editorTextarea).toBeEditable();
      const pageOverflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        body: document.body.scrollWidth <= document.body.clientWidth,
      }));
      expect(pageOverflow.document).toBe(true);
      expect(pageOverflow.body).toBe(true);
    }

    await page.setViewportSize({ width: 1087, height: 814 });

    // Direct-write should keep the editor usable and the planning action in the first viewport.
    // 直接写正文主线在窄视口首屏仍需保持可编辑，且不应误显示资料包同步主动作。
    const editorMain = page.getByTestId('app-shell-main');
    const directWriteViewports = [
      { width: 797, height: 674 },
      { width: 522, height: 674 },
    ];
    for (const viewport of directWriteViewports) {
      await page.setViewportSize(viewport);
      await expect(editorTextarea).toBeVisible();
      await expect(editorTextarea).toBeEditable();
      await expect(page.getByText('当前资料包需要同步', { exact: false })).toHaveCount(0);
      await expect(editorMain.getByRole('button', { name: '同步资料包', exact: true })).toHaveCount(0);

      const primaryEditorAction = editorMain.getByRole('button', { name: /^(生成分镜|生成一章预览|自动生产一章)$/ });
      await expect(primaryEditorAction).toHaveCount(1);
      await expect(primaryEditorAction).toBeVisible();
      const primaryEditorActionBox = await primaryEditorAction.boundingBox();
      expect(primaryEditorActionBox).not.toBeNull();
      if (primaryEditorActionBox) {
        expect(primaryEditorActionBox.x).toBeGreaterThanOrEqual(0);
        expect(primaryEditorActionBox.y).toBeGreaterThanOrEqual(0);
        expect(primaryEditorActionBox.x + primaryEditorActionBox.width).toBeLessThanOrEqual(viewport.width);
        expect(primaryEditorActionBox.y + primaryEditorActionBox.height).toBeLessThanOrEqual(viewport.height);
      }

      const editorOverflow = await Promise.all([
        editorMain.evaluate((element) => element.scrollWidth <= element.clientWidth),
        page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth),
      ]);
      expect(editorOverflow).toEqual([true, true, true]);
    }

    await page.setViewportSize({ width: 1087, height: 814 });

    // Expand the chapter sidebar as it is collapsed by default
    // 展开章节列表（默认是收起的）
    const toggleSidebarButton = page.locator('button:has-text("章节列表")');
    await expect(toggleSidebarButton).toBeVisible();
    await toggleSidebarButton.click();

    // 5. Click the "新建章节" (Create Chapter) button to establish Chapter 2
    // 点击 "新建章节" 按钮以建立第二章
    const addChapterButton = page.locator('button[title="新建章节"]');
    await expect(addChapterButton).toBeVisible();
    await addChapterButton.click();

    // Wait for the chapter title input value to transition to "第 2 章" to ensure React 19 rendering cycle has finished
    // 等待章节标题输入框的值变为 "第 2 章"，以保证 React 19 渲染生命周期完全就绪，不产生状态漂移
    const chapterTitleInput = page.locator('#chapter-title');
    await expect(chapterTitleInput).toHaveValue('第 2 章', { timeout: 10000 });

    // 6. Fill mock text in the editor content text area
    // 在编辑器内容文本区域中填入模拟文本
    await expect(editorTextarea).toBeVisible();
    await editorTextarea.fill('夜幕低垂，荒原上的风带着刺骨的寒意，吹打在残破的石墙上。');

    // 7. Open the AI Assistant Workspace, confirm this run's writing style, and generate content.
    await page.setViewportSize({ width: 522, height: 674 });
    const expandAgentButton = page.getByRole('button', { name: '展开智能管家', exact: true });
    await expect(expandAgentButton).toBeVisible();
    await expandAgentButton.click();

    const productionTab = page.getByRole('button', { name: '生成正文', exact: true });
    await expect(productionTab).toBeVisible();
    await productionTab.click();

    const styleAction = page.getByTestId('agent-workspace-scroll-region')
      .getByRole('button', { name: '确认并生成', exact: true });
    await expect(styleAction).toBeVisible();
    await styleAction.click();
    const styleDialog = page.getByRole('dialog', { name: '确认本次写法' });
    await expect(styleDialog).toBeVisible();
    const styleDialogBox = await styleDialog.boundingBox();
    expect(styleDialogBox).not.toBeNull();
    if (styleDialogBox) {
      expect(styleDialogBox.x).toBeGreaterThanOrEqual(0);
      expect(styleDialogBox.x + styleDialogBox.width).toBeLessThanOrEqual(522);
      expect(styleDialogBox.y + styleDialogBox.height).toBeLessThanOrEqual(674);
    }
    expect(await styleDialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await styleDialog.getByRole('button', { name: '确认并生成', exact: true }).click();
    await page.setViewportSize({ width: 1087, height: 814 });

    // Fallback production is an explicit preview only and must remain blocked.
    const acceptAndWriteButton = page.getByRole('button', { name: '接受并写入', exact: true });
    await expect(acceptAndWriteButton).toBeVisible();
    await expect(acceptAndWriteButton).toBeDisabled();

    await expect(page.getByText(/保底草稿未经过模型审稿，不能直接接受并写入/)).toBeVisible();
    await expect(editorTextarea).toHaveValue('夜幕低垂，荒原上的风带着刺骨的寒意，吹打在残破的石墙上。');
    await editorTextarea.fill('模型不可用时保留作者手写正文，等待后续重新审阅。');
    await expect(editorTextarea).toHaveValue('模型不可用时保留作者手写正文，等待后续重新审阅。');
    const updatedValue = await editorTextarea.inputValue();
    expect(updatedValue.length).toBeGreaterThan(20);

    const agentWorkspace = page.getByTestId('agent-workspace');
    await agentWorkspace.getByRole('button', { name: '收起智能管家', exact: true }).click();
    await expect(agentWorkspace).toBeHidden();

    // 8. Click the "导出" (Export) button in the status bar to verify the export download triggers successfully
    // 点击状态栏中的 "导出" 按钮，验证导出下载是否成功触发
    // Set up dialog handler to automatically accept and choose EPUB format
    // 设置对话框处理器以自动接受并选择 EPUB 格式
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('导出为 EPUB？');
      await dialog.accept();
    });

    const downloadPromise = page.waitForEvent('download');
    const exportButton = page.locator('button:has-text("导出")');
    await expect(exportButton).toBeVisible();
    await exportButton.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('epub');
    expect(download.suggestedFilename()).toContain('荒原黎明');
  });

  test('模型发现 UI 交互 — 测试连接、输入框 ARIA 和设置关闭', async ({ page }) => {
    // 1. Visit app and open settings
    await page.goto('/');
    await waitForAppReady(page);
    const settingsButton = page.locator('button[aria-label="系统设置"]');
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    const settingsDialog = page.locator('#settings-dialog-container');
    await expect(settingsDialog).toBeVisible();

    // 2. Verify Model input has correct ARIA attributes
    const modelInput = settingsDialog.locator('#model-input');
    await expect(modelInput).toBeVisible();
    await expect(modelInput).toHaveAttribute('role', 'combobox');
    await expect(modelInput).toHaveAttribute('aria-autocomplete', 'list');

    // 3. Verify label is connected via htmlFor
    const modelLabel = settingsDialog.locator('label[for="model-input"]');
    await expect(modelLabel).toBeVisible();
    await expect(modelLabel).toContainText('Model');

    // 4. Click "测试连接" — in test env it may succeed or fail;
    //    either way the UI should respond
    const testBtn = settingsDialog.getByText('测试连接');
    await testBtn.click();

    // Wait for the actual connection result, rather than sleeping for a fixed duration.
    await expect(settingsDialog.getByRole('status')).toContainText(/链接测试(成功|失败)/, { timeout: 15000 });

    // 5. Click outside (escape) should close settings
    await page.keyboard.press('Escape');
    await expect(settingsDialog).not.toBeVisible();
  });
});
