import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { registerConfigRoutes } from '../server/routes/config';
import { reloadConfig, saveConfig } from '../server/lib/config';
import {
  captureEnv,
  createTestWorkspace,
  restoreEnv,
  type EnvSnapshot,
  type TestWorkspace,
} from './helpers/test-environment';

// HTTP 级契约（特征测试）：POST /api/config 的空 Key 必须保留已存 Key
// （server/routes/config.ts `apiKey: apiKey || existing.apiKey` 的语义）。
// 回归会静默清空用户 API Key——本测试锁定当前正确行为，变更需产品决策。

const envSnapshot: EnvSnapshot = captureEnv([
  'INKFLOW_CONFIG_DIR',
  'INKFLOW_ELECTRON_MODE',
  'INKFLOW_SECURE_API_KEY',
]);

const workspace: TestWorkspace = createTestWorkspace('config-route-contract');
const configDir = workspace.path('config');
const configFilePath = path.join(configDir, 'config.json');
process.env.INKFLOW_CONFIG_DIR = configDir;
process.env.INKFLOW_ELECTRON_MODE = 'false';
delete process.env.INKFLOW_SECURE_API_KEY;
reloadConfig();

// 预存一份带 Key 的配置，保证后续用例从「已配置」状态出发。
saveConfig({
  apiKey: 'sk-existing',
  baseUrl: 'https://api.example.invalid',
  model: 'test-model',
  promptTemplates: {} as any,
});

const app = express();
app.use(express.json());
registerConfigRoutes(app);
const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
  const instance = app.listen(0, () => resolve(instance));
  instance.once('error', reject);
});
const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

function postConfig(body: unknown, route = '/api/config'): Promise<Response> {
  return fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test.after(() => {
  server.close();
  restoreEnv(envSnapshot);
  reloadConfig();
  workspace.cleanup();
});

test('POST /api/config keeps the stored API key when the body sends an empty key', async () => {
  const response = await postConfig({
    apiKey: '',
    baseUrl: 'https://api.example.invalid',
    model: 'test-model',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  // 落盘文件仍持有加密后的既有 Key，而不是被清空。
  const raw = JSON.parse(fs.readFileSync(configFilePath, 'utf-8')) as { apiKey?: string };
  assert.ok(raw.apiKey && raw.apiKey.startsWith('enc:'), 'empty key must not wipe the stored key at rest');
  assert.equal(reloadConfig().apiKey, 'sk-existing');
});

test('POST /api/config persists a new non-empty key', async () => {
  const response = await postConfig({
    apiKey: 'sk-new-key',
    baseUrl: 'https://api.example.invalid',
    model: 'test-model',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const raw = JSON.parse(fs.readFileSync(configFilePath, 'utf-8')) as { apiKey?: string };
  assert.ok(raw.apiKey && raw.apiKey.startsWith('enc:'));
  assert.equal(reloadConfig().apiKey, 'sk-new-key');
});

test('POST /api/config/sync updates the cached key env without persisting it', async () => {
  const response = await postConfig({ apiKey: 'sk-sync-key' }, '/api/config/sync');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  // updateCachedApiKey 语义：同步值进入 INKFLOW_SECURE_API_KEY（Electron 模式的权威来源）。
  assert.equal(process.env.INKFLOW_SECURE_API_KEY, 'sk-sync-key');

  // 但 sync 不落盘：文件里的 Key 仍是上一次 POST /api/config 保存的值。
  const raw = JSON.parse(fs.readFileSync(configFilePath, 'utf-8')) as { apiKey?: string };
  assert.ok(raw.apiKey && raw.apiKey.startsWith('enc:'));
  assert.equal(reloadConfig().apiKey, 'sk-new-key');
});
