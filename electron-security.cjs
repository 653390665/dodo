'use strict';

function getAppOrigin(port) {
  return `http://localhost:${port}`;
}

function isAppOrigin(url, appOrigin) {
  try {
    return new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}

function resolveExternalUrl(url, appOrigin) {
  if (isAppOrigin(url, appOrigin)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    // reject malformed URLs
  }
  return false;
}

function isTrustedIpcSender(event, mainWindow, appOrigin) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (event.sender !== mainWindow.webContents) return false;
  const frameUrl = event.senderFrame?.url ?? '';
  if (!frameUrl) return false;
  return isAppOrigin(frameUrl, appOrigin);
}

module.exports = {
  getAppOrigin,
  isAppOrigin,
  resolveExternalUrl,
  isTrustedIpcSender,
};
