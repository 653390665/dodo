import { test, expect } from '@playwright/test';

test.describe('InkFlow Core End-to-End & Interaction Flow', () => {
  test('Should load landing page and toggle SettingsModal successfully', async ({ page }) => {
    // 1. Visit integrated developer web app
    await page.goto('/');

    // 2. Validate essential branding element or text is present on Welcome view
    await expect(page.locator('h2').first()).toContainText('INKFLOW');

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
      } catch (err) {
        console.log(`[BROWSER CONSOLE ERROR LOGGING FAILED] ${msg.text()}`);
      }
    });
    page.on('pageerror', err => {
      console.log('[BROWSER UNHANDLED ERROR] ' + err.stack);
    });

    // 1. Visit integrated developer web app
    // 访问集成的开发者 Web 应用
    await page.goto('/');

    // 2. Validate essential branding element or text is present on Welcome view
    // 验证欢迎页面上是否存在核心品牌元素或文本
    await expect(page.locator('h1')).toContainText('InkFlow 智能写作终端');

    // 3. Create a new project named "荒原黎明"
    // 创建一个名为 "荒原黎明" 的新作品
    const seedInput = page.locator('#story-seed-input');
    await expect(seedInput).toBeVisible();
    await seedInput.fill('荒原黎明：主角在末日废墟中觉醒了异能，开始复仇。');

    // Press Enter to submit the idea seed and start generator
    // 按下 Enter 提交灵感种子并启动生成器
    await seedInput.press('Enter');

    // Wait for the local fallback or model direction cards to generate and show up
    // 等待本地保底或模型生成的方向卡片渲染显示
    const selectDirectionTitle = page.locator('h2:has-text("立项推荐方案方向")');
    await expect(selectDirectionTitle).toBeVisible({ timeout: 10000 });

    // Click the first direction card's button containing "一键开始此立项"
    // 点击包含 "一键开始此立项" 的第一个方向卡片按钮
    const firstDirectionCard = page.locator('button:has-text("一键开始此立项")').first();
    await expect(firstDirectionCard).toBeVisible();
    await firstDirectionCard.click();

    // Handle "智能开书配置推荐" modal dialog and accept recommendation
    // 处理 "智能开书配置推荐" 模态框并接受推荐
    const acceptRecommendationButton = page.locator('button:has-text("接受治理规划立项")');
    await expect(acceptRecommendationButton).toBeVisible();
    await acceptRecommendationButton.click();

    // Handle "生成设定确认单" (confirm checklist) modal and write settings
    // 处理 "生成设定确认单" 确认勾选并原子写入设定工坊
    const confirmWriteButton = page.locator('button:has-text("勾选并原子写入设定工坊")');
    await expect(confirmWriteButton).toBeVisible();
    await confirmWriteButton.click();

    // Choose to enable recommended flow inside "智能引导气泡弹窗" (smart onboarding guide bubble) to enter cockpit
    // 在 "智能引导气泡弹窗" 中选择并点击 "启用推荐创作流程" 以开启驾驶舱
    const enableFlowButton = page.locator('button:has-text("启用推荐创作流程")');
    await expect(enableFlowButton).toBeVisible();
    await enableFlowButton.click();

    // 4. Navigate to the Editor View for this project
    // 进入该作品的编辑器视图
    // First, verify we transitioned into the Workspace Cockpit View by waiting for the primary recommended action button (add world setting)
    // 首先，通过等待自适应建议中的最优先建议行动 "补充世界观设定" 按钮显示，确认已转换至项目 Cockpit 视图
    const recommendButton = page.locator('button:has-text("补充世界观设定")');
    await expect(recommendButton).toBeVisible({ timeout: 10000 });

    // Then, click the queued recommended action "继续写作最近章节" to enter the Editor View
    // 随后，点击队列建议中的 "继续写作最近章节" 行动进入主编辑器工作台
    const resumeStep = page.locator('[data-testid="queued-step-resume_editor"]');
    await expect(resumeStep).toBeVisible();
    await resumeStep.click();

    // Wait for the editor to be fully loaded by expecting the writing surface textarea to be visible
    // 等待编辑器主写作区域（textarea）加载并可见，这有助于平滑过渡懒加载/异步数据加载状态
    const editorTextarea = page.locator('textarea[placeholder="在这里开始书写这一章……"]');
    await expect(editorTextarea).toBeVisible({ timeout: 10000 });

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

    // 7. Open the AI Assistant Workspace, switch to the production or planning tab, click to generate some content
    // 打开 AI 助手工作区，切换到 production 面板，点击生成内容
    const startAutoProduceButton = page.locator('button:has-text("自动生产一章")');
    await expect(startAutoProduceButton).toBeVisible();
    await startAutoProduceButton.click();

    // Now that the AI Assistant sidebar is open, click to generate
    // 智能管家侧栏已展开，点击开始生成一章
    const startProductionButton = page.locator('button:has-text("开始生产一章")');
    await expect(startProductionButton).toBeVisible();
    await startProductionButton.click();

    // Wait for the AI generation to complete and the "接受并写入" button to become enabled
    // 等待 AI 生成完成，并且 "接受并写入" 按钮变为可用状态
    const acceptAndWriteButton = page.locator('button:has-text("接受并写入")');
    await expect(acceptAndWriteButton).toBeVisible();
    try {
      await expect(acceptAndWriteButton).not.toBeDisabled({ timeout: 15000 });
    } catch (e) {
      console.log("=== DEBUG PAGE TEXT ===");
      console.log(await page.textContent('body'));
      console.log("=== DEBUG PANEL CONTENT ===");
      const panel = page.locator('div:has-text("单章自动生产")').last();
      if (await panel.count() > 0) {
        console.log(await panel.innerText());
      } else {
        console.log("Panel not found");
      }
      throw e;
    }
    await acceptAndWriteButton.click();

    // Verify that the generated output appends/merges cleanly
    // 验证生成的内容已干净、成功地合并追加至编辑器中
    await expect(editorTextarea).not.toHaveValue('夜幕低垂，荒原上的风带着刺骨的寒意，吹打在残破的石墙上。');
    const updatedValue = await editorTextarea.inputValue();
    expect(updatedValue.length).toBeGreaterThan(50);

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
});
