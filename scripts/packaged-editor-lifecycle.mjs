import { _electron as electron } from 'playwright';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const executablePath = process.env.INKFLOW_PACKAGED_EXECUTABLE;
if (!executablePath || !existsSync(executablePath)) {
  throw new Error(`INKFLOW_PACKAGED_EXECUTABLE is missing or invalid: ${executablePath || '<empty>'}`);
}

const testRoot = path.join(os.tmpdir(), `inkflow-packaged-lifecycle-${process.pid}`);
const databasePath = path.join(testRoot, 'lifecycle.db');
const configDir = path.join(testRoot, 'config');
const expectedContent = `打包应用退出耐久性验证-${Date.now()}`;
mkdirSync(configDir, { recursive: true });

const launch = () => electron.launch({
  executablePath,
  env: {
    ...process.env,
    HOME: testRoot,
    USERPROFILE: testRoot,
    INKFLOW_DB_PATH: databasePath,
    INKFLOW_CONFIG_DIR: configDir,
  },
  timeout: 30_000,
});

async function callDb(page, method, ...args) {
  return page.evaluate(async ({ method: dbMethod, args: dbArgs }) => {
    const response = await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: dbMethod, args: dbArgs }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, { method, args });
}

async function enterEditor(page) {
  await page.getByRole('button', { name: /继续当前作品/ }).click();
  const resume = page.locator('[data-testid="queued-step-resume_editor"]');
  await resume.waitFor({ state: 'visible', timeout: 15_000 });
  await resume.click();
  const editor = page.locator('textarea[placeholder="在这里开始书写这一章……"]');
  await editor.waitFor({ state: 'visible', timeout: 15_000 });
  return editor;
}

async function quitThroughElectronHandshake(application) {
  const closed = application.waitForEvent('close', { timeout: 15_000 });
  await application.evaluate(({ app }) => app.quit());
  await closed;
}

let application;
try {
  application = await launch();
  let page = await application.firstWindow();
  await page.locator('body').waitFor({ state: 'visible' });

  const now = Date.now();
  await callDb(page, 'createNovel', {
    id: 'packaged-lifecycle-novel',
    title: '打包耐久性验证作品',
    authorId: 'local-user',
    summary: '',
    status: 'ongoing',
    createdAt: now,
    updatedAt: now,
  });
  await callDb(page, 'createChapter', {
    id: 'packaged-lifecycle-chapter',
    novelId: 'packaged-lifecycle-novel',
    title: '第一章',
    volumeName: '正文卷',
    content: '原始正文',
    sceneBeats: '',
    order: 1,
    wordCount: 4,
    createdAt: now,
    updatedAt: now,
  });
  await page.reload();

  const editor = await enterEditor(page);
  await editor.fill(expectedContent);
  await quitThroughElectronHandshake(application);
  application = undefined;

  application = await launch();
  page = await application.firstWindow();
  await page.locator('body').waitFor({ state: 'visible' });
  const reopenedEditor = await enterEditor(page);
  const restoredContent = await reopenedEditor.inputValue();
  if (restoredContent !== expectedContent) {
    throw new Error(`Last editor input was not durable. Expected ${JSON.stringify(expectedContent)}, received ${JSON.stringify(restoredContent)}`);
  }

  await quitThroughElectronHandshake(application);
  application = undefined;
  process.stdout.write('Packaged Electron editor lifecycle persistence: OK\n');
} finally {
  if (application) await application.close().catch(() => {});
  rmSync(testRoot, { recursive: true, force: true });
}
