import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import net from 'node:net';
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

function withTimeout(promise, timeoutMs, label) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to reserve a CDP port');
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForCdp(port, processOutput) {
  const endpoint = `http://127.0.0.1:${port}/json/list`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) {
        const targets = await response.json();
        if (Array.isArray(targets) && targets.some((target) => target.type === 'page')) return;
      }
    } catch {
      // The packaged renderer is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Packaged application did not expose CDP. Output:\n${processOutput()}`);
}

async function launch() {
  const port = await reservePort();
  let output = '';
  const child = spawn(executablePath, [
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
  ], {
    env: {
      ...process.env,
      HOME: testRoot,
      USERPROFILE: testRoot,
      INKFLOW_DB_PATH: databasePath,
      INKFLOW_CONFIG_DIR: configDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  try {
    await waitForCdp(port, () => output);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    if (!context) throw new Error('Packaged application exposed no browser context');
    const page = context.pages()[0];
    if (!page) throw new Error(`CDP reported a page target that Playwright could not attach. Output:\n${output}`);
    return { browser, child, page, output: () => output };
  } catch (error) {
    child.kill();
    throw error;
  }
}

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

async function closeThroughElectronHandshake(application) {
  const { browser, child, page, output } = application;
  const exited = child.exitCode !== null
    ? Promise.resolve(child.exitCode)
    : new Promise((resolve) => child.once('exit', resolve));
  const pageClosed = page.waitForEvent('close', { timeout: 15_000 });
  await page.evaluate(() => globalThis.close());
  await pageClosed;
  await browser.close().catch(() => {});

  try {
    await withTimeout(exited, 5_000, 'Packaged process exit');
  } catch {
    // macOS intentionally keeps the process alive after its final window closes.
    child.kill();
    await withTimeout(exited, 5_000, `Packaged process termination. Output:\n${output()}`);
  }
}

let application;
try {
  application = await withTimeout(launch(), 75_000, 'First packaged launch');
  let page = application.page;
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
  await closeThroughElectronHandshake(application);
  application = undefined;

  application = await withTimeout(launch(), 75_000, 'Second packaged launch');
  page = application.page;
  await page.locator('body').waitFor({ state: 'visible' });
  const reopenedEditor = await enterEditor(page);
  const restoredContent = await reopenedEditor.inputValue();
  if (restoredContent !== expectedContent) {
    throw new Error(`Last editor input was not durable. Expected ${JSON.stringify(expectedContent)}, received ${JSON.stringify(restoredContent)}`);
  }

  await closeThroughElectronHandshake(application);
  application = undefined;
  process.stdout.write('Packaged Electron editor lifecycle persistence: OK\n');
} finally {
  if (application) {
    await application.browser.close().catch(() => {});
    application.child.kill();
  }
  rmSync(testRoot, { recursive: true, force: true });
}
