function getDevSpawnCommand(platform) {
  return platform === 'win32' ? 'npx.cmd' : 'npx';
}

function createJsonLineChunkParser(onMessage, onLine) {
  let buffer = '';

  return (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line) continue;
      if (onLine) onLine(line);
      try {
        onMessage(JSON.parse(line));
      } catch {}
    }
  };
}

function getServerRestartDelay(attemptCount) {
  return Math.min(3000 * Math.max(attemptCount, 1), 15000);
}

function getWatchdogRetryDelay(attemptCount) {
  return Math.min(5000 * attemptCount, 30000);
}

module.exports = {
  createJsonLineChunkParser,
  getDevSpawnCommand,
  getServerRestartDelay,
  getWatchdogRetryDelay,
};
