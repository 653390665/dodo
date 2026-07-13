import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  getAppOrigin,
  isAppOrigin,
  resolveExternalUrl,
} = require('../electron-security.cjs');

const appOrigin = getAppOrigin(3001);

test('isAppOrigin accepts exact localhost origin only', () => {
  assert.equal(isAppOrigin('http://localhost:3001/editor', appOrigin), true);
  assert.equal(isAppOrigin('http://localhost:3002/editor', appOrigin), false);
  assert.equal(isAppOrigin('http://user:pass@localhost:3001/x', appOrigin), false);
  assert.equal(isAppOrigin('file:///etc/passwd', appOrigin), false);
});

test('resolveExternalUrl allows http/https and rejects malicious protocols', () => {
  assert.equal(resolveExternalUrl('https://example.com/docs', appOrigin), 'https://example.com/docs');
  assert.equal(resolveExternalUrl('javascript:alert(1)', appOrigin), false);
  assert.equal(resolveExternalUrl('file:///tmp/evil', appOrigin), false);
  assert.equal(resolveExternalUrl('http://localhost:3001/safe', appOrigin), null);
});

test('isTrustedIpcSender rejects non-main-window senders', () => {
  const { isTrustedIpcSender } = require('../electron-security.cjs');
  const mainWindow = {
    isDestroyed: () => false,
    webContents: { id: 1 },
  };
  const event = {
    sender: { id: 2 },
    senderFrame: { url: `${appOrigin}/` },
  };
  assert.equal(isTrustedIpcSender(event, mainWindow, appOrigin), false);
});
