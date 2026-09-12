import { test, expect } from '@playwright/test';

/**
 * Plan 187 — 真实后端管线旅程。
 *
 * UI 旅程：开书向导 → 编辑器（全部真实，无 stub，空 API Key 走本地保底）。
 * 管线段：以页面会话（dev token）驱动真实 HTTP 链路
 *   start-stream（SSE）→ run 评审态 → apply 治理拒绝 → getChapter 回读，
 * 断言保底 run 真实产生且 plan165 严格门拒绝未审稿的保底草稿、作者正文保留。
 *
 * Plan 198：意图不再声明「本章写800字」。默认章长（4000 字）下保底草稿
 * 改造后可直接通过流内完整章质量门，无需低字数 workaround。
 *
 * 说明：生产页签同名按钮（写法区预览 vs 生产动作）存在 aria 禁用态翻转，
 * UI 点击驱动无法稳定锚定（Plan 187 执行报告已记录），按计划的降级条款改为
 * HTTP 层真实管线契约验证；UI 部分仍完整走真实向导与编辑器。
 */

test.describe.configure({ retries: 1 });

async function waitForAppReady(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('app-ready')).toHaveAttribute('data-ready-state', 'true');
}

test('真实生产管线：start-stream → 保底 run → apply → 章节回读', async ({ page }) => {
  test.setTimeout(240_000);
  let startStreamCalls = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/chapter-production-runs/start-stream')) startStreamCalls += 1;
  });

  await page.goto('/');
  await waitForAppReady(page);

  // 向导前快照：用于识别本次向导新建的书（套件共享数据库，可能已有其他书）
  const knownNovelIds = await page.evaluate(async () => {
    const tokenResponse = await fetch('/api/dev-auth-token');
    const { token } = await tokenResponse.json() as { token: string };
    const rpcResponse = await fetch('/api/db', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'listNovels', args: [] }),
    });
    const payload = await rpcResponse.json() as { result?: Array<{ id: string }> };
    return (payload.result || []).map((entry) => entry.id);
  });

  // ── UI：开书向导（真实本地保底路径）──
  const seedInput = page.locator('#story-seed-input');
  await expect(seedInput).toBeVisible();
  await seedInput.fill('真实管线验证：主角在末日废墟中觉醒异能，开始复仇。');
  await page.locator('button:has-text("下一步：选择发布平台")').click();
  await page.locator('button:has-text("番茄平台")').first().click();
  await page.locator('button:has-text("下一步：篇幅与文风")').click();
  await page.locator('button:has-text("中长篇规划")').first().click();
  await page.locator('button:has-text("剧情高能")').first().click();
  await page.locator('button:has-text("唤醒灵感，智能开书立项")').click();
  await expect(page.locator('h2:has-text("立项推荐方案方向")')).toBeVisible({ timeout: 30_000 });
  await page.locator('button:has-text("选择此立项")').first().click();
  await page.locator('button:has-text("接受治理规划立项")').click();
  await page.getByRole('button', { name: '确认选项并继续', exact: true }).click();
  await page.locator('button:has-text("选择推荐创作流程")').click();

  // ── UI：编辑器写入作者正文（等待去抖自动保存真实落库）──
  const editorTextarea = page.locator('textarea[placeholder="在这里开始书写这一章……"]');
  await expect(editorTextarea).toBeVisible({ timeout: 15_000 });
  const authorText = '真实管线验证：夜幕低垂，主角在废墟边缘点燃了最后一支火把。';
  const saveSettled = page.waitForResponse(
    (response) => response.url().includes('/api/db')
      && response.request().method() === 'POST'
      && (response.request().postData() || '').includes('updateChapter'),
    { timeout: 15_000 },
  );
  await editorTextarea.fill(authorText);
  await saveSettled;

  // ── 管线：页面会话驱动真实 HTTP 链路 ──
  const pipeline = await page.evaluate(async (knownIds: string[]) => {
    const tokenResponse = await fetch('/api/dev-auth-token');
    const { token } = await tokenResponse.json() as { token: string };
    const auth = { Authorization: `Bearer ${token}` };
    const jsonHeaders = { ...auth, 'Content-Type': 'application/json' };

    const rpc = async <T>(method: string, args: unknown[] = []): Promise<T> => {
      const response = await fetch('/api/db', {
        method: 'POST', headers: jsonHeaders, body: JSON.stringify({ method, args }),
      });
      const payload = await response.json() as { result?: T; error?: string };
      if (!response.ok) throw new Error(`RPC ${method} failed: HTTP ${response.status} ${payload.error || ''}`);
      return payload.result as T;
    };

    // 同套件其他旅程可能已建书：取本次向导新建的那本（不在向导前 id 集合里）
    const novels = await rpc<Array<{ id: string; title: string }>>('listNovels');
    const novel = novels.find((entry) => !knownIds.includes(entry.id));
    if (!novel) throw new Error('no novel after onboarding');

    const generationResponse = await fetch('/api/db/generation', { headers: auth });
    const { databaseGeneration } = await generationResponse.json() as { databaseGeneration: number };

    const chapters = await rpc<Array<{ id: string; title: string; content?: string }>>('listChapters', [novel.id]);
    const chapter = chapters[chapters.length - 1];
    if (!chapter) throw new Error('no chapter after onboarding');

    // 写法解析/确认（与 EditorView 相同契约：确认后才传 styleConfirmationFingerprint）
    const writingStyle = async (action: 'resolve' | 'confirm') => {
      const response = await fetch(`/api/novels/${encodeURIComponent(novel.id)}/writing-style/${action}`, {
        method: 'POST', headers: jsonHeaders,
        body: JSON.stringify({ chapterId: chapter.id, databaseGeneration }),
      });
      return await response.json() as { resolution?: { fingerprint?: string; confirmed?: boolean } };
    };
    const resolved = await writingStyle('resolve');
    let styleFingerprint = resolved.resolution?.confirmed ? resolved.resolution.fingerprint : undefined;
    if (!styleFingerprint) {
      const confirmed = await writingStyle('confirm');
      styleFingerprint = confirmed.resolution?.confirmed ? confirmed.resolution.fingerprint : undefined;
    }

    // 真实 start-stream（空 Key → 确定性保底事件流）
    const streamResponse = await fetch('/api/chapter-production-runs/start-stream', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        novelId: novel.id,
        chapterId: chapter.id,
        databaseGeneration,
        userIntent: '真实管线验证生成保底正文',
        ...(styleFingerprint ? { styleConfirmationFingerprint: styleFingerprint } : {}),
      }),
    });
    if (!streamResponse.ok || !streamResponse.body) {
      const detail = await streamResponse.text().catch(() => '');
      throw new Error(`start-stream failed: HTTP ${streamResponse.status} ${detail.slice(0, 300)}`);
    }

    const reader = streamResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let doneEvent: { run?: { id: string; status: string; draftContent: string; targetChapterId: string; reviewVersionId?: string; reviewVersionHash?: string; reviewVersionSource?: string; continuityReport?: { auditMeta?: { source?: string; status?: string } } } } | null = null;
    let sawFallbackDraft = false;
    let sawFallbackBeats = false;
    let errorEvent: { code?: string; message?: string } | null = null;
    const receivedTypes: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const event = JSON.parse(trimmed.slice(6)) as { type: string; run?: { id: string; status: string; draftContent: string; targetChapterId: string; reviewVersionId?: string; reviewVersionHash?: string; reviewVersionSource?: string; continuityReport?: { auditMeta?: { source?: string; status?: string } } }; content?: string; code?: string; message?: string };
        receivedTypes.push(event.type);
        if (event.type === 'fallback_beats') sawFallbackBeats = true;
        if (event.type === 'fallback_draft_token' || event.type === 'fallback_draft_done') sawFallbackDraft = true;
        if (event.type === 'error') errorEvent = { code: event.code, message: event.message };
        if (event.type === 'done' && event.run) doneEvent = { run: event.run };
      }
    }

    if (!doneEvent?.run) {
      throw new Error(`start-stream finished without a done run event; received=[${receivedTypes.join(', ')}] error=${JSON.stringify(errorEvent)}`);
    }
    const run = doneEvent.run;
    const runId = run.id;

    // 真实 apply：plan165 严格门 —— 保底源 run 必须被治理拒绝（409 FALLBACK_REVIEW_REQUIRED）。
    // run 带 review 版本时客户端契约要求显式传 versionId + versionHash。
    const applyResponse = await fetch(`/api/chapter-production-runs/${runId}/apply`, {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({
        novelId: novel.id,
        chapterId: run.targetChapterId || chapter.id,
        databaseGeneration,
        ...(run.reviewVersionId && run.reviewVersionHash
          ? { versionId: run.reviewVersionId, versionHash: run.reviewVersionHash }
          : {}),
      }),
    });
    const applyStatus = applyResponse.status;
    const applyPayload = await applyResponse.json() as { code?: string };

    const finalChapter = await rpc<{ id: string; content?: string }>('getChapter', [run.targetChapterId || chapter.id]);
    return {
      novelTitle: novel.title,
      chapterId: chapter.id,
      sawFallbackBeats,
      sawFallbackDraft,
      runStatus: run.status,
      runSource: run.continuityReport?.auditMeta?.source,
      runDraftLength: (run.draftContent || '').length,
      applyStatus,
      applyCode: applyPayload.code,
      finalContent: finalChapter.content || '',
    };
  }, knownNovelIds);

  // ── 断言 ──
  expect(pipeline.sawFallbackBeats).toBe(true);
  expect(pipeline.sawFallbackDraft).toBe(true);
  expect(pipeline.runStatus).toBe('review_required');
  expect(pipeline.runSource).toBe('fallback');
  expect(pipeline.runDraftLength).toBeGreaterThan(200);
  // 治理门禁：保底草稿未经模型审稿，apply 必须被拒绝
  expect(pipeline.applyStatus).toBe(409);
  expect(pipeline.applyCode).toBe('FALLBACK_REVIEW_REQUIRED');
  // 拒绝后作者手写正文必须原样保留
  expect(pipeline.finalContent).toBe(authorText);
  // 真实 start-stream 必须发生过（防回归成 stub 旅程）
  expect(startStreamCalls).toBeGreaterThanOrEqual(1);
});
