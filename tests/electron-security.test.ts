import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  getAppOrigin,
  isAppOrigin,
  resolveExternalUrl,
  isTrustedIpcSender,
} = require('../electron-security.cjs');

const appOrigin = getAppOrigin(3001);

test('isAppOrigin accepts exact localhost origin only', () => {
  assert.equal(isAppOrigin('http://localhost:3001/editor', appOrigin), true);
  assert.equal(isAppOrigin('http://localhost:3002/editor', appOrigin), false);
  assert.equal(isAppOrigin('http://user:pass@localhost:3001/x', appOrigin), false);
  assert.equal(isAppOrigin('http://user@localhost:3001/x', appOrigin), false);
  assert.equal(isAppOrigin('file:///etc/passwd', appOrigin), false);
});

test('resolveExternalUrl allows http/https and rejects malicious protocols', () => {
  assert.equal(resolveExternalUrl('https://example.com/docs', appOrigin), 'https://example.com/docs');
  assert.equal(resolveExternalUrl('javascript:alert(1)', appOrigin), false);
  assert.equal(resolveExternalUrl('file:///tmp/evil', appOrigin), false);
  assert.equal(resolveExternalUrl('mailto:attacker@example.com', appOrigin), false);
  assert.equal(resolveExternalUrl('http://user:pass@localhost:3001/x', appOrigin), false);
  assert.equal(resolveExternalUrl('http://localhost:3001/safe', appOrigin), null);
});

test('isTrustedIpcSender requires the main webContents and exact app origin', () => {
  const mainWebContents = { id: 1 };
  const mainWindow = {
    isDestroyed: () => false,
    webContents: mainWebContents,
  };

  assert.equal(isTrustedIpcSender({
    sender: mainWebContents,
    senderFrame: { url: `${appOrigin}/editor` },
  }, mainWindow, appOrigin), true);

  assert.equal(isTrustedIpcSender({
    sender: { id: 2 },
    senderFrame: { url: `${appOrigin}/` },
  }, mainWindow, appOrigin), false);

  assert.equal(isTrustedIpcSender({
    sender: mainWebContents,
    senderFrame: { url: 'http://localhost:3002/' },
  }, mainWindow, appOrigin), false);

  assert.equal(isTrustedIpcSender({
    sender: mainWebContents,
    senderFrame: { url: 'http://user:pass@localhost:3001/' },
  }, mainWindow, appOrigin), false);
});
