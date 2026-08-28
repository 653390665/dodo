import test from 'node:test';
import assert from 'node:assert/strict';
import { saveConfig, reloadConfig } from '../server/lib/config';
import {
  captureEnv,
  createTestWorkspace,
  restoreEnv,
  type EnvSnapshot,
  type TestWorkspace,
} from './helpers/test-environment';

test.describe('config saving regression tests', () => {
  let envSnapshot: EnvSnapshot;
  let testWorkspace: TestWorkspace;

  test.before(() => {
    envSnapshot = captureEnv([
      'INKFLOW_CONFIG_DIR',
      'INKFLOW_ELECTRON_MODE',
      'INKFLOW_SECURE_API_KEY',
    ]);
    testWorkspace = createTestWorkspace('config-saving');
    process.env.INKFLOW_CONFIG_DIR = testWorkspace.path('config');
    reloadConfig();
  });

  test.after(() => {
    restoreEnv(envSnapshot);
    testWorkspace.cleanup();
  });

  test('preserves existing API Key when saving an empty API Key', () => {
    // Standard mode first
    process.env.INKFLOW_ELECTRON_MODE = 'false';
    reloadConfig();

    // 1. Save config with a key
    saveConfig({
      apiKey: 'test-api-key-123',
      baseUrl: 'http://localhost:1234',
      model: 'test-model',
      promptTemplates: {} as any
    });

    const configWithKey = reloadConfig();
    assert.equal(configWithKey.apiKey, 'test-api-key-123');

    // 2. Save config with empty key (should preserve existing key)
    saveConfig({
      apiKey: '',
      baseUrl: 'http://localhost:5678',
      model: 'test-model-2',
      promptTemplates: {} as any
    });

    const configAfterEmptySave = reloadConfig();
    assert.equal(configAfterEmptySave.apiKey, 'test-api-key-123'); // Still preserved!
    assert.equal(configAfterEmptySave.baseUrl, 'http://localhost:5678'); // Other fields updated!
  });

  test('Electron mode preserves existing INKFLOW_SECURE_API_KEY when saving an empty API Key', () => {
    process.env.INKFLOW_ELECTRON_MODE = 'true';
    process.env.INKFLOW_SECURE_API_KEY = 'electron-secure-key';
    reloadConfig();

    // Save with empty key
    saveConfig({
      apiKey: '',
      baseUrl: 'http://localhost:9999',
      model: 'test-model-elec',
      promptTemplates: {} as any
    });

    const configAfterEmptySave = reloadConfig();
    assert.equal(configAfterEmptySave.apiKey, 'electron-secure-key'); // Preserved in env
    assert.equal(process.env.INKFLOW_SECURE_API_KEY, 'electron-secure-key');
    assert.equal(configAfterEmptySave.baseUrl, 'http://localhost:9999');
  });
});
